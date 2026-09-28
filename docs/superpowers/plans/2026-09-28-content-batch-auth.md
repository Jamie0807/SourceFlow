# SourceFlow T006 认证模块实施计划

> **执行要求：** 使用 `subagent-driven-development` 按任务顺序实施；每项先写失败测试，再写最小实现；未经用户明确要求不提交 Git。

**目标：** 为 NestJS + Fastify API 实现安全的注册、登录、刷新、登出和角色守卫，并在注册事务中建立默认租户上下文。

**架构：** 认证模块分为 Controller、Service、Repository、密码/Token 基础能力和 Guard。业务服务只依赖仓储接口；Prisma 适配器承担事务和持久化。Refresh Token 使用不可逆摘要持久化并按 family 轮换，采用条件更新防止并发双花；Access Token 保存当前会话与工作区提示，最终角色必须由 Tenant Membership Guard 从数据库读取。

**技术栈：** TypeScript 5、NestJS 11、Fastify 5、Prisma 6、`jose`、`@fastify/cookie`、Vitest。

---

## 任务 1：建立密码、Token 与 Refresh Session 基础能力

**文件：**

- 修改：`apps/api/package.json`（新增 `jose`、`@fastify/cookie`）
- 修改：`prisma/schema.prisma`
- 修改：`apps/api/src/database/database.test.ts`
- 创建：`prisma/migrations/20260928_add_refresh_sessions/migration.sql`
- 创建：`apps/api/src/auth/crypto/password-hasher.ts`
- 创建：`apps/api/src/auth/crypto/password-hasher.test.ts`
- 创建：`apps/api/src/auth/tokens/auth-token.service.ts`
- 创建：`apps/api/src/auth/tokens/auth-token.service.test.ts`

**步骤：**

1. 先写密码哈希、正确/错误密码、随机盐、JWT 过期/篡改和 Refresh Token 摘要测试。
2. 运行目标测试并确认因实现缺失而失败。
3. 用 `scrypt`、`timingSafeEqual`、`randomBytes` 和 `jose` 完成最小实现。
4. 新增带 `familyId`、`revocationReason` 的 RefreshSession 数据模型和 SQL 迁移，更新数据库合同测试。
5. 运行目标测试、`pnpm db:validate` 和 `pnpm db:generate`。

## 任务 2：实现认证仓储与业务服务

**文件：**

- 创建：`apps/api/src/auth/auth.types.ts`
- 创建：`apps/api/src/auth/auth.errors.ts`
- 创建：`apps/api/src/auth/auth.repository.ts`
- 创建：`apps/api/src/auth/prisma-auth.repository.ts`
- 创建：`apps/api/src/auth/auth.service.ts`
- 创建：`apps/api/src/auth/auth.service.test.ts`

**步骤：**

1. 先写注册成功、重复邮箱、登录错误邮箱/密码同错误、刷新轮换、旧 token 重放导致 family 撤销、并发 CAS 失败、过期 refresh 和登出撤销测试。
2. 建立内存仓储测试替身，确保测试验证状态而非实现细节。
3. 实现 Prisma 仓储事务：注册原子创建 User、Workspace、Brand、Owner Membership 和 RefreshSession。
4. 实现登录和活跃工作区选择；无成员关系时安全失败。
5. 实现刷新轮换和幂等登出；检测重放时撤销 family，不泄漏凭证或登录用户存在性。

## 任务 3：实现 HTTP 接口、Cookie、统一错误与权限守卫

**文件：**

- 创建：`apps/api/src/auth/auth.controller.ts`
- 创建：`apps/api/src/auth/auth.controller.test.ts`
- 创建：`apps/api/src/auth/auth.module.ts`
- 创建：`apps/api/src/auth/guards/access-token.guard.ts`
- 创建：`apps/api/src/auth/guards/access-token.guard.test.ts`
- 创建：`apps/api/src/auth/guards/role.guard.ts`
- 创建：`apps/api/src/auth/guards/role.guard.test.ts`
- 创建：`apps/api/src/auth/decorators/roles.decorator.ts`
- 创建：`apps/api/src/common/api-exception.filter.ts`
- 修改：`apps/api/src/app.module.ts`
- 修改：`apps/api/src/main.ts`

**步骤：**

1. 先写 Controller Cookie 属性、清除 Cookie、参数校验、Cache-Control、Origin/CSRF 边界、Access Token 过期和三角色授权测试。
2. 实现四个 HTTP 路由和安全 Cookie 辅助函数。
3. 实现统一错误映射和 request id 回传。
4. 实现 AccessTokenGuard、`@Roles` 和 RoleGuard；RoleGuard 只接受 Tenant Membership Guard 提供的实时角色。
5. 注册 Cookie 插件、AuthModule 和全局错误过滤器。

## 任务 4：集成验证与文档同步

**文件：**

- 修改：`specs/content-batch-pipeline/tasks.md`
- 视需要修改：`.env.example` 或相关配置文档

**步骤：**

1. 运行认证模块测试并检查覆盖率。
2. 在提供 `DATABASE_URL` 的 Docker PostgreSQL 上运行 `pnpm db:validate`、`pnpm db:migrate:deploy`、`pnpm db:migrate:status`；再运行 `pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm spellcheck`、`pnpm test:unit -- --run` 和 `pnpm build:api`。
3. 对完整 diff 做规格符合性审查和代码质量审查，修复高优先级问题后重跑验证。
4. 仅在所有门禁通过后勾选 T006；保留 T007 未完成项。
