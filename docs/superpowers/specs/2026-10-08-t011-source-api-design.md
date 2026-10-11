# T011 内容源 API 与异步上传校验设计

状态：已由用户确认，待实现

日期：2026-10-08

关联 Spec Kit feature：`content-batch-pipeline`（任务 T011）

实现分支：`feat/t011-source-api`，基于 main 的 T010 文档提交。

## 1. 目标与范围

为 MP4、MP3、WAV、TXT 内容源提供租户隔离的创建、上传、服务端校验、处理、查询和取消 API。上传采用短时效预签名 URL 直传 S3/MinIO；上传完成后由 Worker 异步核验对象字节、格式及媒体时长。处理 API 只创建一个可查询的异步业务任务，不阻塞 HTTP。

仅支持当前 feature spec 列出的 MP4、MP3、WAV、TXT。PRD 中尚未进入该 feature spec 的 MOV、PDF、DOCX、URL 暂不实现。音视频只排 `source.transcribe`，TXT 只排 `source.analyze`；转写后的分析编排、TranscriptSegment/ContentInsight 持久化和 T010 Provider 生产接入不在本任务范围。

## 2. 已确认决策

| 决策         | 方案                                                                                                                 | 原因                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 上传方式     | S3/MinIO 预签名 PUT 直传                                                                                             | 单文件上限 1 GiB，不经过 API 带宽与内存。               |
| 校验时机     | 上传完成后创建异步 `source.validate` TaskRun                                                                         | 媒体解析可能读取完整文件，避免 API 请求等待大文件扫描。 |
| 实际文件校验 | Worker 读取对象流，验证真实格式、非空/大小和 MP4/MP3/WAV 时长 ≤ 60 分钟                                              | 文件名、Content-Type 和客户端时长均不可信。             |
| 内容摘要     | 上传前客户端提供 SHA-256；预签名绑定 checksum；上传完成核验对象 checksum；兼容存储未返回 checksum 时 Worker 流式重算 | 支持 workspace 内可靠重复检测，不以 ETag 代替 SHA-256。 |
| 任务流程     | TXT→单个 `source.analyze`；音视频→单个 `source.transcribe`                                                           | T009 只有独立任务，没有转写后自动分析的合同。           |
| 重复文件     | 唯一约束 `(workspaceId, contentHash)` 返回冲突/重复提示，不自动删除对象                                              | 保留用户控制权并避免误删。                              |
| 取消         | 取消 Source 与活动 TaskRun；保留对象。预签名 URL 无法即时撤销，最多在短 TTL 后失效                                   | 避免不可逆删除，明确签名 URL 取消限制。                 |
| 租户与角色   | 每次资源访问均携带 guard 生成的 `workspaceId`；创建、处理、取消限 owner/editor；同租户成员可读取                     | 遵循 T007 租户归属约束和 reviewer 只读角色。            |

对象 checksum 签名及 MinIO 实际兼容性必须通过适配器契约测试与显式本地 MinIO 集成测试确认。上传完成时还核对 Storage 的 Content-Length、Content-Type；签名 MIME 是声明校验，真实格式以 Worker 检查为准。

## 3. API 合同

| 方法与路径                                | 权限          | 行为与响应                                                                                                                                                                              |
| ----------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /sources`                           | owner/editor  | 校验元数据与 SHA-256；创建 `uploading` Source；返回 `sourceId`、`uploadUrl`、必需签名 headers、到期时间。workspace 内重复 hash 返回统一冲突错误。                                       |
| `POST /sources/:sourceId/upload-complete` | owner/editor  | 在当前 workspace 查找 Source，Head 对象并比对长度/MIME/checksum；创建确定性 `source.validate` TaskRun 并发布队列；返回 `202`、Source 和 validation task id。重复调用返回现有状态/任务。 |
| `GET /sources/:sourceId`                  | tenant member | 仅在当前 workspace 查询 Source，并附当前 validation/processing TaskRun 状态。跨 workspace 表现为资源不存在。                                                                            |
| `POST /sources/:sourceId/process`         | owner/editor  | 只允许已验证 `uploaded` Source；按格式选择一个业务 task，幂等创建并排队，返回 `202` 与 TaskRun。重复提交返回同一在途任务。                                                              |
| `POST /sources/:sourceId/cancel`          | owner/editor  | 仅取消非终态 Source 和活动 TaskRun；对象保留；重复取消幂等。                                                                                                                            |

所有错误沿用 API 统一 `code/message/request_id/details` 结构；不返回 S3、Prisma、BullMQ 或媒体解析器原始错误。请求与数据库变更按 `(workspaceId, sourceId)` 限定。API 的队列发布失败时保留可幂等重试的 queued TaskRun；相同确定性 BullMQ job id 防止重复入队。

## 4. 状态、数据与职责

Source 状态增加 `validating`，形成：

```text
created → uploading → validating → uploaded → queued → processing → succeeded/failed
    └──────────────→ cancelled       └──────────────→ cancelled
```

`upload-complete` 只在对象存在且声明的长度、MIME、checksum 匹配后将 Source 置为 `validating` 并创建校验任务。Worker 完成实际字节校验后：成功时写入探测到的 `durationSeconds` 并转为 `uploaded`；失败时置 `failed`，保存安全的错误代码/文案。业务任务开始/结束时 Worker 同步更新 Source 与 TaskRun 状态。状态更新使用 workspace 条件和允许的状态转换，避免已取消任务覆盖终态。

StoragePort 增加 `createPresignedPut` 和 `headObject` 能力，引用始终由可信 workspace/source ID 生成对象 key。API 增加 Source repository/service/controller、BullMQ publisher 与模块注册。Worker 增加对象流读取 port/MinIO reader、媒体 validator 和 Source 状态写入；共享 `SourceTaskType` 增加 `source.validate`。媒体解析使用可流式处理 MP4/MP3/WAV 的 `music-metadata`；TXT 必须为有效 UTF-8 文本。解析器无法得出可信时长时 fail closed。

数据库迁移只新增 `SourceStatus.validating`；不得改动已有 Source/TaskRun 数据或移除状态。TaskRun 已使用字符串 `taskType`，因此 `source.validate` 不要求新增列。

## 5. 安全与异常

- 不接受请求体提供的 workspaceId；只使用 `TenantMembershipGuard` 放入请求的可信上下文。
- Source 查询、更新、取消、重复检测和 TaskRun 读取均带 `workspaceId`；空 workspace 不执行无条件查询。
- 预签名有效期默认 15 分钟且只允许写一个由服务端生成的 Source key；不得日志记录完整签名 URL。
- 文件长度必须满足 `0 < sizeBytes ≤ 1,073,741,824`；时长必须为正且不超过 3,600 秒；MIME/扩展名/内容签名必须一致。
- 同 workspace 重复 hash 返回 `SOURCE_DUPLICATE`；跨 workspace 不透露资源是否存在。
- 数据库写入后队列发布故障时，允许同幂等键重发；重复 jobId 不产生重复执行。
- 取消不承诺撤销已签发 URL；Worker 在处理前检查 TaskRun/Source 状态并尊重取消。
- 所有测试使用 fake queue、fake storage 或显式 MinIO 沙箱，不访问生产存储或账号。

## 6. 验收

- Vitest 覆盖领域状态机、格式/摘要/时长边界、Storage 签名/Head、Source API 权限与幂等、Worker 内容校验与 Source/TaskRun 状态同步、取消和队列失败重试。
- API integration smoke 覆盖创建、上传完成后的异步校验、校验后排队、读取状态、跨租户拒绝和取消。
- 显式配置后执行 MinIO 单文件 PUT、checksum Head 和上传完成验证；默认测试不得要求 MinIO。
- 更新 T011 Spec Kit tasks、API/环境变量/本地 MinIO 测试文档；执行 lint、format、spellcheck、typecheck、相关单元/组件/集成测试、API/Worker 构建、数据库迁移验证和 Docker Compose config。
- 不提交、不 push、不合并，不删除 Worktree；只有用户明确要求时才执行相应 Git 操作。

## 7. 已知限制与后续任务

- T011 只排转写或分析的一个首阶段任务；转写结果持久化、转写后自动分析、ContentInsight 写入以及 T010 Provider 接入需独立任务定义。
- 取消不能撤销已经发出的预签名 PUT URL；对象清理/生命周期策略不在 T011 内。
- 单文件 PUT 的存储端硬性最大长度约束需以目标 S3/MinIO 兼容性测试确认；API 在上传完成时对真实长度 fail closed。
- `music-metadata` 需通过 MP4/MP3/WAV fixture 验证时长精度；畸形文件和无法解析时长均拒绝进入 `uploaded`。
