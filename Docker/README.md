# SourceFlow Docker 基础设施

## 1. 目录结构

```text
Docker/
├── compose/
│   ├── docker-compose.yml       # 本地基础服务编排
│   └── .env.example             # 本地环境变量示例
├── build/
│   ├── api.Dockerfile           # API 多阶段构建
│   ├── worker.Dockerfile        # Worker 多阶段构建
│   └── web.Dockerfile           # Web/H5 静态资源镜像构建模板
└── README.md
```

## 2. 本地启动

```bash
cp Docker/compose/.env.example Docker/compose/.env
docker compose --env-file Docker/compose/.env -f Docker/compose/docker-compose.yml up -d
docker compose --env-file Docker/compose/.env -f Docker/compose/docker-compose.yml ps
```

当前 Compose 启动 PostgreSQL、Redis 和 MinIO 基础服务。MinIO S3 API 默认访问地址为 `http://localhost:9000`，管理控制台默认访问地址为 `http://localhost:9001`。API、Worker、Web 服务在应用源码接入后使用对应镜像加入生产 Compose。

### MinIO 内容源存储

T011 的 API 与 Worker 必须使用相同的 `MINIO_ENDPOINT`、`MINIO_BUCKET`、`MINIO_REGION`、`MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD`。在宿主机运行 API/Worker 时，示例 endpoint 为 `http://localhost:9000`；若应用进程也运行在 Compose 网络内，应使用服务名 endpoint `http://minio:9000`，不能在容器内使用 `localhost` 指向 MinIO。

Compose 会启动 MinIO，但不会自动创建 bucket。首次运行时打开 `http://localhost:9001`，使用本地 `.env` 中的 MinIO 账号登录，并创建与 `MINIO_BUCKET` 完全同名的 bucket（示例为 `sourceflow-local`）。生产环境应提前创建 bucket，并给 API/Worker 配置专用的最小权限凭证；不要在生产中复用 root 用户。

从仓库根目录启动宿主机 API/Worker 前，可将本地配置导入当前 shell：

```bash
set -a
source Docker/compose/.env
set +a
corepack pnpm dev:api
```

Worker 使用相同环境变量，启动命令为 `corepack pnpm dev:worker`。不要把本机 `.env` 或任何真实 MinIO 凭证提交到 Git。

## 4. API 镜像与 Prisma

API 镜像会在构建阶段复制 `prisma/`、安装 Prisma Client 并生成客户端：

```bash
docker build -f Docker/build/api.Dockerfile -t sourceflow-api:local .
```

数据库命令从仓库根目录执行。迁移和 Seed 必须显式提供数据库连接；Seed 还必须显式设置 `ALLOW_TEST_SEED=true`，生产环境会被拒绝：

```bash
set -a
source Docker/compose/.env.example
set +a
corepack pnpm db:validate
corepack pnpm db:migrate:deploy
ALLOW_TEST_SEED=true NODE_ENV=development corepack pnpm db:seed
```

MinIO 使用 `MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD` 配置本地管理员账号；端口分别由 `MINIO_PORT` 和 `MINIO_CONSOLE_PORT` 配置。`.env.example` 中的凭证仅用于本机开发，不能复用到共享或生产环境。

## 3. T010 火山引擎 Provider 环境变量与手动 smoke

默认 `AI_PROVIDER=mock`，因此本地开发、单元测试、Git Hook 和 CI 不需要火山引擎凭证，也不会发送真实 Provider 请求。只有显式设置 `AI_PROVIDER=volcengine` 时，Worker 才会校验 `LAS_API_KEY` 与 `ARK_API_KEY`；两者必须分别保存在本机 `.env`、CI Secret 或 Secret Manager，不能写入 Git。

`Docker/compose/.env.example` 为每个 T010 环境变量标注了用途、合法范围和默认值：LAS 的 Submit/Poll URL、资源名、轮询间隔与总超时，Ark Base URL、模型与超时，以及只供手动 smoke 使用的开关、媒体 URL 和媒体格式。所有 Provider endpoint 都必须是无用户名、无密码的 HTTPS 地址。

真实 smoke 仅可由具备沙箱或专用低权限凭证的操作者手动执行。它要求一个可被 LAS 下载的、单独持有的公网 HTTPS 测试媒体；脚本会在运行时解析域名并拒绝解析到非公网地址的主机。DNS 记录在检查后仍可能变化，因此应使用由你控制、稳定指向公网媒体的专用测试域名。本机 MinIO 的 `http://localhost:9000` 地址对 LAS 不可达，不能用于 smoke，也不得传入用户媒体或私有对象。

```bash
set -a
source Docker/compose/.env
set +a
RUN_VOLCENGINE_SMOKE=true corepack pnpm --filter @sourceflow/worker test:volcengine:smoke
```

脚本默认拒绝执行，除非 `RUN_VOLCENGINE_SMOKE=true`；还会校验真实模式、两个 API Key 和公网 HTTPS 测试媒体。它只输出 Provider、model、请求 ID 是否存在及结果计数/长度，不输出 key、媒体 URL、完整转写、Ark prompt 或上游响应。取消只能停止本地 LAS 轮询，不能取消已提交的远端 LAS 作业；远端任务仍可能继续运行并产生用量。

## 4. 镜像原则

- PostgreSQL 和 Redis 使用 Docker Hub 官方镜像。
- MinIO 使用官方 `quay.io/minio/minio:latest` 镜像。
- 开发环境默认使用 `postgres:latest`、`redis:latest` 与 `quay.io/minio/minio:latest`。
- 生产环境发布时把版本 tag 或 digest 固化到独立的生产 Compose 文件。
- 数据卷不能随容器删除；删除开发数据必须显式执行并确认目标卷。
- 密码、AI Key、JWT Secret 和 DockerHub token 不提交到 Git。
