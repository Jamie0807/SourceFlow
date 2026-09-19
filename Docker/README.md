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

当前 Compose 只启动 PostgreSQL 和 Redis 基础服务。API、Worker、Web 服务在应用源码接入后使用对应镜像加入生产 Compose。

## 3. 镜像原则

- PostgreSQL 和 Redis 使用 Docker Hub 官方镜像。
- 开发环境默认使用 `postgres:latest` 与 `redis:latest`。
- 生产环境发布时把版本 tag 或 digest 固化到独立的生产 Compose 文件。
- 数据卷不能随容器删除；删除开发数据必须显式执行并确认目标卷。
- 密码、AI Key、JWT Secret 和 DockerHub token 不提交到 Git。
