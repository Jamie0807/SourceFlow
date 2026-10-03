import { describe, expect, it, vi } from 'vitest';

import type {
  SourceTaskMessage,
  SourceTaskResult,
  TaskFailure,
  TaskFailureCode,
} from '@sourceflow/domain';

import {
  PrismaTaskRunStore,
  type PrismaTaskRunClient,
  type PrismaTaskRunRow,
} from './prisma-task-run.store.js';
import type { TaskRunStore } from './task-run.store.js';

const payload: SourceTaskMessage = {
  taskRunId: 'task-a',
  workspaceId: 'workspace-a',
  sourceId: 'source-a',
  taskType: 'source.transcribe',
  inputVersion: 1,
};

const result: SourceTaskResult = {
  taskType: 'source.transcribe',
  output: { transcript: '你好，SourceFlow' },
};

const temporaryFailure: TaskFailure = {
  code: 'PROCESSOR_TEMPORARY_FAILURE',
  message: 'postgresql://user:secret@example.test/db token=secret stack: Error at provider',
  retryable: true,
};

const stableFailureMessages: Record<TaskFailureCode, string> = {
  SOURCE_NOT_FOUND: 'Source 不存在',
  TASK_CANCELLED: '任务已取消',
  PROCESSOR_INVALID_INPUT: '输入无效',
  PROCESSOR_TEMPORARY_FAILURE: '处理服务暂时不可用',
  PROCESSOR_UNKNOWN_FAILURE: '处理失败',
};

type FakeRow = PrismaTaskRunRow & {
  id: string;
  workspaceId: string;
  taskType: string;
  idempotencyKey: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  attempt: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
};

function createFakePrisma(initialRows: FakeRow[] = []): {
  prisma: PrismaTaskRunClient;
  rows: Map<string, FakeRow>;
} {
  const rows = new Map(initialRows.map((row) => [row.id, row]));
  let nextId = initialRows.length + 1;

  const findByCompoundKey = (workspaceId: string, idempotencyKey: string) =>
    [...rows.values()].find(
      (row) => row.workspaceId === workspaceId && row.idempotencyKey === idempotencyKey,
    ) ?? null;

  const matchesStatus = (row: FakeRow, status: unknown): boolean =>
    typeof status === 'string'
      ? row.status === status
      : typeof status === 'object' && status !== null && 'in' in status
        ? Array.isArray(status.in) && status.in.includes(row.status)
        : false;

  const taskRun = {
    findUnique: vi.fn(
      async (args: {
        where: { workspaceId_idempotencyKey: { workspaceId: string; idempotencyKey: string } };
      }) =>
        findByCompoundKey(
          args.where.workspaceId_idempotencyKey.workspaceId,
          args.where.workspaceId_idempotencyKey.idempotencyKey,
        ),
    ),
    findFirst: vi.fn(
      async (args: { where: { id: string; workspaceId: string } }) =>
        [...rows.values()].find(
          (row) => row.id === args.where.id && row.workspaceId === args.where.workspaceId,
        ) ?? null,
    ),
    create: vi.fn(
      async (args: {
        data: Omit<FakeRow, 'id' | 'result' | 'errorCode' | 'errorMessage'> &
          Partial<Pick<FakeRow, 'id'>> &
          Partial<Pick<FakeRow, 'result' | 'errorCode' | 'errorMessage'>>;
      }) => {
        if (findByCompoundKey(args.data.workspaceId, args.data.idempotencyKey)) {
          const error = Object.assign(new Error('unique constraint'), { code: 'P2002' });
          throw error;
        }

        const row = {
          ...args.data,
          id: args.data.id ?? `task-${nextId++}`,
          result: args.data.result ?? null,
          errorCode: args.data.errorCode ?? null,
          errorMessage: args.data.errorMessage ?? null,
        };
        rows.set(row.id, row);
        return row;
      },
    ),
    updateMany: vi.fn(
      async (args: {
        where: {
          id: string;
          workspaceId: string;
          status?: unknown;
        };
        data: {
          status?: FakeRow['status'];
          attempt?: { increment: number };
          payload?: Record<string, unknown>;
          result?: Record<string, unknown> | null;
          errorCode?: string | null;
          errorMessage?: string | null;
        };
      }) => {
        const row = [...rows.values()].find(
          (candidate) =>
            candidate.id === args.where.id &&
            candidate.workspaceId === args.where.workspaceId &&
            (args.where.status === undefined || matchesStatus(candidate, args.where.status)),
        );
        if (!row) return { count: 0 };

        if (args.data.status !== undefined) row.status = args.data.status;
        if (args.data.attempt !== undefined) row.attempt += args.data.attempt.increment;
        if ('payload' in args.data && args.data.payload !== undefined)
          row.payload = args.data.payload;
        if ('result' in args.data && args.data.result !== undefined) row.result = args.data.result;
        if ('errorCode' in args.data) row.errorCode = args.data.errorCode ?? null;
        if ('errorMessage' in args.data) row.errorMessage = args.data.errorMessage ?? null;
        return { count: 1 };
      },
    ),
  };

  return { prisma: { taskRun } as unknown as PrismaTaskRunClient, rows };
}

function createStore(initialRows: FakeRow[] = []): {
  store: TaskRunStore;
  prisma: PrismaTaskRunClient;
  rows: Map<string, FakeRow>;
} {
  const { prisma, rows } = createFakePrisma(initialRows);
  return { store: new PrismaTaskRunStore(prisma), prisma, rows };
}

function queuedRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'task-a',
    workspaceId: 'workspace-a',
    taskType: 'source.transcribe',
    idempotencyKey: 'idempotency-a',
    status: 'queued',
    attempt: 0,
    payload: { ...payload },
    result: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

describe('PrismaTaskRunStore', () => {
  it('creates one task per workspace and idempotency key', async () => {
    const { store } = createStore();
    const input = {
      workspaceId: 'workspace-a',
      taskType: 'source.transcribe' as const,
      idempotencyKey: 'idempotency-a',
      payload,
    };

    const otherPayload: SourceTaskMessage = {
      ...payload,
      taskRunId: 'task-b',
      workspaceId: 'workspace-b',
    };
    const first = await store.createOrGetQueued(input);
    const second = await store.createOrGetQueued(input);
    const otherWorkspace = await store.createOrGetQueued({
      ...input,
      workspaceId: 'workspace-b',
      payload: otherPayload,
    });

    expect(first.created).toBe(true);
    expect(first.record.id).toBe(payload.taskRunId);
    await expect(store.claimProcessing(input.workspaceId, first.record.id)).resolves.toMatchObject({
      id: payload.taskRunId,
      status: 'processing',
      attempt: 1,
    });
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(otherWorkspace.created).toBe(true);
    expect(otherWorkspace.record.id).toBe(otherPayload.taskRunId);
    expect(otherWorkspace.record.workspaceId).toBe('workspace-b');
  });

  it('recovers from a concurrent compound-key conflict without creating a duplicate', async () => {
    const { store } = createStore();
    const input = {
      workspaceId: 'workspace-a',
      taskType: 'source.transcribe' as const,
      idempotencyKey: 'idempotency-a',
      payload,
    };

    const results = await Promise.all([
      store.createOrGetQueued(input),
      store.createOrGetQueued(input),
    ]);

    expect(results.filter((item) => item.created)).toHaveLength(1);
    expect(results[0]?.record.id).toBe(results[1]?.record.id);
  });

  it('rejects payload workspace and task type metadata that do not match the input', async () => {
    const workspaceMismatch = createStore();
    await expect(
      workspaceMismatch.store.createOrGetQueued({
        workspaceId: 'workspace-a',
        taskType: 'source.transcribe',
        idempotencyKey: 'idempotency-a',
        payload: { ...payload, workspaceId: 'workspace-b' },
      }),
    ).rejects.toThrow('workspaceId');
    expect(workspaceMismatch.prisma.taskRun.create).not.toHaveBeenCalled();

    const taskTypeMismatch = createStore();
    await expect(
      taskTypeMismatch.store.createOrGetQueued({
        workspaceId: 'workspace-a',
        taskType: 'source.analyze',
        idempotencyKey: 'idempotency-a',
        payload,
      }),
    ).rejects.toThrow('taskType');
    expect(taskTypeMismatch.prisma.taskRun.create).not.toHaveBeenCalled();
  });

  it('rethrows an unexpected create failure instead of treating it as an idempotency hit', async () => {
    const { store, prisma } = createStore();
    const failure = new Error('database unavailable');
    vi.mocked(prisma.taskRun.create).mockRejectedValueOnce(failure);

    await expect(
      store.createOrGetQueued({
        workspaceId: 'workspace-a',
        taskType: 'source.transcribe',
        idempotencyKey: 'idempotency-a',
        payload,
      }),
    ).rejects.toBe(failure);
  });

  it('rethrows a unique conflict when the concurrent record is still not visible', async () => {
    const { store, prisma } = createStore();
    const failure = Object.assign(new Error('unique constraint'), { code: 'P2002' });
    vi.mocked(prisma.taskRun.findUnique).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    vi.mocked(prisma.taskRun.create).mockRejectedValueOnce(failure);

    await expect(
      store.createOrGetQueued({
        workspaceId: 'workspace-a',
        taskType: 'source.transcribe',
        idempotencyKey: 'idempotency-a',
        payload,
      }),
    ).rejects.toBe(failure);
  });

  it('does not claim or find a task from another workspace', async () => {
    const { store } = createStore([queuedRow()]);

    await expect(store.findById('workspace-b', 'task-a')).resolves.toBeNull();
    await expect(store.claimProcessing('workspace-b', 'task-a')).resolves.toBeNull();
  });

  it('allows only queued to become processing and records attempts', async () => {
    const { store } = createStore([queuedRow()]);

    const claimed = await store.claimProcessing('workspace-a', 'task-a');
    const duplicate = await store.claimProcessing('workspace-a', 'task-a');

    expect(claimed?.status).toBe('processing');
    expect(claimed?.attempt).toBe(1);
    expect(duplicate).toBeNull();
  });

  it('scopes the compound lookup and every state update by workspace', async () => {
    const { store, prisma } = createStore([queuedRow()]);

    await store.createOrGetQueued({
      workspaceId: 'workspace-a',
      taskType: 'source.transcribe',
      idempotencyKey: 'idempotency-a',
      payload,
    });
    await store.claimProcessing('workspace-a', 'task-a');
    await store.markSucceeded('workspace-a', 'task-a', result);
    await store.findById('workspace-a', 'task-a');

    expect(prisma.taskRun.findUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_idempotencyKey: {
          workspaceId: 'workspace-a',
          idempotencyKey: 'idempotency-a',
        },
      },
    });
    expect(prisma.taskRun.findFirst).toHaveBeenCalledWith({
      where: { id: 'task-a', workspaceId: 'workspace-a' },
    });
    for (const call of vi.mocked(prisma.taskRun.updateMany).mock.calls) {
      expect(call[0]?.where).toMatchObject({ id: 'task-a', workspaceId: 'workspace-a' });
    }
  });

  it('requeues processing tasks and records terminal success or failure safely', async () => {
    const { store, rows } = createStore([queuedRow({ status: 'processing', attempt: 1 })]);

    await store.requeue('workspace-a', 'task-a');
    expect(rows.get('task-a')).toMatchObject({
      status: 'queued',
      attempt: 1,
      errorCode: null,
      errorMessage: null,
    });

    await store.claimProcessing('workspace-a', 'task-a');
    await store.markFailed('workspace-a', 'task-a', temporaryFailure);
    expect(rows.get('task-a')).toMatchObject({
      status: 'failed',
      errorCode: temporaryFailure.code,
      errorMessage: stableFailureMessages[temporaryFailure.code],
    });

    await store.markSucceeded('workspace-a', 'task-a', result);
    expect(rows.get('task-a')).toMatchObject({ status: 'failed' });

    const successStore = createStore([queuedRow({ status: 'processing', attempt: 1 })]);
    await successStore.store.markSucceeded('workspace-a', 'task-a', {
      taskType: 'source.transcribe',
      output: {
        transcript: '你好',
        segments: [{ startMs: 0, endMs: 1000, reviewed: false, speaker: null }],
      },
    });
    await expect(successStore.store.findById('workspace-a', 'task-a')).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        taskType: 'source.transcribe',
        output: {
          transcript: '你好',
          segments: [{ startMs: 0, endMs: 1000, reviewed: false, speaker: null }],
        },
      },
    });
  });

  it('marks queued and processing infrastructure failures failed without changing terminals', async () => {
    const queuedStore = createStore([queuedRow()]);
    await queuedStore.store.markInfrastructureFailed('workspace-a', 'task-a', temporaryFailure);
    await expect(queuedStore.store.findById('workspace-a', 'task-a')).resolves.toMatchObject({
      status: 'failed',
      errorCode: temporaryFailure.code,
      errorMessage: stableFailureMessages[temporaryFailure.code],
    });

    const processingStore = createStore([queuedRow({ status: 'processing', attempt: 1 })]);
    await processingStore.store.markInfrastructureFailed('workspace-a', 'task-a', temporaryFailure);
    expect(processingStore.rows.get('task-a')?.status).toBe('failed');

    const terminalStore = createStore([queuedRow({ status: 'cancelled' })]);
    await terminalStore.store.markInfrastructureFailed('workspace-a', 'task-a', temporaryFailure);
    expect(terminalStore.rows.get('task-a')).toMatchObject({
      status: 'cancelled',
      errorCode: null,
      errorMessage: null,
    });
    expect(terminalStore.prisma.taskRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'task-a',
        workspaceId: 'workspace-a',
        status: { in: ['queued', 'processing'] },
      },
      data: {
        status: 'failed',
        errorCode: temporaryFailure.code,
        errorMessage: stableFailureMessages[temporaryFailure.code],
      },
    });
  });

  it('stores only fixed user-safe messages for every failure code', async () => {
    for (const [index, code] of Object.keys(stableFailureMessages).entries()) {
      const taskRunId = `failure-task-${index}`;
      const taskPayload = { ...payload, taskRunId };
      const { store } = createStore([
        queuedRow({ id: taskRunId, payload: taskPayload, status: 'processing' }),
      ]);

      await store.markFailed('workspace-a', taskRunId, {
        code: code as TaskFailureCode,
        message: 'token=secret postgresql://user:secret@example.test/db\nError: stack trace',
        retryable: true,
      });

      await expect(store.findById('workspace-a', taskRunId)).resolves.toMatchObject({
        status: 'failed',
        errorCode: code,
        errorMessage: stableFailureMessages[code as TaskFailureCode],
      });
    }
  });

  it('cancels queued or processing tasks and leaves terminal tasks unchanged', async () => {
    const { store, rows } = createStore([queuedRow()]);

    const cancelled = await store.cancel('workspace-a', 'task-a');
    expect(cancelled).toMatchObject({
      status: 'cancelled',
      errorCode: 'TASK_CANCELLED',
      errorMessage: '任务已取消',
    });

    const terminal = await store.cancel('workspace-a', 'task-a');
    expect(terminal).toMatchObject({ status: 'cancelled', errorCode: 'TASK_CANCELLED' });
    expect(rows.get('task-a')?.status).toBe('cancelled');

    const processingStore = createStore([queuedRow({ status: 'processing', attempt: 1 })]);
    await expect(processingStore.store.cancel('workspace-a', 'task-a')).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it('rejects unsupported persisted task types, statuses, and unsafe JSON values', async () => {
    const unsupportedType = createStore([queuedRow({ taskType: 'source.unknown' })]);
    await expect(unsupportedType.store.findById('workspace-a', 'task-a')).rejects.toThrow(
      'unsupported task type',
    );

    const unsupportedStatus = createStore([queuedRow({ status: 'unknown' as FakeRow['status'] })]);
    await expect(unsupportedStatus.store.findById('workspace-a', 'task-a')).rejects.toThrow(
      'unsupported status',
    );

    const unsafeValue = createStore([queuedRow({ payload: { unsafe: undefined } })]);
    await expect(unsafeValue.store.findById('workspace-a', 'task-a')).rejects.toThrow(
      'JSON-safe values',
    );

    const nonObject = createStore([
      queuedRow({ payload: new Date() as unknown as Record<string, unknown> }),
    ]);
    await expect(nonObject.store.findById('workspace-a', 'task-a')).rejects.toThrow('JSON objects');
  });

  it('rejects circular payload and result JSON with a controlled JSON-safe error', async () => {
    const circularObject = { ...payload } as Record<string, unknown>;
    circularObject.self = circularObject;
    const payloadStore = createStore();

    await expect(
      payloadStore.store.createOrGetQueued({
        workspaceId: 'workspace-a',
        taskType: 'source.transcribe',
        idempotencyKey: 'idempotency-a',
        payload: circularObject as unknown as SourceTaskMessage,
      }),
    ).rejects.toThrow('JSON-safe');

    const circularArray: unknown[] = [];
    circularArray.push(circularArray);
    const resultStore = createStore([queuedRow({ status: 'processing' })]);

    await expect(
      resultStore.store.markSucceeded('workspace-a', 'task-a', {
        taskType: 'source.transcribe',
        output: { segments: circularArray },
      } as unknown as SourceTaskResult),
    ).rejects.toThrow('JSON-safe');
  });
});
