import type {
  AuthUserRecord,
  CreateSessionInput,
  RefreshSessionRecord,
  RegisterRecordInput,
  RegistrationRecord,
  RotateSessionInput,
} from './auth.types.js';

export const AUTH_REPOSITORY = Symbol('AUTH_REPOSITORY');

export type SwitchWorkspaceInput = Readonly<{
  userId: string;
  sessionId: string;
  workspaceId: string;
  now: Date;
}>;

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRecord | null>;
  findUserById(userId: string): Promise<AuthUserRecord | null>;
  register(input: RegisterRecordInput): Promise<RegistrationRecord>;
  createSession(input: CreateSessionInput): Promise<RefreshSessionRecord>;
  findRefreshSessionByHash(tokenHash: string): Promise<RefreshSessionRecord | null>;
  findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<RegistrationRecord['membership'] | null>;
  switchSessionWorkspace(input: SwitchWorkspaceInput): Promise<RefreshSessionRecord | null>;
  rotateSession(input: RotateSessionInput): Promise<RefreshSessionRecord | null>;
  revokeSession(sessionId: string, reason: string): Promise<void>;
  revokeSessionFamily(familyId: string, reason: string): Promise<void>;
}
