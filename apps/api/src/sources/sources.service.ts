import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { createSourceTaskMessage, type SourceTaskType } from '@sourceflow/domain';

import { AuthError } from '../auth/auth.errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { StorageNotFoundError, STORAGE_PORT } from '../storage/storage.port.js';
import { buildSourceObjectKey } from '../storage/storage.port.js';
import type { StoragePort } from '../storage/storage.port.js';
import { SourceError } from './sources.errors.js';
import { SOURCE_TASK_PUBLISHER } from './source-task.publisher.js';
import type { SourceTaskPublisher } from './source-task.publisher.js';
import { parseCreateSourceDto } from './sources.dto.js';
import { SourcesRepositoryToken } from './sources.repository.js';
import type {
  CreateSourceTaskRun,
  SourceRecord,
  SourceTaskRunRecord,
  SourcesRepository,
} from './sources.repository.js';

const PRESIGNED_PUT_TTL_SECONDS = 900;
const MAX_SOURCE_SIZE_BYTES = 1_073_741_824;
const VALIDATION_IDEMPOTENCY_KEY = (sourceId: string) => `source:${sourceId}:validate:v1`;
const PROCESS_TASK_TYPE = (mimeType: string): SourceTaskType | null => {
  if (mimeType === 'text/plain') return 'source.analyze';
  if (
    mimeType === 'video/mp4' ||
    mimeType === 'audio/mpeg' ||
    mimeType === 'audio/mp3' ||
    mimeType === 'audio/wav' ||
    mimeType === 'audio/wave' ||
    mimeType === 'audio/x-wav'
  ) {
    return 'source.transcribe';
  }
  return null;
};
const SOURCE_HASH_UNIQUE_CONSTRAINT = 'Source_workspaceId_contentHash_key';
const SOURCE_HASH_UNIQUE_FIELDS = ['workspaceId', 'contentHash'] as const;
const CONTROL_CHARACTERS = /\p{Cc}/u;
const CANCELLABLE_STATUSES = new Set<SourceRecord['status']>([
  'created',
  'uploading',
  'validating',
  'uploaded',
  'queued',
  'processing',
]);
const MIME_FORMATS: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'text/plain': 'txt',
};

export type SourceView = Readonly<{
  sourceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  status: SourceRecord['status'];
  createdAt: Date;
  updatedAt: Date;
  taskRun?: Readonly<{
    taskRunId: string;
    taskType: SourceTaskRunRecord['taskType'];
    status: SourceTaskRunRecord['status'];
    attempt: number;
  }> | null;
}>;

@Injectable()
export class SourcesService {
  constructor(
    @Inject(SourcesRepositoryToken) private readonly repository: SourcesRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(SOURCE_TASK_PUBLISHER) private readonly publisher: SourceTaskPublisher,
  ) {}

  async create(
    context: TenantContext,
    input: unknown,
  ): Promise<{
    sourceId: string;
    uploadUrl: string;
    headers: Readonly<Record<string, string>>;
    expiresAt: Date;
  }> {
    assertMembership(context);
    assertWriter(context);

    const metadata = parseInput(input);
    const duplicate = await this.repository.findByContentHash(
      context.workspaceId,
      metadata.contentHash,
    );
    if (duplicate !== null) throw new SourceError('SOURCE_DUPLICATE');

    const sourceId = randomUUID();
    const storageKey = buildSourceObjectKey({ workspaceId: context.workspaceId, sourceId });
    const presigned = await this.storage.createPresignedPut({
      workspaceId: context.workspaceId,
      sourceId,
      contentType: metadata.mimeType,
      contentLength: metadata.sizeBytes,
      checksumSha256: metadata.contentHash,
      expiresInSeconds: PRESIGNED_PUT_TTL_SECONDS,
    });

    try {
      await this.repository.create({
        id: sourceId,
        workspaceId: context.workspaceId,
        uploadedById: context.userId,
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        contentHash: metadata.contentHash,
        storageKey,
        status: 'uploading',
      });
    } catch (error) {
      if (isWorkspaceContentHashUniqueConstraint(error)) {
        throw new SourceError('SOURCE_DUPLICATE');
      }
      throw error;
    }

    return {
      sourceId,
      uploadUrl: presigned.url,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
    };
  }

  async get(context: TenantContext, sourceId: string): Promise<SourceView> {
    assertMembership(context);
    const source = await this.repository.findById(context.workspaceId, sourceId);
    if (source === null) throw new SourceError('SOURCE_NOT_FOUND');
    const taskRun = await this.repository.findLatestTaskRunForSource(context.workspaceId, sourceId);
    return toSourceView(source, taskRun);
  }

  async completeUpload(
    context: TenantContext,
    sourceId: string,
  ): Promise<{ source: SourceView; taskRunId: string }> {
    assertMembership(context);
    assertWriter(context);

    const source = await this.repository.findById(context.workspaceId, sourceId);
    if (source === null) throw new SourceError('SOURCE_NOT_FOUND');

    const idempotencyKey = VALIDATION_IDEMPOTENCY_KEY(sourceId);
    let taskRun: SourceTaskRunRecord;
    let resultSource = source;

    if (source.status === 'uploading') {
      let metadata;
      try {
        metadata = await this.storage.headObject({ workspaceId: context.workspaceId, sourceId });
      } catch (error) {
        throw new SourceError(
          error instanceof StorageNotFoundError
            ? 'SOURCE_UPLOAD_INCOMPLETE'
            : 'SOURCE_STORAGE_UNAVAILABLE',
        );
      }

      if (
        !Number.isSafeInteger(metadata.contentLength) ||
        metadata.contentLength! <= 0 ||
        metadata.contentLength! > MAX_SOURCE_SIZE_BYTES ||
        metadata.contentLength !== source.sizeBytes ||
        metadata.contentType?.trim().toLowerCase() !== source.mimeType.trim().toLowerCase() ||
        (metadata.checksumSha256 !== undefined && metadata.checksumSha256 !== source.contentHash)
      ) {
        throw new SourceError('SOURCE_UPLOAD_INCOMPLETE');
      }

      const taskRunId = randomUUID();
      const payload = createSourceTaskMessage({
        taskRunId,
        workspaceId: context.workspaceId,
        sourceId,
        taskType: 'source.validate',
        inputVersion: 1,
      });
      const taskRunInput: CreateSourceTaskRun = {
        id: taskRunId,
        workspaceId: context.workspaceId,
        taskType: 'source.validate',
        idempotencyKey,
        payload,
      };
      const completed = await this.repository.completeUploadAndCreateTaskRun({
        workspaceId: context.workspaceId,
        sourceId,
        taskRun: taskRunInput,
      });
      if (completed === null) {
        const latest = await this.repository.findById(context.workspaceId, sourceId);
        if (latest === null) throw new SourceError('SOURCE_NOT_FOUND');
        if (latest.status === 'validating' || latest.status === 'uploaded') {
          const existing = await this.repository.findTaskRunByIdempotencyKey(
            context.workspaceId,
            idempotencyKey,
          );
          if (
            existing !== null &&
            isExpectedTaskRun(
              existing,
              context.workspaceId,
              sourceId,
              'source.validate',
              idempotencyKey,
            )
          ) {
            taskRun = existing;
            resultSource = latest;
          } else {
            throw new SourceError('SOURCE_INVALID_STATE');
          }
        } else {
          throw new SourceError('SOURCE_INVALID_STATE');
        }
      } else {
        taskRun = completed.taskRun;
        resultSource = completed.source;
      }
    } else if (source.status === 'validating' || source.status === 'uploaded') {
      const existing = await this.repository.findTaskRunByIdempotencyKey(
        context.workspaceId,
        idempotencyKey,
      );
      if (
        existing === null ||
        !isExpectedTaskRun(
          existing,
          context.workspaceId,
          sourceId,
          'source.validate',
          idempotencyKey,
        )
      ) {
        throw new SourceError('SOURCE_INVALID_STATE');
      }
      taskRun = existing;
    } else {
      throw new SourceError('SOURCE_INVALID_STATE');
    }

    if (
      !isExpectedTaskRun(taskRun, context.workspaceId, sourceId, 'source.validate', idempotencyKey)
    ) {
      throw new SourceError('SOURCE_INVALID_STATE');
    }
    try {
      await this.publisher.enqueue(taskRun.payload);
    } catch {
      throw new SourceError('SOURCE_QUEUE_UNAVAILABLE');
    }
    return { source: toSourceView(resultSource), taskRunId: taskRun.id };
  }

  async process(
    context: TenantContext,
    sourceId: string,
  ): Promise<{ source: SourceView; taskRunId: string }> {
    assertMembership(context);
    assertWriter(context);

    const source = await this.repository.findById(context.workspaceId, sourceId);
    if (source === null) throw new SourceError('SOURCE_NOT_FOUND');
    const taskType = PROCESS_TASK_TYPE(source.mimeType);
    if (taskType === null) throw new SourceError('SOURCE_INVALID_STATE');
    const idempotencyKey = `source:${sourceId}:${taskType}:v1`;
    let taskRun: SourceTaskRunRecord;
    let resultSource = source;

    if (source.status === 'uploaded') {
      const taskRunId = randomUUID();
      const payload = createSourceTaskMessage({
        taskRunId,
        workspaceId: context.workspaceId,
        sourceId,
        taskType,
        inputVersion: 1,
      });
      const queued = await this.repository.queueSourceAndCreateTaskRun({
        workspaceId: context.workspaceId,
        sourceId,
        taskRun: {
          id: taskRunId,
          workspaceId: context.workspaceId,
          taskType,
          idempotencyKey,
          payload,
        },
      });
      if (queued === null) {
        const latest = await this.repository.findById(context.workspaceId, sourceId);
        if (latest === null) throw new SourceError('SOURCE_NOT_FOUND');
        if (latest.status !== 'queued' && latest.status !== 'processing') {
          throw new SourceError('SOURCE_INVALID_STATE');
        }
        const existing = await this.repository.findTaskRunByIdempotencyKey(
          context.workspaceId,
          idempotencyKey,
        );
        if (
          existing === null ||
          !isExpectedTaskRun(existing, context.workspaceId, sourceId, taskType, idempotencyKey)
        ) {
          throw new SourceError('SOURCE_INVALID_STATE');
        }
        taskRun = existing;
        resultSource = latest;
      } else {
        taskRun = queued.taskRun;
        resultSource = queued.source;
      }
    } else if (source.status === 'queued' || source.status === 'processing') {
      const existing = await this.repository.findTaskRunByIdempotencyKey(
        context.workspaceId,
        idempotencyKey,
      );
      if (
        existing === null ||
        !isExpectedTaskRun(existing, context.workspaceId, sourceId, taskType, idempotencyKey)
      ) {
        throw new SourceError('SOURCE_INVALID_STATE');
      }
      taskRun = existing;
      if (taskRun.status !== 'queued' && taskRun.status !== 'processing') {
        throw new SourceError('SOURCE_INVALID_STATE');
      }
    } else {
      throw new SourceError('SOURCE_INVALID_STATE');
    }

    if (!isExpectedTaskRun(taskRun, context.workspaceId, sourceId, taskType, idempotencyKey)) {
      throw new SourceError('SOURCE_INVALID_STATE');
    }
    try {
      await this.publisher.enqueue(taskRun.payload);
    } catch {
      throw new SourceError('SOURCE_QUEUE_UNAVAILABLE');
    }
    return { source: toSourceView(resultSource), taskRunId: taskRun.id };
  }

  async cancel(context: TenantContext, sourceId: string): Promise<SourceView> {
    assertMembership(context);
    assertWriter(context);

    const source = await this.repository.findById(context.workspaceId, sourceId);
    if (source === null) throw new SourceError('SOURCE_NOT_FOUND');
    if (source.status === 'cancelled') return toSourceView(source);
    if (!CANCELLABLE_STATUSES.has(source.status)) {
      throw new SourceError('SOURCE_INVALID_STATE');
    }

    const latest = await this.repository.cancelSourceAndTaskRuns(context.workspaceId, sourceId);
    if (latest === null) throw new SourceError('SOURCE_NOT_FOUND');
    if (latest.status === 'cancelled') return toSourceView(latest);
    throw new SourceError('SOURCE_INVALID_STATE');
  }
}

function parseInput(input: unknown) {
  let metadata;
  try {
    metadata = parseCreateSourceDto(input);
  } catch {
    throw new SourceError('SOURCE_INVALID_INPUT');
  }

  const fileName = metadata.fileName.trim();
  const mimeType = metadata.mimeType.trim().toLowerCase();
  const extension = fileName.match(/\.([a-z0-9]+)$/iu)?.[1]?.toLowerCase();
  if (
    CONTROL_CHARACTERS.test(metadata.fileName) ||
    fileName.length === 0 ||
    extension === undefined ||
    MIME_FORMATS[mimeType] !== extension ||
    !Number.isSafeInteger(metadata.sizeBytes) ||
    metadata.sizeBytes < 1 ||
    metadata.sizeBytes > MAX_SOURCE_SIZE_BYTES ||
    !isCanonicalSha256Base64(metadata.contentHash)
  ) {
    throw new SourceError('SOURCE_INVALID_INPUT');
  }

  return { ...metadata, fileName, mimeType };
}

function isCanonicalSha256Base64(value: string): boolean {
  return (
    /^[A-Za-z0-9+/]{43}=$/u.test(value) &&
    Buffer.from(value, 'base64').byteLength === 32 &&
    Buffer.from(value, 'base64').toString('base64') === value
  );
}

function assertMembership(context: TenantContext): void {
  if (
    context === undefined ||
    context === null ||
    typeof context.userId !== 'string' ||
    context.userId.trim().length === 0 ||
    typeof context.workspaceId !== 'string' ||
    context.workspaceId.trim().length === 0
  ) {
    throw new AuthError('AUTH_FORBIDDEN');
  }
}

function assertWriter(context: TenantContext): void {
  if (context.role !== 'owner' && context.role !== 'editor') {
    throw new AuthError('AUTH_FORBIDDEN');
  }
}

function toSourceView(source: SourceRecord, taskRun?: SourceTaskRunRecord | null): SourceView {
  return {
    sourceId: source.id,
    fileName: source.fileName,
    mimeType: source.mimeType,
    sizeBytes: source.sizeBytes,
    durationSeconds: source.durationSeconds,
    status: source.status,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    ...(taskRun === undefined
      ? {}
      : {
          taskRun:
            taskRun === null
              ? null
              : {
                  taskRunId: taskRun.id,
                  taskType: taskRun.taskType,
                  status: taskRun.status,
                  attempt: taskRun.attempt,
                },
        }),
  };
}

function isExpectedTaskRun(
  taskRun: SourceTaskRunRecord,
  workspaceId: string,
  sourceId: string,
  taskType: SourceTaskType,
  idempotencyKey: string,
): boolean {
  return (
    taskRun.workspaceId === workspaceId &&
    taskRun.taskType === taskType &&
    taskRun.idempotencyKey === idempotencyKey &&
    taskRun.payload.workspaceId === workspaceId &&
    taskRun.payload.sourceId === sourceId &&
    taskRun.payload.taskRunId === taskRun.id &&
    taskRun.payload.taskType === taskType
  );
}

function isWorkspaceContentHashUniqueConstraint(error: unknown): boolean {
  if (!isRecord(error) || error.code !== 'P2002' || !isRecord(error.meta)) return false;

  const target = error.meta.target;
  if (Array.isArray(target)) {
    return (
      target.length === SOURCE_HASH_UNIQUE_FIELDS.length &&
      target.every((field, index) => field === SOURCE_HASH_UNIQUE_FIELDS[index])
    );
  }

  return target === SOURCE_HASH_UNIQUE_CONSTRAINT || target === SOURCE_HASH_UNIQUE_FIELDS.join(',');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
