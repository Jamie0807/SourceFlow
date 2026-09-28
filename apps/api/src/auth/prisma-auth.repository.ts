import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';

import { PrismaService } from '../database/prisma.service.js';
import type { AuthRepository } from './auth.repository.js';
import type {
  AuthUserRecord,
  CreateSessionInput,
  RefreshSessionRecord,
  RegisterRecordInput,
  RegistrationRecord,
  RotateSessionInput,
} from './auth.types.js';
import type { AuthRole } from './tokens/auth-token.service.js';

@Injectable()
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.findUser({ email });
  }

  findUserById(userId: string): Promise<AuthUserRecord | null> {
    return this.findUser({ id: userId });
  }

  private async findUser(where: Prisma.UserWhereUniqueInput): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where,
      include: {
        workspaceMemberships: {
          include: { workspace: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (user === null) return null;

    return {
      user: { id: user.id, email: user.email, displayName: user.displayName },
      passwordHash: user.passwordHash,
      memberships: user.workspaceMemberships.map((membership) => ({
        userId: membership.userId,
        workspaceId: membership.workspaceId,
        role: membership.role as AuthRole,
        workspace: {
          id: membership.workspace.id,
          name: membership.workspace.name,
          slug: membership.workspace.slug,
        },
      })),
    };
  }

  async register(input: RegisterRecordInput): Promise<RegistrationRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          displayName: input.displayName,
        },
      });
      const workspace = await transaction.workspace.create({
        data: {
          name: input.workspaceName,
          slug: input.workspaceSlug,
        },
      });
      await transaction.brand.create({
        data: {
          workspaceId: workspace.id,
          name: '默认品牌',
          isDefault: true,
        },
      });
      const membership = await transaction.workspaceMember.create({
        data: {
          userId: user.id,
          workspaceId: workspace.id,
          role: UserRole.owner,
        },
      });
      const session = await transaction.refreshSession.create({
        data: {
          id: input.session.id,
          userId: user.id,
          workspaceId: workspace.id,
          tokenHash: input.session.tokenHash,
          familyId: input.session.familyId,
          expiresAt: input.session.expiresAt,
        },
      });

      return {
        user: { id: user.id, email: user.email, displayName: user.displayName },
        membership: {
          userId: membership.userId,
          workspaceId: membership.workspaceId,
          role: membership.role as AuthRole,
          workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
        },
        session: toRefreshSession(session),
      };
    });
  }

  async createSession(input: CreateSessionInput): Promise<RefreshSessionRecord> {
    const session = await this.prisma.refreshSession.create({
      data: {
        id: input.id,
        userId: input.userId,
        workspaceId: input.workspaceId,
        tokenHash: input.tokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
      },
    });
    return toRefreshSession(session);
  }

  async findRefreshSessionByHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash } });
    return session === null ? null : toRefreshSession(session);
  }

  async findMembership(userId: string, workspaceId: string) {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });
    if (membership === null) return null;

    return {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role as AuthRole,
      workspace: {
        id: membership.workspace.id,
        name: membership.workspace.name,
        slug: membership.workspace.slug,
      },
    };
  }

  async rotateSession(input: RotateSessionInput): Promise<RefreshSessionRecord | null> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          await transaction.refreshSession.create({
            data: {
              id: input.nextSession.id,
              userId: input.nextSession.userId,
              workspaceId: input.nextSession.workspaceId,
              tokenHash: input.nextSession.tokenHash,
              familyId: input.nextSession.familyId,
              expiresAt: input.nextSession.expiresAt,
            },
          });

          const update = await transaction.refreshSession.updateMany({
            where: {
              id: input.currentSessionId,
              tokenHash: input.currentTokenHash,
              revokedAt: null,
              expiresAt: { gt: input.now },
            },
            data: {
              revokedAt: input.now,
              replacedById: input.nextSession.id,
              revocationReason: 'rotated',
            },
          });
          if (update.count !== 1) throw new RefreshRotationConflictError();

          const next = await transaction.refreshSession.findUnique({
            where: { id: input.nextSession.id },
          });
          return next === null ? null : toRefreshSession(next);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof RefreshRotationConflictError || isSerializationConflict(error))
        return null;
      throw error;
    }
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: reason },
    });
  }

  async revokeSessionFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshSession.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revocationReason: reason },
    });
  }
}

class RefreshRotationConflictError extends Error {
  constructor() {
    super('Refresh session rotation lost a compare-and-set race');
    this.name = 'RefreshRotationConflictError';
  }
}

function isSerializationConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034';
}

function toRefreshSession(session: {
  id: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}): RefreshSessionRecord {
  return {
    id: session.id,
    userId: session.userId,
    workspaceId: session.workspaceId,
    tokenHash: session.tokenHash,
    familyId: session.familyId,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    replacedById: session.replacedById,
  };
}
