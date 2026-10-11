# T011 Task 6 验收报告：Worker 状态处理与生产 runtime 装配

日期：2026-10-08

工作区：`feat/t011-source-api`（独立 worktree）

## 完成内容

- `SourceLookup` 现要求实现 workspace-scoped `transitionStatus` 与 `completeValidation`；Prisma 实现以 `{ id, workspaceId, status, deletedAt: null }` 做条件更新，并通过 `count === 1` 报告 CAS 结果。
- `source.validate` 调用真实流式 validator；校验成功后记录检测 MIME、SHA-256 和 duration，再将 Source 更新为 `uploaded`。TXT 的 duration 合法为 `null`，不再被误判成无效媒体。
- MinIO 获取对象或读取流的临时错误映射为可重试 `PROCESSOR_TEMPORARY_FAILURE`；媒体内容格式/哈希/长度等校验错误维持不可重试输入错误。
- analyze/transcribe 任务显式分派，Source 状态随任务进入 processing、成功/失败终结，并在可重试失败时回到 queued。TaskRun 仍通过既有条件状态更新处理取消、重复投递和重试。
- Worker runtime 从 `MINIO_*` 环境变量创建 MinIO Reader 与 Validator 并注入 Handler；配置缺失时报固定字段名，不打印凭证。
- CAS 未命中时重读同 workspace 的 Source；已 cancelled/succeeded 的 Source 不会被迟到 Worker 改写为失败。验证任务在重试耗尽时使用 validating→failed。

## TDD 与审查记录

- 初始 validation Handler 测试确认 `source.validate` 原先落入 analyze，且验证失败没有更新 TaskRun。
- 新增回归曾确认：MinIO 获取失败、对象流中断被错误分类为无效媒体；validation 重试耗尽未更新 Source；TXT `durationSeconds: null` 被拒绝。
- 修复后新增并通过验证 Source 终态 CAS 未命中、业务 Source 成功/失败/重试状态流转测试。
- 独立只读复审：此前报告的 3 项 Important 问题均已关闭；复审特别建议 CAS 竞态测试，已新增“终态 Source 不被失败写覆盖”用例。

## 新鲜验证结果

- `pnpm exec vitest run apps/worker/src`：211 passed、1 skipped（Redis integration 未配置）。
- `pnpm typecheck`：通过。
- `pnpm build:worker`：通过（domain → worker）。
- `pnpm lint`：通过。
- `pnpm format:check`：通过。
- `pnpm spellcheck`：131 files，0 issues。
- `git diff --check`：通过。

## 未执行项与边界

- 未配置 `MINIO_TEST_*`，没有连接真实 MinIO 验证完整上传/读取链路；S3 reader 和 validator 由契约及流式测试覆盖。
- Redis BullMQ 集成测试因本机未配置服务而跳过。
- 全 T011 API integration smoke、迁移检查、Compose 与全局 CI 收敛留在 Task 7。
- 本任务未 commit、push、合并或清理 worktree。
