# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09 及更早）与 `docs/archive/CHANGELOG-2026-10.md`（2026-10-08 交互组件与文风规范等）、`docs/archive/CHANGELOG-2026-11.md`（2026-11-19～21 Memory V4）。

### 证据摘录深化：生产补齐正文抓取（2026-11-28）
- 此前 `evidence_to_prompt` 只读 `excerpt` 但全仓**没有任何写入侧**，生产课程实际只拿到 260 字摘要（常是版权声明/协议样板）；摘录优先注入因此在生产空转。
- 新增 `_fetch_full_text`（httpx + lxml，剥 script/style/nav/header/footer/aside/noscript，优先 main/article，按页面 meta 声明解码）与 `_enrich_primary_excerpts`：只抓一手来源，每包最多 2 个、单次 15s 超时、整体预算 8s，失败回退摘要且不阻塞生成；`DISABLE_EVIDENCE_EXCERPT` 可整体关闭。
- 实测：MDN/React 官方页真实抓取 1639–8000 字，prompt 从 3000 涨到 7180 字并带上 ETag/304 等原文数据；非一手来源不抓取。新增 17 测试（conftest 默认屏蔽搜索与抓取），pytest 631 过。

### 链路精简与口径修正：删无消费产出、审查门适配两层大纲（2026-11-28）
- P1 审查门：`should_review_architecture` 的「章数>7 必审查」是单层大纲时代阈值，两层大纲后近 5 门课全部误触发；staged 模式改按单阶段章数判断，flat 保持原逻辑（实测三门课不再触发，省一次 13.8s 审查调用）。
- P2 删无消费产出：thesis.currentBoundary / conceptGraph[].rationale / examplePolicy.avoidRepeatedScenarios 全仓零消费却占元信息 16%；schema+prompt+TS 类型三端同步移除（实测元信息 13345→9746 字符、49.1s→26.0s）。
- I27 计划层分类口径纪律：不得自拟被讲系统分类当官方口径；证据只给例子就教例子；自建分析框架须写明是自己的尺子。
- I28 状态口径双向：既禁夸大（未默认开启说成可用），也禁贬低（已实现说成仅设计），定档以每条机制自己的证据为准。
- h2/h3 评测装置：溯源归因摘录优先（与 I23 一致）；默认评审团改国产并加测试禁止 OpenAI/Anthropic；播种摘录上限 4000→8000（长文后半机制此前被截断）。
- 614 Python + 333 TS 测试、tsc、docs:check 全绿。

### 证据接线与形态自由：事实编造归零（2026-11-28）
- I23 摘录优先注入：evidence_to_prompt 此前只传 260 字摘要（常为网页样板），全文摘录从未进 prompt；改摘录优先、无摘录回退摘要。
- I21/I26 证据边界：性能量级/机制限制/分类口径/状态口径须与证据一致；不得先自设量级再推算（如「按秒级算，一万条要几小时」）。
- I24 配方去配额：内容形态（字数/要点条数/表格行列/步数）由材料决定，保留组件渲染必需的技术约束。
- h1 评测装置保真度：runner 透传 authoritativeSources/goldenNotes（此前丢弃致计划层零证据）、播种包补 schemaVersion 与秒级时间戳、抓取失败改可见日志。
- 实测两门课：编造探测 0、源文真实数据入课、国产 judge 多数票 D1 3/3/3；613 Python 测试过。

### 计划层任务纪律 + Memory 渐进式披露六项（2026-11-28）
- I19 计划层任务纪律：observableOutcome 的「可验证」不再逼出课外动手作业（画图/产出文档/写方案），判断/选择/排序同样可验证，理解检查交课后题；跨域类比只作引入桥，逐条拆解对象必须是课程主体。修复正文层管不住的任务设计（实测动手作业与类比枝节归零）。
- Memory 生成与整理：架构审查通过后确定性投影 stages/roleInCourse/nonGoals 为 topic 级 episode（零额外 LLM）；类比经历改内容派生身份，顺序无关、重复幂等、新经历累积，推断缺席不再失效（删除只走用户显式 tombstone），状态字段仍按覆盖语义；同内容不涨版本。
- Memory 使用：空维度不再注入「暂无」（缺失即未知，避免诱发编造）；辅导对话挂载 memory_search 并写明触发/反触发判据；memory_search 加 detail=summary|full，默认只回摘要，确认不够用再取正文。
- Memory 掌握度：统一两条 payload 路径（此前 demonstrated 一处 1.0 一处 0.8），状态定基线 + 强证据加成，单次观测上限 0.7；不引入 BKT。新增 29 回归测试，pytest 606 过。

### 课程质量改进：个性化/两层大纲/任务退后台/代码缩进/引用卫生/学习者起点（2026-11-28）
- 按用户反馈四项改进：①任务退后台（前端去"第几步/还剩几节"完成式框架，正文禁任务措辞改自然教学语言）②从学习者已知经验切入个性化讲解③复杂课题两层大纲（阶段→章节，structureMode flat/staged，章数由认知增量决定）④去AI腔（面对面口语，禁主持腔/排比）。
- I13 管道修复：example 块代码缩进被 strip 剥光致 IndentationError，改保留原始行（多门课代码恢复可编译）。
- I15 引用卫生：确定性剥离正文内部证据编号 ev-ID（基线 6 门课泄漏清零），保留真实来源名/URL，不碰归因元数据。
- I16 学习者起点文本优先：背景描述决定起点与讲解视角，水平评级仅针对本主题置末（避免"对算法初级"被误读成"对一切初级"而铺垫通用基础）；大纲聚焦学习目标点名对象，未点名通用理论不单独成章。
- I17 scaffolding 去刻意：阶段 goal 改自然概览（不套"为什么→解决什么→产出"公式）、承接/铺垫只在自然有必要时点明；正文禁"抓住一个主线/用同一个抱怨走一遍/先接上…接住了"等 AI 味句式。
- 577 Python 测试 + 333 TS 测试 + tsc 零错误。

### I6 可靠性修复：checkpoint 校验纳入重试循环（2026-11-26）
- _call_for_json 加 validator 参数，schema 校验（_validate_definition）移入重试循环：偶发畸形输出（截断/字段不合 schema）触发重试而非直接丢题存 null（基线 oauth-pkce-a 空题根因）。新增 3 回归测试，pytest 548 过。

### 2026-11-25 评测报告标识回退（L2）
- report 读取 run_meta.json 回退到 run 根目录（spec 目录上一级）；spec 标识兼容 id 键（spec_id 优先）。基线报告不再显示"未知"。538 测试过。

### 2026-11-25 溯源归因任务级语义（L1）
- grounding 按 (chapterId,taskId) 索引证据 pack：无证据任务的声明记 no_retrieval 而非 no_evidence，任务级 pack 优先章级；溯源率分母只含可归因声明。修复 pilot 中 ch-2/3 无证据却计 no_evidence 的语义混淆。536 测试过。

### I1 可靠性修复：strict 输出数字后杂散引号（2026-11-25）
- parse_enforced_json 新增确定性修复 _strip_stray_quote_after_number（字符串外扫描，合法 JSON 恒等）：pilot 两次整门中止根因 "order":2"，重试不收敛；先修复再判括号平衡。6 新测试含真实失败 raw 回归，532 测试过。
