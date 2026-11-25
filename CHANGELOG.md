# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09 及更早）与 `docs/archive/CHANGELOG-2026-10.md`（2026-10-08 交互组件与文风规范等）、`docs/archive/CHANGELOG-2026-11.md`（2026-11-19～21 Memory V4）。

### I1 可靠性修复：strict 输出数字后杂散引号（2026-11-25）
- parse_enforced_json 新增确定性修复 _strip_stray_quote_after_number（字符串外扫描，合法 JSON 恒等）：pilot 两次整门中止根因 "order":2"，重试不收敛；先修复再判括号平衡。6 新测试含真实失败 raw 回归，532 测试过。

### 课程质量度量装置落地（CYCLE-0 阶段0+1，2026-11-25）
- evals/：五维 rubric（事实准确≤1一票否决）+ 60 条 golden set（权威源逐条核实）+ 预注册（符号检验+配对 bootstrap 双条件，MDE≈0.70）+ 10 类失败编码手册；修订 A0：单人工校准（human-vs-judge 团 κ≥0.6）
- 全链路 trace：EVAL_TRACE_DIR 开关式采集修复前原始输出/阶段用量/降级记录（未设置零开销）+ 离线 runner（blueprint 确定性移植、证据目录隔离）；新增 97 测试（trace 22 + judges 75）
- 评测 harness：事实溯源率（原子声明对证据归因）、目标↔内容↔评估对齐审计、3 异构 judge 成对偏好（双向位置交换去偏 + Bradley-Terry）、纯标准库统计（bootstrap/符号检验/κ/power）、基线报告与盲评校准工作表
### B3 收尾：章节计划与课程架构搜索门拆除（2026-11-24）
- 章节计划与 TOC/架构拆除 `allow_search=not coverage["covered"]` 关键词门：搜索工具始终可用，覆盖度经共享 `format_coverage_hint` 降级为 user 侧提示（与任务正文同构、不绑定 NO_SEARCH 协议）；架构提示在 messages 构建内按注入 sources 计算，规格同步"覆盖度与站点偏好均为提示非门禁"
- 回归：覆盖章节仍拿工具+提示、未覆盖弱匹配提示、架构提示非门、TOC 不再传禁搜参数；pytest 404、TS 333 全通过

### 主路径大 JSON 迁移 json_schema strict、引号修复退役（2026-11-23）
- 章节计划与 Architect 两阶段（章节/meta，含流式与修复轮）改用 `response_format=json_schema(strict)`；schema 与 pydantic 模型/消费字段同源，新增 `lib/structured_output.py`（env 开关 `LLM_STRICT_JSON_SCHEMA` 默认开，关闭回退 json_object）
- 传输层（chat/_call_llm/流式）遇网关拒绝（400/404/415/422）自动逐级降级 json_schema→json_object→无约束并记日志，降级不消耗重试配额；chat_with_tools/stream_chat_with_tools/_call_llm 新增 response_format 透传
- 实测（scripts/probe_strict_schema.py，7 用例）：大 schema strict 非流式/流式/含 tools 全部可用；tools 同传不抑制搜索，最终轮受约束；网关不校验 schema 自身合规性，由本地测试把关
- 新增 `parse_enforced_json`：两条主路径不再跑引号修复/XML/Thinking 清理启发式，仅保留剥围栏、首尾截取、截断检测最小安全网（降级模式兜底）；删除章节计划 prompt 的"不要用英文双引号"恳求；遗留 parse_json_response 保留供其他路径
- 验证：targeted pytest 143 通过（9 个受影响测试文件，含新增 test_structured_output.py 与服务级迁移回归）

### B3 搜索关键词门改造：模型做主要判断（2026-11-23）
- 任务正文搜索门：关键词覆盖（task_evidence_coverage）从"一票否决搜索"降级为注入决策 prompt 的提示；搜索决策阶段始终执行、web_search/read_url 始终可用，证据是否新鲜/充分、要不要搜由模型判断；两阶段决策与工具上下文复用架构不变；覆盖任务新增一次紧凑决策调用（max_tokens=1200、reasoning none）
- site: 偏好改可选提示：模型工具搜索不再强制前置 site: 查询（search_web_structured 新增 site_filter 开关并进缓存键；确定性预搜路径保留原行为），偏好域保留权威打分与排序；决策 prompt 注入"可选参考站点（非强制）"，搜索策略明示站点偏好非强制
- 覆盖函数保留、仅去除否决效力；章节计划/architect 的同类关键词门属并行 json_schema 迁移批次，本次未动
- 回归：覆盖仍拿工具/可选择不搜/仍可搜、未覆盖提示、site_filter 行为与缓存隔离等；targeted pytest 127 通过（9 个测试文件）

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
