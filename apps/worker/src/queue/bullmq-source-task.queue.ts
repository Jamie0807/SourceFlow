import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

import {
  sourceTaskJobId,
  type SourceTaskJobHandler,
  type SourceTaskMessage,
  type SourceTaskQueue,
} from '@sourceflow/domain';

export const SOURCE_TASK_QUEUE_NAME = 'source-processing';
export const DEFAULT_SOURCE_TASK_ATTEMPTS = 3;
export const DEFAULT_SOURCE_TASK_CONCURRENCY = 2;

export type RedisConnectionLike = Readonly<{
  quit(): Promise<unknown>;
}>;

export type BullMQQueueLike = Readonly<{
  add(
    name: string,
    data: SourceTaskMessage,
    options: { jobId: string; attempts: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}>;

export type BullMQSourceTaskJob = Readonly<{
  data: SourceTaskMessage;
  attemptsMade: number;
  opts: Readonly<{ attempts?: number }>;
}>;

export type BullMQWorkerLike = Readonly<{
  close(): Promise<void>;
}>;

export type BullMQQueueConstructor = new (
  name: string,
  options: { connection: RedisConnectionLike },
) => BullMQQueueLike;

export type BullMQWorkerConstructor = new (
  name: string,
  processor: (job: BullMQSourceTaskJob) => Promise<void>,
  options: { connection: RedisConnectionLike; concurrency: number },
) => BullMQWorkerLike;

export type RedisConstructor = new (
  url: string,
  options: { maxRetriesPerRequest: null },
) => RedisConnectionLike;

export type BullMQSourceTaskQueueDependencies = Readonly<{
  Queue: BullMQQueueConstructor;
  Worker: BullMQWorkerConstructor;
  Redis: RedisConstructor;
}>;

export type BullMQSourceTaskQueueOptions = Readonly<{
  redisUrl?: string;
  attempts?: number;
  concurrency?: number;
  dependencies?: Partial<BullMQSourceTaskQueueDependencies>;
}>;

const defaultDependencies: BullMQSourceTaskQueueDependencies = {
  Queue: Queue as unknown as BullMQQueueConstructor,
  Worker: Worker as unknown as BullMQWorkerConstructor,
  Redis: Redis as unknown as RedisConstructor,
};

export class BullMQSourceTaskQueue implements SourceTaskQueue {
  private readonly queue: BullMQQueueLike;
  private readonly redis: RedisConnectionLike;
  private readonly attempts: number;
  private readonly concurrency: number;
  private readonly Worker: BullMQWorkerConstructor;
  private worker: BullMQWorkerLike | undefined;
  private closed = false;

  constructor(options: BullMQSourceTaskQueueOptions = {}) {
    const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL is required to create BullMQSourceTaskQueue');
    }

    this.attempts = options.attempts ?? DEFAULT_SOURCE_TASK_ATTEMPTS;
    this.concurrency = options.concurrency ?? DEFAULT_SOURCE_TASK_CONCURRENCY;
    const dependencies = { ...defaultDependencies, ...options.dependencies };
    this.Worker = dependencies.Worker;
    this.redis = new dependencies.Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new dependencies.Queue(SOURCE_TASK_QUEUE_NAME, {
      connection: this.redis,
    });
  }

  async enqueue(message: SourceTaskMessage, options: { attempts?: number } = {}): Promise<string> {
    this.assertOpen();

    const jobId = sourceTaskJobId(message);
    await this.queue.add('source-task', message, {
      jobId,
      attempts: options.attempts ?? this.attempts,
    });
    return jobId;
  }

  async start(handler: SourceTaskJobHandler): Promise<void> {
    this.assertOpen();
    if (this.worker) {
      throw new Error('BullMQ source task queue has already been started');
    }

    this.worker = new this.Worker(
      SOURCE_TASK_QUEUE_NAME,
      async (job) => {
        await handler(job.data, {
          attemptsMade: job.attemptsMade,
          maxAttempts: job.opts.attempts ?? this.attempts,
        });
      },
      { connection: this.redis, concurrency: this.concurrency },
    );
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    let firstError: unknown;
    const close = async (operation: () => Promise<unknown>): Promise<void> => {
      try {
        await operation();
      } catch (error) {
        firstError ??= error;
      }
    };

    if (this.worker) {
      await close(() => this.worker!.close());
    }
    await close(() => this.queue.close());
    await close(() => this.redis.quit());

    if (firstError) {
      throw firstError;
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('BullMQ source task queue is closed');
    }
  }
}
