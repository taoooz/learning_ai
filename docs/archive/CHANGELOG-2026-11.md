# 迭代日志归档（2026-11-19 至 2026-11-21）

### Memory V4 上线、硬化与 V3 下线（2026-11-19 至 2026-11-21）
- LLM 全链路切换为 `ark/deepseek-v4-1-flash`；搜索决策交由模型 tool-calling，淘汰关键词预搜，EvidencePack 仍由代码持久化、去重与约束
- 课程质量 P0/P1：补齐水平置信度/已掌握/可能缺口/例子策略并加入低置信度校准门；章节交付进入蓝图，新增独立计划审查与概念重叠拦截；任务块改为弹性结构，章内共享概念与例子账本，个人经历默认每章最多 1 次
- Course Architect 接入课程创建主链路：Architect 生成课程架构并由 Blueprint Compiler 落库，TOC 节点改为确定性渲染；LLM 审查改为 auto 风险触发，常规架构跳过。10 主题批跑全通过，3 个过度拆分主题收敛到 6 章；推荐课程完整链路 54 秒生成 6 章并通过 Blueprint 校验
- 真实 Chromium E2E 打通登录→校准→纲要确认→Architect 生成→6 章落库→3 步任务→Checkpoint 判分；修复 Markdown GFM 表格缺失与单波浪号被误删，并兼容 Checkpoint 的 `items`/多题型示例包装
- 新增 account-scoped Memory V4 Store、画像自动导入、Evidence 账本与 Concept/Topic 投影；课程生成/聊天改由服务端读取统一 Memory，旧 V3 直接写 mastery 路径下线
- P0/P2：Checkpoint 生成失败可原地重试；Outline 澄清改为第一题闭合即流式展示、全选择题、点选自动前进、全部准备后统一提交；Architect 改为两阶段生成（先流式章节、再完整元信息，失败只做阶段内定向修复），并保留 chat-only 客户端兼容与用户输入不可信边界；课程范围由原始诉求推断、背景只调起点，章节交付物可为理解/判断/小练习/产物；计划审查改为风险触发并加入阶段推理档位；正文首块立即展示、互动组件统一暖色视觉；真实任务正文 8～10 秒，架构首章 3.2 秒、6 章 13.2 秒、总耗时 29.4 秒
- 新增内部 Course Prompt Lab：9 个课程生成环节可切换调试，左侧输入默认读取服务端 Memory V4 画像与 planning payload，中间编辑静态 system 与动态 user Prompt，右侧流式思考/回复/解析/工具结果；内置按环节优化的助手，可主动对话、评测最近输出并生成可应用的 Prompt 改写；Planning Memory 去除内部 record ID并提供只读 memory_search，Outline 澄清题可直接作答后带入下一环节，调试主题/产物可跨环节继承且不写正式数据

### 课程生成链路体检：死重清理（2026-11-23）
- 下线 V1 遗留双轨：删除 main.py 旧版 outline/generate、outline/answer、toc/generate 路由（BFF 只调 agent 版），连同 toc_service、prompts/toc、lib/constants（FRAME_DESCRIPTIONS 等 V1 画像/框架常量）与对应测试
- outline_service 瘦身 410→190 行：删 BLUEPRINT_SCHEMA（XML 协议下的死 JSON schema）、阻塞式 stream_llm_and_parse、stream_blueprint_fields、三个无调用格式化函数与 build_initial_prompt 兼容入口
- 清除散点死代码：checkpoint 重复的 OPEN_ENDED_EVAL_PROMPT、chat prompt 无调用 base 键、chapter_plan return 后不可达块、interactive_block 未用的 _KV_RE/edges 上限、toc_agent 即删的 max_tokens 参数、recap 引用不存在的 summary 字段、两处恒空的 recentQuestionSummaries
- 净 -459 行；pytest 335、TS 330 全通过，应用启动冒烟确认路由只剩 agent 版
