# Web 工作台首屏任务拆解

## TWEB-001 组件测试与测试依赖

- **依赖：** 无
- **文件：** `apps/web/src/App.test.tsx`、`package.json`、`pnpm-lock.yaml`
- [x] 添加 `@testing-library/react`、`@testing-library/jest-dom` 和 `@testing-library/user-event`。
- [x] 写登录空值、邮箱错误、密码过短、合法提交转场和工作台关键内容测试。
- [x] 运行 `pnpm test:component -- --run`，确认实现前因占位组件缺少元素而失败。

## TWEB-002 登录与工作台页面实现

- **依赖：** TWEB-001
- **文件：** `apps/web/src/main.tsx`、`apps/web/src/dashboard-data.ts`
- [x] 创建类型化静态数据、登录表单和工作台组件。
- [x] 通过最小实现使 TWEB-001 测试通过。
- [x] 对未开放入口给出明确反馈，不调用真实 API。

## TWEB-003 响应式与可访问性样式

- **依赖：** TWEB-002
- **文件：** `apps/web/src/styles.css`
- [x] 实现桌面、Pad 和手机布局。
- [x] 增加可见焦点、语义状态标识、禁用/错误/未开放反馈。
- [x] 检查 360px、1280px、1440px 无横向溢出。

## TWEB-004 收敛验收

- **依赖：** TWEB-003
- [x] 运行组件测试、lint、format、spellcheck、typecheck 和 Web 构建。
- [x] 通过浏览器检查首屏并分别记录 360px、1280px、1440px 的截图/响应式结果。
- [x] 逐项核对 FR-WEB-001、FR-WEB-002、FR-WEB-003 的需求追踪记录。
- [x] 更新 `specs/content-batch-pipeline/tasks.md` 的 T017 进度和 `.superpowers/sdd/progress.md`。
