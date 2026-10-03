# T009 BullMQ 队列与 Source 处理 Worker 设计

日期：2026-09-30

状态：设计已确认，待书面评审

## 背景

T004 已创建 `TaskRun`、`Source` 及其状态模型，T005 已提供 Source 状态机，T007 已建立 workspace 租户边界，T008 已提供带 workspace/source 隔离的 Storage Adapter。当前 Worker 只有启动日志，没有队列、任务持久化或 Source 处理逻辑。

T009 是 T010 Provider 和 T011 Source API 的共同前置。本次实现任务编排和状态可靠性，不提前接入火山引擎；真实 Provider 通过注入接口在 T010 接入。

## 目标与非目标

### 目标

- 使用 BullMQ + Redis 作为生产队列实现，并提供可注入的 Queue Port。
- 为 `source.transcribe` 和 `source.analyze` 建立统一任务消息、Handler 和状态持久化流程。
- 以 PostgreSQL `TaskRun` 作为任务状态事实来源，支持 queued、processing、succeeded、failed、cancelled。
- 使用 `(workspaceId, idempotencyKey)` 防止同一工作区重复创建任务。
- 支持有限重试、失败错误映射、取消和 task id 恢复查询。
- Worker 查询 Source 和 TaskRun 时始终带 workspaceId，防止任务 payload 跨租户读取资源。
- 单元测试默认使用 Fake Queue，不依赖 Redis；另提供显式开启的本地 Redis smoke。

### 非目标

- 不实现 T011 的 Source HTTP API、上传完成接口或请求鉴权。
- 不接入真实火山引擎、AI 模型、转录或分析 Provider；T009 使用确定性的 Mock Processor。
- 不新增 Prisma migration；复用 T004 已有 `TaskRun` 表和 `TaskRunStatus` 枚举。
- 不把 BullMQ Job 删除作为取消的唯一依据；数据库 TaskRun 状态优先。
- 不实现 Web 页面任务进度展示；T017/T018 通过后续 API 和组件任务接入。

## 方案比较

### 方案 A：Handler 直接依赖 BullMQ 和 Prisma

Worker Handler 直接创建 BullMQ Worker、读取 Prisma 并执行任务。

优点是初始代码较少；缺点是队列基础设施、任务状态和业务处理耦合，单元测试需要 Redis/数据库，T011 API 将无法复用稳定的入队合同。

### 方案 B：Queue Port + BullMQ Adapter + TaskRun Store（采用）

共享任务类型定义消息合同，Worker 内部分离 Queue Port、BullMQ Adapter、TaskRun Store、Source Handler 和 Processor Port。生产使用 BullMQ/Redis，单元测试使用 Fake Queue 和 Fake Store，T010 通过 Processor Port 替换 Mock Processor。

优点是状态和队列行为可独立测试，API/Worker 后续可以复用消息合同；缺点是文件和接口数量略多，需要明确幂等、取消和重试的边界。

### 方案 C：PostgreSQL 轮询 TaskRun，不使用 BullMQ

Worker 定时扫描 queued TaskRun 并抢占执行。

该方案可以减少 Redis 依赖，但不满足 T009 的 BullMQ 目标，重试、延迟、并发控制和运维观测也需要重复实现，不采用。

## 架构设计

### 共享任务合同

在 `packages/domain/src/source-task.ts` 定义：

- `SourceTaskType = 'source.transcribe' | 'source.analyze'`。
- `SourceTaskPayload`：`taskRunId`、`workspaceId`、`sourceId`、`taskType` 和受约束的输入版本信息。
- `SourceTaskResult`：任务类型对应的转录或分析结果 JSON。
- `TaskFailure`：稳定的 `code`、用户安全的 `message` 和 `retryable` 标记。

Payload 中的 `workspaceId` 来自服务端租户上下文；Worker 不信任 payload 中的资源归属，而是将它同时用于 Source/TaskRun 的查询条件。

### Queue Port

`apps/worker/src/queue/source-task-queue.ts` 定义最小接口：

- `enqueue(message, options)` 返回 Job 标识。
- `start(handler)` 注册消费处理器。
- `close()` 释放 Worker、Queue 和 Redis 连接。

`apps/worker/src/queue/bullmq-source-task.queue.ts` 实现 BullMQ 适配。Queue name 固定为 `source-processing`；JobId 由 `workspaceId` 与 `taskRunId` 组成，避免不同租户之间发生碰撞。BullMQ attempts 只负责触发重试，最终状态仍由 Handler 写入 TaskRun。

`packages/test-utils/src/fake-source-task.queue.ts` 提供可观察的 Fake Queue，支持把消息交给测试 Handler、记录入队次数和手动触发关闭。

### TaskRun Store

`apps/worker/src/task-runs/task-run.store.ts` 定义存储接口：

- `createOrGetQueued(input)`：按 workspaceId/idempotencyKey 返回已存在或新建的 TaskRun。
- `claimProcessing(workspaceId, taskRunId)`：只允许 queued 状态原子转换为 processing，并递增 attempt。
- `markSucceeded(workspaceId, taskRunId, result)`。
- `markFailed(workspaceId, taskRunId, failure)`。
- `cancel(workspaceId, taskRunId)`：只允许 queued/processing 转为 cancelled。
- `findById(workspaceId, taskRunId)`。

Prisma 实现位于 `apps/worker/src/task-runs/prisma-task-run.store.ts`。每个查询都同时带 `workspaceId`；跨 workspace 的 taskId 返回 null。状态更新使用条件更新，避免重复 Job 或并发重试覆盖终态。

### Source Handler 与 Processor Port

`apps/worker/src/source-processing/source-task.handler.ts` 负责：

1. 根据 TaskRun Store 抢占 processing；抢占失败时视为重复 Job，直接返回当前结果。
2. 使用 `workspaceId + sourceId` 查询 Source，找不到时写入稳定的 `SOURCE_NOT_FOUND`、不可重试失败。
3. 根据 taskType 调用 `SourceProcessor`。
4. 成功写入 result 和 succeeded；可重试异常交给队列重试，最终尝试写入 failed。
5. 在执行前检查 cancelled；取消后的任务不得再次调用 Processor。

`apps/worker/src/source-processing/source.processor.ts` 定义 `transcribe` 与 `analyze`。T009 的 `MockSourceProcessor` 只返回确定性的结构化结果，用于证明任务编排和状态恢复；T010 替换该实现，不改变 Queue/TaskRun 合同。

### Worker 启动

`apps/worker/src/main.ts` 从环境变量读取 `REDIS_URL`、`DATABASE_URL` 和最大并发配置，创建 Prisma Client、BullMQ Adapter、TaskRun Store、Mock Processor 和 Handler，并启动消费。启动与关闭必须可重复执行：收到 SIGTERM/SIGINT 时先停止接收新任务，再等待当前 Handler 结束并释放连接。

## 状态、幂等、重试与取消

### 状态流

```text
queued ──claim──> processing ──success──> succeeded
   │                  │
   │                  ├──retryable failure──> queued
   │                  └──final failure───────> failed
   └──cancel────────────────────────────────> cancelled
processing ──cancel──> cancelled
```

`succeeded`、`failed`、`cancelled` 是终态；重复 Job 不得重新执行终态 TaskRun。

### 幂等

`createOrGetQueued` 先按 `(workspaceId, idempotencyKey)` 查询，再依赖数据库唯一约束处理并发创建。已存在任务直接返回其记录；只有新建任务才入队。不同 workspace 使用同一个 idempotencyKey 时必须创建两个独立 TaskRun。

### 重试

默认最多 3 次尝试。可重试错误保持 queued 并由 BullMQ 重新投递；达到上限后写入 failed。不可重试错误立即写入 failed。TaskRun 的 attempt 从数据库条件更新中递增，不能只依赖 BullMQ 内存 attempt。

### 取消

取消以 TaskRun 条件更新为准。queued 任务取消后不应执行；processing 任务在 Handler 的下一次取消检查后停止继续写成功结果；终态任务取消返回当前终态，不回退状态。删除 BullMQ Job 仅作为优化，不作为安全或一致性保证。

## 错误处理

错误写入 `TaskRun.errorCode` 和脱敏的 `errorMessage`，不得保存 token、数据库连接串、Provider secret 或原始异常堆栈。T009 至少定义：

- `SOURCE_NOT_FOUND`：不可重试。
- `TASK_CANCELLED`：终态取消，不重新投递。
- `PROCESSOR_INVALID_INPUT`：不可重试。
- `PROCESSOR_TEMPORARY_FAILURE`：可重试。
- `PROCESSOR_UNKNOWN_FAILURE`：最多按默认策略重试，最终失败。

## 测试策略

先写失败测试，再实现最小代码：

- `packages/domain/src/source-task.test.ts`：任务类型、payload 和失败映射的合同。
- `apps/worker/src/queue/source-task-queue.test.ts`：Fake Queue 入队、消费、关闭和 JobId 隔离。
- `apps/worker/src/task-runs/task-run.store.test.ts`：幂等、原子 claim、状态终态、取消和 workspace 隔离。
- `apps/worker/src/source-processing/source-task.handler.test.ts`：transcribe/analyze、成功、重试、最终失败、取消、重复 Job 和 Source 跨 workspace 不存在。
- `apps/worker/src/queue/bullmq-source-task.queue.integration.test.ts`：仅在 `REDIS_URL` 存在时运行本地 Redis smoke；默认单元测试不依赖 Redis。
- `packages/test-utils/src/fake-source-task.queue.test.ts`：Fake Queue 行为合同。

验收必须证明：

1. 同 workspace 同幂等键只产生一个 TaskRun 和一个 Job。
2. 不同 workspace 可以使用同一幂等键且互不影响。
3. Source 和 TaskRun 查询都带 workspaceId，跨租户 payload 不会读取数据。
4. 任务在重试、取消、最终失败和成功状态下都可通过 taskId 恢复。
5. Worker 关闭会释放 BullMQ/Redis/Prisma 资源。

## 兼容性与后续接入

- T011 Source API 创建 TaskRun 后调用 Queue Port；API 不直接依赖 BullMQ 实现细节。
- T010 Provider 只实现 `SourceProcessor`，不改变任务状态机和 Queue Port。
- 不修改现有 Prisma schema 或 migration；如果后续需要新的重试字段，另行走向后兼容迁移设计。
- 所有后续资源查询继续遵循 T007 的 workspace 归属校验要求。
