import { canTransition, transitionFrom, type TransitionTable } from './state-transition';

export const CONTENT_BATCH_STATUSES = [
  'draft',
  'generating',
  'needs_review',
  'approved',
  'exportable',
  'exported',
  'generation_failed',
  'export_failed',
  'cancelled',
] as const;

export type ContentBatchStatus = (typeof CONTENT_BATCH_STATUSES)[number];

export const CONTENT_BATCH_EVENTS = [
  'start_generation',
  'generation_succeeded',
  'generation_failed',
  'retry_generation',
  'approve',
  'make_exportable',
  'export_succeeded',
  'export_failed',
  'retry_export',
  'cancel',
] as const;

export type ContentBatchEvent = (typeof CONTENT_BATCH_EVENTS)[number];

export const CONTENT_BATCH_TRANSITIONS: TransitionTable<ContentBatchStatus, ContentBatchEvent> = {
  draft: { start_generation: 'generating', cancel: 'cancelled' },
  generating: {
    generation_succeeded: 'needs_review',
    generation_failed: 'generation_failed',
    cancel: 'cancelled',
  },
  needs_review: { approve: 'approved', cancel: 'cancelled' },
  approved: { make_exportable: 'exportable', cancel: 'cancelled' },
  exportable: {
    export_succeeded: 'exported',
    export_failed: 'export_failed',
    cancel: 'cancelled',
  },
  exported: {},
  generation_failed: { retry_generation: 'generating', cancel: 'cancelled' },
  export_failed: { retry_export: 'exportable', cancel: 'cancelled' },
  cancelled: {},
};

export function transitionBatch(
  status: ContentBatchStatus,
  event: ContentBatchEvent,
): ContentBatchStatus {
  return transitionFrom('batch', status, event, CONTENT_BATCH_TRANSITIONS);
}

export function canTransitionBatch(status: ContentBatchStatus, event: ContentBatchEvent): boolean {
  return canTransition(status, event, CONTENT_BATCH_TRANSITIONS);
}
