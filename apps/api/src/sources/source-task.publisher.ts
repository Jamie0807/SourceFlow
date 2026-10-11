import type { SourceTaskMessage } from '@sourceflow/domain';

export const SOURCE_TASK_PUBLISHER = Symbol('SourceTaskPublisher');

export interface SourceTaskPublisher {
  enqueue(message: SourceTaskMessage): Promise<string>;
}
