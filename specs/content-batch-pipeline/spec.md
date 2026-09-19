# Content Batch Pipeline 需求规格

状态：已确认，进入实现计划阶段
版本：0.1
日期：2026-09-19
所属产品：SourceFlow

## 1. 功能摘要

本功能是 SourceFlow 的首个可运行垂直切片，验证一条内容从上传到可发布资产的完整闭环：

```text
邮箱登录
→ 创建工作区
→ 上传内容源
→ 语音识别/内容理解
→ 生成多平台资产
→ 编辑和版本保存
→ 审核
→ 导出 ZIP 发布包
```

第一阶段只实现 Web 端，服务端拆分 API 和 Worker；移动端和 Electron 复用稳定后的 API 与领域模型，不进入本功能实现范围。

## 2. 已确认技术决策

| 决策项 | 已确认方案 |
| --- | --- |
| 仓库 | pnpm monorepo |
| Web | React + TypeScript + Vite |
| 服务端 | NestJS + Fastify Adapter |
| 数据库访问 | Prisma + PostgreSQL |
| 异步任务 | BullMQ + Redis |
| 文件存储 | 本地开发 MinIO，生产阿里云 OSS，通过 Storage Adapter 隔离 |
| 登录 | Access Token + Refresh Token；Web 使用 HttpOnly Cookie |
| AI Provider | 火山引擎真实 Provider + Mock Provider |
| AI 能力 | 火山引擎语音识别 + 文本生成；不做真实视频剪辑渲染 |
| 首批平台 | 抖音、小红书、视频号，仅生成导出发布包 |
| 角色 | Owner、Editor、Reviewer |
| 测试 | Vitest、React Testing Library、Playwright |
| 部署阶段 | 本地 Docker + CI 优先，暂不部署阿里云 |

## 3. 目标与成功标准

### 3.1 用户目标

个人创作者或小团队成员可以把一条音视频内容转化为一组经过审核、可以直接人工发布的多平台资产，而不需要在多个工具之间复制粘贴。

### 3.2 验收目标

- 用户在 5 分钟内完成邮箱注册、登录和工作区创建。
- 用户在 10 分钟内上传 MP4、MP3、WAV 或 TXT 文件。
- 单个音视频最长 60 分钟、最大 1GB；超限在上传前阻止。
- 处理任务展示 queued、processing、succeeded、failed、cancelled 状态。
- 语音内容完成转写，并生成章节、关键观点、金句和候选片段时间段。
- 选择抖音、小红书、视频号后，每个平台至少生成 2 条资产，共至少 6 条。
- 用户可以修改标题、正文、标签和 CTA，保存为新版本并恢复旧版本。
- Owner/Editor 可以提交审核，Reviewer 可以批准或带原因退回。
- 用户可以导出 ZIP，包含平台目录、媒体/片段、文案、标签、CTA 和发布清单。
- 关键流程拥有 Vitest、React Testing Library 和 Playwright smoke 覆盖。

## 4. 非目标

- 不做真实平台自动发布和真实平台数据回传。
- 不做视频成片剪辑、自动字幕渲染、封面生成和多轨编辑。
- 不做网页链接、直播链接、PDF、DOCX 和云盘导入。
- 不做手机/Pad 原生 App 和 Electron 完整客户端。
- 不做多品牌、客户空间、复杂 CRM、评论/私信中心和支付订阅。
- 不做短信登录、OAuth 登录和企业 SSO。

## 5. 角色与权限

| 角色 | 权限 |
| --- | --- |
| Owner | 创建工作区、上传、生成、编辑、审核、导出、成员管理 |
| Editor | 上传、生成、编辑、保存版本、提交审核、查看被授权内容 |
| Reviewer | 查看待审核资产、评论、批准、退回并填写原因 |

第一个垂直切片只允许 Owner 创建工作区和邀请成员；不实现复杂的品牌级权限矩阵，但数据模型必须保存 `workspace_id`、`created_by` 和审计主体。

## 6. 用户故事

### US-001 注册和工作区

作为创作者，我可以使用邮箱注册并创建一个工作区，以便开始管理内容。

验收：注册成功后建立默认 Workspace、默认 Brand 和 Owner 成员关系；重复邮箱返回明确错误；密码不以明文保存。

### US-002 上传内容源

作为创作者，我可以上传 MP4、MP3、WAV 或 TXT，以便系统理解我的原始内容。

验收：文件类型、大小和时长在服务端校验；文件进入存储后生成 Source；前端展示上传和处理状态。

### US-003 内容理解

作为创作者，我可以看到转写、章节、关键观点、金句和候选片段，以便选择适合复用的内容。

验收：每个观点可以追溯到转写文本；候选片段带开始时间和结束时间；失败可重试；取消不会删除原文件。

### US-004 多平台生成

作为创作者，我可以选择三个平台和内容模板，以便一次生成多平台内容。

验收：每个平台至少生成 2 条资产；生成参数包含 source 版本、平台、模板、语言、语气、目标受众和 CTA；生成失败不扣除成功资产额度。

### US-005 编辑和版本

作为创作者，我可以编辑平台版本并保留历史版本，以便人工控制最终表达。

验收：编辑自动保存草稿；版本号递增；可以查看版本差异和恢复旧版本；不同平台版本互不覆盖。

### US-006 审核

作为 Reviewer，我可以批准或退回内容，以便团队在导出前完成质量控制。

验收：退回必须填写原因；批准或退回均写入审计日志；退回资产回到可编辑状态。

### US-007 导出发布包

作为创作者，我可以导出一个 ZIP 发布包，以便手动发布到抖音、小红书和视频号。

验收：ZIP 目录按平台分组；包含文案、标题、标签、CTA、媒体/片段引用、发布清单和批次元数据；导出过程可重试。

## 7. 功能需求

### FR-001 登录与会话

- `POST /auth/register` 创建用户。
- `POST /auth/login` 返回短期 Access Token 并设置 Refresh Token HttpOnly Cookie。
- `POST /auth/refresh` 轮换 Refresh Token。
- `POST /auth/logout` 撤销当前 Refresh Token。
- 密码使用强哈希保存；错误提示不得泄漏邮箱是否存在。
- Web 使用 HttpOnly、Secure、SameSite Cookie；本地开发允许非 Secure。

### FR-002 工作区

- 新用户注册后必须有一个 Workspace 和一个默认 Brand。
- Owner 可以邀请 Editor/Reviewer，邀请在 MVP 中使用一次性链接。
- 所有业务查询必须按 `workspace_id` 过滤并在服务端校验权限。

### FR-003 内容源上传

- 支持 MP4、MP3、WAV、TXT。
- 单文件最大 1GB；音视频最大 60 分钟。
- 使用内容 hash 做重复文件提示，不自动删除重复文件。
- 状态：`created → uploading → uploaded → queued → processing → succeeded/failed/cancelled`。
- 文件元数据保存文件名、MIME、大小、时长、hash、存储 key、上传人和创建时间。

### FR-004 内容理解

- 音视频调用火山引擎语音识别 Provider；TXT 跳过 ASR 直接进入文本分析。
- 文本分析生成章节、关键观点、金句、候选片段和风险提醒。
- Provider 必须支持 Mock 实现，测试和无凭证环境默认使用 Mock。
- 每次处理保存 provider、模型、请求版本、耗时、错误码和源版本。

### FR-005 多平台资产生成

- 平台枚举：`douyin`、`xiaohongshu`、`wechat_channels`。
- 首版模板：短视频口播脚本、平台正文、标题/封面标题、标签、CTA。
- 默认每个平台生成 2 条资产；用户可以减少数量，但不得超过当前任务额度。
- 生成结果必须保存引用的 Source/Transcript/Insight 版本。
- 火山引擎调用失败提供重试；未知错误进入人工可见的 failed 状态。

### FR-006 编辑与版本

- 资产字段：标题、正文、标签、CTA、平台、媒体引用、来源引用。
- 自动保存草稿，保存失败显示重试而不是覆盖本地编辑内容。
- 版本具有 `version_number`、`created_by`、`created_at` 和变更摘要。
- 只有当前版本可以进入审核和导出。

### FR-007 审核

- Editor/Owner 提交审核后资产状态为 `needs_review`。
- Reviewer 批准后为 `approved`，退回后为 `needs_changes`。
- 退回必须填写原因，原因对提交人可见。
- 审核动作记录 actor、时间、前后状态、版本和原因。

### FR-008 导出发布包

导出结果：

```text
sourceflow-batch-<batch-id>.zip
├── README.md
├── manifest.json
├── douyin/
│   ├── 01-title.txt
│   ├── 01-caption.md
│   ├── 01-tags.txt
│   └── publish-list.csv
├── xiaohongshu/
└── wechat-channels/
```

只有 `approved` 资产可进入发布包。导出时重新执行平台规格检查，失败时返回可定位错误。

## 8. 状态机

### 内容批次

`draft → generating → needs_review → approved → exportable → exported`

异常：`generation_failed`、`export_failed`、`cancelled`。

### 资产

`draft → needs_review → needs_changes → approved → exported`

`needs_changes → needs_review` 是允许的回流路径。

## 9. 数据模型

最小实体：

- `User`
- `Workspace`
- `WorkspaceMember`
- `Brand`
- `Source`
- `TranscriptSegment`
- `ContentInsight`
- `ContentBatch`
- `Asset`
- `AssetVersion`
- `ReviewAction`
- `ExportJob`
- `TaskRun`

所有实体至少包含 `id`、`created_at`、`updated_at`；租户资源包含 `workspace_id`。删除源文件前必须检查其引用的批次和资产，并采用软删除或显式确认策略。

## 10. API 轮廓

```text
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /workspaces/current
POST   /workspaces/current/members/invitations
POST   /sources
POST   /sources/:sourceId/upload-complete
GET    /sources/:sourceId
POST   /sources/:sourceId/process
POST   /content-batches
GET    /content-batches/:batchId
POST   /content-batches/:batchId/generate
GET    /content-batches/:batchId/assets
PATCH  /assets/:assetId
POST   /assets/:assetId/submit-review
POST   /assets/:assetId/approve
POST   /assets/:assetId/request-changes
GET    /assets/:assetId/versions
POST   /batches/:batchId/export
GET    /tasks/:taskId
GET    /health
```

API 返回统一错误结构：`code`、`message`、`request_id`、`details`。不能把 Provider 原始 token、内部堆栈或数据库错误返回给客户端。

## 11. 非功能需求

- 生成、转写和导出均为异步任务，页面刷新后可恢复状态。
- 同一幂等键不会创建重复处理任务或重复导出任务。
- 所有任务支持重试；重试次数和最后错误可见。
- API 健康检查至少包含进程、PostgreSQL 和 Redis 状态。
- P95 API 读请求目标 ≤ 500ms；长任务不阻塞 HTTP 请求。
- 上传和导出支持进度或明确的 queued/processing 状态。
- 日志结构化并包含 `request_id`、`workspace_id`、`task_id`，不包含密钥和完整线索信息。

## 12. 测试要求

- Vitest：领域状态机、权限、额度、文件校验、平台模板、版本、导出 manifest、Provider Mock。
- React Testing Library：上传状态、生成进度、编辑器自动保存、审核按钮权限、错误和空状态。
- Playwright：注册、上传、处理、生成、编辑、审核、导出、失败重试和手机视口 smoke。
- 所有 P0 验收目标至少有一个可执行测试或明确的人工验收步骤。

## 13. 完成定义

当且仅当以下条件全部满足，功能才可标记为完成：

- spec、plan、tasks 和需求检查清单全部更新。
- Web、API、Worker 可在本地 Docker 环境启动。
- Vitest、React Testing Library 和 Playwright smoke 通过。
- 火山引擎真实 Provider 可通过环境变量启用，Mock Provider 在无凭证环境可运行。
- 导出 ZIP 结构和平台检查通过。
- 权限、错误、重试、取消、审计和安全检查通过。
- ESLint、Prettier、Spellcheck、TypeScript 和构建门禁通过。
