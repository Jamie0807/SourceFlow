import { describe, expect, it } from 'vitest';

import type { AuthResult } from './auth.service.js';
import { AuthController, REFRESH_COOKIE_NAME } from './auth.controller.js';

const result: AuthResult = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  user: { id: 'user-1', email: 'creator@example.com', displayName: '创作者' },
  workspace: { id: 'workspace-1', name: '创作者的工作区', slug: 'creator' },
  role: 'owner',
};

function createReply() {
  const reply = {
    cookies: [] as Array<{ name: string; value: string; options: Record<string, unknown> }>,
    cleared: [] as Array<{ name: string; options: Record<string, unknown> }>,
    headers: {} as Record<string, string>,
    setCookie(name: string, value: string, options: Record<string, unknown>) {
      reply.cookies.push({ name, value, options });
      return reply;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      reply.cleared.push({ name, options });
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name] = value;
      return reply;
    },
  };
  return reply;
}

describe('AuthController', () => {
  it('sets a secure refresh cookie and never includes the refresh token in JSON', async () => {
    const service = { register: async () => result };
    const controller = new AuthController(service as never);
    const reply = createReply();

    const response = await controller.register(
      { email: 'creator@example.com', password: 'password 123' },
      reply as never,
    );

    expect(response).toEqual({
      accessToken: 'access-token',
      user: result.user,
      workspace: result.workspace,
      role: 'owner',
    });
    expect(reply.cookies).toEqual([
      {
        name: REFRESH_COOKIE_NAME,
        value: 'refresh-token',
        options: expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/auth',
          maxAge: 2_592_000,
        }),
      },
    ]);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(response)).not.toContain('refresh-token');
  });

  it('refreshes from the HttpOnly cookie and clears it with the same path on logout', async () => {
    const calls: string[] = [];
    const service = {
      refresh: async (token: string) => {
        calls.push(`refresh:${token}`);
        return result;
      },
      logout: async (token: string | undefined) => {
        calls.push(`logout:${token ?? ''}`);
      },
    };
    const controller = new AuthController(service as never);
    const refreshReply = createReply();
    const logoutReply = createReply();

    await controller.refresh(
      { headers: {}, cookies: { [REFRESH_COOKIE_NAME]: 'cookie-token' } } as never,
      refreshReply as never,
    );
    await controller.logout(
      { headers: {}, cookies: { [REFRESH_COOKIE_NAME]: 'cookie-token' } } as never,
      logoutReply as never,
    );

    expect(calls).toEqual(['refresh:cookie-token', 'logout:cookie-token']);
    expect(logoutReply.cleared[0]).toEqual({
      name: REFRESH_COOKIE_NAME,
      options: expect.objectContaining({ path: '/auth' }),
    });
  });

  it('rejects a refresh request from an untrusted browser origin', async () => {
    const previousOrigins = process.env.AUTH_ALLOWED_ORIGINS;
    process.env.AUTH_ALLOWED_ORIGINS = 'https://app.sourceflow.test';
    const service = { refresh: async () => result };
    const controller = new AuthController(service as never);

    try {
      await expect(
        controller.refresh(
          {
            headers: { origin: 'https://evil.example' },
            cookies: { [REFRESH_COOKIE_NAME]: 'token' },
          } as never,
          createReply() as never,
        ),
      ).rejects.toMatchObject({ code: 'AUTH_UNAUTHORIZED' });
    } finally {
      if (previousOrigins === undefined) delete process.env.AUTH_ALLOWED_ORIGINS;
      else process.env.AUTH_ALLOWED_ORIGINS = previousOrigins;
    }
  });
});
