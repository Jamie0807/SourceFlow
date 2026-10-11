## T011 Task 4：上传完成、BullMQ Publisher 与业务 process 幂等

### 已批准设计与依赖

- 依据 `docs/superpowers/specs/2026-10-08-t011-source-api-design.md`、`docs/superpowers/plans/2026-10-08-t011-source-api.md` 与 T011 Task 4 计划条目。
- Task 1 状态机、Task 2 StoragePort、Task 3 Source API/权限边界已实现并经独立审查 Ready。
- Worktree `/Users/jamie/.codex/worktrees/t011-source-api/SourceFlow`，分支 `feat/t011-source-api`。保留所有现有修改；不得提交、push、合并或删除 worktree。

### 目标范围

完成上传完成异步验证与单阶段业务处理：Source API 写入 TaskRun 后发布 BullMQ job；重复请求使用稳定 idempotency key/jobId；取消 Source 与活动 TaskRun。仅实现 API producer，不导入 Worker 应用代码、不改 Worker。

### 接口/数据流合同

- 新增 `SourceTaskPublisher.enqueue(message: SourceTaskMessage): Promise<string>` port 与 BullMQ 实现。队列名 `source-processing`，job name `source-task`，jobId 使用共享 domain `sourceTaskJobId(message)`，默认 `attempts: 3`。publisher 只创建 BullMQ Queue/Redis client，不创建 Worker；实现 Nest lifecycle close，避免资源泄漏。`REDIS_URL` 缺失时 fail closed，错误不包含连接串。
- TaskRun 的幂等键：校验 `source:<sourceId>:validate:v1`；业务任务 `source:<sourceId>:<taskType>:v1`。每次重发都复用同一 TaskRun ID/message/jobId；不同 workspace 必须隔离。
- `POST /sources/:sourceId/upload-complete`：owner/editor。仅当前 workspace 查 Source；若 uploading，HeadObject 核对对象存在、长度与声明一致、MIME 与声明一致；若 storage 返回 SHA-256，则必须匹配；缺失 checksum 时按已批准设计延迟 Worker 重算，不能用 ETag 替代。事务内 Source `uploading→validating` 并创建唯一 `source.validate` queued TaskRun，提交后 enqueue，返回 202、Source 与 taskRunId。重复调用须返回现有验证状态/TaskRun 并安全重发 enqueue；无对象、元数据不匹配、非法状态不得创建重复任务。
- `POST /sources/:sourceId/process`：owner/editor。只允许 Source 已 validated/uploaded 才创建业务 TaskRun：TXT→`source.analyze`，MP4/MP3/WAV→`source.transcribe`。事务内 `uploaded→queued` 并创建唯一 queued TaskRun，之后 enqueue，响应 202；在途重复请求复用同一任务/jobId；其他状态返回稳定冲突错误。
- 发布队列失败时不回滚/删除已持久化 TaskRun；保留 queued 状态，同一幂等请求可重发。错误响应不得泄露 Redis/BullMQ 原始错误。
- cancel：在 workspace-scoped Prisma transaction 中更新 Source 和 `queued|processing` 活动 TaskRun 为 cancelled，保留对象。重复取消幂等；竞态不得覆盖 Worker 已写入的 succeeded/failed/cancelled 终态。不会尝试删除 BullMQ job 或对象；worker 会依据持久化 TaskRun/Source 状态避开已取消任务。
- 所有 Source、TaskRun 查询/更新都带 workspaceId。不得把 request body/path 中的 workspaceId 当成可信租户值。

### 预期文件与依赖

- 新建 `apps/api/src/sources/source-task.publisher.ts`、`bullmq-source-task.publisher.ts` 与测试。
- 扩展 Sources repository/service/controller/module 及其测试，实现以上三个端点。
- 若需要 TaskRun repository/transaction helper，可新增 `apps/api/src/sources/*` 文件并加入 workspace 条件测试；优先最小接口，不复制 Worker 代码。
- API 直接依赖 `@sourceflow/domain`、`bullmq`、`ioredis` 时更新 `apps/api/package.json` 和 pnpm lockfile。复用已有 domain 消息工厂和 jobId，不复制编码算法。不要新增 Worker package import。
- 更新 Docker/compose env 示例只在 `REDIS_URL` 当前没有对应说明时进行；只写非密钥示例，不添加真实凭证。

### TDD 与验收

逐项先写失败测试并记录预期 RED，再实现 GREEN。至少覆盖：

1. Publisher queue/job 名、稳定 jobId、attempts=3、无 REDIS_URL 的安全错误、关闭/Redis 清理和重复 enqueue。
2. upload-complete：对象缺失、size/MIME/checksum mismatch、缺 checksum 延迟校验、成功 validating+TaskRun、重复调用复用 TaskRun、状态拒绝、跨租户 not-found、队列失败后幂等重试。
3. process：TXT/媒体任务映射、仅 uploaded 状态、成功 queued+TaskRun、重复/并发调用唯一任务、队列失败后重试、跨租户 not-found。
4. cancel：Source 与活动 TaskRun 同事务取消、重复取消幂等、跨租户拒绝、并发 Worker 终态不被覆盖、对象从不删除。

运行目标 Sources 与 publisher 测试、相关 Auth/tenant/domain 回归、根 TypeScript 检查、API build、改动 TS 的 ESLint/Prettier/CSpell、`git diff --check`、Docker Compose config。Redis/MinIO integration 仅在明确环境配置时执行；未运行必须列出，不可声称已兼容验证。对 Prisma transaction 并发和 BullMQ jobId 语义做自审。

### 非目标与交付

- 不实现 Worker validator/handler、媒体解析、真实 Provider 调用或新的数据库 migration；TaskRun 已有模型与 domain `source.validate` 已在 Task 1 提供。
- 不删除 Storage object、不撤销 presigned URL、不把队列错误细节返回客户端。
- 完成后写 `.superpowers/sdd/t011-task-4-report.md`，包括文件、RED/GREEN、验证命令、队列/数据库一致性设计、未执行 integration 与风险；先独立复审 Task 4，再进入 Task 5。
