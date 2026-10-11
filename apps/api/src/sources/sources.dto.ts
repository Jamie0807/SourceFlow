export type CreateSourceDto = Readonly<{
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
}>;

export function parseCreateSourceDto(value: unknown): CreateSourceDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Source input must be an object');
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.fileName !== 'string' ||
    typeof candidate.mimeType !== 'string' ||
    typeof candidate.sizeBytes !== 'number' ||
    typeof candidate.contentHash !== 'string'
  ) {
    throw new TypeError('Source metadata is incomplete');
  }

  return {
    fileName: candidate.fileName,
    mimeType: candidate.mimeType,
    sizeBytes: candidate.sizeBytes,
    contentHash: candidate.contentHash,
  };
}
