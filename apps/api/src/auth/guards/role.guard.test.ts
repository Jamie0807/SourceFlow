import { describe, expect, it } from 'vitest';

import { AuthError } from '../auth.errors.js';
import { RoleGuard } from './role.guard.js';

function context(request: Record<string, unknown>) {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('RoleGuard', () => {
  it('requires a fresh membership context instead of trusting JWT role claims', () => {
    const guard = new RoleGuard({ getAllAndOverride: () => ['owner'] } as never);
    const request = {
      auth: { sub: 'user-1', sessionId: 'session-1', workspaceId: 'workspace-1', role: 'owner' },
    };

    expect(() => guard.canActivate(context(request))).toThrowError(
      expect.objectContaining({ code: 'AUTH_FORBIDDEN' }),
    );
  });

  it('uses the database-backed membership role and tenant identity', () => {
    const guard = new RoleGuard({ getAllAndOverride: () => ['owner'] } as never);
    const request = {
      auth: { sub: 'user-1', sessionId: 'session-1', workspaceId: 'workspace-1', role: 'reviewer' },
      membership: { userId: 'user-1', workspaceId: 'workspace-1', role: 'owner' },
    };

    expect(guard.canActivate(context(request))).toBe(true);
    expect(new AuthError('AUTH_FORBIDDEN').status).toBe(403);
  });

  it('rejects a membership from another workspace or user', () => {
    const guard = new RoleGuard({ getAllAndOverride: () => ['owner'] } as never);
    const request = {
      auth: { sub: 'user-1', sessionId: 'session-1', workspaceId: 'workspace-1', role: 'owner' },
      membership: { userId: 'user-2', workspaceId: 'workspace-2', role: 'owner' },
    };

    expect(() => guard.canActivate(context(request))).toThrowError(
      expect.objectContaining({ code: 'AUTH_FORBIDDEN' }),
    );
  });
});
