import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { MinioSourceMediaReader } from './minio-source-media-reader.js';

describe('MinioSourceMediaReader', () => {
  const config = {
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    bucket: 'sourceflow-local',
    accessKeyId: 'test-access-key',
    secretAccessKey: 'test-secret-key',
  };

  it('reads an object using the workspace-scoped key and returns streaming metadata', async () => {
    const body = Readable.from([Buffer.from('content')]);
    const send = vi.fn().mockResolvedValue({
      Body: body,
      ContentLength: 7,
      ContentType: 'text/plain',
      ChecksumSHA256: 'checksum',
    });
    const reader = new MinioSourceMediaReader(config, { send } as unknown as S3Client);

    const object = await reader.getObject({ workspaceId: 'workspace-a', sourceId: 'source-1' });

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect((send.mock.calls[0]?.[0] as GetObjectCommand).input).toEqual({
      Bucket: 'sourceflow-local',
      Key: 'workspaces/workspace-a/sources/source-1/original',
    });
    expect(object).toEqual({
      body,
      contentLength: 7,
      contentType: 'text/plain',
      checksumSha256: 'checksum',
    });
  });

  it('rejects unsafe identifiers before issuing a storage request', async () => {
    const send = vi.fn();
    const reader = new MinioSourceMediaReader(config, { send } as unknown as S3Client);

    await expect(
      reader.getObject({ workspaceId: '../other', sourceId: 'source-1' }),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('fails safely when the object response has no body', async () => {
    const reader = new MinioSourceMediaReader(config, {
      send: vi.fn().mockResolvedValue({ Body: undefined }),
    } as unknown as S3Client);

    await expect(
      reader.getObject({ workspaceId: 'workspace-a', sourceId: 'source-1' }),
    ).rejects.toMatchObject({ code: 'SOURCE_MEDIA_UNAVAILABLE' });
  });
});
