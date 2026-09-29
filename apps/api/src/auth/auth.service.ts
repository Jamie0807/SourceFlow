import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuthError } from './auth.errors.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
  type SwitchWorkspaceInput,
} from './auth.repository.js';
import type { AuthUser, AuthWorkspace, CreateSessionInput } from './auth.types.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { AuthTokenService, type AuthRole } from './tokens/auth-token.service.js';

export type CredentialsInput = Readonly<{
  email: string;
  password: string;
  displayName?: string;
}>;

export type AuthResult = Readonly<{
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  workspace: AuthWorkspace;
  role: AuthRole;
}>;

export type ActiveWorkspaceResult = Readonly<{
  accessToken: string;
  user: AuthUser;
  workspace: AuthWorkspace;
  role: AuthRole;
}>;

@Injectable()
export class AuthService {
  constructor(
    @Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenService: AuthTokenService,
  ) {}

  async register(input: CredentialsInput): Promise<AuthResult> {
    const credentials = parseCredentials(input);
    const email = normalizeEmail(credentials.email);
    validateCredentials(email, credentials.password);

    if (await this.repository.findUserByEmail(email)) {
      throw new AuthError('AUTH_EMAIL_ALREADY_REGISTERED');
    }

    const passwordHash = await this.passwordHasher.hash(credentials.password);
    const refresh = this.tokenService.issueRefreshToken();
    const session = createSessionInput({
      userId: '',
      workspaceId: '',
      tokenHash: refresh.tokenHash,
      expiresAt: refresh.expiresAt,
      familyId: randomUUID(),
    });
    const displayName = normalizeDisplayName(credentials.displayName);
    const workspaceName = `${displayName ?? email.split('@')[0]}的工作区`;

    try {
      const registration = await this.repository.register({
        email,
        passwordHash,
        displayName,
        workspaceName,
        workspaceSlug: `${slugify(email)}-${randomUUID().slice(0, 8)}`,
        session,
      });

      const accessToken = await this.tokenService.signAccessToken({
        sub: registration.user.id,
        sessionId: registration.session.id,
        workspaceId: registration.membership.workspaceId,
        role: registration.membership.role,
      });

      return {
        accessToken,
        refreshToken: refresh.token,
        user: registration.user,
        workspace: registration.membership.workspace,
        role: registration.membership.role,
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AuthError('AUTH_EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }
  }

  async login(input: CredentialsInput): Promise<AuthResult> {
    const credentials = parseCredentials(input);
    const email = normalizeEmail(credentials.email);
    validateCredentials(email, credentials.password);
    const record = await this.repository.findUserByEmail(email);

    if (record === null || record.passwordHash === null) {
      await this.passwordHasher.hash('sourceflow-dummy-password');
      throw new AuthError('AUTH_INVALID_CREDENTIALS');
    }

    const passwordMatches = await this.passwordHasher.verify(
      credentials.password,
      record.passwordHash,
    );
    const membership = record.memberships[0];
    if (!passwordMatches || membership === undefined) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS');
    }

    const refresh = this.tokenService.issueRefreshToken();
    const session = await this.repository.createSession(
      createSessionInput({
        userId: record.user.id,
        workspaceId: membership.workspaceId,
        tokenHash: refresh.tokenHash,
        expiresAt: refresh.expiresAt,
        familyId: randomUUID(),
      }),
    );
    const accessToken = await this.tokenService.signAccessToken({
      sub: record.user.id,
      sessionId: session.id,
      workspaceId: membership.workspaceId,
      role: membership.role,
    });

    return {
      accessToken,
      refreshToken: refresh.token,
      user: record.user,
      workspace: membership.workspace,
      role: membership.role,
    };
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    if (refreshToken.trim().length === 0) {
      throw new AuthError('AUTH_UNAUTHORIZED');
    }

    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    const current = await this.repository.findRefreshSessionByHash(tokenHash);
    if (current === null) {
      throw new AuthError('AUTH_UNAUTHORIZED');
    }

    if (current.revokedAt !== null) {
      await this.repository.revokeSessionFamily(current.familyId, 'refresh_reuse_detected');
      throw new AuthError('AUTH_REFRESH_REUSE_DETECTED');
    }

    const now = new Date();
    if (current.expiresAt <= now) {
      await this.repository.revokeSession(current.id, 'refresh_expired');
      throw new AuthError('AUTH_REFRESH_EXPIRED');
    }

    const membership = await this.repository.findMembership(current.userId, current.workspaceId);
    if (membership === null) {
      await this.repository.revokeSessionFamily(current.familyId, 'membership_missing');
      throw new AuthError('AUTH_UNAUTHORIZED');
    }

    const userRecord = await this.repository.findUserById(current.userId);
    if (userRecord === null) {
      await this.repository.revokeSessionFamily(current.familyId, 'user_missing');
      throw new AuthError('AUTH_UNAUTHORIZED');
    }

    const nextRefresh = this.tokenService.issueRefreshToken();
    const nextSession = await this.repository.rotateSession({
      currentSessionId: current.id,
      currentTokenHash: tokenHash,
      now,
      nextSession: createSessionInput({
        userId: current.userId,
        workspaceId: current.workspaceId,
        tokenHash: nextRefresh.tokenHash,
        expiresAt: nextRefresh.expiresAt,
        familyId: current.familyId,
      }),
    });
    if (nextSession === null) {
      await this.repository.revokeSessionFamily(current.familyId, 'refresh_rotation_conflict');
      throw new AuthError('AUTH_REFRESH_REUSE_DETECTED');
    }

    const accessToken = await this.tokenService.signAccessToken({
      sub: current.userId,
      sessionId: nextSession.id,
      workspaceId: current.workspaceId,
      role: membership.role,
    });

    return {
      accessToken,
      refreshToken: nextRefresh.token,
      user: userRecord.user,
      workspace: membership.workspace,
      role: membership.role,
    };
  }

  async switchWorkspace(input: Omit<SwitchWorkspaceInput, 'now'>): Promise<ActiveWorkspaceResult> {
    const membership = await this.repository.findMembership(input.userId, input.workspaceId);
    if (membership === null) {
      throw new AuthError('AUTH_FORBIDDEN');
    }

    const session = await this.repository.switchSessionWorkspace({
      ...input,
      now: new Date(),
    });
    if (session === null) {
      throw new AuthError('AUTH_UNAUTHORIZED');
    }

    const userRecord = await this.repository.findUserById(input.userId);
    if (userRecord === null) {
      throw new AuthError('AUTH_UNAUTHORIZED');
    }

    const accessToken = await this.tokenService.signAccessToken({
      sub: userRecord.user.id,
      sessionId: session.id,
      workspaceId: membership.workspaceId,
      role: membership.role,
    });

    return {
      accessToken,
      user: userRecord.user,
      workspace: membership.workspace,
      role: membership.role,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken === undefined || refreshToken.trim().length === 0) return;

    const session = await this.repository.findRefreshSessionByHash(
      this.tokenService.hashRefreshToken(refreshToken),
    );
    if (session !== null && session.revokedAt === null) {
      await this.repository.revokeSession(session.id, 'logout');
    }
  }
}

function createSessionInput(input: Omit<CreateSessionInput, 'id'>): CreateSessionInput {
  return { id: randomUUID(), ...input };
}

function parseCredentials(input: unknown): CredentialsInput {
  if (typeof input !== 'object' || input === null) {
    throw new AuthError('AUTH_INVALID_INPUT');
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.email !== 'string' || typeof candidate.password !== 'string') {
    throw new AuthError('AUTH_INVALID_INPUT');
  }
  const credentials: { email: string; password: string; displayName?: string } = {
    email: candidate.email,
    password: candidate.password,
  };
  if (typeof candidate.displayName === 'string') credentials.displayName = candidate.displayName;
  return credentials;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string | undefined): string | null {
  const normalized = displayName?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized.slice(0, 80);
}

function validateCredentials(email: string, password: string): void {
  if (
    !/^\S+@\S+\.\S+$/u.test(email) ||
    email.length > 254 ||
    password.length < 8 ||
    password.length > 128
  ) {
    throw new AuthError('AUTH_INVALID_INPUT');
  }
}

function slugify(value: string): string {
  const slug = value
    .split('@')[0]
    ?.replace(/[^a-z0-9]+/giu, '-')
    .replace(/^-|-$/gu, '')
    .toLowerCase();
  return slug === undefined || slug.length === 0 ? 'workspace' : slug;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
