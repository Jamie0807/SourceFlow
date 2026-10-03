# T009 Source Processing Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可测试的 BullMQ Source 处理 Worker，支持 `source.transcribe`、`source.analyze` 的幂等、状态持久化、重试、取消、失败映射和 workspace 隔离。

**Architecture:** 共享领域包提供任务消息与结果类型；Worker 通过 Queue Port 隔离 BullMQ/Redis，通过 TaskRun Store 隔离 Prisma，通过 SourceProcessor 隔离实际转录/分析 Provider。T009 使用确定性的 Mock Processor，T010 只替换 Processor，不改变队列和任务状态合同。

**Tech Stack:** TypeScript strict mode、Vitest、BullMQ 5、ioredis 5、Prisma Client 6.19、PostgreSQL、Redis、pnpm monorepo。

## Global Constraints

- 所有 workspace 资源访问必须服务端二次校验归属，不能只依赖前端隐藏按钮。
- 行为变化必须遵循“先失败测试、最小实现、回归测试、再重构”。
- Worker 查询 Source 和 TaskRun 时必须同时带 `workspaceId`；跨租户 taskId/sourceId 返回不存在。
- PostgreSQL `TaskRun` 是任务状态事实来源，Redis/BullMQ 只负责排队、重试和短期执行状态。
- 单元测试不得依赖 Redis；Redis smoke 只有在显式提供 `REDIS_URL` 时运行。
- 不实现 T011 Source HTTP API，不接入 T010 火山引擎 Provider，不新增 Prisma migration。
- 不保存 token、连接串、Provider secret 或原始堆栈到 `TaskRun.errorMessage`。
- 不自动执行 Git commit、push、合并或删除 Worktree；若用户明确要求提交，使用 `pnpm commit`。

---

## 文件结构

- Create: `packages/domain/src/source-task.ts`：Source 任务类型、payload、结果、失败码和 JobId 构造。
- Modify: `packages/domain/src/index.ts`：导出共享 Source 任务合同。
- Test: `packages/domain/src/source-task.test.ts`：共享合同和错误映射测试。
- Modify: `apps/worker/package.json`：增加 `bullmq`、`ioredis`、`@prisma/client` 运行依赖。
- Create: `apps/worker/src/queue/source-task-queue.ts`：Queue Port 和处理器上下文。
- Create: `apps/worker/src/queue/bullmq-source-task.queue.ts`：BullMQ/Redis 适配器。
- Test: `apps/worker/src/queue/source-task-queue.test.ts`：Fake Queue 合同测试。
- Test: `apps/worker/src/queue/bullmq-source-task.queue.test.ts`：BullMQ 适配器的构造、JobId、重试和关闭测试。
- Test: `apps/worker/src/queue/bullmq-source-task.queue.integration.test.ts`：显式 Redis smoke。
- Create: `packages/test-utils/src/fake-source-task.queue.ts`：供 Worker 单元测试使用的 Fake Queue。
- Create: `packages/test-utils/src/fake-source-task.queue.test.ts`：Fake Queue 行为测试。
- Create: `apps/worker/src/task-runs/task-run.store.ts`：TaskRun Store 接口、记录类型和状态操作合同。
- Create: `apps/worker/src/task-runs/prisma-task-run.store.ts`：Prisma TaskRun 持久化实现。
- Test: `apps/worker/src/task-runs/prisma-task-run.store.test.ts`：幂等、原子状态更新和 workspace 条件测试。
- Create: `apps/worker/src/source-processing/source-processor.ts`：Processor Port、Mock Processor 和失败类型转换。
- Create: `apps/worker/src/source-processing/source-task.handler.ts`：Source 任务编排 Handler。
- Create: `apps/worker/src/source-processing/prisma-source.lookup.ts`：带 workspace 条件的 Source 查询。
- Test: `apps/worker/src/source-processing/source-task.handler.test.ts`：成功、失败、重试、取消、重复 Job 和跨租户测试。
- Test: `apps/worker/src/source-processing/prisma-source.lookup.test.ts`：Source 查询归属条件测试。
- Modify: `apps/worker/src/main.ts`：组装 Prisma、BullMQ、TaskRun Store、Source Lookup、Mock Processor 和优雅关闭。
- Test: `apps/worker/src/main.test.ts`：环境配置和生命周期 wiring 测试。
- Modify: `Docker/compose/.env.example`：补充 `WORKER_CONCURRENCY` 默认值说明。
- Modify: `specs/content-batch-pipeline/tasks.md`：更新 T009 勾选状态和验收记录。
- Modify: `.superpowers/sdd/progress.md`：记录 T009 任务进度和验证结果。

## Task 1: 建立共享 Source 任务合同

**Files:**

- Create: `packages/domain/src/source-task.ts`
- Test: `packages/domain/src/source-task.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Produces: `SourceTaskType`、`SourceTaskMessage`、`SourceTaskResult`、`TaskFailure`、`sourceTaskJobId`。
- Consumes: 现有 Source 状态语义和 TypeScript strict 配置。

- [ ] **Step 1: Write the failing test**

先创建测试，要求共享合同支持两类任务、JobId 隔离和失败可重试标记：

```ts
import { describe, expect, it } from 'vitest';

import { sourceTaskJobId, type SourceTaskMessage, type TaskFailure } from './source-task.js';

describe('Source task contract', () => {
  it('builds a tenant-isolated job id from workspace and task ids', () => {
    const message: SourceTaskMessage = {
      taskRunId: 'task-1',
      workspaceId: 'workspace-a',
      sourceId: 'source-1',
      taskType: 'source.transcribe',
      inputVersion: 1,
    };

    expect(sourceTaskJobId(message)).toBe('workspace-a:task-1');
    expect(sourceTaskJobId({ ...message, workspaceId: 'workspace-b' })).toBe('workspace-b:task-1');
  });

  it('keeps failure retry behavior explicit and serializable', () => {
    const failure: TaskFailure = {
      code: 'PROCESSOR_TEMPORARY_FAILURE',
      message: '处理服务暂时不可用',
      retryable: true,
    };

    expect(JSON.parse(JSON.stringify(failure))).toEqual(failure);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm exec vitest run packages/domain/src/source-task.test.ts --config vitest.config.ts --coverage=false
```

Expected: FAIL because `source-task.ts` and its exports do not exist.

- [ ] **Step 3: Write the minimal implementation**

实现以下合同并从 `packages/domain/src/index.ts` 导出：

```ts
export const SOURCE_TASK_TYPES = ['source.transcribe', 'source.analyze'] as const;
export type SourceTaskType = (typeof SOURCE_TASK_TYPES)[number];

export type SourceTaskMessage = Readonly<{
  taskRunId: string;
  workspaceId: string;
  sourceId: string;
  taskType: SourceTaskType;
  inputVersion: number;
}>;

export type SourceTaskResult = Readonly<{
  taskType: SourceTaskType;
  output: Record<string, unknown>;
}>;

export type TaskFailureCode =
  | 'SOURCE_NOT_FOUND'
  | 'TASK_CANCELLED'
  | 'PROCESSOR_INVALID_INPUT'
  | 'PROCESSOR_TEMPORARY_FAILURE'
  | 'PROCESSOR_UNKNOWN_FAILURE';

export type TaskFailure = Readonly<{
  code: TaskFailureCode;
  message: string;
  retryable: boolean;
}>;

export function sourceTaskJobId(message: Pick<SourceTaskMessage, 'workspaceId' | 'taskRunId'>) {
  return `${message.workspaceId}:${message.taskRunId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
corepack pnpm exec vitest run packages/domain/src/source-task.test.ts --config vitest.config.ts --coverage=false
```

Expected: 2 tests passed。

- [ ] **Step 5: Run existing domain regression tests**

```bash
corepack pnpm --filter @sourceflow/domain test:unit -- --run --coverage=false
```

Expected: existing domain tests and新合同测试全部通过。

## Task 2: 实现 Queue Port、Fake Queue 和 BullMQ Adapter

**Files:**

- Modify: `apps/worker/package.json`
- Create: `apps/worker/src/queue/source-task-queue.ts`
- Create: `apps/worker/src/queue/bullmq-source-task.queue.ts`
- Test: `apps/worker/src/queue/source-task-queue.test.ts`
- Test: `apps/worker/src/queue/bullmq-source-task.queue.test.ts`
- Test: `apps/worker/src/queue/bullmq-source-task.queue.integration.test.ts`
- Create: `packages/test-utils/src/fake-source-task.queue.ts`
- Test: `packages/test-utils/src/fake-source-task.queue.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `SourceTaskMessage`、`sourceTaskJobId`。
- Produces: `SourceTaskQueue`、`SourceTaskJobHandler`、Fake Queue 和 BullMQ Queue/Worker 实现。

- [ ] **Step 1: Write the failing Queue Port tests**

先定义测试期望的最小接口：

```ts
const message = {
  taskRunId: 'task-1',
  workspaceId: 'workspace-a',
  sourceId: 'source-1',
  taskType: 'source.transcribe',
  inputVersion: 1,
} as const;

it('records an enqueued message and delivers it to a handler', async () => {
  const queue = new FakeSourceTaskQueue();
  const handled: string[] = [];
  await queue.start(async (received) => {
    handled.push(received.taskRunId);
  });

  await queue.enqueue(message, { attempts: 3 });
  await queue.drain();

  expect(handled).toEqual(['task-1']);
  expect(queue.enqueued).toHaveLength(1);
});

it('keeps the same task idempotent and different workspaces isolated', async () => {
  const queue = new FakeSourceTaskQueue();
  await queue.enqueue(message);
  await queue.enqueue(message);
  await queue.enqueue({ ...message, workspaceId: 'workspace-b' });

  expect(queue.enqueued.map((item) => item.jobId)).toEqual([
    'workspace-a:task-1',
    'workspace-b:task-1',
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
corepack pnpm exec vitest run \
  packages/test-utils/src/fake-source-task.queue.test.ts \
  apps/worker/src/queue/source-task-queue.test.ts \
  --config vitest.config.ts --coverage=false
```

Expected: FAIL because the Queue Port and Fake Queue do not exist.

- [ ] **Step 3: Add BullMQ dependencies and implement the Port/Fake Queue**

```bash
corepack pnpm --filter @sourceflow/worker add bullmq@^5 ioredis@^5 @prisma/client@6.19.0
```

实现接口：

```ts
export type SourceTaskJobContext = Readonly<{
  attemptsMade: number;
  maxAttempts: number;
}>;

export type SourceTaskJobHandler = (
  message: SourceTaskMessage,
  context: SourceTaskJobContext,
) => Promise<void>;

export interface SourceTaskQueue {
  enqueue(message: SourceTaskMessage, options?: { attempts?: number }): Promise<string>;
  start(handler: SourceTaskJobHandler): Promise<void>;
  close(): Promise<void>;
}
```

Fake Queue 使用 `sourceTaskJobId` 去重、记录 `enqueued`、支持 `drain()` 手动消费和 `close()` 状态。重复 Job 不得再次进入消息列表。

- [ ] **Step 4: Implement and test the BullMQ adapter**

`BullMQSourceTaskQueue` 使用 BullMQ `Queue` 与 `Worker`，Queue name 固定为 `source-processing`；JobId 使用 `sourceTaskJobId(message)`；默认 `attempts` 为 3。Redis 连接通过 `ioredis` 从 `REDIS_URL` 创建，并在 close 时关闭 Queue、Worker 和 Redis 连接。Worker handler 的异常必须重新抛出，让 BullMQ 执行重试。

测试通过依赖注入的 Queue/Worker 构造器验证：JobId、attempts、handler 转发和 close；不得在单元测试连接真实 Redis。

- [ ] **Step 5: Add the explicit Redis smoke test**

`bullmq-source-task.queue.integration.test.ts` 使用 `describe.skipIf(!process.env.REDIS_URL)`；当 Redis 可用时创建真实 Queue/Worker，入队一个消息并等待 handler 收到，最后关闭资源。运行命令：

```bash
set -a
source .env
set +a
corepack pnpm exec vitest run apps/worker/src/queue/bullmq-source-task.queue.integration.test.ts --config vitest.config.ts --coverage=false
```

没有 `REDIS_URL` 时必须显示 skipped，不得伪装成 smoke 通过。

## Task 3: 实现 TaskRun Store 和 workspace 隔离

**Files:**

- Create: `apps/worker/src/task-runs/task-run.store.ts`
- Create: `apps/worker/src/task-runs/prisma-task-run.store.ts`
- Test: `apps/worker/src/task-runs/prisma-task-run.store.test.ts`

**Interfaces:**

- Consumes: Task 1 的 Source task type 和 Prisma 已有 `TaskRun`/`TaskRunStatus`。
- Produces: `TaskRunRecord`、`TaskRunStore`，供 Task 4 Handler 使用。

- [ ] **Step 1: Write failing Store tests**

至少先写以下行为测试：

```ts
it('creates one task per workspace and idempotency key', async () => {
  const first = await store.createOrGetQueued(input);
  const second = await store.createOrGetQueued(input);

  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(second.record.id).toBe(first.record.id);
});

it('does not claim or find a task from another workspace', async () => {
  await expect(store.findById('workspace-b', 'task-a')).resolves.toBeNull();
  await expect(store.claimProcessing('workspace-b', 'task-a')).resolves.toBeNull();
});

it('allows only queued to become processing and records attempts', async () => {
  const claimed = await store.claimProcessing('workspace-a', 'task-a');
  const duplicate = await store.claimProcessing('workspace-a', 'task-a');

  expect(claimed?.status).toBe('processing');
  expect(claimed?.attempt).toBe(1);
  expect(duplicate).toBeNull();
});
```

- [ ] **Step 2: Run Store tests to verify they fail**

```bash
corepack pnpm exec vitest run apps/worker/src/task-runs/prisma-task-run.store.test.ts --config vitest.config.ts --coverage=false
```

Expected: FAIL because the Store interface and implementation do not exist.

- [ ] **Step 3: Implement the Store interface and Prisma adapter**

`TaskRunStore` 必须包含以下签名：

```ts
export type TaskRunRecord = Readonly<{
  id: string;
  workspaceId: string;
  taskType: SourceTaskType;
  idempotencyKey: string;
  status: 'queued' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  attempt: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
}>;

export interface TaskRunStore {
  createOrGetQueued(input: {
    workspaceId: string;
    taskType: SourceTaskType;
    idempotencyKey: string;
    payload: SourceTaskMessage;
  }): Promise<{ record: TaskRunRecord; created: boolean }>;
  claimProcessing(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null>;
  requeue(workspaceId: string, taskRunId: string): Promise<void>;
  markSucceeded(workspaceId: string, taskRunId: string, result: SourceTaskResult): Promise<void>;
  markFailed(workspaceId: string, taskRunId: string, failure: TaskFailure): Promise<void>;
  cancel(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null>;
  findById(workspaceId: string, taskRunId: string): Promise<TaskRunRecord | null>;
}
```

Prisma 实现必须：

- 使用 `workspaceId_idempotencyKey` 唯一键处理并发幂等创建。
- `claimProcessing` 使用 `updateMany` 条件 `id + workspaceId + status=queued` 原子抢占，并递增 attempt。
- succeeded/failed/cancelled 只能从允许的非终态更新。
- 每个 `findUnique`、`findFirst`、`updateMany` 都包含 workspaceId，不能只按 taskRunId。
- 将 Prisma `JsonValue` 映射为安全的 `Record<string, unknown>`，错误信息只保存稳定错误文本。

- [ ] **Step 4: Run Store tests to verify they pass**

```bash
corepack pnpm exec vitest run apps/worker/src/task-runs/prisma-task-run.store.test.ts --config vitest.config.ts --coverage=false
```

Expected: Store tests全部通过，包括幂等、attempt、终态和 workspace 条件断言。

## Task 4: 实现 Source Processor 和任务 Handler

**Files:**

- Create: `apps/worker/src/source-processing/source-processor.ts`
- Create: `apps/worker/src/source-processing/prisma-source.lookup.ts`
- Create: `apps/worker/src/source-processing/source-task.handler.ts`
- Test: `apps/worker/src/source-processing/prisma-source.lookup.test.ts`
- Test: `apps/worker/src/source-processing/source-task.handler.test.ts`

**Interfaces:**

- Consumes: Task 1 的消息/结果/失败类型、Task 2 的 `SourceTaskJobHandler`、Task 3 的 `TaskRunStore`。
- Produces: `SourceProcessor`、`SourceLookup`、`SourceTaskHandler`，供 Worker main 组装。

- [ ] **Step 1: Write failing Handler tests**

测试必须先覆盖：

```ts
it('processes transcribe and analyze messages and persists success', async () => {
  const transcribe = await handler.handle(transcribeMessage, { attemptsMade: 0, maxAttempts: 3 });
  const analyze = await handler.handle(analyzeMessage, { attemptsMade: 0, maxAttempts: 3 });

  expect(transcribe.status).toBe('succeeded');
  expect(analyze.status).toBe('succeeded');
  expect(processor.transcribed).toEqual(['source-1']);
  expect(processor.analyzed).toEqual(['source-1']);
});

it('does not read a Source from another workspace', async () => {
  await expect(
    handler.handle({ ...transcribeMessage, workspaceId: 'workspace-b' }, context),
  ).resolves.toMatchObject({ status: 'failed', errorCode: 'SOURCE_NOT_FOUND' });
  expect(processor.transcribed).toEqual([]);
});

it('requeues retryable failures and finally records failure', async () => {
  processor.failWith({
    code: 'PROCESSOR_TEMPORARY_FAILURE',
    message: '处理服务暂时不可用',
    retryable: true,
  });

  await expect(handler.handle(message, { attemptsMade: 0, maxAttempts: 3 })).rejects.toThrow();
  expect(store.requeued).toBe(1);

  await expect(handler.handle(message, { attemptsMade: 2, maxAttempts: 3 })).resolves.toMatchObject(
    {
      status: 'failed',
      errorCode: 'PROCESSOR_TEMPORARY_FAILURE',
    },
  );
});

it('does not process a cancelled or terminal task', async () => {
  store.setStatus('cancelled');
  await expect(handler.handle(message, context)).resolves.toMatchObject({ status: 'cancelled' });
  expect(processor.transcribed).toEqual([]);
});
```

- [ ] **Step 2: Run Handler tests to verify they fail**

```bash
corepack pnpm exec vitest run \
  apps/worker/src/source-processing/source-task.handler.test.ts \
  apps/worker/src/source-processing/prisma-source.lookup.test.ts \
  --config vitest.config.ts --coverage=false
```

Expected: FAIL because SourceProcessor, SourceLookup and Handler do not exist.

- [ ] **Step 3: Implement SourceLookup and Processor Port**

`PrismaSourceLookup.findById(workspaceId, sourceId)` 使用：

```ts
this.prisma.source.findFirst({
  where: { id: sourceId, workspaceId, deletedAt: null },
  select: { id: true, workspaceId: true, status: true, storageKey: true, contentHash: true },
});
```

`SourceProcessor` 定义：

```ts
export interface SourceProcessor {
  transcribe(source: SourceRecord): Promise<SourceTaskResult>;
  analyze(source: SourceRecord): Promise<SourceTaskResult>;
}
```

Mock Processor 返回稳定 JSON；未知异常转换为 `PROCESSOR_UNKNOWN_FAILURE`，显式 `TaskFailure` 原样保留。

- [ ] **Step 4: Implement Handler status and retry flow**

Handler 按以下顺序执行：

1. `claimProcessing(workspaceId, taskRunId)`；返回 null 时读取当前 TaskRun，终态或已处理任务直接返回。
2. `findById(workspaceId, sourceId)`；null 写 `SOURCE_NOT_FOUND` 并结束。
3. 再次读取 TaskRun，发现 cancelled 则不调用 Processor。
4. 根据 taskType 调用 `transcribe` 或 `analyze`。
5. 成功前再次确认 TaskRun 仍为 processing，再写 succeeded。
6. 可重试失败且尚未达到 `maxAttempts` 时 `requeue` 并抛出错误给 BullMQ；最终失败或不可重试失败写 failed。

错误信息必须脱敏，Handler 不把 payload、连接串或原始异常堆栈写入 TaskRun。

- [ ] **Step 5: Run Handler tests to verify they pass**

```bash
corepack pnpm exec vitest run \
  apps/worker/src/source-processing/source-task.handler.test.ts \
  apps/worker/src/source-processing/prisma-source.lookup.test.ts \
  --config vitest.config.ts --coverage=false
```

Expected: Handler 和 SourceLookup tests全部通过，包含跨 workspace 与取消竞态。

## Task 5: 组装 Worker、更新规格追踪并完成验收

**Files:**

- Modify: `apps/worker/src/main.ts`
- Test: `apps/worker/src/main.test.ts`
- Modify: `Docker/compose/.env.example`
- Modify: `specs/content-batch-pipeline/tasks.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**

- Consumes: Task 2 Queue、Task 3 TaskRunStore、Task 4 SourceLookup/Processor/Handler。
- Produces: 可启动、可关闭、可配置并能消费 Source 任务的 Worker runtime。

- [ ] **Step 1: Write the failing lifecycle test**

测试 `createWorkerRuntime`：

```ts
it('creates a worker runtime with configured concurrency and closes all resources', async () => {
  const runtime = createWorkerRuntime({
    databaseUrl: 'postgresql://local.test/sourceflow',
    redisUrl: 'redis://:password@localhost:6379',
    concurrency: 2,
    dependencies: testDependencies,
  });

  await runtime.start();
  await runtime.close();

  expect(testDependencies.queue.started).toBe(true);
  expect(testDependencies.queue.closed).toBe(true);
  expect(testDependencies.prisma.disconnected).toBe(true);
});
```

- [ ] **Step 2: Run lifecycle test to verify it fails**

```bash
corepack pnpm exec vitest run apps/worker/src/main.test.ts --config vitest.config.ts --coverage=false
```

Expected: FAIL because `createWorkerRuntime` does not exist and main currently only prints a log.

- [ ] **Step 3: Implement runtime wiring and configuration**

将 `main.ts` 重构为可测试的 `createWorkerRuntime`，默认读取：

```ts
const redisUrl = process.env.REDIS_URL;
const databaseUrl = process.env.DATABASE_URL;
const concurrency = Number.parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);
```

缺少 `REDIS_URL` 或 `DATABASE_URL` 时启动前抛出稳定配置错误；`WORKER_CONCURRENCY` 非正整数时使用 2 并记录脱敏警告。生产 runtime 组装 PrismaClient、BullMQSourceTaskQueue、PrismaTaskRunStore、PrismaSourceLookup、MockSourceProcessor 和 SourceTaskHandler。SIGTERM/SIGINT 调用 `close()`，保证先停消费再释放 Queue/Redis/Prisma。

在 `Docker/compose/.env.example` 增加：

```dotenv
WORKER_CONCURRENCY=2
```

- [ ] **Step 4: Run lifecycle and worker regression tests**

```bash
corepack pnpm exec vitest run \
  apps/worker/src/main.test.ts \
  apps/worker/src/queue \
  apps/worker/src/task-runs \
  apps/worker/src/source-processing \
  --config vitest.config.ts --coverage=false
```

Expected: 所有 Worker focused tests通过。

- [ ] **Step 5: Update T009 traceability**

在 `specs/content-batch-pipeline/tasks.md` 勾选 T009 四项，并记录：默认 Fake Queue 单元测试、显式 Redis smoke、TaskRun workspace 隔离、T010 Provider 尚未接入。`.superpowers/sdd/progress.md` 记录每个任务的红绿测试和质量验证，不把没有 Redis 的 skipped smoke 写成通过。

- [ ] **Step 6: Run full verification**

```bash
corepack pnpm lint
corepack pnpm format:check
corepack pnpm spellcheck
corepack pnpm typecheck
corepack pnpm test:unit -- --run
corepack pnpm test:component -- --run
corepack pnpm test:integration -- --grep @smoke
corepack pnpm build:web
corepack pnpm build:api
corepack pnpm build:worker
docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config
git diff --check
```

如果本地 `.env` 提供了有效 `DATABASE_URL` 和 `REDIS_URL`，另外执行：

```bash
set -a
source .env
set +a
corepack pnpm test:unit -- --run
corepack pnpm exec vitest run apps/worker/src/queue/bullmq-source-task.queue.integration.test.ts --config vitest.config.ts --coverage=false
```

Expected: 代码、类型、构建和默认测试通过；真实 Redis smoke 在有服务时通过，否则明确记录 skipped。全仓覆盖率若仍低于项目门槛，必须记录实际数值，不得调阈值或扩大快照掩盖。

- [ ] **Step 7: Review final diff**

```bash
git status --short
git diff --stat
git diff -- apps/worker packages/domain/src/source-task.ts packages/test-utils Docker/compose/.env.example specs/content-batch-pipeline/tasks.md .superpowers/sdd/progress.md
```

Expected: 只包含 T009 Queue、TaskRun、Source Handler、测试、依赖和追踪文档；不包含 T010 Provider、T011 HTTP API、数据库 migration 或真实凭据。
