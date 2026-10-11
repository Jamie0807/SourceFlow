import { describe, expect, it, vi } from 'vitest';

import { PrismaSourcesRepository } from './prisma-sources.repository.js';

const source = {
  id: 'source-1',
  workspaceId: 'workspace-1',
  uploadedById: 'user-1',
  fileName: 'episode.mp3',
  mimeType: 'audio/mpeg',
  sizeBytes: 42n,
  durationSeconds: null,
  contentHash: Buffer.alloc(32, 1).toString('base64'),
  storageKey: 'workspaces/workspace-1/sources/source-1/original',
  status: 'uploading',
  createdAt: new Date('2026-10-08T00:00:00.000Z'),
  updatedAt: new Date('2026-10-08T00:00:00.000Z'),
  deletedAt: null,
  isTestData: false,
  brandId: null,
};

function createRepository() {
  const prisma = {
    source: {
      create: vi.fn().mockResolvedValue(source),
      findFirst: vi.fn().mockResolvedValue(source),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskRun: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return {
    repository: new PrismaSourcesRepository(prisma as never),
    prisma,
  };
}

describe('PrismaSourcesRepository', () => {
  it('finds the latest TaskRun for a Source within the same workspace', async () => {
    const taskRun = {
      id: 'task-run-1',
      workspaceId: 'workspace-1',
      taskType: 'source.transcribe',
      idempotencyKey: 'source:source-1:transcribe:v1',
      status: 'processing',
      attempt: 2,
      payload: {
        taskRunId: 'task-run-1',
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskType: 'source.transcribe',
        inputVersion: 1,
      },
    };
    const { repository, prisma } = createRepository();
    prisma.taskRun.findFirst.mockResolvedValue(taskRun);

    await expect(
      repository.findLatestTaskRunForSource('workspace-1', 'source-1'),
    ).resolves.toMatchObject({ id: 'task-run-1', status: 'processing', attempt: 2 });
    expect(prisma.taskRun.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1', idempotencyKey: { startsWith: 'source:source-1:' } },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('scopes source lookup and content hash lookup to workspaceId', async () => {
    const { repository, prisma } = createRepository();

    await repository.findById('workspace-1', 'source-1');
    await repository.findByContentHash('workspace-1', source.contentHash);

    expect(prisma.source.findFirst).toHaveBeenNthCalledWith(1, {
      where: { workspaceId: 'workspace-1', id: 'source-1', deletedAt: null },
    });
    expect(prisma.source.findFirst).toHaveBeenNthCalledWith(2, {
      where: { workspaceId: 'workspace-1', contentHash: source.contentHash },
    });
  });

  it('scopes create to the explicit workspace and maps bigint size to number', async () => {
    const { repository, prisma } = createRepository();
    const input = {
      id: 'source-1',
      workspaceId: 'workspace-1',
      uploadedById: 'user-1',
      fileName: 'episode.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 42,
      contentHash: source.contentHash,
      storageKey: source.storageKey,
      status: 'uploading' as const,
    };

    await expect(repository.create(input)).resolves.toMatchObject({ sizeBytes: 42 });
    expect(prisma.source.create).toHaveBeenCalledWith({
      data: { ...input, sizeBytes: 42n },
    });
  });

  it('updates status only when workspace, source, and expected prior state all match', async () => {
    const { repository, prisma } = createRepository();

    await expect(
      repository.updateStatus('workspace-1', 'source-1', 'uploading', 'cancelled'),
    ).resolves.toBe(true);
    expect(prisma.source.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1', id: 'source-1', status: 'uploading', deletedAt: null },
      data: { status: 'cancelled' },
    });
  });

  it('returns false when a concurrent status update already changed the row', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const racedRepository = new PrismaSourcesRepository({ source: { updateMany } } as never);

    await expect(
      racedRepository.updateStatus('workspace-1', 'source-1', 'uploading', 'cancelled'),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledOnce();
  });

  it('refuses an empty workspace before issuing an unscoped query', async () => {
    const { repository, prisma } = createRepository();

    await expect(repository.findById(' ', 'source-1')).rejects.toMatchObject({
      code: 'WORKSPACE_ACCESS_DENIED',
    });
    expect(prisma.source.findFirst).not.toHaveBeenCalled();
  });

  it('transitions to validating and creates the queued TaskRun in one workspace-scoped transaction', async () => {
    const validatingSource = { ...source, status: 'validating' };
    const taskRun = {
      id: 'task-run-1',
      workspaceId: 'workspace-1',
      taskType: 'source.validate',
      idempotencyKey: 'source:source-1:validate:v1',
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'task-run-1',
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskType: 'source.validate',
        inputVersion: 1,
      },
    } as const;
    const tx = {
      source: {
        findFirst: vi.fn().mockResolvedValueOnce(source).mockResolvedValueOnce(validatingSource),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(taskRun),
      },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const repository = new PrismaSourcesRepository({ $transaction: transaction } as never);

    await expect(
      repository.completeUploadAndCreateTaskRun({
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskRun: {
          id: taskRun.id,
          workspaceId: taskRun.workspaceId,
          taskType: 'source.validate',
          idempotencyKey: taskRun.idempotencyKey,
          payload: taskRun.payload,
        },
      }),
    ).resolves.toMatchObject({
      source: { id: 'source-1', workspaceId: 'workspace-1', status: 'validating' },
      taskRun: { id: taskRun.id, workspaceId: 'workspace-1', status: 'queued' },
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.source.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1', id: 'source-1', deletedAt: null },
    });
    expect(tx.source.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        id: 'source-1',
        status: 'uploading',
        deletedAt: null,
      },
      data: { status: 'validating' },
    });
    expect(tx.taskRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: taskRun.id,
        workspaceId: 'workspace-1',
        taskType: 'source.validate',
        idempotencyKey: taskRun.idempotencyKey,
        status: 'queued',
        payload: taskRun.payload,
      }),
    });
  });

  it('reuses an existing validation TaskRun without creating a duplicate', async () => {
    const validatingSource = { ...source, status: 'validating' };
    const taskRun = {
      id: 'task-run-existing',
      workspaceId: 'workspace-1',
      taskType: 'source.validate',
      idempotencyKey: 'source:source-1:validate:v1',
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'task-run-existing',
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskType: 'source.validate',
        inputVersion: 1,
      },
    } as const;
    const tx = {
      source: { findFirst: vi.fn().mockResolvedValue(validatingSource) },
      taskRun: { findUnique: vi.fn().mockResolvedValue(taskRun), create: vi.fn() },
    };
    const repository = new PrismaSourcesRepository({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      repository.completeUploadAndCreateTaskRun({
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskRun: {
          id: 'new-id-is-ignored',
          workspaceId: 'workspace-1',
          taskType: 'source.validate',
          idempotencyKey: taskRun.idempotencyKey,
          payload: { ...taskRun.payload, taskRunId: 'new-id-is-ignored' },
        },
      }),
    ).resolves.toMatchObject({ taskRun: { id: 'task-run-existing' } });
    expect(tx.taskRun.create).not.toHaveBeenCalled();
  });

  it('refuses an idempotency key whose existing validation payload belongs to another Source', async () => {
    const validatingSource = { ...source, status: 'validating' };
    const taskRun = {
      id: 'task-run-existing',
      workspaceId: 'workspace-1',
      taskType: 'source.validate',
      idempotencyKey: 'source:source-1:validate:v1',
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'task-run-existing',
        workspaceId: 'workspace-1',
        sourceId: 'source-other',
        taskType: 'source.validate',
        inputVersion: 1,
      },
    } as const;
    const tx = {
      source: { findFirst: vi.fn().mockResolvedValue(validatingSource) },
      taskRun: { findUnique: vi.fn().mockResolvedValue(taskRun), create: vi.fn() },
    };
    const repository = new PrismaSourcesRepository({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      repository.completeUploadAndCreateTaskRun({
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskRun: {
          id: 'new-task-run',
          workspaceId: 'workspace-1',
          taskType: 'source.validate',
          idempotencyKey: taskRun.idempotencyKey,
          payload: { ...taskRun.payload, sourceId: 'source-1', taskRunId: 'new-task-run' },
        },
      }),
    ).resolves.toBeNull();
    expect(tx.taskRun.create).not.toHaveBeenCalled();
  });

  it('transitions uploaded to queued and creates its business TaskRun transactionally', async () => {
    const uploadedSource = { ...source, status: 'uploaded' };
    const queuedSource = { ...source, status: 'queued' };
    const taskRun = {
      id: 'process-task-1',
      workspaceId: 'workspace-1',
      taskType: 'source.analyze',
      idempotencyKey: 'source:source-1:source.analyze:v1',
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'process-task-1',
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskType: 'source.analyze',
        inputVersion: 1,
      },
    } as const;
    const tx = {
      source: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(uploadedSource)
          .mockResolvedValueOnce(queuedSource),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(taskRun),
      },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const repository = new PrismaSourcesRepository({ $transaction: transaction } as never);

    await expect(
      repository.queueSourceAndCreateTaskRun({
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskRun: {
          id: taskRun.id,
          workspaceId: taskRun.workspaceId,
          taskType: 'source.analyze',
          idempotencyKey: taskRun.idempotencyKey,
          payload: taskRun.payload,
        },
      }),
    ).resolves.toMatchObject({
      source: { id: 'source-1', workspaceId: 'workspace-1', status: 'queued' },
      taskRun: { id: taskRun.id, taskType: 'source.analyze', status: 'queued' },
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.source.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        id: 'source-1',
        status: 'uploaded',
        deletedAt: null,
      },
      data: { status: 'queued' },
    });
    expect(tx.taskRun.create).toHaveBeenCalledOnce();
  });

  it('returns the existing queued TaskRun for a concurrent process transaction', async () => {
    const queuedSource = { ...source, status: 'queued' };
    const taskRun = {
      id: 'process-task-existing',
      workspaceId: 'workspace-1',
      taskType: 'source.transcribe',
      idempotencyKey: 'source:source-1:source.transcribe:v1',
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'process-task-existing',
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskType: 'source.transcribe',
        inputVersion: 1,
      },
    } as const;
    const tx = {
      source: { findFirst: vi.fn().mockResolvedValue(queuedSource) },
      taskRun: { findUnique: vi.fn().mockResolvedValue(taskRun), create: vi.fn() },
    };
    const repository = new PrismaSourcesRepository({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      repository.queueSourceAndCreateTaskRun({
        workspaceId: 'workspace-1',
        sourceId: 'source-1',
        taskRun: {
          id: 'new-task-run',
          workspaceId: 'workspace-1',
          taskType: 'source.transcribe',
          idempotencyKey: taskRun.idempotencyKey,
          payload: { ...taskRun.payload, taskRunId: 'new-task-run' },
        },
      }),
    ).resolves.toMatchObject({ taskRun: { id: 'process-task-existing' } });
    expect(tx.taskRun.create).not.toHaveBeenCalled();
  });

  it('cancels only active Source and TaskRun rows in one workspace transaction', async () => {
    const processingSource = { ...source, status: 'processing' };
    const cancelledSource = { ...source, status: 'cancelled' };
    const tx = {
      source: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(processingSource)
          .mockResolvedValue(cancelledSource),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskRun: {
        findMany: vi.fn().mockResolvedValue([{ status: 'processing' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const transaction = vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx));
    const repository = new PrismaSourcesRepository({ $transaction: transaction } as never);

    await expect(
      repository.cancelSourceAndTaskRuns('workspace-1', 'source-1'),
    ).resolves.toMatchObject({
      workspaceId: 'workspace-1',
      status: 'cancelled',
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(tx.source.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        id: 'source-1',
        status: { in: ['created', 'uploading', 'validating', 'uploaded', 'queued', 'processing'] },
        deletedAt: null,
      },
      data: { status: 'cancelled' },
    });
    expect(tx.taskRun.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        idempotencyKey: {
          in: [
            'source:source-1:validate:v1',
            'source:source-1:source.analyze:v1',
            'source:source-1:source.transcribe:v1',
          ],
        },
      },
    });
    expect(tx.taskRun.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        idempotencyKey: {
          in: [
            'source:source-1:validate:v1',
            'source:source-1:source.analyze:v1',
            'source:source-1:source.transcribe:v1',
          ],
        },
        status: { in: ['queued', 'processing'] },
      },
      data: {
        status: 'cancelled',
        errorCode: 'TASK_CANCELLED',
        errorMessage: '任务已取消',
      },
    });
  });

  it('allows cancellation after validation succeeded when the business task is still processing', async () => {
    const processingSource = { ...source, status: 'processing' };
    const cancelledSource = { ...source, status: 'cancelled' };
    const tx = {
      source: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(processingSource)
          .mockResolvedValue(cancelledSource),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      taskRun: {
        findMany: vi.fn().mockResolvedValue([
          { idempotencyKey: 'source:source-1:validate:v1', status: 'succeeded' },
          { idempotencyKey: 'source:source-1:source.transcribe:v1', status: 'processing' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const repository = new PrismaSourcesRepository({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      repository.cancelSourceAndTaskRuns('workspace-1', 'source-1'),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(tx.taskRun.updateMany).toHaveBeenCalledOnce();
    expect(tx.source.updateMany).toHaveBeenCalledOnce();
  });

  it('does not cancel a TaskRun when a concurrent Worker terminal state wins', async () => {
    const succeededSource = { ...source, status: 'succeeded' };
    const findFirst = vi.fn().mockResolvedValue(succeededSource);
    const tx = {
      source: {
        findFirst: vi.fn().mockResolvedValueOnce(source),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      taskRun: {
        findMany: vi.fn().mockResolvedValue([{ status: 'processing' }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const repository = new PrismaSourcesRepository({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      source: { findFirst },
    } as never);

    await expect(
      repository.cancelSourceAndTaskRuns('workspace-1', 'source-1'),
    ).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(tx.taskRun.updateMany).toHaveBeenCalledOnce();
    expect(findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1', id: 'source-1', deletedAt: null },
    });
  });

  it('returns an already cancelled Source without changing any TaskRun', async () => {
    const cancelledSource = { ...source, status: 'cancelled' };
    const tx = {
      source: { findFirst: vi.fn().mockResolvedValue(cancelledSource), updateMany: vi.fn() },
      taskRun: { findMany: vi.fn(), updateMany: vi.fn() },
    };
    const repository = new PrismaSourcesRepository({
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as never);

    await expect(
      repository.cancelSourceAndTaskRuns('workspace-1', 'source-1'),
    ).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(tx.source.updateMany).not.toHaveBeenCalled();
    expect(tx.taskRun.findMany).not.toHaveBeenCalled();
    expect(tx.taskRun.updateMany).not.toHaveBeenCalled();
  });
});
