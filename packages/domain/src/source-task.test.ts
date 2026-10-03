import { describe, expect, it } from 'vitest';

import {
  SOURCE_TASK_TYPES,
  createSourceTaskMessage,
  createSourceTaskResult,
  sourceTaskJobId,
  type SourceTaskMessage,
  type SourceTaskResult,
  type TaskFailure,
} from './index.js';

describe('Source task contract', () => {
  const messageFor = (taskType: SourceTaskMessage['taskType']) =>
    createSourceTaskMessage({
      taskRunId: `task-${taskType}`,
      workspaceId: 'workspace-a',
      sourceId: 'source-1',
      taskType,
      inputVersion: 1,
    });

  it('supports both source task types and builds tenant-isolated job ids', () => {
    const transcribeMessage = messageFor('source.transcribe');
    const analyzeMessage = messageFor('source.analyze');
    const transcribeJobId = sourceTaskJobId(transcribeMessage);

    expect(SOURCE_TASK_TYPES).toEqual(['source.transcribe', 'source.analyze']);
    expect(transcribeJobId).toMatch(/^sf1_[0-9a-f]*_[0-9a-f]*$/);
    expect(transcribeJobId).not.toContain(':');
    expect(transcribeJobId).not.toMatch(/^\d+$/);
    expect(sourceTaskJobId({ ...transcribeMessage, taskRunId: 'task-another' })).not.toBe(
      transcribeJobId,
    );
    expect(sourceTaskJobId({ ...analyzeMessage, workspaceId: 'workspace-b' })).not.toBe(
      transcribeJobId,
    );
  });

  it('keeps encoded job ids collision-free for delimiter-like input', () => {
    const first = sourceTaskJobId({ workspaceId: 'workspace:a', taskRunId: 'task-b' });
    const second = sourceTaskJobId({ workspaceId: 'workspace', taskRunId: 'a:task-b' });

    expect(first).not.toBe(second);
    expect(first).not.toContain(':');
    expect(second).not.toContain(':');
  });

  it('requires inputVersion to be a finite positive integer at runtime', () => {
    const message = messageFor('source.transcribe');

    for (const inputVersion of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createSourceTaskMessage({ ...message, inputVersion })).toThrow(/inputVersion/);
    }
  });

  it('round-trips messages and nested results through JSON', () => {
    const message = messageFor('source.transcribe');
    const result: SourceTaskResult = createSourceTaskResult({
      taskType: 'source.analyze',
      output: {
        segments: [{ start: 0, end: 1.5, text: 'hello' }],
        metadata: { language: 'zh-CN', confidence: 0.99, reviewed: false },
        tags: ['source', 'analysis'],
      },
    });

    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('rejects non-JSON result values at the runtime construction path', () => {
    for (const output of [
      { unsupported: undefined },
      { unsupported: () => 'not JSON' },
      { unsupported: Symbol('not JSON') },
      { unsupported: 1n },
    ]) {
      expect(() => createSourceTaskResult({ taskType: 'source.analyze', output })).toThrow(
        /JSON-safe/,
      );
    }
  });

  it('keeps all failure codes and retry behavior explicit and serializable', () => {
    const failures: TaskFailure[] = [
      { code: 'SOURCE_NOT_FOUND', message: 'Source 不存在', retryable: false },
      { code: 'TASK_CANCELLED', message: '任务已取消', retryable: false },
      { code: 'PROCESSOR_INVALID_INPUT', message: '输入无效', retryable: false },
      { code: 'PROCESSOR_TEMPORARY_FAILURE', message: '处理服务暂时不可用', retryable: true },
      { code: 'PROCESSOR_UNKNOWN_FAILURE', message: '处理失败', retryable: false },
    ];

    expect(JSON.parse(JSON.stringify(failures))).toEqual(failures);
  });
});
