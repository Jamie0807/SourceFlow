import { canTransition, transitionFrom, type TransitionTable } from './state-transition';

export const ASSET_STATUSES = [
  'draft',
  'needs_review',
  'needs_changes',
  'approved',
  'exported',
  'cancelled',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_EVENTS = [
  'submit_for_review',
  'approve',
  'request_changes',
  'export',
  'cancel',
] as const;

export type AssetEvent = (typeof ASSET_EVENTS)[number];

export const ASSET_TRANSITIONS: TransitionTable<AssetStatus, AssetEvent> = {
  draft: { submit_for_review: 'needs_review', cancel: 'cancelled' },
  needs_review: {
    approve: 'approved',
    request_changes: 'needs_changes',
    cancel: 'cancelled',
  },
  needs_changes: { submit_for_review: 'needs_review', cancel: 'cancelled' },
  approved: { export: 'exported', cancel: 'cancelled' },
  exported: {},
  cancelled: {},
};

export function transitionAsset(status: AssetStatus, event: AssetEvent): AssetStatus {
  return transitionFrom('asset', status, event, ASSET_TRANSITIONS);
}

export function canTransitionAsset(status: AssetStatus, event: AssetEvent): boolean {
  return canTransition(status, event, ASSET_TRANSITIONS);
}
