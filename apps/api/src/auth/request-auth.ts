import type { AuthRole, AccessTokenClaims } from './tokens/auth-token.service.js';

export type MembershipContext = Readonly<{
  userId: string;
  workspaceId: string;
  role: AuthRole;
}>;

export type AuthRequestContext = AccessTokenClaims;

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthRequestContext;
    membership?: MembershipContext;
  }
}
