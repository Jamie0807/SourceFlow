import { createHash, randomBytes } from 'node:crypto';

const INVITATION_TOKEN_BYTES = 32;
const DEFAULT_WEB_APP_ORIGIN = 'http://localhost:5173';

export function createInvitationToken(): string {
  return randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function buildInvitationUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const origin = (env.WEB_APP_ORIGIN ?? DEFAULT_WEB_APP_ORIGIN).replace(/\/+$/u, '');
  return `${origin}/invitations/${encodeURIComponent(token)}`;
}
