import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';

import type {
  SourceTaskMessage,
  SourceTaskResult,
  TaskFailure,
  TaskFailureCode,
} from '@sourceflow/domain';

import {
  MockSourceProcessor,
  type SourceLookup,
  type SourceProcessor,
  type SourceRecord,
} from './source-processor.js';
import { SourceTaskHandler } from './source-task.handler.js';
import type { TaskRunRecord, TaskRunStatus, TaskRunStore } from '../task-runs/task-run.store.js';

const source: SourceRecord = {
  id: 'source-1',
  workspaceId: 'workspace-a',
  status: 'uploaded',
  storageKey: 'sources/source-1.mp4',
  contentHash: 'hash-1',
  mimeType: 'video/mp4',
  sizeBytes: 128,
};

const transcribeMessage: SourceTaskMessage = {
  taskRunId: 'task-transcribe',
  workspaceId: 'workspace-a',
  sourceId: source.id,
  taskType: 'source.transcribe',
  inputVersion: 1,
};

const analyzeMessage: SourceTaskMessage = {
  ...transcribeMessage,
  taskRunId: 'task-analyze',
  taskType: 'source.analyze',
};

const validationMessage: SourceTaskMessage = {
  ...transcribeMessage,
  taskRunId: 'task-validate',
  taskType: 'source.validate',
};

const safeMessages: Record<TaskFailureCode, string> = {
  SOURCE_NOT_FOUND: 'Source 不存在',
  TASK_CANCELLED: '任务已取消',
  PROCESSOR_INVALID_INPUT: '输入无效',
  PROCESSOR_TEMPORARY_FAILURE: '处理服务暂时不可用',
  PROCESSOR_UNKNOWN_FAILURE: '处理失败',
};

class FakeSourceLookup implements SourceLookup {
  readonly calls: Array<{ workspaceId: string; sourceId: string }> = [];

  constructor(private readonly sources: SourceRecord[] = [source]) {}

  async findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null> {
    this.calls.push({ workspaceId, sourceId });
    return (
      this.sources.find(
        (candidate) => candidate.workspaceId === workspaceId && candidate.id === sourceId,
      ) ?? null
    );
  }

  async transitionStatus(): Promise<boolean> {
    return true;
  }

  async completeValidation(): Promise<boolean> {
    return true;
  }
}

class FailOnceSourceLookup implements SourceLookup {
  constructor(private readonly failure: Error) {}

  private failed = false;

  async findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null> {
    if (!this.failed) {
      this.failed = true;
      throw this.failure;
    }

    return workspaceId === source.workspaceId && sourceId === source.id ? source : null;
  }

  async transitionStatus(): Promise<boolean> {
    return true;
  }

  async completeValidation(): Promise<boolean> {
    return true;
  }
}

class FakeTaskRunStore implements TaskRunStore {
  requeued = 0;
  claimPayload: Record<string, unknown> | undefined;
  claimStatusAfterUpdate: TaskRunStatus | undefined;
  claimMissStatus: TaskRunStatus | undefined;
  claimErrorStatus: TaskRunStatus | undefined;
  claimError: unknown;
  findErrors: unknown[] = [];
  requeueError: unknown;
  markFailedError: unknown;
  markInfrastructureFailedError: unknown;
  markSucceededError: unknown;
  readonly records = new Map<string, TaskRunRecord>();
  readonly sourceTransitions: Parameters<TaskRunStore['transitionWithSource']>[0][] = [];
  private sourceLookup?: SourceLookup;

  constructor(messages: SourceTaskMessage[]) {
    for (const message of messages) {
      this.records.set(message.taskRunId, this.createRecord(message));
    }
  }

  bindSourceLookup(sourceLookup: SourceLookup): void {
    this.sourceLookup = sourceLookup;
  }

  setStatus(taskRunId: string, status: TaskRunStatus): void {
    const record = this.records.get(taskRunId);
    if (!record) throw new Error(`Unknown task ${taskRunId}`);
    this.records.set(taskRunId, {
      ...record,
      status,
      errorCode: status === 'cancelled' ? 'TASK_CANCELLED' : record.errorCode,
      errorMessage: status === 'cancelled' ? safeMessages.TASK_CANCELLED : record.errorMessage,
    });
  }

  async createOrGetQueued(input: {
    workspaceId: string;
    taskType: SourceTaskMessage['taskType'];
    idempotencyKey: string;
    payload: SourceTaskMessage;
  }): Promise<{ record: TaskRunRecord; created: boolean }> {
    const existing = this.records.get(input.payload.taskRunId);
    if (existing) return { record: existing, created: false };
    const record = this.createRecord(input.payload);
    this.records.set(record.id, record);
    return { record, created: true };
  }

  async claimProcessing(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null> {
    if (this.claimError) {
      if (this.claimErrorStatus) {
        this.setStatus(taskRunId, this.claimErrorStatus);
      }
      throw this.claimError;
    }
    if (this.claimMissStatus) {
      this.setStatus(taskRunId, this.claimMissStatus);
      return null;
    }

    const record = this.records.get(taskRunId);
    if (!record || record.workspaceId !== workspaceId || record.status !== 'queued') return null;
    const status = this.claimStatusAfterUpdate ?? 'processing';
    const claimed = {
      ...record,
      status,
      attempt: record.attempt + 1,
      payload: this.claimPayload ?? record.payload,
    };
    this.records.set(taskRunId, claimed);
    return claimed;
  }

  async requeue(workspaceId: string, taskRunId: string): Promise<void> {
    if (this.requeueError) {
      throw this.requeueError;
    }

    const record = this.requireRecord(workspaceId, taskRunId);
    if (record.status === 'processing') {
      this.requeued += 1;
      this.records.set(taskRunId, { ...record, status: 'queued' });
    }
  }

  async markSucceeded(
    workspaceId: string,
    taskRunId: string,
    result: SourceTaskResult,
  ): Promise<void> {
    if (this.markSucceededError) {
      throw this.markSucceededError;
    }

    const record = this.requireRecord(workspaceId, taskRunId);
    if (record.status === 'processing') {
      this.records.set(taskRunId, {
        ...record,
        status: 'succeeded',
        result: { ...result },
        errorCode: null,
        errorMessage: null,
      });
    }
  }

  async markFailed(workspaceId: string, taskRunId: string, failure: TaskFailure): Promise<void> {
    if (this.markFailedError) {
      throw this.markFailedError;
    }

    const record = this.requireRecord(workspaceId, taskRunId);
    if (record.status === 'processing') {
      this.records.set(taskRunId, {
        ...record,
        status: 'failed',
        errorCode: failure.code,
        errorMessage: safeMessages[failure.code],
      });
    }
  }

  async markInfrastructureFailed(
    workspaceId: string,
    taskRunId: string,
    failure: TaskFailure,
  ): Promise<void> {
    if (this.markInfrastructureFailedError) {
      throw this.markInfrastructureFailedError;
    }

    const record = this.requireRecord(workspaceId, taskRunId);
    if (record.status === 'queued' || record.status === 'processing') {
      this.records.set(taskRunId, {
        ...record,
        status: 'failed',
        errorCode: failure.code,
        errorMessage: safeMessages[failure.code],
      });
    }
  }

  async transitionWithSource(
    input: Parameters<TaskRunStore['transitionWithSource']>[0],
  ): Promise<boolean> {
    this.sourceTransitions.push(input);
    const record = this.records.get(input.taskRunId);
    if (
      record === undefined ||
      record.workspaceId !== input.workspaceId ||
      record.status !== 'processing'
    ) {
      return false;
    }

    if (input.taskRunStatus === 'queued' && this.requeueError) throw this.requeueError;
    if (input.taskRunStatus === 'failed' && this.markInfrastructureFailedError) {
      throw this.markInfrastructureFailedError;
    }
    if (input.taskRunStatus === 'failed' && this.markFailedError) throw this.markFailedError;
    if (input.taskRunStatus === 'succeeded' && this.markSucceededError) {
      throw this.markSucceededError;
    }

    if (this.sourceLookup) {
      let sourceUpdated = false;
      const expectedStatuses = Array.isArray(input.expectedSourceStatus)
        ? input.expectedSourceStatus
        : [input.expectedSourceStatus];
      for (const expectedStatus of expectedStatuses) {
        sourceUpdated = input.sourceMetadata
          ? await this.sourceLookup.completeValidation(
              input.workspaceId,
              input.sourceId,
              input.sourceMetadata,
            )
          : await this.sourceLookup.transitionStatus(
              input.workspaceId,
              input.sourceId,
              expectedStatus,
              input.sourceStatus,
            );
        if (sourceUpdated) break;
      }
      if (!sourceUpdated) return false;
    }

    this.records.set(input.taskRunId, {
      ...record,
      status: input.taskRunStatus,
      result: input.result === undefined ? record.result : { ...input.result },
      errorCode: input.failure?.code ?? null,
      errorMessage: input.failure === undefined ? null : safeMessages[input.failure.code],
    });
    if (input.taskRunStatus === 'queued') this.requeued += 1;
    return true;
  }

  async cancel(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null> {
    const record = this.requireRecord(workspaceId, taskRunId);
    if (record.status === 'queued' || record.status === 'processing') {
      this.setStatus(taskRunId, 'cancelled');
    }
    return this.records.get(taskRunId) ?? null;
  }

  async findById(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null> {
    const error = this.findErrors.shift();
    if (error) {
      throw error;
    }

    const record = this.records.get(taskRunId);
    return record && record.workspaceId === workspaceId ? record : null;
  }

  private requireRecord(workspaceId: string, taskRunId: string): TaskRunRecord {
    const record = this.records.get(taskRunId);
    if (!record || record.workspaceId !== workspaceId) throw new Error('task not found');
    return record;
  }

  private createRecord(message: SourceTaskMessage): TaskRunRecord {
    return {
      id: message.taskRunId,
      workspaceId: message.workspaceId,
      taskType: message.taskType,
      idempotencyKey: `idempotency-${message.taskRunId}`,
      status: 'queued',
      attempt: 0,
      payload: { ...message },
      result: null,
      errorCode: null,
      errorMessage: null,
    };
  }
}

function createHandler(
  messages: SourceTaskMessage[] = [transcribeMessage],
  processor: SourceProcessor = new MockSourceProcessor(),
  lookup: SourceLookup = new FakeSourceLookup(),
): { handler: SourceTaskHandler; store: FakeTaskRunStore; processor: SourceProcessor } {
  const store = new FakeTaskRunStore(messages);
  store.bindSourceLookup(lookup);
  return { handler: new SourceTaskHandler(store, lookup, processor), store, processor };
}

describe('SourceTaskHandler', () => {
  it('validates media and persists verified metadata before succeeding validation', async () => {
    const validatingSource = { ...source, status: 'validating' };
    const updates: unknown[] = [];
    const verified = {
      durationSeconds: 17,
      contentHash: 'verified-hash',
      detectedMimeType: 'video/mp4',
    };
    const sourceStore = {
      findById: async () => validatingSource,
      completeValidation: async (...args: unknown[]) => {
        updates.push(args);
        return true;
      },
      transitionStatus: async () => true,
    };
    const validator = { validate: async () => verified };
    const processor = new MockSourceProcessor();
    const store = new FakeTaskRunStore([validationMessage]);
    store.bindSourceLookup(sourceStore);
    const handler = Reflect.construct(SourceTaskHandler, [
      store,
      sourceStore,
      processor,
      validator,
    ]) as SourceTaskHandler;

    const result = await handler.handle(validationMessage, { attemptsMade: 0, maxAttempts: 3 });

    expect(result).toMatchObject({
      status: 'succeeded',
      result: {
        taskType: 'source.validate',
        output: {
          durationSeconds: 17,
          contentHash: 'verified-hash',
          detectedMimeType: 'video/mp4',
        },
      },
    });
    expect(processor.analyzed).toEqual([]);
    expect(processor.transcribed).toEqual([]);
    expect(updates).toEqual([
      [
        'workspace-a',
        'source-1',
        { durationSeconds: 17, contentHash: 'verified-hash', mimeType: 'video/mp4' },
      ],
    ]);
  });

  it('accepts validated text Sources whose duration is not applicable', async () => {
    const sourceStore = {
      findById: async () => ({ ...source, status: 'validating', mimeType: 'text/plain' }),
      completeValidation: async () => true,
      transitionStatus: async () => true,
    };
    const validator = {
      validate: async () => ({
        durationSeconds: null,
        contentHash: 'verified-text-hash',
        detectedMimeType: 'text/plain',
      }),
    };
    const store = new FakeTaskRunStore([validationMessage]);
    store.bindSourceLookup(sourceStore);
    const handler = Reflect.construct(SourceTaskHandler, [
      store,
      sourceStore,
      new MockSourceProcessor(),
      validator,
    ]) as SourceTaskHandler;

    await expect(
      handler.handle(validationMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      result: {
        taskType: 'source.validate',
        output: {
          durationSeconds: null,
          contentHash: 'verified-text-hash',
          detectedMimeType: 'text/plain',
        },
      },
    });
  });

  it('fails a validation TaskRun and Source without retrying invalid media', async () => {
    const validatingSource = { ...source, status: 'validating' };
    const transitions: unknown[] = [];
    const sourceStore = {
      findById: async () => validatingSource,
      completeValidation: async () => true,
      transitionStatus: async (...args: unknown[]) => {
        transitions.push(args);
        return true;
      },
    };
    const validator = {
      validate: async () => {
        throw {
          code: 'PROCESSOR_INVALID_INPUT',
          message: 'invalid media',
          retryable: false,
        };
      },
    };
    const store = new FakeTaskRunStore([validationMessage]);
    store.bindSourceLookup(sourceStore);
    const handler = Reflect.construct(SourceTaskHandler, [
      store,
      sourceStore,
      new MockSourceProcessor(),
      validator,
    ]) as SourceTaskHandler;

    const result = await handler.handle(validationMessage, { attemptsMade: 0, maxAttempts: 3 });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'PROCESSOR_INVALID_INPUT' });
    expect(store.requeued).toBe(0);
    expect(transitions).toContainEqual(['workspace-a', 'source-1', 'validating', 'failed']);
  });

  it('marks a validation Source failed when retryable storage errors exhaust retries', async () => {
    const transitions: unknown[] = [];
    const sourceStore = {
      findById: async () => ({ ...source, status: 'validating' }),
      completeValidation: async () => true,
      transitionStatus: async (...args: unknown[]) => {
        transitions.push(args);
        return true;
      },
    };
    const validator = {
      validate: async () => {
        throw {
          code: 'PROCESSOR_TEMPORARY_FAILURE',
          message: safeMessages.PROCESSOR_TEMPORARY_FAILURE,
          retryable: true,
        };
      },
    };
    const store = new FakeTaskRunStore([validationMessage]);
    store.bindSourceLookup(sourceStore);
    const handler = Reflect.construct(SourceTaskHandler, [
      store,
      sourceStore,
      new MockSourceProcessor(),
      validator,
    ]) as SourceTaskHandler;

    const result = await handler.handle(validationMessage, { attemptsMade: 3, maxAttempts: 3 });

    expect(result).toMatchObject({ status: 'failed', errorCode: 'PROCESSOR_TEMPORARY_FAILURE' });
    expect(transitions).toContainEqual(['workspace-a', 'source-1', 'validating', 'failed']);
  });

  it('does not fail a TaskRun when a validation Source reaches a terminal state before failure CAS', async () => {
    let sourceReads = 0;
    const sourceStore = {
      findById: async () => {
        sourceReads += 1;
        return { ...source, status: sourceReads === 1 ? 'validating' : 'succeeded' };
      },
      completeValidation: async () => true,
      transitionStatus: async () => false,
    };
    const validator = {
      validate: async () => {
        throw {
          code: 'PROCESSOR_INVALID_INPUT',
          message: safeMessages.PROCESSOR_INVALID_INPUT,
          retryable: false,
        };
      },
    };
    const store = new FakeTaskRunStore([validationMessage]);
    store.bindSourceLookup(sourceStore);
    const handler = Reflect.construct(SourceTaskHandler, [
      store,
      sourceStore,
      new MockSourceProcessor(),
      validator,
    ]) as SourceTaskHandler;

    const result = await handler.handle(validationMessage, { attemptsMade: 0, maxAttempts: 3 });

    expect(result).toMatchObject({ status: 'processing' });
    expect(store.records.get(validationMessage.taskRunId)).toMatchObject({
      status: 'processing',
      result: null,
      errorCode: null,
    });
  });

  it('does not persist validation metadata after cancellation during media reading', async () => {
    const validatingSource = { ...source, status: 'validating' };
    let completeCalls = 0;
    const sourceStore = {
      findById: async () => validatingSource,
      completeValidation: async () => {
        completeCalls += 1;
        return true;
      },
      transitionStatus: async () => true,
    };
    const store = new FakeTaskRunStore([validationMessage]);
    store.bindSourceLookup(sourceStore);
    const validator = {
      validate: async () => {
        store.setStatus(validationMessage.taskRunId, 'cancelled');
        return { durationSeconds: 17, contentHash: 'verified-hash', detectedMimeType: 'video/mp4' };
      },
    };
    const handler = Reflect.construct(SourceTaskHandler, [
      store,
      sourceStore,
      new MockSourceProcessor(),
      validator,
    ]) as SourceTaskHandler;

    await expect(
      handler.handle(validationMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(completeCalls).toBe(0);
  });

  it('moves queued Sources through processing to succeeded for business tasks', async () => {
    const queuedSource = { ...source, status: 'queued' as const };
    const transitions: unknown[] = [];
    const lookup: SourceLookup = {
      findById: async () => queuedSource,
      completeValidation: async () => true,
      transitionStatus: async (...args) => {
        transitions.push(args);
        return true;
      },
    };
    const { handler } = createHandler([transcribeMessage], new MockSourceProcessor(), lookup);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(transitions).toEqual([
      ['workspace-a', 'source-1', 'queued', 'processing'],
      ['workspace-a', 'source-1', 'processing', 'succeeded'],
    ]);
  });

  it('moves a business Source to failed when a non-retryable processor failure is final', async () => {
    const queuedSource = { ...source, status: 'queued' as const };
    const transitions: unknown[] = [];
    const lookup: SourceLookup = {
      findById: async () => queuedSource,
      completeValidation: async () => true,
      transitionStatus: async (...args) => {
        transitions.push(args);
        return true;
      },
    };
    const processor = new MockSourceProcessor();
    processor.failWith({
      code: 'PROCESSOR_INVALID_INPUT',
      message: safeMessages.PROCESSOR_INVALID_INPUT,
      retryable: false,
    });
    const { handler } = createHandler([transcribeMessage], processor, lookup);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'failed', errorCode: 'PROCESSOR_INVALID_INPUT' });
    expect(transitions).toEqual([
      ['workspace-a', 'source-1', 'queued', 'processing'],
      ['workspace-a', 'source-1', 'processing', 'failed'],
    ]);
  });

  it('returns a business Source to queued when a retryable processor failure is retried', async () => {
    const queuedSource = { ...source, status: 'queued' as const };
    const transitions: unknown[] = [];
    const lookup: SourceLookup = {
      findById: async () => queuedSource,
      completeValidation: async () => true,
      transitionStatus: async (...args) => {
        transitions.push(args);
        return true;
      },
    };
    const processor = new MockSourceProcessor();
    processor.failWith({
      code: 'PROCESSOR_TEMPORARY_FAILURE',
      message: safeMessages.PROCESSOR_TEMPORARY_FAILURE,
      retryable: true,
    });
    const { handler, store } = createHandler([transcribeMessage], processor, lookup);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).rejects.toThrow(safeMessages.PROCESSOR_TEMPORARY_FAILURE);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('queued');
    expect(transitions).toEqual([
      ['workspace-a', 'source-1', 'queued', 'processing'],
      ['workspace-a', 'source-1', 'processing', 'queued'],
    ]);
  });

  it('processes transcribe and analyze messages and persists success', async () => {
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage, analyzeMessage], processor);

    const transcribe = await handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 });
    const analyze = await handler.handle(analyzeMessage, { attemptsMade: 0, maxAttempts: 3 });

    expect(transcribe).toMatchObject({ status: 'succeeded' });
    expect(analyze).toMatchObject({ status: 'succeeded' });
    expect(processor.transcribed).toEqual(['source-1']);
    expect(processor.analyzed).toEqual(['source-1']);
    expect(store.records.get(transcribeMessage.taskRunId)?.result).toMatchObject({
      taskType: 'source.transcribe',
    });
  });

  it('settles a business Source and TaskRun through one atomic transition', async () => {
    const { handler, store } = createHandler([transcribeMessage]);

    await handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 });

    expect(store.sourceTransitions).toHaveLength(1);
    expect(store.sourceTransitions[0]).toMatchObject({
      workspaceId: 'workspace-a',
      sourceId: 'source-1',
      taskRunId: transcribeMessage.taskRunId,
      expectedSourceStatus: 'processing',
      sourceStatus: 'succeeded',
      taskRunStatus: 'succeeded',
      result: { taskType: 'source.transcribe' },
    });
  });

  it.each([
    ['sourceId', { sourceId: 'source-2' }],
    ['taskType', { taskType: 'source.analyze' as const }],
    ['inputVersion', { inputVersion: 2 }],
  ])(
    'rejects a queued message whose %s disagrees with the claimed canonical payload',
    async (_field, mismatch) => {
      const processor = new MockSourceProcessor();
      const lookup = new FakeSourceLookup();
      const { handler, store } = createHandler([transcribeMessage], processor, lookup);
      const staleMessage = { ...transcribeMessage, ...mismatch } as SourceTaskMessage;

      await expect(
        handler.handle(staleMessage, { attemptsMade: 0, maxAttempts: 3 }),
      ).resolves.toMatchObject({
        status: 'failed',
        errorCode: 'PROCESSOR_INVALID_INPUT',
        errorMessage: safeMessages.PROCESSOR_INVALID_INPUT,
      });
      expect(lookup.calls).toEqual([]);
      expect(processor.transcribed).toEqual([]);
      expect(processor.analyzed).toEqual([]);
      expect(store.records.get(transcribeMessage.taskRunId)?.result).toBeNull();
    },
  );

  it('fails safely before reading Source when the claimed payload changes', async () => {
    const processor = new MockSourceProcessor();
    const lookup = new FakeSourceLookup();
    const { handler, store } = createHandler([transcribeMessage], processor, lookup);
    store.claimPayload = { ...transcribeMessage, sourceId: 'source-2' };

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESSOR_INVALID_INPUT',
      errorMessage: safeMessages.PROCESSOR_INVALID_INPUT,
    });
    expect(lookup.calls).toEqual([]);
    expect(processor.transcribed).toEqual([]);
  });

  it('rejects a malformed claimed payload before reading Source or invoking Processor', async () => {
    const processor = new MockSourceProcessor();
    const lookup = new FakeSourceLookup();
    const { handler, store } = createHandler([transcribeMessage], processor, lookup);
    const record = store.records.get(transcribeMessage.taskRunId)!;
    store.records.set(transcribeMessage.taskRunId, {
      ...record,
      payload: { ...record.payload, inputVersion: '1' },
    });

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESSOR_INVALID_INPUT',
      errorMessage: safeMessages.PROCESSOR_INVALID_INPUT,
    });
    expect(lookup.calls).toEqual([]);
    expect(processor.transcribed).toEqual([]);
    expect(processor.analyzed).toEqual([]);
  });

  it('uses the claimed payload as the processing owner and cancellation only prevents success', async () => {
    const events: string[] = [];
    const store = new FakeTaskRunStore([transcribeMessage]);
    const processor: SourceProcessor = {
      transcribe: async () => {
        events.push('processor');
        store.setStatus(transcribeMessage.taskRunId, 'cancelled');
        return { taskType: 'source.transcribe', output: { transcript: 'late' } };
      },
      analyze: async () => {
        throw new Error('not used');
      },
    };
    const lookup: SourceLookup = {
      findById: async () => source,
      transitionStatus: async () => true,
      completeValidation: async () => true,
    };
    const handler = new SourceTaskHandler(store, lookup, processor);

    const result = await handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 });

    expect(events).toEqual(['processor']);
    expect(result).toMatchObject({ status: 'cancelled' });
    expect(store.records.get(transcribeMessage.taskRunId)).toMatchObject({
      status: 'cancelled',
      result: null,
    });
  });

  it('does not invoke the processor when cancellation wins during Source lookup after claim', async () => {
    let releaseLookup!: () => void;
    let resolveLookupStarted!: () => void;
    const lookupStarted = new Promise<void>((resolve) => {
      resolveLookupStarted = resolve;
    });
    const lookupRelease = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    const store = new FakeTaskRunStore([transcribeMessage]);
    const processor = new MockSourceProcessor();
    const lookup: SourceLookup = {
      findById: async () => {
        resolveLookupStarted();
        await lookupRelease;
        return source;
      },
      transitionStatus: async () => true,
      completeValidation: async () => true,
    };
    const handler = new SourceTaskHandler(store, lookup, processor);
    const handling = handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 });

    await lookupStarted;
    await store.cancel('workspace-a', transcribeMessage.taskRunId);
    releaseLookup();

    await expect(handling).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(processor.transcribed).toEqual([]);
  });

  it('recovers a claim miss when another worker owns the task', async () => {
    const store = new FakeTaskRunStore([transcribeMessage]);
    store.claimMissStatus = 'processing';
    const processor = new MockSourceProcessor();
    const lookup = new FakeSourceLookup();
    const handler = new SourceTaskHandler(store, lookup, processor);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 1, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'processing' });
    expect(store.requeued).toBe(0);
    expect(lookup.calls).toEqual([]);
    expect(processor.transcribed).toEqual([]);
  });

  it('does not process when claim returns a task that was cancelled after update', async () => {
    const store = new FakeTaskRunStore([transcribeMessage]);
    store.claimStatusAfterUpdate = 'cancelled';
    const processor = new MockSourceProcessor();
    const lookup = new FakeSourceLookup();
    const handler = new SourceTaskHandler(store, lookup, processor);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(processor.transcribed).toEqual([]);
    expect(lookup.calls).toEqual([]);
  });

  it('does not read a Source from another workspace', async () => {
    const message = {
      ...transcribeMessage,
      taskRunId: 'task-cross-workspace',
      workspaceId: 'workspace-b',
    };
    const processor = new MockSourceProcessor();
    const lookup = new FakeSourceLookup();
    const { handler } = createHandler([message], processor, lookup);

    await expect(
      handler.handle(message, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'SOURCE_NOT_FOUND',
    });
    expect(lookup.calls).toEqual([{ workspaceId: 'workspace-b', sourceId: 'source-1' }]);
    expect(processor.transcribed).toEqual([]);
  });

  it('records a stable failure for a missing Source and does not invoke the processor', async () => {
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler(
      [transcribeMessage],
      processor,
      new FakeSourceLookup([]),
    );

    const result = await handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 });

    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'SOURCE_NOT_FOUND',
      errorMessage: safeMessages.SOURCE_NOT_FOUND,
    });
    expect(processor.transcribed).toEqual([]);
    expect(JSON.stringify(store.records.get(transcribeMessage.taskRunId))).not.toContain('stack');
  });

  it('requeues retryable failures and finally records failure at the max attempt', async () => {
    const processor = new MockSourceProcessor();
    processor.failWith({
      code: 'PROCESSOR_TEMPORARY_FAILURE',
      message: 'postgresql://user:secret@example.test/db token=secret stack: hidden',
      retryable: true,
    });
    const { handler, store } = createHandler([transcribeMessage], processor);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).rejects.toThrow(safeMessages.PROCESSOR_TEMPORARY_FAILURE);
    expect(store.requeued).toBe(1);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('queued');

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESSOR_TEMPORARY_FAILURE',
      errorMessage: safeMessages.PROCESSOR_TEMPORARY_FAILURE,
    });
    expect(JSON.stringify(store.records.get(transcribeMessage.taskRunId))).not.toContain('secret');
  });

  it('maps an unknown processor error to a retryable safe failure', async () => {
    const processor: SourceProcessor = {
      transcribe: async () => {
        throw new Error('provider token=secret stack trace');
      },
      analyze: async () => {
        throw new Error('provider token=secret stack trace');
      },
    };
    const { handler, store } = createHandler([transcribeMessage], processor);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 1 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESSOR_UNKNOWN_FAILURE',
      errorMessage: safeMessages.PROCESSOR_UNKNOWN_FAILURE,
    });
    expect(JSON.stringify(store.records.get(transcribeMessage.taskRunId))).not.toContain('secret');
  });

  it('safely maps processor failures whose fields throw when read', async () => {
    const sentinel = 'r5-sensitive-sentinel';
    const throwingFailure = new Proxy(
      {},
      {
        get: () => {
          throw new Error(sentinel);
        },
      },
    );
    const processor: SourceProcessor = {
      transcribe: async () => {
        throw throwingFailure;
      },
      analyze: async () => {
        throw throwingFailure;
      },
    };

    const retry = createHandler([transcribeMessage], processor);
    const publicError: unknown = await retry.handler
      .handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 })
      .catch((error: unknown) => error);

    expect(publicError).toMatchObject({
      message: safeMessages.PROCESSOR_UNKNOWN_FAILURE,
    });
    expectSafeError(publicError, sentinel);
    const retryRecord = retry.store.records.get(transcribeMessage.taskRunId);
    expect(retryRecord).toMatchObject({
      status: 'queued',
      errorCode: null,
      errorMessage: null,
    });
    expect(inspect(retryRecord)).not.toContain(sentinel);
    expect(JSON.stringify(retryRecord)).not.toContain(sentinel);

    const terminal = createHandler([transcribeMessage], processor);
    await expect(
      terminal.handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 1 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESSOR_UNKNOWN_FAILURE',
      errorMessage: safeMessages.PROCESSOR_UNKNOWN_FAILURE,
    });
    const terminalRecord = terminal.store.records.get(transcribeMessage.taskRunId);
    expect(inspect(terminalRecord)).not.toContain(sentinel);
    expect(JSON.stringify(terminalRecord)).not.toContain(sentinel);
  });

  it('records processor invalid input as a stable non-retryable failure', async () => {
    const processor = new MockSourceProcessor();
    processor.failWith({
      code: 'PROCESSOR_INVALID_INPUT',
      message: 'raw provider validation: token=secret',
      retryable: false,
    });
    const { handler, store } = createHandler([transcribeMessage], processor);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESSOR_INVALID_INPUT',
      errorMessage: safeMessages.PROCESSOR_INVALID_INPUT,
    });
    expect(store.requeued).toBe(0);
    expect(JSON.stringify(store.records.get(transcribeMessage.taskRunId))).not.toContain('secret');
  });

  it('requeues a claimed task after a Source lookup infrastructure failure', async () => {
    const lookupFailure = new Error('postgresql://user:secret@db/source stack trace');
    const lookup = new FailOnceSourceLookup(lookupFailure);
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor, lookup);

    const firstError: unknown = await handler
      .handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 })
      .catch((error: unknown) => error);
    expect(firstError).toMatchObject({ message: safeMessages.PROCESSOR_TEMPORARY_FAILURE });
    expectSafeError(firstError, 'postgresql://user:secret@db/source stack trace');
    expect(store.requeued).toBe(1);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('queued');
    expect((firstError as Error).message).not.toContain('secret');

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 1, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(processor.transcribed).toEqual(['source-1']);
  });

  it('records a safe temporary failure after a lookup infrastructure failure at max attempts', async () => {
    const lookupFailure = new Error('provider token=secret stack trace');
    const { handler, store } = createHandler(
      [transcribeMessage],
      new MockSourceProcessor(),
      new FailOnceSourceLookup(lookupFailure),
    );

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'failed',
      errorCode: 'PROCESSOR_TEMPORARY_FAILURE',
      errorMessage: safeMessages.PROCESSOR_TEMPORARY_FAILURE,
    });
    expect(store.requeued).toBe(0);
    expect(JSON.stringify(store.records.get(transcribeMessage.taskRunId))).not.toContain('secret');
  });

  it('keeps a queued task unchanged when the initial state read fails at max attempts', async () => {
    const stateReadFailure = new Error('postgresql://user:secret/db stack trace');
    const { handler, store } = createHandler([transcribeMessage]);
    store.findErrors.push(stateReadFailure);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 }),
    ).rejects.toThrow(safeMessages.PROCESSOR_TEMPORARY_FAILURE);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('queued');
  });

  it('keeps a queued task unchanged when its only attempt cannot read initial state', async () => {
    const stateReadFailure = new Error('postgresql://user:secret/db stack trace');
    const { handler, store } = createHandler([transcribeMessage]);
    store.findErrors.push(stateReadFailure);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 1 }),
    ).rejects.toThrow(safeMessages.PROCESSOR_TEMPORARY_FAILURE);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('queued');
  });

  it('keeps a queued task unchanged when claim ownership cannot be established', async () => {
    const claimFailure = new Error('postgresql://user:secret/db stack trace');
    const { handler, store } = createHandler([transcribeMessage]);
    store.claimError = claimFailure;

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 }),
    ).rejects.toThrow(safeMessages.PROCESSOR_TEMPORARY_FAILURE);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('queued');
  });

  it('does not mutate a TaskRun after claim ownership cannot be established', async () => {
    const scenarios: Array<{
      claimStatus: TaskRunStatus | undefined;
      expectedStatus: TaskRunStatus;
    }> = [
      { claimStatus: undefined, expectedStatus: 'queued' },
      { claimStatus: 'processing', expectedStatus: 'processing' },
      { claimStatus: 'cancelled', expectedStatus: 'cancelled' },
      { claimStatus: 'succeeded', expectedStatus: 'succeeded' },
      { claimStatus: 'failed', expectedStatus: 'failed' },
    ];

    for (const scenario of scenarios) {
      const store = new FakeTaskRunStore([transcribeMessage]);
      store.claimError = new Error('claim token=secret stack trace');
      store.claimErrorStatus = scenario.claimStatus;
      const processor = new MockSourceProcessor();
      const lookup: SourceLookup = {
        findById: async () => {
          throw new Error('lookup token=secret stack trace');
        },
        transitionStatus: async () => true,
        completeValidation: async () => true,
      };
      const handler = new SourceTaskHandler(store, lookup, processor);

      await expect(
        handler.handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 }),
      ).rejects.toThrow(safeMessages.PROCESSOR_TEMPORARY_FAILURE);
      expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe(scenario.expectedStatus);
      expect(processor.transcribed).toEqual([]);
    }
  });

  it('recovers a completion-state read failure without mapping it to a processor failure', async () => {
    const store = new FakeTaskRunStore([transcribeMessage]);
    const stateReadFailure = new Error('database password=secret stack trace');
    store.findErrors.push(undefined, undefined, stateReadFailure);
    const processor = new MockSourceProcessor();
    const handler = new SourceTaskHandler(store, new FakeSourceLookup(), processor);

    const error: unknown = await handler
      .handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: safeMessages.PROCESSOR_TEMPORARY_FAILURE });
    expectSafeError(error, 'database password=secret stack trace');
    expect(store.requeued).toBe(1);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('queued');
    expect(processor.transcribed).toEqual(['source-1']);
  });

  it('keeps infrastructure recovery errors free of raw diagnostics', async () => {
    const lookupFailure = new Error('lookup token=original-secret stack trace');
    const recoveryFailure = new Error('requeue token=recovery-secret stack trace');
    const { handler, store } = createHandler(
      [transcribeMessage],
      new MockSourceProcessor(),
      new FailOnceSourceLookup(lookupFailure),
    );
    store.requeueError = recoveryFailure;

    const error: unknown = await handler
      .handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: safeMessages.PROCESSOR_TEMPORARY_FAILURE });
    expectSafeError(error, 'original-secret', 'recovery-secret');
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('processing');
  });

  it('does not requeue or process an active task when a duplicate retry delivery arrives', async () => {
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor);
    store.setStatus(transcribeMessage.taskRunId, 'processing');

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 1, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'processing' });
    expect(store.requeued).toBe(0);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('processing');
    expect(processor.transcribed).toEqual([]);
  });

  it('does not fail an active task at the duplicate delivery max-attempt boundary', async () => {
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor);
    store.setStatus(transcribeMessage.taskRunId, 'processing');

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 }),
    ).resolves.toMatchObject({ status: 'processing' });
    expect(store.requeued).toBe(0);
    expect(processor.transcribed).toEqual([]);
  });

  it('does not mutate an active task when duplicate delivery cannot read its state', async () => {
    const stateReadFailure = new Error('database password=secret stack trace');
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor);
    store.setStatus(transcribeMessage.taskRunId, 'processing');
    store.findErrors.push(stateReadFailure);

    const error: unknown = await handler
      .handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: safeMessages.PROCESSOR_TEMPORARY_FAILURE });
    expectSafeError(error, 'database password=secret stack trace');
    expect(store.requeued).toBe(0);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('processing');
    expect(processor.transcribed).toEqual([]);
  });

  it('keeps an active task unchanged when duplicate delivery state lookup fails before retry', async () => {
    const stateReadFailure = new Error('postgresql://user:secret/db stack trace');
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor);
    store.setStatus(transcribeMessage.taskRunId, 'processing');
    store.findErrors.push(stateReadFailure);

    const error: unknown = await handler
      .handle(transcribeMessage, { attemptsMade: 1, maxAttempts: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: safeMessages.PROCESSOR_TEMPORARY_FAILURE });
    expectSafeError(error, 'postgresql://user:secret/db stack trace');
    expect(store.requeued).toBe(0);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('processing');
  });

  it('keeps a processing task unchanged when duplicate state lookup fails at max attempts', async () => {
    const stateReadFailure = new Error('provider token=secret stack trace');
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor);
    store.setStatus(transcribeMessage.taskRunId, 'processing');
    store.findErrors.push(stateReadFailure);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 }),
    ).rejects.toThrow(safeMessages.PROCESSOR_TEMPORARY_FAILURE);
    expect(store.requeued).toBe(0);
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('processing');
  });

  it('keeps max-attempt markFailed recovery errors safe', async () => {
    const lookupFailure = new Error('lookup token=original-secret stack trace');
    const markFailedFailure = new Error('mark failed token=recovery-secret stack trace');
    const { handler, store } = createHandler(
      [transcribeMessage],
      new MockSourceProcessor(),
      new FailOnceSourceLookup(lookupFailure),
    );
    store.markInfrastructureFailedError = markFailedFailure;

    const error: unknown = await handler
      .handle(transcribeMessage, { attemptsMade: 2, maxAttempts: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: safeMessages.PROCESSOR_TEMPORARY_FAILURE });
    expectSafeError(error, 'original-secret', 'recovery-secret');
    expect(store.records.get(transcribeMessage.taskRunId)?.status).toBe('processing');
  });

  it('does not process a cancelled or terminal task', async () => {
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor);
    store.setStatus(transcribeMessage.taskRunId, 'cancelled');

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(processor.transcribed).toEqual([]);

    store.records.set(transcribeMessage.taskRunId, {
      ...store.records.get(transcribeMessage.taskRunId)!,
      status: 'succeeded',
      result: { taskType: 'source.transcribe', output: { transcript: 'done' } },
    });
    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(processor.transcribed).toEqual([]);
  });

  it('does not mark a task succeeded when cancellation wins before completion', async () => {
    const store = new FakeTaskRunStore([transcribeMessage]);
    const processor: SourceProcessor = {
      transcribe: async () => {
        store.setStatus(transcribeMessage.taskRunId, 'cancelled');
        return { taskType: 'source.transcribe', output: { transcript: 'late' } };
      },
      analyze: async () => {
        throw new Error('not used');
      },
    };
    const handler = new SourceTaskHandler(store, new FakeSourceLookup(), processor);

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'cancelled',
    });
    expect(store.records.get(transcribeMessage.taskRunId)).toMatchObject({
      status: 'cancelled',
      result: null,
    });
  });

  it('does not reprocess a duplicate job while the task is already processing', async () => {
    const processor = new MockSourceProcessor();
    const { handler, store } = createHandler([transcribeMessage], processor);
    store.setStatus(transcribeMessage.taskRunId, 'processing');

    await expect(
      handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 }),
    ).resolves.toMatchObject({
      status: 'processing',
    });
    expect(processor.transcribed).toEqual([]);
  });
});

function expectSafeError(error: unknown, ...sensitiveValues: string[]): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).cause).toBeUndefined();

  const rendered = [
    (error as Error).message,
    (error as Error).stack,
    inspect(error),
    JSON.stringify(error),
    JSON.stringify({ error }),
  ].join('\n');
  for (const sensitiveValue of sensitiveValues) {
    expect(rendered).not.toContain(sensitiveValue);
  }
}
