# T011 Task 3 实施与自审报告

## 结果

已在 `feat/t011-source-api` 实现 Source 创建、workspace-scoped 查询、取消和 Storage/MinIO runtime 装配。未实现 upload-complete、process、TaskRun、队列或 Worker 行为；未提交、push、合并或删除 worktree。

关联 Spec Kit feature：`content-batch-pipeline`。依据已批准的 T011 Source API design 与 implementation plan。

## 变更文件

- 新增 `apps/api/src/sources/sources.dto.ts`、`sources.errors.ts`、`sources.repository.ts`、`prisma-sources.repository.ts`、`sources.service.ts`、`sources.controller.ts`、`sources.module.ts`。
- 新增对应 Sources service、controller、Prisma repository、module 测试。
- 修改 `apps/api/src/app.module.ts` 注册 `SourcesModule`。
- 修改 `apps/api/src/storage/storage.port.ts` 增加 `STORAGE_PORT` 注入 token；该文件同时保留 Task 2 已有的 StoragePort 变更。
- 修改 `apps/api/src/common/api-exception.filter.ts` 和测试，为 Source 错误增加最小统一错误映射；未修改 Auth/Workspace 错误语义。
- 修改 `Docker/compose/.env.example`，增加非敏感示例配置：`MINIO_ENDPOINT=http://localhost:9000`、`MINIO_BUCKET=sourceflow-local`、`MINIO_REGION=us-east-1`。未新增或替换凭据值。

## 行为与授权边界

- `POST /sources` 与 `POST /sources/:sourceId/cancel` 配置 `AccessTokenGuard`、`TenantMembershipGuard`、`RoleGuard`，仅允许 owner/editor。Service 再检查写入角色；workspace/user 身份只取自 guard membership，DTO 只读取文件元数据，不把 body 中额外的租户/上传者字段用于持久化。
- 创建校验 MP4/MP3/WAV/TXT 的扩展名和既有 MIME 组合、非空文件名、1 到 1 GiB 大小及 32-byte SHA-256 的规范 Base64 表示。按 workspace 检查重复 hash，使用 `buildSourceObjectKey` 和 900 秒 TTL 签名 PUT，然后创建 `uploading` 记录；唯一约束并发冲突映射为 `SOURCE_DUPLICATE`。
- `GET /sources/:sourceId` 配置 AccessToken 与 membership guards，查询始终携带 membership 的 `workspaceId`。不存在与跨 workspace 资源统一返回 `SOURCE_NOT_FOUND`。
- 取消使用领域允许的状态集合并以 `(workspaceId, sourceId, expected status)` 条件更新。重复取消幂等；非法状态为 `SOURCE_INVALID_STATE`；并发更新后重读状态，避免覆盖已变化状态。对象保留。
- Prisma 查询和写入都带 workspace 条件；`updateStatus` 同时检查 source ID 与预期旧状态。Content hash 去重查询不排除软删除记录，与现有 `(workspaceId, contentHash)` 唯一约束保持一致。

## TDD 记录

- 首次通过标准 `pnpm exec vitest` 启动时，Vite 无法写入 worktree 的 `node_modules/.vite-temp`（操作系统拒绝写入），Vitest 未进入测试阶段。改用仓库内 Vitest 可执行文件及 `--configLoader runner` 后，初始 Sources 测试按预期因缺少 Sources 实现模块而 RED。
- 实现后 Sources 与错误映射测试通过。自审发现 hash 去重查询过滤软删除记录与数据库唯一约束不一致；先调整 repository 测试并运行确认 RED，再改查询使其 GREEN。
- 期间 pnpm 11 自动触发 workspace 安装时遇到 worktree 临时文件写入拒绝；测试/构建改用仓库本地二进制直接执行。没有修改依赖清单或锁文件。
- 独立审查修复：先补充 `meta.target` 为复合字段数组、复合约束名字符串、字段列表字符串，以及主键/无 target/不相关 target 的测试。修复前 8 项按预期 RED；实现后 service suite 29 项 GREEN。仅 `P2002` 且 target 精确表示 `workspaceId + contentHash` 时转为 `SOURCE_DUPLICATE`，其他错误原样传播。
- 独立审查文件名修复：补充 NUL、C0、DEL、C1 控制字符测试；修复前 4 项 RED，修复后在 trim 前检测 Unicode `Cc` 字符类，避免签名或持久化无效文件名。

## 验证

以下命令在最终代码状态重新运行：

| 命令                                                                                                                                                                                                                                                                     | 结果                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `./node_modules/.bin/vitest run --config vitest.config.ts --configLoader runner apps/api/src/sources apps/api/src/common/api-exception.filter.test.ts apps/api/src/auth apps/api/src/common/tenant-context.test.ts apps/api/src/common/workspace-resource-scope.test.ts` | 103 passed；9 个 PostgreSQL 集成测试因未设置 `DATABASE_URL` 而跳过 |
| `./node_modules/.bin/tsc -p tsconfig.json --pretty false --noEmit`                                                                                                                                                                                                       | 通过                                                               |
| `./node_modules/.bin/tsc -p apps/api/tsconfig.build.json --pretty false --outDir /private/tmp/sourceflow-t011-api-build.DQGuyD`                                                                                                                                          | 通过；构建产物写入临时目录                                         |
| 对本任务 TS 文件执行 ESLint `--max-warnings=0`                                                                                                                                                                                                                           | 通过                                                               |
| 对本任务 TS 文件执行 Prettier `--check`                                                                                                                                                                                                                                  | 通过                                                               |
| 对本任务 TS 文件执行 CSpell                                                                                                                                                                                                                                              | 0 个问题                                                           |
| `git diff --check` 与 `git diff --cached --check`                                                                                                                                                                                                                        | 通过                                                               |
| `docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config --quiet`                                                                                                                                                              | 通过                                                               |

MinIO live PUT/HEAD smoke 未执行；本任务没有声称真实 MinIO 验证通过。

## 配置与关注项

- API 启动时必须提供 `MINIO_ENDPOINT`、`MINIO_BUCKET`、`MINIO_REGION`、现有的 `MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD`。缺失、无效或 endpoint 含凭据时 fail closed；模块无默认 endpoint、bucket、region 或生产 fallback。
- `Docker/compose/.env.example` 中新增值仅为本地示例，不是运行时默认值。目标 bucket 必须由部署/本地环境预先创建；Task 7 负责补完整开发与部署说明及相应基础设施文档。
- 当前按 brief 复用 `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`。生产凭据策略与最小权限账户配置仍由部署配置负责，不在本任务扩展。
- 本轮完成自审；Task 3 仍需独立审查后再进入 Task 4。
