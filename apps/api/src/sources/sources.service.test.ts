import { describe, expect, it, vi } from 'vitest';

import { AuthError } from '../auth/auth.errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { StorageNotFoundError, type StoragePort } from '../storage/storage.port.js';
import type { SourceTaskPublisher } from './source-task.publisher.js';
import type { SourcesRepository } from './sources.repository.js';
import { SourceError } from './sources.errors.js';
import { SourcesService } from './sources.service.js';
import type { CreateSourceDto } from './sources.dto.js';

const record = {
  id: 'source-1',
  workspaceId: 'workspace-1',
  uploadedById: 'user-1',
  fileName: 'episode.mp3',
  mimeType: 'audio/mpeg',
  sizeBytes: 42,
  durationSeconds: null,
  contentHash: Buffer.alloc(32, 1).toString('base64'),
  storageKey: 'workspaces/workspace-1/sources/source-1/original',
  status: 'uploading' as const,
  createdAt: new Date('2026-10-08T00:00:00.000Z'),
  updatedAt: new Date('2026-10-08T00:00:00.000Z'),
};

const input: CreateSourceDto = {
  fileName: 'episode.mp3',
  mimeType: 'audio/mpeg',
  sizeBytes: 42,
  contentHash: Buffer.alloc(32, 1).toString('base64'),
};

function createService(
  overrides: {
    repository?: Partial<SourcesRepository>;
    storage?: Partial<StoragePort>;
    publisher?: Partial<SourceTaskPublisher>;
  } = {},
) {
  const repository = {
    create: vi.fn().mockResolvedValue(record),
    findById: vi.fn().mockResolvedValue(record),
    findByContentHash: vi.fn().mockResolvedValue(null),
    findLatestTaskRunForSource: vi.fn().mockResolvedValue(null),
    updateStatus: vi.fn().mockResolvedValue(true),
    findTaskRunByIdempotencyKey: vi.fn().mockResolvedValue(null),
    completeUploadAndCreateTaskRun: vi.fn().mockResolvedValue(null),
    queueSourceAndCreateTaskRun: vi.fn().mockResolvedValue(null),
    cancelSourceAndTaskRuns: vi.fn().mockResolvedValue({ ...record, status: 'cancelled' }),
    ...overrides.repository,
  } as unknown as SourcesRepository;
  const storage = {
    createPresignedPut: vi.fn().mockResolvedValue({
      url: 'https://storage.example.test/put',
      headers: { 'content-type': 'audio/mpeg', 'x-amz-checksum-sha256': input.contentHash },
      expiresAt: new Date('2026-10-08T00:15:00.000Z'),
    }),
    headObject: vi.fn().mockResolvedValue({
      contentLength: record.sizeBytes,
      contentType: record.mimeType,
      checksumSha256: record.contentHash,
    }),
    ...overrides.storage,
  } as unknown as StoragePort;
  const publisher = {
    enqueue: vi.fn().mockResolvedValue('stable-job-id'),
    ...overrides.publisher,
  } as unknown as SourceTaskPublisher;

  return {
    service: new SourcesService(repository, storage, publisher),
    repository,
    storage,
    publisher,
  };
}

const owner: TenantContext = { userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' };
const editor: TenantContext = { ...owner, role: 'editor' };

describe('SourcesService', () => {
  it('includes the latest workspace-scoped TaskRun summary in Source GET', async () => {
    const taskRun = {
      id: 'task-run-1',
      workspaceId: owner.workspaceId,
      taskType: 'source.transcribe',
      idempotencyKey: 'source:source-1:transcribe:v1',
      status: 'processing',
      attempt: 2,
      payload: {
        taskRunId: 'task-run-1',
        workspaceId: owner.workspaceId,
        sourceId: 'source-1',
        taskType: 'source.transcribe',
        inputVersion: 1,
      },
    } as const;
    const { service, repository } = createService({
      repository: { findLatestTaskRunForSource: vi.fn().mockResolvedValue(taskRun) },
    });

    await expect(service.get(owner, 'source-1')).resolves.toMatchObject({
      sourceId: 'source-1',
      taskRun: {
        taskRunId: 'task-run-1',
        taskType: 'source.transcribe',
        status: 'processing',
        attempt: 2,
      },
    });
    expect(repository.findLatestTaskRunForSource).toHaveBeenCalledWith(
      owner.workspaceId,
      'source-1',
    );
  });

  it.each([owner, editor])(
    'creates an uploading source for a permitted member',
    async (context) => {
      const { service, repository, storage } = createService();

      const result = await service.create(context, input);
      const createInput = (repository.create as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0] as { id: string };

      expect(result).toEqual({
        sourceId: createInput.id,
        uploadUrl: 'https://storage.example.test/put',
        headers: { 'content-type': 'audio/mpeg', 'x-amz-checksum-sha256': input.contentHash },
        expiresAt: new Date('2026-10-08T00:15:00.000Z'),
      });
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: context.workspaceId,
          uploadedById: context.userId,
          status: 'uploading',
          fileName: input.fileName,
          contentHash: input.contentHash,
          storageKey: `workspaces/${context.workspaceId}/sources/${createInput.id}/original`,
        }),
      );
      expect(storage.createPresignedPut).toHaveBeenCalledWith({
        workspaceId: context.workspaceId,
        sourceId: createInput.id,
        contentType: input.mimeType,
        contentLength: input.sizeBytes,
        checksumSha256: input.contentHash,
        expiresInSeconds: 900,
      });
    },
  );

  it('rejects reviewer writes before storage or repository access', async () => {
    const { service, repository, storage } = createService();

    await expect(service.create({ ...owner, role: 'reviewer' }, input)).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    await expect(service.cancel({ ...owner, role: 'reviewer' }, 'source-1')).rejects.toMatchObject({
      code: 'AUTH_FORBIDDEN',
    });
    expect(repository.create).not.toHaveBeenCalled();
    expect(storage.createPresignedPut).not.toHaveBeenCalled();
  });

  it('rejects an empty membership context without querying the repository', async () => {
    const { service, repository } = createService();

    await expect(service.get({ ...owner, workspaceId: '' }, 'source-1')).rejects.toBeInstanceOf(
      AuthError,
    );
    expect(repository.findById).not.toHaveBeenCalled();
  });

  it('returns the same not-found error for missing and cross-workspace sources', async () => {
    const { service, repository } = createService({
      repository: { findById: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.get(owner, 'source-foreign')).rejects.toMatchObject({
      code: 'SOURCE_NOT_FOUND',
      status: 404,
    });
    expect(repository.findById).toHaveBeenCalledWith(owner.workspaceId, 'source-foreign');
  });

  it('rejects a duplicate hash within the current workspace without creating or signing', async () => {
    const { service, repository, storage } = createService({
      repository: { findByContentHash: vi.fn().mockResolvedValue(record) },
    });

    await expect(service.create(owner, input)).rejects.toBeInstanceOf(SourceError);
    await expect(service.create(owner, input)).rejects.toMatchObject({ code: 'SOURCE_DUPLICATE' });
    expect(repository.create).not.toHaveBeenCalled();
    expect(storage.createPresignedPut).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, fileName: 'episode.wav', mimeType: 'audio/mpeg' },
    { ...input, fileName: '   ' },
    { ...input, sizeBytes: 0 },
    { ...input, sizeBytes: 1_073_741_825 },
    { ...input, contentHash: 'not-a-sha256' },
  ])('rejects invalid source metadata before persistence', async (invalidInput) => {
    const { service, repository } = createService();

    await expect(service.create(owner, invalidInput)).rejects.toMatchObject({ status: 400 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each([
    ['clip.mp4', 'video/mp4'],
    ['episode.mp3', 'audio/mpeg'],
    ['recording.wav', 'audio/wav'],
    ['notes.txt', 'text/plain'],
  ])('accepts supported format pair %s / %s', async (fileName, mimeType) => {
    const { service, repository } = createService();

    await expect(
      service.create(owner, { ...input, fileName, mimeType, sizeBytes: 1_073_741_824 }),
    ).resolves.toHaveProperty('uploadUrl');
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ fileName, mimeType }));
  });

  it('maps the workspace content-hash composite uniqueness conflict to SOURCE_DUPLICATE', async () => {
    const { service, repository, storage } = createService({
      repository: {
        create: vi.fn().mockRejectedValue({
          code: 'P2002',
          meta: { target: ['workspaceId', 'contentHash'] },
        }),
      },
    });

    await expect(service.create(owner, input)).rejects.toMatchObject({ code: 'SOURCE_DUPLICATE' });
    expect(storage.createPresignedPut).toHaveBeenCalledOnce();
    expect(repository.create).toHaveBeenCalledOnce();
  });

  it.each([
    { code: 'P2002', meta: { target: 'Source_workspaceId_contentHash_key' } },
    { code: 'P2002', meta: { target: 'workspaceId,contentHash' } },
  ])('maps the exact composite unique target reported as a string', async (error) => {
    const { service } = createService({
      repository: { create: vi.fn().mockRejectedValue(error) },
    });

    await expect(service.create(owner, input)).rejects.toMatchObject({ code: 'SOURCE_DUPLICATE' });
  });

  it.each([
    { code: 'P2002', meta: { target: ['id'] } },
    { code: 'P2002', meta: { target: 'Source_id_key' } },
    { code: 'P2002', meta: {} },
    { code: 'P2002' },
  ])('propagates P2002 when its target is missing or unrelated', async (error) => {
    const { service } = createService({
      repository: { create: vi.fn().mockRejectedValue(error) },
    });

    await expect(service.create(owner, input)).rejects.toBe(error);
  });

  it.each(['episode\u0000.mp3', 'episode\u0001.mp3', 'episode\u007f.mp3', 'episode\u0085.mp3'])(
    'rejects a filename containing a control character before persistence',
    async (fileName) => {
      const { service, repository, storage } = createService();

      await expect(service.create(owner, { ...input, fileName })).rejects.toMatchObject({
        code: 'SOURCE_INVALID_INPUT',
      });
      expect(repository.create).not.toHaveBeenCalled();
      expect(storage.createPresignedPut).not.toHaveBeenCalled();
    },
  );

  it.each([owner, editor])(
    'allows a writer to cancel through a repository transaction and makes repeated cancellation idempotent',
    async (context) => {
      const { service, repository } = createService();

      await expect(service.cancel(context, 'source-1')).resolves.toMatchObject({
        status: 'cancelled',
      });
      expect(repository.cancelSourceAndTaskRuns).toHaveBeenCalledWith(
        context.workspaceId,
        'source-1',
      );

      const cancelled = { ...record, status: 'cancelled' as const };
      const repeated = createService({
        repository: { findById: vi.fn().mockResolvedValue(cancelled) },
      });
      await expect(repeated.service.cancel(owner, 'source-1')).resolves.toMatchObject({
        status: 'cancelled',
      });
      expect(repeated.repository.cancelSourceAndTaskRuns).not.toHaveBeenCalled();
    },
  );

  it('returns a conflict for a source status that cannot transition to cancelled', async () => {
    const { service, repository } = createService({
      repository: { findById: vi.fn().mockResolvedValue({ ...record, status: 'succeeded' }) },
    });

    await expect(service.cancel(owner, 'source-1')).rejects.toMatchObject({
      code: 'SOURCE_INVALID_STATE',
      status: 409,
    });
    expect(repository.cancelSourceAndTaskRuns).not.toHaveBeenCalled();
  });

  it('validates the uploaded object and publishes one validation task', async () => {
    const validatingSource = { ...record, status: 'validating' as const };
    const taskRun = {
      id: 'task-run-1',
      workspaceId: owner.workspaceId,
      taskType: 'source.validate',
      idempotencyKey: 'source:source-1:validate:v1',
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'task-run-1',
        workspaceId: owner.workspaceId,
        sourceId: record.id,
        taskType: 'source.validate',
        inputVersion: 1,
      },
    };
    const completeUploadAndCreateTaskRun = vi.fn().mockResolvedValue({
      source: validatingSource,
      taskRun,
    });
    const { service, storage, publisher } = createService({
      repository: {
        completeUploadAndCreateTaskRun,
      } as unknown as Partial<SourcesRepository>,
    });

    await expect(service.completeUpload(owner, record.id)).resolves.toEqual({
      source: expect.objectContaining({ sourceId: record.id, status: 'validating' }),
      taskRunId: taskRun.id,
    });
    expect(storage.headObject).toHaveBeenCalledWith({
      workspaceId: owner.workspaceId,
      sourceId: record.id,
    });
    expect(completeUploadAndCreateTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: owner.workspaceId,
        sourceId: record.id,
        taskRun: expect.objectContaining({
          idempotencyKey: 'source:source-1:validate:v1',
          taskType: 'source.validate',
          payload: expect.objectContaining({
            workspaceId: owner.workspaceId,
            sourceId: record.id,
            taskType: 'source.validate',
          }),
        }),
      }),
    );
    expect(publisher.enqueue).toHaveBeenCalledWith(taskRun.payload);
  });

  it('rejects a missing uploaded object without creating or publishing a TaskRun', async () => {
    const completeUploadAndCreateTaskRun = vi.fn();
    const { service, publisher } = createService({
      repository: {
        completeUploadAndCreateTaskRun,
      } as unknown as Partial<SourcesRepository>,
      storage: {
        headObject: vi
          .fn()
          .mockRejectedValue(
            new StorageNotFoundError({ workspaceId: owner.workspaceId, sourceId: record.id }),
          ),
      },
    });

    await expect(service.completeUpload(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_UPLOAD_INCOMPLETE',
    });
    expect(completeUploadAndCreateTaskRun).not.toHaveBeenCalled();
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('maps storage infrastructure failures to a redacted service-unavailable error', async () => {
    const { service, publisher } = createService({
      storage: { headObject: vi.fn().mockRejectedValue(new Error('MinIO host token=secret')) },
    });

    await expect(service.completeUpload(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_STORAGE_UNAVAILABLE',
      status: 503,
      message: expect.not.stringContaining('secret'),
    });
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    [{ contentLength: 41, contentType: record.mimeType, checksumSha256: record.contentHash }],
    [
      {
        contentLength: record.sizeBytes,
        contentType: 'audio/wav',
        checksumSha256: record.contentHash,
      },
    ],
    [{ contentLength: record.sizeBytes, contentType: record.mimeType, checksumSha256: 'wrong' }],
  ])('rejects uploaded metadata that differs from the Source declaration', async (metadata) => {
    const completeUploadAndCreateTaskRun = vi.fn();
    const { service, publisher } = createService({
      repository: {
        completeUploadAndCreateTaskRun,
      } as unknown as Partial<SourcesRepository>,
      storage: { headObject: vi.fn().mockResolvedValue(metadata) },
    });

    await expect(service.completeUpload(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_UPLOAD_INCOMPLETE',
    });
    expect(completeUploadAndCreateTaskRun).not.toHaveBeenCalled();
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('allows storage without checksum metadata so the Worker can verify it later', async () => {
    const taskRun = {
      id: 'task-run-no-checksum',
      workspaceId: owner.workspaceId,
      taskType: 'source.validate',
      idempotencyKey: `source:${record.id}:validate:v1`,
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'task-run-no-checksum',
        workspaceId: owner.workspaceId,
        sourceId: record.id,
        taskType: 'source.validate',
        inputVersion: 1,
      },
    };
    const completeUploadAndCreateTaskRun = vi.fn().mockResolvedValue({
      source: { ...record, status: 'validating' },
      taskRun,
    });
    const { service } = createService({
      repository: {
        completeUploadAndCreateTaskRun,
      } as unknown as Partial<SourcesRepository>,
      storage: {
        headObject: vi.fn().mockResolvedValue({
          contentLength: record.sizeBytes,
          contentType: record.mimeType,
        }),
      },
    });

    await expect(service.completeUpload(owner, record.id)).resolves.toMatchObject({
      source: { status: 'validating' },
      taskRunId: taskRun.id,
    });
  });

  it('reuses the validation TaskRun and safely republishes after a queue failure', async () => {
    const validatingSource = { ...record, status: 'validating' as const };
    const taskRun = {
      id: 'task-run-retry',
      workspaceId: owner.workspaceId,
      taskType: 'source.validate',
      idempotencyKey: `source:${record.id}:validate:v1`,
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'task-run-retry',
        workspaceId: owner.workspaceId,
        sourceId: record.id,
        taskType: 'source.validate',
        inputVersion: 1,
      },
    };
    const { service, repository, publisher } = createService({
      repository: {
        findById: vi.fn().mockResolvedValueOnce(record).mockResolvedValue(validatingSource),
        completeUploadAndCreateTaskRun: vi.fn().mockResolvedValue({
          source: validatingSource,
          taskRun,
        }),
        findTaskRunByIdempotencyKey: vi.fn().mockResolvedValue(taskRun),
      } as unknown as Partial<SourcesRepository>,
      publisher: {
        enqueue: vi
          .fn()
          .mockRejectedValueOnce(new Error('private redis failure'))
          .mockResolvedValue('job-id'),
      },
    });

    await expect(service.completeUpload(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_QUEUE_UNAVAILABLE',
    });
    await expect(service.completeUpload(owner, record.id)).resolves.toMatchObject({
      taskRunId: taskRun.id,
      source: { status: 'validating' },
    });
    expect(repository.completeUploadAndCreateTaskRun).toHaveBeenCalledOnce();
    expect(repository.findTaskRunByIdempotencyKey).toHaveBeenCalledWith(
      owner.workspaceId,
      `source:${record.id}:validate:v1`,
    );
    expect(publisher.enqueue).toHaveBeenCalledTimes(2);
  });

  it('rejects upload completion from an illegal Source state without touching storage', async () => {
    const { service, repository, storage } = createService({
      repository: { findById: vi.fn().mockResolvedValue({ ...record, status: 'cancelled' }) },
    });

    await expect(service.completeUpload(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_INVALID_STATE',
    });
    expect(repository.findTaskRunByIdempotencyKey).not.toHaveBeenCalled();
    expect(storage.headObject).not.toHaveBeenCalled();
  });

  it.each([
    { fileName: 'notes.txt', mimeType: 'text/plain', taskType: 'source.analyze' },
    { fileName: 'clip.mp4', mimeType: 'video/mp4', taskType: 'source.transcribe' },
    { fileName: 'episode.mp3', mimeType: 'audio/mpeg', taskType: 'source.transcribe' },
    { fileName: 'recording.wav', mimeType: 'audio/wav', taskType: 'source.transcribe' },
  ] as const)(
    'queues uploaded $fileName as $taskType',
    async ({ fileName, mimeType, taskType }) => {
      const uploadedSource = { ...record, fileName, mimeType, status: 'uploaded' as const };
      const taskRun = {
        id: 'process-task-run',
        workspaceId: owner.workspaceId,
        taskType,
        idempotencyKey: `source:${record.id}:${taskType}:v1`,
        status: 'queued',
        attempt: 0,
        payload: {
          taskRunId: 'process-task-run',
          workspaceId: owner.workspaceId,
          sourceId: record.id,
          taskType,
          inputVersion: 1,
        },
      };
      const queueSourceAndCreateTaskRun = vi.fn().mockResolvedValue({
        source: { ...uploadedSource, status: 'queued' },
        taskRun,
      });
      const { service, repository, publisher } = createService({
        repository: {
          findById: vi.fn().mockResolvedValue(uploadedSource),
          queueSourceAndCreateTaskRun,
        } as unknown as Partial<SourcesRepository>,
      });

      await expect(service.process(owner, record.id)).resolves.toMatchObject({
        source: { sourceId: record.id, status: 'queued' },
        taskRunId: taskRun.id,
      });
      expect(queueSourceAndCreateTaskRun).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: owner.workspaceId,
          sourceId: record.id,
          taskRun: expect.objectContaining({
            taskType,
            idempotencyKey: `source:${record.id}:${taskType}:v1`,
          }),
        }),
      );
      expect(repository.updateStatus).not.toHaveBeenCalled();
      expect(publisher.enqueue).toHaveBeenCalledWith(taskRun.payload);
    },
  );

  it('reuses the in-flight processing TaskRun on duplicate process requests', async () => {
    const processingSource = { ...record, status: 'processing' as const };
    const taskRun = {
      id: 'process-task-existing',
      workspaceId: owner.workspaceId,
      taskType: 'source.transcribe',
      idempotencyKey: `source:${record.id}:source.transcribe:v1`,
      status: 'processing',
      attempt: 1,
      payload: {
        taskRunId: 'process-task-existing',
        workspaceId: owner.workspaceId,
        sourceId: record.id,
        taskType: 'source.transcribe',
        inputVersion: 1,
      },
    };
    const { service, repository } = createService({
      repository: {
        findById: vi.fn().mockResolvedValue(processingSource),
        findTaskRunByIdempotencyKey: vi.fn().mockResolvedValue(taskRun),
      } as unknown as Partial<SourcesRepository>,
    });

    await expect(service.process(owner, record.id)).resolves.toMatchObject({
      source: { status: 'processing' },
      taskRunId: taskRun.id,
    });
    expect(repository.queueSourceAndCreateTaskRun).not.toHaveBeenCalled();
    expect(repository.findTaskRunByIdempotencyKey).toHaveBeenCalledWith(
      owner.workspaceId,
      `source:${record.id}:source.transcribe:v1`,
    );
  });

  it('rejects process requests until the Source has been validated and uploaded', async () => {
    const { service, repository, publisher } = createService({
      repository: { queueSourceAndCreateTaskRun: vi.fn() } as unknown as Partial<SourcesRepository>,
    });

    await expect(service.process(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_INVALID_STATE',
    });
    expect(repository.queueSourceAndCreateTaskRun).not.toHaveBeenCalled();
    expect(repository.findTaskRunByIdempotencyKey).not.toHaveBeenCalled();
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('does not dispatch unsupported audio MIME types', async () => {
    const unsupportedSource = { ...record, mimeType: 'audio/flac', status: 'uploaded' as const };
    const { service, repository, publisher } = createService({
      repository: {
        findById: vi.fn().mockResolvedValue(unsupportedSource),
      } as unknown as Partial<SourcesRepository>,
    });

    await expect(service.process(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_INVALID_STATE',
    });
    expect(repository.queueSourceAndCreateTaskRun).not.toHaveBeenCalled();
    expect(publisher.enqueue).not.toHaveBeenCalled();
  });

  it('keeps the queued TaskRun after a publisher failure and republishes it on retry', async () => {
    const uploadedSource = { ...record, status: 'uploaded' as const };
    const queuedSource = { ...record, status: 'queued' as const };
    const taskRun = {
      id: 'process-task-retry',
      workspaceId: owner.workspaceId,
      taskType: 'source.transcribe',
      idempotencyKey: `source:${record.id}:source.transcribe:v1`,
      status: 'queued',
      attempt: 0,
      payload: {
        taskRunId: 'process-task-retry',
        workspaceId: owner.workspaceId,
        sourceId: record.id,
        taskType: 'source.transcribe',
        inputVersion: 1,
      },
    };
    const queueSourceAndCreateTaskRun = vi.fn().mockResolvedValue({
      source: queuedSource,
      taskRun,
    });
    const publisherEnqueue = vi
      .fn()
      .mockRejectedValueOnce(new Error('private redis failure'))
      .mockResolvedValue('stable-job-id');
    const { service } = createService({
      repository: {
        findById: vi.fn().mockResolvedValueOnce(uploadedSource).mockResolvedValue(queuedSource),
        queueSourceAndCreateTaskRun,
        findTaskRunByIdempotencyKey: vi.fn().mockResolvedValue(taskRun),
      } as unknown as Partial<SourcesRepository>,
      publisher: { enqueue: publisherEnqueue },
    });

    await expect(service.process(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_QUEUE_UNAVAILABLE',
    });
    await expect(service.process(owner, record.id)).resolves.toMatchObject({
      taskRunId: taskRun.id,
      source: { status: 'queued' },
    });
    expect(queueSourceAndCreateTaskRun).toHaveBeenCalledOnce();
    expect(publisherEnqueue).toHaveBeenCalledTimes(2);
  });

  it('cancels the Source and active TaskRun through the repository transaction without deleting the object', async () => {
    const cancelSourceAndTaskRuns = vi.fn().mockResolvedValue({
      ...record,
      status: 'cancelled',
    });
    const deleteObject = vi.fn();
    const { service, storage } = createService({
      repository: {
        findById: vi.fn().mockResolvedValue({ ...record, status: 'processing' }),
        cancelSourceAndTaskRuns,
      } as unknown as Partial<SourcesRepository>,
      storage: { deleteObject },
    });

    await expect(service.cancel(owner, record.id)).resolves.toMatchObject({ status: 'cancelled' });
    expect(cancelSourceAndTaskRuns).toHaveBeenCalledWith(owner.workspaceId, record.id);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('does not cancel a failed terminal Source', async () => {
    const cancelSourceAndTaskRuns = vi.fn();
    const { service } = createService({
      repository: {
        findById: vi.fn().mockResolvedValue({ ...record, status: 'failed' }),
        cancelSourceAndTaskRuns,
      } as unknown as Partial<SourcesRepository>,
    });

    await expect(service.cancel(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_INVALID_STATE',
    });
    expect(cancelSourceAndTaskRuns).not.toHaveBeenCalled();
  });

  it('preserves a Worker terminal result when cancellation loses a race', async () => {
    const cancelSourceAndTaskRuns = vi.fn().mockResolvedValue({ ...record, status: 'succeeded' });
    const { service } = createService({
      repository: {
        findById: vi.fn().mockResolvedValue({ ...record, status: 'processing' }),
        cancelSourceAndTaskRuns,
      } as unknown as Partial<SourcesRepository>,
    });

    await expect(service.cancel(owner, record.id)).rejects.toMatchObject({
      code: 'SOURCE_INVALID_STATE',
    });
    expect(cancelSourceAndTaskRuns).toHaveBeenCalledWith(owner.workspaceId, record.id);
  });

  it.each(['completeUpload', 'process', 'cancel'] as const)(
    'returns the tenant-safe not-found response for cross-workspace %s',
    async (operationName) => {
      const { service, repository, storage, publisher } = createService({
        repository: { findById: vi.fn().mockResolvedValue(null) },
      });
      const operation = service[operationName] as (
        context: TenantContext,
        sourceId: string,
      ) => Promise<unknown>;

      await expect(
        operation.call(service, owner, 'source-from-another-workspace'),
      ).rejects.toMatchObject({
        code: 'SOURCE_NOT_FOUND',
        status: 404,
      });
      expect(repository.findById).toHaveBeenCalledWith(
        owner.workspaceId,
        'source-from-another-workspace',
      );
      expect(storage.headObject).not.toHaveBeenCalled();
      expect(publisher.enqueue).not.toHaveBeenCalled();
    },
  );
});
