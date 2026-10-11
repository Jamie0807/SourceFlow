import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

import type { SourceTaskJobContext, SourceTaskMessage, SourceTaskQueue } from '@sourceflow/domain';

import { BullMQSourceTaskQueue } from './queue/bullmq-source-task.queue.js';
import { PrismaSourceLookup } from './source-processing/prisma-source.lookup.js';
import { MinioSourceMediaReader } from './source-processing/minio-source-media-reader.js';
import { SourceMediaValidator } from './source-processing/source-media-validator.js';
import { MockSourceProcessor } from './source-processing/source-processor.js';
import { SourceTaskHandler } from './source-processing/source-task.handler.js';
import { PrismaTaskRunStore } from './task-runs/prisma-task-run.store.js';

export const DEFAULT_WORKER_CONCURRENCY = 2;
export const WORKER_CONCURRENCY_WARNING =
  'Worker configuration warning: invalid WORKER_CONCURRENCY; using default 2';
export const WORKER_SHUTDOWN_ERROR = 'Worker shutdown failed';

export type WorkerEnvironment = Readonly<Record<string, string | undefined>>;

export type WorkerLogger = Readonly<{
  warn(message: string): void;
}>;

export type WorkerConfig = Readonly<{
  databaseUrl: string;
  redisUrl: string;
  concurrency: number;
  minio: {
    endpoint: string;
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}>;

export function parseWorkerConfig(
  environment: WorkerEnvironment,
  logger: WorkerLogger = console,
): WorkerConfig {
  const redisUrl = environment.REDIS_URL;
  if (!redisUrl) {
    throw new Error('Worker configuration error: REDIS_URL is required');
  }

  const databaseUrl = environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Worker configuration error: DATABASE_URL is required');
  }

  const minio = {
    endpoint: environment.MINIO_ENDPOINT,
    bucket: environment.MINIO_BUCKET,
    region: environment.MINIO_REGION,
    accessKeyId: environment.MINIO_ROOT_USER,
    secretAccessKey: environment.MINIO_ROOT_PASSWORD,
  };
  const missingMinioSetting = Object.entries(minio).find(([, value]) => !value)?.[0];
  if (missingMinioSetting) {
    throw new Error(
      `Worker configuration error: ${toMinioEnvironmentName(missingMinioSetting)} is required`,
    );
  }

  const rawConcurrency = environment.WORKER_CONCURRENCY;
  if (rawConcurrency === undefined) {
    return {
      databaseUrl,
      redisUrl,
      concurrency: DEFAULT_WORKER_CONCURRENCY,
      minio: minio as WorkerConfig['minio'],
    };
  }

  const concurrency = Number(rawConcurrency);
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    logger.warn(WORKER_CONCURRENCY_WARNING);
    return {
      databaseUrl,
      redisUrl,
      concurrency: DEFAULT_WORKER_CONCURRENCY,
      minio: minio as WorkerConfig['minio'],
    };
  }

  return { databaseUrl, redisUrl, concurrency, minio: minio as WorkerConfig['minio'] };
}

function toMinioEnvironmentName(setting: string): string {
  const names: Record<string, string> = {
    endpoint: 'MINIO_ENDPOINT',
    bucket: 'MINIO_BUCKET',
    region: 'MINIO_REGION',
    accessKeyId: 'MINIO_ROOT_USER',
    secretAccessKey: 'MINIO_ROOT_PASSWORD',
  };
  return names[setting] ?? 'MINIO_CONFIGURATION';
}

export type WorkerPrismaLifecycle = Readonly<{
  $disconnect(): Promise<void>;
}>;

export type WorkerSourceTaskHandler = Readonly<{
  handle(message: SourceTaskMessage, context: SourceTaskJobContext): Promise<unknown>;
}>;

export type WorkerRuntimeDependencies = Readonly<{
  queue: SourceTaskQueue;
  prisma: WorkerPrismaLifecycle;
  sourceTaskHandler: WorkerSourceTaskHandler;
}>;

export type CreateWorkerRuntimeOptions = Readonly<{
  databaseUrl: string;
  redisUrl: string;
  concurrency: number;
  dependencies: WorkerRuntimeDependencies;
}>;

export type WorkerRuntime = Readonly<{
  start(): Promise<void>;
  close(): Promise<void>;
}>;

export function createWorkerRuntime(options: CreateWorkerRuntimeOptions): WorkerRuntime {
  const { queue, prisma, sourceTaskHandler } = options.dependencies;
  let started = false;
  let closed = false;
  let closing: Promise<void> | undefined;

  return {
    async start(): Promise<void> {
      if (closed) {
        throw new Error('Worker runtime is closed');
      }
      if (started) {
        return;
      }
      await queue.start(async (message, context) => {
        await sourceTaskHandler.handle(message, context);
      });
      started = true;
    },
    async close(): Promise<void> {
      if (closing) {
        try {
          await closing;
        } catch {
          // The original caller receives the stable shutdown error.
        }
        return;
      }
      if (closed) {
        return;
      }

      closed = true;
      closing = closeWorkerResources(queue, prisma);
      try {
        await closing;
      } finally {
        closing = undefined;
      }
    },
  };
}

async function closeWorkerResources(
  queue: SourceTaskQueue,
  prisma: WorkerPrismaLifecycle,
): Promise<void> {
  let failed = false;
  try {
    await queue.close();
  } catch {
    failed = true;
  }
  try {
    await prisma.$disconnect();
  } catch {
    failed = true;
  }

  if (failed) {
    throw new Error(WORKER_SHUTDOWN_ERROR);
  }
}

export type ProductionWorkerRuntimeDependencies = Readonly<{
  createPrisma(databaseUrl: string): WorkerPrismaLifecycle;
  createQueue(options: { redisUrl: string; concurrency: number }): SourceTaskQueue;
  createTaskRuns(prisma: WorkerPrismaLifecycle): unknown;
  createSourceLookup(prisma: WorkerPrismaLifecycle): unknown;
  createProcessor(): unknown;
  createValidator(config: WorkerConfig): unknown;
  createSourceTaskHandler(
    taskRuns: unknown,
    sourceLookup: unknown,
    processor: unknown,
    validator: unknown,
  ): WorkerSourceTaskHandler;
}>;

const productionDependencies: ProductionWorkerRuntimeDependencies = {
  createPrisma: (databaseUrl) => new PrismaClient({ datasources: { db: { url: databaseUrl } } }),
  createQueue: (options) => new BullMQSourceTaskQueue(options),
  createTaskRuns: (prisma) => new PrismaTaskRunStore(prisma as PrismaClient),
  createSourceLookup: (prisma) => new PrismaSourceLookup(prisma as PrismaClient),
  createProcessor: () => new MockSourceProcessor(),
  createValidator: (config) =>
    new SourceMediaValidator(new MinioSourceMediaReader({ ...config.minio, forcePathStyle: true })),
  createSourceTaskHandler: (taskRuns, sourceLookup, processor, validator) =>
    new SourceTaskHandler(
      taskRuns as PrismaTaskRunStore,
      sourceLookup as PrismaSourceLookup,
      processor as MockSourceProcessor,
      validator as SourceMediaValidator,
    ),
};

export function createProductionWorkerRuntime(
  config: WorkerConfig,
  dependencies: ProductionWorkerRuntimeDependencies = productionDependencies,
): WorkerRuntime {
  const prisma = dependencies.createPrisma(config.databaseUrl);
  const queue = dependencies.createQueue({
    redisUrl: config.redisUrl,
    concurrency: config.concurrency,
  });
  const taskRuns = dependencies.createTaskRuns(prisma);
  const sourceLookup = dependencies.createSourceLookup(prisma);
  const processor = dependencies.createProcessor();
  const validator = dependencies.createValidator(config);
  const sourceTaskHandler = dependencies.createSourceTaskHandler(
    taskRuns,
    sourceLookup,
    processor,
    validator,
  );

  return createWorkerRuntime({ ...config, dependencies: { queue, prisma, sourceTaskHandler } });
}

export type WorkerSignalProcess = Readonly<{
  once(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  removeListener?(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}>;

const registeredShutdownHandlers = new WeakSet<WorkerRuntime>();

export function registerWorkerShutdownHandlers(
  runtime: WorkerRuntime,
  signalProcess: WorkerSignalProcess = process,
): () => void {
  if (registeredShutdownHandlers.has(runtime)) {
    return () => undefined;
  }
  registeredShutdownHandlers.add(runtime);

  const close = (): void => {
    void runtime.close().catch(() => {
      console.error(WORKER_SHUTDOWN_ERROR);
    });
  };
  signalProcess.once('SIGTERM', close);
  signalProcess.once('SIGINT', close);

  return () => {
    signalProcess.removeListener?.('SIGTERM', close);
    signalProcess.removeListener?.('SIGINT', close);
    registeredShutdownHandlers.delete(runtime);
  };
}

export async function startWorkerRuntime(
  runtime: WorkerRuntime,
  unregisterShutdownHandlers: () => void = () => undefined,
): Promise<void> {
  try {
    await runtime.start();
  } catch {
    unregisterShutdownHandlers();
    try {
      await runtime.close();
    } catch {
      // Startup failure remains the public error even if cleanup also fails.
    }
    throw new Error('Worker failed to start');
  }
}

export async function startProductionWorker(
  environment: WorkerEnvironment = process.env,
  logger: WorkerLogger = console,
): Promise<WorkerRuntime> {
  const runtime = createProductionWorkerRuntime(parseWorkerConfig(environment, logger));
  const unregisterShutdownHandlers = registerWorkerShutdownHandlers(runtime);
  await startWorkerRuntime(runtime, unregisterShutdownHandlers);
  console.info('SourceFlow worker ready');
  return runtime;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void startProductionWorker().catch(() => {
    console.error('SourceFlow worker failed to start');
    process.exitCode = 1;
  });
}
