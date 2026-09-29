import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { PrismaWorkspacesRepository } from './prisma-workspaces.repository.js';
import { WORKSPACES_REPOSITORY } from './workspaces.repository.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WorkspacesController],
  providers: [
    PrismaWorkspacesRepository,
    WorkspacesService,
    { provide: WORKSPACES_REPOSITORY, useExisting: PrismaWorkspacesRepository },
  ],
})
export class WorkspacesModule {}
