import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import { jwtVerify, SignJWT } from 'jose';

const ACCESS_TOKEN_TTL_SECONDS = 900;
const REFRESH_TOKEN_TTL_SECONDS = 2_592_000;
const REFRESH_TOKEN_LENGTH_BYTES = 32;
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'sourceflow-api';
const JWT_AUDIENCE = 'sourceflow-web';

export const AUTH_ROLES = ['owner', 'editor', 'reviewer'] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export type AccessTokenClaims = Readonly<{
  sub: string;
  sessionId: string;
  workspaceId: string;
  role: AuthRole;
}>;

export type RefreshToken = Readonly<{
  token: string;
  tokenHash: string;
  expiresAt: Date;
}>;

export type AuthTokenServiceOptions = Readonly<{
  jwtSecret?: string;
  accessTokenTtlSeconds?: number;
  refreshTokenTtlSeconds?: number;
  now?: () => Date;
}>;

@Injectable()
export class AuthTokenService {
  readonly #secret: Uint8Array;
  readonly #accessTokenTtlSeconds: number;
  readonly #refreshTokenTtlSeconds: number;
  readonly #now: () => Date;

  constructor(options: AuthTokenServiceOptions = {}) {
    const jwtSecret = options.jwtSecret ?? process.env.AUTH_JWT_SECRET;
    if (jwtSecret === undefined || new TextEncoder().encode(jwtSecret).length < 32) {
      throw new Error('AUTH_JWT_SECRET must contain at least 32 bytes');
    }

    this.#secret = new TextEncoder().encode(jwtSecret);
    this.#accessTokenTtlSeconds = readPositiveInteger(
      options.accessTokenTtlSeconds,
      process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      ACCESS_TOKEN_TTL_SECONDS,
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
    );
    this.#refreshTokenTtlSeconds = readPositiveInteger(
      options.refreshTokenTtlSeconds,
      process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
      REFRESH_TOKEN_TTL_SECONDS,
      'AUTH_REFRESH_TOKEN_TTL_SECONDS',
    );
    this.#now = options.now ?? (() => new Date());
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    const issuedAt = Math.floor(this.#now().getTime() / 1_000);

    return new SignJWT({
      sessionId: claims.sessionId,
      workspaceId: claims.workspaceId,
      role: claims.role,
    })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.#accessTokenTtlSeconds)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .sign(this.#secret);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const { payload } = await jwtVerify(token, this.#secret, {
      algorithms: [JWT_ALGORITHM],
      currentDate: this.#now(),
      requiredClaims: ['sub', 'iat', 'exp', 'sessionId', 'workspaceId', 'role'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    if (
      !isNonEmptyString(payload.sub) ||
      !isNonEmptyString(payload.sessionId) ||
      !isNonEmptyString(payload.workspaceId) ||
      !isAuthRole(payload.role)
    ) {
      throw new Error('Access token contains invalid claims');
    }

    return {
      sub: payload.sub,
      sessionId: payload.sessionId,
      workspaceId: payload.workspaceId,
      role: payload.role,
    };
  }

  issueRefreshToken(): RefreshToken {
    const token = randomBytes(REFRESH_TOKEN_LENGTH_BYTES).toString('base64url');

    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt: new Date(this.#now().getTime() + this.#refreshTokenTtlSeconds * 1_000),
    };
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === 'string' && AUTH_ROLES.some((role) => role === value);
}

function readPositiveInteger(
  configuredValue: number | undefined,
  environmentValue: string | undefined,
  defaultValue: number,
  configurationName: string,
): number {
  const value = configuredValue ?? parseEnvironmentInteger(environmentValue) ?? defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${configurationName} must be a positive integer`);
  }

  return value;
}

function parseEnvironmentInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/u.test(value)) {
    return value === undefined ? undefined : Number.NaN;
  }

  return Number(value);
}
