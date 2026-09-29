import { describe, expect, it, vi } from 'vitest';

import { AuthError, WorkspaceError } from '../auth/auth.errors.js';
import { TenantMembershipGuard } from './tenant-context.js';

function context(request: object) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

type AuthenticatedRequest = {
  auth: {
    sub: string;
    sessionId: string;
    workspaceId: string;
    role: string;
  };
  membership?: { role: string };
};

describe('TenantMembershipGuard', () => {
  it('rejects requests without authentication', async () => {
    const repository = { findMembership: vi.fn() };

    await expect(
      new TenantMembershipGuard(repository as never).canActivate(context({})),
    ).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED', status: 401 });
    expect(repository.findMembership).not.toHaveBeenCalled();
  });

  it('loads live membership instead of trusting JWT role', async () => {
    const repository = {
      findMembership: vi.fn().mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        role: 'owner',
        workspace: { id: 'workspace-1', name: 'Workspace', slug: 'workspace' },
      }),
    };
    const request: AuthenticatedRequest = {
      auth: {
        sub: 'user-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        role: 'reviewer',
      },
    };

    await expect(
      new TenantMembershipGuard(repository as never).canActivate(context(request)),
    ).resolves.toBe(true);
    expect(repository.findMembership).toHaveBeenCalledWith('user-1', 'workspace-1');
    expect(request.membership?.role).toBe('owner');
  });

  it('rejects missing membership without exposing workspace details', async () => {
    const repository = { findMembership: vi.fn().mockResolvedValue(null) };
    const request: AuthenticatedRequest = {
      auth: {
        sub: 'user-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-secret-id',
        role: 'reviewer',
      },
    };

    const error = await new TenantMembershipGuard(repository as never)
      .canActivate(context(request))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toMatchObject({ code: 'WORKSPACE_ACCESS_DENIED', status: 403 });
    expect((error as Error).message).not.toContain('workspace-secret-id');
    expect((error as Error).message).not.toContain('Workspace');
  });

  it('rejects a membership returned for another user without setting request membership', async () => {
    const repository = {
      findMembership: vi.fn().mockResolvedValue({
        userId: 'another-user',
        workspaceId: 'workspace-1',
        role: 'owner',
      }),
    };
    const request: AuthenticatedRequest = {
      auth: {
        sub: 'user-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        role: 'reviewer',
      },
    };

    await expect(
      new TenantMembershipGuard(repository as never).canActivate(context(request)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ACCESS_DENIED', status: 403 });
    expect(request).not.toHaveProperty('membership');
  });

  it('rejects a membership returned for another workspace without setting request membership', async () => {
    const repository = {
      findMembership: vi.fn().mockResolvedValue({
        userId: 'user-1',
        workspaceId: 'another-workspace',
        role: 'owner',
      }),
    };
    const request: AuthenticatedRequest = {
      auth: {
        sub: 'user-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        role: 'reviewer',
      },
    };

    await expect(
      new TenantMembershipGuard(repository as never).canActivate(context(request)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ACCESS_DENIED', status: 403 });
    expect(request).not.toHaveProperty('membership');
  });
});

describe('WorkspaceError', () => {
  it('maps workspace failures to safe HTTP statuses', () => {
    expect(new WorkspaceError('WORKSPACE_ACCESS_DENIED').status).toBe(403);
    expect(new WorkspaceError('WORKSPACE_MEMBER_EXISTS').status).toBe(409);
    expect(new WorkspaceError('WORKSPACE_INVITATION_EXISTS').status).toBe(409);
    expect(new WorkspaceError('WORKSPACE_INVITATION_INVALID').status).toBe(404);
    expect(new WorkspaceError('WORKSPACE_INVITATION_EXPIRED').status).toBe(410);
    expect(new WorkspaceError('WORKSPACE_INVITATION_USED').status).toBe(409);
    expect(new WorkspaceError('WORKSPACE_INVALID_ROLE').status).toBe(400);
  });

  it('does not expose caller-controlled workspace details in default messages', () => {
    const error = new WorkspaceError('WORKSPACE_ACCESS_DENIED');

    expect(error.message).not.toContain('workspace-secret-id');
    expect(error.message).not.toContain('Workspace');
  });
});

describe('TenantMembershipGuard auth error compatibility', () => {
  it('keeps the existing unauthorized error type available', () => {
    expect(new AuthError('AUTH_UNAUTHORIZED').status).toBe(401);
  });
});
