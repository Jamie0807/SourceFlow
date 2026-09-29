# T007 工作区与租户权限实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 为 SourceFlow API 实现实时 Workspace 成员上下文、工作区查询、一次性成员邀请、活跃工作区切换和服务端租户权限校验。

**Architecture:** 在现有 NestJS + Fastify 认证模块上增加 WorkspacesModule、Prisma Workspace Repository 和 TenantMembershipGuard。邀请 token 只明文返回一次，数据库仅保存 hash；所有工作区查询显式带 workspaceId，角色授权只读取数据库成员关系。切换 Workspace 时更新当前 Refresh Session 并签发新的 Access Token。

**Tech Stack:** TypeScript 5.8 strict、NestJS 11、Fastify 5、Prisma 6.19、PostgreSQL、Vitest、jose、Node.js crypto。

## Global Constraints

- 所有产品、技术、测试和交付文档使用中文；库名、API、命令和必要技术术语保留 English。
- 所有行为变化先写失败测试，再写最小实现，再运行目标测试和回归测试。
- T006 注册事务已经创建默认 Workspace、默认 Brand 和 Owner；T007 不重复创建。
- Access Token 的 workspaceId 和 role 只是上下文提示，最终授权必须读取数据库实时成员关系。
- Owner 可以邀请 Editor/Reviewer；不实现 Admin、Owner 转移、成员删除、品牌级权限矩阵或真实邮件发送。
- 邀请 token 使用密码学随机值，数据库只保存 hash；默认 7 天过期且只能成功接受一次。
- 所有租户资源访问必须按 workspaceId 过滤，禁止只按资源 ID 查询。
- 错误保持 code、message、request_id、details 结构，不暴露 token、密码、JWT、连接串、数据库错误或内部堆栈。
- 不覆盖用户已有修改；不自动执行 git commit、git push、合并、发布或生产部署。

## 文件地图

- prisma/schema.prisma：WorkspaceInvitation 模型和 User/Workspace 反向关系。
- prisma/migrations/20260928_add_workspace_invitations/migration.sql：表、外键、唯一索引和查询索引。
- apps/api/src/database/database.test.ts：新模型和迁移契约。
- apps/api/src/auth/auth.errors.ts：工作区错误码。
- apps/api/src/auth/auth.repository.ts、prisma-auth.repository.ts、auth.service.ts：会话 Workspace 切换。
- apps/api/src/auth/auth.module.ts：导出 AUTH_REPOSITORY。
- apps/api/src/common/tenant-context.ts：TenantContext、请求类型和 TenantMembershipGuard。
- apps/api/src/workspaces/workspaces.types.ts：Workspace、成员和邀请类型。
- apps/api/src/workspaces/workspace-invitation-token.ts：token 生成、hash 和链接。
- apps/api/src/workspaces/workspaces.repository.ts、prisma-workspaces.repository.ts：查询和邀请事务。
- apps/api/src/workspaces/workspaces.service.ts：业务规则。
- apps/api/src/workspaces/workspaces.controller.ts、workspaces.module.ts：HTTP 接线。
- apps/api/src/_/_.test.ts：TDD、回归和 PostgreSQL 集成测试。
- apps/api/src/app.module.ts、apps/api/src/common/api-exception.filter.ts：应用接线和错误响应。
- Docker/compose/.env.example、specs/content-batch-pipeline/tasks.md、.superpowers/sdd/progress.md：配置、追踪和验收记录。

---

### Task 1: 添加 WorkspaceInvitation Prisma 模型和迁移契约

**Files**

- Modify: prisma/schema.prisma
- Create: prisma/migrations/20260928_add_workspace_invitations/migration.sql
- Modify: apps/api/src/database/database.test.ts

**Produces**

WorkspaceInvitation 必须有 id、workspaceId、email、role、tokenHash、expiresAt、acceptedAt、revokedAt、invitedById、createdAt、updatedAt；tokenHash 唯一；workspaceId 和 workspaceId/email/expiresAt 有索引；Workspace/User 外键使用 Restrict。

- [ ] **Step 1: Write the failing test**

把 WorkspaceInvitation 加入 database.test.ts 的 requiredModels 和 tenantBusinessModels，并增加：

```ts
const invitation = readModel(schema, 'WorkspaceInvitation');
expect(invitation).toMatch(/\bworkspaceId\s+String/);
expect(invitation).toMatch(/\bemail\s+String/);
expect(invitation).toMatch(/\brole\s+UserRole/);
expect(invitation).toMatch(/\btokenHash\s+String\s+@unique/);
expect(invitation).toMatch(/\bexpiresAt\s+DateTime/);
expect(invitation).toMatch(/\bacceptedAt\s+DateTime\?/);
expect(invitation).toMatch(/\brevokedAt\s+DateTime\?/);
expect(invitation).toMatch(/\binvitedById\s+String/);
expect(invitation).toMatch(/@@index\(\[workspaceId\]/);
expect(invitation).toMatch(/@@index\(\[workspaceId, email, expiresAt\]\)/);
```

同时断言迁移包含表、唯一 tokenHash、两个外键和两个索引。

- [ ] **Step 2: Run to verify failure**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/database/database.test.ts

Expected: FAIL，因为模型和迁移不存在。

- [ ] **Step 3: Implement schema and relations**

User 增加 workspaceInvitations，Workspace 增加 invitations，并加入：

```prisma
model WorkspaceInvitation {
  id          String    @id @default(uuid())
  workspaceId String
  email       String
  role        UserRole
  tokenHash   String    @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  revokedAt   DateTime?
  invitedById String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  invitedBy User      @relation("WorkspaceInvitationInviter", fields: [invitedById], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([workspaceId])
  @@index([workspaceId, email, expiresAt])
}
```

- [ ] **Step 4: Generate and inspect migration**

Run:

```bash
corepack pnpm db:validate
corepack pnpm db:generate
corepack pnpm db:migrate:dev --name add_workspace_invitations
```

检查迁移 SQL；若数据库暂不可用，依据 Prisma schema 生成等价迁移文件，并用 db:validate 验证。

- [ ] **Step 5: Run the contract test**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/database/database.test.ts

Expected: PASS，既有 T006 数据库契约不回归。

---

### Task 2: 工作区错误、邀请 token 和 TenantMembershipGuard

**Files**

- Modify: apps/api/src/auth/auth.errors.ts
- Create: apps/api/src/workspaces/workspace-invitation-token.ts
- Create: apps/api/src/workspaces/workspace-invitation-token.test.ts
- Create: apps/api/src/common/tenant-context.ts
- Create: apps/api/src/common/tenant-context.test.ts
- Modify: apps/api/src/auth/auth.module.ts

**Interfaces**

```ts
export type WorkspaceErrorCode =
  | 'WORKSPACE_ACCESS_DENIED'
  | 'WORKSPACE_MEMBER_EXISTS'
  | 'WORKSPACE_INVITATION_EXISTS'
  | 'WORKSPACE_INVITATION_INVALID'
  | 'WORKSPACE_INVITATION_EXPIRED'
  | 'WORKSPACE_INVITATION_USED'
  | 'WORKSPACE_INVALID_ROLE';

export type TenantContext = Readonly<{
  userId: string;
  workspaceId: string;
  role: AuthRole;
}>;

export function createInvitationToken(): string;
export function hashInvitationToken(token: string): string;
export function buildInvitationUrl(token: string, env?: NodeJS.ProcessEnv): string;
```

TenantMembershipGuard 实现 CanActivate，注入 AUTH_REPOSITORY；从 request.auth.sub 和 request.auth.workspaceId 查询实时成员，成功后写入 request.membership。

- [ ] **Step 1: Write failing token tests**

```ts
it('generates random tokens and stable non-reversible hashes', () => {
  const first = createInvitationToken();
  const second = createInvitationToken();

  expect(first).not.toBe(second);
  expect(first.length).toBeGreaterThanOrEqual(40);
  expect(hashInvitationToken(first)).toHaveLength(64);
  expect(hashInvitationToken(first)).not.toBe(first);
});

it('builds the URL from WEB_APP_ORIGIN', () => {
  expect(buildInvitationUrl('token-value', { WEB_APP_ORIGIN: 'https://app.test/' })).toBe(
    'https://app.test/invitations/token-value',
  );
});
```

- [ ] **Step 2: Run token tests**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/workspaces/workspace-invitation-token.test.ts

Expected: FAIL，因为模块不存在。

- [ ] **Step 3: Implement token helpers**

使用 randomBytes(32).toString('base64url') 和 SHA-256 hex digest。链接 origin 默认 http://localhost:5173，去掉末尾斜杠，再拼接 /invitations/ 与 encodeURIComponent(token)。明文 token 不写入数据库。

- [ ] **Step 4: Write failing guard tests**

覆盖无 auth 返回 AUTH_UNAUTHORIZED、实时成员角色覆盖 JWT role、成员不存在返回 WORKSPACE_ACCESS_DENIED 403，且错误不包含 Workspace 名称或 ID。

```ts
it('loads live membership instead of trusting JWT role', async () => {
  const request = {
    auth: { sub: 'user-1', sessionId: 'session-1', workspaceId: 'workspace-1', role: 'reviewer' },
  };
  repository.findMembership.mockResolvedValue({
    userId: 'user-1',
    workspaceId: 'workspace-1',
    role: 'owner',
    workspace: { id: 'workspace-1', name: 'Workspace', slug: 'workspace' },
  });

  await expect(new TenantMembershipGuard(repository).canActivate(context(request))).resolves.toBe(
    true,
  );
  expect(request.membership?.role).toBe('owner');
});
```

- [ ] **Step 5: Implement errors and guard**

增加 WorkspaceError 及状态映射：访问拒绝 403，重复成员/邀请/已使用 409，无效邀请 404，过期邀请 410，非法角色 400。缺少成员关系时抛出 WORKSPACE_ACCESS_DENIED。AuthModule exports 加入 AUTH_REPOSITORY。

- [ ] **Step 6: Run focused tests**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/workspaces/workspace-invitation-token.test.ts apps/api/src/common/tenant-context.test.ts

Expected: PASS。

---

### Task 3: Workspace Repository 和一次性邀请事务

**Files**

- Create: apps/api/src/workspaces/workspaces.types.ts
- Create: apps/api/src/workspaces/workspaces.repository.ts
- Create: apps/api/src/workspaces/prisma-workspaces.repository.ts
- Create: apps/api/src/workspaces/workspaces.repository.test.ts

**Interfaces**

```ts
export type WorkspaceOverview = Readonly<{
  workspace: AuthWorkspace;
  role: AuthRole;
  defaultBrand: Readonly<{ id: string; name: string }> | null;
  members: readonly Readonly<{
    userId: string;
    email: string;
    displayName: string | null;
    role: AuthRole;
  }>[];
}>;

export type WorkspaceInvitationRecord = Readonly<{
  id: string;
  workspaceId: string;
  email: string;
  role: AuthRole;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}>;

export interface WorkspaceRepository {
  findOverview(userId: string, workspaceId: string): Promise<WorkspaceOverview | null>;
  findMemberByEmail(workspaceId: string, email: string): Promise<{ userId: string } | null>;
  findActiveInvitation(
    workspaceId: string,
    email: string,
    now: Date,
  ): Promise<WorkspaceInvitationRecord | null>;
  createInvitation(input: {
    workspaceId: string;
    email: string;
    role: AuthRole;
    tokenHash: string;
    expiresAt: Date;
    invitedById: string;
  }): Promise<WorkspaceInvitationRecord>;
  findInvitationByTokenHash(tokenHash: string): Promise<WorkspaceInvitationRecord | null>;
  acceptInvitation(input: {
    tokenHash: string;
    userId: string;
    email: string;
    now: Date;
  }): Promise<{ workspaceId: string; userId: string; role: AuthRole }>;
}
```

- [ ] **Step 1: Write repository contract tests**

验证 findOverview/findMemberByEmail/findActiveInvitation 都带 workspaceId；createInvitation 不接收明文 token；acceptInvitation 调用 Serializable transaction，条件更新邀请后才创建成员；冲突不产生部分写入。

- [ ] **Step 2: Run to verify failure**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/workspaces/workspaces.repository.test.ts

Expected: FAIL，因为 Repository 不存在。

- [ ] **Step 3: Implement tenant-scoped read and create queries**

findOverview 以 workspace.findFirst 查询 workspaceId + members.some.userId，并 include 默认 Brand 和成员 User；只映射非敏感 Workspace/成员字段。findMemberByEmail 同时限制 workspaceId 和 User email。findActiveInvitation 限制 workspaceId、email、acceptedAt null、revokedAt null、expiresAt gt now。createInvitation 只保存 tokenHash。

- [ ] **Step 4: Implement atomic acceptance**

使用 Prisma.TransactionIsolationLevel.Serializable，在事务内执行以下逻辑：

```ts
const update = await transaction.workspaceInvitation.updateMany({
  where: {
    tokenHash: input.tokenHash,
    email: input.email,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { gt: input.now },
  },
  data: { acceptedAt: input.now },
});
if (update.count !== 1) throw new InvitationAcceptanceConflictError();

const invitation = await transaction.workspaceInvitation.findUnique({
  where: { tokenHash: input.tokenHash },
});
if (invitation === null) throw new WorkspaceInvitationInvalidError();

await transaction.workspaceMember.create({
  data: {
    workspaceId: invitation.workspaceId,
    userId: input.userId,
    role: invitation.role,
  },
});
return {
  workspaceId: invitation.workspaceId,
  userId: input.userId,
  role: invitation.role as AuthRole,
};
```

唯一约束冲突映射 WORKSPACE_MEMBER_EXISTS；条件更新失败根据重新读取状态映射 used/expired/invalid；其他 Prisma 错误继续交给统一过滤器。

- [ ] **Step 5: Run repository tests**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/workspaces/workspaces.repository.test.ts

Expected: PASS，事务冲突不留下孤立的 acceptedAt。

---

### Task 4: 认证会话的活跃 Workspace 切换

**Files**

- Modify: apps/api/src/auth/auth.repository.ts
- Modify: apps/api/src/auth/prisma-auth.repository.ts
- Modify: apps/api/src/auth/auth.service.ts
- Modify: apps/api/src/auth/auth.service.test.ts
- Modify: apps/api/src/auth/auth.integration.test.ts

**Interfaces**

```ts
export type SwitchWorkspaceInput = Readonly<{
  userId: string;
  sessionId: string;
  workspaceId: string;
  now: Date;
}>;

export type ActiveWorkspaceResult = Readonly<{
  accessToken: string;
  user: AuthUser;
  workspace: AuthWorkspace;
  role: AuthRole;
}>;

switchSessionWorkspace(input: SwitchWorkspaceInput): Promise<RefreshSessionRecord | null>;
switchWorkspace(input: Omit<SwitchWorkspaceInput, 'now'>): Promise<ActiveWorkspaceResult>;
```

- [ ] **Step 1: Write failing AuthService tests**

覆盖：已有成员切换成功并使用数据库 role；非成员 AUTH_FORBIDDEN；撤销/过期 session AUTH_UNAUTHORIZED。

```ts
it('switches only to a workspace with a live membership', async () => {
  const result = await service.switchWorkspace({
    userId: 'user-1',
    sessionId: 'session-1',
    workspaceId: 'workspace-2',
  });

  expect(repository.switchSessionWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 'user-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-2',
    }),
  );
  expect(result.workspace.id).toBe('workspace-2');
  expect(result.role).toBe('editor');
});
```

- [ ] **Step 2: Run to verify failure**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/auth/auth.service.test.ts

Expected: FAIL，因为接口和 Service 方法不存在。

- [ ] **Step 3: Implement repository session update**

使用 updateMany，where 必须包含 id、userId、revokedAt null、expiresAt gt now；count 不是 1 返回 null，成功后映射 RefreshSession。

- [ ] **Step 4: Implement AuthService.switchWorkspace**

先 findMembership(userId, workspaceId)，为空抛 AUTH_FORBIDDEN；再 switchSessionWorkspace，为空抛 AUTH_UNAUTHORIZED；最后以数据库 Workspace/role 调用 signAccessToken，返回 ActiveWorkspaceResult，不更新或返回新的 Refresh Token。

- [ ] **Step 5: Run auth regression tests**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/auth/auth.service.test.ts apps/api/src/auth/auth.controller.test.ts apps/api/src/auth/guards

Expected: PASS，注册、登录、刷新、登出和既有角色守卫不回归。

- [ ] **Step 6: Add PostgreSQL integration coverage**

在 auth.integration.test.ts 创建第二 Workspace 和成员关系，切换后查询 RefreshSession.workspaceId；再调用现有 refresh 流程，断言新的 Access Token 仍指向第二 Workspace。测试结束清理创建的会话、成员和 Workspace。

---

### Task 5: Workspace Service、Controller、Module 和错误接线

**Files**

- Create: apps/api/src/workspaces/workspaces.service.ts
- Create: apps/api/src/workspaces/workspaces.service.test.ts
- Create: apps/api/src/workspaces/workspaces.controller.ts
- Create: apps/api/src/workspaces/workspaces.controller.test.ts
- Create: apps/api/src/workspaces/workspaces.module.ts
- Modify: apps/api/src/app.module.ts
- Modify: apps/api/src/common/api-exception.filter.ts
- Modify: Docker/compose/.env.example

**Interfaces**

```ts
export type CreateInvitationResult = Readonly<{
  id: string;
  email: string;
  role: Exclude<AuthRole, 'owner'>;
  expiresAt: Date;
  inviteUrl: string;
}>;

getCurrent(context: TenantContext): Promise<WorkspaceOverview>;
createInvitation(context: TenantContext, input: unknown): Promise<CreateInvitationResult>;
acceptInvitation(input: { userId: string; token: string }): Promise<{ workspaceId: string; role: AuthRole }>;
activateWorkspace(input: {
  userId: string;
  sessionId: string;
  workspaceId: string;
}): Promise<ActiveWorkspaceResult>;
```

- [ ] **Step 1: Write failing service tests**

覆盖当前 Workspace/默认 Brand、Editor/Reviewer/Owner 权限、邮箱 trim/lowercase、owner role 拒绝、重复成员/有效邀请、错误 token、邮箱不匹配和一次性接受。

```ts
it('allows only an owner to create an editor or reviewer invitation', async () => {
  await expect(
    service.createInvitation(
      { userId: 'editor-1', workspaceId: 'workspace-1', role: 'editor' },
      { email: ' teammate@example.com ', role: 'reviewer' },
    ),
  ).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });

  const result = await service.createInvitation(
    { userId: 'owner-1', workspaceId: 'workspace-1', role: 'owner' },
    { email: ' teammate@example.com ', role: 'reviewer' },
  );
  expect(result.email).toBe('teammate@example.com');
  expect(result.inviteUrl).toContain('/invitations/');
});
```

- [ ] **Step 2: Run to verify failure**

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/workspaces/workspaces.service.test.ts

Expected: FAIL，因为 Service 不存在。

- [ ] **Step 3: Implement service rules**

parseInvitationInput 拒绝非对象、无效邮箱、超过 254 字符的邮箱、owner 和其他未知 role；使用 AUTH_INVALID_INPUT 或 WORKSPACE_INVALID_ROLE。Service 即使被 Controller 的 Roles('owner') 保护，也必须再次检查 context.role。

创建：标准化邮箱 → 查成员 → 查有效邀请 → 生成 token/hash → 计算 TTL → 写 Repository → 返回 inviteUrl；明文 token 不进入 Repository。接受：Controller 只传 request.auth.sub 和 path token；Service 通过 AUTH_REPOSITORY.findUserById 读取当前用户 email，标准化后 hash token，再调用 Repository 事务；不泄露邀请内容。TTL 从 WORKSPACE_INVITATION_TTL_SECONDS 读取，缺失使用 604800。

- [ ] **Step 4: Write and run controller tests**

Controller 需要断言四个 method/path、Guard 顺序、Owner-only invite、邀请响应有 inviteUrl 且不含 tokenHash，接受/切换响应不含 Refresh Token。

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/workspaces/workspaces.controller.test.ts

Expected: 在接线前 FAIL，接线后 PASS。

- [ ] **Step 5: Implement controller and module wiring**

路由固定为：

```ts
@Get('current')
@UseGuards(AccessTokenGuard, TenantMembershipGuard)

@Post('current/members/invitations')
@UseGuards(AccessTokenGuard, TenantMembershipGuard, RoleGuard)
@Roles('owner')

@Post('invitations/:token/accept')
@UseGuards(AccessTokenGuard)

@Post(':workspaceId/activate')
@UseGuards(AccessTokenGuard)
```

Controller 只从 request.auth/request.membership 取用户和租户，不接受 body 中的授权字段。接受邀请的用户 email 由 Service 根据 request.auth.sub 调用 AUTH_REPOSITORY.findUserById 查询，禁止从 body 取得邮箱。WorkspacesModule imports PrismaModule/AuthModule，注册 PrismaWorkspacesRepository、WorkspacesService、TenantMembershipGuard 和 Controller；AppModule imports WorkspacesModule；AuthModule exports AUTH_REPOSITORY。

- [ ] **Step 6: Extend safe exception mapping and configuration**

ApiExceptionFilter 识别 isWorkspaceError，映射既定状态和安全消息，未知错误继续返回 INTERNAL_ERROR。Docker/compose/.env.example 增加：

```dotenv
WEB_APP_ORIGIN=http://localhost:5173
WORKSPACE_INVITATION_TTL_SECONDS=604800
```

Run: corepack pnpm exec vitest run --config vitest.config.ts apps/api/src/workspaces apps/api/src/common/tenant-context.test.ts

Expected: PASS。

---

### Task 6: PostgreSQL 集成、质量门禁和任务收敛

**Files**

- Modify: apps/api/src/auth/auth.integration.test.ts
- Modify: apps/api/src/database/database.test.ts（若迁移契约需要补充）
- Modify: specs/content-batch-pipeline/tasks.md
- Modify: .superpowers/sdd/progress.md

- [ ] **Step 1: Validate Prisma and migration status**

Run:

```bash
corepack pnpm db:validate
corepack pnpm db:generate
corepack pnpm db:migrate:status
```

Expected: schema valid，Client 生成成功，迁移状态清晰。

- [ ] **Step 2: Run focused tests**

Run:

```bash
corepack pnpm exec vitest run --config vitest.config.ts \
  apps/api/src/database/database.test.ts \
  apps/api/src/common/tenant-context.test.ts \
  apps/api/src/workspaces \
  apps/api/src/auth/auth.service.test.ts \
  apps/api/src/auth/auth.integration.test.ts
```

Expected: focused tests 全部通过；PostgreSQL 不可用时明确记录 integration 未执行，不得算作通过。

- [ ] **Step 3: Run quality gates**

Run:

```bash
corepack pnpm lint
corepack pnpm format:check
corepack pnpm spellcheck
corepack pnpm typecheck
corepack pnpm test:unit -- --run
corepack pnpm build:api
```

Expected: 所有命令 exit 0；不通过提高阈值、跳过测试或扩大快照掩盖问题。

- [ ] **Step 4: Run API smoke when PostgreSQL is available**

验证：

```text
GET /health -> 200
POST /auth/register -> 一个 Workspace、Brand、Owner membership
GET /workspaces/current -> 当前工作区和实时 role
POST /workspaces/current/members/invitations -> Owner 成功，非 Owner 403
POST /workspaces/:workspaceId/activate -> 仅本人所属 Workspace 成功
POST /auth/refresh -> 保持切换后的 Workspace
```

日志和报告不得打印凭证、JWT、Refresh Token、数据库 URL 或邀请 token。

- [ ] **Step 5: Update progress only with evidence**

只有验收证据齐全时，才在 specs/content-batch-pipeline/tasks.md 勾选 T007 五项，并在 .superpowers/sdd/progress.md 记录修改文件、命令、通过数量、未执行依赖和覆盖率差距；否则保留未完成状态。

- [ ] **Step 6: Review diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

确认无敏感信息、无关重构、用户修改覆盖或大型无关生成文件；不执行 commit/push/merge。

## Spec Coverage Checklist

- [x] 实时成员守卫和数据库角色：Tasks 2、5。
- [x] 当前 Workspace 查询和默认 Brand：Tasks 3、5。
- [x] Owner 邀请 Editor/Reviewer：Tasks 3、5、6。
- [x] 一次性、hash、过期和并发邀请：Tasks 1、2、3、5、6。
- [x] 活跃 Workspace 切换和 Refresh Session 持久化：Tasks 4、6。
- [x] A Workspace 访问 B Workspace 拒绝：Tasks 2、3、6。
- [x] 统一错误结构和安全边界：Tasks 2、5、6。
- [x] TDD、数据库迁移、质量门禁和进度追踪：所有 Tasks，尤其 1、2、6。

## 执行结果（2026-09-29）

- Task 1—5 已实现并通过对应 focused tests；Task 5 额外完成 WorkspaceError 脱敏、守卫身份一致性、Serializable 重复邀请创建和 API build 修复。
- PostgreSQL 集成测试共 9 条通过，覆盖工作区切换、邀请 hash、正确/错误邮箱、过期/已使用邀请、并发接受、并发创建重复邀请、过期历史邀请和跨租户隔离。
- `lint`、`format:check`、`spellcheck`、`typecheck`、`build:api`、`build:web`、component smoke、Playwright smoke、Prisma validate/generate/migrate status、`docker compose config` 和 `git diff --check` 已验证通过。
- 全仓覆盖率仍为 69.07% statements、82.27% branches、83.64% functions、69.07% lines，未达到项目 85%/80%/85%/85% 全局门槛；缺口主要来自现有 Web、Worker、应用入口和错误分支。不存在资源 HTTP API 的资源级 workspace 归属校验保留到后续资源任务。
- 未执行 Git commit、push、merge、发布或生产部署；实现保留在 `feat/workspace-tenant` worktree。
