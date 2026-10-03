import type { SourceTaskMessage } from './source-task.js';

export type SourceTaskJobContext = Readonly<{
  attemptsMade: number;
  maxAttempts: number;
}>;

export type SourceTaskJobHandler = (
  message: SourceTaskMessage,
  context: SourceTaskJobContext,
) => Promise<void>;

export interface SourceTaskQueue {
  enqueue(message: SourceTaskMessage, options?: { attempts?: number }): Promise<string>;
  start(handler: SourceTaskJobHandler): Promise<void>;
  close(): Promise<void>;
}
