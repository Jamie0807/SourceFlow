# SourceFlow T007 工作区与租户权限设计

状态：已确认设计，实施计划已批准并执行
日期：2026-09-28
范围：`T007 实现工作区和租户权限`

## 1. 目标与边界

T007 为已完成的 T006 认证闭环补齐实时 Workspace 成员上下文、工作区查询、成员邀请、工作区切换和租户访问边界。

T006 注册事务已经原子创建默认 Workspace、默认 Brand 和 Owner 成员关系。T007 不重复创建这些实体，也不扩展品牌级权限、Admin 层级、成员删除、Owner 转移、复杂角色继承、真实邮件发送或生产部署。

## 2. 已确认的方案

采用持久化邀请记录和数据库成员守卫：

- 新增 `WorkspaceInvitation` 数据模型，保存邀请邮箱、目标角色、过期时间、使用时间和邀请人。
- 邀请链接使用密码学随机 token，数据库只保存 token hash；链接默认 7 天过期且只能成功使用一次。
- 独立的 `WorkspacesModule` 提供 Workspace 查询、邀请、接受邀请和切换工作区接口。
- `TenantMembershipGuard` 从数据库重新加载成员关系，`RoleGuard` 只信任数据库返回的角色。
- 当前 Refresh Session 保存活跃 Workspace；切换工作区后更新会话并签发新 Access Token。

## 3. 模块与数据流

### 3.1 模块边界

新增以下模块和组件：

- `apps/api/src/workspaces/workspaces.module.ts`：注册 Controller、Service、Repository 和权限依赖。
- `apps/api/src/workspaces/workspaces.controller.ts`：暴露 Workspace 相关 HTTP 接口。
- `apps/api/src/workspaces/workspaces.service.ts`：处理成员关系、邀请生命周期和工作区切换业务规则。
- `apps/api/src/workspaces/workspaces.repository.ts`：定义可测试的 Workspace 持久化接口。
- `apps/api/src/workspaces/prisma-workspaces.repository.ts`：实现 Prisma 查询和事务。
- `apps/api/src/common/tenant-context.ts`：声明请求租户上下文和 `TenantMembershipGuard`。

现有 `AuthModule` 继续负责 Access Token 验证、角色装饰器和 Refresh Session；为支持工作区切换，`AuthRepository`/`AuthService` 增加按用户、会话和目标 Workspace 更新活跃 Workspace 并签发新 Access Token 的能力。

### 3.2 请求链路

受保护的 Workspace 接口按以下顺序执行：

1. `AccessTokenGuard` 验证 Bearer Token，并写入 `request.auth`。
2. `TenantMembershipGuard` 使用用户 ID 和 token 中的 Workspace 提示从数据库加载成员关系。
3. 守卫校验成员关系属于当前用户和当前 Workspace，并写入 `request.membership`。
4. `RoleGuard` 根据 `request.membership.role` 判断端点权限。
5. Service 和 Repository 接收 `TenantContext`，所有资源查询显式按 `workspaceId` 过滤。

JWT 中的 `workspaceId` 和 `role` 只用于请求上下文提示，不能作为最终授权依据。

## 4. 接口设计

```text
GET  /workspaces/current
POST /workspaces/current/members/invitations
POST /workspaces/invitations/:token/accept
POST /workspaces/:workspaceId/activate
```

### 4.1 查询当前 Workspace

所有已验证成员可查询当前 Workspace，返回 Workspace 基本信息、当前成员角色、默认 Brand 和成员摘要。不存在实时成员关系时拒绝请求，不泄露目标 Workspace 是否存在。

### 4.2 创建成员邀请

只有 Owner 可以邀请 Editor 或 Reviewer。服务端对邮箱进行 trim 和 lowercase，拒绝已存在成员和仍有效的重复邀请。成功后生成一次性邀请 URL；响应只返回本次生成的明文 token/link，数据库只保存 hash。

### 4.3 接受成员邀请

接受邀请要求当前登录用户邮箱与邀请邮箱一致。服务端在事务中使用条件更新检查 token 未使用、未撤销且未过期，然后创建唯一 WorkspaceMember 并标记邀请已使用。并发请求中最多一个请求成功。

### 4.4 切换活跃 Workspace

用户只能切换到自己已经加入的 Workspace。服务端验证目标成员关系，更新当前 Refresh Session 的 `workspaceId`，再签发包含新 Workspace 上下文的 Access Token。后续 Refresh 不会切回旧 Workspace。

## 5. 数据模型

新增 `WorkspaceInvitation`：

- `id`：UUID 主键
- `workspaceId`：目标 Workspace
- `email`：标准化邀请邮箱
- `role`：`editor` 或 `reviewer`
- `tokenHash`：唯一 token hash
- `expiresAt`：过期时间
- `acceptedAt`：接受时间，可空
- `revokedAt`：撤销时间，可空
- `invitedById`：邀请 Owner
- `createdAt`、`updatedAt`

建立 Workspace、邀请创建者 User 和邀请记录的关系，并为 `(workspaceId, email, expiresAt)`、`tokenHash` 建立必要索引/约束。WorkspaceMember 现有 `(workspaceId, userId)` 唯一约束继续防止重复成员。

## 6. 权限与错误边界

| 接口                 | Owner      | Editor     | Reviewer   |
| -------------------- | ---------- | ---------- | ---------- |
| 查询当前 Workspace   | 允许       | 允许       | 允许       |
| 邀请成员             | 允许       | 拒绝       | 拒绝       |
| 接受本人邀请         | 按邀请邮箱 | 按邀请邮箱 | 按邀请邮箱 |
| 切换到所属 Workspace | 允许       | 允许       | 允许       |

新增工作区错误码：

```text
WORKSPACE_ACCESS_DENIED       403
WORKSPACE_MEMBER_EXISTS       409
WORKSPACE_INVITATION_EXISTS   409
WORKSPACE_INVITATION_INVALID  404
WORKSPACE_INVITATION_EXPIRED  410
WORKSPACE_INVITATION_USED     409
WORKSPACE_INVALID_ROLE        400
```

错误沿用现有统一结构：`code`、`message`、`request_id`、`details`。不向客户端返回数据库错误、token、密码、JWT、连接串或内部堆栈。

## 7. 测试设计

### 7.1 单元测试

- `TenantMembershipGuard`：未登录、无成员关系、用户不匹配、Workspace 不匹配、JWT 角色与数据库角色不一致。
- `WorkspaceService`：当前 Workspace 查询、默认 Brand、Owner 邀请、非 Owner 拒绝、邮箱标准化、重复成员、重复邀请、过期邀请、已使用邀请、邮箱不匹配和邀请一次性消费。
- 工作区切换：只能切换到所属 Workspace，切换后 Access Token 和 Refresh Session 使用新 Workspace。
- Controller：接口输入校验、角色守卫和统一错误结构。

### 7.2 PostgreSQL 集成测试

- T006 注册已创建的默认 Workspace/Brand 不会被 T007 重复创建。
- A Workspace 的用户不能访问 B Workspace 的成员或资源上下文。
- 并发接受同一邀请时只有一个事务成功。
- 工作区切换持久化到当前 Refresh Session，刷新后保持新 Workspace。

所有行为变化遵循先写失败测试、确认预期失败、实现最小行为、再运行回归测试的 TDD 顺序。

## 8. 实施顺序与验收

1. 添加 `TenantMembershipGuard`、请求上下文和失败测试。
2. 添加 WorkspaceInvitation schema、迁移和 Prisma 客户端验证。
3. 添加 Workspace Repository、Service 和邀请/查询失败测试。
4. 扩展 Auth Repository/Service 的活跃 Workspace 切换能力。
5. 接入 Controller、Module、守卫链和统一错误映射。
6. 运行单元测试、PostgreSQL 集成测试、lint、format、spellcheck、typecheck 和 API build。
7. 更新 `specs/content-batch-pipeline/tasks.md` 与 `.superpowers/sdd/progress.md`，仅在全部验收证据具备后勾选 T007。

不执行 Git commit、push、合并或生产部署。
