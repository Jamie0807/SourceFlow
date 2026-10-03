import { afterEach, describe, expect, it } from 'vitest';

import { BullMQSourceTaskQueue } from './bullmq-source-task.queue.js';

const redisUrl = process.env.REDIS_URL;

describe.skipIf(!redisUrl)('BullMQSourceTaskQueue Redis smoke', () => {
  let queue: BullMQSourceTaskQueue | undefined;

  afterEach(async () => {
    await queue?.close();
    queue = undefined;
  });

  it('delivers a real Redis job to the handler', async () => {
    if (!redisUrl) {
      return;
    }

    queue = new BullMQSourceTaskQueue({ redisUrl });
    let resolveReceived: ((value: { taskRunId: string }) => void) | undefined;
    const received = new Promise<{ taskRunId: string }>((resolve) => {
      resolveReceived = resolve;
    });

    await queue.start(async (message) => {
      resolveReceived?.({ taskRunId: message.taskRunId });
    });

    const jobId = await queue.enqueue({
      taskRunId: `smoke-${Date.now()}`,
      workspaceId: 'workspace-smoke',
      sourceId: 'source-smoke',
      taskType: 'source.transcribe',
      inputVersion: 1,
    });
    expect(jobId).not.toContain(':');

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Redis smoke timed out')), 5_000);
    });

    try {
      await expect(Promise.race([received, timedOut])).resolves.toMatchObject({
        taskRunId: expect.stringMatching(/^smoke-/),
      });
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  });
});
