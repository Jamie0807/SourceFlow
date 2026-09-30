# T007 Resource Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为 T007 当前已有的租户资源查询建立统一的 `workspaceId` 归属条件构造边界，并为后续 Source、ContentBatch、Asset 查询固定可复用的测试约束。

**Architecture:** 新增一个无数据库副作用的 `workspaceScopedWhere` 纯函数，拒绝空 workspace 标识并把可信上下文的 `workspaceId` 写入最终 Prisma 查询条件。WorkspaceMember、活跃 WorkspaceInvitation 及邀请创建事务中的重复邀请检查通过该函数构造条件；一次性邀请 token 兑换保持为明确的 onboarding 例外。当前没有 Source、ContentBatch、Asset HTTP API，因此不提前扩展 T011 范围。

**Tech Stack:** TypeScript strict mode、NestJS、Prisma、Vitest、pnpm monorepo。

## Global Constraints

- 所有 workspace 资源访问必须服务端二次校验归属，不能只依赖前端隐藏按钮。
- 行为变化必须遵循“先失败测试、最小实现、回归测试、再重构”。
- 不引入 PostgreSQL RLS、Prisma 全局 Middleware 或数据库连接级租户变量。
- 不新增 Source、ContentBatch、Asset HTTP API；这些属于后续资源任务。
- `findInvitationByTokenHash` 和 `acceptInvitation` 的 token hash 查询保持 onboarding 例外，不附加当前 workspace 条件。
- 不执行自动 Git commit、push、合并或删除 Worktree；提交须等待用户明确要求并使用 `pnpm commit`。
- 交付前运行 lint、format、spellcheck、typecheck 和相关 Vitest，并记录覆盖率差距，不通过调高阈值或跳过测试规避。

---

## 文件结构与职责

- Create: `apps/api/src/common/workspace-resource-scope.ts`：构造带 workspace 归属条件的纯函数。
- Test: `apps/api/src/common/workspace-resource-scope.test.ts`：覆盖正常条件、条件覆盖和空 workspace 拒绝。
- Modify: `apps/api/src/workspaces/prisma-workspaces.repository.ts`：将当前 WorkspaceMember、活跃邀请查询迁移到统一边界，并在创建邀请事务前构造安全条件。
- Modify: `apps/api/src/workspaces/workspaces.repository.test.ts`：增加空 workspace 不执行资源查询/事务的回归测试，保留现有 token onboarding 例外测试。
- Modify: `specs/content-batch-pipeline/tasks.md`：勾选 T007 资源查询边界并说明真实资源 API 留给后续任务。
- Modify: `.superpowers/sdd/progress.md`：记录本轮 T007 收敛和验证证据。
- Create: `docs/superpowers/specs/2026-09-29-t007-resource-ownership-design.md`：已完成并获用户确认的设计说明。
- Create: `docs/superpowers/plans/2026-09-29-t007-resource-ownership.md`：本实施计划。

## Task 1: 增加 workspace-scoped 条件构造器

**Files:**

- Create: `apps/api/src/common/workspace-resource-scope.ts`
- Test: `apps/api/src/common/workspace-resource-scope.test.ts`

**Interfaces:**

- Consumes: `WorkspaceError` from `apps/api/src/auth/auth.errors.ts`。
- Produces: `workspaceScopedWhere<T extends Record<string, unknown>>(workspaceId: string, where: T): T & { workspaceId: string }`。

- [x] **Step 1: Write the failing test**

创建 `apps/api/src/common/workspace-resource-scope.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { WorkspaceError } from '../auth/auth.errors.js';
import { workspaceScopedWhere } from './workspace-resource-scope.js';

describe('workspaceScopedWhere', () => {
  it('adds the trusted workspaceId to a resource filter', () => {
    expect(workspaceScopedWhere('workspace-a', { id: 'source-a', status: 'ready' })).toEqual({
      id: 'source-a',
      status: 'ready',
      workspaceId: 'workspace-a',
    });
  });

  it('keeps the context workspaceId as the final ownership condition', () => {
    expect(
      workspaceScopedWhere('workspace-a', { id: 'source-a', workspaceId: 'workspace-b' }),
    ).toEqual({ id: 'source-a', workspaceId: 'workspace-a' });
  });

  it.each(['', ' ', '\t'])('rejects an empty workspaceId: %j', (workspaceId) => {
    expect(() => workspaceScopedWhere(workspaceId, { id: 'source-a' })).toThrowError(
      new WorkspaceError('WORKSPACE_ACCESS_DENIED'),
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
corepack pnpm exec vitest run apps/api/src/common/workspace-resource-scope.test.ts --config vitest.config.ts --coverage=false
```

Expected: FAIL because `apps/api/src/common/workspace-resource-scope.ts` does not exist yet.

- [x] **Step 3: Write the minimal implementation**

创建 `apps/api/src/common/workspace-resource-scope.ts`：

```ts
import { WorkspaceError } from '../auth/auth.errors.js';

export function workspaceScopedWhere<T extends Record<string, unknown>>(
  workspaceId: string,
  where: T,
): T & { workspaceId: string } {
  if (workspaceId.trim().length === 0) {
    throw new WorkspaceError('WORKSPACE_ACCESS_DENIED');
  }

  return { ...where, workspaceId };
}
```

- [x] **Step 4: Run test to verify it passes**

Run the same Vitest command. Expected: 3 tests passed.

- [x] **Step 5: Run focused common regression tests**

```bash
corepack pnpm exec vitest run apps/api/src/common --config vitest.config.ts --coverage=false
```

Expected: existing common tests and the new scope tests pass.

## Task 2: 接入 Workspace Repository 查询并补边界回归

**Files:**

- Modify: `apps/api/src/workspaces/prisma-workspaces.repository.ts`
- Modify: `apps/api/src/workspaces/workspaces.repository.test.ts`

**Interfaces:**

- Consumes: `workspaceScopedWhere` from `apps/api/src/common/workspace-resource-scope.ts`。
- Produces: `findMemberByEmail`、`findActiveInvitation` 和 `createInvitation` 的活跃邀请检查在调用 Prisma 前始终带可信 `workspaceId`；token hash onboarding 查询保持原有形状。

- [x] **Step 1: Write the failing repository boundary tests**

在 `apps/api/src/workspaces/workspaces.repository.test.ts` 增加以下测试，验证空 workspace 不会进入成员、活跃邀请或创建邀请事务查询：

```ts
it('rejects an empty workspaceId before member or invitation resource queries', async () => {
  const { prisma, repository } = createRepository();
  const now = new Date('2026-09-28T12:00:00.000Z');
  const input = {
    workspaceId: ' ',
    email: 'editor@example.com',
    role: 'editor' as const,
    tokenHash: 'hash-empty-workspace',
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    invitedById: 'owner-1',
    now,
  } satisfies Parameters<WorkspaceRepository['createInvitation']>[0];

  await expect(repository.findMemberByEmail('', input.email)).rejects.toMatchObject({
    code: 'WORKSPACE_ACCESS_DENIED',
  });
  await expect(repository.findActiveInvitation('\t', input.email, now)).rejects.toMatchObject({
    code: 'WORKSPACE_ACCESS_DENIED',
  });
  await expect(repository.createInvitation(input)).rejects.toMatchObject({
    code: 'WORKSPACE_ACCESS_DENIED',
  });

  expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
  expect(prisma.workspaceInvitation.findFirst).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
```

现有的 `scopes member and active invitation lookups with workspaceId`、`creates an invitation using only the token hash` 和 `accepts an invitation...` 测试继续作为正向条件和 onboarding 例外回归。

- [x] **Step 2: Run the new repository test to verify it fails**

```bash
corepack pnpm exec vitest run apps/api/src/workspaces/workspaces.repository.test.ts --config vitest.config.ts --coverage=false
```

Expected: FAIL because an empty workspace currently reaches Prisma mocks instead of raising `WORKSPACE_ACCESS_DENIED` before the query/transaction.

- [x] **Step 3: Write the minimal repository implementation**

在 `prisma-workspaces.repository.ts` 增加导入：

```ts
import { workspaceScopedWhere } from '../common/workspace-resource-scope.js';
```

将成员查询改为：

```ts
return this.prisma.workspaceMember.findFirst({
  where: workspaceScopedWhere(workspaceId, { user: { email } }),
  select: { userId: true },
});
```

将活跃邀请查询改为：

```ts
const invitation = await this.prisma.workspaceInvitation.findFirst({
  where: workspaceScopedWhere(workspaceId, {
    email,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { gt: now },
  }),
});
```

在 `createInvitation` 的 retry loop 之前构造一次：

```ts
const activeInvitationWhere = workspaceScopedWhere(input.workspaceId, {
  email: input.email,
  acceptedAt: null,
  revokedAt: null,
  expiresAt: { gt: input.now },
});
```

事务内使用 `where: activeInvitationWhere`。不要修改 `findInvitationByTokenHash`、`acceptInvitation` 中按 token hash 的条件；它们仍然通过 token 找到目标 workspace，是设计中明确的 onboarding 例外。

- [x] **Step 4: Run the repository test to verify it passes**

```bash
corepack pnpm exec vitest run apps/api/src/workspaces/workspaces.repository.test.ts --config vitest.config.ts --coverage=false
```

Expected: repository tests pass, including existing exact Prisma `where` assertions and the new empty workspace regression.

- [x] **Step 5: Run related tenant tests**

```bash
corepack pnpm exec vitest run \
  apps/api/src/common/tenant-context.test.ts \
  apps/api/src/workspaces/workspaces.service.test.ts \
  apps/api/src/workspaces/workspaces.controller.test.ts \
  apps/api/src/workspaces/workspaces.repository.test.ts \
  --config vitest.config.ts --coverage=false
```

Expected: all related guard, service, controller and repository tests pass.

## Task 3: 更新 T007 追踪记录并完成质量验证

**Files:**

- Modify: `specs/content-batch-pipeline/tasks.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**

- Consumes: Task 1 的 scope helper 和 Task 2 的 repository 回归证据。
- Produces: T007 任务清单明确当前仓库已加固的查询范围，以及后续资源 API 必须继续携带 workspace 归属条件的验收要求。

- [x] **Step 1: Update the traceability records**

在 T007 中将“为每个资源查询增加 workspace 归属校验”标记为已完成当前可接入范围，并把说明更新为：WorkspaceMember、活跃 WorkspaceInvitation 和邀请创建事务的重复检查均通过 `workspaceScopedWhere`；Source、ContentBatch、Asset 等实际资源 API 尚不存在，后续任务必须继续复用该边界。保留 token hash onboarding 例外说明。

在 `.superpowers/sdd/progress.md` 的 T007 验收记录中新增本轮设计稿、失败测试、相关测试和质量门禁结果，明确没有新增数据库迁移、没有提前实现 T011。

- [x] **Step 2: Run formatting and static checks**

```bash
corepack pnpm lint
corepack pnpm format:check
corepack pnpm spellcheck
corepack pnpm typecheck
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Run the unit and component regression suites**

```bash
corepack pnpm test:unit -- --run
corepack pnpm test:component -- --run
```

Expected: all existing non-integration tests pass; PostgreSQL integration tests remain skipped unless an isolated `DATABASE_URL` is available.

- [x] **Step 4: Run affected builds and smoke checks**

```bash
corepack pnpm build:api
corepack pnpm build:web
corepack pnpm test:integration -- --grep @smoke
docker compose -f Docker/compose/docker-compose.yml config
```

Expected: API/Web builds, integration smoke pass-through and Docker Compose validation pass.

- [x] **Step 5: Review the final diff**

```bash
git status --short
git diff --stat
git diff -- apps/api/src/common/workspace-resource-scope.ts apps/api/src/common/workspace-resource-scope.test.ts apps/api/src/workspaces/prisma-workspaces.repository.ts apps/api/src/workspaces/workspaces.repository.test.ts specs/content-batch-pipeline/tasks.md .superpowers/sdd/progress.md
```

Expected: only T007 scope helper, repository tests, traceability records and the approved design/plan documents are changed; no user changes are overwritten and no commit is created automatically.
