// cspell:ignore bmff ctts edts efmt elst ftyp hdlr isom isommp41 mdat mdhd mdia minf moov mp4a mvex mvhd soun stbl stco stsc stsd stsz stts tkhd trak
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { SourceMediaValidator } from './source-media-validator.js';
import type { SourceMediaReader } from './source-media-reader.js';

const checksum = (value: Buffer): string => createHash('sha256').update(value).digest('base64');
const media = Buffer.from('fixture-media');
const source = {
  id: 'source-1',
  workspaceId: 'workspace-1',
  status: 'validating',
  storageKey: 'workspaces/workspace-1/sources/source-1/original',
  contentHash: checksum(media),
  mimeType: 'audio/mpeg',
  sizeBytes: media.byteLength,
};

function createValidator(
  overrides: Partial<{
    body: Readable;
    contentLength: number;
    contentType: string;
    expectedMime: string;
    sizeBytes: number;
    duration: number;
    container: string;
    hasVideo: boolean;
  }> = {},
) {
  const body = overrides.body ?? Readable.from([media]);
  const reader: SourceMediaReader = {
    getObject: vi.fn().mockResolvedValue({
      body,
      contentLength: overrides.contentLength ?? media.byteLength,
      contentType: overrides.contentType ?? 'audio/mpeg',
    }),
  };
  const parse = vi.fn().mockResolvedValue({
    format: {
      container: overrides.container ?? 'MPEG',
      duration: overrides.duration ?? 1,
      ...(overrides.hasVideo === undefined ? {} : { hasVideo: overrides.hasVideo }),
    },
  });
  const validator = new SourceMediaValidator(reader, parse);
  return { validator, reader, parse };
}

describe('SourceMediaValidator', () => {
  it('streams the object, verifies size, declared/detected type and SHA-256', async () => {
    const { validator, reader, parse } = createValidator();

    await expect(validator.validate(source)).resolves.toEqual({
      durationSeconds: 1,
      contentHash: checksum(media),
      detectedMimeType: 'audio/mpeg',
    });
    expect(reader.getObject).toHaveBeenCalledWith({
      workspaceId: source.workspaceId,
      sourceId: source.id,
    });
    expect(parse).toHaveBeenCalledOnce();
  });

  it('keeps object-store read failures retryable instead of classifying them as invalid media', async () => {
    const validator = new SourceMediaValidator({
      getObject: async () => {
        throw new Error('temporary storage failure');
      },
    });

    await expect(validator.validate(source)).rejects.toMatchObject({
      code: 'PROCESSOR_TEMPORARY_FAILURE',
      retryable: true,
    });
  });

  it('keeps mid-stream storage failures retryable', async () => {
    const body = Readable.from(
      (async function* () {
        yield media;
        throw new Error('connection reset');
      })(),
    );
    const validator = new SourceMediaValidator({
      getObject: async () => ({ body, contentLength: media.byteLength, contentType: 'audio/mpeg' }),
    });

    await expect(validator.validate(source)).rejects.toMatchObject({
      code: 'PROCESSOR_TEMPORARY_FAILURE',
      retryable: true,
    });
  });

  it.each([
    ['empty object', Buffer.alloc(0), {}, {}],
    ['checksum mismatch', media, {}, { contentHash: '0'.repeat(44) }],
    ['object length mismatch', media, { contentLength: media.byteLength + 1 }, {}],
    ['declared MIME mismatch', media, { contentType: 'audio/flac' }, {}],
    ['detected format mismatch', media, { container: 'WAVE' }, {}],
    ['unknown duration', media, { duration: Number.NaN }, {}],
    ['duration above maximum', media, { duration: 3601 }, {}],
  ] as Array<
    [
      string,
      Buffer,
      Partial<{
        body: Readable;
        contentLength: number;
        contentType: string;
        duration: number;
        container: string;
      }>,
      Partial<typeof source>,
    ]
  >)('rejects %s', async (_label, bytes, readerAndParserOptions, sourceOverrides) => {
    const { validator } = createValidator({
      ...readerAndParserOptions,
      body: readerAndParserOptions.body ?? Readable.from(bytes.length ? [bytes] : []),
    });

    await expect(validator.validate({ ...source, ...sourceOverrides })).rejects.toMatchObject({
      code: 'SOURCE_MEDIA_INVALID',
    });
  });

  it('accepts the inclusive 3600 second duration limit', async () => {
    const { validator } = createValidator({ duration: 3600 });
    await expect(validator.validate(source)).resolves.toMatchObject({ durationSeconds: 3600 });
  });

  it('rejects a zero-second media duration', async () => {
    const { validator } = createValidator({ duration: 0 });
    await expect(validator.validate(source)).rejects.toMatchObject({
      code: 'SOURCE_MEDIA_INVALID',
    });
  });

  it('rejects malformed UTF-8 TXT content without replacing invalid bytes', async () => {
    const malformed = Buffer.from([0xc3, 0x28]);
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: Readable.from([malformed]),
        contentLength: malformed.byteLength,
        contentType: 'text/plain',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'text/plain',
        sizeBytes: malformed.byteLength,
        contentHash: checksum(malformed),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it('accepts strict UTF-8 TXT while streaming its checksum', async () => {
    const text = Buffer.from('纯文本内容\n', 'utf8');
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: Readable.from([text]),
        contentLength: text.byteLength,
        contentType: 'text/plain',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'text/plain',
        sizeBytes: text.byteLength,
        contentHash: checksum(text),
      }),
    ).resolves.toEqual({
      durationSeconds: null,
      contentHash: checksum(text),
      detectedMimeType: 'text/plain',
    });
  });

  it('rejects truncated media when the real parser cannot determine its format', async () => {
    const truncated = Buffer.from([0xff, 0xfb]);
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(truncated),
        contentLength: truncated.byteLength,
        contentType: 'audio/mpeg',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        sizeBytes: truncated.byteLength,
        contentHash: checksum(truncated),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it.each([
    ['MP3', makeMp3Fixture(), 'audio/mpeg'],
    ['WAV', makeWavFixture(), 'audio/wav'],
    ['MP4', makeMp4Fixture(), 'video/mp4'],
  ] as const)(
    'detects a real %s fixture using music-metadata',
    async (_format, bytes, mimeType) => {
      const reader: SourceMediaReader = {
        getObject: vi.fn().mockResolvedValue({
          body: chunkedReadable(bytes),
          contentLength: bytes.byteLength,
          contentType: mimeType,
        }),
      };
      const validator = new SourceMediaValidator(reader);

      await expect(
        validator.validate({
          ...source,
          mimeType,
          sizeBytes: bytes.byteLength,
          contentHash: checksum(bytes),
        }),
      ).resolves.toMatchObject({ detectedMimeType: mimeType });
    },
  );

  it('parses a valid MP4 fixture without parser errors', async () => {
    const bytes = makeMp4Fixture();
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const parserError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const validator = new SourceMediaValidator(reader);

    try {
      await expect(
        validator.validate({
          ...source,
          mimeType: 'video/mp4',
          sizeBytes: bytes.byteLength,
          contentHash: checksum(bytes),
        }),
      ).resolves.toMatchObject({ detectedMimeType: 'video/mp4' });
      expect(parserError).not.toHaveBeenCalled();
    } finally {
      parserError.mockRestore();
    }
  });

  it('rejects MP4 video duration over the limit even when its audio track is short', async () => {
    const bytes = makeMp4Fixture({ videoSeconds: 3601, audioSeconds: 1 });
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'video/mp4',
        sizeBytes: bytes.byteLength,
        contentHash: checksum(bytes),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it('rejects MP4 when the video sample timeline exceeds its declared header duration', async () => {
    const bytes = makeMp4Fixture({
      videoSeconds: 1,
      videoSampleDurationsSeconds: [1, 3601],
      audioSeconds: 1,
    });
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'video/mp4',
        sizeBytes: bytes.byteLength,
        contentHash: checksum(bytes),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it('rejects MP4 when video composition offsets extend presentation beyond the limit', async () => {
    const bytes = makeMp4Fixture({
      videoSeconds: 1,
      videoCompositionOffsetsSeconds: [3601, 0],
      audioSeconds: 1,
    });
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'video/mp4',
        sizeBytes: bytes.byteLength,
        contentHash: checksum(bytes),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it('rejects MP4 when the video edit list extends beyond the limit', async () => {
    const bytes = makeMp4Fixture({
      videoSeconds: 1,
      videoEditDurationSeconds: 3601,
      audioSeconds: 1,
    });
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'video/mp4',
        sizeBytes: bytes.byteLength,
        contentHash: checksum(bytes),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it('accepts a 3600-second MP4 video when its audio track is shorter', async () => {
    const bytes = makeMp4Fixture({ videoSeconds: 3600, audioSeconds: 1 });
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'video/mp4',
        sizeBytes: bytes.byteLength,
        contentHash: checksum(bytes),
      }),
    ).resolves.toMatchObject({ durationSeconds: 3600 });
  });

  it('rejects fragmented MP4 when the video duration cannot be verified', async () => {
    const bytes = makeMp4Fixture({ videoSeconds: 3601, audioSeconds: 1, fragmented: true });
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'video/mp4',
        sizeBytes: bytes.byteLength,
        contentHash: checksum(bytes),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it('rejects an ISO BMFF file without a video track', async () => {
    const bytes = makeMp4Fixture({ includeVideo: false });
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: chunkedReadable(bytes),
        contentLength: bytes.byteLength,
        contentType: 'video/mp4',
      }),
    };
    const validator = new SourceMediaValidator(reader);

    await expect(
      validator.validate({
        ...source,
        mimeType: 'video/mp4',
        sizeBytes: bytes.byteLength,
        contentHash: checksum(bytes),
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_INVALID' });
  });

  it('rejects objects larger than 1 GiB using the streamed byte count', async () => {
    const oversized = Readable.from(
      (async function* () {
        yield Buffer.alloc(1024);
        yield Buffer.alloc(1);
      })(),
    );
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({ body: oversized, contentLength: 1_073_741_825 }),
    };
    const validator = new SourceMediaValidator(reader, vi.fn());

    await expect(validator.validate({ ...source, sizeBytes: 1_073_741_825 })).rejects.toMatchObject(
      {
        code: 'SOURCE_MEDIA_INVALID',
      },
    );
  });

  it('rejects actual streamed bytes that exceed the declared Source size', async () => {
    const reader: SourceMediaReader = {
      getObject: vi.fn().mockResolvedValue({
        body: Readable.from([media, Buffer.from([1])]),
        contentType: 'audio/mpeg',
      }),
    };
    const validator = new SourceMediaValidator(reader, vi.fn());

    await expect(validator.validate(source)).rejects.toMatchObject({
      code: 'SOURCE_MEDIA_INVALID',
    });
  });
});

function chunkedReadable(bytes: Buffer, chunkSize = 64): Readable {
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= bytes.byteLength) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      this.push(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

function makeMp3Fixture(): Buffer {
  const frameSize = 417;
  const bytes = Buffer.alloc(frameSize * 20);
  for (let offset = 0; offset < bytes.byteLength; offset += frameSize) {
    bytes.set([0xff, 0xfb, 0x90, 0x64], offset);
  }
  return bytes;
}

function makeWavFixture(): Buffer {
  const bytes = Buffer.alloc(44 + 44_100 * 2 * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.byteLength - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(44_100, 24);
  bytes.writeUInt32LE(176_400, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(bytes.byteLength - 44, 40);
  return bytes;
}

function makeMp4Fixture({
  videoSeconds = 1,
  videoSampleDurationsSeconds = [videoSeconds / 2, videoSeconds / 2],
  videoCompositionOffsetsSeconds,
  videoEditDurationSeconds,
  audioSeconds = 1,
  fragmented = false,
  includeVideo = true,
}: {
  videoSeconds?: number;
  videoSampleDurationsSeconds?: readonly [number, number];
  videoCompositionOffsetsSeconds?: readonly [number, number];
  videoEditDurationSeconds?: number;
  audioSeconds?: number;
  fragmented?: boolean;
  includeVideo?: boolean;
} = {}): Buffer {
  const fullBox = (size: number): Buffer => Buffer.alloc(size);
  const atom = (type: string, payload: Buffer): Buffer => {
    const result = Buffer.alloc(payload.byteLength + 8);
    result.writeUInt32BE(result.byteLength, 0);
    result.write(type, 4);
    payload.copy(result, 8);
    return result;
  };
  const ftyp = atom('ftyp', Buffer.from('isom\0\0\0\0isommp41'));
  const movieHeader = fullBox(100);
  movieHeader.writeUInt32BE(1000, 12);
  movieHeader.writeUInt32BE(videoSeconds * 1000, 16);

  const handler = (kind: 'vide' | 'soun'): Buffer => {
    const payload = fullBox(25);
    payload.write(kind, 8);
    return atom('hdlr', payload);
  };
  const mediaHeader = (timescale: number, duration: number): Buffer => {
    const payload = fullBox(24);
    payload.writeUInt32BE(timescale, 12);
    payload.writeUInt32BE(duration, 16);
    return atom('mdhd', payload);
  };
  const trackHeader = (trackId: number, duration: number): Buffer => {
    const payload = fullBox(84);
    payload.writeUInt32BE(trackId, 12);
    payload.writeUInt32BE(duration, 20);
    return atom('tkhd', payload);
  };

  const videoSampleEntry = fullBox(78);
  videoSampleEntry.writeUInt16BE(1, 6);
  videoSampleEntry.writeUInt16BE(320, 24);
  videoSampleEntry.writeUInt16BE(240, 26);
  videoSampleEntry.writeUInt16BE(24, 74);
  const videoSampleDescription = atom(
    'stsd',
    Buffer.concat([fullBox(4), Buffer.from([0, 0, 0, 1]), atom('avc1', videoSampleEntry)]),
  );
  const audioSampleDescription = fullBox(28);
  audioSampleDescription.writeUInt16BE(1, 6);
  audioSampleDescription.writeUInt16BE(2, 16);
  audioSampleDescription.writeUInt16BE(16, 18);
  audioSampleDescription.writeUInt32BE(44_100 * 65_536, 24);
  const sampleDescription = atom(
    'stsd',
    Buffer.concat([fullBox(4), Buffer.from([0, 0, 0, 1]), atom('mp4a', audioSampleDescription)]),
  );
  const sampleTables = (
    durations: readonly [number, number],
    chunkOffset: number,
    compositionOffsets?: readonly [number, number],
  ): Buffer => {
    const timeToSample = fullBox(24);
    timeToSample.writeUInt32BE(2, 4);
    timeToSample.writeUInt32BE(1, 8);
    timeToSample.writeUInt32BE(durations[0], 12);
    timeToSample.writeUInt32BE(1, 16);
    timeToSample.writeUInt32BE(durations[1], 20);

    const sampleToChunk = fullBox(20);
    sampleToChunk.writeUInt32BE(1, 4);
    sampleToChunk.writeUInt32BE(1, 8);
    sampleToChunk.writeUInt32BE(2, 12);
    sampleToChunk.writeUInt32BE(1, 16);

    const sampleSizes = fullBox(20);
    sampleSizes.writeUInt32BE(2, 8);
    sampleSizes.writeUInt32BE(1, 12);
    sampleSizes.writeUInt32BE(1, 16);

    const chunkOffsets = fullBox(12);
    chunkOffsets.writeUInt32BE(1, 4);
    chunkOffsets.writeUInt32BE(chunkOffset, 8);
    const compositionTable = compositionOffsets
      ? (() => {
          const compositionTimes = fullBox(24);
          compositionTimes.writeUInt32BE(2, 4);
          compositionTimes.writeUInt32BE(1, 8);
          compositionTimes.writeUInt32BE(compositionOffsets[0], 12);
          compositionTimes.writeUInt32BE(1, 16);
          compositionTimes.writeUInt32BE(compositionOffsets[1], 20);
          return atom('ctts', compositionTimes);
        })()
      : undefined;
    return Buffer.concat([
      atom('stts', timeToSample),
      ...(compositionTable ? [compositionTable] : []),
      atom('stsc', sampleToChunk),
      atom('stsz', sampleSizes),
      atom('stco', chunkOffsets),
    ]);
  };

  const makeVideoTrack = (chunkOffset: number): Buffer => {
    const editList = videoEditDurationSeconds
      ? (() => {
          const edit = fullBox(20);
          edit.writeUInt32BE(1, 4);
          edit.writeUInt32BE(videoEditDurationSeconds * 1000, 8);
          edit.writeUInt32BE(0, 12);
          edit.writeUInt16BE(1, 16);
          return atom('edts', atom('elst', edit));
        })()
      : undefined;
    return atom(
      'trak',
      Buffer.concat([
        trackHeader(1, videoSeconds * 1000),
        ...(editList ? [editList] : []),
        atom(
          'mdia',
          Buffer.concat([
            mediaHeader(1000, videoSeconds * 1000),
            handler('vide'),
            atom(
              'minf',
              atom(
                'stbl',
                Buffer.concat([
                  videoSampleDescription,
                  sampleTables(
                    [videoSampleDurationsSeconds[0] * 1000, videoSampleDurationsSeconds[1] * 1000],
                    chunkOffset,
                    videoCompositionOffsetsSeconds?.map((duration) => duration * 1000) as
                      readonly [number, number] | undefined,
                  ),
                ]),
              ),
            ),
          ]),
        ),
      ]),
    );
  };

  const makeAudioTrack = (chunkOffset: number): Buffer =>
    atom(
      'trak',
      Buffer.concat([
        trackHeader(2, audioSeconds * 1000),
        atom(
          'mdia',
          Buffer.concat([
            mediaHeader(44_100, audioSeconds * 44_100),
            handler('soun'),
            atom(
              'minf',
              atom(
                'stbl',
                Buffer.concat([
                  sampleDescription,
                  sampleTables(
                    [(audioSeconds * 44_100) / 2, (audioSeconds * 44_100) / 2],
                    chunkOffset,
                  ),
                ]),
              ),
            ),
          ]),
        ),
      ]),
    );

  const makeMovie = (videoOffset: number, audioOffset: number): Buffer =>
    atom(
      'moov',
      Buffer.concat([
        atom('mvhd', movieHeader),
        ...(includeVideo ? [makeVideoTrack(videoOffset)] : []),
        makeAudioTrack(audioOffset),
        ...(fragmented ? [atom('mvex', Buffer.alloc(0))] : []),
      ]),
    );

  const firstMovie = makeMovie(0, 0);
  const mdatStart = ftyp.byteLength + firstMovie.byteLength + 8;
  const movie = makeMovie(mdatStart, mdatStart + 2);
  return Buffer.concat([ftyp, movie, atom('mdat', Buffer.from([0, 0, 0, 0]))]);
}
