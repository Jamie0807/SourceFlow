import { describe, expect, it } from 'vitest';

import { AuthError } from '../auth.errors.js';
import { AccessTokenGuard } from './access-token.guard.js';

const claims = {
  sub: 'user-1',
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  role: 'owner' as const,
};

function context(request: { headers: { authorization?: string } }) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('AccessTokenGuard', () => {
  it('stores verified claims on the request', async () => {
    const guard = new AccessTokenGuard({ verifyAccessToken: async () => claims } as never);
    const request = { headers: { authorization: 'Bearer access-token' } };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request).toMatchObject({ auth: claims });
  });

  it('rejects missing and invalid bearer tokens with one generic error', async () => {
    const guard = new AccessTokenGuard({
      verifyAccessToken: async () => {
        throw new Error('bad');
      },
    } as never);

    await expect(guard.canActivate(context({ headers: {} }))).rejects.toMatchObject({
      code: 'AUTH_UNAUTHORIZED',
    });
    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer invalid' } })),
    ).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED' });
    expect(new AuthError('AUTH_UNAUTHORIZED').message).not.toContain('invalid');
  });
});
