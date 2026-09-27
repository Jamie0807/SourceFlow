import { PrismaClient } from '@prisma/client';

type SeedEnvironment = NodeJS.ProcessEnv;

type SeedRecord = { id: string; isTestData?: boolean };

type SeedModel = {
  findUnique?: (args: Record<string, unknown>) => Promise<SeedRecord | null>;
  upsert: (args: Record<string, unknown>) => Promise<SeedRecord>;
};

type SeedClient = {
  user: SeedModel;
  workspace: SeedModel;
  workspaceMember: SeedModel;
  brand: SeedModel;
};

export function assertSeedEnvironment(env: SeedEnvironment = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to run Prisma seed in production');
  }
  if (env.NODE_ENV !== 'test' && env.ALLOW_TEST_SEED !== 'true') {
    throw new Error('Refusing to run Prisma seed without ALLOW_TEST_SEED=true');
  }
}

async function assertExistingRecordIsTestData(
  model: SeedModel,
  where: Record<string, unknown>,
  label: string,
): Promise<void> {
  const existing = await model.findUnique?.({ where });
  if (existing && existing.isTestData !== true) {
    throw new Error(`Refusing to overwrite non-test ${label}`);
  }
}

export async function seedTestData(
  client: SeedClient,
  env: SeedEnvironment = process.env,
): Promise<void> {
  assertSeedEnvironment(env);

  const userWhere = { email: 'test-owner@sourceflow.local' };
  await assertExistingRecordIsTestData(client.user, userWhere, 'user');
  const user = await client.user.upsert({
    where: userWhere,
    update: { displayName: 'SourceFlow Test Owner', isTestData: true },
    create: {
      email: 'test-owner@sourceflow.local',
      displayName: 'SourceFlow Test Owner',
      isTestData: true,
    },
  });

  const workspaceWhere = { slug: 'sourceflow-test-workspace' };
  await assertExistingRecordIsTestData(client.workspace, workspaceWhere, 'workspace');
  const workspace = await client.workspace.upsert({
    where: workspaceWhere,
    update: { name: 'SourceFlow Test Workspace', isTestData: true },
    create: {
      name: 'SourceFlow Test Workspace',
      slug: 'sourceflow-test-workspace',
      isTestData: true,
    },
  });

  const workspaceMemberWhere = {
    workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
  };
  await assertExistingRecordIsTestData(
    client.workspaceMember,
    workspaceMemberWhere,
    'workspace member',
  );
  await client.workspaceMember.upsert({
    where: workspaceMemberWhere,
    update: { role: 'owner', isTestData: true },
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: 'owner',
      isTestData: true,
    },
  });

  const brandWhere = {
    workspaceId_name: { workspaceId: workspace.id, name: 'Default Test Brand' },
  };
  await assertExistingRecordIsTestData(client.brand, brandWhere, 'brand');
  await client.brand.upsert({
    where: brandWhere,
    update: { isDefault: true, isTestData: true },
    create: {
      workspaceId: workspace.id,
      name: 'Default Test Brand',
      isDefault: true,
      isTestData: true,
    },
  });
}

async function main(): Promise<void> {
  assertSeedEnvironment();
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required before running Prisma seed');
  }
  const client = new PrismaClient();
  try {
    await seedTestData(client as unknown as SeedClient);
  } finally {
    await client.$disconnect();
  }
}

if (process.argv[1]?.endsWith('prisma/seed.ts')) {
  void main();
}
