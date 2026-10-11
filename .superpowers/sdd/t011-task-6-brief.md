# T011 Task 6 实施简报：Worker 状态处理与生产 runtime 装配

## 目标

将 `source.validate` 从队列消息贯穿到生产 Worker：在 workspace-scoped 查询后校验流对象，持久化实际 hash/MIME/duration 和 Source 状态；业务 analyze/transcribe 仅在 Source 可处理时运行；所有状态写必须条件更新，迟到任务不得覆盖取消/终态。

## 约束

- 以 Task 5 `SourceMediaValidator` 为唯一媒体验证入口；不得重读原始 API 模块。
- Prisma Source 写入必须包含 `id`、`workspaceId`、当前 status 和未删除条件。
- `source.validate`、`source.transcribe`、`source.analyze` 都沿用 TaskRun claim、canonical message、重试分类、幂等 jobId。
- 校验输入错误不可重试；对象/存储短暂故障继续使用既有 retryable 安全错误映射。
- Source 和 TaskRun 已取消或终态时，Worker 不得覆盖。
- 不 commit、push、合并或清理 worktree。

## TDD 与实施顺序

1. Handler 测试：validation 成功/失败；验证结果写入 Source；取消竞争；业务任务 queued→processing→succeeded/failed；所有存储调用携带 workspaceId；验证任务不能误 dispatch 到 analyze/transcribe。
2. Prisma Source store 测试：status 条件、workspace 条件、deletedAt 条件；BigInt 与 duration/hash/MIME 字段映射；状态竞争返回 false。
3. 实现 Source store、handler validator 接线及 Source 终态更新。
4. 生产 runtime 测试：注入 MinIO Reader/Validator/Source store；三种 taskType 消息由现有 queue/parser 处理；保留 deterministic jobId 和资源关闭语义。
5. Worker 全量测试、`build:worker`、根 `typecheck`、lint/format/spellcheck 与 `git diff --check`，独立复审后更新计划和报告。

## 完成证明

- 关键行为测试能在实现前因预期原因失败，之后通过。
- Source 更新使用 compare-and-set 风格条件，取消/终态优先。
- 真实 MinIO / PostgreSQL integration 若未显式配置，仅记录未执行，不伪称覆盖。
