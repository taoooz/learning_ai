# 项目迭代日志

## 2026-09-01

### V2 P2 流内答疑：最终审查修复波（重试计数、排队文案、提交相位守卫）
- 修复 1（Important）：`resume.ts` 任务重试 `nextAttempt` 基线只认 `kind === 'task'` 的 pendingRequest——边界提问的 Tutor 请求会占用 pendingRequest，此前读它的 attempt 导致任务重试计数跳号（新增真实时序用例：任务失败→边界提问→刷新，锁定 attempt 2 不跳号）
- 修复 2：`LearningStreamV2` 排队提示区分两种场景（新增可测 `tutorQueuedHint`）：主任务生成中保持「本节内容会先生成完，随后回答你的问题」；边界超窗排队（无内容在生成）改为「问题较多时会按顺序回答，也可继续学习」
- 修复 3：`tutor-orchestration` 的 `decideTutorSubmission` 增加相位白名单自防御（仅 `boundary`/`streaming`/`generating` 受理），不再只靠 UI 门控；`planning`/`completing`/`completed`/`plan_failed` 一律拒收
- 修复 4（文档）：spec §3.2 与交付契约对齐——任务上下文为标题+任务目标（不含 `observableOutcome`，类型有该字段但改代码不在本波范围）、近期问答范围限当前任务最近 3 组（非本章），保留最小上下文设计理由
- 验证：TS 231/231 绿（新增 3 项，均先失败后通过）、pytest 67/67 绿、`tsc --noEmit` 干净、lint 0 errors（21 warnings 与基线持平，均在未触碰文件）；报告见 `.superpowers/sdd/2026-08-31-p2-inline-tutor/task-final-fix-report.md`

### V2 P2 第一阶段：流内答疑（交付总结）
- 完成定义达成：任务流式生成中提问只入队（问题立即入流并落盘，任务完成后按队列顺序自动回答），边界提问立即启动回答；Tutor 完成后章节仍停在边界，不自动推进主线
- 持久化：UserQuestion/TutorAnswer 立即进入学习流并经 commit 统一入口落盘（不走节流），刷新后问题轨迹、在途回答与失败态均不丢；被中断请求刷新自动重试一次（重试再失败进入可见失败态且不再自动重试）
- Tutor SSE 双流隔离：Tutor 持独立代际计数 + 独立 AbortController + 忙闲标志，与主任务流互不取消；章节卸载/切换两者一并作废；问题串行回答、自动窗口 3 题，超窗口排队；旧章节残留流与协议版本不匹配事件一律丢弃不写入
- 红线守住：prompt 明确中文作答当前问题、不输出思维过程、不产出掌握度/证据结论（事件载荷禁含 evidence 字段，真实冒烟实测 0 处）；课程计划、任务内容与证据均不被 Tutor 修改
- 契约补齐（Task 4 裁决）：请求契约携带 courseId（普通字段，不进入幂等键格式），事件外壳 courseId 回填请求真实值，客户端事件写入前先比对 courseId
- 静态与测试（2026-09-01 全量）：lint 0 errors（21 warnings 与基线持平）、`tsc --noEmit` 干净、TS 全量 228/228 绿（其中流内答疑测试 78 项）、pytest 67/67 绿
- HTTP 错误路径冒烟：缺 `question` 字段 → 422 `INVALID_REQUEST`（「请求参数校验失败：question: Field required」，流未开始即拒）；畸形幂等键 → 422 `INVALID_REQUEST`（「幂等键格式无效」）；Next 侧无 cookie 401 与缺字段/畸形 JSON 422 由 `learning-v2-tutor-protocol.test.ts` 自动化覆盖
- 真实 LLM 冒烟：SSE 序列 `tutor_started → tutor_block_started → tutor_block_delta×109 → tutor_block_completed → tutor_completed → request_completed` 完整有序（sequence 1–114 连续）；中文任意 chunk 切分无乱码，delta 拼接与 `block_completed` 正文完全一致；载荷无 evidence；`generationMeta` 仅含 promptVersion/modelVersion/durationMs/degraded，无内部细节；全程约 1.1s
- 勘误：Task 6 条目「新增 26 项」实为 19 项，已就地修正

### V2 P2 流内答疑：恢复、错误路径与回归测试（Task 8）
- 新增 `tests/learning-v2-tutor-integration.test.ts`（8 用例）：基于 Task 6 编排基座锁定恢复与错误路径红线——旧章节残留流（started+delta 携带旧 chapterId）不写入新章节、失败问题局部重试不改变任务内容与 `completedTaskIds`、章节卸载后迟到响应整体丢弃（代际作废）、Tutor 流读取异常不动已完成任务、主任务失败不取消在途 Tutor、超窗口问题保留且串行不并发、HTTP 401/503 落稳定中文错误、Tutor 终态不推进主线
- `tutor-harness` 测试基座增量扩展（向后兼容）：新增 `tutorEventChapterId`/`failedQuestionId` 夹具选项、`currentAnswerText` 读取、`holdNextTutorFetch`（请求挂起闸）、`failActiveStream`、`emitTaskError` 与 `createTutorHarness` 别名
- `tutor-resume` 补例：自动重试再次失败进入可见失败态（错误文案 + 问题标记失败），第二次刷新不再自动重试
- Python 补例：`test_invalid_question_context_is_rejected` 以 TestClient 实测缺 `question`/`idempotencyKey` → 端点层 422（`INVALID_REQUEST`，流未开始即拒）
- 结论：简报 7 项行为确认均为既有实现，本任务以测试锁定；`resume.ts`/`useChapterLearning.ts` 经核无需改动。两条关键用例经变异测试验证（移除章节守卫/代际守卫即变红）
- 验证：TS 228/228 绿（新增集成 8 + 恢复 1）、Python 67/67 绿、`tsc --noEmit` 干净、lint 0 errors；V1 ChatWidget 未改动、相关测试全过

### V2 P2 流内答疑：章节 UI 与边界交互（Task 7）
- 新增 `components/learning-v2/InlineTutorInput.tsx`：受控 textarea + 提问按钮，提交前 trim、空问题不提交；提交即清空，可见反馈由学习流问题条目与忙闲/排队提示行（`role="status"`）承接；Enter 提交 / Shift+Enter 换行 / 中文输入法组词期不提交；输入区与按钮触摸区域 ≥44px；导出可测 `tutorPlaceholder(phase)`（边界「针对本节内容提问…」、生成中「本节生成完成后回答你的问题…」，测试锁定）
- `LearningStreamV2` 新增 `user_question`（右对齐气泡 + 待回答/排队提示/正在回答…）与 `tutor_answer`（复用既有 markdown 块渲染 + 流式光标；流式无内容时「正在准备回答…」；失败显示错误文案与「重试回答」局部重试，Tutor 忙碌时禁用）；排队判定：主任务生成中全部排队、边界超出自动窗口（3 题）排队
- 章节页接线：输入框置于学习流/边界卡之后，流中与边界均可见；`completing` 禁用（收尾后问题无人应答）；`completed`/`plan_failed` 隐藏；完成页保留问答轨迹与失败重试入口
- `TaskBoundaryV2` 行为不变，补注 P2 不变量：回答进行中不阻塞提问、回答完成后保持既有继续按钮不自动推进、Tutor 失败不进入主线失败分支
- 验证：TS 219/219 绿（新增 UI 文案锁定 1 项）、`tsc --noEmit` 干净、lint 0 errors（21 warnings 与基线持平）

### V2 P2 流内答疑：接入 useChapterLearning 双流编排（Task 6）
- 新增 `lib/learning-v2/tutor-orchestration.ts` 编排层：提交/自动派发/重试/恢复/失效决策全部抽为可测单元（纯函数 + `TutorStreamOrchestrator`），hook 只做薄接线；相位推导 `deriveChapterPhase` 抽出与测试同源
- 双流隔离：Tutor 持独立代际计数 + 独立 AbortController + 忙闲标志，与主任务流互不取消；章节卸载/切换两者一并作废，中断回答归一为 pending（同刷新恢复语义）
- 行为契约：流中提问只入队（问题立即入流 + 立即落盘，不走节流）；边界提问立即启动；任务完成（含预取重放路径）自动回答最早一题；终态后不推进主线、相位不变，队列有题且处于边界则串接下一题；失败只经显式 `retryTutor` 重试
- 守卫与兜底：事件先比对 courseId 再归约（其余守卫在归约器）；流读取异常/无终态结束沿用 STREAM_FAILED_LOCAL 模式本地合成 `request_error`，防 pending 永久停留 streaming
- 刷新恢复：初始化 `prepareTutorBoot` 归一（原引用时跳过冗余落盘）；被中断请求自动重试一次（attempt 守卫防循环），无 pendingRequest 的已提交问题走边界空闲兜底派发
- hook 新增同步镜像（与 reducer 归约路径一致，commit 统一入口）：消除 dispatch 批处理导致的过期读（快速连续提问丢更新、任务完成后队列读旧容器）
- 参与信号新增 3 类：`tutor_question_submitted`/`tutor_answer_completed`/`tutor_answer_failed`；hook 返回扩展 `submitTutorQuestion`/`retryTutor`/`tutorState`/`isTutorBusy`，既有字段不变
- 验证：TS 218/218 绿（新增编排决策与行为契约 19 项：协议集成 14 + 刷新恢复 5，含简报基线两用例）、`tsc --noEmit` 干净、lint 0 errors（21 warnings 与基线持平）

### V2 P2 流内答疑：Tutor 请求契约补齐 courseId（Task 4 审查裁决）
- 设计文档要求 Tutor 事件写入前守卫包含 courseId，裁决扩展请求契约携带该字段（普通请求字段，不进入幂等键格式）：`InlineTutorRequestPayload`/`buildInlineTutorContext` 增加 `courseId`，Python `InlineTutorRequest` 同步增字段（`extra='forbid'` 风格不变），事件外壳 `courseId` 由空串改为回填请求真实值
- 幂等键格式、prompt、main.py 路由、V1 均未改动；客户端守卫接入留待后续 hook 任务
- 验证：TS 36/36 绿（载荷形状锁定 9 字段 + courseId 透传）、pytest 21/21 绿（含缺 courseId 422）、`tsc --noEmit` 干净

## 2026-08-31

### V2 P1b：单任务预取 + 局部重试 + 章节 Recap 与归档压缩
- 完成定义达成（§11）：①下一任务在边界停顿期后台预取，点「继续」命中即零等待；②当前任务失败只局部重试当前任务（连续失败计数上送，≥3 次边界卡软提示「可再试一次或稍后再来」，不锁按钮）；③章节完成自动小结 + 已完成章节归档压缩腾 localStorage 配额
- 预取：末任务流式完成后即对下一任务发起预取请求（独立代际，不与在途请求互斥）；点继续时预取在途则直接接管同一 SSE，预取命中复用结果不重发；计划版本不匹配即弃
- 局部重试：失败重试复用同一幂等键，服务端按键去重；重试只影响当前任务，后续任务与计划不动
- 章节 Recap：python-agent 新增 `/api/learning/v2/chapters/recap`（非流式）+ Next 薄透传；**证据红线**——demonstratedObjectives/fragileObjectives/unresolvedQuestions 服务端确定性置空数组，LLM 不得产出，UI 恒不渲染；上游失败走本地兜底小结（`degraded: true`，标注「小结为自动提炼，仅供参考」）
- 归档压缩（§6.1.1）：写入失败 → 按蓝图 index 升序找「已完成且未归档」章节压缩（正文换单条摘要块，recap/transition/notice 保留）→ 重试，候选耗尽才提示用户；当前章节自身不参与候选
- 渲染：`ChapterRecapView` 共享组件（完成卡主展示位，流内完成态不再重复渲染）；完成卡上送 recap；边界卡 completing 相位禁用按钮「正在生成章节小结…」
- 验证：TS 150/150 绿（新增配额兜底 9 项）、pytest 45/45 绿、typecheck 干净；真实 LLM 冒烟：recap 端到端通过（三证据字段确认空数组、中文无损、1.2s 出结果）
- ESLint 9 迁移：新增 `eslint.config.mjs` 使用 `eslint-config-next/core-web-vitals` Flat Config；忽略 `.next`、`.worktrees`、`node_modules`；`npm run lint` 改为 `eslint .`；移除旧 `.eslintrc.json`；当前 0 errors、21 warnings（既有代码规则告警）

### V2 P1a 核心循环：新课直接走 V2，空章节可连续学完并刷新不丢
- 完成定义达成：新建课程可从空章节连续完成全部任务（计划→逐任务流式→边界停顿→完成解锁下一章），流式中途/边界刷新均不丢内容；按用户指示不做灰度，新课直接 V2，旧课程（含 2 门系统课）按数据里的 protocol 继续走 V1
- TOC 双写：`lib/learning-v2/blueprint-map.ts` 把 V1 TOC 结果映射为 CourseBlueprintV2（模板句过校验器、意图关键词推断），映射失败降级纯 V1 不半写；映射成功跳过 V1 node 0 预热省一次 LLM 调用
- python-agent 两端点：`/api/learning/v2/chapters/plan`（非流式，校验失败带修复提示重试一次）与 `/api/learning/v2/tasks/stream`（异步流式，事件序列 task_started→block_started→delta→block_completed→task_completed→request_completed，`ensure_ascii=False` 中文无损）
- Next.js 薄透传层两路由（字节级转发 + SSE 头）；课程页按 protocol 分发 V2 章节树（读时自愈刷新 treeView）；章节学习页含流式渲染（4 种内容块）、边界卡（takeaway/nextHint/进度）、完成卡与下一章入口
- 恢复九分支：`decideResumeAction` 纯函数决策（流式残留/失败一律新 attempt 重生成，确定性 itemId 覆盖半截块），边界恢复滚到锚点任务；竞态防护 = 代际计数 + AbortController + 幂等注册表 + 节流落盘（终态立即写）
- 参与信号 `lib/learning-v2/engagement.ts`：五类事件独立 key 环形 500 条，写失败静默；按文档 §12 删除 spike 验证代码
- 文档裁定：归档压缩（§6.1.1）属 P1b 完成定义，本次不实现
- 验证：TS 测试 122/122 绿（新增恢复九分支 13 项 + SSE 中文任意切分 7 项），python pytest 37/37 绿，typecheck 干净；真实 LLM 冒烟：计划生成 + 任务 SSE 流端到端通过，中文无乱码、takeaway/nextHint 提取正常

### V2 P0 落地：协议、兼容与观测基础（不改默认体验）
- 按 `v2_项目综述.md` P0 范围建立 V2 稳定数据边界：新增 `protocolVersion: 2`，只定义 P1 消费的类型（Chapter Plan、Learning Stream Item 三种、Chapter Runtime、SSE 事件外壳），Evidence/Checkpoint 推迟 P3 定稿
- `types/learning-v2/`：蓝图/计划/学习流/运行时四层对象 + `GenerationMeta`（版本 promptVersion/modelVersion、耗时 durationMs、降级 degraded；生成阶段由承载容器类型隐含，符合"只定义 P1 消费类型"原则）
- `lib/learning-v2/`：章节 8 态 + 任务状态机（含 `partial_paused` 流中提问、`failed→generating` 重试）；SSE reducer（确定性 itemId 幂等 upsert、planVersion/chapterId 守卫拒绝旧版本结果写入、sequence 不回退）；蓝图/计划校验器（前置循环、目标覆盖、空泛描述）；幂等键构建器与注册表（同键不重复创建）
- 兼容与分发：无 protocolVersion 的旧课程一律按 V1，V1/V2 走判别联合分发不混入无版本对象；章节级独立 localStorage key、协议版本不符/损坏返回 null；Feature Flag 默认关闭（SSR 恒 false，默认页面零变化）
- 验证：新增 40 项协议测试 + 既有 53 项无回归，共 93/93 绿；`tsc --noEmit` 全绿；V2 空壳可创建/序列化/恢复

### V2 方案 Review 修订与瀑布流 Spike 验证
- Review 三份 V2 文档并修订 5 个主要问题：P1 拆为 P1a（核心循环，无预取）/P1b（预取、重试、Recap）两个可独立发布切片；P0 类型收窄为"只定义 P1 消费的类型"，Evidence/Checkpoint 推迟 P3 定稿；补上流式生成中提问的行为定义（§2.6.1，任务状态新增 `partial_paused`）；localStorage 治理从 P5 提前到 P1（每章独立 key + 完成归档压缩）；Checkpoint 结构化题先上线，开放式评估须过回归样本后启用
- 次要修订：删除无落地设计的 `decision_support` 意图；北极星指标标注 P3 前用 TTFC + 继续率代理；P2 明确聊天底层与 V1 ChatWidget 共享不复制
- Spike 实测（`/spike/waterfall`，一次性验证代码）：单任务流式首字约 0.3s、总时长 3.5～4.2s，任务衔接自然不重复，验证 P1a 不做预取 + 300～500 字任务粒度成立，结论已回填方案 §6.1；53 项既有测试无回归

### V2 理想架构重建与旧文档归档
- 以“稳定课程路线 + 章节内连续学习流 + 流内答疑 + 证据型理解检查 + 有边界的动态调度”为目标，从理想产品方案重新建立三份 V2 Source of Truth：项目综述、课程与学习系统、用户画像与学习证据
- 明确 P0～P5 分阶段路线：协议兼容 → 瀑布流 MVP → 流内答疑 → 证据型检查与补救 → 动态教学调度 → 服务端持久化与质量规模化；每阶段包含范围、非目标、工程结构、测试和完成定义
- 明确 V1/V2 协议并行、Learning Stream 不静默改写、异步结果校验 planVersion、写操作幂等、参与信号与能力证据分离等工程边界
- 将历史架构文档和 Hyperlearn 调研归档至 `docs/archive/architecture/`，避免历史方案与竞品推断被后续开发误认为当前需求

### Session 持久化（outline 会话重启不丢）
- 症状：outline 会话只存在 Python Agent 内存（`SessionStore` 的 dict），服务重启即全部丢失，用户中途生成课程再刷新/重启就答不上题
- 修复：`memory/session.py` 增加文件持久化——内存 dict 仍是主存储，磁盘 `data/sessions/*.json` 仅用于跨重启恢复；启动加载全部会话，create/update/delete 同步落盘；原子写入（`.tmp` + `os.replace`）防半截文件；单文件损坏只跳过告警不阻断其余加载；`data/` 加入 .gitignore
- 验证：`tests/test_session.py` 7 用例（含重启恢复、损坏容错）12/12 绿；跨进程恢复含中文会话正常（`ensure_ascii=False`）；真实 LLM 生成后会话落盘并扛过服务器重启

### 会话自动过期清理（防 data/sessions 只增不减）
- 症状：持久化后会话文件只增不减；`cleanup_old` 从未被调用，磁盘/内存缓慢膨胀
- 修复：`main.py` lifespan 启动时先清一次历史遗留过期会话，并起后台任务按 `SESSION_CLEANUP_INTERVAL_SECONDS`（默认 1h）周期清理超过 `SESSION_MAX_AGE_SECONDS`（默认 24h）的会话；两者均可环境变量覆盖；清理异常不阻断服务
- 验证：新增 2 用例（活跃会话不被误删、新旧混存只删过期）共 9/9 绿；真实重启时放置的过期会话文件被启动清理删除

### 收敛嵌套 git 仓库（python-agent 归入主仓库）
- 症状：`python-agent/` 是嵌套独立仓库（远程 `learning_ai_python_agent`，Railway 遗留），与主仓库重叠、工作区堆满未提交改动，存在提交错仓库/部署陈旧代码风险
- 修复：确认外层主仓库已跟踪全部文件（含 `railway.toml`）且为更新版本、无 submodule 后，移除内层 `.git`（备份至 `~/Documents/python-agent-inner-git-backup`）；此后 `python-agent` 内 git 统一解析到主仓库
- ⚠️ 后续：用户拟将 git 迁至公司 GitLab，届时一并配置远程与身份

## 2026-08-27

### chat 历史去重（省 token）
- 症状：chat 每次请求双份嵌入历史——system prompt 嵌入最近 6 条活跃消息，messages 数组又带全量 ≤10 条（每次最多重复约 2000 字符）；且前端不过滤过期消息，过期原文与摘要一并重复发送
- 修复：`useChatSubmit.ts` 发送前过滤 `isExpired` 消息（过期消息已凝结为 conversationSummary 单独传递），记忆精炼路径同步排除过期消息；`chat_agent.py` 的 `build_chat_system_prompt` 去掉 `chat_history` 参数与近期历史段，只保留过期对话摘要段（改名「更早的对话摘要」）；`main.py` 调用同步精简

### questions 补齐输出字段（concept/dimension/difficulty/cardId）
- 根因：`prompts/questions.py` 的 JSON 输出示例不含这些字段，模型照示例输出导致字段省略，前端答题掌握度追踪（`recordQuestionAttempt`）静默失效
- 修复：输出格式段增加字段说明 + JSON 示例补齐四字段；`questions_service.py` 的 cards_section 暴露卡片真实 id（无 id 时回退 card-N），防止 cardId 幻觉；Agent/非 Agent 版复用同一 prompt 构建，两条路径均覆盖
- 验证：tsc 全绿、py_compile 通过、pytest 5/5、prompt 渲染冒烟（花括号转义、卡片 id 暴露、chat 新签名）通过，Python Agent 已重启

## 2026-08-26（压缩归档）

### LLM 切换（MiniMax → muses/deepseek-v4-flash）
- 环境变量统一 `LLM_API_KEY`/`LLM_API_BASE`/`LLM_MODEL`；TS（`lib/minimax.ts`）与 Python（`lib/minimax.py`/`minimax_agent.py`）客户端切换新服务，流式 thinking 走 `delta.reasoning_content`
- 修复隐患：`memory_refine_service.py` 引用未导入的 `MiniMaxClient()` 致 NameError 被 except 静默吞掉，记忆精炼长期静默失败

### A. 统一鉴权
- 新增 `lib/auth.ts`（本地/Redis 双模式）；set-cookie 改 httpOnly；8 个原无鉴权 API 路由全补 `requireAuth`；`/api/user` 改从 cookie 读身份

### B. 存储可靠性 + 失败显式化
- 存储写失败显式化（`saveStoredDataV2` 唯一咽喉 + `StorageWarningToast`）；引入 `isHydrated` 消除无限 loading
- TOC 失败可见+可重试（三级兜底）；`minimax.py` 新增 JSON 括号平衡检查，截断输出显式抛错
- `useChatSubmit` SSE 解析改行缓冲 + `decode({stream:true})` 防中文乱码；空目录转错误态；练习题生成失败非阻断横幅 + 手动重试

### C. 个性化数据透传
- 客户端补齐 `userProfile` + `planningPayload` 透传；节点内容/卡片/题目统一改 `buildNodeInfoPayload` 发全量节点信息 + 画像（原仅发 4 字段）

### 收尾：密钥泄露清理
- `python-agent/.env` 移出 git 跟踪，`.env.example` 真实密钥换占位符；⚠️ 密钥已存在 git 历史建议轮换

### E. 死代码清理
- 删除 prisma 全链路、`lib/chat-context.ts`、`api-schemas.ts`、`observability.ts`、`lib/prompt/` 目录、悬空 `smoke:generation`；保留 `scripts/` 本地脚本；修复长期红测试；53/53 全绿

### F. 新模型 JSON 输出适配（全链路冒烟通过）
- 建 Python 3.12 `python-agent/.venv`；outline/TOC/cards/questions/chat/memory 全链路冒烟通过（直连 + 经代理两种方式）
- 修复三类 JSON 问题：模板花括号转义不匹配、字符串内未转义双引号（新增 `_repair_unescaped_quotes` 兜底）、裸控制字符（`strict=False`）
- 修复原生二进制隔离问题（lightningcss 等，`xattr -d com.apple.quarantine`）

### G. 修复 outline 澄清问题无限循环
- 根因：`outline_agent.py` 保存 `llm_messages` 时从未写入本轮 AI 回复 → 模型看不到自己问过什么 → 反复提问
- 修复：双向均 append assistant 回复 + 提取公共 `_stream_agent_sse`；双保险 `MAX_QUESTIONS=3` 硬上限强制收敛

### H. 修复 estimatedLevel 中英文值不匹配 + _agent 审计
- 根因：prompt 约定中文水平词但下游按英文键查表 → 查空回退，难度显示与个性化注入失效
- 修复：`outline_service.py` 新增 `normalize_level` 在 `parse_content_blocks` 单点归一化；前端 `LEVEL_LABELS` 查表并留中文别名兼容旧数据
- 审计结论：chat/toc/cards/questions agent 无历史丢失回归、失败路径均已显式化；发现 chat 历史双份嵌入 → 见 2026-08-27

## 2026-05-31 ~ 2026-06-07（压缩）

- 新增 `docs/architecture/课程生成与用户画像策略-v2.md`：课程生成从"章节卡片内容"升级为"章节目标簇 + 动态任务计划 + 每步理解检查"，链路为需求解构→课程蓝图→目标簇章节→章节任务计划→任务即时生成→Check-in→画像更新；画像五层模型；P0-P5 渐进迁移路径
- 收窄第一阶段范围：单节点内容改为"多个流式学习任务 + 用户主动继续"（逐任务流式、任务间只有"继续"按钮）；补充需求解构/认知负荷/任务动词化/梯度排序等设计约束；暂不做练习题与答题正确率
- `NodeTaskPlan` 只含任务骨架（taskId/taskTitle/taskDescription），任务内容独立流式生成；确立目录生成后预热首节点、节点首任务完成后预热下一节点

## 2026-04-20（压缩）

- 学习页 complete 阶段新增"学习小结"：关键收获/练习正确率/薄弱知识点/下节预告四卡片，纯前端计算不调 AI
- Prompt 全部外置到 `python-agent/prompts/`（outline/toc/cards/questions/chat/memory_refine 6 模块 + PromptManager：按需加载、模板变量、缓存、`reload_prompts()` 热更新），6 个 service 去硬编码 f-string
- 新增 Memory LLM 精炼系统：`MemoryStoreV3.learningSummary` + Python Agent `memory/refine` 端点 + `/api/memory/refine` 代理；聊天完成后自动触发（fire-and-forget、5 分钟去重），精炼结果注入 Chat/Planning prompt
- Outline/Chat 上下文瘦身：前端改发 `getPlanningMemoryPayload()`/`getChatMemoryPayload()` 精简 payload，不再发全量 MemoryStoreV3；字段 `user_memory` → `planning_memory`；chat prompt 构建迁到 Python Agent `chat_agent.py`

## 2026-04-17（压缩）

- 系统课程数据整合：删除约 400 行手写简化内容，改为从 `data/system-courses/generated/*.json` 静态导入；`lib/data/system-courses.ts` 重构为从 JSON 加载 lessons 并动态构建 `CourseBlueprint`

## 2026-04-13（压缩）

- 批量修复：Blueprint 卡片渲染后消失、同标签页重新生成 422（sessionId 竞态）、节点内容 404 与 cards 重复请求、Rules of Hooks；TOC 恢复流式展示、outline thinking 无限循环（同 chunk 连续 3 次即终止）、TOC 完成改底部悬浮提示条
- 架构八阶段：`lib/python-agent.ts` 统一代理、`lib/api-response.ts` API 规范化（4 路由迁移）、邀请码迁环境变量、Redis 单例；ConfirmModal/CourseCard/ChatWidget(480→233 行)/CourseContext(11 action) 拆分；`types/course.ts`（561 行）拆 6 领域文件；`app/page.tsx` 406→218 行

## 2026-04-09（压缩）

- Agent 搜索能力推广：新增 `toc_agent`/`cards_agent`/`questions_agent` 及 3 个 `_agent` 路由，原非 Agent 版保留为 fallback；前端 toc/cards/questions 路由全部转发 Python Agent
- Chat 迁移到 `chat_agent.py`（AI 自主判断是否搜索，输出兼容 SSE 格式，前端零改动）；outline answer 也支持搜索；删除废弃 `/api/generate/outline` 路由
- 清理：删除废弃 `agents/`（LangGraph）、`mcp/` 目录；`lib/minimax.ts` 353→181 行；`lib/prompt.ts` 删 4 个已迁移函数及 2 个空壳路由
- 新增 `lib/agent-config.ts` 统一 `PYTHON_AGENT_URL`；set-cookie 改 httpOnly

## 2026-03（压缩）

- 课程目录与生成：动态排布 + 四态节点路径式结构（布局抽成可测纯函数）；轻量蓝图、超时兜底（失败可重试不静默降级）、画像驱动难度（1-3 澄清题）+ 搜索增强；首页两门系统课
- Course Blueprint / Memory V3 首轮落地：`CourseBlueprint/NodeLesson/StoredCourseBundle/MemoryStoreV3`；存储切 `ai-learning-data-v2`；memory 改 event-sourced + 双层 Retrieval
- 学习体验与设计：单节学习改单步闯关流、内容可视化（Mermaid/对比表/时间线）、CapWords 风格统一、课程生成 ~67s→34-41s；记忆降噪（信号判断/衰减/相关性分层、注入课程结构防重复讲解）

---

## 历史版本（压缩归档）

### v0.x 功能清单
- 核心学习流程：首页 → 课程详情 → 节点学习 → Quiz
- MiniMax API 集成（模型：MiniMax-M2.7）
- localStorage 持久化存储
- 课程树生成（4-8 节点）和节点内容（1-5 卡片）
- 单选/多选/填空题支持

### 细节优化
- **骨架屏**：学习页加载时显示卡片骨架动画，而非静态 spinner
- **Toast 提示**：资料页保存时显示动画提示
- **学习流程重构**：内容全屏展示，学测交替，打破两阶段割裂
- 错误处理改进：静默处理后台洞察生成失败，不干扰主流程
