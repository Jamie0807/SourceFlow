import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller.js';
import { AUTH_REPOSITORY } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { PasswordHasher } from './crypto/password-hasher.js';
import { PrismaAuthRepository } from './prisma-auth.repository.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { RoleGuard } from './guards/role.guard.js';
import { AuthTokenService } from './tokens/auth-token.service.js';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordHasher,
    {
      provide: AuthTokenService,
      useFactory: () => new AuthTokenService(),
    },
    PrismaAuthRepository,
    AccessTokenGuard,
    RoleGuard,
    { provide: AUTH_REPOSITORY, useExisting: PrismaAuthRepository },
  ],
  exports: [AuthService, AccessTokenGuard, RoleGuard],
})
export class AuthModule {}
