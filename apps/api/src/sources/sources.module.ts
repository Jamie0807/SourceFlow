import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { MinioStorageAdapter, type MinioStorageConfig } from '../storage/minio-storage.adapter.js';
import { STORAGE_PORT } from '../storage/storage.port.js';
import { BullMQSourceTaskPublisher } from './bullmq-source-task.publisher.js';
import { PrismaSourcesRepository } from './prisma-sources.repository.js';
import { SourcesController } from './sources.controller.js';
import { SourcesRepositoryToken } from './sources.repository.js';
import { SourcesService } from './sources.service.js';
import { SOURCE_TASK_PUBLISHER } from './source-task.publisher.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SourcesController],
  providers: [
    PrismaSourcesRepository,
    SourcesService,
    { provide: SourcesRepositoryToken, useExisting: PrismaSourcesRepository },
    {
      provide: SOURCE_TASK_PUBLISHER,
      useFactory: () => new BullMQSourceTaskPublisher(),
    },
    {
      provide: MinioStorageAdapter,
      useFactory: () => new MinioStorageAdapter(readMinioStorageConfig()),
    },
    { provide: STORAGE_PORT, useExisting: MinioStorageAdapter },
  ],
})
export class SourcesModule {}

export function readMinioStorageConfig(env: NodeJS.ProcessEnv = process.env): MinioStorageConfig {
  const endpoint = requiredSetting(env, 'MINIO_ENDPOINT');
  const bucket = requiredSetting(env, 'MINIO_BUCKET');
  const region = requiredSetting(env, 'MINIO_REGION');
  const accessKeyId = requiredSetting(env, 'MINIO_ROOT_USER');
  const secretAccessKey = requiredSetting(env, 'MINIO_ROOT_PASSWORD');

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error('MINIO_ENDPOINT must be a valid HTTP or HTTPS URL');
  }
  if (
    (parsedEndpoint.protocol !== 'http:' && parsedEndpoint.protocol !== 'https:') ||
    parsedEndpoint.username.length > 0 ||
    parsedEndpoint.password.length > 0
  ) {
    throw new Error('MINIO_ENDPOINT must be a credential-free HTTP or HTTPS URL');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) {
    throw new Error('MINIO_BUCKET must be a valid bucket name');
  }
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/u.test(region)) {
    throw new Error('MINIO_REGION must be a valid region name');
  }

  return {
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true,
  };
}

function requiredSetting(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required to start the Sources API`);
  }
  return value;
}
