# SourceFlow 技术架构方案

版本：0.1
日期：2026-09-19
状态：技术方案基线

## 1. 总体技术决策

| 层级 | 方案 |
| --- | --- |
| 仓库 | pnpm monorepo |
| Web/H5 | React + TypeScript + Vite |
| 原生移动端 | React Native，覆盖 iOS 与 Android |
| 桌面端 | Electron Forge，覆盖 macOS、Windows，后续按发行需求扩展 Linux |
| 服务端 | Node.js + TypeScript；具体 HTTP 框架保持可替换，遵循统一应用接口契约 |
| 数据库 | PostgreSQL 官方镜像，开发环境使用 `postgres:latest` |
| 缓存/队列基础 | Redis 官方镜像，开发环境使用 `redis:latest` |
| 容器 | Docker + Docker Compose |
| 单元测试 | Vitest |
| 集成测试 | Playwright |
| 发布镜像 | DockerHub |
| 生产部署 | 阿里云服务器，通过 SSH 拉取 DockerHub 镜像并由 Compose 启动 |

### 镜像标签说明

本地开发和初期验证按要求使用官方 `latest` 镜像。生产环境不建议长期直接追踪 `latest`，上线前应把实际解析出的版本号或 digest 写入生产 Compose 文件，以保证可回滚和可复现；这不改变开发环境使用官方最新镜像的约定。

## 2. Monorepo 目录规划

```text
SourceFlow/
├── apps/
│   ├── web/                 # React + Vite，大屏 Web
│   ├── h5/                  # React + Vite，手机浏览器 H5
│   ├── mobile/              # React Native，iOS/Android
│   ├── desktop/             # Electron Forge，桌面端
│   ├── api/                 # 服务端 HTTP API、鉴权、业务模块
│   └── worker/              # 转写、AI 生成、视频处理、数据同步任务
├── packages/
│   ├── ui-web/              # Web/H5 共享组件
│   ├── ui-native/           # React Native 组件
│   ├── domain/              # 内容批次、资产、平台、计费等领域模型
│   ├── api-client/          # 类型安全的 API 客户端
│   ├── config/              # TypeScript、ESLint、Prettier、Vite 公共配置
│   ├── platform-adapters/   # 国内外平台适配器和能力卡片
│   └── test-utils/          # 测试工厂、Mock、数据构造器
├── tests/
│   ├── integration/         # Playwright 集成测试
│   └── fixtures/            # 跨应用共享测试数据
├── Docker/
│   ├── compose/             # Docker Compose 服务编排
│   └── build/               # Dockerfile 和镜像构建说明
├── docs/                    # 产品、调研、PRD、设计、技术、测试和 DevOps 文档
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

## 3. workspace 约定

根目录 `pnpm-workspace.yaml` 统一管理：

```yaml
packages:
  - apps/*
  - packages/*
```

根目录 `package.json` 建议提供以下脚本：

```json
{
  "packageManager": "pnpm@<锁定版本>",
  "scripts": {
    "dev:web": "pnpm --filter @sourceflow/web dev",
    "dev:h5": "pnpm --filter @sourceflow/h5 dev",
    "dev:api": "pnpm --filter @sourceflow/api dev",
    "dev:worker": "pnpm --filter @sourceflow/worker dev",
    "dev:desktop": "pnpm --filter @sourceflow/desktop start",
    "typecheck": "pnpm -r --if-present typecheck",
    "lint": "pnpm -r --if-present lint",
    "test:unit": "pnpm -r --if-present test:unit",
    "test:integration": "playwright test",
    "build:web": "pnpm --filter @sourceflow/web build",
    "build:h5": "pnpm --filter @sourceflow/h5 build",
    "build:api": "pnpm --filter @sourceflow/api build",
    "build:worker": "pnpm --filter @sourceflow/worker build",
    "package:desktop": "pnpm --filter @sourceflow/desktop make"
  }
}
```

实际版本号必须在项目初始化时写入 `package.json` 的 `packageManager` 字段，并由 CI 使用同一版本安装，不能让不同开发者自动解析不同 pnpm 版本。

## 4. 分层边界

### 4.1 前端层

- 页面只依赖 `api-client` 和领域类型，不直接拼接 HTTP URL。
- Web/H5 共用领域状态和 API 客户端，页面布局通过断点和独立路由适配。
- React Native 与 Web 共享 `domain`、校验器和请求协议，不强行共享 DOM 组件。
- Electron 主进程负责文件系统、通知、自动更新和本地任务；渲染进程复用 Web 端业务界面。

### 4.2 服务端层

- API 负责鉴权、权限、工作区、内容批次、资产、平台连接、计费和查询。
- Worker 负责长耗时异步任务：转码、转写、AI 生成、视频渲染、平台数据同步。
- PostgreSQL 保存业务事实和审计记录。
- Redis 保存短期缓存、分布式锁、任务状态和限流状态；不能作为唯一事实来源。

### 4.3 平台适配层

每个平台适配器必须实现能力卡片：

```ts
type PlatformCapability = {
  platform: string;
  publish: 'automatic' | 'assisted' | 'export-only';
  analytics: boolean;
  comments: boolean;
  media: { ratios: string[]; maxDurationSeconds?: number };
  limits: { titleMax?: number; bodyMax?: number; hashtagsMax?: number };
};
```

## 5. 数据与安全基线

- 数据库迁移必须可重复执行，并在部署前完成备份。
- 授权 token 加密存储，日志禁止打印 token、密码和完整个人联系方式。
- 所有写操作带 `workspace_id`，服务端必须二次校验资源归属。
- 线索数据与普通内容数据分开授权和审计。
- AI 任务需要保存源版本、模型版本、生成参数和结果版本。
- Docker 容器默认非 root 用户运行；生产网络只暴露反向代理和必要 API 端口。

## 6. 技术依据

- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Vite 官方指南](https://vite.dev/guide/)
- [React Native 官方文档](https://reactnative.dev/docs/getting-started)
- [Electron Forge 官方文档](https://www.electronforge.io/)
- [Vitest 官方指南](https://vitest.dev/guide/)
- [Playwright Test 官方文档](https://playwright.dev/docs/intro)
- [Docker Compose 官方文档](https://docs.docker.com/compose/)
- [PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)
- [Redis 官方镜像](https://hub.docker.com/_/redis)
