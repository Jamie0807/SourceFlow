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
