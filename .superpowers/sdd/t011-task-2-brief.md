## Task 2: Storage 预签名 PUT 与 HeadObject checksum

**Files:** `apps/api/src/storage/storage.port.ts`, `minio-storage.adapter.ts`, 两个 Storage 测试文件、`apps/api/package.json` 和 lockfile。

**公共接口：**

```ts
export type PresignedPutResult = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
  expiresAt: Date;
}>;

export type StorageObjectMetadata = Readonly<{
  contentLength?: number;
  contentType?: string;
  checksumSha256?: string;
}>;

export interface StoragePort {
  putObject(input: StoragePutObjectInput): Promise<void>;
  getObject(input: StorageObjectReference): Promise<StoredObject>;
  deleteObject(input: StorageObjectReference): Promise<void>;
  createPresignedPut(
    input: StorageObjectReference & {
      contentType: string;
      contentLength: number;
      checksumSha256: string;
      expiresInSeconds: number;
    },
  ): Promise<PresignedPutResult>;
  headObject(input: StorageObjectReference): Promise<StorageObjectMetadata>;
}
```

- [ ] Step 1：测试拒绝不安全 IDs、签名方法回传必要 checksum/content-type headers、Head 转换长度/MIME/checksum、not-found 转稳定错误。
- [ ] Step 2：运行 Storage Vitest，确认缺少新 port 方法导致失败。
- [ ] Step 3：使用 `PutObjectCommand` 与 `getSignedUrl`；给 `ChecksumSHA256` 签名并将 `x-amz-checksum-sha256` 设为不可提升 header；固定最大 900 秒 TTL。
- [ ] Step 4：用 `HeadObjectCommand` 读取 `ContentLength`、`ContentType`、`ChecksumSHA256`；checksum 缺失时返回 undefined，不以 ETag 冒充。
- [ ] Step 5：加入 `@aws-sdk/s3-request-presigner` 后运行 Storage tests；若显式配置 MinIO 再运行 PUT/HEAD checksum integration，否则记录未执行。
