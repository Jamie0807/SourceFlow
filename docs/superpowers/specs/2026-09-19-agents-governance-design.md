# SourceFlow 智能体研发规约设计记录

日期：2026-09-19
状态：已按用户要求初始化

## 目标

将 SourceFlow 的智能体协作、Spec-Driven Development、Git Worktree、TDD、测试、代码质量、CI、提交和发布规则固化为项目级约束，减少每次任务重新解释流程的成本。

## 方案

- `AGENTS.md` 负责执行层规则：智能体每次接单、设计、编码、测试、审查和交付时必须遵守。
- `.specify/memory/constitution.md` 负责项目原则：功能规格、技术边界、质量门禁、安全、可运维和跨端体验的稳定约束。
- `.gitignore` 负责保护 Worktree、依赖、构建产物和环境密钥，确保未来并行开发不会污染主工作区。

## 工作流

采用 GitHub Spec Kit 的 `constitution → specify → clarify → plan → checklist → tasks → analyze → implement → converge` 流程。需求存在会改变范围或架构的歧义时使用 Grill Me；独立功能用 Worktree 和多智能体并行；实现前使用 TDD；交付前运行全量质量门禁和自主验收。

## 测试策略

- Vitest：领域、服务端、Hook 和工具。
- React Testing Library：React Web/H5 组件。
- Playwright：Web/H5/API/Electron 关键流程和发布前 smoke。
- React Native 原生 UI 的 Playwright 覆盖边界必须诚实记录，不能用共享业务测试冒充原生 UI E2E。

## 明确不自动执行的动作

智能体不自动提交 Git commit、push、合并、生产部署、真实平台发布、删除数据或使用未授权凭证。用户明确要求提交时统一使用 `pnpm commit`。
