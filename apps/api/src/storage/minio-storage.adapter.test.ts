// cspell:ignore AQID
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { MinioStorageAdapter, type StorageCommandClient } from './minio-storage.adapter.js';
import { StorageNotFoundError, StorageResponseError } from './storage.port.js';

function createAdapter(send: StorageCommandClient['send']) {
  return new MinioStorageAdapter(
    {
      bucket: 'sourceflow-local',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'sourceflow-local',
      secretAccessKey: 'sourceflow-local-secret',
    },
    { send } as StorageCommandClient,
  );
}

describe('MinioStorageAdapter', () => {
  const validChecksumSha256 = Buffer.alloc(32, 1).toString('base64');
  const validUpload = {
    workspaceId: 'workspace-1',
    sourceId: 'source-1',
    contentType: 'application/x-sourceflow-test',
    contentLength: 32,
    checksumSha256: validChecksumSha256,
    expiresInSeconds: 120,
  };

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid PUT expiry %s before signing',
    async (expiresInSeconds) => {
      await expect(
        createAdapter(vi.fn()).createPresignedPut({ ...validUpload, expiresInSeconds }),
      ).rejects.toThrow('expiresInSeconds must be a positive finite integer');
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid PUT content length %s before signing',
    async (contentLength) => {
      await expect(
        createAdapter(vi.fn()).createPresignedPut({ ...validUpload, contentLength }),
      ).rejects.toThrow('contentLength must be a positive finite integer');
    },
  );

  it.each(['', '   '])('rejects empty PUT content type before signing', async (contentType) => {
    await expect(
      createAdapter(vi.fn()).createPresignedPut({ ...validUpload, contentType }),
    ).rejects.toThrow('contentType must be a non-empty string');
  });

  it.each([
    '',
    'AQID',
    validChecksumSha256.slice(0, -1),
    `${validChecksumSha256.slice(0, -2)}B=`,
    ` ${validChecksumSha256}`,
  ])('rejects a non-canonical or non-SHA-256 checksum before signing', async (checksumSha256) => {
    await expect(
      createAdapter(vi.fn()).createPresignedPut({ ...validUpload, checksumSha256 }),
    ).rejects.toThrow('checksumSha256 must be canonical base64 for 32 bytes');
  });

  it.each([
    { workspaceId: '../bad', sourceId: 'source-1' },
    { workspaceId: 'workspace-1', sourceId: '../bad' },
  ])('rejects unsafe IDs before signing', async (reference) => {
    const adapter = createAdapter(vi.fn());
    await expect(
      adapter.createPresignedPut({
        ...reference,
        contentType: 'audio/mpeg',
        contentLength: 3,
        checksumSha256: 'AQID',
        expiresInSeconds: 120,
      }),
    ).rejects.toThrow(/safe storage identifier/i);
  });

  it('signs checksum header and returns PUT headers with a bounded lifetime', async () => {
    const adapter = new MinioStorageAdapter({
      bucket: 'sourceflow-local',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      accessKeyId: 'local',
      secretAccessKey: 'local-secret',
    });
    const result = await adapter.createPresignedPut({
      workspaceId: 'workspace-1',
      sourceId: 'source-1',
      contentType: validUpload.contentType,
      contentLength: validUpload.contentLength,
      checksumSha256: validChecksumSha256,
      expiresInSeconds: 3600,
    });
    const url = new URL(result.url);
    expect(url.pathname).toBe('/sourceflow-local/workspaces/workspace-1/sources/source-1/original');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain('x-amz-checksum-sha256');
    expect(url.searchParams.has('x-amz-checksum-sha256')).toBe(false);
    expect(result.headers).toMatchObject({
      'content-type': validUpload.contentType,
      'x-amz-checksum-sha256': validChecksumSha256,
    });
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('maps HeadObject metadata without treating ETag as checksum', async () => {
    const send = vi.fn().mockResolvedValue({
      ContentLength: 3,
      ContentType: 'audio/mpeg',
      ChecksumSHA256: 'AQID',
      ETag: '"etag"',
    });
    const result = await createAdapter(send).headObject({
      workspaceId: 'workspace-1',
      sourceId: 'source-1',
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    expect((send.mock.calls[0]?.[0] as HeadObjectCommand).input).toMatchObject({
      Bucket: 'sourceflow-local',
      Key: 'workspaces/workspace-1/sources/source-1/original',
      ChecksumMode: 'ENABLED',
    });
    expect(result).toEqual({ contentLength: 3, contentType: 'audio/mpeg', checksumSha256: 'AQID' });
  });

  it('leaves absent HeadObject checksum undefined', async () => {
    const result = await createAdapter(vi.fn().mockResolvedValue({ ETag: '"etag"' })).headObject({
      workspaceId: 'workspace-1',
      sourceId: 'source-1',
    });
    expect(result.checksumSha256).toBeUndefined();
  });

  it('maps missing HeadObject to StorageNotFoundError', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('missing'), { name: 'NotFound' }));
    await expect(
      createAdapter(send).headObject({ workspaceId: 'workspace-1', sourceId: 'source-1' }),
    ).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('uploads content under a workspace-scoped source key', async () => {
    const send = vi.fn().mockResolvedValue({});
    const adapter = createAdapter(send);

    await adapter.putObject({
      workspaceId: 'workspace-1',
      sourceId: 'source-1',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'audio/mpeg',
      contentLength: 3,
    });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toMatchObject({
      Bucket: 'sourceflow-local',
      Key: 'workspaces/workspace-1/sources/source-1/original',
      ContentType: 'audio/mpeg',
      ContentLength: 3,
    });
  });

  it('downloads content and preserves object metadata', async () => {
    const body = Readable.from(['hello']);
    const send = vi.fn().mockResolvedValue({
      Body: body,
      ContentLength: 5,
      ContentType: 'text/plain',
      ETag: '"etag-1"',
    });
    const adapter = createAdapter(send);

    const result = await adapter.getObject({ workspaceId: 'workspace-1', sourceId: 'source-1' });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input).toMatchObject({
      Bucket: 'sourceflow-local',
      Key: 'workspaces/workspace-1/sources/source-1/original',
    });
    expect(result).toMatchObject({
      body,
      contentLength: 5,
      contentType: 'text/plain',
      etag: '"etag-1"',
    });
  });

  it('deletes content under the same workspace-scoped source key', async () => {
    const send = vi.fn().mockResolvedValue({});
    const adapter = createAdapter(send);

    await adapter.deleteObject({ workspaceId: 'workspace-1', sourceId: 'source-1' });

    const command = send.mock.calls[0]?.[0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toMatchObject({
      Bucket: 'sourceflow-local',
      Key: 'workspaces/workspace-1/sources/source-1/original',
    });
  });

  it('maps a missing object to a provider-agnostic not-found error', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));
    const adapter = createAdapter(send);

    await expect(
      adapter.getObject({ workspaceId: 'workspace-1', sourceId: 'source-1' }),
    ).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('does not map a missing bucket to an object not-found error', async () => {
    const send = vi.fn().mockRejectedValue(
      Object.assign(new Error('bucket missing'), {
        name: 'NoSuchBucket',
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const adapter = createAdapter(send);

    await expect(
      adapter.getObject({ workspaceId: 'workspace-1', sourceId: 'source-1' }),
    ).rejects.toMatchObject({ name: 'NoSuchBucket' });
  });

  it('rejects an empty provider body as a response error', async () => {
    const send = vi.fn().mockResolvedValue({});
    const adapter = createAdapter(send);

    await expect(
      adapter.getObject({ workspaceId: 'workspace-1', sourceId: 'source-1' }),
    ).rejects.toBeInstanceOf(StorageResponseError);
  });

  it('passes through provider errors that are not object-not-found', async () => {
    const providerError = new Error('connection refused');
    const send = vi.fn().mockRejectedValue(providerError);
    const adapter = createAdapter(send);

    await expect(
      adapter.getObject({ workspaceId: 'workspace-1', sourceId: 'source-1' }),
    ).rejects.toBe(providerError);
  });
});
