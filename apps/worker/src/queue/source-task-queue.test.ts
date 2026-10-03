import { describe, expect, it } from 'vitest';

import { FakeSourceTaskQueue } from '../../../../packages/test-utils/src/fake-source-task.queue.js';
import type { SourceTaskJobContext } from '@sourceflow/domain';

const message = {
  taskRunId: 'task-1',
  workspaceId: 'workspace-a',
  sourceId: 'source-1',
  taskType: 'source.transcribe',
  inputVersion: 1,
} as const;

describe('FakeSourceTaskQueue as SourceTaskQueue', () => {
  it('records an enqueued message and delivers it to a handler', async () => {
    const queue = new FakeSourceTaskQueue();
    const handled: string[] = [];

    await queue.start(async (received) => {
      handled.push(received.taskRunId);
    });

    await queue.enqueue(message, { attempts: 3 });
    await queue.drain();

    expect(handled).toEqual(['task-1']);
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]).toMatchObject({
      jobId: expect.stringMatching(/^sf1_[0-9a-f]*_[0-9a-f]*$/),
      message,
      attempts: 3,
    });
  });

  it('keeps the same task idempotent and different workspaces isolated', async () => {
    const queue = new FakeSourceTaskQueue();

    await queue.enqueue(message);
    await queue.enqueue(message);
    await queue.enqueue({ ...message, workspaceId: 'workspace-b' });

    const jobIds = queue.enqueued.map((item) => item.jobId);
    expect(jobIds).toHaveLength(2);
    expect(jobIds[0]).not.toBe(jobIds[1]);
    expect(jobIds.every((jobId) => !jobId.includes(':'))).toBe(true);
  });

  it('passes attempt context to the handler and rejects enqueue after close', async () => {
    const queue = new FakeSourceTaskQueue();
    const contexts: SourceTaskJobContext[] = [];

    await queue.start(async (_received, context) => {
      contexts.push(context);
    });
    await queue.enqueue(message, { attempts: 4 });
    await queue.drain();

    expect(contexts).toEqual([{ attemptsMade: 0, maxAttempts: 4 }]);

    await queue.close();
    expect(queue.closed).toBe(true);
    await expect(queue.enqueue(message)).rejects.toThrow('closed');
  });

  it('retries a failed handler until it succeeds and exposes attempt context', async () => {
    const queue = new FakeSourceTaskQueue();
    const contexts: SourceTaskJobContext[] = [];
    let attempts = 0;

    await queue.start(async (_received, context) => {
      contexts.push(context);
      attempts += 1;
      if (attempts < 3) {
        throw new Error('temporary failure');
      }
    });
    await queue.enqueue(message, { attempts: 3 });

    await expect(queue.drain()).resolves.toBeUndefined();
    expect(contexts).toEqual([
      { attemptsMade: 0, maxAttempts: 3 },
      { attemptsMade: 1, maxAttempts: 3 },
      { attemptsMade: 2, maxAttempts: 3 },
    ]);
  });

  it('rejects after the configured attempts and does not redeliver on a later drain', async () => {
    const queue = new FakeSourceTaskQueue();
    const contexts: SourceTaskJobContext[] = [];
    const failure = new Error('permanent failure');

    await queue.start(async (_received, context) => {
      contexts.push(context);
      throw failure;
    });
    await queue.enqueue(message, { attempts: 2 });

    await expect(queue.drain()).rejects.toBe(failure);
    await expect(queue.drain()).resolves.toBeUndefined();
    expect(contexts).toEqual([
      { attemptsMade: 0, maxAttempts: 2 },
      { attemptsMade: 1, maxAttempts: 2 },
    ]);
  });
});
