import type { Prisma, PrismaClient } from '@prisma/client';
import {
  SOURCE_TASK_TYPES,
  type SourceStatus,
  type SourceTaskMessage,
  type SourceTaskResult,
  type SourceTaskType,
  type TaskFailure,
  type TaskFailureCode,
} from '@sourceflow/domain';

import type { TaskRunRecord, TaskRunStatus, TaskRunStore } from './task-run.store.js';

export type PrismaTaskRunClient = Pick<PrismaClient, '$transaction' | 'source' | 'taskRun'>;
export type PrismaTaskRunRow = Readonly<{
  id: string;
  workspaceId: string;
  taskType: string;
  idempotencyKey: string;
  status: string;
  attempt: number;
  payload: unknown;
  result: unknown;
  errorCode: string | null;
  errorMessage: string | null;
}>;

const TERMINAL_STATUSES: readonly TaskRunStatus[] = ['succeeded', 'failed', 'cancelled'];
const CANCELLABLE_STATUSES: TaskRunStatus[] = ['queued', 'processing'];
const TASK_FAILURE_MESSAGES: Record<TaskFailureCode, string> = {
  SOURCE_NOT_FOUND: 'Source 不存在',
  TASK_CANCELLED: '任务已取消',
  PROCESSOR_INVALID_INPUT: '输入无效',
  PROCESSOR_TEMPORARY_FAILURE: '处理服务暂时不可用',
  PROCESSOR_UNKNOWN_FAILURE: '处理失败',
};
const SOURCE_TASK_CAS_MISS = Symbol('SOURCE_TASK_CAS_MISS');

export class PrismaTaskRunStore implements TaskRunStore {
  constructor(private readonly prisma: PrismaTaskRunClient) {}

  async createOrGetQueued(input: {
    workspaceId: string;
    taskType: SourceTaskType;
    idempotencyKey: string;
    payload: SourceTaskMessage;
  }): Promise<{ record: TaskRunRecord; created: boolean }> {
    assertPayloadMatchesInput(input);

    const existing = await this.prisma.taskRun.findUnique({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: input.workspaceId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing !== null) {
      return { record: toTaskRunRecord(existing), created: false };
    }

    try {
      const created = await this.prisma.taskRun.create({
        data: {
          id: input.payload.taskRunId,
          workspaceId: input.workspaceId,
          taskType: input.taskType,
          idempotencyKey: input.idempotencyKey,
          status: 'queued',
          attempt: 0,
          payload: toPrismaJsonObject(input.payload),
        },
      });
      return { record: toTaskRunRecord(created), created: true };
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }

      const concurrent = await this.prisma.taskRun.findUnique({
        where: {
          workspaceId_idempotencyKey: {
            workspaceId: input.workspaceId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (concurrent === null) {
        throw error;
      }

      return { record: toTaskRunRecord(concurrent), created: false };
    }
  }

  async claimProcessing(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null> {
    const update = await this.prisma.taskRun.updateMany({
      where: { id: taskRunId, workspaceId, status: 'queued' },
      data: { status: 'processing', attempt: { increment: 1 } },
    });
    if (update.count !== 1) {
      return null;
    }

    return this.findById(workspaceId, taskRunId);
  }

  async requeue(workspaceId: string, taskRunId: string): Promise<void> {
    await this.prisma.taskRun.updateMany({
      where: { id: taskRunId, workspaceId, status: 'processing' },
      data: {
        status: 'queued',
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  async markSucceeded(
    workspaceId: string,
    taskRunId: string,
    result: SourceTaskResult,
  ): Promise<void> {
    await this.prisma.taskRun.updateMany({
      where: { id: taskRunId, workspaceId, status: 'processing' },
      data: {
        status: 'succeeded',
        result: toPrismaJsonObject(result),
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  async markFailed(workspaceId: string, taskRunId: string, failure: TaskFailure): Promise<void> {
    await this.prisma.taskRun.updateMany({
      where: { id: taskRunId, workspaceId, status: 'processing' },
      data: {
        status: 'failed',
        errorCode: failure.code,
        errorMessage: TASK_FAILURE_MESSAGES[failure.code],
      },
    });
  }

  async markInfrastructureFailed(
    workspaceId: string,
    taskRunId: string,
    failure: TaskFailure,
  ): Promise<void> {
    await this.prisma.taskRun.updateMany({
      where: { id: taskRunId, workspaceId, status: { in: CANCELLABLE_STATUSES } },
      data: {
        status: 'failed',
        errorCode: failure.code,
        errorMessage: TASK_FAILURE_MESSAGES[failure.code],
      },
    });
  }

  async transitionWithSource(input: {
    workspaceId: string;
    sourceId: string;
    taskRunId: string;
    expectedSourceStatus: SourceStatus | readonly SourceStatus[];
    sourceStatus: SourceStatus;
    taskRunStatus: 'queued' | 'succeeded' | 'failed';
    result?: SourceTaskResult;
    failure?: TaskFailure;
    sourceMetadata?: Readonly<{
      durationSeconds: number | null;
      contentHash: string;
      mimeType: string;
    }>;
  }): Promise<boolean> {
    const taskRunData: Prisma.TaskRunUpdateManyMutationInput =
      input.taskRunStatus === 'succeeded'
        ? {
            status: 'succeeded',
            result: toPrismaJsonObject(requireTransitionValue(input.result, 'result')),
            errorCode: null,
            errorMessage: null,
          }
        : input.taskRunStatus === 'failed'
          ? {
              status: 'failed',
              errorCode: requireTransitionValue(input.failure, 'failure').code,
              errorMessage: TASK_FAILURE_MESSAGES[input.failure!.code],
            }
          : { status: 'queued', errorCode: null, errorMessage: null };
    const expectedSourceStatus =
      typeof input.expectedSourceStatus === 'string'
        ? input.expectedSourceStatus
        : { in: [...input.expectedSourceStatus] };
    const sourceData: Prisma.SourceUpdateManyMutationInput = {
      status: input.sourceStatus,
      ...(input.sourceMetadata === undefined ? {} : input.sourceMetadata),
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        const taskRun = await tx.taskRun.updateMany({
          where: { id: input.taskRunId, workspaceId: input.workspaceId, status: 'processing' },
          data: taskRunData,
        });
        if (taskRun.count !== 1) throw SOURCE_TASK_CAS_MISS;

        const source = await tx.source.updateMany({
          where: {
            id: input.sourceId,
            workspaceId: input.workspaceId,
            status: expectedSourceStatus,
            deletedAt: null,
          },
          data: sourceData,
        });
        if (source.count !== 1) throw SOURCE_TASK_CAS_MISS;
      });
      return true;
    } catch (error) {
      if (error === SOURCE_TASK_CAS_MISS) return false;
      throw error;
    }
  }

  async cancel(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null> {
    await this.prisma.taskRun.updateMany({
      where: { id: taskRunId, workspaceId, status: { in: CANCELLABLE_STATUSES } },
      data: {
        status: 'cancelled',
        errorCode: 'TASK_CANCELLED',
        errorMessage: '任务已取消',
      },
    });

    return this.findById(workspaceId, taskRunId);
  }

  async findById(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null> {
    const taskRun = await this.prisma.taskRun.findFirst({
      where: { id: taskRunId, workspaceId },
    });
    return taskRun === null ? null : toTaskRunRecord(taskRun);
  }
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function requireTransitionValue<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined) throw new Error(`Task transition requires ${fieldName}`);
  return value;
}

function assertPayloadMatchesInput(input: {
  workspaceId: string;
  taskType: SourceTaskType;
  payload: SourceTaskMessage;
}): void {
  if (input.payload.workspaceId !== input.workspaceId) {
    throw new Error('TaskRun payload workspaceId must match input.workspaceId');
  }
  if (input.payload.taskType !== input.taskType) {
    throw new Error('TaskRun payload taskType must match input.taskType');
  }
}

function toTaskRunRecord(taskRun: PrismaTaskRunRow): TaskRunRecord {
  return {
    id: taskRun.id,
    workspaceId: taskRun.workspaceId,
    taskType: toSourceTaskType(taskRun.taskType),
    idempotencyKey: taskRun.idempotencyKey,
    status: toTaskRunStatus(taskRun.status),
    attempt: taskRun.attempt,
    payload: toRecord(taskRun.payload),
    result: taskRun.result === null ? null : toRecord(taskRun.result),
    errorCode: taskRun.errorCode,
    errorMessage: taskRun.errorMessage,
  };
}

function toSourceTaskType(taskType: string): SourceTaskType {
  if (!SOURCE_TASK_TYPES.includes(taskType as SourceTaskType)) {
    throw new Error('TaskRun contains an unsupported task type');
  }
  return taskType as SourceTaskType;
}

function toTaskRunStatus(status: string): TaskRunStatus {
  if (![...CANCELLABLE_STATUSES, ...TERMINAL_STATUSES].includes(status as TaskRunStatus)) {
    throw new Error('TaskRun contains an unsupported status');
  }
  return status as TaskRunStatus;
}

function toRecord(value: unknown): Record<string, unknown> {
  return { ...toPrismaJsonObject(value) };
}

function toPrismaJsonObject(
  value: unknown,
  ancestors = new WeakSet<object>(),
): Prisma.InputJsonObject {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new Error('TaskRun JSON fields must be JSON objects');
  }

  if (ancestors.has(value)) {
    throw new Error('TaskRun JSON fields must be acyclic JSON-safe values');
  }

  ancestors.add(value);
  try {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, toPrismaJsonValue(child, ancestors)]),
    ) as Prisma.InputJsonObject;
  } finally {
    ancestors.delete(value);
  }
}

function toPrismaJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): Prisma.InputJsonValue | null {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new Error('TaskRun JSON fields must be acyclic JSON-safe values');
    }

    ancestors.add(value);
    try {
      return value.map((item) => toPrismaJsonValue(item, ancestors));
    } finally {
      ancestors.delete(value);
    }
  }
  if (typeof value === 'object' && value !== null) {
    return toPrismaJsonObject(value, ancestors);
  }
  throw new Error('TaskRun JSON fields must contain JSON-safe values');
}
