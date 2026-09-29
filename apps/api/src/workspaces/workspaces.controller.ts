import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AuthError } from '../auth/auth.errors.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RoleGuard } from '../auth/guards/role.guard.js';
import '../auth/request-auth.js';
import { TenantMembershipGuard, type TenantContext } from '../common/tenant-context.js';
import { WorkspacesService } from './workspaces.service.js';

type InvitationParams = Readonly<{ token: string }>;
type WorkspaceParams = Readonly<{ workspaceId: string }>;

@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get('current')
  @UseGuards(AccessTokenGuard, TenantMembershipGuard)
  getCurrent(@Req() request: FastifyRequest) {
    return this.workspacesService.getCurrent(requireMembership(request));
  }

  @Post('current/members/invitations')
  @UseGuards(AccessTokenGuard, TenantMembershipGuard, RoleGuard)
  @Roles('owner')
  createInvitation(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.workspacesService.createInvitation(requireMembership(request), body);
  }

  @Post('invitations/:token/accept')
  @UseGuards(AccessTokenGuard)
  acceptInvitation(@Req() request: FastifyRequest, @Param() params: InvitationParams) {
    return this.workspacesService.acceptInvitation({
      userId: requireAuth(request).sub,
      token: params.token,
    });
  }

  @Post(':workspaceId/activate')
  @UseGuards(AccessTokenGuard)
  activateWorkspace(@Req() request: FastifyRequest, @Param() params: WorkspaceParams) {
    const auth = requireAuth(request);
    return this.workspacesService.activateWorkspace({
      userId: auth.sub,
      sessionId: auth.sessionId,
      workspaceId: params.workspaceId,
    });
  }
}

function requireAuth(request: FastifyRequest) {
  if (request.auth === undefined) throw new AuthError('AUTH_UNAUTHORIZED');
  return request.auth;
}

function requireMembership(request: FastifyRequest): TenantContext {
  if (request.membership === undefined) throw new AuthError('AUTH_UNAUTHORIZED');
  return request.membership;
}
