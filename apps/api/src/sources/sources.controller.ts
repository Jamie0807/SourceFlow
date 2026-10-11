import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AuthError } from '../auth/auth.errors.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { RoleGuard } from '../auth/guards/role.guard.js';
import { TenantMembershipGuard, type TenantContext } from '../common/tenant-context.js';
import '../auth/request-auth.js';
import { SourcesService } from './sources.service.js';

type SourceParams = Readonly<{ sourceId: string }>;

@Controller('sources')
export class SourcesController {
  constructor(private readonly sourcesService: SourcesService) {}

  @Post()
  @UseGuards(AccessTokenGuard, TenantMembershipGuard, RoleGuard)
  @Roles('owner', 'editor')
  create(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.sourcesService.create(requireMembership(request), body);
  }

  @Get(':sourceId')
  @UseGuards(AccessTokenGuard, TenantMembershipGuard)
  get(@Req() request: FastifyRequest, @Param() params: SourceParams) {
    return this.sourcesService.get(requireMembership(request), params.sourceId);
  }

  @Post(':sourceId/upload-complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AccessTokenGuard, TenantMembershipGuard, RoleGuard)
  @Roles('owner', 'editor')
  completeUpload(@Req() request: FastifyRequest, @Param() params: SourceParams) {
    return this.sourcesService.completeUpload(requireMembership(request), params.sourceId);
  }

  @Post(':sourceId/process')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AccessTokenGuard, TenantMembershipGuard, RoleGuard)
  @Roles('owner', 'editor')
  process(@Req() request: FastifyRequest, @Param() params: SourceParams) {
    return this.sourcesService.process(requireMembership(request), params.sourceId);
  }

  @Post(':sourceId/cancel')
  @UseGuards(AccessTokenGuard, TenantMembershipGuard, RoleGuard)
  @Roles('owner', 'editor')
  cancel(@Req() request: FastifyRequest, @Param() params: SourceParams) {
    return this.sourcesService.cancel(requireMembership(request), params.sourceId);
  }
}

function requireMembership(request: FastifyRequest): TenantContext {
  const membership = request.membership;
  if (membership === undefined) throw new AuthError('AUTH_UNAUTHORIZED');
  return membership;
}
