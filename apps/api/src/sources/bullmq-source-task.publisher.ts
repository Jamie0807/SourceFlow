import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { sourceTaskJobId, type SourceTaskMessage } from '@sourceflow/domain';

export const SOURCE_TASK_QUEUE_NAME = 'source-processing';
export const SOURCE_TASK_JOB_NAME = 'source-task';
export const DEFAULT_SOURCE_TASK_ATTEMPTS = 3;

export type RedisConnectionLike = Readonly<{ quit(): Promise<unknown> }>;

export type BullMQQueueLike = Readonly<{
  add(
    name: string,
    data: SourceTaskMessage,
    options: { jobId: string; attempts: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}>;

export type BullMQQueueConstructor = new (
  name: string,
  options: { connection: RedisConnectionLike },
) => BullMQQueueLike;

export type RedisConstructor = new (
  url: string,
  options: { maxRetriesPerRequest: null },
) => RedisConnectionLike;

export type BullMQSourceTaskPublisherDependencies = Readonly<{
  Queue: BullMQQueueConstructor;
  Redis: RedisConstructor;
}>;

export type BullMQSourceTaskPublisherOptions = Readonly<{
  redisUrl?: string;
  attempts?: number;
  dependencies?: Partial<BullMQSourceTaskPublisherDependencies>;
}>;

const defaultDependencies: BullMQSourceTaskPublisherDependencies = {
  Queue: Queue as unknown as BullMQQueueConstructor,
  Redis: Redis as unknown as RedisConstructor,
};

@Injectable()
export class BullMQSourceTaskPublisher implements OnModuleDestroy {
  private readonly queue: BullMQQueueLike;
  private readonly redis: RedisConnectionLike;
  private readonly attempts: number;
  private closed = false;

  constructor(options: BullMQSourceTaskPublisherOptions = {}) {
    const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
    if (typeof redisUrl !== 'string' || redisUrl.trim().length === 0) {
      throw new Error('REDIS_URL is required to create BullMQSourceTaskPublisher');
    }

    this.attempts = options.attempts ?? DEFAULT_SOURCE_TASK_ATTEMPTS;
    const dependencies = { ...defaultDependencies, ...options.dependencies };
    this.redis = new dependencies.Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new dependencies.Queue(SOURCE_TASK_QUEUE_NAME, {
      connection: this.redis,
    });
  }

  async enqueue(message: SourceTaskMessage): Promise<string> {
    if (this.closed) throw new Error('BullMQ source task publisher is closed');

    const jobId = sourceTaskJobId(message);
    await this.queue.add(SOURCE_TASK_JOB_NAME, message, {
      jobId,
      attempts: this.attempts,
    });
    return jobId;
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    let firstError: unknown;
    try {
      await this.queue.close();
    } catch (error) {
      firstError = error;
    }
    try {
      await this.redis.quit();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) throw firstError;
  }
}
