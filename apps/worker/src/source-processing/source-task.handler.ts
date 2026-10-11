import {
  SOURCE_TASK_TYPES,
  createSourceTaskResult,
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
import type { SourceMediaValidator } from './source-media-validator.js';

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
    private readonly validator?: Pick<SourceMediaValidator, 'validate'>,
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

    if (canonical.taskType === 'source.validate') {
      if (!this.validator) {
        return this.recoverInfrastructureFailure(message, context);
      }
      try {
        const metadata = await this.validator.validate(source);
        if (metadata.durationSeconds !== null && typeof metadata.durationSeconds !== 'number') {
          throw {
            code: 'PROCESSOR_INVALID_INPUT',
            message: SAFE_FAILURE_MESSAGES.PROCESSOR_INVALID_INPUT,
            retryable: false,
          };
        }
        const verifiedMetadata = {
          durationSeconds: metadata.durationSeconds,
          contentHash: metadata.contentHash,
          detectedMimeType: metadata.detectedMimeType,
        };
        const stillProcessing = await this.taskRuns.findById(
          canonical.workspaceId,
          canonical.taskRunId,
        );
        if (!stillProcessing || stillProcessing.status !== 'processing') return stillProcessing;
        const completed = await this.taskRuns.transitionWithSource({
          workspaceId: canonical.workspaceId,
          sourceId: canonical.sourceId,
          taskRunId: canonical.taskRunId,
          expectedSourceStatus: 'validating',
          sourceStatus: 'uploaded',
          taskRunStatus: 'succeeded',
          result: createSourceTaskMessageResult(canonical.taskType, verifiedMetadata),
          sourceMetadata: {
            durationSeconds: verifiedMetadata.durationSeconds,
            contentHash: verifiedMetadata.contentHash,
            mimeType: verifiedMetadata.detectedMimeType,
          },
        });
        if (!completed) {
          const terminalTask = await this.returnTaskIfSourceAlreadyTerminal(message);
          return terminalTask ?? this.recoverInfrastructureFailure(message, context);
        }
        return this.taskRuns.findById(canonical.workspaceId, canonical.taskRunId);
      } catch (error) {
        const failure = isInvalidMediaError(error)
          ? {
              code: 'PROCESSOR_INVALID_INPUT' as const,
              message: SAFE_FAILURE_MESSAGES.PROCESSOR_INVALID_INPUT,
              retryable: false,
            }
          : mapProcessorError(error);
        return this.persistFailure(message, context, failure);
      }
    }

    let started: boolean;
    try {
      started = await this.sources.transitionStatus(
        canonical.workspaceId,
        canonical.sourceId,
        'queued',
        'processing',
      );
    } catch {
      return this.recoverInfrastructureFailure(message, context);
    }
    if (!started) return this.recoverInfrastructureFailure(message, context);

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

    let completed: boolean;
    try {
      completed = await this.taskRuns.transitionWithSource({
        workspaceId: canonical.workspaceId,
        sourceId: canonical.sourceId,
        taskRunId: canonical.taskRunId,
        expectedSourceStatus: 'processing',
        sourceStatus: 'succeeded',
        taskRunStatus: 'succeeded',
        result,
      });
    } catch {
      return this.recoverInfrastructureFailure(message, context);
    }
    if (!completed) {
      const terminalTask = await this.returnTaskIfSourceAlreadyTerminal(message);
      return terminalTask ?? this.recoverInfrastructureFailure(message, context);
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
    if (taskType === 'source.analyze') return this.processor.analyze(source);
    throw new Error('Unsupported source task type');
  }

  private async persistFailure(
    message: SourceTaskMessage,
    context: SourceTaskJobContext,
    failure: TaskFailure,
  ): Promise<TaskRunRecord | null> {
    if (failure.retryable && shouldRetry(context)) {
      const retrySourceStatuses =
        message.taskType === 'source.validate' ? 'validating' : (['processing', 'queued'] as const);
      try {
        const requeued = await this.taskRuns.transitionWithSource({
          workspaceId: message.workspaceId,
          sourceId: message.sourceId,
          taskRunId: message.taskRunId,
          expectedSourceStatus: retrySourceStatuses,
          sourceStatus: message.taskType === 'source.validate' ? 'validating' : 'queued',
          taskRunStatus: 'queued',
        });
        if (!requeued) {
          const terminalTask = await this.returnTaskIfSourceAlreadyTerminal(message);
          if (terminalTask !== undefined) return terminalTask;
          return this.recoverInfrastructureFailure(message, context);
        }
      } catch {
        throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
      }

      throw createSafeError(SAFE_FAILURE_MESSAGES[failure.code]);
    }

    try {
      const failed = await this.taskRuns.transitionWithSource({
        workspaceId: message.workspaceId,
        sourceId: message.sourceId,
        taskRunId: message.taskRunId,
        expectedSourceStatus:
          message.taskType === 'source.validate' ? 'validating' : ['processing', 'queued'],
        sourceStatus: 'failed',
        taskRunStatus: 'failed',
        failure,
      });
      if (!failed) {
        const terminalTask = await this.returnTaskIfSourceAlreadyTerminal(message);
        if (terminalTask !== undefined) return terminalTask;
        const source = await this.sources.findById(message.workspaceId, message.sourceId);
        if (source !== null) return this.recoverInfrastructureFailure(message, context);
        await this.taskRuns.markFailed(message.workspaceId, message.taskRunId, failure);
      }
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
        const requeued = await this.taskRuns.transitionWithSource({
          workspaceId: message.workspaceId,
          sourceId: message.sourceId,
          taskRunId: message.taskRunId,
          expectedSourceStatus:
            message.taskType === 'source.validate' ? 'validating' : ['processing', 'queued'],
          sourceStatus: message.taskType === 'source.validate' ? 'validating' : 'queued',
          taskRunStatus: 'queued',
        });
        if (!requeued) {
          const terminalTask = await this.returnTaskIfSourceAlreadyTerminal(message);
          if (terminalTask !== undefined) return terminalTask;
          throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
        }
      } catch {
        throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
      }

      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }

    try {
      const failed = await this.taskRuns.transitionWithSource({
        workspaceId: message.workspaceId,
        sourceId: message.sourceId,
        taskRunId: message.taskRunId,
        expectedSourceStatus:
          message.taskType === 'source.validate' ? 'validating' : ['processing', 'queued'],
        sourceStatus: 'failed',
        taskRunStatus: 'failed',
        failure: INFRASTRUCTURE_FAILURE,
      });
      if (!failed) {
        const terminalTask = await this.returnTaskIfSourceAlreadyTerminal(message);
        if (terminalTask !== undefined) return terminalTask;
        const source = await this.sources.findById(message.workspaceId, message.sourceId);
        if (source !== null)
          throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
        await this.taskRuns.markInfrastructureFailed(
          message.workspaceId,
          message.taskRunId,
          INFRASTRUCTURE_FAILURE,
        );
      }
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }

    try {
      return await this.taskRuns.findById(message.workspaceId, message.taskRunId);
    } catch {
      throw createSafeError(SAFE_FAILURE_MESSAGES.PROCESSOR_TEMPORARY_FAILURE);
    }
  }

  private async returnTaskIfSourceAlreadyTerminal(
    message: SourceTaskMessage,
  ): Promise<TaskRunRecord | null | undefined> {
    const source = await this.sources.findById(message.workspaceId, message.sourceId);
    if (!source || (source.status !== 'cancelled' && source.status !== 'succeeded')) {
      return undefined;
    }
    return this.taskRuns.findById(message.workspaceId, message.taskRunId);
  }
}

function isInvalidMediaError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'SOURCE_MEDIA_INVALID'
  );
}

function createSourceTaskMessageResult(
  taskType: SourceTaskType,
  metadata: { durationSeconds: number | null; contentHash: string; detectedMimeType: string },
): SourceTaskResult {
  return createSourceTaskResult({
    taskType,
    output: { ...metadata },
  });
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
