export const MAX_SOURCE_SIZE_BYTES = 1_073_741_824;
export const MAX_MEDIA_DURATION_SECONDS = 60 * 60;
export const DEFAULT_TITLE_MAX_LENGTH = 120;
export const DEFAULT_BODY_MAX_LENGTH = 5_000;
export const DEFAULT_MAX_TAGS = 20;
export const DEFAULT_TAG_MAX_LENGTH = 30;

export type SourceFormat = 'mp4' | 'mp3' | 'wav' | 'txt';

export interface SourceFileInput {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly durationSeconds?: number;
}

export interface ValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type ValidationResult =
  { readonly valid: true } | { readonly valid: false; readonly errors: readonly ValidationIssue[] };

export class DomainValidationError extends Error {
  readonly code = 'VALIDATION_FAILED';

  constructor(readonly errors: readonly ValidationIssue[]) {
    super('Source file validation failed');
    this.name = 'DomainValidationError';
  }
}

const MIME_FORMATS: Readonly<Record<string, SourceFormat>> = {
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'text/plain': 'txt',
};

const extensionOf = (fileName: string): string => {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return extension ?? '';
};

const invalid = (...errors: ValidationIssue[]): ValidationResult => ({
  valid: false,
  errors,
});

export function validateSourceFile(input: SourceFileInput): ValidationResult {
  const errors: ValidationIssue[] = [];
  const extension = extensionOf(input.fileName);
  const format = MIME_FORMATS[input.mimeType.toLowerCase()];

  if (!format || extension !== format) {
    errors.push({
      code: 'UNSUPPORTED_FILE_TYPE',
      field: 'fileName',
      message: 'Only matching MP4, MP3, WAV, and TXT files are supported.',
    });
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    errors.push({
      code: 'EMPTY_FILE',
      field: 'sizeBytes',
      message: 'The source file must not be empty.',
    });
  } else if (input.sizeBytes > MAX_SOURCE_SIZE_BYTES) {
    errors.push({
      code: 'FILE_TOO_LARGE',
      field: 'sizeBytes',
      message: 'The source file must not exceed 1 GB.',
    });
  }

  if (
    format !== 'txt' &&
    input.durationSeconds !== undefined &&
    (!Number.isFinite(input.durationSeconds) ||
      input.durationSeconds < 0 ||
      input.durationSeconds > MAX_MEDIA_DURATION_SECONDS)
  ) {
    errors.push({
      code: 'MEDIA_TOO_LONG',
      field: 'durationSeconds',
      message: 'Audio and video sources must not exceed 60 minutes.',
    });
  }

  return errors.length === 0 ? { valid: true } : invalid(...errors);
}

export function assertValidSourceFile(input: SourceFileInput): void {
  const result = validateSourceFile(input);

  if (!result.valid) {
    throw new DomainValidationError(result.errors);
  }
}

export function validateText(
  value: string,
  field = 'text',
  maxLength = DEFAULT_BODY_MAX_LENGTH,
): ValidationResult {
  if (!value.trim()) {
    return invalid({
      code: 'REQUIRED',
      field,
      message: `${field} must not be empty.`,
    });
  }

  if (value.length > maxLength) {
    return invalid({
      code: 'TEXT_TOO_LONG',
      field,
      message: `${field} must not exceed ${maxLength} characters.`,
    });
  }

  return { valid: true };
}

export function validateTitle(
  value: string,
  maxLength = DEFAULT_TITLE_MAX_LENGTH,
): ValidationResult {
  return validateText(value, 'title', maxLength);
}

export function validateBody(value: string, maxLength = DEFAULT_BODY_MAX_LENGTH): ValidationResult {
  return validateText(value, 'body', maxLength);
}

export function validateTags(
  tags: readonly string[],
  maxTags = DEFAULT_MAX_TAGS,
  maxTagLength = DEFAULT_TAG_MAX_LENGTH,
): ValidationResult {
  if (tags.length === 0) {
    return invalid({
      code: 'REQUIRED',
      field: 'tags',
      message: 'At least one tag is required.',
    });
  }

  if (tags.length > maxTags) {
    return invalid({
      code: 'TOO_MANY_TAGS',
      field: 'tags',
      message: `No more than ${maxTags} tags are allowed.`,
    });
  }

  const invalidTag = tags.find((tag) => !tag.trim() || tag.length > maxTagLength);
  return invalidTag === undefined
    ? { valid: true }
    : invalid({
        code: 'INVALID_TAG',
        field: 'tags',
        message: `Each tag must be 1-${maxTagLength} characters.`,
      });
}
