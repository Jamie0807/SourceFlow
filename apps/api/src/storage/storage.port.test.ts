import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { buildSourceObjectKey, StorageNotFoundError, type StoragePort } from './storage.port.js';

describe('storage port', () => {
  it('builds an object key scoped by workspace and source', () => {
    expect(buildSourceObjectKey({ workspaceId: 'workspace-1', sourceId: 'source-1' })).toBe(
      'workspaces/workspace-1/sources/source-1/original',
    );
  });

  it('allows an OSS implementation to satisfy the provider-agnostic contract', async () => {
    const storedKeys: string[] = [];
    const ossLikeStorage: StoragePort = {
      async putObject(input) {
        storedKeys.push(buildSourceObjectKey(input));
      },
      async getObject() {
        return {
          body: Readable.from(new Uint8Array([1, 2, 3])),
          contentType: 'application/octet-stream',
        };
      },
      async deleteObject() {
        return undefined;
      },
    };

    await ossLikeStorage.putObject({
      workspaceId: 'workspace-1',
      sourceId: 'source-1',
      body: new Uint8Array([1, 2, 3]),
      contentType: 'application/octet-stream',
    });

    expect(storedKeys).toEqual(['workspaces/workspace-1/sources/source-1/original']);
  });

  it.each(['', '.', '..', '../source', 'workspace/source', ' space', '中文'])(
    'rejects unsafe storage identifier %s',
    (unsafeIdentifier) => {
      expect(() =>
        buildSourceObjectKey({ workspaceId: unsafeIdentifier, sourceId: 'source-1' }),
      ).toThrowError(/safe storage identifier/i);
    },
  );

  it('exposes a provider-agnostic not-found error for all adapters', () => {
    expect(
      new StorageNotFoundError({ workspaceId: 'workspace-1', sourceId: 'source-1' }),
    ).toBeInstanceOf(Error);
  });

  it('lets an OSS implementation use the same not-found error semantics', async () => {
    const ossLikeStorage: StoragePort = {
      async putObject() {
        return undefined;
      },
      async getObject(reference) {
        throw new StorageNotFoundError(reference);
      },
      async deleteObject() {
        return undefined;
      },
    };

    await expect(
      ossLikeStorage.getObject({ workspaceId: 'workspace-1', sourceId: 'source-1' }),
    ).rejects.toBeInstanceOf(StorageNotFoundError);
  });
});
