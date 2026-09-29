import { describe, expect, it } from 'vitest';

import { AuthModule } from '../auth/auth.module.js';
import { TenantMembershipGuard } from '../common/tenant-context.js';
import { PrismaModule } from '../database/prisma.module.js';
import { WorkspacesModule } from './workspaces.module.js';

const MODULE_METADATA = {
  IMPORTS: 'imports',
  PROVIDERS: 'providers',
  EXPORTS: 'exports',
} as const;

describe('WorkspacesModule wiring', () => {
  it('imports AuthModule and PrismaModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, WorkspacesModule) as unknown[];

    expect(imports).toContain(AuthModule);
    expect(imports).toContain(PrismaModule);
  });

  it('uses TenantMembershipGuard from AuthModule instead of registering a duplicate provider', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkspacesModule) as unknown[];
    const authExports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule) as unknown[];

    expect(authExports).toContain(TenantMembershipGuard);
    expect(providers).not.toContain(TenantMembershipGuard);
  });
});
