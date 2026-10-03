export const SOURCE_TASK_TYPES = ['source.transcribe', 'source.analyze'] as const;
export type SourceTaskType = (typeof SOURCE_TASK_TYPES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export type SourceTaskMessage = Readonly<{
  taskRunId: string;
  workspaceId: string;
  sourceId: string;
  taskType: SourceTaskType;
  inputVersion: number;
}>;

export type SourceTaskMessageInput = Omit<SourceTaskMessage, 'inputVersion'> & {
  inputVersion: number;
};

export type SourceTaskResult = Readonly<{
  taskType: SourceTaskType;
  output: JsonObject;
}>;

export type TaskFailureCode =
  | 'SOURCE_NOT_FOUND'
  | 'TASK_CANCELLED'
  | 'PROCESSOR_INVALID_INPUT'
  | 'PROCESSOR_TEMPORARY_FAILURE'
  | 'PROCESSOR_UNKNOWN_FAILURE';

export type TaskFailure = Readonly<{
  code: TaskFailureCode;
  message: string;
  retryable: boolean;
}>;

const isJsonValue = (value: unknown, ancestors = new WeakSet<object>()): value is JsonValue => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value !== 'object' || ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);

  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((item) => isJsonValue(item, ancestors));

  ancestors.delete(value);
  return valid;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  isJsonValue(value) && value !== null && !Array.isArray(value);

export function createSourceTaskMessage(input: SourceTaskMessageInput): SourceTaskMessage {
  if (!SOURCE_TASK_TYPES.includes(input.taskType)) {
    throw new TypeError('taskType must be a supported Source task type');
  }

  if (
    !Number.isFinite(input.inputVersion) ||
    !Number.isInteger(input.inputVersion) ||
    input.inputVersion <= 0
  ) {
    throw new TypeError('inputVersion must be a finite positive integer');
  }

  return { ...input };
}

export function createSourceTaskResult(input: {
  taskType: SourceTaskType;
  output: unknown;
}): SourceTaskResult {
  if (!SOURCE_TASK_TYPES.includes(input.taskType)) {
    throw new TypeError('taskType must be a supported Source task type');
  }

  if (!isJsonObject(input.output)) {
    throw new TypeError('output must be a JSON-safe object');
  }

  return { taskType: input.taskType, output: input.output };
}

const encodeJobIdPart = (value: string): string => {
  let encoded = '';

  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, '0');
  }

  return encoded;
};

export function sourceTaskJobId(message: Pick<SourceTaskMessage, 'workspaceId' | 'taskRunId'>) {
  return `sf1_${encodeJobIdPart(message.workspaceId)}_${encodeJobIdPart(message.taskRunId)}`;
}
