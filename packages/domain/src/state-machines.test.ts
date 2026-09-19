import { describe, expect, it } from 'vitest';

import {
  canPerform,
  canTransitionAsset,
  canTransitionBatch,
  canTransitionReview,
  canTransitionSource,
  transitionAsset,
  transitionBatch,
  transitionReview,
  transitionSource,
} from './index';

describe('Source state machine', () => {
  it('moves a source through upload and processing successfully', () => {
    expect(transitionSource('created', 'start_upload')).toBe('uploading');
    expect(transitionSource('uploading', 'complete_upload')).toBe('uploaded');
    expect(transitionSource('uploaded', 'queue')).toBe('queued');
    expect(transitionSource('queued', 'start_processing')).toBe('processing');
    expect(transitionSource('processing', 'succeed')).toBe('succeeded');
  });

  it('rejects invalid and duplicate source transitions', () => {
    expect(() => transitionSource('created', 'complete_upload')).toThrowError(
      /invalid source transition/i,
    );
    expect(() => transitionSource('uploading', 'start_upload')).toThrowError(
      /invalid source transition/i,
    );
    expect(() => transitionSource('succeeded', 'succeed')).toThrowError(
      /invalid source transition/i,
    );
  });

  it('allows cancellation only from an active source state', () => {
    expect(transitionSource('processing', 'cancel')).toBe('cancelled');
    expect(canTransitionSource('processing', 'cancel')).toBe(true);
    expect(canTransitionSource('succeeded', 'cancel')).toBe(false);
    expect(() => transitionSource('cancelled', 'cancel')).toThrowError(
      /invalid source transition/i,
    );
    expect(transitionSource('failed', 'retry')).toBe('queued');
  });
});

describe('Content batch state machine', () => {
  it('moves a batch through generation, review, and export', () => {
    expect(transitionBatch('draft', 'start_generation')).toBe('generating');
    expect(transitionBatch('generating', 'generation_succeeded')).toBe('needs_review');
    expect(transitionBatch('needs_review', 'approve')).toBe('approved');
    expect(transitionBatch('approved', 'make_exportable')).toBe('exportable');
    expect(transitionBatch('exportable', 'export_succeeded')).toBe('exported');
  });

  it('supports retrying failures and rejects duplicate transitions', () => {
    expect(transitionBatch('generating', 'generation_failed')).toBe('generation_failed');
    expect(transitionBatch('generation_failed', 'retry_generation')).toBe('generating');
    expect(transitionBatch('exportable', 'export_failed')).toBe('export_failed');
    expect(transitionBatch('export_failed', 'retry_export')).toBe('exportable');
    expect(() => transitionBatch('approved', 'approve')).toThrowError(/invalid batch transition/i);
    expect(canTransitionBatch('generation_failed', 'retry_generation')).toBe(true);
    expect(canTransitionBatch('exported', 'cancel')).toBe(false);
  });

  it('cancels a batch before it is exported', () => {
    expect(transitionBatch('generating', 'cancel')).toBe('cancelled');
    expect(() => transitionBatch('exported', 'cancel')).toThrowError(/invalid batch transition/i);
  });
});

describe('Asset and review state machines', () => {
  it('supports asset review, rework, approval, and export', () => {
    expect(transitionAsset('draft', 'submit_for_review')).toBe('needs_review');
    expect(transitionAsset('needs_review', 'request_changes')).toBe('needs_changes');
    expect(transitionAsset('needs_changes', 'submit_for_review')).toBe('needs_review');
    expect(transitionAsset('needs_review', 'approve')).toBe('approved');
    expect(transitionAsset('approved', 'export')).toBe('exported');
  });

  it('supports review cancellation and rejects repeated review actions', () => {
    expect(transitionReview('draft', 'submit')).toBe('needs_review');
    expect(transitionReview('needs_review', 'cancel')).toBe('cancelled');
    expect(() => transitionReview('cancelled', 'cancel')).toThrowError(
      /invalid review transition/i,
    );
    expect(() => transitionAsset('approved', 'approve')).toThrowError(/invalid asset transition/i);
    expect(canTransitionAsset('needs_review', 'approve')).toBe(true);
    expect(canTransitionAsset('exported', 'approve')).toBe(false);
    expect(canTransitionReview('needs_review', 'approve')).toBe(true);
    expect(canTransitionReview('approved', 'approve')).toBe(false);
  });
});

describe('domain permissions and transition checks', () => {
  it('answers role permissions without coupling to a framework', () => {
    expect(canPerform('editor', 'submit_review')).toBe(true);
    expect(canPerform('reviewer', 'approve')).toBe(true);
    expect(canPerform('editor', 'approve')).toBe(false);
    expect(canPerform('reviewer', 'submit_review')).toBe(false);
    expect(canPerform('owner', 'export')).toBe(true);
  });

  it('answers whether a state transition is available', () => {
    expect(canPerform('source', 'created', 'start_upload')).toBe(true);
    expect(canPerform('source', 'created', 'complete_upload')).toBe(false);
    expect(canPerform('batch', 'exported', 'cancel')).toBe(false);
    expect(canPerform('asset', 'draft', 'submit_for_review')).toBe(true);
    expect(canPerform('review', 'needs_review', 'approve')).toBe(true);
    expect(
      (canPerform as unknown as (...args: string[]) => boolean)('unknown', 'draft', 'approve'),
    ).toBe(false);
  });
});
