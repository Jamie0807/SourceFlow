import { canTransition, transitionFrom, type TransitionTable } from './state-transition';

export const SOURCE_STATUSES = [
  'created',
  'uploading',
  'uploaded',
  'queued',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const SOURCE_EVENTS = [
  'start_upload',
  'complete_upload',
  'queue',
  'start_processing',
  'succeed',
  'fail',
  'retry',
  'cancel',
] as const;

export type SourceEvent = (typeof SOURCE_EVENTS)[number];

export const SOURCE_TRANSITIONS: TransitionTable<SourceStatus, SourceEvent> = {
  created: { start_upload: 'uploading', cancel: 'cancelled' },
  uploading: { complete_upload: 'uploaded', cancel: 'cancelled' },
  uploaded: { queue: 'queued', cancel: 'cancelled' },
  queued: { start_processing: 'processing', cancel: 'cancelled' },
  processing: {
    succeed: 'succeeded',
    fail: 'failed',
    cancel: 'cancelled',
  },
  succeeded: {},
  failed: { retry: 'queued', cancel: 'cancelled' },
  cancelled: {},
};

export function transitionSource(status: SourceStatus, event: SourceEvent): SourceStatus {
  return transitionFrom('source', status, event, SOURCE_TRANSITIONS);
}

export function canTransitionSource(status: SourceStatus, event: SourceEvent): boolean {
  return canTransition(status, event, SOURCE_TRANSITIONS);
}
