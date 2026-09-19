# Content Batch Pipeline 任务拆解

状态：待实现
执行规则：每个任务在独立 Worktree 中完成；先测试后实现；不自动提交 Git。

## 阶段 0：基础工程

### T001 初始化 pnpm monorepo

- **依赖：** 无
- **Worktree：** `chore/sourceflow-foundation`
- **文件：** `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`eslint.config.js`、`prettier.config.cjs`、`cspell.json`、`vitest.workspace.ts`、`playwright.config.ts`
- [ ] 创建 `apps/web`、`apps/api`、`apps/worker` 和 `packages/*` 包清单。
- [ ] 固定 packageManager 版本并生成 lockfile。
- [ ] 配置 `lint`、`format:check`、`spellcheck`、`typecheck`、`test:unit`、`test:component`、`test:integration`、构建脚本。
- [ ] 配置 ESLint、Prettier、Spellcheck、Vitest 和 Playwright。
- [ ] 验证 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test:unit -- --run`。

### T002 配置 Husky、Commitlint 和 Commitizen

- **依赖：** T001
- **文件：** `.husky/pre-commit`、`.husky/pre-push`、`commitlint.config.cjs`、`package.json`
- [ ] 配置 `pnpm commit` 使用 Commitizen。
- [ ] 配置 Conventional Commits 类型和中文提交说明兼容性。
- [ ] pre-commit 只执行 lint-staged、类型检查和快速单元测试。
- [ ] pre-push 执行质量门禁，不执行自动 commit。
- [ ] 用错误提交类型和正确提交类型各验证一次。

## 阶段 1：基础设施与领域

### T003 扩展 Docker Compose 本地依赖

- **依赖：** T001
- **Worktree：** `feat/content-batch-infra`
- **文件：** `Docker/compose/docker-compose.yml`、`Docker/compose/.env.example`、`Docker/README.md`
- [ ] 保留 PostgreSQL 和 Redis 官方 latest 镜像。
- [ ] 增加 MinIO 官方镜像、数据卷和健康检查。
- [ ] 通过环境变量设置端口和密码，禁止写入真实凭证。
- [ ] 验证 `docker compose config` 和服务健康状态。

### T004 建立 Prisma 数据模型和迁移

- **依赖：** T003
- **文件：** `prisma/schema.prisma`、`prisma/seed.ts`、`apps/api/src/database/*`
- [ ] 创建 User、Workspace、WorkspaceMember、Brand、Source、TranscriptSegment、ContentInsight、ContentBatch、Asset、AssetVersion、ReviewAction、ExportJob、TaskRun。
- [ ] 为租户实体增加 `workspace_id` 和索引。
- [ ] 为 task idempotency key、source hash 和用户邮箱增加约束。
- [ ] 编写迁移执行和回滚前检查。
- [ ] 验证 seed 只创建测试数据。

### T005 实现领域状态机和验证器

- **依赖：** T001
- **Worktree：** `feat/content-batch-domain`
- **文件：** `packages/domain/src/*.ts`、`packages/domain/src/*.test.ts`
- [ ] 先写 Source/Batch/Asset/Review 状态转换失败测试。
- [ ] 实现合法、非法、重复和取消转换。
- [ ] 实现 MP4/MP3/WAV/TXT、1GB、60 分钟校验。
- [ ] 实现三平台能力卡片、资产类型和导出 manifest 类型。
- [ ] 达到核心领域行覆盖率 ≥95%、分支覆盖率 ≥90%。

## 阶段 2：API 与异步任务

### T006 实现注册、登录、刷新、登出

- **依赖：** T004、T005
- **Worktree：** `feat/content-batch-auth`
- **文件：** `apps/api/src/auth/*`、`apps/api/src/common/*`、`apps/api/src/auth/*.test.ts`
- [ ] 先写注册、错误密码、重复邮箱、过期 token 和刷新轮换失败测试。
- [ ] 实现 Access Token + Refresh Token。
- [ ] Web 设置 HttpOnly Cookie；错误不泄漏邮箱存在性。
- [ ] 实现 logout 撤销 refresh token。
- [ ] 实现 Owner、Editor、Reviewer 守卫。

### T007 实现工作区和租户权限

- **依赖：** T006
- **文件：** `apps/api/src/workspaces/*`、`apps/api/src/common/tenant-context.ts`
- [ ] 创建默认 Workspace 和 Brand。
- [ ] 实现成员邀请和角色查询。
- [ ] 为每个资源查询增加 workspace 归属校验。
- [ ] 写 A workspace 访问 B workspace 的越权测试。

### T008 实现 Storage Adapter

- **依赖：** T003、T005
- **Worktree：** `feat/content-batch-storage`
- **文件：** `apps/api/src/storage/storage.port.ts`、`apps/api/src/storage/minio-storage.adapter.ts`、OSS 适配器接口测试
- [ ] 先写上传、下载、删除和不存在 key 的失败测试。
- [ ] 实现 MinIO 本地存储。
- [ ] 预留 OSS 实现所需的接口，不在本地测试调用真实 OSS。
- [ ] 文件 key 包含 workspace 和 source id，避免跨租户覆盖。

### T009 实现 BullMQ 队列和 Source 处理 Worker

- **依赖：** T004、T005、T008
- **Worktree：** `feat/content-batch-source-processing`
- **文件：** `apps/worker/src/queue/*`、`apps/worker/src/source-processing/*`、`packages/test-utils/src/*`
- [ ] 先写任务状态、幂等、取消、重试和失败映射测试。
- [ ] 实现 `source.transcribe` 和 `source.analyze`。
- [ ] 保存 queued/running/succeeded/failed/cancelled 状态。
- [ ] 刷新页面后可以通过 task id 恢复状态。

### T010 实现火山引擎语音识别和文本 Provider

- **依赖：** T009
- **Worktree：** `feat/content-batch-volcengine-provider`
- **文件：** `packages/domain/src/ai-provider.ts`、`apps/worker/src/providers/mock.provider.ts`、`apps/worker/src/providers/volcengine.provider.ts`
- [ ] 写 Provider 接口合同测试。
- [ ] 写 Mock Provider，默认供测试和无凭证环境使用。
- [ ] 接入火山引擎语音识别和文本生成 API。
- [ ] 通过环境变量配置 endpoint、model、access key 和 secret。
- [ ] 映射超时、限流、鉴权失败、内容错误和未知错误。
- [ ] 真实 Provider smoke 必须显式开启，不进入默认 CI。

### T011 实现内容源 API

- **依赖：** T007、T008、T009
- **文件：** `apps/api/src/sources/*`
- [ ] 写文件类型、大小、时长、重复 hash 和未授权访问测试。
- [ ] 实现 source 创建、上传完成、处理、查询和取消。
- [ ] 处理接口创建 BullMQ 任务而不是阻塞 HTTP。
- [ ] 返回统一错误结构和 request id。

## 阶段 3：内容生成与导出

### T012 实现三平台内容模板

- **依赖：** T005、T010
- **Worktree：** `feat/content-batch-platform-templates`
- **文件：** `packages/domain/src/platform-templates/douyin.ts`、`xiaohongshu.ts`、`wechat-channels.ts`、对应测试
- [ ] 写标题、正文、标签、CTA、脚本和字数限制测试。
- [ ] 实现三平台独立模板，不共享平台限制常量。
- [ ] 生成规则保留 source/transcript/insight 引用。

### T013 实现内容批次生成 API/Worker

- **依赖：** T010、T012
- **Worktree：** `feat/content-batch-generation`
- **文件：** `apps/api/src/content-batches/*`、`apps/worker/src/generation/*`
- [ ] 写 3 平台 × 2 资产、额度不足、部分成功、取消和重试测试。
- [ ] 实现批次创建、生成任务、资产列表和任务状态。
- [ ] 默认每个平台生成 2 条资产。
- [ ] 保存 provider、model、源版本、参数和引用。

### T014 实现资产编辑和版本

- **依赖：** T013
- **文件：** `apps/api/src/assets/*`、`packages/domain/src/asset-version.ts`
- [ ] 写自动保存失败、版本递增、恢复和跨平台隔离测试。
- [ ] 实现标题、正文、标签、CTA、媒体引用和来源引用编辑。
- [ ] 只有当前版本可以提交审核和导出。

### T015 实现审核流程

- **依赖：** T007、T014
- **文件：** `apps/api/src/reviews/*`、`packages/domain/src/review.ts`
- [ ] 写 Editor 提交、Reviewer 批准、退回无原因失败和 Owner 权限测试。
- [ ] 实现 needs_review、needs_changes、approved 状态流转。
- [ ] 保存 actor、时间、前后状态、版本和退回原因。

### T016 实现 ZIP 发布包导出

- **依赖：** T012、T014、T015
- **Worktree：** `feat/content-batch-export`
- **文件：** `apps/api/src/exports/*`、`apps/worker/src/export/*`、`packages/domain/src/export-manifest.ts`
- [ ] 写 draft/needs_review/approved 的导出权限和失败测试。
- [ ] 实现 README、manifest、平台目录、文案、标签、CTA 和 CSV 发布清单。
- [ ] 实现 ExportJob 状态、幂等和重试。
- [ ] 验证导出 ZIP 目录与 spec 一致。

## 阶段 4：Web 和自动化验收

### T017 建立 Web 页面和 API Client

- **依赖：** T006、T007、T011、T013
- **Worktree：** `feat/content-batch-web`
- **文件：** `apps/web/src/routes/*`、`apps/web/src/components/*`、`packages/api-client/src/*`
- [ ] 写登录、上传、生成进度、编辑保存、权限和错误态组件测试。
- [ ] 实现登录、工作区、上传、内容批次、资产编辑和审核页面。
- [ ] 统一使用 `getByRole`、`getByLabel` 和 `getByTestId` 可测试定位。
- [ ] 覆盖 360px、1280px 和 1440px 关键布局。

### T018 建立 React Testing Library 组件回归

- **依赖：** T017
- **文件：** `apps/web/src/**/*.test.tsx`
- [ ] 覆盖上传 loading/success/error/retry。
- [ ] 覆盖生成 queued/processing/succeeded/failed/cancelled。
- [ ] 覆盖编辑自动保存和保存失败保留本地内容。
- [ ] 覆盖 Owner/Editor/Reviewer 操作差异。

### T019 建立 Playwright P0 smoke

- **依赖：** T016、T017、T018
- **Worktree：** `test/content-batch-playwright`
- **文件：** `tests/integration/fixtures/*`、`tests/integration/content-batch.spec.ts`、`content-batch-failure.spec.ts`、`responsive.spec.ts`
- [ ] 写注册、上传、处理、生成、编辑、审核、导出主流程。
- [ ] 写 429 重试、额度不足、越权和导出失败流程。
- [ ] 配置 Chromium、WebKit、手机视口和 Pad 横屏项目。
- [ ] 保存失败 trace、截图和视频，脱敏所有 token 和个人信息。

### T020 配置 CI 和构建门禁

- **依赖：** T001、T002、T003、T018、T019
- **Worktree：** `ci/content-batch-quality-gates`
- **文件：** `.github/workflows/quality.yml`、`.github/workflows/pr.yml`、`.github/workflows/push.yml`
- [ ] PR 和 push 运行 frozen install、lint、format、spellcheck、typecheck。
- [ ] 运行 Vitest coverage、React Testing Library 和 Playwright smoke。
- [ ] 构建 Web、API、Worker 并执行 Docker Compose config。
- [ ] 失败阻断合并；产出测试报告、覆盖率和构建日志。

## 阶段 5：最终收敛

### T021 完成 Spec Kit Analyze 与需求追踪

- **依赖：** T001—T020
- [ ] 检查每个 FR 是否至少有一个实现任务和一个测试。
- [ ] 检查 spec、plan、tasks 没有互相矛盾。
- [ ] 检查所有 P0 验收目标都有命令或测试证据。
- [ ] 检查未完成项、风险和外部依赖已记录。

### T022 完成最终审查和自主验收

- **依赖：** T021
- [ ] 运行完整验证命令总表。
- [ ] 执行任务级和最终代码审查。
- [ ] 修复 Critical/Important 问题。
- [ ] 更新 README、技术架构、QA 和 DevOps 文档。
- [ ] 输出发布清单和下一阶段工作列表。

## 任务并行关系

```text
T001
├── T002
├── T003 → T004
└── T005
    ├── T006 → T007
    ├── T008 → T009 → T010 → T011
    └── T012 → T013 → T014 → T015 → T016
                                      └── T017 → T018 → T019 → T020
T021 → T022
```
