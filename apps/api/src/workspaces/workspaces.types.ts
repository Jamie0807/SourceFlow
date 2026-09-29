import type { AuthWorkspace } from '../auth/auth.types.js';
import type { AuthRole } from '../auth/tokens/auth-token.service.js';

export type WorkspaceOverview = Readonly<{
  workspace: AuthWorkspace;
  role: AuthRole;
  defaultBrand: Readonly<{ id: string; name: string }> | null;
  members: readonly Readonly<{
    userId: string;
    email: string;
    displayName: string | null;
    role: AuthRole;
  }>[];
}>;

export type WorkspaceInvitationRecord = Readonly<{
  id: string;
  workspaceId: string;
  email: string;
  role: AuthRole;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}>;
