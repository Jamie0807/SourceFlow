export type MigrationCommand = 'deploy' | 'rollback';

export type MigrationPreflightInput = {
  command: MigrationCommand;
  pendingMigrations: number;
  backupConfirmed: boolean;
  isProduction?: boolean;
  env?: NodeJS.ProcessEnv;
};

export function assertMigrationPreflight({
  command,
  pendingMigrations,
  backupConfirmed,
  isProduction = process.env.NODE_ENV === 'production',
  env = process.env,
}: MigrationPreflightInput): void {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required before running a migration');
  }

  if (command === 'rollback' && !backupConfirmed) {
    throw new Error('Rollback requires backup confirmation');
  }

  if (isProduction && pendingMigrations > 0 && !backupConfirmed) {
    throw new Error('Production migration requires backup confirmation');
  }
}
