# SourceFlow 智能体研发规约

本文件是 SourceFlow 项目中所有 Codex、自动化智能体和协作开发者必须遵守的全局高优先级约束。除非用户明确覆盖，否则所有研发任务都按本文件执行。

## 1. 约束优先级与基本原则

约束优先级从高到低：

1. 系统和平台安全规则。
2. 用户当前明确要求。
3. 本文件 `AGENTS.md`。
4. `.specify/memory/constitution.md` 和已经批准的 Spec Kit 产物。
5. 产品 PRD、技术文档和测试文档。
6. 具体任务的实现计划。
7. 智能体默认偏好。

基本规则：

- 所有产品、技术、测试和交付文档默认使用中文；产品名、库名、命令、API 名和必要技术术语保留英文。
- 先理解需求和现有代码，再修改文件；不得把猜测当成事实。
- 不覆盖、删除或重置用户已有修改；遇到重叠变更必须先说明。
- 不把密码、token、私钥、签名证书、云厂商密钥或个人信息写入代码、文档、日志、测试数据和 Git。
- 未经用户明确要求，不执行 `git commit`、`git push`、合并、发布、删除数据或生产部署。
- 编码过程中禁止自动提交 Git commit；用户明确要求提交时，必须使用 `pnpm commit`，不能直接运行 `git commit`。
- 任何“完成”“通过”“已修复”“已发布”的表述都必须有本轮新鲜验证证据。

## 2. 技能选择协议

每次开始新任务先检查当前可用的 Skills，并根据任务类型选择最小但完整的技能集合。使用技能前必须读取对应 `SKILL.md`，并在 `commentary` 说明使用原因。

### 必选流程

- 需求、设计、功能或行为变化：使用 `brainstorming`。
- 需求范围、方案、平台能力、验收标准存在未决分支：使用 `grilling`，以设计树和 frontier 轮次逐轮提问；事实由智能体自行调研，不把可查询事实丢给用户。
- 已批准设计进入实现计划：使用 `writing-plans`。
- 开始功能实现或修复：使用 `test-driven-development`，先写失败测试，再最小实现，再重构。
- 需要隔离开发或多个独立特性：使用 `using-git-worktrees`。
- 两个及以上任务可以无共享状态并行：使用 `dispatching-parallel-agents` 或 `subagent-driven-development`。
- 即将声明完成、提交或创建 PR：使用 `verification-before-completion`；重大功能完成前使用 `requesting-code-review`。

### 需求澄清规则

- 只有当需求真的存在多个会改变范围、成本、架构或验收结果的解释时，才启动 `grilling`。
- Grill Me 按轮次询问当前 frontier 的全部决策问题，每个问题给出推荐选项和取舍；不提前询问依赖尚未决策的问题。
- 事实、版本、目录、代码现状优先通过文件、命令和官方文档查明，不向用户询问可以自行确认的事实。
- 未解决的关键歧义不得进入编码；必须记录为已确认决策或阻塞项。

## 3. Spec-Driven Development 工作流

SourceFlow 按 GitHub Spec Kit 的 Specify → Plan → Tasks → Implement → Converge 主流程执行；复杂任务增加 Clarify、Checklist 和 Analyze 阶段。官方参考：[Spec Kit](https://github.com/github/spec-kit) 和 [Agentic SDD](https://github.github.com/spec-kit/reference/agentic-sdd.html)。

### 3.1 项目级原则

- 项目原则维护在 `.specify/memory/constitution.md`。
- 修改原则时必须说明影响范围、迁移策略和对现有功能的影响。
- 新功能不得绕过 Constitution、PRD 和技术基线。

### 3.2 功能级产物

每个独立功能使用独立 feature 目录，建议：

```text
specs/<feature-name>/
├── spec.md                    # 需求规格：做什么、为什么、验收什么
├── plan.md                    # 实现计划：怎么做、边界和技术决策
├── tasks.md                   # 可执行任务：文件、接口、测试和依赖
├── checklists/requirements.md # 需求质量检查
└── research.md                # 必要的调研、事实和决策依据
```

### 3.3 标准顺序

1. `constitution`：确认项目原则和不可违反约束。
2. `specify`：把用户需求写成可验收的需求规格。
3. `clarify`：发现范围、异常、权限、数据、平台和非功能歧义。
4. `plan`：锁定架构、边界、依赖、数据迁移和测试策略。
5. `checklist`：检查需求完整性、一致性和可测试性。
6. `tasks`：按依赖拆成可独立执行的小任务，标记并行关系。
7. `analyze`：交叉检查 spec、plan、tasks 是否有遗漏或矛盾。
8. `implement`：严格按任务执行，采用 TDD 和隔离 Worktree。
9. `converge`：运行质量门禁、验收清单和代码审查，直到无未解决差距。

规格、计划和任务必须相互可追溯：每个 P0/P1 需求至少对应一个任务和一个测试；每个任务必须能指向需求；每个验收标准必须有验证方式。

## 4. Git Worktree 与多智能体并行

### 4.1 Worktree 规则

- 开始实现前先检查是否已在 linked worktree，禁止在 worktree 内再创建嵌套 worktree。
- 默认使用项目根目录 `.worktrees/<branch-name>`；创建前必须确认 `.worktrees/` 已被 `.gitignore` 忽略。
- 分支名使用 `feat/<feature>`、`fix/<issue>`、`chore/<scope>`、`docs/<scope>`。
- 每个 Worktree 只负责一个独立功能或一个明确任务，不在同一 Worktree 混入无关重构。
- 只有任务依赖已稳定的接口/类型时才能启动下游 Worktree；共享文件冲突应先拆边界或串行化。
- 智能体不得自动合并、推送或删除 Worktree；完成后留下变更和验证报告，由用户决定整合。

### 4.2 并行任务规则

- 适合并行：独立页面、独立平台适配器、独立测试模块、独立文档、独立构建配置。
- 不适合并行：同一领域模型、同一数据库迁移、同一状态机、同一核心接口和依赖前置决策的任务。
- 每个子任务必须有明确输入、输出、修改文件、测试命令和完成标准。
- 实现智能体完成后，先由任务审查智能体做规格符合性和代码质量审查，再进入下一个依赖任务。
- 所有任务完成后必须进行一次全局审查，检查跨任务接口、权限、错误处理和发布风险。

## 5. TDD 与测试体系

### 5.1 红-绿-重构

每个行为变化必须遵循：

1. 写一个能表达需求的失败测试。
2. 运行并确认它因预期原因失败。
3. 写最小实现使测试通过。
4. 运行目标测试和相关回归测试。
5. 重构代码，保持测试继续通过。
6. 更新需求追踪矩阵和验收记录。

### 5.2 测试工具与边界

- 领域逻辑、服务端模块、工具函数：Vitest。
- React Web/H5 组件和 Hooks：Vitest + React Testing Library。
- Web、H5、API 合同和 Electron 冒烟：Playwright。
- React Native 共享领域逻辑：Vitest；原生系统 UI 的完整 E2E 若 Playwright 无法覆盖，必须单独记录覆盖缺口并评估原生测试工具，不得声称已覆盖。
- 外部平台、AI、支付、邮件和云服务必须使用契约 Mock 或沙箱；测试不得访问生产账号。

### 5.3 质量门槛

- 全仓库：语句 85%、分支 80%、函数 85%、行 85%。
- 核心领域、权限、计费、平台适配：行覆盖率 ≥ 95%，分支覆盖率 ≥ 90%。
- 每个 P0 用户流程至少有一条 Playwright smoke。
- 每个 P0 异常路径至少有一条失败测试。
- 禁止用提升阈值、跳过测试或扩大快照来掩盖失败。
- Flaky 测试必须登记、定位、修复；不得长期静默重试。

## 6. 代码规范与自动化验证

### 6.1 必须统一的工具

- TypeScript strict mode、共享 `tsconfig`。
- ESLint：代码质量、React Hooks、import、可疑异步和安全规则。
- Prettier：统一格式，CI 使用 `--check`。
- Commitlint：校验 Conventional Commits。
- Commitizen：通过 `pnpm commit` 生成规范提交信息。
- Husky：提交前运行 lint-staged、类型检查和必要的快速测试；push 前运行质量检查。
- Spellcheck：检查产品文档、用户可见文案、注释和变量命名中的拼写；业务专有词维护词典。
- 依赖审计：锁文件、过期依赖、许可证和高危漏洞进入 CI 结果。

### 6.2 命名和工程边界

- React 组件、Hook、类型和领域对象使用明确命名，禁止 `utils2`、`temp`、`data1` 等无语义命名。
- 页面不得直接拼接 API URL；统一使用 `api-client`。
- 跨端共享领域模型、校验器和 API 契约；不强行共享不兼容的 DOM/Native UI。
- 单文件职责清晰；当文件同时承担领域规则、接口调用和页面渲染时必须拆分。
- 所有异步任务都要有 loading、success、empty、error、retry 状态。

## 7. CI 质量门禁

### Pull Request 和 push 必须执行

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm spellcheck
pnpm typecheck
pnpm test:unit -- --run --coverage
pnpm test:component -- --run
pnpm test:integration -- --grep @smoke
pnpm build:web
pnpm build:h5
docker compose config
```

### 主分支和发布候选增加

- 完整 Playwright 多浏览器和响应式矩阵。
- Electron 打包和启动 smoke。
- API/Worker Docker 镜像构建、漏洞扫描和 digest 记录。
- 数据库迁移、备份恢复演练和回滚检查。
- 产物 SHA256、SBOM、版本元数据和发布说明。
- 依赖、许可证、Secrets 和容器安全扫描。

CI 失败必须阻断合并；若确需豁免，必须记录原因、责任人、过期时间和补救任务，不得静默跳过。

## 8. Conventional Commits 与提交规则

提交格式：

```text
<type>(<scope>): <English summary>
```

允许的 `type`：`feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`build`、`ci`、`perf`、`revert`。

示例：

```text
feat(content): add content batch generation flow
test(domain): cover quota deduction boundaries
ci(tooling): add Playwright smoke gate
```

规则：

- 智能体不自动提交。
- 用户明确要求提交时使用 `pnpm commit`，由 Commitizen 选择 type、scope 和描述。
- Commitlint 和 Husky 必须拦截格式错误、未通过快速测试或含敏感信息的提交。
- 未经用户明确要求不得 push、开 PR、打 tag 或发布。

## 9. 安全、数据和运维补充约束

- 所有 workspace 资源访问必须服务端二次校验归属，不能只依赖前端隐藏按钮。
- 密钥使用环境变量、CI Secret 或云 Secret Manager；日志脱敏，错误信息不泄漏 token 和个人信息。
- 数据库迁移必须向后兼容，先扩展后切换再清理；生产迁移前备份并记录回滚策略。
- PostgreSQL 是业务事实来源，Redis 只能用于缓存、锁、队列和短期状态。
- API、Worker、Web、数据库、Redis 必须有健康检查、结构化日志和最小可用指标。
- 长任务必须幂等、可重试、可取消，并记录任务状态、错误原因和重试次数。
- 发布失败不能伪装成发布成功；平台不支持自动发布时必须提供辅助发布或导出发布包。
- 前端必须考虑键盘可用性、对比度、屏幕阅读器、响应式布局、时区和中文/英文文本长度。
- 用户数据删除、导出、账号断开和线索访问必须有权限、二次确认和审计日志。
- Docker 生产镜像使用非 root 用户、最小暴露端口、固定生产 tag/digest，并保留回滚版本。

## 10. 自主验收与 Definition of Done

任务只有同时满足以下条件才能报告完成：

- 需求已映射到 spec、plan、tasks 和测试。
- P0/P1 验收标准逐项验证并有命令输出或测试报告。
- 单元、组件、集成和相关构建通过；若未执行，必须明确说明原因。
- ESLint、Prettier、Spellcheck、TypeScript 和 CI 质量门禁通过。
- 错误态、权限、空态、加载态、重试、可访问性和安全边界已检查。
- 文档、API 契约、环境变量说明、迁移说明和发布清单同步更新。
- 变更范围没有无关文件，未覆盖用户修改，未自动提交 Git。
- 需要代码审查的任务已经完成任务级和最终级审查，重要问题已解决。
- 最终回复包含：完成内容、验证命令及结果、未完成项、风险和下一步。

## 11. 默认工作提示

开始任务时先回答：

1. 当前需求属于哪个 Spec Kit feature？
2. 哪些文件和模块会变化？
3. 哪些任务可以在独立 Worktree 中并行？
4. 失败测试先写在哪里？
5. 完成时由哪些命令和验收清单证明？

如果这些问题无法回答，先回到需求澄清或设计阶段，不直接编码。
