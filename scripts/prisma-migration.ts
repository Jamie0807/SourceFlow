import { spawnSync } from 'node:child_process';
import { assertMigrationPreflight } from '../apps/api/src/database/migration-preflight.js';

const operation = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
const backupConfirmed = process.env.MIGRATION_BACKUP_CONFIRMED === 'true';
const pendingMigrations = Number(process.env.MIGRATION_PENDING_COUNT ?? 1);
const nameFlagIndex = process.argv.indexOf('--name');
const migrationName =
  process.env.MIGRATION_NAME ??
  (nameFlagIndex >= 0 ? process.argv[nameFlagIndex + 1] : undefined) ??
  'local_change';

if (operation !== 'dev' && operation !== 'deploy' && operation !== 'rollback-check') {
  throw new Error('Usage: prisma-migration.ts <dev|deploy|rollback-check>');
}

assertMigrationPreflight({
  command: operation === 'rollback-check' ? 'rollback' : 'deploy',
  pendingMigrations,
  backupConfirmed,
  isProduction: process.env.NODE_ENV === 'production',
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

if (operation === 'rollback-check') {
  console.log(
    'Migration rollback preflight passed; use a reviewed forward migration or database restore.',
  );
  process.exit(0);
}

const args = ['exec', 'prisma', 'migrate', operation, '--schema', 'prisma/schema.prisma'];
if (operation === 'dev') {
  args.push('--name', migrationName);
}

const result = spawnSync('pnpm', args, { env: process.env, stdio: 'inherit' });
process.exit(result.status ?? 1);
