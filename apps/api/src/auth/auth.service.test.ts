import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { AuthRepository } from './auth.repository.js';
import type {
  AuthUserRecord,
  CreateSessionInput,
  RefreshSessionRecord,
  RegisterRecordInput,
  RegistrationRecord,
  RotateSessionInput,
} from './auth.types.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { AuthTokenService } from './tokens/auth-token.service.js';

class InMemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, AuthUserRecord>();
  readonly sessions = new Map<string, RefreshSessionRecord>();
  readonly revokedFamilies: Array<{ familyId: string; reason: string }> = [];
  forceRotationConflict = false;

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return [...this.users.values()].find((record) => record.user.email === email) ?? null;
  }

  async findUserById(userId: string): Promise<AuthUserRecord | null> {
    return this.users.get(userId) ?? null;
  }

  async register(input: RegisterRecordInput): Promise<RegistrationRecord> {
    if ([...this.users.values()].some((record) => record.user.email === input.email)) {
      const error = new Error('unique');
      Object.assign(error, { code: 'P2002' });
      throw error;
    }

    const user = { id: randomUUID(), email: input.email, displayName: input.displayName } as const;
    const workspace = {
      id: randomUUID(),
      name: input.workspaceName,
      slug: input.workspaceSlug,
    } as const;
    const membership = {
      userId: user.id,
      workspaceId: workspace.id,
      role: 'owner' as const,
      workspace,
    };
    const session = {
      ...input.session,
      userId: user.id,
      workspaceId: workspace.id,
      revokedAt: null,
      replacedById: null,
    };
    this.users.set(user.id, { user, passwordHash: input.passwordHash, memberships: [membership] });
    this.sessions.set(session.id, session);
    return { user, membership, session };
  }

  async createSession(input: CreateSessionInput): Promise<RefreshSessionRecord> {
    const session = { ...input, revokedAt: null, replacedById: null };
    this.sessions.set(session.id, session);
    return session;
  }

  async findRefreshSessionByHash(tokenHash: string): Promise<RefreshSessionRecord | null> {
    return [...this.sessions.values()].find((session) => session.tokenHash === tokenHash) ?? null;
  }

  async findMembership(userId: string, workspaceId: string) {
    return (
      [...this.users.values()]
        .find((record) => record.user.id === userId)
        ?.memberships.find((membership) => membership.workspaceId === workspaceId) ?? null
    );
  }

  async rotateSession(input: RotateSessionInput): Promise<RefreshSessionRecord | null> {
    const current = this.sessions.get(input.currentSessionId);
    if (
      this.forceRotationConflict ||
      current === undefined ||
      current.tokenHash !== input.currentTokenHash ||
      current.revokedAt !== null ||
      current.expiresAt <= input.now
    ) {
      return null;
    }

    const next = { ...input.nextSession, revokedAt: null, replacedById: null };
    this.sessions.set(input.currentSessionId, {
      ...current,
      revokedAt: input.now,
      replacedById: next.id,
    });
    this.sessions.set(next.id, next);
    return next;
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    const current = this.sessions.get(sessionId);
    if (current !== undefined && current.revokedAt === null) {
      this.sessions.set(sessionId, { ...current, revokedAt: new Date(), replacedById: null });
    }
    void reason;
  }

  async revokeSessionFamily(familyId: string, reason: string): Promise<void> {
    this.revokedFamilies.push({ familyId, reason });
    for (const [id, session] of this.sessions) {
      if (session.familyId === familyId && session.revokedAt === null) {
        this.sessions.set(id, { ...session, revokedAt: new Date() });
      }
    }
  }
}

const JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';

function createService(repository = new InMemoryAuthRepository()): {
  service: AuthService;
  repository: InMemoryAuthRepository;
} {
  const passwordHasher = new PasswordHasher();
  const tokenService = new AuthTokenService({ jwtSecret: JWT_SECRET });
  return {
    service: new AuthService(repository, passwordHasher, tokenService),
    repository,
  };
}

describe('AuthService', () => {
  it('registers a user with a default workspace, brand owner membership, and session', async () => {
    const { service, repository } = createService();

    const result = await service.register({
      email: 'Creator@Example.com',
      password: 'strong password 123',
      displayName: '创作者',
    });

    expect(result.user).toEqual({
      id: expect.any(String),
      email: 'creator@example.com',
      displayName: '创作者',
    });
    expect(result.workspace.name).toBe('创作者的工作区');
    expect(result.role).toBe('owner');
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(repository.sessions.size).toBe(1);
    expect(repository.users.values().next().value?.passwordHash).not.toBe('strong password 123');
  });

  it('returns an explicit duplicate-email error during registration', async () => {
    const { service } = createService();
    await service.register({ email: 'creator@example.com', password: 'strong password 123' });

    await expect(
      service.register({ email: 'CREATOR@example.com', password: 'another password 123' }),
    ).rejects.toMatchObject({ code: 'AUTH_EMAIL_ALREADY_REGISTERED', status: 409 });
  });

  it('rejects malformed runtime request bodies with a safe validation error', async () => {
    const { service } = createService();

    await expect(service.login({ email: 123, password: null } as never)).rejects.toMatchObject({
      code: 'AUTH_INVALID_INPUT',
      status: 400,
    });
  });

  it('uses the same generic error for an unknown email and a wrong password', async () => {
    const { service } = createService();
    await service.register({ email: 'creator@example.com', password: 'strong password 123' });

    await expect(
      service.login({
        email: 'unknown@example.com',
        password: 'strong password 123',
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });
    await expect(
      service.login({
        email: 'creator@example.com',
        password: 'wrong password 123',
      }),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      status: 401,
    });
  });

  it('rotates a refresh token and revokes the family when the old token is replayed', async () => {
    const { service, repository } = createService();
    const first = await service.register({
      email: 'creator@example.com',
      password: 'strong password 123',
    });

    const second = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSE_DETECTED',
    });
    expect(repository.revokedFamilies).toEqual([
      { familyId: expect.any(String), reason: 'refresh_reuse_detected' },
    ]);
    await expect(service.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSE_DETECTED',
    });
  });

  it('revokes the family when conditional rotation loses a race', async () => {
    const { service, repository } = createService();
    const first = await service.register({
      email: 'creator@example.com',
      password: 'strong password 123',
    });
    repository.forceRotationConflict = true;

    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSE_DETECTED',
    });
    expect(repository.revokedFamilies[0]?.reason).toBe('refresh_rotation_conflict');
  });

  it('revokes the current refresh session on logout and remains idempotent', async () => {
    const { service, repository } = createService();
    const result = await service.register({
      email: 'creator@example.com',
      password: 'strong password 123',
    });

    await expect(service.logout(result.refreshToken)).resolves.toBeUndefined();
    await expect(service.logout(result.refreshToken)).resolves.toBeUndefined();
    const session = [...repository.sessions.values()][0];
    expect(session?.revokedAt).toBeInstanceOf(Date);
  });
});
