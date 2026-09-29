import type { WorkspaceInvitationRecord, WorkspaceOverview } from './workspaces.types.js';
import type { AuthRole } from '../auth/tokens/auth-token.service.js';

export const WORKSPACES_REPOSITORY = Symbol('WORKSPACES_REPOSITORY');

export interface WorkspaceRepository {
  findOverview(userId: string, workspaceId: string): Promise<WorkspaceOverview | null>;
  findMemberByEmail(workspaceId: string, email: string): Promise<{ userId: string } | null>;
  findActiveInvitation(
    workspaceId: string,
    email: string,
    now: Date,
  ): Promise<WorkspaceInvitationRecord | null>;
  createInvitation(input: {
    workspaceId: string;
    email: string;
    role: AuthRole;
    tokenHash: string;
    expiresAt: Date;
    invitedById: string;
    now: Date;
  }): Promise<WorkspaceInvitationRecord>;
  findInvitationByTokenHash(tokenHash: string): Promise<WorkspaceInvitationRecord | null>;
  acceptInvitation(input: {
    tokenHash: string;
    userId: string;
    email: string;
    now: Date;
  }): Promise<{ workspaceId: string; userId: string; role: AuthRole }>;
}
