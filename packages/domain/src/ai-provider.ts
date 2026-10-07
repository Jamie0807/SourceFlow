export const AI_MEDIA_FORMATS = ['mp3', 'wav', 'ogg', 'mp4'] as const;
export type AiMediaFormat = (typeof AI_MEDIA_FORMATS)[number];

export type ProviderFailureKind =
  | 'authentication'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_input'
  | 'remote_failure'
  | 'cancelled'
  | 'unknown';

const safeMessages: Record<ProviderFailureKind, string> = {
  authentication: 'AI Provider authentication failed',
  rate_limited: 'AI Provider rate limited',
  timeout: 'AI Provider timed out',
  invalid_input: 'AI Provider rejected the input',
  remote_failure: 'AI Provider is temporarily unavailable',
  cancelled: 'AI Provider request cancelled',
  unknown: 'AI Provider failed',
};

export class AiProviderError extends Error {
  readonly kind: ProviderFailureKind;
  readonly retryable: boolean;

  constructor(kind: ProviderFailureKind, retryable: boolean, upstreamReason?: unknown) {
    void upstreamReason;
    super(safeMessages[kind]);
    this.name = 'AiProviderError';
    this.kind = kind;
    this.retryable = retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type TranscriptionInput = Readonly<{
  mediaUrl: string;
  mediaFormat: AiMediaFormat;
}>;

export type TranscriptionUtterance = Readonly<{
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
}>;

export type TranscriptionResult = Readonly<{
  provider: 'mock' | 'volcengine';
  model: string;
  transcript: string;
  utterances: readonly TranscriptionUtterance[];
  requestId?: string;
}>;

export type TextAnalysisInput = Readonly<{ transcript: string }>;

export type TextAnalysisChapter = Readonly<{ title: string; summary: string }>;
export type CandidateClip = Readonly<{ startMs: number; endMs: number; reason: string }>;

export type TextAnalysisResult = Readonly<{
  provider: 'mock' | 'volcengine';
  model: string;
  chapters: readonly TextAnalysisChapter[];
  keyPoints: readonly string[];
  quotes: readonly string[];
  candidateClips: readonly CandidateClip[];
  riskFlags: readonly string[];
  requestId?: string;
}>;

export interface AiProvider {
  transcribe(input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult>;
  analyze(input: TextAnalysisInput, signal?: AbortSignal): Promise<TextAnalysisResult>;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const requireRecord = (value: unknown, label: string): UnknownRecord => {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a JSON-safe object`);
  }

  return value;
};

const requireNonEmptyString = (value: unknown, label: string): string => {
  if (!nonEmptyString(value)) {
    throw new TypeError(`${label} must be non-empty`);
  }

  return value;
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return requireNonEmptyString(value, label);
};

const requireProvider = (value: unknown): 'mock' | 'volcengine' => {
  if (value !== 'mock' && value !== 'volcengine') {
    throw new TypeError('provider must be mock or volcengine');
  }

  return value;
};

const requireTimeRange = (
  value: unknown,
  label: string,
  previousEndMs: number,
): Readonly<{ startMs: number; endMs: number }> => {
  const range = requireRecord(value, label);
  const { startMs, endMs } = range;
  if (
    typeof startMs !== 'number' ||
    typeof endMs !== 'number' ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs ||
    startMs < previousEndMs
  ) {
    throw new TypeError(`${label} must have non-negative increasing time ranges`);
  }

  return Object.freeze({ startMs, endMs });
};

const requireStringList = (value: unknown, label: string): readonly string[] => {
  if (!Array.isArray(value) || !value.every(nonEmptyString)) {
    throw new TypeError(`${label} must be a JSON-safe string array`);
  }

  return Object.freeze([...value]);
};

export const isHttpsMediaUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
};

export function createTranscriptionInput(input: TranscriptionInput): TranscriptionInput {
  if (!isHttpsMediaUrl(input.mediaUrl)) {
    throw new TypeError('mediaUrl must be a credential-free HTTPS URL');
  }

  if (!AI_MEDIA_FORMATS.includes(input.mediaFormat)) {
    throw new TypeError('mediaFormat must be supported');
  }

  return Object.freeze({ mediaUrl: input.mediaUrl, mediaFormat: input.mediaFormat });
}

export function createTextAnalysisInput(input: TextAnalysisInput): TextAnalysisInput {
  return Object.freeze({ transcript: requireNonEmptyString(input.transcript, 'transcript') });
}

export function createTranscriptionResult(input: unknown): TranscriptionResult {
  const value = requireRecord(input, 'transcription result');
  const { provider, model, transcript, utterances, requestId } = value;
  if (!Array.isArray(utterances)) {
    throw new TypeError('utterances must be a JSON-safe array');
  }

  let previousEndMs = 0;
  const normalizedUtterances = utterances.map((utterance) => {
    const range = requireTimeRange(utterance, 'utterances', previousEndMs);
    previousEndMs = range.endMs;
    const utteranceRecord = requireRecord(utterance, 'utterances');
    const text = requireNonEmptyString(utteranceRecord.text, 'utterances text');
    const speaker = optionalString(utteranceRecord.speaker, 'utterances speaker');
    return Object.freeze(speaker === undefined ? { ...range, text } : { ...range, text, speaker });
  });

  const normalizedRequestId = optionalString(requestId, 'requestId');
  return Object.freeze(
    normalizedRequestId === undefined
      ? {
          provider: requireProvider(provider),
          model: requireNonEmptyString(model, 'model'),
          transcript: requireNonEmptyString(transcript, 'transcript'),
          utterances: Object.freeze(normalizedUtterances),
        }
      : {
          provider: requireProvider(provider),
          model: requireNonEmptyString(model, 'model'),
          transcript: requireNonEmptyString(transcript, 'transcript'),
          utterances: Object.freeze(normalizedUtterances),
          requestId: normalizedRequestId,
        },
  );
}

export function createTextAnalysisResult(input: unknown): TextAnalysisResult {
  const value = requireRecord(input, 'text analysis result');
  const { provider, model, chapters, keyPoints, quotes, candidateClips, riskFlags, requestId } =
    value;
  if (!Array.isArray(chapters)) {
    throw new TypeError('chapters must be a JSON-safe array');
  }
  if (!Array.isArray(candidateClips)) {
    throw new TypeError('candidateClips must be a JSON-safe array');
  }

  const normalizedChapters = chapters.map((chapter) => {
    const chapterRecord = requireRecord(chapter, 'chapters');
    return Object.freeze({
      title: requireNonEmptyString(chapterRecord.title, 'chapters title'),
      summary: requireNonEmptyString(chapterRecord.summary, 'chapters summary'),
    });
  });

  let previousEndMs = 0;
  const normalizedClips = candidateClips.map((clip) => {
    const range = requireTimeRange(clip, 'candidateClips', previousEndMs);
    previousEndMs = range.endMs;
    const clipRecord = requireRecord(clip, 'candidateClips');
    return Object.freeze({
      ...range,
      reason: requireNonEmptyString(clipRecord.reason, 'candidateClips reason'),
    });
  });

  const normalizedRequestId = optionalString(requestId, 'requestId');
  return Object.freeze(
    normalizedRequestId === undefined
      ? {
          provider: requireProvider(provider),
          model: requireNonEmptyString(model, 'model'),
          chapters: Object.freeze(normalizedChapters),
          keyPoints: requireStringList(keyPoints, 'keyPoints'),
          quotes: requireStringList(quotes, 'quotes'),
          candidateClips: Object.freeze(normalizedClips),
          riskFlags: requireStringList(riskFlags, 'riskFlags'),
        }
      : {
          provider: requireProvider(provider),
          model: requireNonEmptyString(model, 'model'),
          chapters: Object.freeze(normalizedChapters),
          keyPoints: requireStringList(keyPoints, 'keyPoints'),
          quotes: requireStringList(quotes, 'quotes'),
          candidateClips: Object.freeze(normalizedClips),
          riskFlags: requireStringList(riskFlags, 'riskFlags'),
          requestId: normalizedRequestId,
        },
  );
}
