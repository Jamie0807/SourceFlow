# SourceFlow 认证模块设计补充

状态：已批准需求的实施补充
范围：`T006 实现注册、登录、刷新、登出`

## 1. 目标与边界

本阶段交付账号认证闭环：注册、登录、Access Token 校验、Refresh Token 轮换、登出撤销，以及 Owner、Editor、Reviewer 角色守卫。

注册属于一个完整业务事务，因此同时创建默认 Workspace、默认 Brand 和 Owner 成员关系。T007 继续负责工作区查询、成员邀请、活跃工作区切换和资源级跨租户校验，不在本阶段扩展工作区管理 API。

## 2. 认证方案

- 密码使用 Node.js `scrypt` 强哈希，每条密码使用独立随机盐，并使用常量时间比较。
- Access Token 使用短期 JWT，默认有效期 15 分钟，包含 `sub`、`sessionId`、`workspaceId` 和 `role`。其中 workspace/role 只作请求上下文提示，不能作为最终授权依据。
- Refresh Token 使用 32 字节密码学随机值；数据库只保存 SHA-256 摘要，不保存明文。
- Refresh Token 默认有效期 30 天。每次刷新必须在 Serializable 数据库事务中先创建同一 `familyId` 的后继会话，再以 `revokedAt IS NULL AND expiresAt > now()` 条件 CAS 更新旧会话（满足自关联外键约束）；旧 token 重放或并发 CAS 失败时撤销整个 family 的有效会话并统一返回未授权错误。CAS 失败事务必须回滚，不得留下孤立后继会话。
- Web 端 Refresh Token 写入 `sourceflow_refresh_token` Cookie，启用 `HttpOnly`、`SameSite=Lax`，生产环境启用 `Secure`，路径限制为 `/auth`。
- Access Token 通过响应体返回，由调用端放入 `Authorization: Bearer` 请求头。

## 3. 数据设计

新增 `RefreshSession`：

- 关联用户和当前活跃 Workspace。
- 保存唯一 `tokenHash`、`expiresAt`、`revokedAt` 和可选 `replacedById`。
- 保存创建和更新时间，按用户、工作区建立索引。
- 注销只撤销当前 Refresh Session；后续可扩展“注销全部设备”。

## 4. 接口契约

- `POST /auth/register`：创建用户、默认 Workspace、默认 Brand、Owner 成员关系和首个会话。
- `POST /auth/login`：验证邮箱和密码，选择用户最早加入的工作区作为活跃工作区并创建会话。
- `POST /auth/refresh`：读取 Cookie，轮换 Refresh Token，并返回新的 Access Token。
- `POST /auth/logout`：读取 Cookie，撤销会话并清除 Cookie；重复注销保持幂等。

成功响应不包含密码哈希或 Refresh Token。登录错误使用统一 `AUTH_INVALID_CREDENTIALS`，避免通过登录错误判断邮箱是否存在；注册重复邮箱按 US-001 保留明确的 `AUTH_EMAIL_ALREADY_REGISTERED`，该接口后续必须配合限流/验证码降低枚举风险。

错误响应固定为：

```json
{
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "邮箱或密码不正确",
  "request_id": "request-id",
  "details": null
}
```

## 5. 权限设计

- `AccessTokenGuard` 验证 Bearer Token，拒绝缺失、篡改和过期 token，并把类型安全的认证上下文放入请求。
- `@Roles(...)` 声明端点允许的角色。
- `RoleGuard` 读取 Tenant Membership Guard 写入的实时成员角色和角色元数据。Owner、Editor、Reviewer 当前按显式允许列表判断，不隐含角色继承；缺少实时成员上下文时拒绝授权。
- 守卫顺序固定为 `AccessTokenGuard → TenantMembershipGuard → RoleGuard`。T007 的 Tenant Context 必须用数据库成员关系再次验证 `workspaceId` 和当前角色，不能只信任 token 声明。

## 6. 配置与安全默认值

- `AUTH_JWT_SECRET` 必填，启动或签发 token 时缺失即失败；测试显式注入固定值。
- `AUTH_ACCESS_TOKEN_TTL_SECONDS` 默认 `900`。
- `AUTH_REFRESH_TOKEN_TTL_SECONDS` 默认 `2592000`。
- `AUTH_ALLOWED_ORIGINS` 配置可信 Web Origin；本地默认允许 `http://localhost:5173` 和 `http://localhost:3000`，生产环境必须显式配置。
- Refresh Session 保存 `familyId` 和 `revocationReason`，用于并发轮换和重放检测；有效轮换必须检查条件更新影响行数为 1。
- 日志和错误不得输出密码、JWT、Refresh Token、数据库连接串和内部堆栈。
- Cookie 的 `Secure` 只在非生产本地开发关闭。

## 7. 验收标准

- 注册、错误密码、重复邮箱、过期 Access Token、Refresh Token 轮换复用、登出撤销和三角色守卫均有测试。
- Prisma schema、迁移和客户端生成通过。
- API 类型检查、单元测试、lint、格式和拼写检查通过。
- 不依赖运行中的真实 PostgreSQL 即可完成主要单元测试；数据库集成测试在 Docker 环境中验证事务和唯一约束。
- T006 本阶段的真实数据库验收必须覆盖注册事务回滚、邮箱唯一约束和同一 Refresh Token 并发轮换；未启动数据库时不得宣称集成测试通过。
