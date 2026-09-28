import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { AuthTokenService, type AccessTokenClaims } from './auth-token.service.js';

const JWT_SECRET = 'test-only-secret-that-is-at-least-32-characters';
const ISSUED_AT = new Date('2026-09-28T08:00:00.000Z');

const accessTokenClaims = {
  sub: 'user-1',
  sessionId: 'session-1',
  workspaceId: 'workspace-1',
  role: 'owner',
} satisfies AccessTokenClaims;

describe('AuthTokenService access tokens', () => {
  it('signs and verifies all required access-token claims', async () => {
    const tokenService = createTokenService();

    const token = await tokenService.signAccessToken(accessTokenClaims);

    await expect(tokenService.verifyAccessToken(token)).resolves.toEqual(accessTokenClaims);
  });

  it('rejects an expired access token', async () => {
    let now = ISSUED_AT;
    const tokenService = createTokenService({
      accessTokenTtlSeconds: 1,
      now: () => now,
    });
    const token = await tokenService.signAccessToken(accessTokenClaims);
    now = new Date(ISSUED_AT.getTime() + 2_000);

    await expect(tokenService.verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects an access token with a tampered signature', async () => {
    const tokenService = createTokenService();
    const token = await tokenService.signAccessToken(accessTokenClaims);
    const segments = token.split('.');
    const signature = segments[2];

    expect(segments).toHaveLength(3);
    expect(signature).toBeDefined();

    const firstCharacter = signature?.at(0);
    const tamperedSignature = `${firstCharacter === 'A' ? 'B' : 'A'}${signature?.slice(1)}`;
    const tamperedToken = `${segments[0]}.${segments[1]}.${tamperedSignature}`;

    await expect(tokenService.verifyAccessToken(tamperedToken)).rejects.toThrow();
  });

  it.each(['sub', 'sessionId', 'workspaceId', 'role'] as const)(
    'rejects a signed token missing the %s claim',
    async (missingClaim) => {
      const tokenService = createTokenService();
      const incompleteClaims: Record<string, string> = { ...accessTokenClaims };
      delete incompleteClaims[missingClaim];
      const token = await signRawToken(incompleteClaims);

      await expect(tokenService.verifyAccessToken(token)).rejects.toThrow();
    },
  );

  it('rejects an unsupported role claim', async () => {
    const tokenService = createTokenService();
    const token = await signRawToken({ ...accessTokenClaims, role: 'administrator' });

    await expect(tokenService.verifyAccessToken(token)).rejects.toThrow();
  });

  it('fails securely when AUTH_JWT_SECRET is empty', () => {
    expect(() => new AuthTokenService({ jwtSecret: '' })).toThrow('AUTH_JWT_SECRET');
    expect(() => new AuthTokenService({ jwtSecret: 'too-short' })).toThrow('32 bytes');
  });
});

describe('AuthTokenService refresh tokens', () => {
  it('generates cryptographically random refresh tokens', () => {
    const tokenService = createTokenService();

    const firstToken = tokenService.issueRefreshToken();
    const secondToken = tokenService.issueRefreshToken();

    expect(firstToken.token).not.toBe(secondToken.token);
    expect(Buffer.from(firstToken.token, 'base64url')).toHaveLength(32);
    expect(Buffer.from(secondToken.token, 'base64url')).toHaveLength(32);
  });

  it('creates a stable SHA-256 digest without retaining the plaintext token', () => {
    const tokenService = createTokenService();
    const refreshToken = tokenService.issueRefreshToken();

    expect(tokenService.hashRefreshToken(refreshToken.token)).toBe(refreshToken.tokenHash);
    expect(refreshToken.tokenHash).not.toBe(refreshToken.token);
    expect(refreshToken.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('defaults refresh-token expiry to 2592000 seconds', () => {
    const tokenService = createTokenService();

    const refreshToken = tokenService.issueRefreshToken();

    expect(refreshToken.expiresAt).toEqual(new Date(ISSUED_AT.getTime() + 2_592_000 * 1_000));
  });
});

function createTokenService(
  overrides: Partial<ConstructorParameters<typeof AuthTokenService>[0]> = {},
): AuthTokenService {
  return new AuthTokenService({
    jwtSecret: JWT_SECRET,
    now: () => ISSUED_AT,
    ...overrides,
  });
}

async function signRawToken(claims: Record<string, string>): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(ISSUED_AT.getTime() / 1_000))
    .setExpirationTime(Math.floor(ISSUED_AT.getTime() / 1_000) + 900)
    .setIssuer('sourceflow-api')
    .setAudience('sourceflow-web')
    .sign(secret);
}
