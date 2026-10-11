## Task 1: 状态机、Source 验证任务类型和数据库迁移

**Files:** `packages/domain/src/source.ts`, `source-task.ts`, 对应测试, `prisma/schema.prisma`, 新 migration, `apps/api/src/database/database.test.ts`。

**公共合同：** `SourceStatus` 加 `validating`；`SourceEvent` 加 `complete_validation`；转换为 `uploading.complete_upload → validating`、`validating.complete_validation → uploaded`、`validating.fail → failed`、`validating.cancel → cancelled`。`SOURCE_TASK_TYPES` 增加 `source.validate`。

- [ ] Step 1：先添加测试：上传完成进入 validating；成功验证进入 uploaded；失败进入 failed；取消后不能再 succeed；消息工厂接受 validate。
- [ ] Step 2：运行 `corepack pnpm exec vitest run --config vitest.config.ts packages/domain/src/state-machines.test.ts packages/domain/src/source-task.test.ts`，确认因状态/类型未定义而失败。
- [ ] Step 3：实现上述状态和任务类型，保持其他现有转换不变。
- [ ] Step 4：新增 migration `20261008170000_add_source_validating/migration.sql`，执行 `ALTER TYPE "SourceStatus" ADD VALUE 'validating';`；不改既有 migration。
- [ ] Step 5：运行目标测试、`corepack pnpm db:validate` 和 `corepack pnpm --filter @sourceflow/domain build`。
