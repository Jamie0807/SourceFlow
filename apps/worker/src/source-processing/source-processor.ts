import {
  SOURCE_TASK_TYPES,
  createSourceTaskResult,
  type SourceTaskResult,
  type SourceTaskType,
  type TaskFailure,
  type TaskFailureCode,
} from '@sourceflow/domain';

export type SourceRecord = Readonly<{
  id: string;
  workspaceId: string;
  status: string;
  storageKey: string;
  contentHash: string;
}>;

export interface SourceLookup {
  findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null>;
}

export interface SourceProcessor {
  transcribe(source: SourceRecord): Promise<SourceTaskResult>;
  analyze(source: SourceRecord): Promise<SourceTaskResult>;
}

export class MockSourceProcessor implements SourceProcessor {
  readonly transcribed: string[] = [];
  readonly analyzed: string[] = [];
  private failure: TaskFailure | Error | undefined;

  failWith(failure: TaskFailure | Error): void {
    this.failure = failure;
  }

  clearFailure(): void {
    this.failure = undefined;
  }

  async transcribe(source: SourceRecord): Promise<SourceTaskResult> {
    this.transcribed.push(source.id);
    this.throwConfiguredFailure();
    return createSourceTaskResult({
      taskType: 'source.transcribe',
      output: { sourceId: source.id, transcript: `Mock transcript for ${source.id}` },
    });
  }

  async analyze(source: SourceRecord): Promise<SourceTaskResult> {
    this.analyzed.push(source.id);
    this.throwConfiguredFailure();
    return createSourceTaskResult({
      taskType: 'source.analyze',
      output: { sourceId: source.id, insights: [`Mock insight for ${source.id}`] },
    });
  }

  private throwConfiguredFailure(): void {
    if (this.failure) {
      throw this.failure;
    }
  }
}

const TASK_FAILURE_CODES: readonly TaskFailureCode[] = [
  'SOURCE_NOT_FOUND',
  'TASK_CANCELLED',
  'PROCESSOR_INVALID_INPUT',
  'PROCESSOR_TEMPORARY_FAILURE',
  'PROCESSOR_UNKNOWN_FAILURE',
];

function readTaskFailure(error: unknown): TaskFailure | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  try {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly retryable?: unknown;
    };
    const code = candidate.code;
    const message = candidate.message;
    const retryable = candidate.retryable;

    if (
      typeof code !== 'string' ||
      !TASK_FAILURE_CODES.includes(code as TaskFailureCode) ||
      typeof message !== 'string' ||
      typeof retryable !== 'boolean'
    ) {
      return null;
    }

    return {
      code: code as TaskFailureCode,
      message,
      retryable,
    };
  } catch {
    return null;
  }
}

function createUnknownProcessorFailure(): TaskFailure {
  return {
    code: 'PROCESSOR_UNKNOWN_FAILURE',
    message: '处理失败',
    retryable: true,
  };
}

export function isTaskFailure(error: unknown): error is TaskFailure {
  return readTaskFailure(error) !== null;
}

export function mapProcessorError(error: unknown): TaskFailure {
  return readTaskFailure(error) ?? createUnknownProcessorFailure();
}

export function isSourceTaskType(value: string): value is SourceTaskType {
  return SOURCE_TASK_TYPES.includes(value as SourceTaskType);
}
