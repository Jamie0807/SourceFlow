import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertMigrationPreflight } from './migration-preflight.js';
import { assertDatabaseConfigured } from './prisma.service.js';

const worktreeRoot = resolve(import.meta.dirname, '../../../..');
const schemaPath = resolve(worktreeRoot, 'prisma/schema.prisma');
const refreshSessionMigrationPath = resolve(
  worktreeRoot,
  'prisma/migrations/20260928_add_refresh_sessions/migration.sql',
);
const workspaceInvitationMigrationPath = resolve(
  worktreeRoot,
  'prisma/migrations/20260928_add_workspace_invitations/migration.sql',
);
const seedPath = resolve(worktreeRoot, 'prisma/seed.ts');
const readinessPath = resolve(import.meta.dirname, './database-health.ts');

const tenantBusinessModels = [
  'WorkspaceInvitation',
  'WorkspaceMember',
  'Brand',
  'Source',
  'TranscriptSegment',
  'ContentInsight',
  'ContentBatch',
  'Asset',
  'AssetVersion',
  'ReviewAction',
  'ExportJob',
  'TaskRun',
] as const;

const requiredModels = ['User', 'Workspace', ...tenantBusinessModels, 'RefreshSession'] as const;

function readModel(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  return match?.[1] ?? '';
}

describe('Prisma database contract', () => {
  it('defines the required business and authentication infrastructure models', () => {
    expect(existsSync(schemaPath)).toBe(true);
    if (!existsSync(schemaPath)) return;

    const schema = readFileSync(schemaPath, 'utf8');
    const modelNames = [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]);

    expect(modelNames).toEqual(expect.arrayContaining([...requiredModels]));

    for (const modelName of requiredModels) {
      const model = readModel(schema, modelName);
      expect(model, `${modelName} should have an id`).toMatch(/\bid\s+String\s+@id/);
      expect(model, `${modelName} should have createdAt`).toMatch(/\bcreatedAt\s+DateTime/);
      expect(model, `${modelName} should have updatedAt`).toMatch(/\bupdatedAt\s+DateTime/);
    }

    for (const modelName of tenantBusinessModels) {
      const model = readModel(schema, modelName);
      expect(model, `${modelName} should be tenant-owned`).toMatch(/\bworkspaceId\s+String/);
      expect(model, `${modelName} should index workspaceId`).toMatch(/@@index\(\[workspaceId\]/);
    }

    const refreshSession = readModel(schema, 'RefreshSession');
    expect(refreshSession).toMatch(/\buserId\s+String/);
    expect(refreshSession).toMatch(/\bworkspaceId\s+String/);
    expect(refreshSession).toMatch(/\btokenHash\s+String\s+@unique/);
    expect(refreshSession).toMatch(/\bexpiresAt\s+DateTime/);
    expect(refreshSession).toMatch(/\brevokedAt\s+DateTime\?/);
    expect(refreshSession).toMatch(/\breplacedById\s+String\?/);
    expect(refreshSession).toMatch(/\bfamilyId\s+String/);
    expect(refreshSession).toMatch(/\brevocationReason\s+String\?/);
    expect(refreshSession).toMatch(/@@index\(\[userId\]\)/);
    expect(refreshSession).toMatch(/@@index\(\[workspaceId\]\)/);
    expect(refreshSession).toMatch(/@@index\(\[familyId\]\)/);
    expect(refreshSession).toMatch(/@@index\(\[userId, workspaceId, revokedAt, expiresAt\]\)/);

    const user = readModel(schema, 'User');
    const workspace = readModel(schema, 'Workspace');
    expect(user).toMatch(/\brefreshSessions\s+RefreshSession\[\]/);
    expect(workspace).toMatch(/\brefreshSessions\s+RefreshSession\[\]/);

    const invitation = readModel(schema, 'WorkspaceInvitation');
    expect(invitation).toMatch(/\bworkspaceId\s+String/);
    expect(invitation).toMatch(/\bemail\s+String/);
    expect(invitation).toMatch(/\brole\s+UserRole/);
    expect(invitation).toMatch(/\btokenHash\s+String\s+@unique/);
    expect(invitation).toMatch(/\bexpiresAt\s+DateTime/);
    expect(invitation).toMatch(/\bacceptedAt\s+DateTime\?/);
    expect(invitation).toMatch(/\brevokedAt\s+DateTime\?/);
    expect(invitation).toMatch(/\binvitedById\s+String/);
    expect(invitation).toMatch(/@@index\(\[workspaceId\]/);
    expect(invitation).toMatch(/@@index\(\[workspaceId, email, expiresAt\]\)/);
    expect(user).toMatch(/\bworkspaceInvitations\s+WorkspaceInvitation\[\]/);
    expect(workspace).toMatch(/\binvitations\s+WorkspaceInvitation\[\]/);

    expect(invitation).toMatch(/\bid\s+String\s+@id/);
    expect(invitation).toMatch(/\bcreatedAt\s+DateTime/);
    expect(invitation).toMatch(/\bupdatedAt\s+DateTime/);

    expect(schema).toMatch(/email\s+String\s+@unique/);
    expect(schema).toMatch(/@@unique\(\[workspaceId, userId\]\)/);
    expect(schema).toMatch(/@@unique\(\[workspaceId, contentHash\]\)/);
    expect(schema).toMatch(/@@unique\(\[workspaceId, idempotencyKey\]\)/);
    expect(schema).toMatch(/@@unique\(\[assetId, versionNumber\]\)/);
    expect(schema).toMatch(/providerMetadata\s+Json/);
    expect(schema).toMatch(/sourceReferences\s+Json/);
    expect(schema).toMatch(/assetReferences\s+Json/);
  });

  it('migrates workspace invitations with safe foreign keys, uniqueness, and lookup indexes', () => {
    expect(existsSync(workspaceInvitationMigrationPath)).toBe(true);
    if (!existsSync(workspaceInvitationMigrationPath)) return;

    const migration = readFileSync(workspaceInvitationMigrationPath, 'utf8');
    expect(migration).toMatch(/CREATE TABLE "WorkspaceInvitation"/);
    expect(migration).toMatch(/"id" TEXT NOT NULL/);
    expect(migration).toMatch(
      /CONSTRAINT "WorkspaceInvitation_p(?:k)(?:e)(?:y)" PRIMARY KEY \("id"\)/,
    );
    expect(migration).toMatch(/"workspaceId" TEXT NOT NULL/);
    expect(migration).toMatch(/"email" TEXT NOT NULL/);
    expect(migration).toMatch(/"role" "UserRole" NOT NULL/);
    expect(migration).toMatch(/"tokenHash" TEXT NOT NULL/);
    expect(migration).toMatch(/"expiresAt" TIMESTAMP\(3\) NOT NULL/);
    expect(migration).toMatch(/"acceptedAt" TIMESTAMP\(3\)/);
    expect(migration).toMatch(/"revokedAt" TIMESTAMP\(3\)/);
    expect(migration).toMatch(/"invitedById" TEXT NOT NULL/);
    expect(migration).toMatch(/"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(migration).toMatch(/"updatedAt" TIMESTAMP\(3\) NOT NULL/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"\("tokenHash"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "WorkspaceInvitation_workspaceId_idx" ON "WorkspaceInvitation"\("workspaceId"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "WorkspaceInvitation_workspaceId_email_expiresAt_idx" ON "WorkspaceInvitation"\("workspaceId", "email", "expiresAt"\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("workspaceId"\) REFERENCES "Workspace"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("invitedById"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
  });

  it('migrates refresh sessions with safe foreign keys, uniqueness, and lookup indexes', () => {
    expect(existsSync(refreshSessionMigrationPath)).toBe(true);
    if (!existsSync(refreshSessionMigrationPath)) return;

    const migration = readFileSync(refreshSessionMigrationPath, 'utf8');
    expect(migration).toMatch(/CREATE TABLE "RefreshSession"/);
    expect(migration).toMatch(/"userId" TEXT NOT NULL/);
    expect(migration).toMatch(/"workspaceId" TEXT NOT NULL/);
    expect(migration).toMatch(/"tokenHash" TEXT NOT NULL/);
    expect(migration).toMatch(/"expiresAt" TIMESTAMP\(3\) NOT NULL/);
    expect(migration).toMatch(/"revokedAt" TIMESTAMP\(3\)/);
    expect(migration).toMatch(/"replacedById" TEXT/);
    expect(migration).toMatch(/"familyId" TEXT NOT NULL/);
    expect(migration).toMatch(/"revocationReason" TEXT/);
    expect(migration).toMatch(/"createdAt" TIMESTAMP\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP/);
    expect(migration).toMatch(/"updatedAt" TIMESTAMP\(3\) NOT NULL/);
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"\("tokenHash"\)/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "RefreshSession_replacedById_key" ON "RefreshSession"\("replacedById"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "RefreshSession_userId_idx" ON "RefreshSession"\("userId"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "RefreshSession_workspaceId_idx" ON "RefreshSession"\("workspaceId"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"\("familyId"\)/,
    );
    expect(migration).toMatch(
      /CREATE INDEX "RefreshSession_userId_workspaceId_revokedAt_expiresAt_idx" ON "RefreshSession"\("userId", "workspaceId", "revokedAt", "expiresAt"\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("workspaceId"\) REFERENCES "Workspace"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("replacedById"\) REFERENCES "RefreshSession"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/,
    );
  });

  it('matches product states for source, batch, asset, review, export, and task records', () => {
    expect(existsSync(schemaPath)).toBe(true);
    if (!existsSync(schemaPath)) return;

    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toMatch(/enum SourceStatus \{[\s\S]*created[\s\S]*cancelled[\s\S]*\}/);
    expect(schema).toMatch(
      /enum ContentBatchStatus \{[\s\S]*generation_failed[\s\S]*export_failed[\s\S]*\}/,
    );
    expect(schema).toMatch(/enum AssetStatus \{[\s\S]*needs_changes[\s\S]*exported[\s\S]*\}/);
    expect(schema).toMatch(/enum ReviewStatus \{[\s\S]*needs_review[\s\S]*approved[\s\S]*\}/);
    expect(schema).toMatch(/enum ExportJobStatus \{[\s\S]*processing[\s\S]*cancelled[\s\S]*\}/);
    expect(schema).toMatch(/enum TaskRunStatus \{[\s\S]*processing[\s\S]*cancelled[\s\S]*\}/);
  });
});

describe('database readiness', () => {
  it('fails safely when DATABASE_URL is missing without querying or exposing config', async () => {
    expect(existsSync(readinessPath)).toBe(true);
    if (!existsSync(readinessPath)) return;

    const readiness = (await import(pathToFileURL(readinessPath).href)) as {
      checkDatabaseReadiness: (
        client: { $queryRaw: (...args: unknown[]) => Promise<unknown> },
        env?: NodeJS.ProcessEnv,
      ) => Promise<{ status: string; reason?: string }>;
    };
    let queryCount = 0;
    const client = {
      $queryRaw: async (...args: unknown[]) => {
        void args;
        queryCount += 1;
      },
    };

    const result = await readiness.checkDatabaseReadiness(client, {});

    expect(result).toEqual({ status: 'not_configured', reason: 'DATABASE_URL_MISSING' });
    expect(queryCount).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/password|secret|postgresql:\/\//i);
  });

  it('returns a safe unavailable status when the database ping fails', async () => {
    expect(existsSync(readinessPath)).toBe(true);
    if (!existsSync(readinessPath)) return;

    const readiness = (await import(pathToFileURL(readinessPath).href)) as {
      checkDatabaseReadiness: (
        client: { $queryRaw: (...args: unknown[]) => Promise<unknown> },
        env?: NodeJS.ProcessEnv,
      ) => Promise<{ status: string; reason?: string }>;
    };
    const client = {
      $queryRaw: async (...args: unknown[]) => {
        void args;
        throw new Error('postgresql://user:secret@example.test/db');
      },
    };

    const result = await readiness.checkDatabaseReadiness(client, {
      DATABASE_URL: 'postgresql://user:secret@example.test/db',
    });

    expect(result).toEqual({ status: 'unavailable', reason: 'DATABASE_UNREACHABLE' });
    expect(JSON.stringify(result)).not.toMatch(/secret|postgresql:\/\//i);
  });
});

describe('test seed safety', () => {
  it('refuses production before touching the database', async () => {
    expect(existsSync(seedPath)).toBe(true);
    if (!existsSync(seedPath)) return;

    const seed = (await import(pathToFileURL(seedPath).href)) as {
      assertSeedEnvironment: (env: NodeJS.ProcessEnv) => void;
    };

    expect(() => seed.assertSeedEnvironment({ NODE_ENV: 'production' })).toThrow(
      'Refusing to run Prisma seed in production',
    );
    expect(() => seed.assertSeedEnvironment({ NODE_ENV: 'development' })).toThrow(
      'Refusing to run Prisma seed without ALLOW_TEST_SEED=true',
    );
  });

  it('uses marked writes so running the seed twice remains idempotent', async () => {
    expect(existsSync(seedPath)).toBe(true);
    if (!existsSync(seedPath)) return;

    const seed = (await import(pathToFileURL(seedPath).href)) as {
      seedTestData: (client: unknown, env: NodeJS.ProcessEnv) => Promise<void>;
    };
    const calls: Array<{ model: string; data: Record<string, unknown> }> = [];
    const upsert = (model: string) => async (args: { create: Record<string, unknown> }) => {
      calls.push({ model, data: args.create });
      return { id: `${model}-id` };
    };
    const client = {
      user: { upsert: upsert('user') },
      workspace: { upsert: upsert('workspace') },
      workspaceMember: { upsert: upsert('workspaceMember') },
      brand: { upsert: upsert('brand') },
    };

    await seed.seedTestData(client, { NODE_ENV: 'test' });
    await seed.seedTestData(client, { NODE_ENV: 'test' });

    expect(calls).toHaveLength(8);
    expect(calls.every(({ data }) => data.isTestData === true)).toBe(true);
    expect(calls.map(({ model }) => model)).toEqual([
      'user',
      'workspace',
      'workspaceMember',
      'brand',
      'user',
      'workspace',
      'workspaceMember',
      'brand',
    ]);
  });

  it('does not overwrite an existing non-test user', async () => {
    const seed = (await import(pathToFileURL(seedPath).href)) as {
      seedTestData: (client: unknown, env: NodeJS.ProcessEnv) => Promise<void>;
    };
    let upsertCalled = false;
    const model = {
      findUnique: async () => ({ id: 'existing-user', isTestData: false }),
      upsert: async () => {
        upsertCalled = true;
        return { id: 'unexpected' };
      },
    };
    const client = {
      user: model,
      workspace: { upsert: async () => ({ id: 'workspace-id' }) },
      workspaceMember: { upsert: async () => ({ id: 'member-id' }) },
      brand: { upsert: async () => ({ id: 'brand-id' }) },
    };

    await expect(seed.seedTestData(client, { NODE_ENV: 'test' })).rejects.toThrow(
      'Refusing to overwrite non-test user',
    );
    expect(upsertCalled).toBe(false);
  });
});

describe('migration safety', () => {
  it('requires a database URL before migration execution', () => {
    expect(() =>
      assertMigrationPreflight({
        command: 'deploy',
        pendingMigrations: 1,
        backupConfirmed: true,
        env: {},
      }),
    ).toThrow('DATABASE_URL is required before running a migration');
  });

  it('requires a confirmed backup before production migration or rollback', () => {
    expect(() =>
      assertMigrationPreflight({
        command: 'deploy',
        pendingMigrations: 1,
        backupConfirmed: false,
        isProduction: true,
        env: { DATABASE_URL: 'postgresql://localhost/sourceflow' },
      }),
    ).toThrow('Production migration requires backup confirmation');

    expect(() =>
      assertMigrationPreflight({
        command: 'rollback',
        pendingMigrations: 0,
        backupConfirmed: false,
        env: { DATABASE_URL: 'postgresql://localhost/sourceflow' },
      }),
    ).toThrow('Rollback requires backup confirmation');
  });

  it('allows a reviewed production migration and rollback', () => {
    expect(() =>
      assertMigrationPreflight({
        command: 'deploy',
        pendingMigrations: 1,
        backupConfirmed: true,
        isProduction: true,
        env: { DATABASE_URL: 'postgresql://localhost/sourceflow' },
      }),
    ).not.toThrow();

    expect(() =>
      assertMigrationPreflight({
        command: 'rollback',
        pendingMigrations: 0,
        backupConfirmed: true,
        env: { DATABASE_URL: 'postgresql://localhost/sourceflow' },
      }),
    ).not.toThrow();
  });
});

describe('API database startup', () => {
  it('fails startup when database configuration is missing', () => {
    expect(() => assertDatabaseConfigured({})).toThrow(
      'DATABASE_URL is required before starting the API',
    );
  });
});
