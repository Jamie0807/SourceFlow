import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

import {
  buildSourceObjectKey,
  StorageNotFoundError,
  StorageResponseError,
  type StorageObjectReference,
  type StoragePort,
  type StoragePutObjectInput,
  type StoredObject,
} from './storage.port.js';

export interface MinioStorageConfig {
  readonly bucket: string;
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly forcePathStyle?: boolean;
}

export type StorageCommandClient = Pick<S3Client, 'send'>;

export class MinioStorageAdapter implements StoragePort {
  private readonly client: StorageCommandClient;

  constructor(
    private readonly config: MinioStorageConfig,
    client?: StorageCommandClient,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle ?? true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
  }

  async putObject(input: StoragePutObjectInput): Promise<void> {
    const commandInput = {
      Bucket: this.config.bucket,
      Key: buildSourceObjectKey(input),
      Body: input.body,
      ContentType: input.contentType,
      ...(input.contentLength === undefined ? {} : { ContentLength: input.contentLength }),
    };

    await this.client.send(new PutObjectCommand(commandInput));
  }

  async getObject(reference: StorageObjectReference): Promise<StoredObject> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: buildSourceObjectKey(reference),
        }),
      );

      if (!response.Body) {
        throw new StorageResponseError('Storage provider returned an empty object body');
      }

      return {
        body: toNodeReadable(response.Body),
        ...(response.ContentLength === undefined ? {} : { contentLength: response.ContentLength }),
        ...(response.ContentType === undefined ? {} : { contentType: response.ContentType }),
        ...(response.ETag === undefined ? {} : { etag: response.ETag }),
      };
    } catch (error) {
      if (error instanceof StorageNotFoundError || isNotFoundError(error)) {
        if (error instanceof StorageNotFoundError) {
          throw error;
        }

        throw new StorageNotFoundError(reference);
      }

      throw error;
    }
  }

  async deleteObject(reference: StorageObjectReference): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: buildSourceObjectKey(reference),
      }),
    );
  }
}

function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const responseError = error as Error & {
    readonly Code?: string;
  };

  return (
    responseError.name === 'NoSuchKey' ||
    responseError.name === 'NotFound' ||
    responseError.name === 'NoSuchObject' ||
    responseError.Code === 'NoSuchKey' ||
    responseError.Code === 'NotFound' ||
    responseError.Code === 'NoSuchObject'
  );
}

function toNodeReadable(body: unknown): Readable {
  if (body instanceof Readable) {
    return body;
  }

  if (body instanceof ReadableStream) {
    return Readable.fromWeb(body);
  }

  if (isAsyncIterable(body)) {
    return Readable.from(body);
  }

  throw new StorageResponseError('Storage provider returned an unsupported object body stream');
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}
