# Web 工作台首屏实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 SourceFlow Web/桌面共用的登录演示页和响应式内容经营工作台首页。

**Architecture:** 使用 React 组件拆分页面、静态类型化展示数据和 CSS 响应式布局。`App` 只负责页面状态切换，登录页负责表单校验，工作台负责展示；真实认证和 API Client 留给后续 T006/T007 接线任务。

**Tech Stack:** React 19、TypeScript strict、Vite、Vitest、React Testing Library、CSS。

## Global Constraints

- 文档和用户可见文案使用中文；产品名、库名、命令和 API 名保留英文。
- 遵循 TDD：先写失败组件测试，再写最小实现，再重构。
- 不修改 API、Prisma、认证逻辑和用户已有未提交变更。
- 不自动执行 `git commit`、`git push` 或合并。
- 所有交互必须有 loading、success、empty、error 或未开放状态中的明确反馈；本阶段未连接 API 的入口使用“即将开放”提示。
- 登录页面明确为演示模式，不把静态登录当作真实鉴权。
- 页面满足键盘可达、语义化标签、可见焦点和响应式布局要求。

## 文件地图

| 文件                             | 职责                              |
| -------------------------------- | --------------------------------- |
| `apps/web/src/main.tsx`          | React 应用入口和页面状态切换      |
| `apps/web/src/App.test.tsx`      | 登录、转场和工作台组件测试        |
| `apps/web/src/styles.css`        | 页面 tokens、组件样式和响应式断点 |
| `apps/web/src/dashboard-data.ts` | 工作台静态演示数据和状态类型      |
| `apps/web/package.json`          | Web 组件测试依赖                  |
| `package.json`、`pnpm-lock.yaml` | 根级 RTL 测试依赖和锁文件         |
| `specs/content-batch-web/*`      | SDD 规格、计划、任务和检查清单    |

## 实施顺序

1. 添加 React Testing Library 测试依赖和失败测试。
2. 运行组件测试确认测试因页面仍为占位组件而失败。
3. 实现登录演示页、工作台首页和静态数据模型。
4. 添加响应式 CSS、状态标签和未开放入口反馈。
5. 运行组件测试、构建、质量门禁和浏览器检查。
6. 更新 T017 追踪记录和执行进度，记录真实缺口。
