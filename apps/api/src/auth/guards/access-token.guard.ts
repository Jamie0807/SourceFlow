import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AuthError } from '../auth.errors.js';
import { AuthTokenService } from '../tokens/auth-token.service.js';
import '../request-auth.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly tokenService: AuthTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (token.length === 0) throw new AuthError('AUTH_UNAUTHORIZED');

    try {
      request.auth = await this.tokenService.verifyAccessToken(token);
      return true;
    } catch {
      throw new AuthError('AUTH_UNAUTHORIZED');
    }
  }
}
