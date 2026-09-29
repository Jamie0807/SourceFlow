import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
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
