# T011 Task 1 完成报告

## 状态

DONE_WITH_CONCERNS

## 实现内容

- `packages/domain/src/source.ts`：新增 `validating` 状态和 `complete_validation` 事件；上传完成后进入验证，验证成功进入 `uploaded`，验证失败进入 `failed`，验证中可取消。
- `packages/domain/src/source-task.ts`：`SOURCE_TASK_TYPES` 新增 `source.validate`。
- `prisma/schema.prisma`：`SourceStatus` enum 增加 `validating`。
- `prisma/migrations/20261008170000_add_source_validating/migration.sql`：新增 enum 值迁移，没有修改既有 migration。
- `packages/domain/src/state-machines.test.ts`、`packages/domain/src/source-task.test.ts`、`apps/api/src/database/database.test.ts`：覆盖新增转换、任务消息类型、schema 和 migration 合同。

## TDD RED 证据

先新增测试，再运行：

```text
corepack pnpm exec vitest run --config vitest.config.ts packages/domain/src/state-machines.test.ts packages/domain/src/source-task.test.ts
```

首次运行因沙箱不能写入 `node_modules/.vite-temp` 而在 Vitest 启动阶段 `EPERM`，不算测试 RED。授权允许该临时写入后重跑，得到预期失败：

- `uploading.complete_upload` 实际仍返回 `uploaded`，断言期望 `validating`。
- `validating` 状态不存在，状态机读取失败。
- `createSourceTaskMessage` 拒绝 `source.validate`（`taskType must be a supported Source task type`）。
- RED 结果：3 failed，14 passed；失败均与本任务新增合同相符。

## GREEN 与构建验证

- `corepack pnpm exec vitest run --config vitest.config.ts packages/domain/src/state-machines.test.ts packages/domain/src/source-task.test.ts apps/api/src/database/database.test.ts`：3 个测试文件通过，31 项通过。
- `DATABASE_URL='postgresql://user:pass@localhost:5432/sourceflow' corepack pnpm db:validate`：成功，输出 `The schema at prisma/schema.prisma is valid`。该占位 URL 仅供 Prisma 配置解析；命令不连接数据库。
- `corepack pnpm --filter @sourceflow/domain build`：成功（`tsc -p tsconfig.build.json`）。

## 自审及关注项

- 状态表只增加 brief 指定的 validating 路径；既有转换维持原状。
- migration 内容严格为 `ALTER TYPE "SourceStatus" ADD VALUE 'validating';`。
- Prisma 提示 `package.json#prisma` 配置在 Prisma 7 将弃用；这是已有配置提示，与本任务 schema 变更无关。
- Shell 启动时显示 `.zprofile` 中 Homebrew 路径不存在的提示；上述命令均正常完成。
- 首次受限沙箱运行测试和 build 写入目录分别遇到 `EPERM`；在获准执行后，所有要求的验证均完成。
- 自审时确认工作区中既存的 `.superpowers/sdd/progress.md`、`specs/content-batch-pipeline/tasks.md`、任务 brief 和 feature 设计/计划文件均未被本任务修改。
- 未执行 commit、push、merge 或创建 worktree。
