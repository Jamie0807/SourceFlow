# T011 Task 5 验收报告：Worker MinIO Reader 与真实媒体 validator

日期：2026-10-08

工作区：`feat/t011-source-api`（独立 worktree）

## 完成内容

- 新增 `SourceMediaReader` 与 MinIO/S3 `GetObjectCommand` adapter；key 仅由安全校验过的 `workspaceId`、`sourceId` 构造为 `workspaces/<workspaceId>/sources/<sourceId>/original`，不采用数据库 `storageKey`。
- 对象以 Readable 流处理；校验长度、声明/对象 MIME、SHA-256、1 GiB 上限；TXT 使用 fatal UTF-8 decoder；MP3/WAV 使用 `music-metadata`；MP4 使用 `music-metadata` 识别并用 `mp4box` 核验非 fragmented 视频的头部、`stts`、`ctts`、`elst` 时长上界。
- Source lookup 仍限定 `{ id, workspaceId, deletedAt: null }`，补取 `mimeType` 与 `sizeBytes`，并将 Prisma BigInt 安全转换为 number。
- Worker handler/runtime 尚未接入 validator；留在 Task 6 范围。

## TDD 证据

- 修正 MP4 fixture 前，新增“合法 MP4 不产生 parser error”测试失败：MP4Box 报 `Invalid box type: NUL NUL NUL NUL`。将 `mp4a` sample entry 改为 28 字节后，回归通过且无 parser error。
- fragmented MP4 回归在修复前解析成功并返回 `durationSeconds: 1`（视频 timeline 3601 秒、音轨 1 秒）；修复后无法获得可信 video duration 即拒绝。
- MP4 头部 1 秒但 `stts` 最后一个 run 过长、`ctts` composition offset 超限、`elst` edit list 超限三个用例，均在对应逻辑修复前解析成功；补上完整 timeline 上界与表项一致性检查后均拒绝。
- 普通 MP4 测试同时覆盖视频长于音轨、3600 秒接受、3601 秒拒绝及缺少视频轨拒绝。

## 新鲜验证结果

- `corepack pnpm exec vitest run apps/worker/src/source-processing/source-media-validator.test.ts --reporter=verbose`：26/26 passed。
- `corepack pnpm exec vitest run apps/worker/src`：197 passed、1 skipped（Redis integration 未配置）。
- `corepack pnpm typecheck`：通过。
- `corepack pnpm build:worker`：通过（domain → worker）。
- `corepack pnpm lint`：通过。
- `corepack pnpm format:check`：通过。
- `corepack pnpm spellcheck`：131 files，0 issues。
- `git diff --check`：通过。
- 独立只读代码审查：Ready（实现范围）；审查者未重跑门禁，以上验证由本轮执行。

## 未执行项与边界

- 未配置 `MINIO_TEST_*`，未连接真实 MinIO 执行 GetObject smoke；MinIO 行为由 S3 client adapter contract tests 覆盖。
- Fragmented MP4 当前 fail closed：该实现无法对其 fragmented video timeline 可靠证明 3600 秒上限，故拒绝而不回退到音轨时长。
- MP4 测试数据程序化构造于测试文件，没有独立媒体 fixture 二进制；测试包含 box/sample/edit timing 边界。
- 未执行全仓覆盖率门禁、API/Web 构建、Docker Compose 或 Playwright；这些属于 T011 Task 7 的最终收敛范围。
- 本任务未 commit、push、合并或清理 worktree。
