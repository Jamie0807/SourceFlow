# T011 Task 2：Storage 预签名 PUT 与 HeadObject checksum 实现报告

## 范围与变更

- `apps/api/src/storage/storage.port.ts`：增加 `PresignedPutResult`、`StorageObjectMetadata`，并扩展 `StoragePort.createPresignedPut` / `headObject`。
- `apps/api/src/storage/minio-storage.adapter.ts`：使用 `PutObjectCommand` 与 `getSignedUrl` 生成 PUT URL，签入 SHA-256 checksum header，最长有效期 900 秒；使用 `HeadObjectCommand`（`ChecksumMode: ENABLED`）映射长度、MIME、SHA-256，并将对象不存在映射为 `StorageNotFoundError`。
- `apps/api/src/storage/minio-storage.adapter.test.ts`、`storage.port.test.ts`：覆盖不安全 ID、实际签名 URL 和必要请求 header、TTL、Head 元数据和缺失 checksum、not-found、port 契约。
- `apps/api/package.json`、`pnpm-lock.yaml`：加入 `@aws-sdk/s3-request-presigner`。lockfile 曾因 `pnpm add` 出现 4857 行格式重排；使用仓库 Prettier 格式恢复后，只余 19 行新增，分别是 importer、包和依赖快照，没有其他包版本漂移。

## RED / GREEN 证据

1. RED：`pnpm exec vitest run --config vitest.config.ts apps/api/src/storage/minio-storage.adapter.test.ts apps/api/src/storage/storage.port.test.ts`。首次沙箱执行因无法写入 `node_modules/.vite-temp` 返回 `EPERM`，未运行测试；在指定 checkout 的授权执行后，退出码 1，2 个文件中 18 通过、5 失败。失败原因为 `createPresignedPut is not a function`（2 项）和 `headObject is not a function`（3 项），符合缺少新 port 方法的预期。
2. 实现后 GREEN：同一命令，退出码 0，2 个文件、23 项测试全部通过。
3. 补强签名断言时，测试发现 SDK 的 `X-Amz-SignedHeaders` 不包含 `content-type`（1 项失败）。检查已安装的 `@aws-sdk/s3-request-presigner` 实现，`prepareRequest` 明确将 `content-type` 加入 `unsignableHeaders`。按 Task 2 brief，适配器返回该上传 header；签名强制覆盖 `x-amz-checksum-sha256`，并没有把 `content-type` 已签名当成已实现能力。
4. 最终 GREEN：同一 Storage Vitest 命令退出码 0，2 个文件、24 项测试全部通过。

## 聚焦验证与自审

- `pnpm exec tsc -p tsconfig.json --pretty false --noEmit`：退出码 0。
- `pnpm --filter @sourceflow/api build`：退出码 0（`tsc -p tsconfig.build.json`）。
- `pnpm exec eslint apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/minio-storage.adapter.test.ts apps/api/src/storage/storage.port.ts apps/api/src/storage/storage.port.test.ts --max-warnings=0`：退出码 0。
- `pnpm exec prettier --check apps/api/src/storage/storage.port.ts apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/storage.port.test.ts apps/api/src/storage/minio-storage.adapter.test.ts apps/api/package.json pnpm-lock.yaml`：退出码 0。
- `pnpm exec cspell apps/api/src/storage/storage.port.ts apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/storage.port.test.ts apps/api/src/storage/minio-storage.adapter.test.ts`：4 文件、0 issue，退出码 0。
- `git diff --check`：退出码 0。
- 自审：改动限于 Task 2 指定 Storage 文件、API 依赖和 lockfile；原有共享 checkout 用户变更未覆盖，未提交、推送或合并。Head 不用 ETag 冒充 SHA-256；没有新增 Source routes 或 Worker validation。

## 关注项与未运行验证

- SDK 对 `content-type` 使用不签名策略；适配器仍把它作为必要 PUT header 返回。`content-length` 出现在实际签名 header 中，浏览器会按请求体自动设置；真实客户端与 MinIO 的组合尚需集成 smoke 证明。
- `MINIO_TEST_ENDPOINT`、`MINIO_TEST_BUCKET`、`MINIO_TEST_REGION`、`MINIO_TEST_ACCESS_KEY_ID`、`MINIO_TEST_SECRET_ACCESS_KEY` 本轮均未设置，故未执行真实 MinIO PUT/HEAD checksum smoke，也未声称 MinIO 兼容性已验证。
- 仅执行 Task 2 聚焦测试与 API 构建；全仓 CI、Worker、Web、数据库及端到端测试不属于本任务验证结果。

## 独立审查后的输入校验修复（2026-10-08）

审查指出 `createPresignedPut` 原先仅限制最大 TTL，仍会为无效上传声明生成 URL。本次只追加修改 `minio-storage.adapter.ts`、`minio-storage.adapter.test.ts` 和本报告；其他既有变更保持原状。

- `expiresInSeconds` 和 `contentLength` 必须是大于零的有限整数；错误分别固定为 `expiresInSeconds must be a positive finite integer`、`contentLength must be a positive finite integer`。
- `contentType` 只要求为非空字符串（纯空白拒绝），不在 Storage 层限定 MIME 白名单；错误固定为 `contentType must be a non-empty string`。
- `checksumSha256` 必须是可解码为恰好 32 字节的规范 Base64。检查标准字母表、44 字符长度和末尾 `=`，再解码并重新编码比较，拒绝短值、缺填充、非规范填充位和前置空白；错误固定为 `checksumSha256 must be canonical base64 for 32 bytes`。错误不包含输入值或凭证。
- 900 秒 TTL 上限和 `content-type` 未签名的 SDK 行为均保留；合法自定义 MIME `application/x-sourceflow-test` 用于成功签名测试。

TDD 证据：

1. RED：新增 17 个无效输入用例后，运行 `pnpm exec vitest run --config vitest.config.ts apps/api/src/storage/minio-storage.adapter.test.ts apps/api/src/storage/storage.port.test.ts`，退出码 1；41 项中 24 通过、17 失败。失败均为“promise resolved instead of rejecting”，直接暴露签名前缺少校验。
2. GREEN：增加最小校验后运行同一命令，退出码 0；2 个文件、41/41 通过。格式化后再次运行仍为 41/41 通过。
3. 聚焦质量检查：`pnpm exec eslint apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/minio-storage.adapter.test.ts --max-warnings=0`、`pnpm exec prettier --check apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/minio-storage.adapter.test.ts`、`pnpm exec cspell apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/minio-storage.adapter.test.ts`、`pnpm exec tsc -p tsconfig.json --pretty false --noEmit`、`pnpm --filter @sourceflow/api build` 和 `git diff --check` 均退出码 0；CSpell 检查 2 文件、0 issue。

本轮仍未运行真实 MinIO PUT/HEAD checksum smoke；该兼容性限制与上文一致。

## 安全整数复核（2026-10-08）

后续审查指出 `Number.isInteger` 仍接受大于 `Number.MAX_SAFE_INTEGER` 的 `contentLength`。本轮只在 `minio-storage.adapter.test.ts` 增加 `Number.MAX_SAFE_INTEGER + 1` 用例，并在 `minio-storage.adapter.ts` 将 `contentLength` 判断改为 `Number.isSafeInteger`；TTL 判断与 900 秒上限未变。此前报告中“`contentLength` 为正有限整数”现应按此补充理解为“正安全整数”。既有固定错误消息保持不变。

- RED：`pnpm exec vitest run --config vitest.config.ts apps/api/src/storage/minio-storage.adapter.test.ts apps/api/src/storage/storage.port.test.ts` 退出码 1；42 项中 41 通过、1 失败。失败用例为 `contentLength = 9007199254740992`，原因是签名 Promise 返回结果而没有拒绝。
- GREEN：同一命令退出码 0；2 个文件、42/42 通过。
- `pnpm exec eslint apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/minio-storage.adapter.test.ts --max-warnings=0`、`pnpm exec tsc -p tsconfig.json --pretty false --noEmit`、`pnpm exec prettier --check apps/api/src/storage/minio-storage.adapter.ts apps/api/src/storage/minio-storage.adapter.test.ts`、`git diff --check` 均退出码 0。
