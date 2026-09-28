import type { AuthRole } from './tokens/auth-token.service.js';

export type AuthUser = Readonly<{
  id: string;
  email: string;
  displayName: string | null;
}>;

export type AuthWorkspace = Readonly<{
  id: string;
  name: string;
  slug: string;
}>;

export type MembershipRecord = Readonly<{
  userId: string;
  workspaceId: string;
  role: AuthRole;
  workspace: AuthWorkspace;
}>;

export type AuthUserRecord = Readonly<{
  user: AuthUser;
  passwordHash: string | null;
  memberships: readonly MembershipRecord[];
}>;

export type RefreshSessionRecord = Readonly<{
  id: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}>;

export type RegistrationRecord = Readonly<{
  user: AuthUser;
  membership: MembershipRecord;
  session: RefreshSessionRecord;
}>;

export type CreateSessionInput = Readonly<{
  id: string;
  userId: string;
  workspaceId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}>;

export type RegisterRecordInput = Readonly<{
  email: string;
  passwordHash: string;
  displayName: string | null;
  workspaceName: string;
  workspaceSlug: string;
  session: CreateSessionInput;
}>;

export type RotateSessionInput = Readonly<{
  currentSessionId: string;
  currentTokenHash: string;
  now: Date;
  nextSession: CreateSessionInput;
}>;
