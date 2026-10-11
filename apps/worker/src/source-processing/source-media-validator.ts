// cspell:ignore bmff ctts edts elst elsts isom mdia mdhd minf Moov stbl stts stsz stz2 tkhd traks
import { createHash, type Hash } from 'node:crypto';
import { parseStream } from 'music-metadata';
import { createFile as createMp4File, MP4BoxBuffer, type Movie as Mp4Movie } from 'mp4box';
import { PassThrough, type Readable } from 'node:stream';

import type { SourceMediaReader } from './source-media-reader.js';
import type { SourceRecord } from './source-processor.js';

export const MAX_SOURCE_MEDIA_BYTES = 1_073_741_824;
export const MAX_SOURCE_MEDIA_DURATION_SECONDS = 3600;

export type SourceMediaValidationResult = Readonly<{
  durationSeconds: number | null;
  contentHash: string;
  detectedMimeType: string;
}>;

type ParsedFormat = Readonly<{
  format?: Readonly<{ container?: string; duration?: number; hasVideo?: boolean }>;
}>;

type SourceMediaParser = (
  stream: Readable,
  fileInfo?: { size?: number },
  options?: { duration?: boolean; skipCovers?: boolean },
) => Promise<ParsedFormat>;

export class SourceMediaValidationError extends Error {
  readonly code = 'SOURCE_MEDIA_INVALID';

  constructor() {
    super('Source media is invalid');
    this.name = 'SourceMediaValidationError';
  }
}

export class SourceMediaUnavailableError extends Error {
  readonly code = 'PROCESSOR_TEMPORARY_FAILURE';
  readonly retryable = true;

  constructor() {
    super('Source media storage is temporarily unavailable');
    this.name = 'SourceMediaUnavailableError';
  }
}

const CONTAINER_MIME_TYPES: Readonly<Record<string, string>> = {
  MPEG: 'audio/mpeg',
  WAVE: 'audio/wav',
};

const ALLOWED_SOURCE_MIME_TYPES: Readonly<Record<string, string>> = {
  'video/mp4': 'video/mp4',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-wav': 'audio/wav',
};
const ISO_BMFF_VIDEO_BRANDS = new Set([
  'ISOM',
  'ISO2',
  'ISO3',
  'ISO4',
  'ISO5',
  'ISO6',
  'MP41',
  'MP42',
  'AVC1',
]);

export class SourceMediaValidator {
  private readonly parse: SourceMediaParser;

  constructor(
    private readonly reader: SourceMediaReader,
    parse: SourceMediaParser = parseStream,
  ) {
    this.parse = parse;
  }

  async validate(source: SourceRecord): Promise<SourceMediaValidationResult> {
    if (!isValidSourceRecord(source)) throw new SourceMediaValidationError();
    let object;
    try {
      object = await this.reader.getObject({
        workspaceId: source.workspaceId,
        sourceId: source.id,
      });
    } catch {
      throw new SourceMediaUnavailableError();
    }

    const declaredMimeType = normalizeMimeType(source.mimeType);
    if (
      !declaredMimeType ||
      (object.contentType !== undefined &&
        normalizeMimeType(object.contentType) !== declaredMimeType) ||
      (object.contentLength !== undefined &&
        (!Number.isSafeInteger(object.contentLength) ||
          object.contentLength !== source.sizeBytes)) ||
      source.sizeBytes > MAX_SOURCE_MEDIA_BYTES
    ) {
      destroyBody(object.body);
      throw new SourceMediaValidationError();
    }

    if (declaredMimeType === 'text/plain') {
      return this.validateText(source, object.body, object.contentLength);
    }
    const expectedContainerMime = ALLOWED_SOURCE_MIME_TYPES[declaredMimeType];
    if (!expectedContainerMime) {
      destroyBody(object.body);
      throw new SourceMediaValidationError();
    }

    const parserInput = new PassThrough();
    const mp4File = expectedContainerMime === 'video/mp4' ? createMp4File() : undefined;
    let mp4Movie: Mp4Movie | undefined;
    let mp4ParserFailed = false;
    if (mp4File) {
      mp4File.onReady = (info) => {
        mp4Movie = info;
      };
      mp4File.onError = () => {
        mp4ParserFailed = true;
      };
    }
    let fileOffset = 0;
    let parserSettled = false;
    let parserFailed = false;
    let signalParserSettled!: () => void;
    const parserSettledPromise = new Promise<void>((resolve) => {
      signalParserSettled = resolve;
    });
    const parsedPromise = Promise.resolve()
      .then(() =>
        this.parse(
          parserInput,
          { size: object.contentLength ?? source.sizeBytes },
          { duration: true, skipCovers: true },
        ),
      )
      .then(
        (metadata) => {
          parserSettled = true;
          signalParserSettled();
          return metadata;
        },
        (error: unknown) => {
          parserSettled = true;
          parserFailed = true;
          signalParserSettled();
          throw error;
        },
      );
    void parsedPromise.catch(() => undefined);

    const hash = createHash('sha256');
    let byteCount = 0;
    let bodyReadFailed = false;
    object.body.on('error', () => {
      bodyReadFailed = true;
    });
    try {
      for await (const chunk of object.body) {
        if (parserFailed) throw new SourceMediaValidationError();
        const bytes = toBuffer(chunk);
        byteCount += bytes.byteLength;
        if (byteCount > MAX_SOURCE_MEDIA_BYTES || byteCount > source.sizeBytes) {
          parserInput.destroy();
          throw new SourceMediaValidationError();
        }
        hash.update(bytes);
        if (mp4File) {
          const arrayBuffer = Uint8Array.from(bytes).buffer;
          mp4File.appendBuffer(MP4BoxBuffer.fromArrayBuffer(arrayBuffer, fileOffset));
          fileOffset += bytes.byteLength;
        }
        if (!parserSettled && !parserInput.destroyed && !parserInput.write(bytes)) {
          await waitForDrainOrParser(parserInput, parserSettledPromise);
        }
      }
      mp4File?.flush();
      if (mp4ParserFailed) throw new SourceMediaValidationError();
      parserInput.end();
      const metadata = await parsedPromise;
      const digest = hash.digest('base64');
      const metadataDuration = metadata.format?.duration;
      const mp4Duration = mp4Movie && mp4File ? getMp4VideoDuration(mp4Movie, mp4File) : null;
      const duration =
        expectedContainerMime === 'video/mp4'
          ? mp4Duration === null
            ? null
            : maximumValidDuration(metadataDuration, mp4Duration)
          : metadataDuration;
      const detectedMimeType = containerToMimeType(
        metadata.format?.container,
        metadata.format?.hasVideo,
      );
      if (
        byteCount !== source.sizeBytes ||
        digest !== source.contentHash ||
        detectedMimeType !== expectedContainerMime ||
        typeof duration !== 'number' ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        duration > MAX_SOURCE_MEDIA_DURATION_SECONDS
      ) {
        throw new SourceMediaValidationError();
      }
      return {
        durationSeconds: Math.ceil(duration),
        contentHash: digest,
        detectedMimeType,
      };
    } catch {
      const unavailable = bodyReadFailed;
      destroyBody(object.body);
      parserInput.destroy();
      if (unavailable) throw new SourceMediaUnavailableError();
      throw new SourceMediaValidationError();
    }
  }

  private async validateText(
    source: SourceRecord,
    body: Readable,
    contentLength?: number,
  ): Promise<SourceMediaValidationResult> {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const hash: Hash = createHash('sha256');
    let byteCount = 0;
    let bodyReadFailed = false;
    body.on('error', () => {
      bodyReadFailed = true;
    });
    try {
      for await (const chunk of body) {
        const bytes = toBuffer(chunk);
        byteCount += bytes.byteLength;
        if (byteCount > MAX_SOURCE_MEDIA_BYTES || byteCount > source.sizeBytes) {
          throw new SourceMediaValidationError();
        }
        hash.update(bytes);
        decoder.decode(bytes, { stream: true });
      }
      decoder.decode();
      const digest = hash.digest('base64');
      if (
        byteCount === 0 ||
        byteCount !== source.sizeBytes ||
        (contentLength !== undefined && byteCount !== contentLength) ||
        digest !== source.contentHash
      ) {
        throw new SourceMediaValidationError();
      }
      return { durationSeconds: null, contentHash: digest, detectedMimeType: 'text/plain' };
    } catch {
      const unavailable = bodyReadFailed;
      destroyBody(body);
      if (unavailable) throw new SourceMediaUnavailableError();
      throw new SourceMediaValidationError();
    }
  }
}

function getMp4VideoDuration(
  movie: Mp4Movie,
  file: ReturnType<typeof createMp4File>,
): number | null {
  if (
    !movie.hasMoov ||
    movie.isFragmented ||
    !Number.isFinite(movie.timescale) ||
    movie.timescale <= 0 ||
    movie.videoTracks.length === 0
  ) {
    return null;
  }
  const sampleTableDurations = getVideoSampleTableDurations(movie, file);
  if (!sampleTableDurations) return null;
  const durations = [
    movie.duration / movie.timescale,
    ...sampleTableDurations,
    ...movie.videoTracks.flatMap((track) => [
      track.movie_duration / track.movie_timescale,
      track.duration / track.timescale,
      track.samples_duration / track.timescale,
    ]),
  ];
  const validDurations = durations.filter((duration) => Number.isFinite(duration) && duration > 0);
  return validDurations.length > 0 ? Math.max(...validDurations) : null;
}

function getVideoSampleTableDurations(
  movie: Mp4Movie,
  file: ReturnType<typeof createMp4File>,
): number[] | null {
  const videoTrackIds = new Set(movie.videoTracks.map((track) => track.id));
  const videoTracks = file.moov.traks.filter((track) => videoTrackIds.has(track.tkhd.track_id));
  if (videoTracks.length !== videoTrackIds.size) return null;

  const durations = videoTracks.map((track) => {
    const sampleTable = track.mdia.minf.stbl;
    const timeToSample = sampleTable.stts;
    const sampleCount =
      sampleTable.stsz?.sample_count ?? sampleTable.stz2?.sample_sizes.length ?? 0;
    if (
      !timeToSample ||
      sampleCount <= 0 ||
      timeToSample.sample_counts.length === 0 ||
      timeToSample.sample_counts.length !== timeToSample.sample_deltas.length
    ) {
      return null;
    }

    let indexedSamples = 0;
    let durationTicks = 0;
    for (let index = 0; index < timeToSample.sample_counts.length; index += 1) {
      const count = timeToSample.sample_counts[index];
      const delta = timeToSample.sample_deltas[index];
      if (
        count === undefined ||
        delta === undefined ||
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        !Number.isSafeInteger(delta) ||
        delta <= 0
      ) {
        return null;
      }
      indexedSamples += count;
      durationTicks += count * delta;
      if (!Number.isSafeInteger(indexedSamples) || !Number.isSafeInteger(durationTicks)) {
        return null;
      }
    }

    const timescale = track.mdia.mdhd.timescale;
    if (indexedSamples !== sampleCount || !Number.isSafeInteger(timescale) || timescale <= 0) {
      return null;
    }

    let compositionOffsetRange = 0;
    const compositionTimes = sampleTable.ctts;
    if (compositionTimes) {
      if (
        compositionTimes.sample_counts.length === 0 ||
        compositionTimes.sample_counts.length !== compositionTimes.sample_offsets.length
      ) {
        return null;
      }
      let compositionSamples = 0;
      let minimumOffset = Number.POSITIVE_INFINITY;
      let maximumOffset = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < compositionTimes.sample_counts.length; index += 1) {
        const count = compositionTimes.sample_counts[index];
        const offset = compositionTimes.sample_offsets[index];
        if (
          count === undefined ||
          offset === undefined ||
          !Number.isSafeInteger(count) ||
          count <= 0 ||
          !Number.isSafeInteger(offset)
        ) {
          return null;
        }
        compositionSamples += count;
        minimumOffset = Math.min(minimumOffset, offset);
        maximumOffset = Math.max(maximumOffset, offset);
      }
      if (compositionSamples !== sampleCount) return null;
      compositionOffsetRange = maximumOffset - minimumOffset;
    }

    const presentationDurationTicks = durationTicks + compositionOffsetRange;
    if (!Number.isSafeInteger(presentationDurationTicks)) return null;
    const presentationDuration = presentationDurationTicks / timescale;
    if (!Number.isFinite(presentationDuration) || presentationDuration <= 0) return null;

    const editList = track.edts?.elst;
    if (track.edts && !editList) return null;
    if (!editList) return presentationDuration;
    if (editList.entries.length === 0 || track.edts?.elsts.length !== 1) {
      return null;
    }
    let editDurationTicks = 0;
    for (const entry of editList.entries) {
      if (!Number.isSafeInteger(entry.segment_duration) || entry.segment_duration < 0) return null;
      editDurationTicks += entry.segment_duration;
      if (!Number.isSafeInteger(editDurationTicks)) return null;
    }
    const editDuration = editDurationTicks / movie.timescale;
    return Number.isFinite(editDuration) && editDuration > 0
      ? Math.max(presentationDuration, editDuration)
      : null;
  });

  return durations.every((duration): duration is number => duration !== null) ? durations : null;
}

function maximumValidDuration(...durations: Array<number | undefined | null>): number | null {
  const validDurations = durations.filter(
    (duration): duration is number =>
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0,
  );
  return validDurations.length > 0 ? Math.max(...validDurations) : null;
}

function normalizeMimeType(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : null;
}

function containerToMimeType(
  container: string | undefined,
  hasVideo: boolean | undefined,
): string | null {
  if (!container) return null;
  const normalized = container.toUpperCase();
  const direct = CONTAINER_MIME_TYPES[normalized];
  if (direct) return direct;
  const brands = normalized.split('/');
  return hasVideo === true && brands.some((brand) => ISO_BMFF_VIDEO_BRANDS.has(brand))
    ? 'video/mp4'
    : null;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new SourceMediaValidationError();
}

function destroyBody(body: Readable): void {
  if (!body.destroyed) body.destroy();
}

async function waitForDrainOrParser(
  stream: PassThrough,
  parserSettled: Promise<void>,
): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      stream.removeListener('drain', finish);
      stream.removeListener('close', finish);
      stream.removeListener('error', finish);
      resolve();
    };
    stream.once('drain', finish);
    stream.once('close', finish);
    stream.once('error', finish);
    void parserSettled.then(finish);
  });
}

function isValidSourceRecord(
  source: SourceRecord,
): source is SourceRecord & { mimeType: string; sizeBytes: number } {
  return (
    typeof source.id === 'string' &&
    typeof source.workspaceId === 'string' &&
    typeof source.contentHash === 'string' &&
    /^[A-Za-z0-9+/]{43}=$/u.test(source.contentHash) &&
    typeof source.mimeType === 'string' &&
    Number.isSafeInteger(source.sizeBytes) &&
    source.sizeBytes > 0
  );
}
