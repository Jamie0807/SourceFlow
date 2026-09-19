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

MinIO 使用 `MINIO_ROOT_USER` 和 `MINIO_ROOT_PASSWORD` 配置本地管理员账号；端口分别由 `MINIO_PORT` 和 `MINIO_CONSOLE_PORT` 配置。`.env.example` 中的凭证仅用于本机开发，不能复用到共享或生产环境。

## 3. 镜像原则

- PostgreSQL 和 Redis 使用 Docker Hub 官方镜像。
- MinIO 使用官方 `quay.io/minio/minio:latest` 镜像。
- 开发环境默认使用 `postgres:latest`、`redis:latest` 与 `quay.io/minio/minio:latest`。
- 生产环境发布时把版本 tag 或 digest 固化到独立的生产 Compose 文件。
- 数据卷不能随容器删除；删除开发数据必须显式执行并确认目标卷。
- 密码、AI Key、JWT Secret 和 DockerHub token 不提交到 Git。
