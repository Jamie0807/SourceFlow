# SourceFlow

SourceFlow 是面向高频多平台内容生产者的 AI 内容复用与多平台运营工作台。

## 一句话定位

把一条长内容变成一组可发布、可复盘、可继续转化的多平台内容资产。

## 本版默认假设

- 第一目标用户：播客、课程、知识类创作者、个人品牌和 1—10 人内容团队。
- 第一核心场景：长视频/音频/文章拆解为短视频、图文和社交帖。
- 大屏端：桌面端与 Web 端使用同一套信息架构和交互设计。
- 小屏端：手机与 Pad 使用同一套响应式设计，重点服务审核、灵感捕捉、数据查看和轻编辑。
- 发布策略：优先接入可稳定授权的平台；对接口受限平台提供复制、导出和发布清单降级方案。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [市场调研](docs/research/market-research.md) | 竞品、市场规模、用户与机会判断 |
| [产品策略](docs/product/product-strategy.md) | 定位、目标用户、路线图和指标 |
| [完整 PRD](docs/prd/PRD.md) | 需求、流程、权限、状态、埋点与验收 |
| [桌面/Web 端 PRD](docs/prd/desktop-web-prd.md) | 大屏端页面和交互规格 |
| [手机/Pad 端 PRD](docs/prd/mobile-pad-prd.md) | 小屏端页面和交互规格 |
| [付费规则](docs/prd/pricing-and-packaging.md) | 套餐、额度、超额、试用和升级 |
| [用户流程](docs/prd/user-flows.md) | 核心流程、异常和降级方案 |
| [大屏线框](docs/design/wireframes/desktop-web.md) | 桌面/Web 低保真布局图 |
| [小屏线框](docs/design/wireframes/mobile-pad.md) | 手机/Pad 低保真布局图 |
| [技术架构](docs/tech/technical-architecture.md) | pnpm monorepo、多端应用、服务端和基础设施 |
| [自动化测试策略](docs/qa/test-strategy.md) | Vitest、Playwright、覆盖率和测试环境 |
| [单元测试用例](docs/qa/unit-test-cases.md) | 按 PRD 拆解的详细单元测试用例 |
| [集成测试方案](docs/qa/integration-test-plan.md) | Playwright 集成测试场景、数据和验收 |
| [构建与发布部署](docs/devops/build-release-deployment.md) | 构建、DockerHub、阿里云部署和客户端产物 |
| [Docker 基础设施](Docker/README.md) | Docker Compose 编排、Dockerfile 和环境变量 |
| [首个 Feature 需求规格](specs/content-batch-pipeline/spec.md) | 内容批次垂直切片的需求、边界和验收 |
| [首个 Feature 实现计划](specs/content-batch-pipeline/plan.md) | 技术架构、文件地图、任务依赖和验证命令 |
| [首个 Feature 任务拆解](specs/content-batch-pipeline/tasks.md) | Worktree、多智能体并行任务和完成标准 |
| [需求质量检查清单](specs/content-batch-pipeline/checklists/requirements.md) | Spec Kit 需求完整性检查 |
| [设计决策记录](docs/superpowers/specs/2026-09-19-sourceflow-design.md) | 已确认的方案边界 |
| [交付计划](docs/superpowers/plans/2026-09-19-sourceflow-product-docs-plan.md) | 文档交付拆分与检查项 |

## MVP 的成功标准

用户在 30 分钟内完成：上传一条 20—60 分钟的长内容、生成至少 5 种平台资产、修改并排期 3 条内容，并在数据页看到首轮复盘建议。

## 重要说明

竞品的用户数量和连接账号数量大多是企业自报口径，不等同于第三方审计的市场份额。本项目在调研文档中区分“官方披露”“公司自报”和“低置信度行业资料”。
