# T011 Content Source API 执行进度

- [x] T011 设计确认：预签名 PUT、异步 source.validate、服务端格式/时长校验、TXT 分析/媒体转写单阶段处理。
- [x] 创建 `feat/t011-source-api` 隔离 worktree；基线单测 420 passed、10 skipped。
- [x] 编写 T011 设计稿、实现计划并更新 Spec Kit task traceability。
- [x] Task 1：Source validating 状态、任务类型与向后兼容迁移；RED/GREEN、db:validate/domain build 通过，Task review Spec ✅ / Quality Approved。
- Review note (Minor)：后续最终复核清单记录 `source.validate` 任务类型自身未单独断言 workspace-scoped jobId；共用编码函数已有通用隔离覆盖，本项不阻塞。
- [x] Task 2：Storage 预签名 PUT 与 HeadObject checksum；RED/GREEN Storage 42/42，聚焦质量检查通过，独立复审 Ready。
- Review note (Minor)：SDK 对 `content-type` 的预签名策略会排除该头；checksum header 已签名，且 upload-complete/Worker 必须把声明 MIME 当作不可信并验证真实格式。当前未配置 `MINIO_TEST_*`，真实 MinIO PUT/HEAD smoke 未运行。
- Review note (Minor)：TTL 输入只检查正有限整数并截断到 900 秒；超过 JS 安全整数范围的 TTL 仍截断为 900，不会延长 URL，有边界严谨性差异但不阻塞。
- [x] Task 3：Source API、repository、权限与租户隔离；最终回归 103 passed、9 DB integration skipped，独立复审 Ready。
- Review note (Minor)：取消成功响应使用旧记录的 `updatedAt`；不影响状态更新，后续可重读或由 Repository 返回最新记录。
- Review note (Minor)：MinIO bucket 需部署/本地环境预先创建；Task 3 fail-closed 校验配置，Task 7 需明确 bucket 初始化/运维说明。MinIO live smoke 未执行。
- [x] Task 4：API BullMQ publisher、队列幂等和业务 process；首轮独立审查发现并修复验证任务终态阻断后续业务取消，以及过宽 `audio/*` 派发；修复复审 Ready。
- Task 4 新鲜回归：API + domain 相关测试 246 passed、9 PostgreSQL integration skipped；根 TypeScript 检查通过。此前 Task 4 API build、ESLint、Prettier、CSpell、Compose 和 diff 检查通过；修复只增加测试/窄化判断，后续全局门禁在 Task 7 重跑。
- [x] Task 5：Worker 对象读取与媒体/文本 validator；workspace-scoped MinIO Reader、流式 hash/size/MIME/UTF-8 校验、MP3/WAV duration 与 MP4 video timeline 校验。
- Task 5 RED/GREEN：回归先复现并修复 MP4 parser fixture 零 box header、fragmented MP4 音轨短路、短头部/长尾 `stts`、长 `ctts` composition range 和长 `elst` edit list；最终 validator 26/26 通过。详情见 `.superpowers/sdd/t011-task-5-report.md`。
- Task 5 验证：Worker 全量 197 passed、1 Redis integration skipped；根 `typecheck`、`build:worker`、lint、format、spellcheck（131 文件、0 issue）、`git diff --check` 通过。未配置 `MINIO_TEST_*`，真实 MinIO smoke 未执行。
- Task 5 复审：独立只读复审 Ready（实现范围）；普通非 fragmented MP4 读取 raw `stts`、`ctts`、`elst`，无法验证时长的 fragmented MP4 fail closed。
- [x] Task 6：Worker Source/TaskRun 状态、取消与 runtime 装配；状态更新使用 workspace + 预期 status CAS，媒体读取临时故障可重试，Source CAS 能力为必需接口。详情见 `.superpowers/sdd/t011-task-6-report.md`。
- Task 6 验证：Worker 211 passed、1 Redis integration skipped；根 typecheck、build:worker、lint、format、spellcheck（131 文件、0 issue）、git diff --check 通过。独立复审确认此前的存储错误分类、状态同步与可选 CAS 接口问题已修复；真实 MinIO smoke 未配置。
- [x] Task 7：集成测试、文档、全局质量门禁和最终分支审查；实现/审查报告见 `.superpowers/sdd/t011-task-7-report.md`。T011 全仓/核心模块覆盖率门槛仍未满足，因此不将整体 T011 DoD 标记为完成。
- Task 7 最终门禁：`corepack pnpm verify:push` 新鲜退出 0；lint、format、spellcheck、typecheck、unit、component、Playwright @smoke、Web/API/Worker build 与 Compose config 均通过。T011 smoke 在 web-chromium、h5-mobile、pad-landscape 三个项目各通过 1 次。
- Task 7 覆盖率/环境缺口：全仓 statements/branches/functions/lines 为 74.06%/84.10%/85.67%/74.06%，低于 85%/80%/85%/85% 门槛；API sources 目录为 86.73%/79.74%/92.72%/86.73%，Worker source-processing 为 87.52%/78.16%/93.33%/87.52%，均低于核心模块 95% 行/90% 分支门槛。未运行真实 PostgreSQL migration、MinIO 和 Redis/BullMQ 集成；PostgreSQL 认证集成仍按配置跳过。Task 7 验收时尚未提交、push 或合并；后续状态以 Git 记录为准。

执行约束：采用 subagent-driven，任务按依赖顺序串行；项目 AGENTS.md 禁止未授权提交，因此实现与复审只使用当前 Worktree 的 staged/unstaged diff，不自动 commit/push/merge。

---

# T006 执行进度

- [x] 创建 `feat/content-batch-auth` 隔离 worktree。
- [x] 基线安装与单元测试：38/38 通过。
- [x] 固化认证设计补充和实施计划。
- [x] 任务 1：密码、Token 与 Refresh Session。
- [x] 任务 2：认证仓储与业务服务。
- [x] 任务 3：HTTP、Cookie、错误与 Guard。
- [x] 任务 4：全量验收和文档同步。

验收记录（2026-09-28）：

- `pnpm lint`、`pnpm format:check`、`pnpm spellcheck`、`pnpm typecheck` 通过。
- `DATABASE_URL=... pnpm test:unit`：13 个测试文件、77 个测试通过；包含 PostgreSQL Refresh Session 集成测试。
- `pnpm build:api` 通过；`pnpm db:migrate:status` 显示数据库已是最新。
- `pnpm test:integration` 通过，但当前仓库尚未添加 Playwright 用例（`--pass-with-no-tests`）。
- API 本地启动、注册、刷新、登出 smoke flow 已通过；测试账号与租户已清理。
- T006 验收时全仓覆盖率约为 75% statements / 82% branches，尚未达到全局 85% 门禁；加入 Web 首屏后，当前全仓报告约为 54% statements / 80% branches，需随组件、HTTP/E2E 和模块测试补齐。

约束：不自动提交、不自动推送、不自动合并；提交信息必须使用英文。

## T003/T005 依赖收敛记录

- [x] 核对并收敛 T003 本地 Docker Compose：MinIO 配置、凭证变量、数据卷和健康检查均已存在。
- [x] 核对并收敛 T005 领域状态机、文件校验、平台能力和导出 manifest。
- [x] 修正 `packages/domain` 独立测试脚本的 Vitest 配置路径。
- [x] 使用可用端口完成 PostgreSQL、Redis、MinIO 健康验证。

验收记录（2026-09-29）：

- `docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config` 通过。
- `POSTGRES_PORT=55432 docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml ps` 显示 PostgreSQL、Redis、MinIO 均为 healthy；默认 5432 被本机其他容器占用，因此未停止无关容器。
- `pnpm --filter @sourceflow/domain test:unit -- --run --coverage=false`：20 个测试文件、124 个测试通过、9 个集成测试跳过。
- 领域代码覆盖率：100% statements、98.3% branches、100% functions、100% lines。

## T008 Storage Adapter 执行进度

- [x] 以 StoragePort 合同失败测试开始，覆盖上传、下载、删除和不存在对象。
- [x] 实现 MinIO/S3 adapter，支持注入 S3 command client，保持 OSS 替换 seam。
- [x] 固化 workspace/source 隔离 key，并拒绝不安全的存储标识符。
- [x] 增加 AWS SDK v3 S3 Client API 依赖。

验收记录（2026-09-29）：

- `pnpm test:unit -- --run`：22 个测试文件、142 个测试通过、9 个集成测试跳过。
- `pnpm typecheck`、`pnpm lint`、`pnpm build:api`、`pnpm format:check`、`pnpm spellcheck`、`git diff --check` 通过。
- 本地 MinIO smoke：使用 `S3Client` 指向 `http://localhost:9000`、bucket `sourceflow-local`，执行上传、下载内容校验、删除和删除后 not-found，均通过；凭证来自 `Docker/compose/.env.example`，测试对象已删除。

## T002 工程提交与质量 Hook 执行进度

- [x] 保留 `pnpm commit` → Commitizen → `cz-git` 链路，并通过 `cz.config.cjs` 固化项目允许的 Conventional Commits 类型。
- [x] Commitlint 限制类型、大小写、标题长度和非空 subject；关闭 subject 大小写限制以兼容中文提交说明。
- [x] pre-commit 执行 lint-staged、typecheck 和无 coverage 的 quick unit；commit-msg 执行 Commitlint；pre-push 调用集中式 `verify:push` 门禁。
- [x] 扩展 lint-staged 到 JavaScript、TypeScript、CJS/MJS/CTS/MTS、JSON、YAML、Markdown 和 CSS；JS/TS/TSX 执行 ESLint，配置类文件执行 Prettier；增加 T002 命令级 Vitest 验收。

验收记录（2026-09-29）：

- `corepack pnpm exec vitest run scripts/t002-hooks.test.ts --config vitest.config.ts`：3/3 通过，包含真实 `commit-msg` Hook 错误/正确退出码验证。
- `pnpm commit` 交互验证显示 `feat: 新增功能`、`fix: 修复问题`、`docs: 更新文档` 等中文类型选项；随后取消交互，未产生提交。
- Commitlint 验证：`style(tooling): 不允许的提交类型` 失败；`feat(auth): 支持中文提交说明` 通过。
- `corepack pnpm test:unit:quick -- --run`：23 个测试文件、145 个测试通过、9 个集成测试跳过。
- 暂存 `cz.config.cjs` 执行 `corepack pnpm exec lint-staged --concurrent=false`：CJS 文件由 Prettier 处理并返回 0，随后取消暂存。
- `corepack pnpm verify:push`：lint、format、spellcheck、typecheck、unit（145 passed、9 skipped）、component（4 passed）、integration smoke、Web/API/Worker build 和 Docker Compose config 全部通过。

## T017 首屏子集执行记录

- [x] 固化 `specs/content-batch-web` 需求、计划、任务和检查清单。
- [x] 以 RTL 失败测试开始，覆盖登录校验、合法转场和工作台关键内容。
- [x] 实现登录演示页、内容经营工作台首页、静态批次数据和响应式样式。
- [x] 浏览器检查 360px、1280px、1440px：页面可进入工作台，`scrollWidth` 未出现横向溢出。
- [x] `pnpm test:component -- --run`：1 个测试文件、4 个测试通过。
- [x] `pnpm lint`、`pnpm format:check`、`pnpm spellcheck`、`pnpm typecheck`、`pnpm build:web` 通过。
- [x] `DATABASE_URL=... pnpm test:unit`：13 个测试文件、77 个测试通过；修复了既有认证测试的未处理 Promise rejection。

范围说明：本次只完成 T017 的首屏子集。真实认证接线、API Client、上传、内容生成、资产编辑和审核页面仍未完成；全局覆盖率当前约 54% statements / 80% branches，尚未达到项目 85%/80%/85%/85% 全局门禁。

## T007 工作区与租户权限执行进度

- [x] Task 1：WorkspaceInvitation Prisma 模型、迁移 SQL 和数据库契约；契约测试 13/13 通过。
- [x] Task 2：工作区错误、邀请 token 和 TenantMembershipGuard；focused/既有 guard 测试 13/13 通过。
- [x] Task 3：Workspace Repository 和一次性邀请事务；focused repository 测试 8/8 通过。
- [x] Task 4：认证会话的活跃 Workspace 切换；auth focused 19 passed，回归 41 passed。
- [x] Task 5：Workspace Service、Controller、Module 和错误接线；已补安全错误映射、模块 wiring、TTL 覆盖、守卫身份一致性和 Serializable 邀请创建。
- [x] Task 6：PostgreSQL 集成、质量门禁和任务收敛；9 条真实 PostgreSQL 集成用例通过，剩余全仓覆盖率差距已记录。

验收记录（2026-09-29）：

- `DATABASE_URL` 指向隔离本地 PostgreSQL（端口 55432）时，`auth.integration.test.ts`：9/9 通过，覆盖工作区切换、token hash、正确/错误邮箱、过期/已使用邀请、并发接受、并发创建重复邀请、过期历史邀请和跨租户隔离。
- `corepack pnpm test:unit -- --run`：21 个测试文件、133 个测试通过；覆盖率为 69.07% statements、82.27% branches、83.64% functions、69.07% lines。
- `corepack pnpm lint`、`corepack pnpm format:check`、`corepack pnpm spellcheck`、`corepack pnpm typecheck`、`corepack pnpm build:api`、`corepack pnpm build:web`、`corepack pnpm test:component -- --run`、`corepack pnpm test:integration -- --grep @smoke`、`docker compose config`、`git diff --check` 通过。
- `DATABASE_URL=... corepack pnpm db:validate`、`corepack pnpm db:generate`、`corepack pnpm db:migrate:status` 通过；Prisma 提示现有 `package.json#prisma` 配置将在 Prisma 7 废弃，非本次引入。
- 全仓覆盖率仍低于既定 85%/80%/85%/85% 门槛，主要来自 Web、Worker、应用入口和未覆盖错误分支；本轮未通过提高阈值或跳过测试规避。T007 未实现尚不存在的资源 API，后续资源模块必须继续携带 workspaceId 归属校验。
- Task 级复审已完成并修复 Important 问题；最终独立复审代理因账户用量限制未产出报告，本轮由主智能体完成只读 diff/安全边界复核，未执行自动合并。

Task 1 备注：schema validation、Prisma Client generation、全量 Vitest、lint、format 和 typecheck 已通过；真实 PostgreSQL migration 尚未应用，原因已记录在子代理报告中。

## T007 资源查询 workspace 归属校验执行进度

- [x] Task 1：新增 `workspaceScopedWhere` 纯函数，覆盖 workspace 条件注入、冲突覆盖和空 workspace 拒绝；任务审查通过。
- [x] Task 2：成员、活跃邀请和邀请创建事务查询接入 `workspaceScopedWhere`，空 workspace 在 Prisma 查询/事务前拒绝；相关租户测试 42/42 通过。

Task 2 备注：独立任务审查代理因账户用量限制未返回报告；主代理按同一规格和质量清单完成只读复核，未发现阻塞问题。token hash onboarding 查询保持原有无当前 workspace 条件。

- [x] Task 3：更新 T007 当前可接入查询范围的任务追踪，执行全量质量验证并记录结果。

本轮设计与测试证据：`docs/superpowers/specs/2026-09-29-t007-resource-ownership-design.md` 和 `docs/superpowers/plans/2026-09-29-t007-resource-ownership.md` 记录边界及后续资源 API 的验收要求。Task 1 的 helper 测试先因模块不存在而失败，随后 5/5 通过；Task 2 的 repository 边界测试先显示空 workspace 查询被放行，随后 11/11 通过，相关租户测试 37/37 通过。token hash onboarding 查询保留例外；本轮没有新增数据库迁移，也没有提前实现 T011。

Task 3 验收记录（2026-09-30）：

- `corepack pnpm lint`、`corepack pnpm format:check`、`corepack pnpm spellcheck`、`corepack pnpm typecheck`、`git diff --check` 均退出 0；spellcheck 检查 74 个文件、0 个问题。
- `corepack pnpm test:unit -- --run`：24 个测试文件、151 个测试通过；9 个 PostgreSQL 集成用例因未提供 `DATABASE_URL` 跳过。全仓覆盖率为 64.11% statements、82.29% branches、77.51% functions、64.11% lines，未达到 85%/80%/85%/85% 门槛；workspace repository 分支覆盖率为 81.63%，低于核心边界 90% 要求。
- `corepack pnpm test:component -- --run`：1 个文件、4 个测试通过；`corepack pnpm build:api` 和 `corepack pnpm build:web` 均退出 0。
- `corepack pnpm test:integration -- --grep @smoke` 退出 0，但仓库当前没有 `tests/integration`，Playwright 列表为 0 个测试，此项仅验证无测试时的通过路径，未覆盖浏览器 smoke。
- `docker compose -f Docker/compose/docker-compose.yml config` 因缺少必需的 `POSTGRES_PASSWORD` 退出 1；使用仓库示例环境文件的 `docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config --quiet` 退出 0。

最终复核（2026-09-30）：`corepack pnpm verify:push` 在本 Worktree 新鲜执行并退出 0，报告 151 passed、9 skipped、组件 4 passed、Web/API/Worker 构建和带示例环境的 Docker Compose 校验通过；覆盖率与 Playwright 空测试缺口仍按上文保留。新增设计稿、计划和进度文档通过 Prettier 与定向 CSpell 检查；对整个既有 `specs/content-batch-pipeline/tasks.md` 执行 CSpell 时仍报告历史专有词条，未在本轮扩大词典或修改无关文档。最终全分支复核未发现资源归属安全阻塞问题，但按项目 DoD 不能宣称全仓门禁和真实集成/E2E 已完成。

本地环境补充（2026-09-30）：在 Worktree 根目录增加被 `.gitignore` 忽略的 `.env`，将 PostgreSQL `DATABASE_URL` 指向本机 `55432`。通过显式 source 该文件运行 `apps/api/src/auth/auth.integration.test.ts`，9/9 通过；Vitest 当前不会自动加载 `.env`，后续命令需显式注入环境变量。

## T009 Source 处理 Worker 执行进度

- [x] 任务 1：新增共享 Source 任务契约，覆盖 `source.transcribe`、`source.analyze`、workspace+taskRun JobId、JSON-safe 消息/结果和显式失败重试标记；从 domain barrel 导出。

任务 1 验收记录（2026-09-30）：

- 遵循 TDD：契约测试先因模块不存在失败，随后目标测试 5/5 通过。
- Domain 回归：156 个测试通过、9 个跳过；`pnpm typecheck`、定向 ESLint、Prettier 和 `git diff --check` 通过。
- 任务级返工复审通过，无 P0/P1/P2；审查报告见 `.superpowers/sdd/task-1-review-r2.md`。
- 风险：9 个认证集成测试仍按项目配置跳过；消息对象应通过 `createSourceTaskMessage` 运行时校验后进入队列。

- [x] 任务 2：实现 Queue Port、Fake Queue 和 BullMQ/Redis adapter；完成 domain ESM 构建导出、BullMQ 合法 JobId、重试上下文和资源关闭。

任务 2 验收记录（2026-10-01）：

- 目标队列/domain 测试：19 个通过；Redis smoke 1 个明确跳过（未配置 `REDIS_URL`）。
- 全仓单元测试：232 个通过、10 个跳过；TypeScript、ESLint、Prettier、CSpell 和 `git diff --check` 通过。
- `corepack pnpm build:worker` 按 domain → worker 构建通过；Node 直接加载实际 dist Queue adapter 和 domain ESM 通过。
- 首轮审查发现并修复三项阻断问题：BullMQ `:` JobId、生产模块解析、test-utils 反向依赖 Worker；第二轮独立复审无 P0/P1/P2。
- 风险：尚未连接真实 Redis 验证网络入队/消费；构建产物已清理，不纳入工作区。

- [x] 任务 3：实现 TaskRunStore 与 Prisma adapter，完成 workspace 归属条件、幂等/并发 P2002、canonical taskRunId、状态转换、重试次数、取消和 JSON 安全边界。

任务 3 验收记录（2026-10-01）：

- Store focused：13 个测试通过；TaskRun adapter 局部覆盖率 100% 行/分支/函数。
- 全仓单元测试：245 个通过、10 个跳过；typecheck、`build:worker`、lint、format、spellcheck、component 4/4 通过。
- 首轮复审发现并修复 canonical ID 不一致、失败文本泄漏和循环 JSON 三项问题；返工后独立复审无 P0/P1/P2。
- 风险：未配置 `DATABASE_URL`/`REDIS_URL`，真实 PostgreSQL/Redis 集成未执行；全仓覆盖率 68.38%，低于既定全局门槛。

- [x] 任务 4：实现 workspace-scoped Source Lookup、Mock Processor 和 Source Task Handler，覆盖 canonical payload、成功、重试、取消、终态幂等、基础设施失败收敛与安全错误映射。

任务 4 验收记录（2026-10-02）：

- 遵循 TDD：Source Handler/Lookup 测试先因模块不存在失败；后续审查问题均先补失败回归测试，再做最小修复。
- Focused：4 个文件、50/50 通过；全仓 unit：282 个通过、10 个跳过。
- `pnpm typecheck`、`pnpm build:worker`、`pnpm lint`、`pnpm format:check`、`pnpm spellcheck`、`git diff --check` 通过。
- 多轮复审修复 payload 不一致、取消/claim 竞态、queued/processing 基础设施终态恢复、raw cause 泄漏，以及 throwing getter/Proxy 绕过安全映射；终轮独立复审无 P0/P1/P2，报告见 `.superpowers/sdd/task-4-review-r6.md`。
- 风险：全仓覆盖率为 70.87% statements、85.30% branches、82.70% functions、70.87% lines；`source-processing` 为 89.16%/85.95%/89.28%/89.16%，仍低于项目核心模块行 95%、分支 90% 门槛。未配置 `REDIS_URL`，真实 Redis/BullMQ smoke 仍跳过。

- [x] 任务 5：组装可启动 Worker runtime，接入 Prisma、BullMQ Queue、TaskRunStore、SourceLookup、Mock Processor 与 Handler；完成并发配置、优雅关闭、信号处理和 T009 追踪。

任务 5 验收记录（2026-10-03）：

- 遵循 TDD：先增加关闭失败仍释放 Prisma、稳定错误、依赖图组装和 SIGTERM/SIGINT 去重注册测试；首次运行 3 条按预期失败，随后最小实现通过。
- `corepack pnpm verify:push` 通过：全仓 unit 294 个通过、10 个跳过；component 4/4 通过；typecheck、lint、格式、spellcheck、Web/API/Worker 构建和 Docker Compose config 均通过。
- Worker focused：`main` 与 BullMQ Queue 测试 17/17 通过；`WORKER_CONCURRENCY` 的合法值传入 BullMQ Worker，非法值回退为 2 并使用固定脱敏 warning；缺少 Redis/PostgreSQL URL 时在运行前抛稳定配置错误。
- `close()` 先关闭 Queue（Queue 内部先停 Worker），再断开 Prisma；清理失败仍继续释放后续资源，只向调用方抛出固定 `Worker shutdown failed`。SIGTERM/SIGINT 共用该关闭路径且针对同一 runtime 只注册一次。
- `Docker/compose/.env.example` 增加 `WORKER_CONCURRENCY=2`；T009 任务追踪明确 Fake Queue 默认测试、显式 Redis smoke、workspace 归属和 T010/T011 未完成边界。
- 风险：全仓覆盖率为 71.26% statements、85.34% branches、81.27% functions、71.26% lines，未达 85%/80%/85%/85% 门槛；Worker `main.ts` 为 77.77% 行、82.75% 分支。当前 Worktree 没有 `.env`，Redis smoke 明确跳过；Playwright smoke 仍为 0 个测试。对整个既有 `specs/content-batch-pipeline/tasks.md` 执行 CSpell 时存在历史词 `lintstagedrc`、`volcengine`，本轮新增 T009 文本未新增拼写问题。

最终审查返工（2026-10-03）：全分支审查发现启动失败资源释放、重复 `processing` delivery 重排队和 Source 查询顺序三项问题，均已按失败测试修复。复跑 Worker focused：73 passed、1 Redis skipped；复跑 `corepack pnpm verify:push`：295 passed、10 skipped，lint、格式、spellcheck、typecheck、构建与 Docker Compose config 均通过，`git diff --check` 通过。最新全仓覆盖率为 71.25% statements、85.10% branches、81.27% functions、71.25% lines，覆盖率、真实 Redis/PostgreSQL 与零 Playwright smoke 缺口仍保留。

最终审查 R2 返工（2026-10-03）：状态读取或 claim 所有权无法确认时改为只抛安全错误、保持 TaskRun 原状态，防止重复 delivery 覆盖活跃 `processing`；启动失败会注销 SIGTERM/SIGINT listener 后再清理资源。新鲜 Worker focused：74 passed、1 Redis skipped；`corepack pnpm verify:push`：296 passed、10 skipped，全部脚本门禁通过，`git diff --check` 通过。最新全仓覆盖率 71.32% statements、85.19% branches、80.95% functions、71.32% lines，覆盖率、真实 Redis/PostgreSQL 和零 Playwright smoke 缺口仍保留。
