import { describe, expect, it, vi } from 'vitest';

import { sourceTaskJobId } from '@sourceflow/domain';

import {
  BullMQSourceTaskQueue,
  DEFAULT_SOURCE_TASK_ATTEMPTS,
  SOURCE_TASK_QUEUE_NAME,
  type BullMQSourceTaskQueueDependencies,
  type BullMQSourceTaskJob,
  type BullMQQueueLike,
  type BullMQWorkerLike,
  type RedisConnectionLike,
} from './bullmq-source-task.queue.js';

const message = {
  taskRunId: 'task-1',
  workspaceId: 'workspace-a',
  sourceId: 'source-1',
  taskType: 'source.transcribe',
  inputVersion: 1,
} as const;

type FakeState = {
  redis?: { quit: ReturnType<typeof vi.fn> };
  queue?: {
    name: string;
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  worker?: {
    processor: (job: BullMQSourceTaskJob) => Promise<void>;
    close: ReturnType<typeof vi.fn>;
    options: { connection: RedisConnectionLike; concurrency?: number };
  };
};

const createDependencies = (): {
  dependencies: BullMQSourceTaskQueueDependencies;
  state: FakeState;
} => {
  const state: FakeState = {};

  class FakeRedis implements RedisConnectionLike {
    readonly quit = vi.fn(async () => 'OK');

    constructor(
      readonly url: string,
      readonly options: { maxRetriesPerRequest: null },
    ) {
      state.redis = this;
    }
  }

  class FakeQueue implements BullMQQueueLike {
    readonly add = vi.fn(async () => ({ id: sourceTaskJobId(message) }));
    readonly close = vi.fn(async () => undefined);

    constructor(
      readonly name: string,
      readonly options: { connection: RedisConnectionLike },
    ) {
      state.queue = this;
    }
  }

  class FakeWorker implements BullMQWorkerLike {
    readonly close = vi.fn(async () => undefined);

    constructor(
      readonly name: string,
      readonly processor: (job: BullMQSourceTaskJob) => Promise<void>,
      readonly options: { connection: RedisConnectionLike; concurrency?: number },
    ) {
      state.worker = this;
    }
  }

  return {
    dependencies: { Queue: FakeQueue, Worker: FakeWorker, Redis: FakeRedis },
    state,
  };
};

const createQueue = () => {
  const { dependencies, state } = createDependencies();
  const queue = new BullMQSourceTaskQueue({
    redisUrl: 'redis://unit-test',
    dependencies,
  });
  return { queue, state };
};

describe('BullMQSourceTaskQueue', () => {
  it('uses the shared BullMQ-safe job id and configured attempts when enqueuing', async () => {
    const { queue, state } = createQueue();

    try {
      const jobId = await queue.enqueue(message, { attempts: 5 });

      expect(jobId).toBe(sourceTaskJobId(message));
      expect(jobId).not.toContain(':');
      expect(state.queue?.name).toBe(SOURCE_TASK_QUEUE_NAME);
      expect(state.queue?.add).toHaveBeenCalledWith(
        'source-task',
        message,
        expect.objectContaining({ jobId: sourceTaskJobId(message), attempts: 5 }),
      );
    } finally {
      await queue.close();
    }
  });

  it('uses three attempts by default and forwards the BullMQ job context', async () => {
    const { queue, state } = createQueue();
    const handled: Array<{ message: unknown; context: unknown }> = [];

    try {
      await queue.start(async (received, context) => {
        handled.push({ message: received, context });
      });

      await queue.enqueue(message);
      if (!state.worker) {
        throw new Error('Fake worker was not constructed');
      }
      await state.worker.processor({
        data: message,
        attemptsMade: 2,
        opts: { attempts: DEFAULT_SOURCE_TASK_ATTEMPTS },
      });

      expect(state.queue?.add).toHaveBeenCalledWith(
        'source-task',
        message,
        expect.objectContaining({ attempts: DEFAULT_SOURCE_TASK_ATTEMPTS }),
      );
      expect(handled).toEqual([
        {
          message,
          context: { attemptsMade: 2, maxAttempts: DEFAULT_SOURCE_TASK_ATTEMPTS },
        },
      ]);
    } finally {
      await queue.close();
    }
  });

  it('passes configured concurrency to the BullMQ Worker', async () => {
    const { dependencies, state } = createDependencies();
    const queue = new BullMQSourceTaskQueue({
      redisUrl: 'redis://unit-test',
      concurrency: 4,
      dependencies,
    });

    try {
      await queue.start(async () => undefined);

      expect(state.worker?.options.concurrency).toBe(4);
    } finally {
      await queue.close();
    }
  });

  it('rethrows handler errors so BullMQ can retry them', async () => {
    const { queue, state } = createQueue();
    const failure = new Error('temporary failure');

    try {
      await queue.start(async () => {
        throw failure;
      });
      if (!state.worker) {
        throw new Error('Fake worker was not constructed');
      }

      await expect(
        state.worker.processor({
          data: message,
          attemptsMade: 0,
          opts: { attempts: DEFAULT_SOURCE_TASK_ATTEMPTS },
        }),
      ).rejects.toBe(failure);
    } finally {
      await queue.close();
    }
  });

  it('closes the Worker, Queue and Redis connection for each isolated instance', async () => {
    const first = createQueue();
    const second = createQueue();

    try {
      await first.queue.start(async () => undefined);
      await second.queue.start(async () => undefined);
      await first.queue.close();
      await second.queue.close();

      expect(first.state.worker?.close).toHaveBeenCalledOnce();
      expect(first.state.queue?.close).toHaveBeenCalledOnce();
      expect(first.state.redis?.quit).toHaveBeenCalledOnce();
      expect(second.state.worker?.close).toHaveBeenCalledOnce();
      expect(second.state.queue?.close).toHaveBeenCalledOnce();
      expect(second.state.redis?.quit).toHaveBeenCalledOnce();
    } finally {
      await first.queue.close();
      await second.queue.close();
    }
  });

  it('continues closing every resource and rethrows the first close error', async () => {
    const { queue, state } = createQueue();
    const workerFailure = new Error('worker close failed');
    const queueFailure = new Error('queue close failed');
    const redisFailure = new Error('redis close failed');

    try {
      await queue.start(async () => undefined);
      state.worker!.close.mockRejectedValueOnce(workerFailure);
      state.queue!.close.mockRejectedValueOnce(queueFailure);
      state.redis!.quit.mockRejectedValueOnce(redisFailure);

      await expect(queue.close()).rejects.toBe(workerFailure);
      expect(state.worker?.close).toHaveBeenCalledOnce();
      expect(state.queue?.close).toHaveBeenCalledOnce();
      expect(state.redis?.quit).toHaveBeenCalledOnce();
    } finally {
      await queue.close();
    }
  });
});
