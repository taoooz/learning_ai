# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09-30 及更早，含学习系统分层升级与可读性定点修复）。

### Memory V4 上线、硬化与 V3 下线（2026-11-19 至 2026-11-20）
- 新增 account-scoped Memory V4 Store、画像自动导入、Evidence 账本与 Concept/Topic 投影；课程生成/聊天改由服务端读取统一 Memory，旧 V3 直接写 mastery 路径下线
- Checkpoint 改为服务端 sealed definition：教学范围由蓝图/章节容器反查，answer 独立为不可信数据，attempt 在账户锁内顺序写入；新增 tombstone、revision、场景化 D0-D3 Context Resolver、Memory 管理 UI、复习队列、来源可核验的 Candidate、服务端 Chat/Chapter Episode、Learning Summary 与投影 dirty 自愈；P1/P2 新增 Playwright server 模式确定性 E2E，lesson 保存改为单写入器 + 最新快照合并，并修复 StrictMode boot、刷新相位镜像、Checkpoint 完成事实和后台 Candidate 调度；同时彻底删除 Next/Python refine 入口、V3 Store/repository/aggregator/client、验证脚本与纯 V3 测试，聊天困惑与偏好信号继续由当前 Chat Summary 轻量规则承接，并新增双端 404 退役回归；同步收紧画像 prompt 类型边界、移除旧存储清理与无账户 key 自动迁移，并删除过期根目录验收材料与失效生成诊断脚本；P1 删除 `StoredDataV2.courses`、旧课程类型、V1 回退分发和过渡 feature flag，存储只保留 `v2Courses + userProfile + recommendations`

### 交互内容块 Phase 1（2026-10-08）
- 新增 `interactive` 内容块类型与首批两个消费型组件：`parameter-demo`（改参数看结果，命名变量白名单公式求值）、`step-walkthrough`（分步演示）
- Python 侧：流式解析器支持 interactive 块，schema 校验 + 公式试算，任一失败整块降级为等价 markdown（不阻塞生成流）；前端新增 InteractiveBlockV2 渲染器与 `lib/interactive/formula` 求值器（未知组件降级渲染）
- Prompt：流程/机制类任务优先用分步演示模板，含数值参数关系用参数演示模板；交互结果不计入掌握度证据（Phase 2 再打通）
- 新增 Python 5 个 + Node 6 个单测；架构文档补充 InteractiveBlock 数据契约

### 课程内容文风规范（精简版，2026-10-08）
- 任务内容/流内答疑/章节小结 prompt 注入四条文风规则：篇幅随素材（禁止注水与假细节）、知识状态分层（定论/惯例/无定论）、禁提示性开场与翻案腔、按学习者问题推进
- 新增 `services/style_lint.py` 文风观测 lint（纯正则，零依赖）：挂到任务内容、答疑、小结生成完成路径，只记日志不拦截不重试；新增 4 个单测
- 速度影响：prompt 增加约 300 tokens/次（毫秒级 prefill），lint 微秒级；后续按命中率数据决定是否收紧
- 参考 Karpathy 的 ASD-STE100 受控英语建议（36kr 文章），补充两条规则：同一概念全篇同名（优先用课程统一术语表）、程序性步骤一句一操作

### 生成链路稳定性（2026-10-08）
- 流式空闲超时：上游网关可能“保活连接但停发内容”（httpx 读超时不生效），
  stream_chat 60s 无新数据行主动断流，答疑/任务流走既有错误重试路径
- 检查点生成双层超时（前端 120s、代理 130s）：服务断线时自动解锁章节、可重试
### 流式体验优化（2026-10-08）
- 结构化块渐进渲染：example/key_point 块壳先行、内容逐行填充；校验失败降级 markdown
- 边界卡去重（单一信息源）；互动演示卡片分区美化
### 交互组件 Phase 2：对比组件 + 完成信号（2026-10-08）
- 目录扩充至 5 个组件：新增 `bar-compare`（数值幅度对比条形图，单位/非负校验）与 `before-after`（前后状态切换，非数值对比）
- 扩展性分工：数值幅度差距走 bar-compare，非数值状态对照走 before-after，多维度逐项对比保留 :::comparison 表格块；渲染入口改为注册表模式，新增组件 = 一个 View + 一条注册
- 交互完成接入参与信号（engagement `interactive_completed`，每块只记一次、静默失败）：parameter-demo 首次调参、step-walkthrough 走到最后一步、before-after 首次切换后记录；不计入掌握度证据（保持“只有 Checkpoint 评估投影记忆”不变量）
- 新增 4 个单测；渲染器 courseId 透传（章节页 → 学习流 → 内容块）

### 跨章去重 + 学习目标对齐（2026-10-08）
- 章节计划注入已完成章节 recap 摘要（前端收集、请求透传），硬规则禁止复讲
  已覆盖概念与重复举例；举例必须换场景
- 大纲终点倒推：TOC 先推断“结课产出物”，每章描述必须以“本章交付：<可验证能力>>”
  收尾；构建/复现类诉求下讲解/对比/生态类内容合计不超过一章
- 章节计划注入课程意图类型（skill_mastery 等）与“本章交付”硬约束：
  任务 observableOutcome 必须可验证且拼接后支撑本章交付

### 练习环节职责修正（2026-10-08）
- 修正上一条目未完全落地的拟人化禁令（补入 style_rules），并按用户反馈调整练习职责：
  正文直接给结论（判断标准/误区/下一步），不再输出填空式自测让用户猜；
  检验统一由章末理解检查承担。lint 增加填空式练习观测。

### flow-diagram 交互组件（2026-10-08）
- 新增第三个交互组件：结构总览流程图（正向链 + 循环回边徽记），替代大部分 Mermaid flowchart 场景；sequenceDiagram/复杂分支仍用 :::diagram
- 解析/校验/降级与渲染模式同 Phase 1；新增 3 个单测；架构文档同步
