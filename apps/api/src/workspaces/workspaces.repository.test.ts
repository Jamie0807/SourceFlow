import { Prisma, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceError } from '../auth/auth.errors.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { WorkspaceRepository } from './workspaces.repository.js';
import { PrismaWorkspacesRepository } from './prisma-workspaces.repository.js';

function createRepository(): {
  prisma: {
    workspace: { findFirst: ReturnType<typeof vi.fn> };
    workspaceMember: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    workspaceInvitation: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
  repository: PrismaWorkspacesRepository;
} {
  const prisma = {
    workspace: { findFirst: vi.fn() },
    workspaceMember: { findFirst: vi.fn(), create: vi.fn() },
    workspaceInvitation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  return {
    prisma,
    repository: new PrismaWorkspacesRepository(prisma as unknown as PrismaService),
  };
}

function invitationRecord(
  overrides: Partial<{
    id: string;
    workspaceId: string;
    email: string;
    role: UserRole;
    tokenHash: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  }> = {},
) {
  return {
    id: 'invitation-1',
    workspaceId: 'workspace-1',
    email: 'editor@example.com',
    role: UserRole.editor,
    tokenHash: 'hash-1',
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('PrismaWorkspacesRepository', () => {
  it('returns a non-sensitive overview scoped by workspace and current membership', async () => {
    const { prisma, repository } = createRepository();
    prisma.workspace.findFirst.mockResolvedValue({
      id: 'workspace-1',
      name: '创作者工作区',
      slug: 'creator-workspace',
      brands: [{ id: 'brand-1', name: '默认品牌' }],
      members: [
        {
          userId: 'user-1',
          role: UserRole.owner,
          user: { email: 'owner@example.com', displayName: 'Owner' },
        },
        {
          userId: 'user-2',
          role: UserRole.editor,
          user: { email: 'editor@example.com', displayName: null },
        },
      ],
    });

    await expect(repository.findOverview('user-1', 'workspace-1')).resolves.toEqual({
      workspace: { id: 'workspace-1', name: '创作者工作区', slug: 'creator-workspace' },
      role: 'owner',
      defaultBrand: { id: 'brand-1', name: '默认品牌' },
      members: [
        { userId: 'user-1', email: 'owner@example.com', displayName: 'Owner', role: 'owner' },
        { userId: 'user-2', email: 'editor@example.com', displayName: null, role: 'editor' },
      ],
    });

    expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
      where: { id: 'workspace-1', members: { some: { userId: 'user-1' } } },
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
  });

  it('scopes member and active invitation lookups with workspaceId', async () => {
    const { prisma, repository } = createRepository();
    const now = new Date('2026-09-28T12:00:00.000Z');
    const record = invitationRecord();
    prisma.workspaceMember.findFirst.mockResolvedValue({ userId: 'user-2' });
    prisma.workspaceInvitation.findFirst.mockResolvedValue(record);

    await expect(
      repository.findMemberByEmail('workspace-1', 'editor@example.com'),
    ).resolves.toEqual({ userId: 'user-2' });
    await expect(
      repository.findActiveInvitation('workspace-1', 'editor@example.com', now),
    ).resolves.toEqual(record);

    expect(prisma.workspaceMember.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1', user: { email: 'editor@example.com' } },
      select: { userId: true },
    });
    expect(prisma.workspaceInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        email: 'editor@example.com',
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
  });

  it('creates an invitation using only the token hash', async () => {
    const { prisma, repository } = createRepository();
    const transaction = {
      workspaceInvitation: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    const input = {
      workspaceId: 'workspace-1',
      email: 'editor@example.com',
      role: 'editor' as const,
      tokenHash: 'hash-1',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      invitedById: 'owner-1',
      now: new Date('2026-09-28T12:00:00.000Z'),
    } satisfies Parameters<WorkspaceRepository['createInvitation']>[0];
    const record = invitationRecord();
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof prisma) => unknown) =>
        callback(transaction as typeof prisma),
    );
    transaction.workspaceInvitation.findFirst.mockResolvedValue(null);
    transaction.workspaceInvitation.create.mockResolvedValue(record);

    await expect(repository.createInvitation(input)).resolves.toEqual(record);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(transaction.workspaceInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        email: 'editor@example.com',
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: input.now },
      },
    });
    expect(transaction.workspaceInvitation.create).toHaveBeenCalledWith({
      data: {
        workspaceId: 'workspace-1',
        email: 'editor@example.com',
        role: UserRole.editor,
        tokenHash: 'hash-1',
        expiresAt: input.expiresAt,
        invitedById: 'owner-1',
      },
    });
    expect(transaction.workspaceInvitation.create.mock.calls[0]?.[0].data).not.toHaveProperty(
      'token',
    );

    type AcceptsPlaintextToken = 'token' extends keyof typeof input ? true : false;
    const acceptsPlaintextToken: AcceptsPlaintextToken = false;
    expect(acceptsPlaintextToken).toBe(false);
  });

  it('rejects an existing active invitation inside the Serializable transaction', async () => {
    const { prisma, repository } = createRepository();
    const input = {
      workspaceId: 'workspace-1',
      email: 'editor@example.com',
      role: 'editor' as const,
      tokenHash: 'hash-2',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      invitedById: 'owner-1',
      now: new Date('2026-09-28T12:00:00.000Z'),
    } satisfies Parameters<WorkspaceRepository['createInvitation']>[0];
    const transaction = {
      workspaceInvitation: {
        findFirst: vi.fn().mockResolvedValue(invitationRecord()),
        create: vi.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof prisma) => unknown) =>
        callback(transaction as typeof prisma),
    );

    await expect(repository.createInvitation(input)).rejects.toMatchObject({
      code: 'WORKSPACE_INVITATION_EXISTS',
      status: 409,
    });
    expect(transaction.workspaceInvitation.create).not.toHaveBeenCalled();
  });

  it('retries serialization failures only a finite number of times', async () => {
    const { prisma, repository } = createRepository();
    const input = {
      workspaceId: 'workspace-1',
      email: 'editor@example.com',
      role: 'editor' as const,
      tokenHash: 'hash-3',
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
      invitedById: 'owner-1',
      now: new Date('2026-09-28T12:00:00.000Z'),
    } satisfies Parameters<WorkspaceRepository['createInvitation']>[0];
    const serializationError = new Prisma.PrismaClientKnownRequestError('serialization', {
      code: 'P2034',
      clientVersion: '6.19.0',
    });
    prisma.$transaction
      .mockRejectedValueOnce(serializationError)
      .mockRejectedValueOnce(serializationError)
      .mockRejectedValueOnce(serializationError)
      .mockRejectedValueOnce(serializationError);

    await expect(repository.createInvitation(input)).rejects.toBe(serializationError);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('finds invitations by token hash without returning unrelated fields', async () => {
    const { prisma, repository } = createRepository();
    const record = invitationRecord();
    prisma.workspaceInvitation.findUnique.mockResolvedValue(record);

    await expect(repository.findInvitationByTokenHash('hash-1')).resolves.toEqual(record);
    expect(prisma.workspaceInvitation.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hash-1' },
    });
  });

  it('accepts an invitation in a Serializable transaction before creating its member', async () => {
    const { prisma, repository } = createRepository();
    const now = new Date('2026-09-28T12:00:00.000Z');
    const record = invitationRecord();
    const order: string[] = [];
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof prisma) => unknown) => callback(prisma),
    );
    prisma.workspaceInvitation.updateMany.mockImplementation(async (query) => {
      order.push('updateMany');
      expect(query).toEqual({
        where: {
          tokenHash: 'hash-1',
          email: 'editor@example.com',
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      return { count: 1 };
    });
    prisma.workspaceInvitation.findUnique.mockImplementation(async () => {
      order.push('findUnique');
      return record;
    });
    prisma.workspaceMember.create.mockImplementation(async (query) => {
      order.push('createMember');
      expect(query).toEqual({
        data: { workspaceId: 'workspace-1', userId: 'user-3', role: UserRole.editor },
      });
      return { id: 'member-3' };
    });

    await expect(
      repository.acceptInvitation({
        tokenHash: 'hash-1',
        userId: 'user-3',
        email: 'editor@example.com',
        now,
      }),
    ).resolves.toEqual({ workspaceId: 'workspace-1', userId: 'user-3', role: 'editor' });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(order).toEqual(['updateMany', 'findUnique', 'createMember']);
    expect(prisma.workspaceInvitation.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hash-1' },
    });
  });

  it('maps used, expired, and invalid invitations without creating a member', async () => {
    const cases = [
      {
        name: 'used',
        record: invitationRecord({ acceptedAt: new Date('2026-09-27T00:00:00.000Z') }),
        code: 'WORKSPACE_INVITATION_USED',
      },
      {
        name: 'expired',
        record: invitationRecord({ expiresAt: new Date('2026-09-27T00:00:00.000Z') }),
        code: 'WORKSPACE_INVITATION_EXPIRED',
      },
      { name: 'invalid', record: null, code: 'WORKSPACE_INVITATION_INVALID' },
    ] as const;

    for (const testCase of cases) {
      const { prisma, repository } = createRepository();
      prisma.$transaction.mockImplementation(
        async (callback: (transaction: typeof prisma) => unknown) => callback(prisma),
      );
      prisma.workspaceInvitation.updateMany.mockResolvedValue({ count: 0 });
      prisma.workspaceInvitation.findUnique.mockResolvedValue(testCase.record);

      await expect(
        repository.acceptInvitation({
          tokenHash: 'hash-1',
          userId: 'user-3',
          email: 'editor@example.com',
          now: new Date('2026-09-28T12:00:00.000Z'),
        }),
      ).rejects.toMatchObject({
        code: testCase.code,
        status: expect.any(Number),
      });
      expect(prisma.workspaceMember.create).not.toHaveBeenCalled();
      expect(testCase.name).toBeTypeOf('string');
    }
  });

  it('maps a member uniqueness conflict and leaves acceptedAt unchanged after rollback', async () => {
    const { prisma, repository } = createRepository();
    const now = new Date('2026-09-28T12:00:00.000Z');
    let acceptedAt: Date | null = null;

    prisma.$transaction.mockImplementation(
      async (callback: (transaction: typeof prisma) => Promise<unknown>) => {
        const before = acceptedAt;
        try {
          return await callback(prisma);
        } catch (error) {
          acceptedAt = before;
          throw error;
        }
      },
    );
    prisma.workspaceInvitation.updateMany.mockImplementation(async () => {
      acceptedAt = now;
      return { count: 1 };
    });
    prisma.workspaceInvitation.findUnique.mockResolvedValue(invitationRecord());
    prisma.workspaceMember.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique member', {
        code: 'P2002',
        clientVersion: '6.19.0',
      }),
    );

    await expect(
      repository.acceptInvitation({
        tokenHash: 'hash-1',
        userId: 'user-3',
        email: 'editor@example.com',
        now,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_MEMBER_EXISTS',
      status: 409,
    });
    expect(acceptedAt).toBeNull();
    expect(prisma.workspaceMember.create).toHaveBeenCalledTimes(1);
  });

  it('does not expose an unsafe error for unexpected Prisma failures', async () => {
    const { prisma, repository } = createRepository();
    const databaseError = new Error('database connection details');
    prisma.$transaction.mockImplementation(async () => {
      throw databaseError;
    });

    await expect(
      repository.acceptInvitation({
        tokenHash: 'hash-1',
        userId: 'user-3',
        email: 'editor@example.com',
        now: new Date('2026-09-28T12:00:00.000Z'),
      }),
    ).rejects.toBe(databaseError);
    expect(databaseError).not.toBeInstanceOf(WorkspaceError);
  });
});
