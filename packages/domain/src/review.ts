import { canTransition, transitionFrom, type TransitionTable } from './state-transition';
import { SOURCE_TRANSITIONS, type SourceEvent, type SourceStatus } from './source';
import {
  CONTENT_BATCH_TRANSITIONS,
  type ContentBatchEvent,
  type ContentBatchStatus,
} from './content-batch';
import { ASSET_TRANSITIONS, type AssetEvent, type AssetStatus } from './asset';

export const REVIEW_STATUSES = [
  'draft',
  'needs_review',
  'needs_changes',
  'approved',
  'cancelled',
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_EVENTS = ['submit', 'approve', 'request_changes', 'cancel'] as const;

export type ReviewEvent = (typeof REVIEW_EVENTS)[number];

const REVIEW_TRANSITIONS: TransitionTable<ReviewStatus, ReviewEvent> = {
  draft: { submit: 'needs_review', cancel: 'cancelled' },
  needs_review: {
    approve: 'approved',
    request_changes: 'needs_changes',
    cancel: 'cancelled',
  },
  needs_changes: { submit: 'needs_review', cancel: 'cancelled' },
  approved: {},
  cancelled: {},
};

export function transitionReview(status: ReviewStatus, event: ReviewEvent): ReviewStatus {
  return transitionFrom('review', status, event, REVIEW_TRANSITIONS);
}

export function canTransitionReview(status: ReviewStatus, event: ReviewEvent): boolean {
  return canTransition(status, event, REVIEW_TRANSITIONS);
}

export const ROLES = ['owner', 'editor', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'submit_review',
  'approve',
  'request_changes',
  'export',
  'cancel',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  editor: ['submit_review', 'cancel'],
  reviewer: ['approve', 'request_changes', 'cancel'],
};

export function canPerform(role: Role, permission: Permission): boolean;
export function canPerform(machine: 'source', status: SourceStatus, event: SourceEvent): boolean;
export function canPerform(
  machine: 'batch',
  status: ContentBatchStatus,
  event: ContentBatchEvent,
): boolean;
export function canPerform(machine: 'asset', status: AssetStatus, event: AssetEvent): boolean;
export function canPerform(machine: 'review', status: ReviewStatus, event: ReviewEvent): boolean;
export function canPerform(
  first: Role | 'source' | 'batch' | 'asset' | 'review',
  second: string,
  third?: string,
): boolean {
  if (third === undefined) {
    return ROLE_PERMISSIONS[first as Role]?.includes(second as Permission) ?? false;
  }

  switch (first) {
    case 'source':
      return canTransition(second as SourceStatus, third as SourceEvent, SOURCE_TRANSITIONS);
    case 'batch':
      return canTransition(
        second as ContentBatchStatus,
        third as ContentBatchEvent,
        CONTENT_BATCH_TRANSITIONS,
      );
    case 'asset':
      return canTransition(second as AssetStatus, third as AssetEvent, ASSET_TRANSITIONS);
    case 'review':
      return canTransition(second as ReviewStatus, third as ReviewEvent, REVIEW_TRANSITIONS);
    default:
      return false;
  }
}
