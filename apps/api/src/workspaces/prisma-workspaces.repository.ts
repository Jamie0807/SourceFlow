import { Injectable } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';

import { WorkspaceError } from '../auth/auth.errors.js';
import type { AuthRole } from '../auth/tokens/auth-token.service.js';
import { workspaceScopedWhere } from '../common/workspace-resource-scope.js';
import { PrismaService } from '../database/prisma.service.js';
import type { WorkspaceRepository } from './workspaces.repository.js';
import type { WorkspaceInvitationRecord, WorkspaceOverview } from './workspaces.types.js';

const MAX_CREATE_INVITATION_SERIALIZATION_RETRIES = 3;

@Injectable()
export class PrismaWorkspacesRepository implements WorkspaceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOverview(userId: string, workspaceId: string): Promise<WorkspaceOverview | null> {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id: workspaceId,
        members: { some: { userId } },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        brands: {
          where: { isDefault: true },
          select: { id: true, name: true },
          take: 1,
        },
        members: {
          orderBy: { createdAt: 'asc' },
          select: {
            userId: true,
            role: true,
            user: { select: { email: true, displayName: true } },
          },
        },
      },
    });
    if (workspace === null) return null;

    const currentMember = workspace.members.find((member) => member.userId === userId);
    if (currentMember === undefined) return null;

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      },
      role: currentMember.role as AuthRole,
      defaultBrand: workspace.brands[0] ?? null,
      members: workspace.members.map((member) => ({
        userId: member.userId,
        email: member.user.email,
        displayName: member.user.displayName,
        role: member.role as AuthRole,
      })),
    };
  }

  async findMemberByEmail(workspaceId: string, email: string): Promise<{ userId: string } | null> {
    return this.prisma.workspaceMember.findFirst({
      where: workspaceScopedWhere(workspaceId, { user: { email } }),
      select: { userId: true },
    });
  }

  async findActiveInvitation(
    workspaceId: string,
    email: string,
    now: Date,
  ): Promise<WorkspaceInvitationRecord | null> {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: workspaceScopedWhere(workspaceId, {
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      }),
    });
    return invitation === null ? null : toInvitationRecord(invitation);
  }

  async createInvitation(input: {
    workspaceId: string;
    email: string;
    role: AuthRole;
    tokenHash: string;
    expiresAt: Date;
    invitedById: string;
    now: Date;
  }): Promise<WorkspaceInvitationRecord> {
    const activeInvitationWhere = workspaceScopedWhere(input.workspaceId, {
      email: input.email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: input.now },
    });

    for (let attempt = 0; attempt < MAX_CREATE_INVITATION_SERIALIZATION_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const activeInvitation = await transaction.workspaceInvitation.findFirst({
              where: activeInvitationWhere,
            });
            if (activeInvitation !== null) {
              throw new WorkspaceError('WORKSPACE_INVITATION_EXISTS');
            }

            const invitation = await transaction.workspaceInvitation.create({
              data: {
                workspaceId: input.workspaceId,
                email: input.email,
                role: input.role as UserRole,
                tokenHash: input.tokenHash,
                expiresAt: input.expiresAt,
                invitedById: input.invitedById,
              },
            });
            return toInvitationRecord(invitation);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          error instanceof WorkspaceError ||
          !isSerializationFailure(error) ||
          attempt === MAX_CREATE_INVITATION_SERIALIZATION_RETRIES - 1
        ) {
          throw error;
        }
      }
    }

    throw new Error('Invitation creation retry loop exhausted');
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<WorkspaceInvitationRecord | null> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash },
    });
    return invitation === null ? null : toInvitationRecord(invitation);
  }

  async acceptInvitation(input: {
    tokenHash: string;
    userId: string;
    email: string;
    now: Date;
  }): Promise<{ workspaceId: string; userId: string; role: AuthRole }> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const update = await transaction.workspaceInvitation.updateMany({
            where: {
              tokenHash: input.tokenHash,
              email: input.email,
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { gt: input.now },
            },
            data: { acceptedAt: input.now },
          });

          if (update.count !== 1) {
            const invitation = await transaction.workspaceInvitation.findUnique({
              where: { tokenHash: input.tokenHash },
            });
            throw invitationAcceptanceError(invitation, input.email, input.now);
          }

          const invitation = await transaction.workspaceInvitation.findUnique({
            where: { tokenHash: input.tokenHash },
          });
          if (invitation === null) {
            throw new WorkspaceError('WORKSPACE_INVITATION_INVALID');
          }

          await transaction.workspaceMember.create({
            data: {
              workspaceId: invitation.workspaceId,
              userId: input.userId,
              role: invitation.role,
            },
          });

          return {
            workspaceId: invitation.workspaceId,
            userId: input.userId,
            role: invitation.role as AuthRole,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      if (isUniqueConstraintError(error)) {
        throw new WorkspaceError('WORKSPACE_MEMBER_EXISTS');
      }
      throw error;
    }
  }
}

function toInvitationRecord(invitation: {
  id: string;
  workspaceId: string;
  email: string;
  role: UserRole;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}): WorkspaceInvitationRecord {
  return {
    id: invitation.id,
    workspaceId: invitation.workspaceId,
    email: invitation.email,
    role: invitation.role as AuthRole,
    tokenHash: invitation.tokenHash,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
  };
}

function invitationAcceptanceError(
  invitation: {
    email: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  } | null,
  email: string,
  now: Date,
): WorkspaceError {
  if (invitation === null || invitation.email !== email || invitation.revokedAt !== null) {
    return new WorkspaceError('WORKSPACE_INVITATION_INVALID');
  }
  if (invitation.acceptedAt !== null) {
    return new WorkspaceError('WORKSPACE_INVITATION_USED');
  }
  if (invitation.expiresAt <= now) {
    return new WorkspaceError('WORKSPACE_INVITATION_EXPIRED');
  }
  return new WorkspaceError('WORKSPACE_INVITATION_INVALID');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
    (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')
  );
}

function isSerializationFailure(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') ||
    (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2034')
  );
}
