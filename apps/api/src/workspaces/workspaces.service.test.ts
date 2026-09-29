import { describe, expect, it, vi } from 'vitest';

import { WorkspaceError } from '../auth/auth.errors.js';
import type { AuthRepository } from '../auth/auth.repository.js';
import type { AuthUserRecord } from '../auth/auth.types.js';
import type { AuthService, ActiveWorkspaceResult } from '../auth/auth.service.js';
import type { TenantContext } from '../common/tenant-context.js';
import type { WorkspaceRepository } from './workspaces.repository.js';
import type { WorkspaceOverview } from './workspaces.types.js';
import { WorkspacesService } from './workspaces.service.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const INVITATION_TOKEN = 'invitation-token-value';

const overview: WorkspaceOverview = {
  workspace: { id: 'workspace-1', name: '创作者工作区', slug: 'creator-workspace' },
  role: 'owner',
  defaultBrand: { id: 'brand-1', name: '默认品牌' },
  members: [
    {
      userId: 'owner-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
    },
  ],
};

const currentUser: AuthUserRecord = {
  user: { id: 'editor-1', email: 'Teammate@Example.com', displayName: null },
  passwordHash: null,
  memberships: [],
};

const activeWorkspaceResult: ActiveWorkspaceResult = {
  accessToken: 'new-access-token',
  user: currentUser.user,
  workspace: { id: 'workspace-2', name: '第二工作区', slug: 'second-workspace' },
  role: 'editor',
};

function createService(
  overrides: {
    workspaceRepository?: Partial<WorkspaceRepository>;
    authRepository?: Partial<AuthRepository>;
    authService?: Partial<AuthService>;
  } = {},
) {
  const workspaceRepository = {
    findOverview: vi.fn().mockResolvedValue(overview),
    findMemberByEmail: vi.fn().mockResolvedValue(null),
    findActiveInvitation: vi.fn().mockResolvedValue(null),
    createInvitation: vi.fn().mockResolvedValue({
      id: 'invitation-1',
      workspaceId: 'workspace-1',
      email: 'teammate@example.com',
      role: 'reviewer',
      tokenHash: 'hash',
      expiresAt: new Date(NOW.getTime() + 604_800_000),
      acceptedAt: null,
      revokedAt: null,
    }),
    findInvitationByTokenHash: vi.fn().mockResolvedValue(null),
    acceptInvitation: vi.fn().mockResolvedValue({
      workspaceId: 'workspace-1',
      userId: 'editor-1',
      role: 'reviewer',
    }),
    ...overrides.workspaceRepository,
  } as unknown as WorkspaceRepository;
  const authRepository = {
    findUserById: vi.fn().mockResolvedValue(currentUser),
    ...overrides.authRepository,
  } as unknown as AuthRepository;
  const authService = {
    switchWorkspace: vi.fn().mockResolvedValue(activeWorkspaceResult),
    ...overrides.authService,
  } as unknown as AuthService;

  return {
    service: new WorkspacesService(workspaceRepository, authRepository, authService),
    workspaceRepository,
    authRepository,
    authService,
  };
}

describe('WorkspacesService', () => {
  it('uses a positive WORKSPACE_INVITATION_TTL_SECONDS value', async () => {
    const originalTtl = process.env.WORKSPACE_INVITATION_TTL_SECONDS;
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.WORKSPACE_INVITATION_TTL_SECONDS = '3600';

    try {
      const { service, workspaceRepository } = createService();

      await service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: 'teammate@example.com', role: 'reviewer' },
      );

      expect(workspaceRepository.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: new Date('2026-09-28T13:00:00.000Z') }),
      );
    } finally {
      vi.useRealTimers();
      if (originalTtl === undefined) delete process.env.WORKSPACE_INVITATION_TTL_SECONDS;
      else process.env.WORKSPACE_INVITATION_TTL_SECONDS = originalTtl;
    }
  });

  it.each(['0', 'not-a-number'])(
    'falls back to seven days for invalid WORKSPACE_INVITATION_TTL_SECONDS value %s',
    async (configuredTtl) => {
      const originalTtl = process.env.WORKSPACE_INVITATION_TTL_SECONDS;
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      process.env.WORKSPACE_INVITATION_TTL_SECONDS = configuredTtl;

      try {
        const { service, workspaceRepository } = createService();

        await service.createInvitation(
          { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
          { email: 'teammate@example.com', role: 'reviewer' },
        );

        expect(workspaceRepository.createInvitation).toHaveBeenCalledWith(
          expect.objectContaining({ expiresAt: new Date('2026-10-05T12:00:00.000Z') }),
        );
      } finally {
        vi.useRealTimers();
        if (originalTtl === undefined) delete process.env.WORKSPACE_INVITATION_TTL_SECONDS;
        else process.env.WORKSPACE_INVITATION_TTL_SECONDS = originalTtl;
      }
    },
  );

  it('returns the current workspace overview including the default brand', async () => {
    const { service, workspaceRepository } = createService();
    const context: TenantContext = { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' };

    await expect(service.getCurrent(context)).resolves.toEqual(overview);
    expect(workspaceRepository.findOverview).toHaveBeenCalledWith('owner-1', 'workspace-1');
  });

  it('allows only an owner to create an editor or reviewer invitation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { service, workspaceRepository } = createService();

      await expect(
        service.createInvitation(
          { userId: 'editor-1', workspaceId: 'workspace-1', role: 'editor' },
          { email: ' teammate@example.com ', role: 'reviewer' },
        ),
      ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });

      const result = await service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: ' teammate@example.com ', role: 'reviewer' },
      );

      expect(result).toEqual({
        id: 'invitation-1',
        email: 'teammate@example.com',
        role: 'reviewer',
        expiresAt: new Date('2026-10-05T12:00:00.000Z'),
        inviteUrl: expect.stringContaining('/invitations/'),
      });
      expect(workspaceRepository.createInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'workspace-1',
          email: 'teammate@example.com',
          role: 'reviewer',
          invitedById: 'owner-1',
          expiresAt: new Date('2026-10-05T12:00:00.000Z'),
          tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      const createInvitationMock = workspaceRepository.createInvitation as unknown as ReturnType<
        typeof vi.fn
      >;
      const invitationInput = createInvitationMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(invitationInput).not.toHaveProperty('token');
      expect(result).not.toHaveProperty('tokenHash');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed invitation input and owner or unknown target roles', async () => {
    const { service } = createService();

    await expect(
      service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        null,
      ),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_INPUT', status: 400 });
    await expect(
      service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: 'invalid', role: 'editor' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_INPUT', status: 400 });
    await expect(
      service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: `${'a'.repeat(245)}@example.com`, role: 'editor' },
      ),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_INPUT', status: 400 });
    await expect(
      service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: 'teammate@example.com', role: 'owner' },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_INVALID_ROLE', status: 400 });
    await expect(
      service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: 'teammate@example.com', role: 'unknown' },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_INVALID_ROLE', status: 400 });
  });

  it('rejects an existing member or active invitation after email normalization', async () => {
    const memberCase = createService({
      workspaceRepository: {
        findMemberByEmail: vi.fn().mockResolvedValue({ userId: 'member-1' }),
      },
    });
    await expect(
      memberCase.service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: ' MEMBER@example.com ', role: 'editor' },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_MEMBER_EXISTS', status: 409 });
    expect(memberCase.workspaceRepository.findMemberByEmail).toHaveBeenCalledWith(
      'workspace-1',
      'member@example.com',
    );

    const invitationCase = createService({
      workspaceRepository: {
        findActiveInvitation: vi.fn().mockResolvedValue({ id: 'invitation-1' }),
      },
    });
    await expect(
      invitationCase.service.createInvitation(
        { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
        { email: ' Pending@example.com ', role: 'editor' },
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_INVITATION_EXISTS', status: 409 });
    expect(invitationCase.workspaceRepository.findActiveInvitation).toHaveBeenCalledWith(
      'workspace-1',
      'pending@example.com',
      expect.any(Date),
    );
  });

  it('hashes the token and accepts an invitation using the current user email', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const { service, workspaceRepository, authRepository } = createService({
        authRepository: {
          findUserById: vi.fn().mockResolvedValue({
            ...currentUser,
            user: { ...currentUser.user, email: ' Current@Example.com ' },
          }),
        },
      });

      await expect(
        service.acceptInvitation({ userId: 'editor-1', token: INVITATION_TOKEN }),
      ).resolves.toEqual({ workspaceId: 'workspace-1', role: 'reviewer' });
      expect(authRepository.findUserById).toHaveBeenCalledWith('editor-1');
      expect(workspaceRepository.acceptInvitation).toHaveBeenCalledWith({
        tokenHash: 'e9b966db79b298db7682ba54bccf6f7d575e2dd2b72976c6a16c0d2f744020b2',
        userId: 'editor-1',
        email: 'current@example.com',
        now: NOW,
      });
      expect(
        JSON.stringify(await service.acceptInvitation({ userId: 'editor-1', token: 'second' })),
      ).not.toContain('tokenHash');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['invalid token', 'WORKSPACE_INVITATION_INVALID'],
    ['email mismatch', 'WORKSPACE_INVITATION_INVALID'],
    ['already used', 'WORKSPACE_INVITATION_USED'],
  ] as const)('propagates a safe invitation error for %s', async (_caseName, code) => {
    const { service } = createService({
      workspaceRepository: {
        acceptInvitation: vi.fn().mockRejectedValue(new WorkspaceError(code)),
      },
    });

    await expect(
      service.acceptInvitation({ userId: 'editor-1', token: INVITATION_TOKEN }),
    ).rejects.toMatchObject({ code });
  });

  it('activates a workspace through AuthService without returning a refresh token', async () => {
    const { service, authService } = createService();

    const result = await service.activateWorkspace({
      userId: 'editor-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-2',
    });

    expect(authService.switchWorkspace).toHaveBeenCalledWith({
      userId: 'editor-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-2',
    });
    expect(result).toEqual(activeWorkspaceResult);
    expect(result).not.toHaveProperty('refreshToken');
  });
});
