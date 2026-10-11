import { describe, expect, it, vi } from 'vitest';

import { sourceTaskJobId } from '@sourceflow/domain';

import {
  BullMQSourceTaskPublisher,
  SOURCE_TASK_JOB_NAME,
  SOURCE_TASK_QUEUE_NAME,
  type BullMQSourceTaskPublisherDependencies,
} from './bullmq-source-task.publisher.js';

const message = {
  taskRunId: 'task-1',
  workspaceId: 'workspace-a',
  sourceId: 'source-1',
  taskType: 'source.validate',
  inputVersion: 1,
} as const;

const createDependencies = () => {
  const state = {
    redis: undefined as { quit: ReturnType<typeof vi.fn> } | undefined,
    queue: undefined as
      | {
          name: string;
          add: ReturnType<typeof vi.fn>;
          close: ReturnType<typeof vi.fn>;
        }
      | undefined,
  };

  class FakeRedis {
    readonly quit = vi.fn(async () => 'OK');

    constructor(
      readonly url: string,
      readonly options: { maxRetriesPerRequest: null },
    ) {
      state.redis = this;
    }
  }

  class FakeQueue {
    readonly add = vi.fn(async () => ({ id: sourceTaskJobId(message) }));
    readonly close = vi.fn(async () => undefined);

    constructor(
      readonly name: string,
      readonly options: { connection: FakeRedis },
    ) {
      state.queue = this;
    }
  }

  return {
    dependencies: {
      Queue: FakeQueue,
      Redis: FakeRedis,
    } as unknown as BullMQSourceTaskPublisherDependencies,
    state,
  };
};

describe('BullMQSourceTaskPublisher', () => {
  it('publishes with the shared stable job id and three attempts by default', async () => {
    const { dependencies, state } = createDependencies();
    const publisher = new BullMQSourceTaskPublisher({
      redisUrl: 'redis://unit-test',
      dependencies,
    });

    try {
      const jobId = await publisher.enqueue(message);

      expect(jobId).toBe(sourceTaskJobId(message));
      expect(state.queue?.name).toBe(SOURCE_TASK_QUEUE_NAME);
      expect(state.queue?.add).toHaveBeenCalledWith(SOURCE_TASK_JOB_NAME, message, {
        jobId: sourceTaskJobId(message),
        attempts: 3,
      });
    } finally {
      await publisher.close();
    }
  });

  it('deduplicates repeated enqueue requests by reusing the same stable job id', async () => {
    const { dependencies, state } = createDependencies();
    const publisher = new BullMQSourceTaskPublisher({
      redisUrl: 'redis://unit-test',
      dependencies,
    });

    try {
      const firstId = await publisher.enqueue(message);
      const secondId = await publisher.enqueue(message);

      expect(firstId).toBe(secondId);
      expect(state.queue?.add).toHaveBeenNthCalledWith(1, SOURCE_TASK_JOB_NAME, message, {
        jobId: firstId,
        attempts: 3,
      });
      expect(state.queue?.add).toHaveBeenNthCalledWith(2, SOURCE_TASK_JOB_NAME, message, {
        jobId: firstId,
        attempts: 3,
      });
    } finally {
      await publisher.close();
    }
  });

  it('fails closed without REDIS_URL and does not expose connection details', () => {
    const { dependencies } = createDependencies();

    expect(() => new BullMQSourceTaskPublisher({ redisUrl: '', dependencies })).toThrow(
      'REDIS_URL is required to create BullMQSourceTaskPublisher',
    );
  });

  it('closes the BullMQ Queue and Redis connection', async () => {
    const { dependencies, state } = createDependencies();
    const publisher = new BullMQSourceTaskPublisher({
      redisUrl: 'redis://unit-test',
      dependencies,
    });

    await publisher.close();
    await publisher.close();

    expect(state.queue?.close).toHaveBeenCalledOnce();
    expect(state.redis?.quit).toHaveBeenCalledOnce();
  });
});
