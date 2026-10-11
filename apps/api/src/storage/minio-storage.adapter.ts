// cspell:ignore unhoistable
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';

import {
  buildSourceObjectKey,
  StorageNotFoundError,
  StorageResponseError,
  type StorageObjectReference,
  type PresignedPutResult,
  type StorageObjectMetadata,
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
  private readonly signingClient: S3Client;

  constructor(
    private readonly config: MinioStorageConfig,
    client?: StorageCommandClient,
  ) {
    this.signingClient = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.client = client ?? this.signingClient;
  }

  async createPresignedPut(
    input: StorageObjectReference & {
      contentType: string;
      contentLength: number;
      checksumSha256: string;
      expiresInSeconds: number;
    },
  ): Promise<PresignedPutResult> {
    const key = buildSourceObjectKey(input);
    if (
      !Number.isFinite(input.expiresInSeconds) ||
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds <= 0
    ) {
      throw new RangeError('expiresInSeconds must be a positive finite integer');
    }
    if (
      !Number.isFinite(input.contentLength) ||
      !Number.isSafeInteger(input.contentLength) ||
      input.contentLength <= 0
    ) {
      throw new RangeError('contentLength must be a positive finite integer');
    }
    if (typeof input.contentType !== 'string' || input.contentType.trim().length === 0) {
      throw new TypeError('contentType must be a non-empty string');
    }
    if (
      typeof input.checksumSha256 !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(input.checksumSha256) ||
      Buffer.from(input.checksumSha256, 'base64').toString('base64') !== input.checksumSha256
    ) {
      throw new TypeError('checksumSha256 must be canonical base64 for 32 bytes');
    }

    const expiresIn = Math.min(input.expiresInSeconds, 900);
    const url = await getSignedUrl(
      this.signingClient,
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        ChecksumSHA256: input.checksumSha256,
      }),
      {
        expiresIn,
        unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
      },
    );

    return {
      url,
      headers: {
        'content-type': input.contentType,
        'x-amz-checksum-sha256': input.checksumSha256,
      },
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  async headObject(reference: StorageObjectReference): Promise<StorageObjectMetadata> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: buildSourceObjectKey(reference),
          ChecksumMode: 'ENABLED',
        }),
      );

      return {
        ...(response.ContentLength === undefined ? {} : { contentLength: response.ContentLength }),
        ...(response.ContentType === undefined ? {} : { contentType: response.ContentType }),
        ...(response.ChecksumSHA256 === undefined
          ? {}
          : { checksumSha256: response.ChecksumSHA256 }),
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new StorageNotFoundError(reference);
      }

      throw error;
    }
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
