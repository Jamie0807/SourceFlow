import {
  SOURCE_TASK_TYPES,
  createSourceTaskMessage,
  type SourceTaskJobContext,
  type SourceTaskMessage,
  type SourceTaskResult,
  type SourceTaskType,
  type TaskFailure,
  type TaskFailureCode,
} from '@sourceflow/domain';

import type { TaskRunRecord, TaskRunStore } from '../task-runs/task-run.store.js';
import {
  mapProcessorError,
  type SourceLookup,
  type SourceProcessor,
  type SourceRecord,
} from './source-processor.js';

const SAFE_FAILURE_MESSAGES: Record<TaskFailureCode, string> = {
  SOURCE_NOT_FOUND: 'Source 不存在',
  TASK_CANCELLED: '任务已取消',
  PROCESSOR_INVALID_INPUT: '输入无效',
  PROCESSOR_TEMPORARY_FAILURE: '处理服务暂时不可用',
  PROCESSOR_UNKNOWN_FAILURE: '处理失败',
};

const INFRASTRUCTURE_FAILURE: TaskFailure = {
  code: 'PROCESSOR_TEMPORARY_FAILURE',
  message: SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE,
  retryable: true,
};

export class SourceTaskHandler {
  constructor(
    private readonly taskRuns: TaskRunStore,
    private readonly sources: SourceLookup,
    private readonly processor: SourceProcessor,
  ) {}

  async handle(
    message: SourceTaskMessage,
    context: SourceTaskJobContext,
  ): Promise<TaskRunRecord | null> {
    let queued: TaskRunRecord | null;
    try {
      queued = await this.taskRuns.findById(message.workspaceId, message.taskRunId);
    } catch {
      return this.handleStateReadFailure();
    }
    if (!queued) {
      return null;
    }
    if (queued.status !== 'queued') {
      return queued;
    }

    const queuedCanonical = parseCanonicalMessage(queued.payload);
    if (!queuedCanonical || !matchesQueuedMessage(queued, queuedCanonical, message)) {
      return this.claimAndPersistInvalid(message, context);
    }

    let claimed: TaskRunRecord | null;
    try {
      claimed = await this.taskRuns.claimProcessing(message.workspaceId, message.taskRunId);
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }
    if (!claimed) {
      return this.readCurrentAfterClaimMiss(message);
    }
    if (claimed.status !== 'processing') {
      return claimed;
    }

    const canonical = parseCanonicalMessage(claimed.payload);
    if (
      !canonical ||
      !matchesQueuedMessage(claimed, canonical, message) ||
      !sameMessage(queuedCanonical, canonical)
    ) {
      return this.persistFailure(message, context, {
        code: 'PROCESSOR_INVALID_INPUT',
        message: SAFE_FAILURE_MESSAGES.PROCESSOR_INVALID_INPUT,
        retryable: false,
      });
    }

    let source: SourceRecord | null;
    try {
      source = await this.sources.findById(canonical.workspaceId, canonical.sourceId);
    } catch {
      return this.recoverInfrastructureFailure(message, context);
    }

    let beforeProcessing: TaskRunRecord | null;
    try {
      beforeProcessing = await this.taskRuns.findById(canonical.workspaceId, canonical.taskRunId);
    } catch {
      return this.recoverInfrastructureFailure(message, context);
    }
    if (!beforeProcessing || beforeProcessing.status !== 'processing') {
      return beforeProcessing;
    }

    if (
      !source ||
      source.id !== canonical.sourceId ||
      source.workspaceId !== canonical.workspaceId
    ) {
      return this.persistFailure(message, context, {
        code: 'SOURCE_NOT_FOUND',
        message: SAFE_FAILURE_MESSAGES.SOURCE_NOT_FOUND,
        retryable: false,
      });
    }

    let result: SourceTaskResult;
    try {
      result = await this.process(canonical.taskType, source);
    } catch (error) {
      return this.persistFailure(message, context, mapProcessorError(error));
    }

    let beforeCompletion: TaskRunRecord | null;
    try {
      beforeCompletion = await this.taskRuns.findById(canonical.workspaceId, canonical.taskRunId);
    } catch {
      return this.recoverInfrastructureFailure(message, context);
    }
    if (!beforeCompletion || beforeCompletion.status !== 'processing') {
      return beforeCompletion;
    }

    try {
      await this.taskRuns.markSucceeded(canonical.workspaceId, canonical.taskRunId, result);
    } catch {
      return this.recoverInfrastructureFailure(message, context);
    }

    try {
      return await this.taskRuns.findById(canonical.workspaceId, canonical.taskRunId);
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }
  }

  private async claimAndPersistInvalid(
    message: SourceTaskMessage,
    context: SourceTaskJobContext,
  ): Promise<TaskRunRecord | null> {
    let claimed: TaskRunRecord | null;
    try {
      claimed = await this.taskRuns.claimProcessing(message.workspaceId, message.taskRunId);
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }
    if (!claimed) {
      return this.readCurrentAfterClaimMiss(message);
    }
    if (claimed.status !== 'processing') {
      return claimed;
    }

    const canonical = parseCanonicalMessage(claimed.payload);
    if (canonical && matchesQueuedMessage(claimed, canonical, message)) {
      return this.persistFailure(message, context, {
        code: 'PROCESSOR_INVALID_INPUT',
        message: SAFE_FAILURE_MESSAGES.PROCESSOR_INVALID_INPUT,
        retryable: false,
      });
    }

    return this.persistFailure(message, context, {
      code: 'PROCESSOR_INVALID_INPUT',
      message: SAFE_FAILURE_MESSAGES.PROCESSOR_INVALID_INPUT,
      retryable: false,
    });
  }

  private async handleStateReadFailure(): Promise<TaskRunRecord | null> {
    throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
  }

  private async readCurrentAfterClaimMiss(
    message: SourceTaskMessage,
  ): Promise<TaskRunRecord | null> {
    try {
      return await this.taskRuns.findById(message.workspaceId, message.taskRunId);
    } catch {
      return this.handleStateReadFailure();
    }
  }

  private async process(taskType: SourceTaskType, source: SourceRecord): Promise<SourceTaskResult> {
    if (taskType === 'source.transcribe') {
      return this.processor.transcribe(source);
    }
    return this.processor.analyze(source);
  }

  private async persistFailure(
    message: SourceTaskMessage,
    context: SourceTaskJobContext,
    failure: TaskFailure,
  ): Promise<TaskRunRecord | null> {
    if (failure.retryable && shouldRetry(context)) {
      try {
        await this.taskRuns.requeue(message.workspaceId, message.taskRunId);
      } catch {
        throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
      }

      throw createSafeError(SAFE_FAILURE_MESSAGES[failure.code]);
    }

    try {
      await this.taskRuns.markFailed(message.workspaceId, message.taskRunId, failure);
    } catch {
      return this.recoverInfrastructureFailure(message, context);
    }

    try {
      return await this.taskRuns.findById(message.workspaceId, message.taskRunId);
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }
  }

  private async recoverInfrastructureFailure(
    message: SourceTaskMessage,
    context: SourceTaskJobContext,
  ): Promise<TaskRunRecord | null> {
    if (shouldRetry(context)) {
      try {
        await this.taskRuns.requeue(message.workspaceId, message.taskRunId);
      } catch {
        throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
      }

      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }

    try {
      await this.taskRuns.markInfrastructureFailed(
        message.workspaceId,
        message.taskRunId,
        INFRASTRUCTURE_FAILURE,
      );
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }

    try {
      return await this.taskRuns.findById(message.workspaceId, message.taskRunId);
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }
  }
}

function parseCanonicalMessage(payload: Record<string, unknown>): SourceTaskMessage | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(payload))
  ) {
    return null;
  }

  const taskRunId = payload.taskRunId;
  const workspaceId = payload.workspaceId;
  const sourceId = payload.sourceId;
  const taskType = payload.taskType;
  const inputVersion = payload.inputVersion;
  if (
    typeof taskRunId !== 'string' ||
    taskRunId.length === 0 ||
    typeof workspaceId !== 'string' ||
    workspaceId.length === 0 ||
    typeof sourceId !== 'string' ||
    sourceId.length === 0 ||
    typeof taskType !== 'string' ||
    !SOURCE_TASK_TYPES.includes(taskType as SourceTaskType) ||
    typeof inputVersion !== 'number' ||
    !Number.isInteger(inputVersion) ||
    inputVersion <= 0
  ) {
    return null;
  }

  try {
    return createSourceTaskMessage({
      taskRunId,
      workspaceId,
      sourceId,
      taskType: taskType as SourceTaskType,
      inputVersion,
    });
  } catch {
    return null;
  }
}

function matchesQueuedMessage(
  claimed: TaskRunRecord,
  canonical: SourceTaskMessage,
  message: SourceTaskMessage,
): boolean {
  return (
    claimed.id === message.taskRunId &&
    claimed.workspaceId === message.workspaceId &&
    claimed.taskType === message.taskType &&
    canonical.taskRunId === message.taskRunId &&
    canonical.workspaceId === message.workspaceId &&
    canonical.sourceId === message.sourceId &&
    canonical.taskType === message.taskType &&
    canonical.inputVersion === message.inputVersion
  );
}

function sameMessage(left: SourceTaskMessage, right: SourceTaskMessage): boolean {
  return (
    left.taskRunId === right.taskRunId &&
    left.workspaceId === right.workspaceId &&
    left.sourceId === right.sourceId &&
    left.taskType === right.taskType &&
    left.inputVersion === right.inputVersion
  );
}

function shouldRetry(context: SourceTaskJobContext): boolean {
  return (
    Number.isInteger(context.attemptsMade) &&
    Number.isInteger(context.maxAttempts) &&
    context.attemptsMade >= 0 &&
    context.maxAttempts > 0 &&
    context.attemptsMade + 1 < context.maxAttempts
  );
}

function createSafeError(message: string): Error {
  return new Error(message);
}
