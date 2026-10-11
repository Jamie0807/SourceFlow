# T011 Task 5 实施简报：Worker MinIO Reader 与真实媒体 validator

## 目标

严格按 `docs/superpowers/plans/2026-10-08-t011-source-api.md` Task 5 实现 workspace-scoped MinIO 对象读取与 MP4/MP3/WAV/TXT 内容校验。遵循 TDD，先写失败测试，再实现；不得修改/提交其他任务边界外的工作。

## 输入与依赖

- 已批准 T011 设计：MP4、MP3、WAV、TXT；最大 1 GiB；音视频最大 3600 秒；根据真实文件内容校验，不能信任客户端声明 MIME。
- Task 4 已完成并复审 Ready。现有 Worker `SourceRecord` 只有 id/workspaceId/status/storageKey/contentHash；validator 还需要持久化的 `mimeType` 和 `sizeBytes`。本任务可最小扩展该记录与 `PrismaSourceLookup` select，需保持 workspace 条件 `{ id, workspaceId, deletedAt: null }`。
- 使用官方 `music-metadata` `parseStream` API 并启用 `{ duration: true }`，对对象流式读取；不要将完整对象缓存到内存。TXT 用严格 UTF-8 流校验。
- 工具现状：本机无 ffmpeg、仓库无媒体 fixtures；优先使用可复现的小型内嵌/程序化测试数据。不允许测试访问真实服务或生产凭据。若某格式无法可靠构造，应记录精确覆盖缺口，不要伪造通过。

## 范围

- 新增 `apps/worker/src/source-processing/source-media-reader.ts`、`minio-source-media-reader.ts`、`source-media-validator.ts` 与针对性测试。
- 更新 `apps/worker/package.json` 和 `pnpm-lock.yaml`，只加必要依赖。
- 为 validator 增加小型合法 MP4/MP3/WAV/TXT 输入与拒绝用例：空对象、无效 UTF-8 TXT、声明 MIME 与检测格式不符、损坏媒体、缺失/未知时长、3601 秒、超过 1 GiB；边界 3600 秒可接受。
- Reader 从 workspaceId/sourceId 安全构造 object key，使用 S3 `GetObjectCommand`，返回 Readable 与元数据；对象缺失/无 body/异常应安全失败。
- Validator 重算 SHA-256 并与 Source.contentHash 比较，校验实际/存储 MIME，验证实际字节数与 Source.sizeBytes、1 GiB 限制、真实媒体时长 ≤3600；不完整、未知或不可信 metadata fail closed。
- Worker 不能 import API 模块；不得在本任务接入 handler/runtime（属于 Task 6）。

## 验收

- TDD RED 证据和 GREEN 结果写入 `.superpowers/sdd/t011-task-5-report.md`。
- Worker 相关测试、`corepack pnpm build:worker`、根 `typecheck` 和改动文件 lint/format/spellcheck 通过。
- `git diff --check` 通过；说明任何未执行的真实 MinIO smoke、MP4/MP3 parser 精度限制或 fixture 缺口。
- 本次不 commit、push、合并或清理 worktree。
