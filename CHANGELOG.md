# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09 及更早）与 `docs/archive/CHANGELOG-2026-10.md`（2026-10-08 交互组件与文风规范等）。

### 课程生成链路体检：Prompt 卫生、服务端红线与口径统一（2026-11-23）
- Prompt 卫生：交互块"恰好一个"矛盾改为"最多一个、可没有"；证据 ID 示例改完整形态并要求逐字复制；删除泄漏进通用 prompt 的提示词工程例句；architect 概念 ID 示例统一为语义 ID（cache-aside），消除与"禁 c1/c2"的矛盾；删除服务端已写入字段的输出指令（estimatedSeconds/evidencePolicy/origin/status）；parameter-demo 公式列要求与商业黑话/洞察路标两条文风规则写进 prompt；checkpoint 题型显式限定三种
- 服务端红线：补救沿 previousCheckpointId 题链封顶连续 2 轮（按单题计数无法封顶链式新题），已达标不得再补救；chat 异常文案通用化不再泄漏内部细节；Prompt Lab Python 侧补 ENABLE_PROMPT_DEBUGGER/ENV 门禁（与 BFF 同语义）；recap 校验失败 retryable 与文案矛盾修正
- 死重二轮：删 frame（V1 框架遗留）、difficultySummary/whyThisCourseFits（挪用/恒空）、SCENE_POLICIES 六个装饰字段；architect 画像三份注入去重（planningMemory 剔除 learnerSnapshot）、tutor 问题双注入去重（问题只走 user message）
- 确定性校验：architect 交付物以空泛认知动词（了解/熟悉/掌握等）开头进入修复链；章节计划补 TITLE_REPEATS_CHAPTER 告警（镜像 TS 精确匹配）
- 结构化输出试点：端点探测确认 response_format 真实强制、reasoning_effort=none 可关思考、reasoning_split 被端点忽略但客户端本地用于合成 reasoning_details（保留）；client.chat 支持 response_format 并在 7 个小 JSON 调用点启用 json_object；json_schema strict 迁移留作下一批
- 口径统一：置信度阈值单常量 0.6（prompt/代码同源）；任务时长规格回流 2～6 分钟；Architect 语义审查硬门改软门（修复失败携 reviewIssues 放行，ARCHITECT_REVIEW_STRICT=1 恢复硬门）；章节数硬卡 8 改软收敛 + 硬上限 12
- 验证：pytest 355、TS 333、docs:check 全通过；README 同步补救封顶与审查软门契约

### 课程生成链路体检：P0 bug 修复（2026-11-23）
- 修复章节小结流式重复拼接：`stream_chapter_recap_events` 误把累积全文喂给增量解析器，keyTakeaways 跨多个 chunk 时下发重复/垃圾要点；改为只喂增量，补跨 4 chunk 回归测试
- 修复聊天助理无记忆载荷时丢失全部课程上下文：去掉 `build_chat_system_prompt` "无记忆只回 base 一句"的早退，课程主题/学习节点/题目上下文/对话摘要始终注入
- 修复遗留 `Thinking` 清理正则误删正文：改为只匹配独占行成对标记（outline_agent/minimax/minimax_agent 共 6 处），Design Thinking 等课程主题正文不再被吞
- scenario_choice 正确答案归一：忽略大小写匹配 option id，单字母/1 基数字按选项顺序映射；越界答案仍由 schema 拦截
- 新增 15 个回归测试（recap/chat/thinking/checkpoint），pytest 全量 338 通过

### 课程生成链路体检：意图契约与记忆 ID 收敛（2026-11-23）
- intentType 升级为澄清阶段业务契约：outline prompt 新增意图判定与 intentType 槽位，解析层只接受四枚举；蓝图编译器优先消费契约值，缺失/非法才回退关键词推断（兼容旧会话），回退正则移除裸"问题"一词的误判面
- 契约全链路透传：outline blueprint → chat/confirm 页 pendingOutline → TOC 编译器入参，Prompt Lab 同步
- plan/task/tutor 的 prompt 记忆载荷剥离 memoryId，对齐 README#15（细节检索走按关键词的只读 memory_search）
- 新增回归：意图槽位解析/归一化、编译器契约优先与回退、记忆 prompt 不泄露 record ID；pytest 337、TS 333、tsc 全通过

### 课程生成链路体检：死重清理（2026-11-23）
- 下线 V1 遗留双轨：删除 main.py 旧版 outline/generate、outline/answer、toc/generate 路由（BFF 只调 agent 版），连同 toc_service、prompts/toc、lib/constants（FRAME_DESCRIPTIONS 等 V1 画像/框架常量）与对应测试
- outline_service 瘦身 410→190 行：删 BLUEPRINT_SCHEMA（XML 协议下的死 JSON schema）、阻塞式 stream_llm_and_parse、stream_blueprint_fields、三个无调用格式化函数与 build_initial_prompt 兼容入口
- 清除散点死代码：checkpoint 重复的 OPEN_ENDED_EVAL_PROMPT、chat prompt 无调用 base 键、chapter_plan return 后不可达块、interactive_block 未用的 _KV_RE/edges 上限、toc_agent 即删的 max_tokens 参数、recap 引用不存在的 summary 字段、两处恒空的 recentQuestionSummaries
- 净 -459 行；pytest 335、TS 330 全通过，应用启动冒烟确认路由只剩 agent 版

### Memory V4 上线、硬化与 V3 下线（2026-11-19 至 2026-11-21）
- LLM 全链路切换为 `ark/deepseek-v4-1-flash`；搜索决策交由模型 tool-calling，淘汰关键词预搜，EvidencePack 仍由代码持久化、去重与约束
- 课程质量 P0/P1：补齐水平置信度/已掌握/可能缺口/例子策略并加入低置信度校准门；章节交付进入蓝图，新增独立计划审查与概念重叠拦截；任务块改为弹性结构，章内共享概念与例子账本，个人经历默认每章最多 1 次
- Course Architect 接入课程创建主链路：Architect 生成课程架构并由 Blueprint Compiler 落库，TOC 节点改为确定性渲染；LLM 审查改为 auto 风险触发，常规架构跳过。10 主题批跑全通过，3 个过度拆分主题收敛到 6 章；推荐课程完整链路 54 秒生成 6 章并通过 Blueprint 校验
- 真实 Chromium E2E 打通登录→校准→纲要确认→Architect 生成→6 章落库→3 步任务→Checkpoint 判分；修复 Markdown GFM 表格缺失与单波浪号被误删，并兼容 Checkpoint 的 `items`/多题型示例包装
- 新增 account-scoped Memory V4 Store、画像自动导入、Evidence 账本与 Concept/Topic 投影；课程生成/聊天改由服务端读取统一 Memory，旧 V3 直接写 mastery 路径下线
- P0/P2：Checkpoint 生成失败可原地重试；Outline 澄清改为第一题闭合即流式展示、全选择题、点选自动前进、全部准备后统一提交；Architect 改为两阶段生成（先流式章节、再完整元信息，失败只做阶段内定向修复），并保留 chat-only 客户端兼容与用户输入不可信边界；课程范围由原始诉求推断、背景只调起点，章节交付物可为理解/判断/小练习/产物；计划审查改为风险触发并加入阶段推理档位；正文首块立即展示、互动组件统一暖色视觉；真实任务正文 8～10 秒，架构首章 3.2 秒、6 章 13.2 秒、总耗时 29.4 秒
- 新增内部 Course Prompt Lab：9 个课程生成环节可切换调试，左侧输入默认读取服务端 Memory V4 画像与 planning payload，中间编辑静态 system 与动态 user Prompt，右侧流式思考/回复/解析/工具结果；内置按环节优化的助手，可主动对话、评测最近输出并生成可应用的 Prompt 改写；Planning Memory 去除内部 record ID并提供只读 memory_search，Outline 澄清题可直接作答后带入下一环节，调试主题/产物可跨环节继承且不写正式数据
