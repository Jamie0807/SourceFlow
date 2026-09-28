import { SetMetadata } from '@nestjs/common';

import type { AuthRole } from '../tokens/auth-token.service.js';

export const AUTH_ROLES_KEY = 'sourceflow:auth-roles';

export const Roles = (...roles: AuthRole[]) => SetMetadata(AUTH_ROLES_KEY, roles);
