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
