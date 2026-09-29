# T002 提交规范与 Git Hook 实施计划

> 执行说明：本计划在 `chore/sourceflow-t002-hooks` Worktree 中执行。每个行为变化先增加或运行失败验证，再做最小实现；完成后运行任务级复审与全仓质量门禁。

## 目标与范围

补齐 T002：Commitizen 入口、中文兼容的 Conventional Commits、commit-msg 校验、pre-commit 快速门禁、pre-push 质量门禁，以及对应的可重复验收记录。

不修改业务代码、数据库和部署行为，不执行自动 commit、push 或 merge。

## 实施任务

### 1. 建立 T002 的失败基线验证

**文件/命令：** `commitlint.config.cjs`、`.husky/commit-msg`、`.husky/pre-commit`、`.husky/pre-push`、`package.json`

- 安装依赖并确认当前 `pnpm commit` 配置可加载。
- 用临时 commit message 验证非法类型当前未被完整 Hook 阻断，确认缺少 `commit-msg` 或类型约束的失败基线。
- 检查当前 pre-commit/pre-push 是否缺少 T002 要求的命令。

验收：失败基线只说明预期缺口，不改动主仓库和用户数据。

### 2. 补齐 Commitizen 与 Commitlint 规则

**文件：** `package.json`、`cz.config.cjs`、`commitlint.config.cjs`

- 保留 `pnpm commit` 和 `cz-git` 入口，在 `cz.config.cjs` 声明项目允许的 10 种提交类型。
- 让 Commitizen 选择项与 Commitlint 的 `type-enum` 完全一致。
- 保留 header 长度、非空 subject 等规则；关闭 subject 大小写限制以支持中文提交说明。

测试先行：先写一个可重复的命令级验证，分别断言错误类型失败、中文正确类型通过，再调整配置直到通过。

### 3. 补齐 Git Hooks 与集中式 push 门禁

**文件：** `.husky/commit-msg`、`.husky/pre-commit`、`.husky/pre-push`、`package.json`

- 新增 `commit-msg` 调用 Commitlint。
- 让 pre-commit 依次执行 lint-staged、typecheck 和无 coverage 的快速 unit 测试。
- 增加 `verify:push` package script，集中执行现有 lint、format、spellcheck、typecheck、unit、component、integration smoke、web/API/worker build 和 Docker Compose config 检查。
- 让 pre-push 只调用 `verify:push`，确保 Hook 不执行 commit 或 push。

测试先行：以静态命令断言 Hook 包含必需命令且不包含 `git commit`/`git push`，再写入实现。

### 4. 收敛 lint-staged 覆盖范围

**文件：** `.lintstagedrc.json`

- 为 JavaScript、TypeScript、CJS/MJS/CTS/MTS、JSON、YAML、Markdown、CSS 增加 Prettier 处理。
- 仅对 JS/TS/TSX 执行 ESLint；CJS/MJS/CTS/MTS 进入 Prettier 但不进入当前 ESLint 规则，避免 CommonJS 配置文件的 `module` 全局被误报。

验收：用 lint-staged 配置加载检查和一个临时 staged 文件执行，确认命令解析正常。

### 5. 任务记录、复审和全仓验证

**文件：** `specs/content-batch-pipeline/tasks.md`、`.superpowers/sdd/progress.md`

- 勾选 T002 五项验收条目。
- 记录错误提交类型和中文正确提交说明的实际输出、Hook 检查和质量门禁命令。
- 执行任务级只读 diff/security review，确认不存在自动提交、凭证或危险命令。
- 运行 `pnpm install --frozen-lockfile`、`pnpm verify:push`、必要的独立命令、`git diff --check`。

完成标准：T002 每项均有新鲜命令证据，工作区无未解释修改；不在本任务中自动提交或合并。
