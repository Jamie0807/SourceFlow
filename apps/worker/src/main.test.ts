import { describe, expect, it, vi } from 'vitest';

import type { SourceTaskJobHandler } from '@sourceflow/domain';

import {
  WORKER_CONCURRENCY_WARNING,
  createProductionWorkerRuntime,
  createWorkerRuntime,
  parseWorkerConfig,
  registerWorkerShutdownHandlers,
  startWorkerRuntime,
} from './main.js';

describe('parseWorkerConfig', () => {
  const requiredEnvironment = {
    DATABASE_URL: 'postgresql://local.test/sourceflow',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('requires both connection URLs with stable configuration errors', () => {
    expect(() => parseWorkerConfig({ DATABASE_URL: requiredEnvironment.DATABASE_URL })).toThrow(
      'Worker configuration error: REDIS_URL is required',
    );
    expect(() => parseWorkerConfig({ REDIS_URL: requiredEnvironment.REDIS_URL })).toThrow(
      'Worker configuration error: DATABASE_URL is required',
    );
  });

  it('uses concurrency 2 by default and accepts a positive integer', () => {
    expect(parseWorkerConfig(requiredEnvironment)).toMatchObject({ concurrency: 2 });
    expect(parseWorkerConfig({ ...requiredEnvironment, WORKER_CONCURRENCY: '4' })).toMatchObject({
      concurrency: 4,
    });
  });

  it.each(['0', '-1', '1.5', 'not-a-number', '7-sensitive-suffix'])(
    'falls back to concurrency 2 with a fixed warning for %s',
    (rawConcurrency) => {
      const warn = vi.fn();

      expect(
        parseWorkerConfig({ ...requiredEnvironment, WORKER_CONCURRENCY: rawConcurrency }, { warn }),
      ).toMatchObject({ concurrency: 2 });
      expect(warn).toHaveBeenCalledWith(WORKER_CONCURRENCY_WARNING);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(rawConcurrency);
    },
  );
});

describe('createWorkerRuntime', () => {
  it('starts the configured queue and closes it before Prisma', async () => {
    const events: string[] = [];
    let handler: SourceTaskJobHandler | undefined;
    const queue = {
      enqueue: vi.fn(async () => 'job-1'),
      start: vi.fn(async (received: SourceTaskJobHandler) => {
        handler = received;
        events.push('queue:start');
      }),
      close: vi.fn(async () => {
        events.push('queue:close');
      }),
    };
    const prisma = {
      $disconnect: vi.fn(async () => {
        events.push('prisma:disconnect');
      }),
    };
    const sourceTaskHandler = {
      handle: vi.fn(async () => null),
    };

    const runtime = createWorkerRuntime({
      databaseUrl: 'postgresql://local.test/sourceflow',
      redisUrl: 'redis://:password@localhost:6379',
      concurrency: 2,
      dependencies: { queue, prisma, sourceTaskHandler },
    });

    await runtime.start();
    await runtime.close();

    expect(queue.start).toHaveBeenCalledOnce();
    expect(handler).toBeTypeOf('function');
    expect(queue.close).toHaveBeenCalledOnce();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(events).toEqual(['queue:start', 'queue:close', 'prisma:disconnect']);
  });

  it('closes Prisma after a queue failure, returns a stable error, and is idempotent', async () => {
    const events: string[] = [];
    const queue = {
      enqueue: vi.fn(async () => 'job-1'),
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => {
        events.push('queue:close');
        throw new Error('redis password=should-not-leak');
      }),
    };
    const prisma = {
      $disconnect: vi.fn(async () => {
        events.push('prisma:disconnect');
      }),
    };
    const runtime = createWorkerRuntime({
      databaseUrl: 'postgresql://local.test/sourceflow',
      redisUrl: 'redis://:password@localhost:6379',
      concurrency: 2,
      dependencies: { queue, prisma, sourceTaskHandler: { handle: vi.fn(async () => null) } },
    });

    await expect(runtime.close()).rejects.toThrow('Worker shutdown failed');
    await runtime.close();

    expect(events).toEqual(['queue:close', 'prisma:disconnect']);
    expect(queue.close).toHaveBeenCalledOnce();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
  });

  it('releases Queue and Prisma when runtime startup fails without leaking the cause', async () => {
    const events: string[] = [];
    const runtime = createWorkerRuntime({
      databaseUrl: 'postgresql://local.test/sourceflow',
      redisUrl: 'redis://:password@localhost:6379',
      concurrency: 2,
      dependencies: {
        queue: {
          enqueue: vi.fn(async () => 'job-1'),
          start: vi.fn(async () => {
            events.push('queue:start');
            throw new Error('redis password=should-not-leak');
          }),
          close: vi.fn(async () => {
            events.push('queue:close');
          }),
        },
        prisma: {
          $disconnect: vi.fn(async () => {
            events.push('prisma:disconnect');
          }),
        },
        sourceTaskHandler: { handle: vi.fn(async () => null) },
      },
    });

    const unregisterShutdownHandlers = vi.fn();
    await expect(startWorkerRuntime(runtime, unregisterShutdownHandlers)).rejects.toThrow(
      'Worker failed to start',
    );
    expect(events).toEqual(['queue:start', 'queue:close', 'prisma:disconnect']);
    expect(unregisterShutdownHandlers).toHaveBeenCalledOnce();
  });

  it('creates the production dependency graph with configured connection values', async () => {
    const queue = {
      enqueue: vi.fn(async () => 'job-1'),
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const prisma = { $disconnect: vi.fn(async () => undefined) };
    const taskRuns = { name: 'task-runs' };
    const sourceLookup = { name: 'source-lookup' };
    const processor = { name: 'processor' };
    const sourceTaskHandler = { handle: vi.fn(async () => null) };
    const createQueue = vi.fn(() => queue);
    const createPrisma = vi.fn(() => prisma);
    const createTaskRuns = vi.fn(() => taskRuns);
    const createSourceLookup = vi.fn(() => sourceLookup);
    const createProcessor = vi.fn(() => processor);
    const createSourceTaskHandler = vi.fn(() => sourceTaskHandler);

    const runtime = createProductionWorkerRuntime(
      {
        databaseUrl: 'postgresql://local.test/sourceflow',
        redisUrl: 'redis://:password@localhost:6379',
        concurrency: 4,
      },
      {
        createQueue,
        createPrisma,
        createTaskRuns,
        createSourceLookup,
        createProcessor,
        createSourceTaskHandler,
      },
    );

    await runtime.start();

    expect(createPrisma).toHaveBeenCalledWith('postgresql://local.test/sourceflow');
    expect(createQueue).toHaveBeenCalledWith({
      redisUrl: 'redis://:password@localhost:6379',
      concurrency: 4,
    });
    expect(createTaskRuns).toHaveBeenCalledWith(prisma);
    expect(createSourceLookup).toHaveBeenCalledWith(prisma);
    expect(createSourceTaskHandler).toHaveBeenCalledWith(taskRuns, sourceLookup, processor);
  });

  it('registers SIGTERM and SIGINT once and routes both through runtime close', async () => {
    const runtime = {
      start: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const handlers = new Map<string, () => void>();
    const signalProcess = {
      once: vi.fn((signal: string, handler: () => void) => {
        handlers.set(signal, handler);
      }),
      removeListener: vi.fn((signal: string) => {
        handlers.delete(signal);
      }),
    };

    const unregister = registerWorkerShutdownHandlers(runtime, signalProcess);
    registerWorkerShutdownHandlers(runtime, signalProcess);
    handlers.get('SIGTERM')?.();
    handlers.get('SIGINT')?.();
    await Promise.resolve();

    expect(signalProcess.once).toHaveBeenCalledTimes(2);
    expect(runtime.close).toHaveBeenCalledTimes(2);
    unregister();
    expect(signalProcess.removeListener).toHaveBeenCalledTimes(2);
    expect(handlers.size).toBe(0);
  });
});
