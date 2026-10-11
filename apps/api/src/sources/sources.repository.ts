export type SourceStatus =
  | 'created'
  | 'uploading'
  | 'validating'
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export const SourcesRepositoryToken = Symbol('SourcesRepository');

export type SourceRecord = Readonly<{
  id: string;
  workspaceId: string;
  uploadedById: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  contentHash: string;
  storageKey: string;
  status: SourceStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateSourceRecord = Readonly<{
  id: string;
  workspaceId: string;
  uploadedById: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  storageKey: string;
  status: 'uploading';
}>;

export type TaskRunStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export type SourceTaskRunRecord = Readonly<{
  id: string;
  workspaceId: string;
  taskType: SourceTaskType;
  idempotencyKey: string;
  status: TaskRunStatus;
  attempt: number;
  payload: SourceTaskMessage;
}>;

export type CreateSourceTaskRun = Readonly<{
  id: string;
  workspaceId: string;
  taskType: SourceTaskType;
  idempotencyKey: string;
  payload: SourceTaskMessage;
}>;

export type SourceTaskOperationResult = Readonly<{
  source: SourceRecord;
  taskRun: SourceTaskRunRecord;
}>;

export interface SourcesRepository {
  create(input: CreateSourceRecord): Promise<SourceRecord>;
  findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null>;
  findByContentHash(workspaceId: string, contentHash: string): Promise<SourceRecord | null>;
  updateStatus(
    workspaceId: string,
    sourceId: string,
    from: SourceStatus,
    to: SourceStatus,
  ): Promise<boolean>;
  findTaskRunByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<SourceTaskRunRecord | null>;
  findLatestTaskRunForSource(
    workspaceId: string,
    sourceId: string,
  ): Promise<SourceTaskRunRecord | null>;
  completeUploadAndCreateTaskRun(input: {
    workspaceId: string;
    sourceId: string;
    taskRun: CreateSourceTaskRun;
  }): Promise<SourceTaskOperationResult | null>;
  queueSourceAndCreateTaskRun(input: {
    workspaceId: string;
    sourceId: string;
    taskRun: CreateSourceTaskRun;
  }): Promise<SourceTaskOperationResult | null>;
  cancelSourceAndTaskRuns(workspaceId: string, sourceId: string): Promise<SourceRecord | null>;
}
import type { SourceTaskMessage, SourceTaskType } from '@sourceflow/domain';
