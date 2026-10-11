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
      mimeType: 'video/mp4',
      sizeBytes: 128,
      durationSeconds: 17,
    };
    const findFirst = vi.fn().mockResolvedValue({ ...source, sizeBytes: 128n });
    const lookup = new PrismaSourceLookup({
      source: { findFirst },
    } as unknown as PrismaSourceClient);

    await expect(lookup.findById('workspace-a', 'source-1')).resolves.toEqual(source);
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'source-1', workspaceId: 'workspace-a', deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        storageKey: true,
        contentHash: true,
        mimeType: true,
        sizeBytes: true,
        durationSeconds: true,
      },
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
      select: {
        id: true,
        workspaceId: true,
        status: true,
        storageKey: true,
        contentHash: true,
        mimeType: true,
        sizeBytes: true,
        durationSeconds: true,
      },
    });
  });

  it('conditionally transitions Source status within its workspace', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const lookup = new PrismaSourceLookup({
      source: { updateMany },
    } as unknown as PrismaSourceClient);

    await expect(
      lookup.transitionStatus('workspace-a', 'source-1', 'queued', 'processing'),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'source-1',
        workspaceId: 'workspace-a',
        status: 'queued',
        deletedAt: null,
      },
      data: { status: 'processing' },
    });
  });

  it('persists verified validation metadata only while the source is validating', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const lookup = new PrismaSourceLookup({
      source: { updateMany },
    } as unknown as PrismaSourceClient);

    await expect(
      lookup.completeValidation('workspace-a', 'source-1', {
        durationSeconds: 17,
        contentHash: 'verified-hash',
        mimeType: 'video/mp4',
      }),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'source-1',
        workspaceId: 'workspace-a',
        status: 'validating',
        deletedAt: null,
      },
      data: {
        durationSeconds: 17,
        contentHash: 'verified-hash',
        mimeType: 'video/mp4',
        status: 'uploaded',
      },
    });
  });
});
