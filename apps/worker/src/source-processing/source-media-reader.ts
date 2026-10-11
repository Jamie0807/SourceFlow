import type { Readable } from 'node:stream';

export type SourceMediaObject = Readonly<{
  body: Readable;
  contentLength?: number;
  contentType?: string;
  checksumSha256?: string;
}>;

export interface SourceMediaReader {
  getObject(input: { workspaceId: string; sourceId: string }): Promise<SourceMediaObject>;
}

export class SourceMediaReadError extends Error {
  readonly code = 'SOURCE_MEDIA_UNAVAILABLE';

  constructor() {
    super('Source media is unavailable');
    this.name = 'SourceMediaReadError';
  }
}
