import type { PrismaClient } from '@prisma/client';

import type { SourceLookup, SourceRecord } from './source-processor.js';

export type { SourceLookup, SourceRecord } from './source-processor.js';

export type PrismaSourceClient = Pick<PrismaClient, 'source'>;

export class PrismaSourceLookup implements SourceLookup {
  constructor(private readonly prisma: PrismaSourceClient) {}

  async findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, workspaceId, deletedAt: null },
      select: { id: true, workspaceId: true, status: true, storageKey: true, contentHash: true },
    });

    return source;
  }
}
