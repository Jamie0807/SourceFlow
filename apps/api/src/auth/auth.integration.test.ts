import { randomUUID } from 'node:crypto';
import { UserRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { WorkspaceError, type WorkspaceErrorCode } from './auth.errors.js';
import { PrismaAuthRepository } from './prisma-auth.repository.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { AuthTokenService } from './tokens/auth-token.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { PrismaWorkspacesRepository } from '../workspaces/prisma-workspaces.repository.js';
import { hashInvitationToken } from '../workspaces/workspace-invitation-token.js';
import { WorkspacesService } from '../workspaces/workspaces.service.js';

const runIntegration = Boolean(process.env.DATABASE_URL);

describe.skipIf(!runIntegration)('认证与 PostgreSQL 集成', () => {
  it('切换活跃 workspace 后 refresh 仍使用新的 workspace 且重放会撤销后继会话', async () => {
    const prisma = new PrismaService();
    const repository = new PrismaAuthRepository(prisma);
    const tokenService = new AuthTokenService({
      jwtSecret: 'integration-only-secret-that-is-at-least-32-characters',
    });
    const service = new AuthService(repository, new PasswordHasher(), tokenService);
    const email = `integration-${randomUUID()}@example.com`;
    let secondWorkspaceId: string | undefined;

    try {
      const registered = await service.register({
        email,
        password: 'integration password 123',
        displayName: '集成测试',
      });
      const user = await prisma.user.findUnique({
        where: { email },
        include: { workspaceMemberships: true },
      });
      expect(user).not.toBeNull();
      if (user === null) throw new Error('Expected the registered user');

      expect(user?.passwordHash).not.toBe('integration password 123');
      expect(user?.workspaceMemberships[0]?.role).toBe('owner');
      expect(await prisma.workspace.count({ where: { id: registered.workspace.id } })).toBe(1);
      expect(
        await prisma.brand.count({
          where: { workspaceId: registered.workspace.id, isDefault: true },
        }),
      ).toBe(1);

      const secondWorkspace = await prisma.workspace.create({
        data: {
          name: '第二工作区',
          slug: `integration-second-${randomUUID()}`,
        },
      });
      secondWorkspaceId = secondWorkspace.id;
      await prisma.workspaceMember.create({
        data: {
          userId: user.id,
          workspaceId: secondWorkspace.id,
          role: UserRole.editor,
        },
      });
      const session = await prisma.refreshSession.findUnique({
        where: { tokenHash: tokenService.hashRefreshToken(registered.refreshToken) },
      });
      expect(session).not.toBeNull();
      if (session === null) throw new Error('Expected the registered refresh session');

      const switched = await service.switchWorkspace({
        userId: user.id,
        sessionId: session.id,
        workspaceId: secondWorkspace.id,
      });
      expect(switched.workspace.id).toBe(secondWorkspace.id);
      expect(switched.role).toBe('editor');
      expect(switched).not.toHaveProperty('refreshToken');

      const switchedSession = await prisma.refreshSession.findUnique({
        where: { id: session.id },
      });
      expect(switchedSession?.workspaceId).toBe(secondWorkspace.id);

      const rotated = await service.refresh(registered.refreshToken);
      const rotatedClaims = await tokenService.verifyAccessToken(rotated.accessToken);
      expect(rotatedClaims.workspaceId).toBe(secondWorkspace.id);
      expect(rotatedClaims.role).toBe('editor');
      await expect(service.refresh(registered.refreshToken)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSE_DETECTED',
      });
      const sessions = await prisma.refreshSession.findMany({
        where: { userId: user?.id ?? '' },
      });
      expect(sessions).toHaveLength(2);
      expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
      expect(rotated.accessToken).toEqual(expect.any(String));
    } finally {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user !== null) {
        const memberships = await prisma.workspaceMember.findMany({ where: { userId: user.id } });
        const workspaceIds = [
          ...new Set([
            ...memberships.map((membership) => membership.workspaceId),
            ...(secondWorkspaceId === undefined ? [] : [secondWorkspaceId]),
          ]),
        ];
        await prisma.refreshSession.deleteMany({ where: { userId: user.id } });
        await prisma.workspaceMember.deleteMany({ where: { userId: user.id } });
        await prisma.brand.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
        await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.$disconnect();
    }
  });

  it('只在 PostgreSQL 中保存邀请 token hash，正确用户接受后创建 membership', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerEmail = `integration-owner-${randomUUID()}@example.com`;
    const inviteeEmail = `integration-invitee-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const owner = await authService.register({
        email: ownerEmail,
        password: 'integration password 123',
        displayName: '邀请所有者',
      });
      userIds.push(owner.user.id);
      workspaceIds.push(owner.workspace.id);

      const invitee = await authService.register({
        email: inviteeEmail,
        password: 'integration password 123',
        displayName: '邀请成员',
      });
      userIds.push(invitee.user.id);
      workspaceIds.push(invitee.workspace.id);

      const created = await workspacesService.createInvitation(
        { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
        { email: inviteeEmail, role: 'editor' },
      );
      const token = invitationTokenFromUrl(created.inviteUrl);
      const invitation = await prisma.workspaceInvitation.findUnique({
        where: { id: created.id },
      });

      expect(invitation).not.toBeNull();
      expect(invitation?.workspaceId).toBe(owner.workspace.id);
      expect(invitation?.email).toBe(inviteeEmail);
      expect(invitation?.tokenHash).toBe(hashInvitationToken(token));
      expect(invitation?.tokenHash).toHaveLength(64);
      expect(invitation?.tokenHash).not.toHaveLength(token.length);

      const before = await prisma.workspaceMember.count({
        where: { workspaceId: owner.workspace.id, userId: invitee.user.id },
      });
      const accepted = await workspacesService.acceptInvitation({
        userId: invitee.user.id,
        token,
      });

      expect(accepted).toEqual({ workspaceId: owner.workspace.id, role: 'editor' });
      expect(
        await prisma.workspaceMember.count({
          where: { workspaceId: owner.workspace.id, userId: invitee.user.id },
        }),
      ).toBe(before + 1);
      expect(
        await prisma.workspaceMember.findUnique({
          where: {
            workspaceId_userId: { workspaceId: owner.workspace.id, userId: invitee.user.id },
          },
        }),
      ).toMatchObject({ role: UserRole.editor });
      expect(
        (await prisma.workspaceInvitation.findUnique({ where: { id: created.id } }))?.acceptedAt,
      ).not.toBeNull();
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });

  it('同一邀请并发接受时最多创建一个 membership，另一个结果是安全 WorkspaceError', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerEmail = `integration-concurrent-owner-${randomUUID()}@example.com`;
    const inviteeEmail = `integration-concurrent-invitee-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const owner = await authService.register({
        email: ownerEmail,
        password: 'integration password 123',
        displayName: '并发邀请所有者',
      });
      userIds.push(owner.user.id);
      workspaceIds.push(owner.workspace.id);

      const invitee = await authService.register({
        email: inviteeEmail,
        password: 'integration password 123',
        displayName: '并发邀请成员',
      });
      userIds.push(invitee.user.id);
      workspaceIds.push(invitee.workspace.id);

      const created = await workspacesService.createInvitation(
        { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
        { email: inviteeEmail, role: 'reviewer' },
      );
      const token = invitationTokenFromUrl(created.inviteUrl);
      const outcomes = await Promise.allSettled([
        workspacesService.acceptInvitation({ userId: invitee.user.id, token }),
        workspacesService.acceptInvitation({ userId: invitee.user.id, token }),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ status: 'rejected' });
      const rejection = rejected[0];
      if (rejection?.status !== 'rejected') throw new Error('Expected one rejected acceptance');
      expect(rejection.reason).toBeInstanceOf(WorkspaceError);
      expect(['WORKSPACE_INVITATION_USED', 'WORKSPACE_MEMBER_EXISTS']).toContain(
        (rejection.reason as WorkspaceError).code,
      );
      expect(
        await prisma.workspaceMember.count({
          where: { workspaceId: owner.workspace.id, userId: invitee.user.id },
        }),
      ).toBe(1);
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });

  it('错误邮箱接受邀请时不创建 membership', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerEmail = `integration-wrong-email-owner-${randomUUID()}@example.com`;
    const invitedEmail = `integration-wrong-email-target-${randomUUID()}@example.com`;
    const wrongEmail = `integration-wrong-email-user-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const owner = await authService.register({
        email: ownerEmail,
        password: 'integration password 123',
        displayName: '错误邮箱所有者',
      });
      userIds.push(owner.user.id);
      workspaceIds.push(owner.workspace.id);
      const wrongUser = await authService.register({
        email: wrongEmail,
        password: 'integration password 123',
        displayName: '错误邮箱用户',
      });
      userIds.push(wrongUser.user.id);
      workspaceIds.push(wrongUser.workspace.id);

      const created = await workspacesService.createInvitation(
        { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
        { email: invitedEmail, role: 'editor' },
      );
      const token = invitationTokenFromUrl(created.inviteUrl);
      const before = await prisma.workspaceMember.count({
        where: { workspaceId: owner.workspace.id },
      });

      await expectWorkspaceError(
        () => workspacesService.acceptInvitation({ userId: wrongUser.user.id, token }),
        'WORKSPACE_INVITATION_INVALID',
      );

      expect(
        await prisma.workspaceMember.count({ where: { workspaceId: owner.workspace.id } }),
      ).toBe(before);
      expect(
        (await prisma.workspaceInvitation.findUnique({ where: { id: created.id } }))?.acceptedAt,
      ).toBeNull();
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });

  it('过期邀请接受失败且不创建 membership', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerEmail = `integration-expired-owner-${randomUUID()}@example.com`;
    const inviteeEmail = `integration-expired-invitee-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const owner = await authService.register({
        email: ownerEmail,
        password: 'integration password 123',
        displayName: '过期邀请所有者',
      });
      userIds.push(owner.user.id);
      workspaceIds.push(owner.workspace.id);
      const invitee = await authService.register({
        email: inviteeEmail,
        password: 'integration password 123',
        displayName: '过期邀请成员',
      });
      userIds.push(invitee.user.id);
      workspaceIds.push(invitee.workspace.id);

      const created = await workspacesService.createInvitation(
        { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
        { email: inviteeEmail, role: 'editor' },
      );
      const token = invitationTokenFromUrl(created.inviteUrl);
      await prisma.workspaceInvitation.update({
        where: { id: created.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      const before = await prisma.workspaceMember.count({
        where: { workspaceId: owner.workspace.id, userId: invitee.user.id },
      });

      await expectWorkspaceError(
        () => workspacesService.acceptInvitation({ userId: invitee.user.id, token }),
        'WORKSPACE_INVITATION_EXPIRED',
      );

      expect(
        await prisma.workspaceMember.count({
          where: { workspaceId: owner.workspace.id, userId: invitee.user.id },
        }),
      ).toBe(before);
      expect(
        (await prisma.workspaceInvitation.findUnique({ where: { id: created.id } }))?.acceptedAt,
      ).toBeNull();
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });

  it('已使用邀请再次接受失败且不创建额外 membership', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerEmail = `integration-used-owner-${randomUUID()}@example.com`;
    const inviteeEmail = `integration-used-invitee-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const owner = await authService.register({
        email: ownerEmail,
        password: 'integration password 123',
        displayName: '已使用邀请所有者',
      });
      userIds.push(owner.user.id);
      workspaceIds.push(owner.workspace.id);
      const invitee = await authService.register({
        email: inviteeEmail,
        password: 'integration password 123',
        displayName: '已使用邀请成员',
      });
      userIds.push(invitee.user.id);
      workspaceIds.push(invitee.workspace.id);

      const created = await workspacesService.createInvitation(
        { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
        { email: inviteeEmail, role: 'reviewer' },
      );
      const token = invitationTokenFromUrl(created.inviteUrl);
      await workspacesService.acceptInvitation({ userId: invitee.user.id, token });
      const before = await prisma.workspaceMember.count({
        where: { workspaceId: owner.workspace.id, userId: invitee.user.id },
      });

      await expectWorkspaceError(
        () => workspacesService.acceptInvitation({ userId: invitee.user.id, token }),
        'WORKSPACE_INVITATION_USED',
      );

      expect(
        await prisma.workspaceMember.count({
          where: { workspaceId: owner.workspace.id, userId: invitee.user.id },
        }),
      ).toBe(before);
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });

  it('按 workspace 和 email 隔离邀请，两个租户可以各自创建同邮箱邀请', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerAEmail = `integration-scope-a-${randomUUID()}@example.com`;
    const ownerBEmail = `integration-scope-b-${randomUUID()}@example.com`;
    const invitedEmail = `integration-scope-target-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const ownerA = await authService.register({
        email: ownerAEmail,
        password: 'integration password 123',
        displayName: '租户 A 所有者',
      });
      userIds.push(ownerA.user.id);
      workspaceIds.push(ownerA.workspace.id);
      const ownerB = await authService.register({
        email: ownerBEmail,
        password: 'integration password 123',
        displayName: '租户 B 所有者',
      });
      userIds.push(ownerB.user.id);
      workspaceIds.push(ownerB.workspace.id);

      const invitationA = await workspacesService.createInvitation(
        { userId: ownerA.user.id, workspaceId: ownerA.workspace.id, role: 'owner' },
        { email: ` ${invitedEmail.toUpperCase()} `, role: 'editor' },
      );
      const invitationB = await workspacesService.createInvitation(
        { userId: ownerB.user.id, workspaceId: ownerB.workspace.id, role: 'owner' },
        { email: invitedEmail, role: 'reviewer' },
      );
      const invitations = await prisma.workspaceInvitation.findMany({
        where: { email: invitedEmail },
        orderBy: { workspaceId: 'asc' },
      });

      expect(invitations).toHaveLength(2);
      expect(new Set(invitations.map((invitation) => invitation.workspaceId))).toEqual(
        new Set([ownerA.workspace.id, ownerB.workspace.id]),
      );
      expect(invitations.map((invitation) => invitation.email)).toEqual([
        invitedEmail,
        invitedEmail,
      ]);
      expect(invitationA.id).not.toBe(invitationB.id);
      expect(
        await prisma.workspaceInvitation.count({
          where: { workspaceId: ownerA.workspace.id, email: invitedEmail },
        }),
      ).toBe(1);
      expect(
        await prisma.workspaceInvitation.count({
          where: { workspaceId: ownerB.workspace.id, email: invitedEmail },
        }),
      ).toBe(1);
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });

  it('同一 workspace 和 email 并发创建邀请时恰好一个成功', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerEmail = `integration-create-concurrent-owner-${randomUUID()}@example.com`;
    const invitedEmail = `integration-create-concurrent-target-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const owner = await authService.register({
        email: ownerEmail,
        password: 'integration password 123',
        displayName: '并发创建邀请所有者',
      });
      userIds.push(owner.user.id);
      workspaceIds.push(owner.workspace.id);

      const outcomes = await Promise.allSettled([
        workspacesService.createInvitation(
          { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
          { email: invitedEmail, role: 'editor' },
        ),
        workspacesService.createInvitation(
          { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
          { email: invitedEmail, role: 'editor' },
        ),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const rejection = rejected[0];
      if (rejection?.status !== 'rejected') throw new Error('Expected one rejected invitation');
      expect(rejection.reason).toBeInstanceOf(WorkspaceError);
      expect((rejection.reason as WorkspaceError).code).toBe('WORKSPACE_INVITATION_EXISTS');

      expect(
        await prisma.workspaceInvitation.count({
          where: {
            workspaceId: owner.workspace.id,
            email: invitedEmail,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        }),
      ).toBe(1);
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });

  it('同一 workspace 和 email 的过期邀请历史存在时可以再次创建邀请', async () => {
    const prisma = new PrismaService();
    const { authService, workspacesService } = createIntegrationServices(prisma);
    const ownerEmail = `integration-create-expired-owner-${randomUUID()}@example.com`;
    const invitedEmail = `integration-create-expired-target-${randomUUID()}@example.com`;
    const userIds: string[] = [];
    const workspaceIds: string[] = [];

    try {
      const owner = await authService.register({
        email: ownerEmail,
        password: 'integration password 123',
        displayName: '过期邀请历史所有者',
      });
      userIds.push(owner.user.id);
      workspaceIds.push(owner.workspace.id);

      const expired = await workspacesService.createInvitation(
        { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
        { email: invitedEmail, role: 'reviewer' },
      );
      await prisma.workspaceInvitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      const recreated = await workspacesService.createInvitation(
        { userId: owner.user.id, workspaceId: owner.workspace.id, role: 'owner' },
        { email: invitedEmail, role: 'editor' },
      );

      expect(recreated.id).not.toBe(expired.id);
      const expiredInvitation = await prisma.workspaceInvitation.findUnique({
        where: { id: expired.id },
      });
      expect(
        await prisma.workspaceInvitation.count({
          where: {
            workspaceId: owner.workspace.id,
            email: invitedEmail,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        }),
      ).toBe(1);
      expect(expiredInvitation?.expiresAt).toBeInstanceOf(Date);
      expect(expiredInvitation?.expiresAt.getTime()).toBeLessThan(Date.now());
    } finally {
      await cleanupIntegrationData(prisma, userIds, workspaceIds);
      await prisma.$disconnect();
    }
  });
});

function createIntegrationServices(prisma: PrismaService): {
  authService: AuthService;
  workspacesService: WorkspacesService;
} {
  const authRepository = new PrismaAuthRepository(prisma);
  const authService = new AuthService(
    authRepository,
    new PasswordHasher(),
    new AuthTokenService({
      jwtSecret: 'integration-only-secret-that-is-at-least-32-characters',
    }),
  );
  return {
    authService,
    workspacesService: new WorkspacesService(
      new PrismaWorkspacesRepository(prisma),
      authRepository,
      authService,
    ),
  };
}

function invitationTokenFromUrl(inviteUrl: string): string {
  const encodedToken = inviteUrl.slice(inviteUrl.lastIndexOf('/') + 1);
  if (encodedToken.length === 0) throw new Error('Expected an invitation token in the URL');
  return decodeURIComponent(encodedToken);
}

async function expectWorkspaceError(
  action: () => Promise<unknown>,
  code: WorkspaceErrorCode,
): Promise<void> {
  try {
    await action();
    throw new Error(`Expected WorkspaceError ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceError);
    expect((error as WorkspaceError).code).toBe(code);
  }
}

async function cleanupIntegrationData(
  prisma: PrismaService,
  userIds: readonly string[],
  workspaceIds: readonly string[],
): Promise<void> {
  const memberships =
    userIds.length === 0
      ? []
      : await prisma.workspaceMember.findMany({
          where: { userId: { in: [...userIds] } },
          select: { workspaceId: true },
        });
  const allWorkspaceIds = [
    ...new Set([...workspaceIds, ...memberships.map((item) => item.workspaceId)]),
  ];

  if (userIds.length > 0) {
    await prisma.workspaceInvitation.deleteMany({ where: { invitedById: { in: [...userIds] } } });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: [...userIds] } } });
    await prisma.workspaceMember.deleteMany({ where: { userId: { in: [...userIds] } } });
  }
  if (allWorkspaceIds.length > 0) {
    await prisma.workspaceInvitation.deleteMany({
      where: { workspaceId: { in: allWorkspaceIds } },
    });
    await prisma.refreshSession.deleteMany({
      where: { workspaceId: { in: allWorkspaceIds } },
    });
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: { in: allWorkspaceIds } },
    });
    await prisma.brand.deleteMany({ where: { workspaceId: { in: allWorkspaceIds } } });
    await prisma.workspace.deleteMany({ where: { id: { in: allWorkspaceIds } } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  }
}
