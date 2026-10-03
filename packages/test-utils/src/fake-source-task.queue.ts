import {
  sourceTaskJobId,
  type SourceTaskJobHandler,
  type SourceTaskMessage,
  type SourceTaskQueue,
} from '@sourceflow/domain';

export type FakeSourceTaskQueueEntry = Readonly<{
  jobId: string;
  message: SourceTaskMessage;
  attempts: number;
}>;

const DEFAULT_ATTEMPTS = 3;

export class FakeSourceTaskQueue implements SourceTaskQueue {
  readonly enqueued: FakeSourceTaskQueueEntry[] = [];
  closed = false;

  private readonly pending = new Map<string, FakeSourceTaskQueueEntry>();
  private handler: SourceTaskJobHandler | undefined;

  async enqueue(message: SourceTaskMessage, options: { attempts?: number } = {}): Promise<string> {
    this.assertOpen();

    const jobId = sourceTaskJobId(message);
    const existing = this.enqueued.find((entry) => entry.jobId === jobId);
    if (existing) {
      return existing.jobId;
    }

    const entry: FakeSourceTaskQueueEntry = {
      jobId,
      message,
      attempts: options.attempts ?? DEFAULT_ATTEMPTS,
    };
    this.enqueued.push(entry);
    this.pending.set(jobId, entry);
    return jobId;
  }

  async start(handler: SourceTaskJobHandler): Promise<void> {
    this.assertOpen();
    this.handler = handler;
  }

  async drain(): Promise<void> {
    this.assertOpen();
    if (!this.handler) {
      throw new Error('Source task queue has not been started');
    }

    for (const [jobId, entry] of this.pending) {
      let attemptsMade = 0;

      while (this.pending.has(jobId)) {
        try {
          await this.handler(entry.message, {
            attemptsMade,
            maxAttempts: entry.attempts,
          });
          this.pending.delete(jobId);
        } catch (error) {
          attemptsMade += 1;
          if (attemptsMade >= entry.attempts) {
            this.pending.delete(jobId);
            throw error;
          }
        }
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.pending.clear();
    this.handler = undefined;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('Source task queue is closed');
    }
  }
}
