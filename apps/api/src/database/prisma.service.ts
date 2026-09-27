import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export function assertDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required before starting the API');
  }
}

@Injectable()
export class PrismaService extends PrismaClient {
  async onModuleInit(): Promise<void> {
    assertDatabaseConfigured();
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
