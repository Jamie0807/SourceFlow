import { Inject, Injectable } from '@nestjs/common';

import { AuthError, WorkspaceError } from '../auth/auth.errors.js';
import { AUTH_REPOSITORY, type AuthRepository } from '../auth/auth.repository.js';
import { AuthService, type ActiveWorkspaceResult } from '../auth/auth.service.js';
import type { AuthRole } from '../auth/tokens/auth-token.service.js';
import type { TenantContext } from '../common/tenant-context.js';
import {
  buildInvitationUrl,
  createInvitationToken,
  hashInvitationToken,
} from './workspace-invitation-token.js';
import { WORKSPACES_REPOSITORY, type WorkspaceRepository } from './workspaces.repository.js';
import type { WorkspaceOverview } from './workspaces.types.js';

const DEFAULT_INVITATION_TTL_SECONDS = 604_800;

export type CreateInvitationResult = Readonly<{
  id: string;
  email: string;
  role: Exclude<AuthRole, 'owner'>;
  expiresAt: Date;
  inviteUrl: string;
}>;

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(WORKSPACES_REPOSITORY) private readonly workspaceRepository: WorkspaceRepository,
    @Inject(AUTH_REPOSITORY) private readonly authRepository: AuthRepository,
    private readonly authService: AuthService,
  ) {}

  async getCurrent(context: TenantContext): Promise<WorkspaceOverview> {
    const overview = await this.workspaceRepository.findOverview(
      context.userId,
      context.workspaceId,
    );
    if (overview === null) throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    return overview;
  }

  async createInvitation(context: TenantContext, input: unknown): Promise<CreateInvitationResult> {
    if (context.role !== 'owner') throw new AuthError('AUTH_FORBIDDEN');

    const invitationInput = parseInvitationInput(input);
    const member = await this.workspaceRepository.findMemberByEmail(
      context.workspaceId,
      invitationInput.email,
    );
    if (member !== null) throw new WorkspaceError('WORKSPACE_MEMBER_EXISTS');

    const now = new Date();
    const activeInvitation = await this.workspaceRepository.findActiveInvitation(
      context.workspaceId,
      invitationInput.email,
      now,
    );
    if (activeInvitation !== null) throw new WorkspaceError('WORKSPACE_INVITATION_EXISTS');

    const token = createInvitationToken();
    const expiresAt = new Date(now.getTime() + readInvitationTtlSeconds() * 1_000);

    try {
      const invitation = await this.workspaceRepository.createInvitation({
        workspaceId: context.workspaceId,
        email: invitationInput.email,
        role: invitationInput.role,
        tokenHash: hashInvitationToken(token),
        expiresAt,
        invitedById: context.userId,
        now,
      });

      return {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role as Exclude<AuthRole, 'owner'>,
        expiresAt: invitation.expiresAt,
        inviteUrl: buildInvitationUrl(token),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new WorkspaceError('WORKSPACE_INVITATION_EXISTS');
      }
      throw error;
    }
  }

  async acceptInvitation(input: { userId: string; token: string }): Promise<{
    workspaceId: string;
    role: AuthRole;
  }> {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof input.userId !== 'string' ||
      input.userId.trim().length === 0 ||
      typeof input.token !== 'string' ||
      input.token.trim().length === 0
    ) {
      throw new AuthError('AUTH_INVALID_INPUT');
    }

    const userRecord = await this.authRepository.findUserById(input.userId);
    if (userRecord === null) throw new AuthError('AUTH_UNAUTHORIZED');

    const accepted = await this.workspaceRepository.acceptInvitation({
      tokenHash: hashInvitationToken(input.token),
      userId: input.userId,
      email: normalizeEmail(userRecord.user.email),
      now: new Date(),
    });

    return {
      workspaceId: accepted.workspaceId,
      role: accepted.role,
    };
  }

  activateWorkspace(input: {
    userId: string;
    sessionId: string;
    workspaceId: string;
  }): Promise<ActiveWorkspaceResult> {
    return this.authService.switchWorkspace(input);
  }
}

function parseInvitationInput(input: unknown): {
  email: string;
  role: Exclude<AuthRole, 'owner'>;
} {
  if (typeof input !== 'object' || input === null) {
    throw new AuthError('AUTH_INVALID_INPUT');
  }

  const candidate = input as Record<string, unknown>;
  if (candidate.role !== 'editor' && candidate.role !== 'reviewer') {
    throw new WorkspaceError('WORKSPACE_INVALID_ROLE');
  }
  if (typeof candidate.email !== 'string') {
    throw new AuthError('AUTH_INVALID_INPUT');
  }

  const email = normalizeEmail(candidate.email);
  if (!/^\S+@\S+\.\S+$/u.test(email) || email.length > 254) {
    throw new AuthError('AUTH_INVALID_INPUT');
  }

  return { email, role: candidate.role };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readInvitationTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const configured = env.WORKSPACE_INVITATION_TTL_SECONDS;
  if (configured !== undefined && /^\d+$/u.test(configured)) {
    const value = Number(configured);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return DEFAULT_INVITATION_TTL_SECONDS;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
