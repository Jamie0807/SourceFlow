# SourceFlow 构建、发布与部署方案

版本：0.1
状态：可执行的工程规范；等待应用源码、镜像仓库和服务器凭证接入

## 1. 当前交付边界

当前目录已经具备产品、技术、测试和部署文档，但还没有以下工程源码：

- `apps/web`、`apps/h5`、`apps/mobile`、`apps/desktop`。
- `apps/api`、`apps/worker` 和数据库迁移。
- 根目录 `package.json`、`pnpm-lock.yaml`、构建配置。
- Apple Developer/Google Play 签名证书。
- DockerHub 命名空间、访问 token、阿里云服务器地址和 SSH 私钥。

因此本文件定义接入源码后的标准构建和上线流程；执行真实构建、推送镜像和 SSH 部署前，必须把凭证写入 CI Secret 或服务器 Secret，不得写进 Git。

## 2. 构建产物总览

| 层级 | 构建命令 | 产物 | 发布方式 |
| --- | --- | --- | --- |
| Web | `pnpm build:web` | `apps/web/dist/` | 上传对象存储/CDN 或打入 Nginx 镜像 |
| H5 | `pnpm build:h5` | `apps/h5/dist/` | 上传对象存储/CDN 或打入 Nginx 镜像 |
| API | `pnpm build:api` + Docker build | `sourceflow-api:<tag>` | 推送 DockerHub，阿里云拉取 |
| Worker | `pnpm build:worker` + Docker build | `sourceflow-worker:<tag>` | 推送 DockerHub，阿里云拉取 |
| PostgreSQL | 无业务构建 | 官方 `postgres:latest` | Compose 运行，不制作二次镜像 |
| Redis | 无业务构建 | 官方 `redis:latest` | Compose 运行，不制作二次镜像 |
| Desktop | `pnpm package:desktop` | macOS/Windows 安装包 | 提供给分发平台或官网 |
| Android | `pnpm --filter @sourceflow/mobile android:release` | AAB/APK | 用户自行上传 Google Play/国内分发平台 |
| iOS | `pnpm --filter @sourceflow/mobile ios:archive` | Archive/IPA | 用户自行上传 App Store Connect |

## 3. 版本与标签

每次发布使用不可变版本：

```text
v<主版本>.<次版本>.<修订版本>
git-<短提交 SHA>
```

Docker 镜像同时推送：

```text
DOCKERHUB_NAMESPACE/sourceflow-api:v1.0.0
DOCKERHUB_NAMESPACE/sourceflow-api:git-a1b2c3d
DOCKERHUB_NAMESPACE/sourceflow-api:latest
```

生产 Compose 使用版本 tag 或 digest，不直接依赖会漂移的 `latest`。`latest` 只作为用户要求的开发/测试默认标签和镜像仓库便利标签。

## 4. 本地构建顺序

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit -- --run --coverage
pnpm build:web
pnpm build:h5
pnpm build:api
pnpm build:worker
pnpm package:desktop
```

移动端构建必须在配置好 Xcode、Android SDK、签名和原生依赖的环境执行，不能在普通 Linux Docker 容器中假设生成可上架的 iOS 包。

## 5. DockerHub 发布

### 5.1 登录方式

不要把密码写入命令历史或文档。使用环境变量或 CI Secret：

```bash
export DOCKERHUB_NAMESPACE='你的 DockerHub 命名空间'
export DOCKERHUB_USERNAME='你的 DockerHub 用户名'
printf '%s' "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin
```

### 5.2 构建与推送

```bash
export RELEASE_TAG="v1.0.0"
export GIT_SHA="$(git rev-parse --short HEAD)"

docker build \
  -f Docker/build/api.Dockerfile \
  -t "$DOCKERHUB_NAMESPACE/sourceflow-api:$RELEASE_TAG" \
  -t "$DOCKERHUB_NAMESPACE/sourceflow-api:git-$GIT_SHA" \
  .

docker build \
  -f Docker/build/worker.Dockerfile \
  -t "$DOCKERHUB_NAMESPACE/sourceflow-worker:$RELEASE_TAG" \
  -t "$DOCKERHUB_NAMESPACE/sourceflow-worker:git-$GIT_SHA" \
  .

docker push "$DOCKERHUB_NAMESPACE/sourceflow-api:$RELEASE_TAG"
docker push "$DOCKERHUB_NAMESPACE/sourceflow-api:git-$GIT_SHA"
docker push "$DOCKERHUB_NAMESPACE/sourceflow-worker:$RELEASE_TAG"
docker push "$DOCKERHUB_NAMESPACE/sourceflow-worker:git-$GIT_SHA"
```

推送前必须完成：镜像构建、容器启动、健康检查、单元测试、Playwright smoke、漏洞扫描和镜像摘要记录。

## 6. 阿里云 SSH 部署

### 6.1 服务器准备

服务器目录建议：

```text
/opt/sourceflow/
├── compose/
│   ├── docker-compose.prod.yml
│   └── .env
├── backups/
├── releases/
└── logs/
```

`.env` 只保留服务器本地权限，至少包括：数据库密码、Redis 密码、JWT Secret、AI Provider Key、DockerHub 命名空间、API 域名和镜像版本。

### 6.2 首次部署

部署逻辑：进入 `/opt/sourceflow/compose`，完成 DockerHub 鉴权，执行 `docker compose pull api worker`，运行 `docker compose run --rm api pnpm db:migrate`，然后执行 `docker compose up -d --remove-orphans` 和 `docker compose ps`。

实际部署时应通过 SSH 安全传入 DockerHub token，不能依赖远端 shell 已经拥有本地环境变量。推荐用 CI 的受控 SSH Action 或临时凭证完成。

### 6.3 发布后检查

- `docker compose ps` 所有必需服务为 running/healthy。
- API `/health` 返回 200，数据库和 Redis 检查通过。
- Web 首页能登录，API 请求没有 CORS/鉴权错误。
- 创建测试工作区、上传测试素材、生成模拟资产、查看数据复盘。
- 不运行真实平台发布；使用平台模拟器完成 smoke。

### 6.4 回滚

将服务器 `.env` 的 `SOURCEFLOW_IMAGE_TAG` 改为上一个已验证 tag，例如 `v0.9.2`；执行 `docker compose pull api worker`、`docker compose run --rm api pnpm db:migrate:status` 和 `docker compose up -d --remove-orphans`。如果数据库迁移不可逆，必须先停止回滚动作，恢复数据库备份，再根据迁移说明处理，不能只回滚应用镜像。

## 7. 前端、服务端和客户端发布清单

### 服务端

- [ ] Git tag 与发布说明。
- [ ] API Docker 镜像和摘要。
- [ ] Worker Docker 镜像和摘要。
- [ ] 数据库迁移文件和迁移状态。
- [ ] 环境变量清单，不包含真实值。
- [ ] 健康检查结果。
- [ ] 备份记录和回滚版本。
- [ ] DockerHub 镜像访问权限。

### Web/H5

- [ ] `web/dist` 压缩包或静态资源版本。
- [ ] `h5/dist` 压缩包或静态资源版本。
- [ ] CDN/对象存储上传记录。
- [ ] API 域名、版本和缓存策略。
- [ ] 桌面 Chrome、Safari、手机和 Pad smoke 结果。

### Electron 桌面端

- [ ] macOS `.dmg`/`.zip`。
- [ ] Windows `.exe`/安装包。
- [ ] 代码签名状态和证书版本。
- [ ] 自动更新元数据（如启用）。
- [ ] SHA256 校验文件。
- [ ] 各平台启动、登录、上传和通知 smoke 结果。

### Android

- [ ] 签名 `.aab`。
- [ ] 内测 `.apk`（如需要）。
- [ ] 版本号、版本名和变更说明。
- [ ] 权限清单、隐私政策和隐私数据说明。
- [ ] 真机登录、上传、审核、通知和发布失败检查。

### iOS

- [ ] Xcode Archive。
- [ ] 签名 `.ipa`（如分发渠道需要）。
- [ ] Bundle ID、版本号和构建号。
- [ ] App Store Connect 上传记录。
- [ ] 隐私清单、权限用途说明和截图。
- [ ] 真机登录、上传、审核、通知和发布失败检查。

## 8. 当前不能声称已完成的事项

在实际源码、DockerHub、阿里云 SSH 和签名资料接入前，以下事项只能作为待执行流程，不能标记为已发布：

- 前端和服务端生产构建。
- Docker 镜像推送。
- 阿里云服务器部署。
- iOS/Android 签名产物。
- Electron 安装包签名与分发。
