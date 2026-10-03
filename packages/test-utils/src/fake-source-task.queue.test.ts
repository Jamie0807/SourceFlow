import { describe, expect, it } from 'vitest';

import { sourceTaskJobId } from '@sourceflow/domain';

import { FakeSourceTaskQueue } from './fake-source-task.queue.js';

const message = {
  taskRunId: 'task-1',
  workspaceId: 'workspace-a',
  sourceId: 'source-1',
  taskType: 'source.analyze',
  inputVersion: 2,
} as const;

describe('FakeSourceTaskQueue', () => {
  it('does not enqueue the same workspace task twice', async () => {
    const queue = new FakeSourceTaskQueue();

    const firstJobId = await queue.enqueue(message);
    const duplicateJobId = await queue.enqueue(message);

    expect(firstJobId).toBe(sourceTaskJobId(message));
    expect(firstJobId).not.toContain(':');
    expect(duplicateJobId).toBe(firstJobId);
    expect(queue.enqueued).toHaveLength(1);
  });

  it('drains each isolated job once and closes cleanly', async () => {
    const queue = new FakeSourceTaskQueue();
    const received: string[] = [];

    await queue.enqueue(message);
    await queue.enqueue({ ...message, workspaceId: 'workspace-b' });
    await queue.start(async (receivedMessage) => {
      received.push(`${receivedMessage.workspaceId}:${receivedMessage.taskRunId}`);
    });

    await queue.drain();
    await queue.drain();
    await queue.close();

    expect(received).toEqual(['workspace-a:task-1', 'workspace-b:task-1']);
    expect(queue.closed).toBe(true);
  });

  it('retries a failed handler up to the configured attempts', async () => {
    const queue = new FakeSourceTaskQueue();
    const contexts: Array<{ attemptsMade: number; maxAttempts: number }> = [];
    const failure = new Error('always fails');

    await queue.start(async (_received, context) => {
      contexts.push(context);
      throw failure;
    });
    await queue.enqueue(message, { attempts: 2 });

    await expect(queue.drain()).rejects.toBe(failure);
    expect(contexts).toEqual([
      { attemptsMade: 0, maxAttempts: 2 },
      { attemptsMade: 1, maxAttempts: 2 },
    ]);
  });
});
