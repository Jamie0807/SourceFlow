# T002 工程提交与质量 Hook 设计

日期：2026-09-29
状态：已确认，进入实现

## 背景

T001 已提供 pnpm monorepo、基础质量脚本和相关开发依赖，但 T002 的任务记录仍未完成。当前仓库已有 Commitizen、Husky、Commitlint 配置和部分 Hook，不过缺少提交信息 Hook，pre-commit 与 pre-push 也没有完全符合任务约束。

## 目标

- 让 `pnpm commit` 通过 Commitizen 生成符合项目规范的提交信息。
- 让 Commitlint 强制检查 Conventional Commits 类型、格式、长度和非空 subject，同时允许中文提交说明。
- 让 pre-commit 固定执行 lint-staged、类型检查和快速单元测试。
- 让 pre-push 调用集中式质量门禁，且不触发自动 commit。
- 为错误提交类型、中文正确提交说明、Hook 命令和质量门禁增加可重复验证。

## 非目标

- 不修改业务代码、领域模型、数据库结构或部署配置。
- 不在 Hook 中执行 `git commit`、`git push` 或发布动作。
- 不把完整多浏览器发布候选验证塞入本地 pre-commit；push 门禁仅复用仓库已有质量脚本和 smoke 级检查。

## 方案

### 提交信息

保留现有 `pnpm commit` → `cz-git` 链路，在 `cz.config.cjs` 中声明项目允许的类型：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`build`、`ci`、`perf`、`revert`。Commitlint 复用 Conventional Commits 规则，并关闭 subject 大小写检查，使如下提交合法：

```text
feat(auth): 支持中文提交说明
```

提交类型仍由 Commitlint 限制，标题总长度限制为 100 个字符，subject 不得为空。

### Git Hooks

- `.husky/pre-commit`：依次运行 `pnpm exec lint-staged`、`pnpm typecheck`、`pnpm test:unit:quick -- --run`。
- `.husky/commit-msg`：运行 `pnpm exec commitlint --edit "$1"`。
- `.husky/pre-push`：调用 `pnpm verify:push`，集中执行 lint、format check、spellcheck、typecheck、unit、component、integration smoke、API/Web/Worker build 和 Docker Compose 配置检查。

`verify:push` 作为 package script 保持命令可在本地直接运行，也使 Hook 与文档共享同一个质量门禁入口。

### lint-staged

对 TypeScript、JavaScript、CJS/MJS/CTS/MTS、JSON、YAML、Markdown 和 CSS 文件执行 Prettier；JS/TS/TSX 文件额外执行 ESLint，CJS/MJS 不进入当前 ESLint 规则以保持 CommonJS 配置兼容。类型检查与无 coverage 的快速单元测试由 pre-commit 统一执行，避免 staged 文件范围导致测试结果不完整。

## 验证策略

1. 先执行失败验证：在临时 Git 目录中用错误类型运行 Commitlint，确认返回非零；用中文正确提交说明确认返回零。
2. 用 shell 级命令检查 Hook 顺序和关键命令，确保不出现自动 commit/push。
3. 运行 `pnpm verify:push` 和已有质量命令，确认全仓当前基线可通过。
4. 更新 `specs/content-batch-pipeline/tasks.md` 与 `.superpowers/sdd/progress.md`，记录每条 T002 验收证据。

## 风险与取舍

- pre-commit 会比当前更慢，但它能在提交前阻断类型和单元回归问题；快速单元测试使用现有 Vitest 全 unit suite 但关闭 coverage，避免维护第二套容易漂移的测试选择器。
- pre-push 包含构建和 smoke 检查，推送前耗时增加；集中式脚本保证 CI、本地和 Hook 之间的门禁命令可追踪。
- `cz-git` 的交互验证不适合自动化无头测试，因此同时验证其配置可加载、入口脚本存在，并通过 Commitlint 对生成格式做独立验收。
