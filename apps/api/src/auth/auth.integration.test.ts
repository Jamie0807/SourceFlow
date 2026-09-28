import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { PrismaAuthRepository } from './prisma-auth.repository.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { AuthTokenService } from './tokens/auth-token.service.js';
import { PrismaService } from '../database/prisma.service.js';

const runIntegration = process.env.DATABASE_URL !== undefined;

describe.skipIf(!runIntegration)('认证与 PostgreSQL 集成', () => {
  it('在一个注册事务中创建租户，且 refresh family 重放会撤销后继会话', async () => {
    const prisma = new PrismaService();
    const repository = new PrismaAuthRepository(prisma);
    const service = new AuthService(
      repository,
      new PasswordHasher(),
      new AuthTokenService({
        jwtSecret: 'integration-only-secret-that-is-at-least-32-characters',
      }),
    );
    const email = `integration-${randomUUID()}@example.com`;

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

      expect(user?.passwordHash).not.toBe('integration password 123');
      expect(user?.workspaceMemberships[0]?.role).toBe('owner');
      expect(await prisma.workspace.count({ where: { id: registered.workspace.id } })).toBe(1);
      expect(
        await prisma.brand.count({
          where: { workspaceId: registered.workspace.id, isDefault: true },
        }),
      ).toBe(1);

      const rotated = await service.refresh(registered.refreshToken);
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
        const workspaceIds = memberships.map((membership) => membership.workspaceId);
        await prisma.refreshSession.deleteMany({ where: { userId: user.id } });
        await prisma.workspaceMember.deleteMany({ where: { userId: user.id } });
        await prisma.brand.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
        await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        await prisma.user.delete({ where: { id: user.id } });
      }
      await prisma.$disconnect();
    }
  });
});
