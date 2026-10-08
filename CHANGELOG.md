# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09-30 及更早，含学习系统分层升级与可读性定点修复）。

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

### 流式生成空闲超时（2026-10-08）
- 根因：上游 LLM 网关可能“保活连接但停发内容”，httpx 读超时对此不生效，
  stream_chat 的 async for 永远等不到 [DONE] → 答疑卡“正在回答中”、任务流挂起数分钟
- 修复：lib/minimax.stream_chat 增加应用层空闲超时（60s 无新数据行抛 IdleStreamError），
  由调用方既有错误路径收尾（答疑 → “回答流中断，请重试”；任务流 → 重新生成本节）

### 检查点生成卡死防护（2026-10-08）
- 检查点生成请求增加双层超时：前端 fetch 120s、Next 代理 130s；服务断线/上游挂起时
  自动进入既有失败通知路径（解锁章节、可重试），不再无限停留在“正在生成本章理解检查”

### 交互组件 Phase 2：对比组件 + 完成信号（2026-10-08）
- 目录扩充至 5 个组件：新增 `bar-compare`（数值幅度对比条形图，单位/非负校验）与 `before-after`（前后状态切换，非数值对比）
- 扩展性分工：数值幅度差距走 bar-compare，非数值状态对照走 before-after，多维度逐项对比保留 :::comparison 表格块；渲染入口改为注册表模式，新增组件 = 一个 View + 一条注册
- 交互完成接入参与信号（engagement `interactive_completed`，每块只记一次、静默失败）：parameter-demo 首次调参、step-walkthrough 走到最后一步、before-after 首次切换后记录；不计入掌握度证据（保持“只有 Checkpoint 评估投影记忆”不变量）
- 新增 4 个单测；渲染器 courseId 透传（章节页 → 学习流 → 内容块）

### flow-diagram 交互组件（2026-10-08）
- 新增第三个交互组件：结构总览流程图（正向链 + 循环回边徽记），替代大部分 Mermaid flowchart 场景；sequenceDiagram/复杂分支仍用 :::diagram
- 解析/校验/降级与渲染模式同 Phase 1；新增 3 个单测；架构文档同步

