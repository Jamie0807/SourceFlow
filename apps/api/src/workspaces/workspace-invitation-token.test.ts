import { describe, expect, it } from 'vitest';

import {
  buildInvitationUrl,
  createInvitationToken,
  hashInvitationToken,
} from './workspace-invitation-token.js';

describe('workspace invitation token helpers', () => {
  it('generates random tokens and stable non-reversible hashes', () => {
    const first = createInvitationToken();
    const second = createInvitationToken();

    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
    expect(hashInvitationToken(first)).toHaveLength(64);
    expect(hashInvitationToken('token-value')).toBe(
      'e6c02a5742ea9d4de588eb9b9de7bed43dc17011552186bed3e98b2c5958ff4a',
    );
    expect(hashInvitationToken(first)).not.toBe(first);
  });

  it('builds the URL from WEB_APP_ORIGIN', () => {
    expect(buildInvitationUrl('token-value', { WEB_APP_ORIGIN: 'https://app.test/' })).toBe(
      'https://app.test/invitations/token-value',
    );
  });
});
