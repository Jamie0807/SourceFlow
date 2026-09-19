# SourceFlow Playwright 集成测试方案

## 1. 测试范围

Playwright 集成测试覆盖 Web、H5、Electron 以及服务端 API 的真实协作。React Native 原生界面不直接由 Playwright 驱动，但共享 API、鉴权、内容批次和发布状态必须由本方案覆盖。

## 2. 测试环境

```text
PostgreSQL latest ─┐
Redis latest ───────┼─> API ──> Worker ──> 平台模拟器
                    └─> Web/H5/Electron
```

要求：

- 每次测试使用独立 `workspace_id`。
- 测试开始前执行数据库迁移和 fixture seed。
- AI、平台授权、转写和数据同步使用可控 Mock Server，不访问真实生产账号。
- 发布测试进入 SourceFlow 平台模拟器，模拟成功、401、429、500、字段缺失和超时。
- 测试结束清理工作区、文件和 Redis 任务键。

## 3. Playwright 项目

建议的 `playwright.config.ts` 项目：

| 项目 | 设备/入口 | 用途 |
| --- | --- | --- |
| `web-chromium` | Desktop Chrome | P0 主流程 |
| `web-webkit` | Desktop Safari engine | 跨浏览器兼容 |
| `h5-mobile` | iPhone 视口 | 手机 H5 响应式 |
| `pad-landscape` | iPad 横屏视口 | Pad 双栏布局 |
| `electron-smoke` | Electron 主进程 | 桌面启动、文件、通知和关键流程 |
| `api-contract` | `request` fixture | 接口状态码、鉴权和数据合同 |

## 4. P0 端到端用例

| 编号 | 场景 | 操作 | 断言 |
| --- | --- | --- | --- |
| PW-SMOKE-001 | 首次激活 | 注册 → 创建工作区 → 连接模拟平台 | 首页显示上传入口和已连接账号 |
| PW-SMOKE-002 | 内容批次 | 上传 fixture 视频 → 等待处理 → 查看转写 | 看到章节、金句和候选片段 |
| PW-SMOKE-003 | AI 复用 | 选择 2 平台/3 类型 → 生成 | 生成 6 个资产，任务状态完成 |
| PW-SMOKE-004 | 编辑保存 | 打开资产 → 修改标题 → 刷新页面 | 修改后的标题仍存在，版本号递增 |
| PW-SMOKE-005 | 审核通过 | Editor 提交 → Reviewer 批准 | 状态从 needs_review 变为 approved |
| PW-SMOKE-006 | 审核退回 | Reviewer 输入原因退回 | Editor 看到原因并能生成新版本 |
| PW-SMOKE-007 | 排期发布 | 选择未来时间 → 保存 | 日历出现卡片，时间和时区正确 |
| PW-SMOKE-008 | 自动发布 | A 级模拟平台执行任务 | 状态 published，展示 provider id |
| PW-SMOKE-009 | 发布失败 | 模拟 429 → 重试 | 看到退避时间和重试按钮 |
| PW-SMOKE-010 | 发布降级 | C 级平台点击发布 | 下载 ZIP 发布包，不显示自动发布成功 |
| PW-SMOKE-011 | 数据复盘 | 注入 24 小时数据 → 打开复盘 | 指标卡、排行和 AI 建议可见 |
| PW-SMOKE-012 | 采纳建议 | 点击“采纳并生成” | 创建带来源的批次草稿 |
| PW-SMOKE-013 | 线索归因 | 绑定 CTA → 模拟表单提交 | 线索记录显示来源资产、平台和 CTA |
| PW-SMOKE-014 | 额度阻断 | 消耗至 100% → 尝试生成 | 弹出额度不足，不创建任务 |
| PW-SMOKE-015 | 授权过期 | 模拟平台 401 | 首页、日历和账号页显示重新授权 |

## 5. 响应式用例

| 编号 | 设备 | 断言 |
| --- | --- | --- |
| PW-RESP-001 | 手机 360 px | 底部导航固定，核心页面无横向溢出 |
| PW-RESP-002 | 手机 390 px | 60 秒内可以修改标题并批准内容 |
| PW-RESP-003 | Pad 横屏 | 列表、详情和操作抽屉同时可见 |
| PW-RESP-004 | 桌面 1280×720 | 右侧 AI 面板可折叠，仍可完成编辑与发布 |
| PW-RESP-005 | 桌面 1440×900 | 三栏编辑器主要按钮不折叠 |

## 6. API 集成用例

- 未登录请求返回 401，过期 session 不返回业务数据。
- 不同 workspace 访问同一资源返回 404/403，不能通过修改 URL 越权。
- 创建生成任务后 API 返回 task id，轮询可看到 queued/running/succeeded/failed。
- 重试同一幂等键不会创建重复发布任务。
- Webhook 签名错误返回 401，重复 webhook 不重复写入指标。
- 数据同步失败保留上次成功数据并记录同步失败时间。
- 数据库事务失败时不扣额度、不创建半成品资产。

## 7. Electron 集成用例

- 启动后加载本地渲染器或配置的 Web 地址。
- 从原生文件选择器选择视频并成功回填上传表单。
- 关闭窗口后后台任务状态可恢复。
- 系统通知点击后打开对应内容批次。
- 无网络时显示离线状态，不误报发布成功。
- `make` 产物可以启动并完成登录页冒烟。

## 8. 失败处理与证据

失败测试必须保存：Playwright trace、截图、视频、控制台日志、API 请求摘要和测试数据标识。禁止在 trace、截图或报告中写入密码、token 和完整线索联系方式。

## 9. 执行命令

```bash
pnpm exec playwright install --with-deps
pnpm test:integration -- --grep @smoke
pnpm test:integration -- --project=h5-mobile
pnpm test:integration -- --project=pad-landscape
pnpm exec playwright show-report
```

Playwright 官方提供测试运行器、自动等待、断言、trace 和多浏览器 project；本方案沿用这些能力，详见 [Playwright Test](https://playwright.dev/docs/intro) 和 [命令行文档](https://playwright.dev/docs/test-cli)。
