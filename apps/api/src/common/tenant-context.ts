import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AUTH_REPOSITORY, type AuthRepository } from '../auth/auth.repository.js';
import { AuthError, WorkspaceError } from '../auth/auth.errors.js';
import type { AuthRole } from '../auth/tokens/auth-token.service.js';
import '../auth/request-auth.js';

export type TenantContext = Readonly<{
  userId: string;
  workspaceId: string;
  role: AuthRole;
}>;

@Injectable()
export class TenantMembershipGuard implements CanActivate {
  constructor(@Inject(AUTH_REPOSITORY) private readonly repository: AuthRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const auth = request.auth;
    if (auth === undefined) throw new AuthError('AUTH_UNAUTHORIZED');

    const membership = await this.repository.findMembership(auth.sub, auth.workspaceId);
    if (
      membership === null ||
      membership.userId !== auth.sub ||
      membership.workspaceId !== auth.workspaceId
    ) {
      throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
    }

    request.membership = {
      userId: membership.userId,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
    return true;
  }
}
