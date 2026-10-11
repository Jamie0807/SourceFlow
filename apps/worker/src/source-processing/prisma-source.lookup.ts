import type { PrismaClient } from '@prisma/client';
import type { SourceStatus } from '@sourceflow/domain';

import type { SourceLookup, SourceRecord } from './source-processor.js';

export type { SourceLookup, SourceRecord } from './source-processor.js';

export type PrismaSourceClient = Pick<PrismaClient, 'source'>;

export class PrismaSourceLookup implements SourceLookup {
  constructor(private readonly prisma: PrismaSourceClient) {}

  async findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null> {
    const source = await this.prisma.source.findFirst({
      where: { id: sourceId, workspaceId, deletedAt: null },
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

    return source === null ? null : { ...source, sizeBytes: Number(source.sizeBytes) };
  }

  async transitionStatus(
    workspaceId: string,
    sourceId: string,
    expectedStatus: SourceStatus,
    status: SourceStatus,
  ): Promise<boolean> {
    const result = await this.prisma.source.updateMany({
      where: { id: sourceId, workspaceId, status: expectedStatus, deletedAt: null },
      data: { status },
    });
    return result.count === 1;
  }

  async completeValidation(
    workspaceId: string,
    sourceId: string,
    metadata: { durationSeconds: number | null; contentHash: string; mimeType: string },
  ): Promise<boolean> {
    const result = await this.prisma.source.updateMany({
      where: { id: sourceId, workspaceId, status: 'validating', deletedAt: null },
      data: { ...metadata, status: 'uploaded' },
    });
    return result.count === 1;
  }
}
