export type DatabaseReadiness =
  | { status: 'ready' }
  | { status: 'not_configured'; reason: 'DATABASE_URL_MISSING' }
  | { status: 'unavailable'; reason: 'DATABASE_UNREACHABLE' };

export type DatabaseReadinessClient = {
  $queryRaw: (...args: unknown[]) => Promise<unknown>;
};

export async function checkDatabaseReadiness(
  client: DatabaseReadinessClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DatabaseReadiness> {
  if (!env.DATABASE_URL) {
    return { status: 'not_configured', reason: 'DATABASE_URL_MISSING' };
  }

  try {
    await client.$queryRaw('SELECT 1');
    return { status: 'ready' };
  } catch {
    return { status: 'unavailable', reason: 'DATABASE_UNREACHABLE' };
  }
}
