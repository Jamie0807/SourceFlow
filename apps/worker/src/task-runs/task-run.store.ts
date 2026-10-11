import type {
  SourceStatus,
  SourceTaskMessage,
  SourceTaskResult,
  SourceTaskType,
  TaskFailure,
} from '@sourceflow/domain';

export type TaskRunStatus = 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export type TaskRunRecord = Readonly<{
  id: string;
  workspaceId: string;
  taskType: SourceTaskType;
  idempotencyKey: string;
  status: TaskRunStatus;
  attempt: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
}>;

export interface TaskRunStore {
  createOrGetQueued(input: {
    workspaceId: string;
    taskType: SourceTaskType;
    idempotencyKey: string;
    payload: SourceTaskMessage;
  }): Promise<{ record: TaskRunRecord; created: boolean }>;
  claimProcessing(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null>;
  requeue(workspaceId: string, taskRunId: string): Promise<void>;
  markSucceeded(workspaceId: string, taskRunId: string, result: SourceTaskResult): Promise<void>;
  markFailed(workspaceId: string, taskRunId: string, failure: TaskFailure): Promise<void>;
  markInfrastructureFailed(
    workspaceId: string,
    taskRunId: string,
    failure: TaskFailure,
  ): Promise<void>;
  transitionWithSource(input: {
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
  }): Promise<boolean>;
  cancel(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null>;
  findById(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null>;
}
