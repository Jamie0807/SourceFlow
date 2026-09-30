# T007 资源查询的 workspace 归属校验设计

日期：2026-09-29

状态：已确认并实现

## 背景

T007 已经为 Workspace、成员邀请和活跃工作区切换建立了租户上下文与成员守卫。任务清单仍要求“为每个资源查询增加 workspace 归属校验”，但当前仓库尚未实现 Source、ContentBatch、Asset 等资源的 HTTP API 或 Repository。实际存在的租户相关查询集中在 Workspace、WorkspaceMember 和 WorkspaceInvitation。

本次只收敛 T007 已有代码的查询边界，并建立后续资源 API 可复用的查询约束；不提前实现 T011 的内容源 API，也不改变邀请 token 的跨上下文兑换流程。

## 目标与非目标

### 目标

- 让所有当前可接入的租户资源查询通过一个明确的 workspace-scoped 查询边界构造条件。
- 空的 `workspaceId` 不得退化为不带租户条件的查询。
- 保留现有 Tenant Membership Guard 的职责：先确认用户属于当前工作区，再执行资源查询。
- 为未来 Source、ContentBatch、Asset 等 Repository 查询固定可复用的调用方式和测试要求。
- 保留 A workspace 用户查询 B workspace 资源时返回空结果或权限错误的现有契约。

### 非目标

- 不实现 Source、ContentBatch、Asset 的资源 API；这些属于 T011、T013、T014 等后续任务。
- 不引入 PostgreSQL Row-Level Security、Prisma 全局 Middleware 或改变连接级租户变量；这会扩大到数据库会话和迁移设计。
- 不给 `findInvitationByTokenHash` 和 `acceptInvitation` 强行增加当前 workspace 条件。邀请接受通过一次性 token 找到目标 workspace，兑换前不存在可可信的活跃租户上下文，这是有意的 onboarding 例外。

## 方案比较

### 方案 A：每个调用点手写 `workspaceId`

继续在每个 Prisma `where` 对象中直接写 `workspaceId`。

优点是改动最小；缺点是容易在新增资源查询时遗漏条件，无法通过代码结构表达“该查询必须带租户条件”。现有代码已经采用这种方式，但无法满足后续资源 API 的防遗漏要求。

### 方案 B：统一 workspace-scoped 条件构造器（采用）

新增 `workspaceScopedWhere(workspaceId, where)`，要求资源 Repository 在构造 Prisma `where` 时显式使用该函数。函数拒绝空白工作区标识，并将调用者提供的 workspace 条件固定为最终条件。当前 WorkspaceMember、活跃 WorkspaceInvitation 查询及邀请创建事务中的重复邀请检查迁移到该边界；Workspace 根查询继续保留“workspace id + membership”组合条件。

优点是边界小、可测试、不会依赖 Prisma 私有类型或全局拦截器，并能直接复用于后续资源查询。缺点是新 Repository 仍需遵守约定，因此每个后续资源任务必须配套查询条件测试。

### 方案 C：数据库 RLS 或 Prisma 全局拦截

通过 PostgreSQL RLS 或 Prisma Middleware 自动注入 workspace 条件。

该方案的隔离强度更高，但要求所有数据库连接设置可信的租户上下文，并处理后台任务、事务、迁移、连接池复用和 token onboarding，超出 T007 当前范围。暂不采用，后续如果后台 Worker 需要统一数据库级隔离，应单独立项评估。

## 详细设计

### 查询边界

新增 `apps/api/src/common/workspace-resource-scope.ts`，导出一个纯函数：

```ts
workspaceScopedWhere(workspaceId, where);
```

行为约定：

1. `workspaceId` 为空或仅包含空白字符时，抛出 `WorkspaceError('WORKSPACE_ACCESS_DENIED')`。
2. 返回 `{ ...where, workspaceId }`，最终条件始终由当前调用上下文提供的 `workspaceId` 决定。
3. 函数只负责构造资源归属条件，不负责判断用户成员关系；成员关系仍由 `TenantMembershipGuard` 和服务层完成。
4. 函数不读取 JWT 中的 role 或 workspace，也不访问数据库。

### 现有查询迁移

`PrismaWorkspacesRepository` 中以下查询使用统一边界：

- `findMemberByEmail(workspaceId, email)`。
- `findActiveInvitation(workspaceId, email, now)`。
- `createInvitation` 事务内的活跃邀请检查。

`findOverview(userId, workspaceId)` 继续使用 Workspace 根模型上的 `id` 与 `members.some.userId` 联合条件，并保留默认 Brand 的关系查询。Workspace 根查询不是“通过资源 id 查资源”的场景，单独保留可读性更高。

以下查询明确作为 onboarding 例外，并在测试与注释中保持说明：

- `findInvitationByTokenHash(tokenHash)`。
- `acceptInvitation(input)` 内按 token hash 查询和更新邀请。

它们通过不可猜测的一次性 token 建立 workspace 关系，随后创建该邀请所属 workspace 的成员关系；若附加当前 workspace 条件，会阻断未入工作区用户正常接受邀请。

### 后续资源 API 约束

T011 及后续资源任务新增 Repository 查询时，必须满足：

- 资源单条查询使用 `workspaceScopedWhere(context.workspaceId, { id: resourceId })` 或等价的 workspace-scoped 条件。
- 列表查询使用 `workspaceScopedWhere(context.workspaceId, filters)`。
- 更新、删除和任务创建不仅要过滤 `workspaceId`，还要在写入数据时从可信 `TenantContext` 设置 `workspaceId`，不得接受客户端 body 中的 workspaceId 覆盖上下文。
- 每个资源查询至少有同 workspace 成功、跨 workspace 空结果/拒绝、空 workspaceId 不执行宽查询三类测试中的适用项。

## 测试策略

先新增失败测试，再实现函数和调用点：

1. `apps/api/src/common/workspace-resource-scope.test.ts`
   - 正常条件包含 workspaceId。
   - 调用者无法覆盖最终 workspaceId。
   - 空字符串和空白字符串抛出 `WORKSPACE_ACCESS_DENIED`。
2. `apps/api/src/workspaces/workspaces.repository.test.ts`
   - 现有成员和活跃邀请查询继续传递 workspaceId。
   - 活跃邀请事务检查继续传递 workspaceId。
   - token hash onboarding 查询不误加当前 workspace 条件。
3. 保留并运行现有 TenantMembershipGuard、WorkspaceService 和 PostgreSQL 集成测试，确认跨 workspace 访问仍不会泄漏数据。

## 验收标准

- 资源查询条件构造器有失败测试、实现和回归测试。
- 当前所有可接入的 WorkspaceMember/WorkspaceInvitation 资源查询通过统一边界；token onboarding 例外有明确测试。
- `pnpm lint`、`pnpm format:check`、`pnpm spellcheck`、`pnpm typecheck` 和相关 Vitest 通过。
- 不新增数据库迁移，不改变现有 API 错误码，不实现未进入本任务范围的资源 HTTP API。
- `specs/content-batch-pipeline/tasks.md` 和 `.superpowers/sdd/progress.md` 记录本项收敛范围，并明确后续资源 API 继续复用该边界。

## 风险与后续

该方案主要防止“忘记写 workspace 条件”，但不是数据库级强制隔离。后续 Source、ContentBatch、Asset API 必须把 workspace-scoped 查询作为代码审查和测试门禁；如果后台 Worker 需要直接操作多租户资源，再单独评估带租户上下文的 Worker Repository 或数据库 RLS。
