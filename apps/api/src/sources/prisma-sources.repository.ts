import { Injectable } from '@nestjs/common';
import type { Prisma, SourceStatus as PrismaSourceStatus } from '@prisma/client';
import { createSourceTaskMessage, SOURCE_TASK_TYPES } from '@sourceflow/domain';

import { WorkspaceError } from '../auth/auth.errors.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  CreateSourceRecord,
  CreateSourceTaskRun,
  SourceRecord,
  SourceTaskRunRecord,
  SourceTaskOperationResult,
  SourceStatus,
  SourcesRepository,
} from './sources.repository.js';

@Injectable()
export class PrismaSourcesRepository implements SourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSourceRecord): Promise<SourceRecord> {
    assertWorkspaceId(input.workspaceId);
    const source = await this.prisma.source.create({
      data: { ...input, sizeBytes: BigInt(input.sizeBytes) },
    });
    return toSourceRecord(source);
  }

  async findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null> {
    assertWorkspaceId(workspaceId);
    const source = await this.prisma.source.findFirst({
      where: { workspaceId, id: sourceId, deletedAt: null },
    });
    return source === null ? null : toSourceRecord(source);
  }

  async findByContentHash(workspaceId: string, contentHash: string): Promise<SourceRecord | null> {
    assertWorkspaceId(workspaceId);
    const source = await this.prisma.source.findFirst({
      where: { workspaceId, contentHash },
    });
    return source === null ? null : toSourceRecord(source);
  }

  async updateStatus(
    workspaceId: string,
    sourceId: string,
    from: SourceStatus,
    to: SourceStatus,
  ): Promise<boolean> {
    assertWorkspaceId(workspaceId);
    const result = await this.prisma.source.updateMany({
      where: { workspaceId, id: sourceId, status: from as PrismaSourceStatus, deletedAt: null },
      data: { status: to as PrismaSourceStatus },
    });
    return result.count === 1;
  }

  async findTaskRunByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<SourceTaskRunRecord | null> {
    assertWorkspaceId(workspaceId);
    const taskRun = await this.prisma.taskRun.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
    });
    return taskRun === null ? null : toSourceTaskRunRecord(taskRun);
  }

  async findLatestTaskRunForSource(
    workspaceId: string,
    sourceId: string,
  ): Promise<SourceTaskRunRecord | null> {
    assertWorkspaceId(workspaceId);
    const taskRun = await this.prisma.taskRun.findFirst({
      where: { workspaceId, idempotencyKey: { startsWith: `source:${sourceId}:` } },
      orderBy: { createdAt: 'desc' },
    });
    return taskRun === null ? null : toSourceTaskRunRecord(taskRun);
  }

  async completeUploadAndCreateTaskRun(input: {
    workspaceId: string;
    sourceId: string;
    taskRun: CreateSourceTaskRun;
  }): Promise<SourceTaskOperationResult | null> {
    assertWorkspaceId(input.workspaceId);
    assertTaskRunMatches(input.workspaceId, input.sourceId, input.taskRun);

    return this.prisma.$transaction(async (tx) => {
      const source = await tx.source.findFirst({
        where: { workspaceId: input.workspaceId, id: input.sourceId, deletedAt: null },
      });
      if (source === null) return null;

      const existing = await findTaskRun(tx, input.workspaceId, input.taskRun.idempotencyKey);
      if (existing !== null) {
        if (
          (source.status !== 'validating' && source.status !== 'uploaded') ||
          !matchesSourceTaskRun(existing, input.sourceId, 'source.validate')
        ) {
          return null;
        }
        return {
          source: toSourceRecord(source),
          taskRun: toSourceTaskRunRecord(existing),
        };
      }
      if (source.status !== 'uploading') return null;

      const updated = await tx.source.updateMany({
        where: {
          workspaceId: input.workspaceId,
          id: input.sourceId,
          status: 'uploading',
          deletedAt: null,
        },
        data: { status: 'validating' },
      });
      if (updated.count !== 1) {
        const [latestSource, concurrentTaskRun] = await Promise.all([
          tx.source.findFirst({
            where: { workspaceId: input.workspaceId, id: input.sourceId, deletedAt: null },
          }),
          findTaskRun(tx, input.workspaceId, input.taskRun.idempotencyKey),
        ]);
        if (
          latestSource === null ||
          concurrentTaskRun === null ||
          (latestSource.status !== 'validating' && latestSource.status !== 'uploaded') ||
          !matchesSourceTaskRun(concurrentTaskRun, input.sourceId, 'source.validate')
        ) {
          return null;
        }
        return {
          source: toSourceRecord(latestSource),
          taskRun: toSourceTaskRunRecord(concurrentTaskRun),
        };
      }

      const updatedSource = await tx.source.findFirst({
        where: { workspaceId: input.workspaceId, id: input.sourceId, deletedAt: null },
      });
      if (updatedSource === null || updatedSource.status !== 'validating') return null;

      const taskRun = await createTaskRun(tx, input.taskRun);
      return {
        source: toSourceRecord(updatedSource),
        taskRun: toSourceTaskRunRecord(taskRun),
      };
    });
  }

  async queueSourceAndCreateTaskRun(input: {
    workspaceId: string;
    sourceId: string;
    taskRun: CreateSourceTaskRun;
  }): Promise<SourceTaskOperationResult | null> {
    assertWorkspaceId(input.workspaceId);
    assertTaskRunMatches(input.workspaceId, input.sourceId, input.taskRun);

    return this.prisma.$transaction(async (tx) => {
      const source = await tx.source.findFirst({
        where: { workspaceId: input.workspaceId, id: input.sourceId, deletedAt: null },
      });
      if (source === null) return null;

      const existing = await findTaskRun(tx, input.workspaceId, input.taskRun.idempotencyKey);
      if (existing !== null) {
        if (
          (source.status !== 'queued' && source.status !== 'processing') ||
          !matchesSourceTaskRun(existing, input.sourceId, input.taskRun.taskType)
        ) {
          return null;
        }
        return {
          source: toSourceRecord(source),
          taskRun: toSourceTaskRunRecord(existing),
        };
      }
      if (source.status !== 'uploaded') return null;

      const updated = await tx.source.updateMany({
        where: {
          workspaceId: input.workspaceId,
          id: input.sourceId,
          status: 'uploaded',
          deletedAt: null,
        },
        data: { status: 'queued' },
      });
      if (updated.count !== 1) {
        const [latestSource, concurrentTaskRun] = await Promise.all([
          tx.source.findFirst({
            where: { workspaceId: input.workspaceId, id: input.sourceId, deletedAt: null },
          }),
          findTaskRun(tx, input.workspaceId, input.taskRun.idempotencyKey),
        ]);
        if (
          latestSource === null ||
          concurrentTaskRun === null ||
          (latestSource.status !== 'queued' && latestSource.status !== 'processing') ||
          !matchesSourceTaskRun(concurrentTaskRun, input.sourceId, input.taskRun.taskType)
        ) {
          return null;
        }
        return {
          source: toSourceRecord(latestSource),
          taskRun: toSourceTaskRunRecord(concurrentTaskRun),
        };
      }

      const updatedSource = await tx.source.findFirst({
        where: { workspaceId: input.workspaceId, id: input.sourceId, deletedAt: null },
      });
      if (updatedSource === null || updatedSource.status !== 'queued') return null;

      const taskRun = await createTaskRun(tx, input.taskRun);
      return {
        source: toSourceRecord(updatedSource),
        taskRun: toSourceTaskRunRecord(taskRun),
      };
    });
  }

  async cancelSourceAndTaskRuns(
    workspaceId: string,
    sourceId: string,
  ): Promise<SourceRecord | null> {
    assertWorkspaceId(workspaceId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const source = await tx.source.findFirst({
          where: { workspaceId, id: sourceId, deletedAt: null },
        });
        if (source === null || source.status === 'cancelled') {
          return source === null ? null : toSourceRecord(source);
        }
        if (source.status === 'succeeded' || source.status === 'failed') {
          return toSourceRecord(source);
        }

        const idempotencyKeys = [
          `source:${sourceId}:validate:v1`,
          `source:${sourceId}:source.analyze:v1`,
          `source:${sourceId}:source.transcribe:v1`,
        ];
        const taskRuns = await tx.taskRun.findMany({
          where: { workspaceId, idempotencyKey: { in: idempotencyKeys } },
        });
        if (
          taskRuns.some(
            ({ idempotencyKey, status }) =>
              idempotencyKey !== `source:${sourceId}:validate:v1` &&
              ['succeeded', 'failed', 'cancelled'].includes(status),
          )
        ) {
          return toSourceRecord(source);
        }

        const activeTaskRuns = taskRuns.filter(({ status }) =>
          ['queued', 'processing'].includes(status),
        );
        if (activeTaskRuns.length > 0) {
          const cancelledTaskRuns = await tx.taskRun.updateMany({
            where: {
              workspaceId,
              idempotencyKey: { in: idempotencyKeys },
              status: { in: ['queued', 'processing'] },
            },
            data: {
              status: 'cancelled',
              errorCode: 'TASK_CANCELLED',
              errorMessage: '任务已取消',
            },
          });
          if (cancelledTaskRuns.count !== activeTaskRuns.length) throw cancellationRace;
        }

        const cancelledSource = await tx.source.updateMany({
          where: {
            workspaceId,
            id: sourceId,
            status: {
              in: ['created', 'uploading', 'validating', 'uploaded', 'queued', 'processing'],
            },
            deletedAt: null,
          },
          data: { status: 'cancelled' },
        });
        if (cancelledSource.count !== 1) throw cancellationRace;

        const latest = await tx.source.findFirst({
          where: { workspaceId, id: sourceId, deletedAt: null },
        });
        return latest === null ? null : toSourceRecord(latest);
      });
    } catch (error) {
      if (error !== cancellationRace) throw error;
      return this.findById(workspaceId, sourceId);
    }
  }
}

const cancellationRace = new Error('Source cancellation lost a concurrent state transition');

type TaskRunRow = Readonly<{
  id: string;
  workspaceId: string;
  taskType: string;
  idempotencyKey: string;
  status: string;
  attempt: number;
  payload: unknown;
}>;

type SourcesTransaction = Pick<Prisma.TransactionClient, 'source' | 'taskRun'>;

async function findTaskRun(tx: SourcesTransaction, workspaceId: string, idempotencyKey: string) {
  return tx.taskRun.findUnique({
    where: { workspaceId_idempotencyKey: { workspaceId, idempotencyKey } },
  });
}

async function createTaskRun(tx: SourcesTransaction, taskRun: CreateSourceTaskRun) {
  return tx.taskRun.create({
    data: {
      id: taskRun.id,
      workspaceId: taskRun.workspaceId,
      taskType: taskRun.taskType,
      idempotencyKey: taskRun.idempotencyKey,
      status: 'queued',
      attempt: 0,
      payload: taskRun.payload as Prisma.InputJsonObject,
    },
  });
}

function assertTaskRunMatches(
  workspaceId: string,
  sourceId: string,
  taskRun: CreateSourceTaskRun,
): void {
  if (
    taskRun.workspaceId !== workspaceId ||
    taskRun.payload.workspaceId !== workspaceId ||
    taskRun.payload.sourceId !== sourceId ||
    taskRun.payload.taskRunId !== taskRun.id ||
    taskRun.payload.taskType !== taskRun.taskType
  ) {
    throw new Error('TaskRun payload does not match its workspace-scoped Source input');
  }
}

function matchesSourceTaskRun(taskRun: TaskRunRow, sourceId: string, taskType: string): boolean {
  return (
    taskRun.taskType === taskType &&
    isRecord(taskRun.payload) &&
    taskRun.payload.sourceId === sourceId &&
    taskRun.payload.workspaceId === taskRun.workspaceId &&
    taskRun.payload.taskRunId === taskRun.id
  );
}

function toSourceTaskRunRecord(taskRun: TaskRunRow): SourceTaskRunRecord {
  const payload = taskRun.payload;
  if (!isRecord(payload)) throw new Error('TaskRun payload must be an object');
  const taskType = taskRun.taskType;
  if (!SOURCE_TASK_TYPES.includes(taskType as (typeof SOURCE_TASK_TYPES)[number])) {
    throw new Error('TaskRun taskType is unsupported');
  }
  if (!['queued', 'processing', 'succeeded', 'failed', 'cancelled'].includes(taskRun.status)) {
    throw new Error('TaskRun status is unsupported');
  }
  return {
    id: taskRun.id,
    workspaceId: taskRun.workspaceId,
    taskType: taskType as (typeof SOURCE_TASK_TYPES)[number],
    idempotencyKey: taskRun.idempotencyKey,
    status: taskRun.status as SourceTaskRunRecord['status'],
    attempt: taskRun.attempt,
    payload: createSourceTaskMessage({
      taskRunId: payload.taskRunId as string,
      workspaceId: payload.workspaceId as string,
      sourceId: payload.sourceId as string,
      taskType: payload.taskType as (typeof SOURCE_TASK_TYPES)[number],
      inputVersion: payload.inputVersion as number,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSourceRecord(source: {
  id: string;
  workspaceId: string;
  uploadedById: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  durationSeconds: number | null;
  contentHash: string;
  storageKey: string;
  status: PrismaSourceStatus;
  createdAt: Date;
  updatedAt: Date;
}): SourceRecord {
  const sizeBytes = Number(source.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes))
    throw new RangeError('Source size exceeds safe integer range');
  return { ...source, sizeBytes, status: source.status as unknown as SourceStatus };
}

function assertWorkspaceId(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || workspaceId.trim().length === 0) {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }
}
