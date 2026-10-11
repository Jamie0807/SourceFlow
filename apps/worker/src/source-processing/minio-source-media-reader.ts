import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

import type { SourceMediaObject, SourceMediaReader } from './source-media-reader.js';
import { SourceMediaReadError } from './source-media-reader.js';

export type SourceMediaS3Client = Pick<S3Client, 'send'>;

export type MinioSourceMediaReaderConfig = Readonly<{
  bucket: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}>;

export class MinioSourceMediaReader implements SourceMediaReader {
  private readonly client: SourceMediaS3Client;

  constructor(
    private readonly config: MinioSourceMediaReaderConfig,
    client?: SourceMediaS3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: this.config.endpoint,
        region: this.config.region,
        forcePathStyle: this.config.forcePathStyle ?? true,
        credentials: {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
        },
      });
  }

  async getObject(input: { workspaceId: string; sourceId: string }): Promise<SourceMediaObject> {
    const key = buildSourceObjectKey(input.workspaceId, input.sourceId);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      );
      const body = toNodeReadable(response.Body);
      return {
        body,
        ...(response.ContentLength === undefined ? {} : { contentLength: response.ContentLength }),
        ...(response.ContentType === undefined ? {} : { contentType: response.ContentType }),
        ...(response.ChecksumSHA256 === undefined
          ? {}
          : { checksumSha256: response.ChecksumSHA256 }),
      };
    } catch {
      throw new SourceMediaReadError();
    }
  }
}

export function buildSourceObjectKey(workspaceId: string, sourceId: string): string {
  assertStorageIdentifier(workspaceId, 'workspaceId');
  assertStorageIdentifier(sourceId, 'sourceId');
  return `workspaces/${workspaceId}/sources/${sourceId}/original`;
}

function assertStorageIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)) {
    throw new TypeError(`${field} must be a safe storage identifier`);
  }
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) return body;
  if (body instanceof ReadableStream) return Readable.fromWeb(body);
  if (isAsyncIterable(body)) return Readable.from(body);
  throw new SourceMediaReadError();
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}
