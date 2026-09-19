# Content Batch Pipeline 实现计划

> **给智能体开发者：** 必须按任务逐项执行本计划；每项任务都要先写失败测试，再实现最小行为，再运行目标测试和质量门禁。智能体不得自动执行 `git commit`、`git push` 或合并。

**目标：** 在 pnpm monorepo 中实现 SourceFlow 首个可运行垂直切片：从邮箱登录、内容源上传、火山引擎处理、多平台资产生成、编辑审核到 ZIP 发布包导出。

**架构：** 使用 React + Vite Web、NestJS + Fastify API、BullMQ + Redis Worker 和 Prisma + PostgreSQL。文件存储通过 Storage Adapter 隔离，开发使用 MinIO，生产预留阿里云 OSS。AI 通过 `AiProvider` 接口隔离，默认测试使用 Mock，配置后使用火山引擎语音识别和文本生成。

**技术栈：** Node.js LTS、pnpm、TypeScript strict、React、Vite、NestJS、Fastify、Prisma、PostgreSQL、Redis、BullMQ、MinIO、火山引擎、Vitest、React Testing Library、Playwright、ESLint、Prettier、Commitlint、Commitizen、Husky、Spellcheck、Docker Compose。

## 全局约束

- 第一阶段只实现 Web + API + Worker；React Native 和 Electron 只复用稳定接口，不进入本 Feature。
- 输入只支持 MP4、MP3、WAV、TXT；音视频最大 60 分钟、单文件最大 1GB。
- 首批平台只生成抖音、小红书、视频号的导出发布包，不接真实平台发布 API。
- 每个平台默认生成 2 条资产，共 6 条；资产类型为脚本、正文、标题、标签和 CTA。
- 登录使用 Access Token + Refresh Token；Web 使用 HttpOnly Cookie。
- 火山引擎 Provider 与 Mock Provider 必须实现同一接口；测试不得访问真实火山账号。
- 所有资源按 `workspace_id` 做服务端权限校验。
- 生产环境不直接使用 `latest`，使用不可变 tag 或 digest；开发环境沿用官方 latest 镜像。
- 所有行为变化遵循 TDD；所有 P0 流程有 Playwright smoke。
- 文档、用户可见文案和测试标题默认使用中文；Git commit message 统一使用英文。
- 任务完成后运行验证命令；没有证据不能报告完成。

## 文件地图

| 文件/目录 | 职责 |
| --- | --- |
| `package.json` | 根脚本、pnpm 版本、质量门禁 |
| `pnpm-workspace.yaml` | monorepo workspace |
| `apps/web` | React + Vite 工作台页面 |
| `apps/api` | NestJS API、鉴权、权限、业务用例 |
| `apps/worker` | BullMQ Worker、转写、分析、生成、导出 |
| `packages/domain` | 状态机、实体类型、校验器、平台模板规则 |
| `packages/api-client` | Web 调用 API 的类型化客户端 |
| `packages/test-utils` | 测试工厂、Mock Provider、fixture |
| `packages/config` | TypeScript、ESLint、Prettier、Vitest 配置 |
| `prisma/schema.prisma` | 数据模型和迁移入口 |
| `Docker/compose/docker-compose.yml` | PostgreSQL、Redis、MinIO、本地 API 依赖 |
| `Docker/build/api.Dockerfile` | API 镜像 |
| `Docker/build/worker.Dockerfile` | Worker 镜像 |
| `tests/integration` | Playwright 集成测试 |
| `specs/content-batch-pipeline` | 本 Feature 的 spec、plan、tasks 和 checklist |

## 实施任务

### 任务 1：初始化 monorepo 与质量门禁

**Worktree：** `chore/sourceflow-foundation`
**依赖：** 无
**可并行：** 后续任务均依赖本任务完成

**创建文件：**

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `eslint.config.js`
- `prettier.config.cjs`
- `cspell.json`
- `vitest.workspace.ts`
- `playwright.config.ts`
- `.husky/pre-commit`
- `.husky/pre-push`
- `apps/web/package.json`
- `apps/api/package.json`
- `apps/worker/package.json`
- `packages/domain/package.json`
- `packages/api-client/package.json`
- `packages/test-utils/package.json`
- `packages/config/package.json`

**步骤：**

1. 写一个根脚本检查测试配置、workspace 包发现和 TypeScript strict 配置的失败测试。
2. 创建 workspace 和包清单，固定 `packageManager` 版本并生成 `pnpm-lock.yaml`。
3. 配置根脚本：`lint`、`format:check`、`spellcheck`、`typecheck`、`test:unit`、`test:component`、`test:integration`、`build:web`、`build:api`、`build:worker`。
4. 配置 Husky 只执行快速 lint-staged、类型检查和相关单元测试；不在 hook 中提交代码。
5. 运行 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck` 和 `pnpm test:unit -- --run`。

**完成标准：** 空应用可以安装、类型检查、格式检查和运行 Vitest；提交消息通过 Commitlint；`pnpm commit` 命令可启动 Commitizen。

### 任务 2：完善 Docker 本地依赖和 Prisma 基线

**Worktree：** `feat/content-batch-infra`
**依赖：** 任务 1
**可并行：** 可与任务 3 并行，但 API 服务接线依赖本任务

**修改/创建文件：**

- `Docker/compose/docker-compose.yml`
- `Docker/compose/.env.example`
- `Docker/build/api.Dockerfile`
- `Docker/build/worker.Dockerfile`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `apps/api/src/database/prisma.service.ts`
- `apps/api/src/database/prisma.module.ts`

**步骤：**

1. 为 PostgreSQL、Redis、MinIO 增加健康检查、持久化卷和本地端口。
2. 写 Prisma 连接和迁移失败测试，确认环境变量缺失时启动失败且不暴露密码。
3. 创建 User、Workspace、WorkspaceMember、Brand、Source、ContentBatch、Asset、AssetVersion、ReviewAction、ExportJob、TaskRun 模型。
4. 为所有租户实体添加 `workspace_id`；为状态、邮箱、source hash 和任务幂等键建立索引。
5. 创建第一版迁移和测试 seed，只生成测试用户和工作区，不写生产数据。
6. 运行 `docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config`、迁移、seed 和 Prisma 类型生成。

**完成标准：** 本地 PostgreSQL、Redis、MinIO 健康；迁移可重复执行；删除和重建测试数据库不会影响仓库文件。

### 任务 3：实现领域模型和状态机

**Worktree：** `feat/content-batch-domain`
**依赖：** 任务 1
**可并行：** 可与任务 2 并行

**修改/创建文件：**

- `packages/domain/src/source.ts`
- `packages/domain/src/content-batch.ts`
- `packages/domain/src/asset.ts`
- `packages/domain/src/review.ts`
- `packages/domain/src/platform.ts`
- `packages/domain/src/validation.ts`
- `packages/domain/src/index.ts`
- `packages/domain/src/*.test.ts`

**步骤：**

1. 为 Source、Batch、Asset、Review 定义状态联合类型。
2. 先写状态转换的失败测试：合法转换、非法转换、重复转换和取消行为。
3. 实现纯函数 `transitionSource`、`transitionBatch`、`transitionAsset` 和 `canPerform`。
4. 实现文件类型、大小、时长、标题、正文和标签校验器。
5. 实现三平台模板能力卡片和导出清单类型。
6. 运行 `pnpm --filter @sourceflow/domain test:unit -- --run --coverage`，核心领域覆盖率达到行 95%、分支 90%。

**完成标准：** 领域包不依赖 NestJS、React、数据库和网络；所有状态机行为有单元测试。

### 任务 4：实现鉴权、工作区和权限 API

**Worktree：** `feat/content-batch-auth`
**依赖：** 任务 2、任务 3
**可并行：** 与任务 5 之前的上传 API 不并行；可与任务 6 的模板纯函数并行

**修改/创建文件：**

- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/auth/auth.controller.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/guards/access-token.guard.ts`
- `apps/api/src/auth/guards/role.guard.ts`
- `apps/api/src/workspaces/workspaces.module.ts`
- `apps/api/src/workspaces/workspaces.controller.ts`
- `apps/api/src/workspaces/workspaces.service.ts`
- `apps/api/src/common/tenant-context.ts`
- `apps/api/src/auth/*.test.ts`

**步骤：**

1. 写注册、登录、刷新、登出和 workspace 越权访问的失败测试。
2. 实现强哈希密码、短期 Access Token、Refresh Token 轮换和撤销。
3. Web 通过 HttpOnly Cookie 设置 Refresh Token；API 错误不得泄漏邮箱是否存在。
4. 实现 Owner、Editor、Reviewer 权限守卫和统一错误结构。
5. 为每个查询注入当前 workspace，并测试 A workspace 不能访问 B workspace 资源。
6. 运行 API 单元测试、数据库集成测试和 `GET /health`。

**完成标准：** 注册到工作区首页的 API 链路可用；越权、过期 token、重复刷新和错误密码都有测试。

### 任务 5：实现内容源上传与异步处理

**Worktree：** `feat/content-batch-source-processing`
**依赖：** 任务 2、任务 3、任务 4
**可并行：** Storage Adapter、Mock Provider 和 Worker 单元测试可以并行

**修改/创建文件：**

- `packages/domain/src/source-validation.ts`
- `apps/api/src/sources/sources.controller.ts`
- `apps/api/src/sources/sources.service.ts`
- `apps/api/src/storage/storage.port.ts`
- `apps/api/src/storage/minio-storage.adapter.ts`
- `apps/worker/src/queue/queue.module.ts`
- `apps/worker/src/source-processing/source-processing.processor.ts`
- `packages/test-utils/src/mock-ai-provider.ts`
- `packages/test-utils/src/source-fixtures.ts`

**步骤：**

1. 写 MP4、MP3、WAV、TXT、1GB、60 分钟、空文件、重复 hash 的失败和成功测试。
2. 实现上传预签名/分片策略或 API 受控上传，保存文件元数据和 hash。
3. 实现 `StoragePort`，MinIO 作为本地实现；所有业务代码只依赖接口。
4. 实现 BullMQ 任务：`source.transcribe`、`source.analyze`，支持 queued/running/succeeded/failed/cancelled。
5. 实现 Mock ASR/分析 Provider，生成时间戳转写、章节、关键观点、金句和候选片段。
6. 实现真实火山引擎 Provider 的配置入口、错误映射、超时和重试；没有凭证时不得阻断 Mock 测试。
7. 运行 Worker 单元测试、任务幂等测试、失败重试测试和本地 Docker smoke。

**完成标准：** 上传完成后可以创建处理任务；刷新页面可恢复状态；取消不删除源文件；任务失败可重试。

### 任务 6：实现火山引擎 Provider 和多平台资产生成

**Worktree：** `feat/content-batch-generation`
**依赖：** 任务 3、任务 5
**可并行：** 平台模板纯函数可与任务 5 并行；真实 Provider 接线依赖任务 5 的任务协议

**修改/创建文件：**

- `packages/domain/src/ai-provider.ts`
- `packages/domain/src/platform-templates/douyin.ts`
- `packages/domain/src/platform-templates/xiaohongshu.ts`
- `packages/domain/src/platform-templates/wechat-channels.ts`
- `apps/worker/src/providers/volcengine.provider.ts`
- `apps/worker/src/providers/mock.provider.ts`
- `apps/worker/src/generation/generation.processor.ts`
- `apps/api/src/content-batches/content-batches.controller.ts`
- `apps/api/src/content-batches/content-batches.service.ts`

**步骤：**

1. 写 Provider 接口、Mock Provider、火山引擎错误映射和 3 平台模板的失败测试。
2. 实现 `AiProvider.transcribe`、`AiProvider.analyze` 和 `AiProvider.generateAssets` 接口。
3. 通过环境变量配置火山引擎 endpoint、model、access key 和 secret；禁止在源码中写默认密钥。
4. 实现每个平台默认 2 条资产，保存源版本、模型、配置、引用和生成任务。
5. 实现生成取消、重试、部分成功保留和额度统计。
6. 运行无凭证 Mock 测试；有凭证时增加手动沙箱 smoke，不把真实调用放入 CI 默认流程。

**完成标准：** 一个内容批次可以生成 6 个资产；每个资产可追溯到源内容和生成配置；Provider 可替换。

### 任务 7：实现 Web 内容工作台

**Worktree：** `feat/content-batch-web`
**依赖：** 任务 4、任务 5、任务 6
**可并行：** UI 组件单元测试可与 API 细节修复并行，但联调必须等待 API 契约稳定

**修改/创建文件：**

- `apps/web/src/routes/auth/*`
- `apps/web/src/routes/workspace/*`
- `apps/web/src/routes/sources/*`
- `apps/web/src/routes/batches/*`
- `apps/web/src/components/source-upload/*`
- `apps/web/src/components/generation-panel/*`
- `apps/web/src/components/asset-editor/*`
- `apps/web/src/components/review-actions/*`
- `packages/api-client/src/auth.ts`
- `packages/api-client/src/sources.ts`
- `packages/api-client/src/content-batches.ts`
- `apps/web/src/**/*.test.tsx`

**步骤：**

1. 先写 React Testing Library 测试：登录错误、上传状态、生成进度、编辑自动保存、权限按钮和空/错/重试状态。
2. 实现登录和工作区空状态。
3. 实现上传、处理状态和任务轮询。
4. 实现平台选择、生成任务、资产列表和三栏编辑器的 MVP 单栏降级。
5. 实现版本保存、提交审核、批准/退回和导出按钮。
6. 使用 `getByRole`、`getByLabel` 和 `getByTestId`，禁止依赖 CSS 层级选择器。
7. 运行组件测试、浏览器 smoke 和 360px/1280px/1440px 视口测试。

**完成标准：** Web 可以从登录进入工作区，完成一次端到端内容批次流程；所有 loading、empty、error、retry 状态可见。

### 任务 8：实现 ZIP 发布包导出

**Worktree：** `feat/content-batch-export`
**依赖：** 任务 3、任务 6
**可并行：** 与任务 7 的页面实现并行；联调等待导出 API 契约

**修改/创建文件：**

- `apps/worker/src/export/export.processor.ts`
- `apps/api/src/exports/exports.controller.ts`
- `apps/api/src/exports/exports.service.ts`
- `packages/domain/src/export-manifest.ts`
- `packages/domain/src/export-manifest.test.ts`
- `apps/web/src/components/export-dialog/*`

**步骤：**

1. 写 approved/needs_review/draft 不同状态下的导出失败测试。
2. 实现 manifest、README、平台目录、文案、标签和发布清单生成。
3. 生成 ZIP 并保存 ExportJob 状态，支持重试和下载权限校验。
4. 对平台标题、正文、标签和 CTA 重新执行规格检查。
5. 运行导出单元测试、Worker 集成测试和浏览器下载测试。

**完成标准：** 只导出 approved 版本；ZIP 结构与 spec 一致；失败有可定位错误且可重试。

### 任务 9：建立 Playwright P0 集成测试

**Worktree：** `test/content-batch-playwright`
**依赖：** 任务 4、任务 5、任务 6、任务 7、任务 8
**可并行：** 测试 fixture 和测试数据可提前准备，完整流程需等待页面和 API 稳定

**创建文件：**

- `tests/integration/fixtures/auth.fixture.ts`
- `tests/integration/fixtures/source.fixture.ts`
- `tests/integration/content-batch.spec.ts`
- `tests/integration/content-batch-failure.spec.ts`
- `tests/integration/responsive.spec.ts`

**步骤：**

1. 写注册、上传、生成、编辑、审核、导出主流程失败测试。
2. 确认失败原因是缺失实现而非测试配置错误。
3. 接入 Mock Provider 和测试数据库 seed。
4. 实现 `@smoke` 主流程和发布失败/额度不足/越权场景。
5. 运行 Chromium、WebKit、手机视口和 Pad 横屏项目。
6. 保存失败 trace、截图和视频，报告中脱敏 token 和个人信息。

**完成标准：** P0 主流程和关键失败路径可重复执行；CI 在无真实火山凭证时仍可通过。

### 任务 10：CI、构建和自主验收

**Worktree：** `ci/content-batch-quality-gates`
**依赖：** 任务 1—9
**可并行：** 仅能在接口和脚本名称稳定后完成

**创建/修改文件：**

- `.github/workflows/quality.yml`
- `.github/workflows/pr.yml`
- `.github/workflows/push.yml`
- `Docker/build/api.Dockerfile`
- `Docker/build/worker.Dockerfile`
- `Docker/compose/docker-compose.yml`
- `docs/qa/*`
- `docs/devops/*`

**步骤：**

1. 配置 PR 和 push 触发的安装、格式、拼写、类型、单元、组件、Playwright smoke 和构建门禁。
2. 配置 PostgreSQL、Redis、MinIO service container 或 Compose 环境。
3. 配置 API/Worker 镜像构建、漏洞扫描和 digest 输出，不在 CI 推送生产 tag，除非用户另行授权。
4. 运行完整质量门禁并保存报告。
5. 按 spec 的验收目标逐项填写结果和证据。

**完成标准：** 质量门禁在干净环境可重复运行；失败会阻断合并；产物、日志和测试报告可以下载。

## 并行执行关系

```text
任务1
├── 任务2 ──┐
└── 任务3 ──┼── 任务4 ──┐
            └── 任务5 ──┼── 任务6 ──┐
                         ├── 任务7 ──┤
                         └── 任务8 ──┼── 任务9 ──任务10
```

## 验证命令总表

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm spellcheck
pnpm typecheck
pnpm test:unit -- --run --coverage
pnpm test:component -- --run
pnpm test:integration -- --grep @smoke
pnpm build:web
pnpm build:api
pnpm build:worker
docker compose --env-file Docker/compose/.env.example -f Docker/compose/docker-compose.yml config
```

## 提交和审查规则

- 每个任务完成后生成任务级验证报告和变更摘要。
- 智能体不自动提交；用户明确要求提交时使用 `pnpm commit`。
- 任务级审查检查需求符合性、测试证据、安全边界和文件范围。
- 所有任务完成后进行一次最终审查，解决 Critical/Important 问题后才能报告完成。
