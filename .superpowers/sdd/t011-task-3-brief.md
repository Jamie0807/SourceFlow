## T011 Task 3：Source Repository、Service 与 HTTP 权限边界

### 已批准设计与依赖

- 依据 `docs/superpowers/specs/2026-10-08-t011-source-api-design.md` 与 `docs/superpowers/plans/2026-10-08-t011-source-api.md`。
- Task 1 状态机/迁移与 Task 2 StoragePort 已实现并通过独立任务审查。
- 当前分支 `feat/t011-source-api` 的共享 Worktree：`/Users/jamie/.codex/worktrees/t011-source-api/SourceFlow`。
- 不提交、不 push、不合并；保留其他既有变更。仅处理本任务文件及必要的 Source API 错误映射/模块注册。

### 目标范围

实现 Source API 首段：创建 Source 并签发直传 URL、按当前 workspace 查询 Source、取消 Source。不得实现 upload-complete、process、TaskRun 创建/队列发布或 Worker 行为（它们分别属于后续 Task 4/5/6）。

### 预期文件

- 新建 `apps/api/src/sources/sources.repository.ts`、`prisma-sources.repository.ts`、`sources.service.ts`、`sources.controller.ts`、`sources.module.ts`、`sources.dto.ts`。
- 为上述接口增加 service/controller/repository/module 测试。
- 修改 `apps/api/src/app.module.ts` 注册模块。
- 如确有必要新增 Source API 错误类型/映射，只做最小改动并补测试；不得更改既有 Auth/Workspace 错误语义。

### 契约与验收

`SourcesRepository` 至少提供：

```ts
create(input: CreateSourceRecord): Promise<SourceRecord>;
findById(workspaceId: string, sourceId: string): Promise<SourceRecord | null>;
findByContentHash(workspaceId: string, contentHash: string): Promise<SourceRecord | null>;
updateStatus(workspaceId: string, sourceId: string, from: SourceStatus, to: SourceStatus): Promise<boolean>;
```

- `POST /sources`：AccessTokenGuard + TenantMembershipGuard + RoleGuard，限定 owner/editor；从 guard 生成的 membership 取得 userId/workspaceId，绝不接受请求体租户/上传者字段。校验 MP4/MP3/WAV/TXT、扩展名与 MIME 组合、文件名非空、大小 `1..1GiB`、SHA-256 规范格式；同 workspace hash 冲突返回 `SOURCE_DUPLICATE`，不创建记录或对象。创建 status=`uploading` 的 Source，按 `buildSourceObjectKey` 生成对象 key，调用 StoragePort 生成 900 秒 presigned PUT，并返回 sourceId、uploadUrl、headers、expiresAt。
- `GET /sources/:sourceId`：AccessTokenGuard + TenantMembershipGuard；仅用 membership.workspaceId 查询；跨 workspace 与不存在均返回统一 not-found，不泄漏资源存在性。
- `POST /sources/:sourceId/cancel`：owner/editor；仅按 membership workspace 查询与更新；状态按 domain transition 规则变为 `cancelled`，终态重复取消幂等，其他不可取消状态使用统一冲突错误。对象保留；Task 4/6 负责活动 TaskRun 取消。
- Prisma repository 所有查询和写入都显式带 workspaceId；`updateStatus` 同时带 workspaceId、sourceId、预期旧状态，避免竞态覆盖。
- 通过存储端口令牌注入 StoragePort，并注册 MinIO adapter。配置遵循项目既有 MinIO Compose 环境变量；缺失配置不得静默使用真实密钥或生产 fallback。任何新配置名字/默认值须在报告中列出，不得将 secrets 写入仓库。
- TDD：先写 service/controller/repository 测试并记录预期 RED，再实现最小行为并记录 GREEN。覆盖 owner/editor/reviewer、空 membership、跨租户、重复 hash、输入边界、签名结果、取消合法/非法/重复状态及 Prisma workspace 条件。
- 运行 Sources 测试、相关既有租户/Auth 回归、`pnpm exec tsc -p tsconfig.json --pretty false --noEmit`、API build、改动文件 ESLint/Prettier/CSpell、`git diff --check`。不得声称 MinIO live smoke 通过，除非显式配置并真实执行。

### 非目标/停止条件

- 不新增公开的 `workspaceId` 请求参数；不依赖前端隐藏操作控制权限。
- 不删除对象、不实现 upload-complete/process、不接 BullMQ、不修改 Worker。
- 若实际 MIME 别名、错误码或 Storage/MinIO runtime 配置需要新增产品决策，先报告具体差异，不自行扩展设计。
- 完成后写 `.superpowers/sdd/t011-task-3-report.md`，列出文件、RED/GREEN、命令及结果、未执行验证和关注项；等待独立审查后才进入 Task 4。
