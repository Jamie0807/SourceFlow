import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import { AuthError } from '../auth.errors.js';
import { AUTH_ROLES_KEY } from '../decorators/roles.decorator.js';
import '../request-auth.js';
import type { AuthRole } from '../tokens/auth-token.service.js';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(AUTH_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles === undefined || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const membership = request.membership;
    if (request.auth === undefined || membership === undefined) {
      throw new AuthError('AUTH_FORBIDDEN');
    }
    if (
      membership.userId !== request.auth.sub ||
      membership.workspaceId !== request.auth.workspaceId
    ) {
      throw new AuthError('AUTH_FORBIDDEN');
    }
    if (!requiredRoles.includes(membership.role)) {
      throw new AuthError('AUTH_FORBIDDEN');
    }
    return true;
  }
}
