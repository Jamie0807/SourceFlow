import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AuthError } from './auth.errors.js';
import type { AuthResult, CredentialsInput } from './auth.service.js';
import { AuthService } from './auth.service.js';

export const REFRESH_COOKIE_NAME = 'sourceflow_refresh_token';
const REFRESH_COOKIE_PATH = '/auth';
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: CredentialsInput, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.complete(await this.authService.register(body), reply);
  }

  @Post('login')
  async login(@Body() body: CredentialsInput, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.complete(await this.authService.login(body), reply);
  }

  @Post('refresh')
  async refresh(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    assertTrustedOrigin(request);
    return this.complete(
      await this.authService.refresh(request.cookies?.[REFRESH_COOKIE_NAME] ?? ''),
      reply,
    );
  }

  @Post('logout')
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ success: true }> {
    assertTrustedOrigin(request);
    await this.authService.logout(request.cookies?.[REFRESH_COOKIE_NAME]);
    reply.header('cache-control', 'no-store');
    reply.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
    return { success: true };
  }

  private complete(result: AuthResult, reply: FastifyReply) {
    reply.header('cache-control', 'no-store');
    reply.setCookie(REFRESH_COOKIE_NAME, result.refreshToken, this.cookieOptions());
    const { refreshToken: _refreshToken, ...safeResult } = result;
    void _refreshToken;
    return safeResult;
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: REFRESH_COOKIE_PATH,
      maxAge: readRefreshTokenTtlSeconds(),
    };
  }
}

function readRefreshTokenTtlSeconds(): number {
  const configured = process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS;
  if (configured !== undefined && /^\d+$/u.test(configured)) {
    const value = Number(configured);
    if (Number.isSafeInteger(value) && value > 0) return value;
  }
  return DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
}

function assertTrustedOrigin(request: FastifyRequest): void {
  const origin = request.headers?.origin;
  if (origin === undefined) return;

  const configuredOrigins = (
    process.env.AUTH_ALLOWED_ORIGINS ??
    (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173,http://localhost:3000')
  )
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (!configuredOrigins.includes(origin)) {
    throw new AuthError('AUTH_UNAUTHORIZED');
  }
}
