# T010 火山引擎语音识别与文本 Provider 设计

状态：已确认，待计划

日期：2026-10-03

关联 Spec Kit feature：`content-batch-pipeline`（任务 T010）

前置依赖：T009 Source 处理 Worker 的变更必须先成为稳定的可复用基线；实现阶段将在独立 `feat/content-batch-volcengine-provider` Worktree 进行。

## 1. 目标与范围

本任务为 SourceFlow Worker 提供可替换的 AI 能力：

- 通过火山引擎 LAS `las_asr_pro` 异步算子处理音频和视频转写；支持项目既定的 MP4、60 分钟、1GB 输入边界。
- 通过火山方舟 OpenAI 兼容接口生成文本分析结果。
- 在无凭证和所有自动化测试环境默认使用 Mock，真实调用仅允许显式启用的手动 smoke。
- 将 Provider 的成功结果和失败分类映射为稳定、可测试的 Provider 契约；本任务不注册生产 SourceProcessor，也不持久化 TranscriptSegment 或 ContentInsight。

不在范围内：媒体转码、向火山 TOS 迁移、真实服务的默认 CI 调用、Source API、最终转写/洞察实体的数据库写入，以及把真实 Provider 接入 T009 的 SourceTaskHandler。

## 2. 已确认决策

| 决策           | 方案                                             | 原因                                                               |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| ASR 产品       | LAS `las_asr_pro` 异步转写                       | LAS 支持音频与视频、大文件及轮询结果，符合 MP4/1GB 的产品边界。    |
| ASR 输入       | 私有对象生成短时、只读、外部可下载的签名 URL     | 不公开桶或源文件；LAS 只接收公网 URL 或 TOS 路径。                 |
| URL 默认有效期 | 2 小时；可在 15 分钟至 24 小时范围内配置         | 给远端下载与排队留出余量，同时限制泄露窗口。                       |
| ASR 鉴权       | `LAS_API_KEY`，Bearer 认证                       | LAS 官方接口使用独立 API Key。                                     |
| 文本鉴权       | `ARK_API_KEY`                                    | Ark 与 LAS 是独立产品面，应独立最小授权与轮换。                    |
| 默认 Provider  | `AI_PROVIDER=mock`                               | 无凭证开发、单元测试和 CI 不访问真实账号。                         |
| 远端任务取消   | 本地立即停止轮询并写入 `cancelled`；不再回写结果 | LAS 文档未提供取消 API；已提交任务可能继续运行并产生已发生的用量。 |

参考：LAS ASR 增强版说明（输入 URL/TOS、异步 Submit/Poll、MP4/大文件能力）<https://docs.volcengine.com/docs/LakeAIService/SpeechtotextautomaticspeechrecognitionDoubao-recordingfilerecognitionenhancedversion?lang=en>；Ark OpenAI 兼容接口说明 <https://docs.volcengine.com/docs/ark/compatible-with-openai-sdk?lang=en>。

## 3. 架构与职责

```text
T011 / 后续任务编排
  -> SourceProcessor（届时接入 T009 的 Worker 边界）
       -> AiProvider（T010 建立的共享、可替换契约）
            -> MockProvider
            -> VolcengineProvider
                 -> LAS Submit / Poll（转写）
                 -> Ark chat completions（文本分析）
       -> SourceMediaUrlPort（后续为私有 Storage 对象签发短时 URL）
```

### 3.1 `packages/domain/src/ai-provider.ts`

定义与基础设施无关的 Provider 契约、输入、结构化转写结果、文本分析结果以及内部错误类别。契约不暴露 HTTP、API Key、S3/MinIO 或 LAS 原始响应。

其中转写结果至少包含完整文本、可选的毫秒级分句、Provider 名称、模型/资源版本和安全元数据；文本分析结果至少包含章节、关键观点、金句、候选片段和风险提示。所有跨边界输出均为 JSON-safe 值。

### 3.2 Worker Provider 与适配器

`MockProvider` 生成确定性结果，供无凭证和测试环境使用。`VolcengineProvider` 封装：

- LAS 的 Submit/Poll 请求、轮询退避、总超时及安全响应解析；
- Ark OpenAI 兼容的文本请求与严格 JSON 响应解析；
- 不记录 Authorization、签名 URL 查询参数、原始响应内容或上游异常消息。

T010 只暴露 Provider factory 与契约，不改动 T009 `SourceProcessor` 的生产注册。后续任务在转写持久化与任务编排稳定后，由 SourceProcessor 根据 Source MIME type 分派：`text/plain` 读取私有对象正文并跳过 ASR；音频/视频先从 `SourceMediaUrlPort` 获取签名 URL，再调用 LAS。

### 3.3 私有媒体 URL

后续任务新增 Worker 内部 `SourceMediaUrlPort`，仅接受 `workspaceId`、`sourceId` 和 Storage key，并返回短时 HTTPS URL。具体 S3/MinIO/OSS 签名实现隐藏在端口后。T010 的转写契约仅接收调用方提供的 HTTPS 媒体 URL，不直接访问 Storage。

真实 LAS 模式要求签名 URL 的公网域名可被 LAS 下载。开发机上的 `localhost` MinIO 不具备此条件，因此本地集成仍使用 Mock；真实 smoke 使用显式提供的公网测试媒体 URL，不读取用户对象。

## 4. 任务流与取消

### Provider 调用语义

- `transcribe` 接收调用方提供的 HTTPS 媒体 URL，向 LAS Submit 后轮询至完成、失败或总超时；每次轮询可接收取消信号，取消只停止本地等待。
- `analyze` 接收已经取得的纯文本转写，调用 Ark 并校验结构化 JSON 输出。
- T010 不从 `TaskRun` 推断或读取前一个任务的结果，也不改动 T009 的生产 Handler；T011/T013 在定义转写持久化和任务编排后调用上述契约。

## 5. 错误、安全与可观测性

| 上游情况                                            | 任务映射                      | 重试 |
| --------------------------------------------------- | ----------------------------- | ---- |
| 网络错误、超时、429、5xx、LAS pending 超时          | `PROCESSOR_TEMPORARY_FAILURE` | 是   |
| 无效密钥、缺少配置、401/403、请求参数或媒体格式错误 | `PROCESSOR_INVALID_INPUT`     | 否   |
| Ark JSON 不符合契约                                 | `PROCESSOR_INVALID_INPUT`     | 否   |
| 其他不可安全分类的异常                              | `PROCESSOR_UNKNOWN_FAILURE`   | 是   |

面向用户、队列和日志的错误使用固定安全文案。诊断日志只记录安全分类、任务标识和上游 request ID（若存在）；不得记录密钥、签名 URL、媒体正文、Ark prompt 或原始 Provider 错误内容。

环境变量仅在真实模式校验：

```text
AI_PROVIDER=mock|volcengine
LAS_API_KEY=
ARK_API_KEY=
LAS_ASR_SUBMIT_URL=https://operator.las.cn-beijing.volces.com/api/v1/submit
LAS_ASR_POLL_URL=https://operator.las.cn-beijing.volces.com/api/v1/poll
LAS_ASR_RESOURCE=bigasr|seedasr
LAS_ASR_POLL_INTERVAL_MS=
LAS_ASR_TIMEOUT_MS=
SOURCE_MEDIA_URL_TTL_SECONDS=7200
```

Storage URL 签发所需的 endpoint、bucket 和凭证延续 Storage Adapter 的 Secret 管理方式；不把实际值写入 `.env.example` 以外的版本控制文件。

## 6. 测试与验收

先以 Vitest 写失败测试，再实现最小行为。至少覆盖：

- `AiProvider` 输入/输出及 JSON-safe 契约；
- Mock 的确定性转写与分析；
- LAS Submit/Poll 成功、pending、完成、超时、429、5xx、401/403、错误响应和异常访问器；
- Ark 成功、非 JSON/缺字段输出、429、超时、鉴权失败；
- HTTPS 媒体 URL 输入校验与禁止泄露；
- 取消信号停止 Poll；
- Provider factory 的选择与真实模式缺失配置的安全失败。

真实 smoke 必须同时显式开启、提供 `LAS_API_KEY` 和 `ARK_API_KEY`，并使用单独的公网测试媒体；不进入默认 Vitest、Playwright 或 CI。验收时还需运行 lint、format、spellcheck、typecheck、相关单元测试、Worker 构建与 Docker Compose config。

## 7. 实施前置条件与风险

- T009 已提交并合入 `main`，可作为 T010 的干净 Worktree 基线。
- T011 或后续编排任务必须实现私有对象的 HTTPS 短时签名 URL；否则真实模式不得退化为公开桶。
- 远端 LAS 任务无法按本地取消停止，需在用户界面和运维文档中诚实披露可能已发生的用量。
- T010 的 Provider 输出契约在 T011/T013 接入持久化前不得擅自写入最终业务实体或注册为 T009 的生产 Processor。
