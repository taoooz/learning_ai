# 课程质量 Rubric v1.0（阶段0·定义交付物）

> 适用范围：AI 课程生成链路（course_architect_service → chapter_plan_service → task_content_service）产出的**任务级内容**（`task_completed.payload.task.blocks` + `sourceRefs`）与**课程级聚合**。
> 本文件是纯定义文档：不修改任何现有代码。与 `python-agent/scripts/evaluate_content_quality.py`（结构判分 + 1–5 分 LLM rubric）和 `python-agent/scripts/validate_rubric_regression.py`（评分一致性 ≥80% 红线）的关系是**概念复用、平行演进**：旧脚本继续作为回归闸门，本 rubric 是深度版质量度量的正式定义，供后续 judge 装置实现。
> 评分对象永远绑定一条 golden set spec（见 `golden_set.json`）与一个学习者画像（见 `personas.json`）：**"好课程"是相对于学习者与学习目标的好，不是抽象的好。**

---

## 0. 总则

1. **五维度，每维 0–3 分**，锚定描述给出可判定判据。judge 必须为每个分数引用内容中的具体证据（块 id / 原文片段），无证据的分数视为无效评分。
2. **测量方式三分**：`程序可判`（确定性规则，可在不调用 LLM 的情况下计算）、`需 judge`（异构 LLM 评审团按本 rubric 打分）、`需人工`（人工盲评校准与争议仲裁）。一个维度通常是"程序可判子项 + judge 主判 + 人工抽检"的组合。
3. **分数是序数锚定、区间合成**：0–3 锚定保证跨 judge 可比；总分用加权和（见 §6），权重理由逐条给出。
4. **安全优先**：事实准确维度具有否决权（§6 门槛），其余维度不允许"用事实错误换深度/生动"。
5. 所有维度都**以 spec 的 learningGoal、likelyMisconceptions、expectedPrerequisites 和 persona 为判分上下文**。judge 提示词中必须完整注入这些字段。

---

## D1 事实准确（Factual Accuracy）　权重 0.30

**定义**：内容中的事实性陈述（API 签名、参数默认值、协议行为、数学结论、版本特性、因果机制）与权威来源一致；不确定处显式标注；引用可溯源。快变领域（LLM API、框架版本）以 spec 的 `authoritativeSources` 为唯一事实基准，**不以 judge 的参数化记忆为准**。

| 分档 | 可判定判据 | 正例 | 反例 |
|---|---|---|---|
| **3** | 全部事实性陈述可在权威来源中核实；关键事实块带有效 `evidenceRefs` 且指向 `sourceRefs` 中真实 URL；版本敏感陈述标注适用版本；无幻觉引用 | 讲 HTTP 缓存时 `Cache-Control: no-store` 与 `no-cache` 的区别与 RFC 9111 一致，并引用对应章节 | — |
| **2** | 核心事实全部正确；存在 ≤2 处**非关键**瑕疵（措辞过度简化但不致误导、次要细节未标注版本），且无幻觉引用 | 讲递归时把"尾递归优化"说成"某些语言支持"而未指明 Python 不支持——简化但不误导主线 | 把 `no-cache` 解释成"不缓存"（这是关键事实错误，属 0–1 档） |
| **1** | 存在 1 处关键事实错误，或 ≥3 处非关键错误，或出现无法溯源的"据研究表明"式断言 | 声称 `fetch` 默认带 cookie（实际默认 `credentials: "same-origin"`，跨域不带） | — |
| **0** | 存在 ≥2 处关键事实错误，或幻觉 API/参数/文献，或引用 URL 与内容无关（装饰性引用） | 编造 `tailwind.config.js` 中不存在的 v4 配置项并给出代码 | — |

**关键 vs 非关键的判定**：错误若会导致学习者写出不能运行的代码、形成 spec `likelyMisconceptions` 中的误解、或在评估题中答错，即为**关键**；否则为非关键。此判定由 judge 做出并写明理由，人工抽检复核。

**测量方式**：
- 程序可判子项：`evidenceRefs` 覆盖率（含事实陈述的块中有效引用占比）、`sourceRefs` URL 可达性、引用域名是否在 spec `authoritativeSources` 白名单内。这些子项**不单独决定分数**，只作为 judge 的输入证据与 §6 安全指标（事实溯源率）的原料。
- 需 judge：逐条事实核对（judge 提示词注入权威来源摘录；快变领域必须先检索后判分）。
- 需人工：所有 D1≤1 的判例 100% 人工复核（否决权触发必须人工确认）；其余按预注册抽样。

**文献锚**：事实性核对本身无单一学习科学文献，方法学锚为 LLM-as-a-judge 的偏差控制（Zheng et al., 2023, arXiv:2306.05685：judge 存在自我增强与记忆偏差，故要求外部证据注入而非凭记忆判分）。

---

## D2 目标—内容—评估对齐（Constructive Alignment）　权重 0.25

**定义**：`learningGoal`（预期学习结果）、教学内容活动、评估/检查点三者指向**同一认知动词层级**。目标说"能排查"，内容就必须给排查活动，评估就必须考排查，而不是考名词解释。

| 分档 | 可判定判据 | 正例 | 反例 |
|---|---|---|---|
| **3** | ① learningGoal 被拆解为可观察行为并在内容中逐项覆盖；② 每个目标动词层级都有对应内容活动；③ 评估题（interactive/checkpoint/takeaway 自测）的认知层级与目标一致（Bloom 修订版动词匹配）；④ spec 的 likelyMisconceptions 至少 1 条被显式针对（对比/反例/诊断题） | 目标"能用 rebase 整理提交并恢复误操作"：内容含 step-walkthrough 演示 rebase，评估给"误删分支如何找回"情境题（应用层），并针对"rebase 会丢失提交"误解给 reflog 反例 | — |
| **2** | 目标与内容一致，但评估层级**低一档**（目标应用层、评估停在理解层），或误解仅被提及未被针对 | 目标"能写条件概率计算"，内容给了贝叶斯例题，但自测题只问"条件概率的定义是什么" | — |
| **1** | 内容覆盖目标 ≤50%，或评估与目标明显脱节（目标实操、评估纯概念复述），或无任何评估成分 | 目标"能配置 CORS 排错"，正文只讲同源策略历史，结尾 takeaway 一句"理解 CORS 很重要" | — |
| **0** | 内容主题漂移（讲的不是 spec 主题），或目标、内容、评估三者两两不一致 | spec 是"浮点精度"，正文大篇幅讲 Python 安装 | — |

**测量方式**：
- 程序可判子项：是否存在 interactive 块或可评估结构；`observableOutcome`/`taskGoal` 字段是否非空（来自 `python-agent/schemas/learning_v2.py:18-25` 的 TaskStreamTaskInfo）。
- 需 judge：动词层级匹配（judge 按 Bloom 修订版六层：记忆/理解/应用/分析/评价/创造 标注目标、活动、评估三者层级并比对）；误解针对性判定。
- 需人工：层级标注争议仲裁（相邻层级如"理解 vs 应用"允许 ±1 档容差进入校准统计）。

**文献锚**：Biggs (1996) *Enhancing teaching through constructive alignment*, Higher Education 32:347–364, DOI 10.1007/BF00138871；Biggs & Tang (2011) *Teaching for Quality Learning at University* (4th ed.), Open University Press/McGraw-Hill；Bloom et al. (1956) *Taxonomy of Educational Objectives, Handbook I: Cognitive Domain*, David McKay；Anderson & Krathwohl (eds.) (2001) *A Taxonomy for Learning, Teaching, and Assessing*, Longman（动词层级用修订版）。

---

## D3 认知负荷匹配（Cognitive Load Fit）　权重 0.15

**定义**：对**该 persona** 而言，内在负荷（材料本身复杂度）被分块/排序/脚手架管理到可承受水平，外在负荷（与学习无关的呈现开销）被最小化， germane负荷（促进图式建构的加工）被保留。**不是"越简单越好"**：对进阶画像删掉必要的复杂度反而是失配。

| 分档 | 可判定判据 | 正例 | 反例 |
|---|---|---|---|
| **3** | ① 新术语首次出现即定义或链接先修，单块新术语密度与 persona 匹配（入门 ≤3 个/块，中级 ≤5，进阶 ≤8——阈值为操作约定，pilot 校准）；② 复杂流程有分步呈现（step-walkthrough/diagram）而非整段倾倒；③ 无冗余通道冲突（图文重复逐字朗读式堆砌、无关装饰代码）；④ 样例先行于抽象规则（入门）或规则先行于样例（进阶，expertise reversal） | 入门讲递归：先给"文件夹套文件夹"具象样例 → 3 行代码 → 再命名"基线条件/递归条件" | 入门第一块同时抛出 call stack、stack frame、tail call、memoization 四个未定义术语 |
| **2** | 主线负荷管理良好，但存在 1–2 处局部超载（某块过长/术语突增）或 1 处冗余呈现，学习者需回读但不致放弃 | 主线清晰，但一个 comparison 块塞进 6 列 8 行 | — |
| **1** | 多处超载或脚手架缺失：≥3 个未定义术语直接使用、关键流程无分步、或大段与目标无关的"背景知识" | 讲 HTTP 缓存未解释"强缓存/协商缓存"就直接贴 8 个响应头组合表 | — |
| **0** | 呈现方式系统性阻碍学习：信息无序倾倒、图文互相矛盾、或难度与 persona 完全错配（给入门者整页 RFC 原文） | 给 beginner 画像直接粘贴 RFC 9111 全文并要求"自行理解" | — |

**测量方式**：
- 程序可判子项：单 markdown 块字数上限（操作约定：入门 600 字/中级 900/进阶 1200，pilot 校准）、mermaid 语法可解析性、comparison 行列数、术语首现检测（对照 spec `expectedPrerequisites` 与 persona `skipBasics` 词表做近似匹配）。
- 需 judge：冗余/通道冲突/样例-规则顺序/脚手架质量的主判。
- 需人工：负荷是主观体验，校准集中必须含人工"读起来是否吃力"评分作为效标。

**文献锚**：Sweller (1988) *Cognitive Load During Problem Solving: Effects on Learning*, Cognitive Science 12(2):257–285, DOI 10.1207/s15516709cog1202_4；Sweller, van Merriënboer & Paas (1998) *Cognitive Architecture and Instructional Design*, Educational Psychology Review 10:251–296, DOI 10.1023/A:1022193728205；同作者 (2019) *Cognitive Architecture and Instructional Design: 20 Years Later*, EPR 31:261–292, DOI 10.1007/s10648-019-09465-5（expertise reversal 与负荷三分法的更新依据）；Mayer & Moreno (2003) *Nine Ways to Reduce Cognitive Load in Multimedia Learning*, Educational Psychologist 38(1):43–52, DOI 10.1207/s15326985ep3801_6；Mayer (2021) *Multimedia Learning* (3rd ed.), Cambridge University Press（冗余/通道/分段原则）。

---

## D4 深度与可迁移性（Depth & Transferability）　权重 0.20

**定义**：内容不止于"是什么"，还给出**为什么（机制/因果）**与**何时用/何时不用（边界条件）**，并搭建向新情境迁移的桥（变式练习、远迁移提示、与已有图式的连接）。深度必须**与 persona 和难度档匹配**：入门档的"深"是把一个机制讲透，不是堆砌高级话题。

| 分档 | 可判定判据 | 正例 | 反例 |
|---|---|---|---|
| **3** | ① 核心概念有机制层解释（为什么这样设计/为什么会出错），不止操作步骤；② 给出 ≥1 个边界条件或失效场景（"什么时候不适用"）；③ 有 ≥1 个变式或跨情境迁移任务（近迁移：同结构换表面；远迁移：换领域用同一原理，Barnett & Ceci 分类）；④ 与 persona 已有知识建立显式连接 | 讲哈希表：解释冲突为何必然（鸽笼）→ 负载因子权衡 → 迁移题"为什么数据库索引不用哈希而用 B 树"（远迁移） | — |
| **2** | 有机制解释但缺边界条件，或有迁移提示但只是"想一想"式空转（无具体情境） | 讲了闭包捕获机制，结尾"试着在其他语言里找找闭包"而无具体任务 | — |
| **1** | 纯操作清单/定义复述，无机制层；takeaway 是口号（"多练习就能掌握"）；无任何迁移成分 | "记住：递归要有出口，否则会栈溢出"——只有规则没有为什么 | — |
| **0** | 内容浅表且用篇幅伪装深度：同义反复堆砌、无关历史八卦填充、或"高级名词轰炸"替代解释 | 用 5 个块反复说"浮点数不精确，要注意精度问题"而不解释二进制表示 | — |

**测量方式**：
- 程序可判子项：takeaway 非空且非模板句（与空泛短语黑名单近似匹配，仅作线索）；example 块是否含 `takeaway` 字段（`types/learning-v2/learning-stream.ts` 契约）。
- 需 judge：机制层/边界条件/迁移任务的存在性与质量主判；judge 须引用原文证据。
- 需人工：迁移任务的"可完成性"抽检（任务是否真的能被该 persona 执行）。

**文献锚**：Barnett & Ceci (2002) *When and where do we apply what we learn? A taxonomy for far transfer*, Psychological Bulletin 128(4):612–637, DOI 10.1037/0033-2909.128.4.612（迁移距离分类）；Dunlosky, Rawson, Marsh, Nathan & Willingham (2013) *Improving Students' Learning With Effective Learning Techniques*, Psychological Science in the Public Interest 14(1):4–58, DOI 10.1177/1529100612453266（practice testing / distributed practice 高效用——迁移练习与检索练习的设计依据；rereading/highlighting 低效用——"多读几遍"式建议不得作为迁移手段计分）；Anderson & Krathwohl (2001)（分析/评价/创造层动词作为深度标尺）。

---

## D5 先修连贯（Prerequisite Coherence）　权重 0.10

**定义**：内容使用的每个概念，要么在 spec `expectedPrerequisites` / persona `confirmedKnowledge` 之内，要么在**使用前**已被本任务或前序任务铺垫；不违反 persona `skipBasics`/`excludedTopics`（不重复讲已确认掌握的内容）；与前序任务的 `takeaway`/`conceptKeys` 衔接（复用 `PreviousTaskInfo` 防重复契约）。

| 分档 | 可判定判据 | 正例 | 反例 |
|---|---|---|---|
| **3** | ① 无未铺垫的先修跳跃（每个超出先修集合的概念在使用前有定义/链接/一句铺垫）；② 无 skipBasics 违规（不重讲已掌握内容，最多一句激活提示）；③ 显式衔接前序 takeaway（"上一任务我们得到 X，这里用它解决 Y"）；④ 概念引入顺序无循环依赖 | 讲 CORS 前用一句话激活"同源=协议+域名+端口"，不重新展开同源策略整章 | — |
| **2** | 先修基本连贯，但有 1 处"先用后定义"（同块内稍后补上）或 1 处轻微重复已掌握内容 | 先用 `Promise` 写示例，两段后才解释 Promise 是什么 | — |
| **1** | 存在 1 处关键先修断裂（未铺垫且影响主线理解），或系统性重讲 skipBasics 内容 | 给入门者讲特征值时直接使用"线性变换的秩"且全程未铺垫 | — |
| **0** | 多处关键断裂，或内容与 persona 定位完全脱节（给 advanced 从零讲变量赋值占满全篇） | 给 skipBasics 含"Python 基础语法"的进阶画像用 3 个块讲 for 循环语法 | — |

**测量方式**：
- 程序可判子项：`conceptKeys` 与前序任务交集检测（重复度线索）；skipBasics 关键词命中扫描（近似匹配，产出线索而非定论）。
- 需 judge：先修断裂/铺垫质量/衔接质量主判（judge 注入 persona 与 PreviousTaskInfo）。
- 需人工：断裂严重度仲裁。

**文献锚**：Sweller et al. (1998/2019)（图式缺失时内在负荷不可承受——先修断裂即人为制造要素交互性超载）；Biggs (1996)（对齐的纵向维度：课程序列内目标递进）；Dunlosky et al. (2013)（distributed practice 支持"激活旧知而非重讲"的衔接方式）。

---

## 5. 维度间冲突与权衡规则

按优先级从高到低裁决，judge 遇到冲突必须引用本节规则编号并写明裁决理由：

- **T1 事实 > 一切**：任何维度不得以事实错误为代价。"讲得更深但引入了错误机制解释"→ D1 扣分，D4 不得因该错误解释加分。
- **T2 对齐 > 深度**：超出 learningGoal 认知层级的"炫技深度"（给入门目标讲研究生内容）不算 D4 加分，反而按 D3 失配与 D2 漂移扣分。深度只在目标层级内纵向挖机制，不横向扩话题。
- **T3 负荷管理 ≠ 删减本质复杂度**：D3 与 D4 冲突时，正确解法是**分段/脚手架/样例化**（管理内在负荷），而不是删除机制解释。删除核心机制去"降负荷"→ D4 扣分、D3 不加分。反之，保留机制但无序倾倒 → D3 扣分、D4 按存在性给分但迁移子项从严。
- **T4 先修让位于对齐，但必须补脚手架**：目标要求的概念超出先修集合时，正确做法是补一句铺垫（D5 可保 3），而不是回避目标（D2 受损）或裸用概念（D5 受损）。
- **T5 冗余判定看通道而非字数**：长≠超载，短≠精炼。同一信息图文逐字重复是冗余（Mayer 冗余原则）；同一机制用样例+机制两种表征是**必要的双重编码**，不算冗余。
- **T6 persona 相对性**：同一内容对不同 persona 的 D3/D5 分数可以不同且都正确。禁止"对所有人统一难度"的判分。expertise reversal：对进阶画像过度脚手架（逐字喂饭）按 D3 失配扣分。
- **T7 平局与不可判**：证据不足以区分相邻分档时取低档（保守原则），并标注 `low_confidence`，进入人工抽检池。

## 6. 合成、门槛与报告

- **维度分** `s_i ∈ {0,1,2,3}`；**任务总分** `S = Σ w_i · s_i / 3 ∈ [0,1]`，权重：

  | 维度 | 权重 | 理由 |
  |---|---|---|
  | D1 事实准确 | **0.30** | 错误事实具有负外部性：学习者会把错误写进代码并扩散；且错误不可被其他优点补偿（T1）。最高权重 + 否决权双保险。 |
  | D2 对齐 | **0.25** | 对齐是"课程之所以为课程"的定义性属性（Biggs）：目标—活动—评估断裂时，内容再好也不是教学而是阅读材料。 |
  | D4 深度迁移 | **0.20** | 区分"能复述"与"能带走"，是产品相对搜索/百科的核心增值；但必须以事实与对齐为前提，故次于二者。 |
  | D3 认知负荷 | **0.15** | 负荷失配直接导致放弃（完成率），但多数失配可通过呈现修复、不毁伤内容本体，故权重中等。 |
  | D5 先修连贯 | **0.10** | 重要但作用域局部（单点断裂可补铺垫修复），且部分已被 D3 术语密度与 D2 目标匹配间接覆盖，避免重复计权。 |

- **事实否决门槛**：`s_D1 ≤ 1` ⇒ 该任务判 **FAIL**（总分照算但不得进入"改进版优于基线"的偏好胜局统计；课程级出现任一 FAIL 任务即课程级 FAIL）。否决必须经人工复核确认（§D1 测量）。
- **课程级聚合**：任务总分的均值 + 最差任务分（min）双报告；FAIL 任务数单列。禁止用均值掩盖单点事实灾难。
- **报告粒度**：每维度分 + 证据引用 + 冲突裁决记录 + 失败编码（见 `taxonomy.md`）。维度分不允许只报总分。
- 权重是**阶段0先验**，pilot 后允许按预注册流程修订一次（修订须记录理由并重新校准 judge），此后冻结。

## 7. 文献核实清单（全部经 Crossref / arXiv / 出版社与图书馆目录核实，2026-11-25）

| 引用 | 核实渠道 |
|---|---|
| Dunlosky et al. 2013, PSPI 14(1):4–58 | Crossref DOI 10.1177/1529100612453266 |
| Sweller 1988, Cognitive Science 12(2):257–285 | Crossref DOI 10.1207/s15516709cog1202_4 |
| Sweller, van Merriënboer & Paas 1998, EPR 10:251–296 | Crossref DOI 10.1023/A:1022193728205 |
| Sweller et al. 2019, EPR 31:261–292 | Crossref DOI 10.1007/s10648-019-09465-5 |
| Biggs 1996, Higher Education 32:347–364 | Crossref DOI 10.1007/BF00138871 |
| Biggs & Tang 2011, Teaching for Quality Learning at University (4th ed.) | Crossref 章节 DOI 10.1017/cbo9781139048224.009（2012 印次） |
| Mayer & Moreno 2003, Educational Psychologist 38(1):43–52 | Crossref DOI 10.1207/s15326985ep3801_6 |
| Mayer 2021, Multimedia Learning (3rd ed.) | cambridge.org 官方书页（ISBN 9781316638088） |
| Bloom et al. 1956, Handbook I: Cognitive Domain | ECU 图书馆目录 + archive.org 原书扫描 |
| Anderson & Krathwohl 2001, A Taxonomy for Learning, Teaching, and Assessing | LOC item 00063423 + Pearson 9780321084057 |
| Barnett & Ceci 2002, Psychological Bulletin 128(4):612–637 | Crossref DOI 10.1037/0033-2909.128.4.612 |
| Zheng et al. 2023, Judging LLM-as-a-Judge (NeurIPS 2023 D&B) | arXiv:2306.05685 + neurips.cc/virtual/2023/poster/73434 |
| Landis & Koch 1977, Biometrics 33(1):159–174 | Crossref DOI 10.2307/2529310 |
