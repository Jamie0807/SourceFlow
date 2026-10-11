# T011 Task 4 执行与自审报告

<!-- cspell:ignore worktrees -->

日期：2026-10-08

Worktree：`/Users/jamie/.codex/worktrees/t011-source-api/SourceFlow`

分支：`feat/t011-source-api`

关联 feature：`content-batch-pipeline`

## 状态与范围

Task 4 的 API 实现、测试和主代理自审已完成。只实现 API producer；未修改 Worker 行为、数据库 schema 或 migration。既有 Task 1–3 修改和审查记录均保留；未 commit、push、合并或删除 worktree。

## 变更

- 新增 `SourceTaskPublisher` port 与 BullMQ producer：使用 `source-processing` 队列、`source-task` job、domain `sourceTaskJobId` 和默认 3 次尝试；缺少 `REDIS_URL` 时 fail closed；模块销毁时关闭 Queue 和 Redis；producer 不创建 Worker。
- 新增 `POST /sources/:sourceId/upload-complete` 与 `POST /sources/:sourceId/process`，owner/editor 可用，均返回 HTTP 202、Source 当前状态和 TaskRun ID。
- upload-complete 以 workspace-scoped Head 核对对象长度、MIME 和可用的 SHA-256；对象缺失/元数据不符时不建任务。存储未返回 checksum 时接受入队，留给 Worker 校验。
- process 仅从 `uploaded` 建任务：TXT 对应 `source.analyze`，MP4/MP3/WAV 对应 `source.transcribe`。重发使用同一 workspace-scoped TaskRun 幂等键与任务消息。
- Prisma repository 在同一个事务中条件更新 Source 并创建 queued TaskRun；唯一键冲突/并发重发读取并复用现有任务。事务提交后才发布；发布失败返回脱敏的 503，保留数据库任务供相同请求重发。
- cancel 在同一 workspace-scoped 事务中仅取消 queued/processing TaskRun 与非终态 Source。状态条件和竞态回滚保护 Worker 已写入的 succeeded/failed/cancelled；不删对象、不操作 BullMQ job。
- API 直接依赖 domain、BullMQ 与 ioredis。lockfile 经 Prettier 收敛后仅保留 28 行真实依赖差异：Task 2 的 S3 presigner 条目及本任务 API importer 项；pnpm 11 的大段 YAML 重序列化已去除，无额外版本漂移。

## TDD 记录

- Publisher：先运行测试，因 producer 模块不存在而 RED；实现后 4 个测试 GREEN，覆盖队列/job 名、共享稳定 jobId、默认 attempts、重复 enqueue、缺失 Redis URL 和资源关闭。
- upload-complete：先运行测试，因 service 方法不存在而 RED；实现后通过。另覆盖对象缺失、size/MIME/checksum mismatch、缺失 checksum 延迟校验、发布失败后的同任务重发和非法状态。
- 上传事务仓储：先运行测试，因事务方法不存在而 RED；实现后通过，验证 workspace 条件、Source 状态条件写入、同事务 TaskRun 创建和重复任务复用。
- process：先运行测试，因 service 方法不存在而 RED；实现后 7 个相关测试通过，覆盖 TXT/媒体映射、状态门槛、在途重复请求和发布失败重试。
- process 事务仓储：先运行测试，因方法不存在而 RED；实现后通过，验证 `uploaded→queued` 和 TaskRun 同事务创建以及并发复用。
- cancel：新增测试先因旧实现未使用事务且允许取消 failed Source 而 RED；仓储取消事务测试也先因方法缺失而 RED。实现后通过，覆盖活动任务同步取消、重复取消、Worker 终态竞态和对象保留。
- Controller：路由测试先因 endpoint 不存在而 RED；实现后验证权限、路由和 HTTP 202。
- 自审额外发现 idempotency key 命中时仍需核对既有 TaskRun 的 workspace/source/taskType/payload；对应测试先 RED，修正后 GREEN，错误消息不会被复用或发布。

## 验证

- `./node_modules/.bin/vitest run --config vitest.config.ts --configLoader runner apps/api/src packages/domain/src/source-task.test.ts packages/domain/src/state-machines.test.ts`：25 个测试文件通过、1 个文件跳过；244 passed、9 skipped。
- `./node_modules/.bin/tsc -p tsconfig.json --pretty false`：通过。
- `./node_modules/.bin/tsc -p apps/api/tsconfig.build.json --outDir /private/tmp/sourceflow-t011-task4-api-build`：通过；构建输出放在临时目录，未覆盖仓库 dist。
- 改动 API TypeScript 的 ESLint、Prettier check（含 `pnpm-lock.yaml`）、CSpell：通过。
- `docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config --quiet`：通过。
- `git diff --check`：通过。

## 自审结论与限制

主代理按 workspace 隔离、事务原子性、幂等消息一致性、错误脱敏、取消终态和范围边界逐文件复核；已处理发现的 TaskRun payload 复用问题。当前会话没有可调用的 reviewer 子代理入口，因此没有独立代理审查；进入 Task 5 前仍需独立复审。

## 独立审查与修正（2026-10-08）

首轮独立只读审查发现：Source 已完成 `source.validate` 后，活动的 `source.transcribe`/`source.analyze` 任务仍可能被验证 TaskRun 的 `succeeded` 终态阻止取消。另发现 process 使用 `audio/*` 前缀，可能派发创建接口不支持的音频 MIME。

- 新增取消回归测试，复现 validation TaskRun succeeded + transcription TaskRun processing；测试在修复前失败，调整终态判断后通过。
- 新增 `audio/flac` 回归测试；修复前被错误排队，改为仅接受受支持 MIME 后通过。
- 独立复审修复后结论 Ready，无 Critical/Important/Minor 发现。
- 新鲜 API/domain 相关测试：246 passed、9 PostgreSQL integration skipped；根 `tsc -p tsconfig.json` 通过。

未配置真实 PostgreSQL、Redis/BullMQ 或 MinIO 集成环境。PostgreSQL auth integration 的 9 项按测试配置跳过；BullMQ、事务竞态和 MinIO 行为由 fake/契约测试验证，未声称真实服务兼容性。真实 Redis jobId 去重和数据库并发语义仍需在显式沙箱集成环境验证。
