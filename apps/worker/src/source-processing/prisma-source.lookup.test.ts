import { describe, expect, it, vi } from 'vitest';

import { PrismaSourceLookup, type PrismaSourceClient } from './prisma-source.lookup.js';

describe('PrismaSourceLookup', () => {
  it('looks up a non-deleted source within the requested workspace', async () => {
    const source = {
      id: 'source-1',
      workspaceId: 'workspace-a',
      status: 'uploaded' as const,
      storageKey: 'sources/source-1.mp4',
      contentHash: 'hash-1',
    };
    const findFirst = vi.fn().mockResolvedValue(source);
    const lookup = new PrismaSourceLookup({
      source: { findFirst },
    } as unknown as PrismaSourceClient);

    await expect(lookup.findById('workspace-a', 'source-1')).resolves.toEqual(source);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'source-1', workspaceId: 'workspace-a', deletedAt: null },
      select: { id: true, workspaceId: true, status: true, storageKey: true, contentHash: true },
    });
  });

  it('returns null when the source is absent from the workspace', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const lookup = new PrismaSourceLookup({
      source: { findFirst },
    } as unknown as PrismaSourceClient);

    await expect(lookup.findById('workspace-b', 'source-1')).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'source-1', workspaceId: 'workspace-b', deletedAt: null },
      select: { id: true, workspaceId: true, status: true, storageKey: true, contentHash: true },
    });
  });
});
