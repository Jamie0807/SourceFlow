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
