# SourceFlow Vitest 单元测试用例

状态：测试设计基线
范围：根据 PRD P0/P1 功能拆解的纯函数、领域服务、React Hook/组件和服务端模块。

## 1. 测试用例字段

- 用例编号：唯一编号。
- 需求映射：对应 PRD 的 FR 编号。
- 前置条件：测试所需数据或状态。
- 输入：函数、事件或请求参数。
- 期望：可断言的结果、状态变化或错误。
- 优先级：P0 阻断主流程，P1 重要功能，P2 边界增强。

## 2. 工作区、成员与权限

| 编号 | 需求 | 用例 | 输入/前置 | 期望 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| UT-WORK-001 | FR-001 | 创建工作区生成默认品牌资料 | 合法名称、语言、创作者类型 | 返回 workspace、brand，状态为 active | P0 |
| UT-WORK-002 | FR-001 | 工作区名称去除首尾空格 | `  SourceFlow  ` | 保存为 `SourceFlow` | P1 |
| UT-WORK-003 | FR-001 | 空名称不能创建 | 空字符串 | 返回字段错误，不调用持久化 | P0 |
| UT-WORK-004 | FR-014 | Owner 拥有全部权限 | Owner + 所有资源 | 所有动作均为 allowed | P0 |
| UT-WORK-005 | FR-014 | Editor 不能修改账单 | Editor + billing:update | 返回 forbidden | P0 |
| UT-WORK-006 | FR-014 | Viewer 不能导出线索 | Viewer + leads:export | 返回 forbidden | P0 |
| UT-WORK-007 | FR-014 | 资源不属于当前工作区时拒绝 | workspace A 请求 workspace B 资源 | 返回 not_found 或 forbidden，不泄漏资源存在性 | P0 |
| UT-WORK-008 | FR-014 | 移除成员后权限立即失效 | 成员从 workspace 移除 | 后续授权检查失败 | P0 |

## 3. 平台账号与能力卡片

| 编号 | 需求 | 用例 | 输入/前置 | 期望 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| UT-CHANNEL-001 | FR-002 | 添加有效账号 | 平台、token、账号资料 | 创建 Channel，状态 connected | P0 |
| UT-CHANNEL-002 | FR-002 | token 加密后再持久化 | 明文 token | 数据库中不出现明文 token | P0 |
| UT-CHANNEL-003 | FR-002 | 授权过期识别 | provider 返回 401 | Channel 状态 expired，生成通知 | P0 |
| UT-CHANNEL-004 | FR-002 | 重复连接同一账号幂等 | 相同平台账号二次连接 | 不创建重复 Channel，更新授权时间 | P1 |
| UT-CHANNEL-005 | FR-006 | A 级平台允许自动发布 | capability.publish=automatic | 发布动作可进入排期 | P0 |
| UT-CHANNEL-006 | FR-006 | B 级平台切换为辅助发布 | capability.publish=assisted | 显示复制/确认发布，不调用自动发布 | P0 |
| UT-CHANNEL-007 | FR-006 | C 级平台生成导出包 | capability.publish=export-only | 返回媒体、文案、标签、清单 | P0 |
| UT-CHANNEL-008 | FR-006 | 超出标题限制时阻止发布 | title 超出 max | 返回检查错误并定位字段 | P0 |
| UT-CHANNEL-009 | FR-006 | 多比例媒体检查 | 1:1 媒体投放 9:16 平台 | 返回比例风险和转换建议 | P1 |

## 4. 内容源、转写与批次

| 编号 | 需求 | 用例 | 输入/前置 | 期望 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| UT-SOURCE-001 | FR-003 | 支持的视频文件通过校验 | MP4、合法大小 | 创建 source，进入 uploaded | P0 |
| UT-SOURCE-002 | FR-003 | 不支持格式被拒绝 | EXE 或未知扩展名 | 返回 unsupported_format | P0 |
| UT-SOURCE-003 | FR-003 | 超过大小限制被拒绝 | 文件大小超过套餐上限 | 不创建处理任务，提示升级/压缩 | P0 |
| UT-SOURCE-004 | FR-004 | 转写结果保存时间戳 | 多段 transcript | 每段有 start/end/text | P0 |
| UT-SOURCE-005 | FR-004 | 处理失败可重试 | provider 返回 500 | source 状态 failed，可创建新任务 | P0 |
| UT-SOURCE-006 | FR-004 | 关键观点保留来源引用 | insight 指向 transcript | 展开可定位原文或时间码 | P0 |
| UT-SOURCE-007 | FR-004 | 修改转写创建新版本 | 修改一句文字 | 不覆盖旧版本，资产引用新版本 | P0 |
| UT-BATCH-001 | FR-005 | 创建内容批次 | source + 平台 + 模板 | batch 状态 generating | P0 |
| UT-BATCH-002 | FR-005 | 取消任务保留已生成资产 | 任务生成一半后取消 | 已生成资产保留，未完成任务 cancelled | P0 |
| UT-BATCH-003 | FR-005 | 额度不足不创建任务 | 剩余额度小于预计消耗 | 返回 quota_exceeded | P0 |
| UT-BATCH-004 | FR-005 | 重复生成保存参数 | prompt、模型、源版本 | 结果保存 generation metadata | P1 |

## 5. AI 生成与品牌规则

| 编号 | 需求 | 用例 | 输入/前置 | 期望 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| UT-AI-001 | FR-005 | 生成多平台资产 | 2 平台 × 2 类型 | 返回 4 个独立资产 | P0 |
| UT-AI-002 | FR-005 | 缩短文案保持核心观点 | 长文案 + shorten | 长度下降且核心引用仍存在 | P0 |
| UT-AI-003 | FR-005 | 换语气只改变语气 | 语气=口语化 | 事实和 CTA 不被删除 | P1 |
| UT-AI-004 | FR-005 | 生成失败不扣成功额度 | provider 超时 | 任务失败，额度返还或标记待结算 | P0 |
| UT-AI-005 | FR-005 | 资产版本可恢复 | v1 编辑成 v2 | 恢复 v1 后正文、配置一致 | P0 |
| UT-AI-006 | FR-005 | 每个结论可回溯来源 | source citation | citation 可解析到 source/version/offset | P0 |
| UT-BRAND-001 | FR-005 | 禁用词检测 | 文案含禁用词 | 标记风险且不可直接批准 | P0 |
| UT-BRAND-002 | FR-005 | 品牌术语自动替换 | 术语词典配置 | 使用标准术语并记录替换 | P1 |
| UT-BRAND-003 | FR-005 | 高风险事实提示核验 | 含数字/医疗结论 | 返回 needs_fact_check | P0 |

## 6. 编辑、审核、排期与发布

| 编号 | 需求 | 用例 | 输入/前置 | 期望 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| UT-WORKFLOW-001 | FR-008 | 草稿提交审核 | draft asset | 状态变为 needs_review | P0 |
| UT-WORKFLOW-002 | FR-008 | Reviewer 批准 | Reviewer + needs_review | 状态 approved，记录审计日志 | P0 |
| UT-WORKFLOW-003 | FR-008 | Reviewer 退回需原因 | 空原因 | 拒绝退回 | P0 |
| UT-WORKFLOW-004 | FR-008 | 退回后创建新版本 | 有原因退回 | 状态 needs_changes，新版本可编辑 | P0 |
| UT-SCHEDULE-001 | FR-009 | 合法时间创建排期 | approved + future time | 状态 scheduled，保存时区 | P0 |
| UT-SCHEDULE-002 | FR-009 | 过去时间被拒绝 | approved + past time | 返回 invalid_schedule_time | P0 |
| UT-SCHEDULE-003 | FR-009 | 账号时区转换正确 | Asia/Shanghai → UTC | 存储 UTC，展示本地时间一致 | P0 |
| UT-SCHEDULE-004 | FR-009 | 冲突产生警告不误删 | 同账号同时间两条 | 返回 conflict warning，两条仍存在 | P1 |
| UT-PUBLISH-001 | FR-010 | 自动发布成功 | A 级平台 | 状态 published，保存 provider id | P0 |
| UT-PUBLISH-002 | FR-010 | 发布失败可重试 | provider 429 | 状态 publish_failed，计算退避时间 | P0 |
| UT-PUBLISH-003 | FR-010 | 连续失败生成导出包 | 重试达到上限 | 提供 ZIP 发布包，不丢失内容 | P0 |
| UT-PUBLISH-004 | FR-010 | 辅助发布不伪造成功 | B 级平台 | 状态 assisted_pending，不能显示 published | P0 |

## 7. 数据复盘与线索

| 编号 | 需求 | 用例 | 输入/前置 | 期望 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| UT-ANALYTICS-001 | FR-011 | 合并多平台原始指标 | 2 平台同资产 | 原始指标分平台保存，汇总可追溯 | P0 |
| UT-ANALYTICS-002 | FR-011 | 指标缺失不当作 0 | provider 缺少收藏字段 | 显示 unavailable，不计算为 0 | P0 |
| UT-ANALYTICS-003 | FR-012 | 样本不足不输出确定结论 | 仅 1 个样本 | insight 标记 low_confidence | P0 |
| UT-ANALYTICS-004 | FR-012 | 复盘建议可创建新批次 | insight + accept | 生成带来源的 batch draft | P0 |
| UT-LEAD-001 | FR-013 | CTA 绑定资产 | asset + CTA | 生成带 UTM 的发布版本 | P0 |
| UT-LEAD-002 | FR-013 | 线索保存来源 | 表单提交 | lead 绑定 channel/asset/CTA | P0 |
| UT-LEAD-003 | FR-013 | Viewer 不能导出线索 | Viewer | 返回 forbidden | P0 |
| UT-LEAD-004 | FR-013 | 删除线索符合保留规则 | Owner 删除 | 软删除并写审计记录 | P1 |

## 8. 计费与用量

| 编号 | 需求 | 用例 | 输入/前置 | 期望 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| UT-BILL-001 | FR-015 | Free 套餐额度正确 | 新工作区 | 账号 3、源内容 60 分钟、资产 20 个 | P0 |
| UT-BILL-002 | FR-015 | 生成前预估额度 | 任务配置 | 预估值与实际计量规则一致 | P0 |
| UT-BILL-003 | FR-015 | 80% 用量提醒一次 | 用量从 79% 到 80% | 发送一次提醒，不重复刷屏 | P1 |
| UT-BILL-004 | FR-015 | 100% 用量阻止高成本任务 | quota=0 | 返回 quota_exceeded | P0 |
| UT-BILL-005 | FR-015 | 升级后额度即时生效 | Creator → Pro | 新额度可用，账单按剩余天数折算 | P0 |
| UT-BILL-006 | FR-015 | 降级周期末生效 | Pro → Creator | 当前周期权益不变，下周期限制生效 | P0 |
