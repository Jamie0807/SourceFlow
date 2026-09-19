# SourceFlow 自动化测试策略

## 1. 测试目标

测试必须覆盖 PRD 的核心闭环：

`内容源导入 → AI 理解 → 内容复用 → 平台适配 → 审核 → 排期/发布 → 数据复盘 → 线索归因`

同时验证三个产品端：

- Web/桌面渲染器：使用 Vitest 做业务单元测试，Playwright 做浏览器集成测试。
- Electron 桌面端：使用 Playwright 的 Electron 能力做启动、文件选择、通知和关键流程冒烟。
- React Native iOS/Android：共享领域逻辑用 Vitest；Playwright 覆盖其调用的 API、H5 降级页和可复用 Web 流程。原生系统控件级 E2E 不由 Playwright 直接覆盖，后续如需要再增加原生测试工具。

## 2. 测试分层

| 层级 | 工具 | 范围 | 目标反馈时间 |
| --- | --- | --- | --- |
| 纯函数/领域单元 | Vitest | 状态机、校验器、额度、平台规则、指标计算 | 秒级 |
| React 组件和 Hook | Vitest + Testing Library | 表单、编辑器状态、权限显示、错误态 | 秒级 |
| 服务端模块 | Vitest | 用例服务、权限、任务编排、适配器、计费 | 秒级 |
| API 集成 | Playwright request 或 Node API fixture | 鉴权、数据库、Redis、队列和接口合同 | 分钟级 |
| Web/H5 端到端 | Playwright | 真实浏览器、响应式、核心闭环 | 分钟级 |
| Electron 冒烟 | Playwright Electron | 启动、窗口、文件选择、通知和打包后验证 | 分钟级 |

## 3. 覆盖率门槛

- 全仓库语句、分支、函数、行覆盖率：`85% / 80% / 85% / 85%`。
- `packages/domain`、额度计费、权限和平台适配规则：行覆盖率 ≥ 95%，分支覆盖率 ≥ 90%。
- 每个 P0 用户流程至少有 1 条 Playwright `@smoke` 场景。
- 每个 P0 发布前风险至少有 1 条失败路径测试。
- 覆盖率只作为质量门槛，不能替代业务断言和异常场景。

## 4. Vitest 约定

建议目录：

```text
packages/*/src/**/*.test.ts
apps/*/src/**/*.test.ts
```

约定：

- 单元测试不访问真实外部平台、不依赖本机时间、不依赖网络。
- 使用 `vi.useFakeTimers()` 测试发布时间、额度重置和授权过期。
- 外部 API 用契约化 Mock；Mock 必须包含成功、限流、授权过期、字段缺失和未知错误。
- 测试标题用中文描述业务行为，必要时加需求编号，例如 `FR-009 拖拽排期后更新发布时间`。
- 每个测试只验证一个业务行为；共享数据由 `packages/test-utils` 工厂创建。

## 5. Playwright 约定

- 使用 `getByRole`、`getByLabel`、`getByTestId`，禁止依赖脆弱 CSS 层级选择器。
- 所有 P0 流程启用 trace；失败时保存截图、视频和网络日志。
- 关键接口使用固定测试租户和可回滚数据库快照。
- 桌面 Web、手机 Web、Pad 横屏分别作为 Playwright project。
- 生产环境禁止运行会真实发布内容的集成测试，使用平台沙箱或 SourceFlow 发布模拟器。

## 6. CI 测试门禁

每个 Pull Request：

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test:unit -- --run --coverage`
5. 启动 PostgreSQL、Redis、API、Web 后运行 `pnpm test:integration -- --grep @smoke`

主分支：增加完整 Playwright、多浏览器、构建和 Docker 镜像构建。发布候选版本：增加数据库迁移、镜像漏洞扫描、产物校验和回滚演练。
