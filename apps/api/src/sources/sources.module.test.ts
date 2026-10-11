import { describe, expect, it } from 'vitest';

import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { STORAGE_PORT } from '../storage/storage.port.js';
import { MinioStorageAdapter } from '../storage/minio-storage.adapter.js';
import { AppModule } from '../app.module.js';
import { SourcesController } from './sources.controller.js';
import { readMinioStorageConfig, SourcesModule } from './sources.module.js';
import { SourcesRepositoryToken } from './sources.repository.js';
import { PrismaSourcesRepository } from './prisma-sources.repository.js';
import { SOURCE_TASK_PUBLISHER } from './source-task.publisher.js';

describe('SourcesModule wiring', () => {
  it('registers SourcesModule in the API root module', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];

    expect(imports).toContain(SourcesModule);
  });

  it('registers the controller, scoped repository, and MinIO storage port', () => {
    const imports = Reflect.getMetadata('imports', SourcesModule) as unknown[];
    const controllers = Reflect.getMetadata('controllers', SourcesModule) as unknown[];
    const providers = Reflect.getMetadata('providers', SourcesModule) as Array<{
      provide?: unknown;
      useExisting?: unknown;
      useFactory?: unknown;
    }>;

    expect(imports).toContain(AuthModule);
    expect(imports).toContain(PrismaModule);
    expect(controllers).toContain(SourcesController);
    expect(providers).toContain(PrismaSourcesRepository);
    expect(providers).toContainEqual(
      expect.objectContaining({ provide: SOURCE_TASK_PUBLISHER, useFactory: expect.any(Function) }),
    );
    expect(providers).toContainEqual(
      expect.objectContaining({ provide: MinioStorageAdapter, useFactory: expect.any(Function) }),
    );
    expect(providers).toContainEqual({
      provide: SourcesRepositoryToken,
      useExisting: PrismaSourcesRepository,
    });
    expect(
      providers.some((provider) => provider.provide === STORAGE_PORT && provider.useExisting),
    ).toBe(true);
  });

  it.each([
    ['MINIO_ENDPOINT'],
    ['MINIO_BUCKET'],
    ['MINIO_REGION'],
    ['MINIO_ROOT_USER'],
    ['MINIO_ROOT_PASSWORD'],
  ])('fails closed when %s is missing', (missingName) => {
    const config = {
      MINIO_ENDPOINT: 'http://localhost:9000',
      MINIO_BUCKET: 'sourceflow-local',
      MINIO_REGION: 'us-east-1',
      MINIO_ROOT_USER: 'example-user',
      MINIO_ROOT_PASSWORD: 'example-password',
    };
    delete config[missingName as keyof typeof config];

    expect(() => readMinioStorageConfig(config)).toThrow(`${missingName} is required`);
  });

  it('uses only explicit endpoint, bucket, region, and existing MinIO credential variables', () => {
    expect(
      readMinioStorageConfig({
        MINIO_ENDPOINT: 'http://localhost:9000',
        MINIO_BUCKET: 'sourceflow-local',
        MINIO_REGION: 'us-east-1',
        MINIO_ROOT_USER: 'example-user',
        MINIO_ROOT_PASSWORD: 'example-password',
      }),
    ).toEqual({
      endpoint: 'http://localhost:9000',
      bucket: 'sourceflow-local',
      region: 'us-east-1',
      accessKeyId: 'example-user',
      secretAccessKey: 'example-password',
      forcePathStyle: true,
    });
  });
});
