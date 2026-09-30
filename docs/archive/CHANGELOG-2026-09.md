# 迭代日志归档（2026-09-19 及更早）

### V2 P5.5 A/B 实验框架（最小可用，计划最后项）
- `lib/learning-v2/experiments.ts`：FNV-1a 确定性账户分组（加权变体）、实验注册表（当前无在跑实验）、未注册 key 回退 null 防误扩散
- 曝光上报复用 engagement 链路（新增 experiment_exposed 事件类型）
- 测试：TS 276/276（+5：确定性/加权/未注册/分布均匀）、pytest 111/111、质量门 4/4

### V2 P5.5 数据保留：服务端 engagement 环形上限
- `UserDataStore.append_engagement` 从纯追加改为读取→合并→裁剪→原子写回，每课程保留最近 500 条（对齐客户端环形语义）；损坏行跳过
- A/B 实验框架明确推迟：依赖真实使用数据与运营假设，当前版本无在跑实验需求
- 测试：pytest 111/111（+1 保留上限）

### V2 P5.1 第三步：Hook 接入仓库抽象（多设备恢复闭环）
- `useChapterLearning` 持久化与启动装载全部改走 `getLessonRepository()`：persist 异步化（fire-and-forget + 409 冲突告警）、local 保持同步启动路径、server 走异步 BOOT_READY 装载（bootStateFor 纯函数复用，两条启动路径同构）
- 本地模式零行为变化（LocalLessonRepository 包装原函数）；`NEXT_PUBLIC_LESSON_STORE=server` 一键切换服务端存储
- 多设备恢复：设备 A 学习进度 → 设备 B 打开同章节经 ServerLessonRepository 读到同一学习容器
- 验证：TS 271/271、pytest 110/110、质量门 4/4

### V2 P5.1 第二步：服务端存储实装 + 端到端验证 8/8
- Python：`services/user_data_store.py`（按账户隔离的文件持久化 data/user_data/{accountId}/，原子写入、损坏跳过、路径清洗防注入、乐观锁 409）+ 5 个用户数据端点（courses GET/POST、lessons GET/PUT、engagement POST，鉴权由 Next 代理以 X-Account-Id 传递）
- Next.js：`/api/user/*` 三条代理路由（requireAuth + 身份透传 + 错误体透传）
- TS：`ServerLessonRepository`（实现 LessonRepository 接口，409 冲突标记 conflict 返回调用方决策）；`getLessonRepository` 按 NEXT_PUBLIC_LESSON_STORE 切换，默认 local 零行为变化
- E2E 8/8（经 Next.js 代理）：保存/读取课程、lesson roundtrip、乐观锁 409 冲突、新版本覆盖、engagement 追加、无鉴权 401
- 部署说明：本地开发即用；Vercel/生产需 python-agent 宿主配置持久卷（Railway volume 等）
- 验证：pytest 110/110（+10）、TS 271/271、质量门 4/4

### V2 P5.1 第一步：存储抽象层 + 迁移设计
- 设计文档：`docs/architecture/p5-服务端持久化迁移设计.md`（LessonRepository 接口 / API 契约 / 数据模型 / 乐观锁冲突策略 / 迁移路径 / 后端选型对比——实施待选型确认，设计后端无关）
- 代码：`lib/learning-v2/lesson-repository.ts`——LessonRepository 接口 + LocalLessonRepository（现有 localStorage 函数的 Promise 薄包装，SSR 安全）+ 环境切换单例；hook 业务层后续只依赖接口
- 测试：TS 271/271（+2 roundtrip/miss）、质量门 4/4

### V2 P5.4 补充：流式调用 usage 采集（网关降级）
- stream_chat 新增 include_usage 参数（stream_options.include_usage），task_content_service 流式链路接入 usage chunk 提取
- 实测：muses 网关不支持 stream_options.include_usage（usage chunk 不下发）——代码按设计安全降级为 None，流式 tokenUsage 暂缺、非流式（plan/recap）正常采集；网关升级后自动生效
- 测试桩同步：FakeClient 增加 include_usage 参数

### V2 P5 质量门（P5.3 质量系统）
- `scripts/quality-gate.sh`：统一质量门（tsc + TS 测试 + ESLint + pytest），`--with-llm` 附加 Rubric 一致性回归；任一失败整体失败
- 当前基线：4/4 通过（TS 269/269、pytest 100/100）

### V2 P5 起步：LLM 调用 token 用量观测（P5.4 可观测性）
- TS：GenerationMeta 新增 tokenUsage（promptTokens/completionTokens/totalTokens）
- Python：lib/minimax.extract_usage（OpenAI 兼容 usage 字段提取，缺字段安全降级 None）；接入 chapter_plan / chapter_recap 非流式生成（streaming 暂不采集）
- 测试：pytest 100/100（+3）、TS 269/269

### V2 P4 第二切片：调度集成与 UI（用户确认式调整）
- Hook：`requestPlanSuggestion`（边界时收集 evidence + 剩余任务 → 调度端点 → canApplyPatch 预校验 → 存为待决策建议；无证据/超上限/空操作不打扰用户）、`acceptPlanSuggestion`（校验 → applyPlanPatch → 清除）、`dismissPlanSuggestion`
- UI：PlanPatchPrompt 组件（用户可见的简短调整提示 + 按建议调整/按原计划双按钮）；页面边界时自动触发一次请求（组件级防抖）
- 真实 LLM 冒烟：强证据（demonstrated 0.95）→ 建议 skip 细节节（confidence 0.85，summary 口语化）；弱证据（partial 0.5）→ operations 空，不动主线
- 验证：TS 269/269（+2）、pytest 97/97、tsc/lint 干净

### V2 P4 第一切片：计划补丁协议层（ChapterPlanPatch）
- 类型：PlanPatchOperation（白名单：insert_task/skip_task/reorder_tasks/adjust_depth）+ ChapterPlanPatch（basePlanVersion/reasonCode/confidence/summary）+ 每章上限 2 次 + 高影响操作置信度阈值 0.8
- 纯函数：canApplyPatch（版本守卫拒绝旧补丁 / 上限 / 只动未展示任务 / 白名单校验）+ applyPlanPatch（planVersion+1 / 预取失效 / order 重排 / appliedPatchCount 递增）
- Python：plan_patch schema + prompt（证据驱动调度纪律：无强证据不建议 skip/insert）+ plan_patch_service + `/plan-patch/generate` 端点 + Next.js 代理
- 完成定义达成：所有调整可追溯（patchId + 版本）、可拒绝旧结果（basePlanVersion 守卫）、不改写已展示内容（TARGETS_SHOWN_TASK 拒绝）
- 验证：TS 267/267（+9 plan-patch 测试）、pytest 97/97、tsc/lint 干净

### V2 P3b：开放式题型（self_explanation / micro_practice）启用
- 回归验证达标：12 个固定样本（正例/反例/边界例/陷阱题），模型 Rubric 评分 vs 人工判定一致率 83%（10/12）≥ 80% 阈值（§2.7 红线）
- Python：OPEN_ENDED_EVAL_PROMPT（严格判定规则：事实性错误一票否决）、evaluate_open_ended 服务（confidence<0.5 降级不产出证据）、评估端点默认启用（env kill-switch）
- 稳定性：CJK 引号修复（模型在 feedback 中用 ASCII 引号包中文导致 JSON 解析失败）、open-ended 评估 max_tokens 1500→4000（思考预算，同 9/6 TOC 教训）
- TS/UI：CheckpointKind 扩展 + rubric 字段 + CheckpointCard 开放式 textarea 输入（≥10 字可提交）
- 验证：pytest 97/97、TS 258/258、tsc/lint 干净

### V2 P3a 端到端验证：Next.js 代理全链路 4/4
- E2E 通过 Next.js 代理走完整 checkpoint 流程：generate（真实 LLM）→ evaluate（错误→remediate_here）→ remediate（真实 LLM 补救讲解+等价新题）→ evaluate 新题（正确→demonstrated）
- 稳定性修复：glm-5.3-flash 偶尔输出空 content（思考模式，全部输出进 reasoning_content）→ 空 content 时重试；重试次数 2→3
- 验证：pytest 97/97

### V2 P3a 第四切片：Evidence 聚合到章节状态与 Recap
- 类型：`NodeLessonV2.evidence` 从 `unknown[]` 改为 `LearningEvidence[]`（P3 前占位 → P3a 定稿启用）
- 写入：checkpoint 评估结果同步写入 `lesson.evidence`（同一 checkpoint 重试后以最终结果覆盖）
- 聚合：新增 `aggregateEvidenceToObjectives` 纯函数（按 objectiveId 取最新证据，demonstrated → demonstratedObjectives，not_demonstrated/partial → fragileObjectives）
- Recap 集成：`applyChapterRecap` 自动聚合 evidence 填充 recap 证据字段（LLM 产出非空时不覆盖，证据红线保留）；skipped 不算证据
- 验证：TS 258/258（+6 evidence 聚合测试）、tsc 干净、lint 0 errors

### V2 P3a 补强：真实 LLM 冒烟 4/4 + 稳定性修复
- 真实 LLM 冒烟：checkpoint 生成（scenario_choice）→ 程序判分（正确/首错/二错三路径）→ 补救内容 + 等价新题 → 新题判分，4/4 通过
- 稳定性修复：模型 JSON 输出不稳定（无 JSON / options 输出纯字符串）——`_extract_json` 优先直接 loads、`_call_for_json` 自动重试 2 次、`_normalize_new_checkpoint` 字符串选项转对象并分配 id
- 验证：pytest 97/97

### V2 P3a 第三切片：补救内容插入（remediate_here 完整闭环）
- Python：REMEDIATION_PROMPT（换比喻/换角度重新解释 + 出等价不同题的 JSON 输出模板）、generate_remediation 服务、FastAPI `/checkpoints/remediate` 端点
- Next.js：`checkpoints/remediate` 代理路由
- 类型：RemediationPackage + CheckpointItem 新增 remediationContent / remediationAttempt 字段
- 纯函数：`applyRemediation`（补救内容写入 + 新题替换旧题 + 重置 pending）
- Hook：`requestRemediation`（调用补救端点 → applyRemediation；失败回退简单重试）
- UI：CheckpointCard 首次错误显示「获取补救内容并重试」→ 补救讲解渲染 + 新题重试；二次错误 → continue + not_demonstrated
- 验证：pytest 97/97（+3）、TS 252/252（+2）、tsc 干净、lint 0 errors

### V2 P3a 第二切片：状态机接入 + 学习流集成
- 新增 `lib/learning-v2/checkpoint-ops.ts` 纯函数层：needsCheckpoint（evidencePolicy=checkpoint 且尚无条目）、upsertCheckpointItem（幂等 + awaiting_user→checking）、applyCheckpointEvaluation（评估写入 + checking→awaiting_user）、collectEvidence（章节完成时提取证据）
- hook 集成：task_completed 后自动触发 checkpoint 生成（失败静默跳过不阻塞主线）；新增 CHECKPOINT_READY / CHECKPOINT_EVALUATED 两个 action（reducer + 同步镜像双路归约一致）
- UI 集成：LearningStreamV2 新增 checkpoint 条目渲染（CheckpointItemView→CheckpointCard）；hook 暴露 submitCheckpoint / retryCheckpoint
- 修复：eslint 忽略 docs/ 目录（超知 HTML 案例的打包 JS 被误报 213 errors）
- 验证：pytest 94/94、TS 250/250（+9 checkpoint-ops 测试）、tsc 干净、lint 0 errors

### V2 P3a 第一切片：结构化 Checkpoint（scenario_choice / sequence）
- 类型：新增 `types/learning-v2/checkpoint.ts`（CheckpointDefinition/Evaluation/Submission/Item/LearningEvidence）；`LearningStreamItem` 联合新增 CheckpointItem
- Python：`schemas/checkpoint.py`（Pydantic 严格校验）、`prompts/checkpoint.py`（JSON 输出模板）、`services/checkpoint_service.py`（LLM 生成 + 程序判分）+ FastAPI 两端点（generate/evaluate）
- 程序判分：scenario_choice 精确匹配、sequence 列表顺序匹配，确定性结果 confidence=1.0；首次错误 → remediate_here，二次错误 → continue + not_demonstrated（补救最多两轮不锁死）
- Next.js 代理：generate/evaluate 两路由（鉴权 + 必填校验 + 薄透传）
- 前端组件：`CheckpointCard.tsx`（单选 radio / 排序上下移动 + 提交 + 评估结果渲染 + 重试按钮）
- 验证：pytest 94/94（+16 checkpoint 测试）、TS 241/241（+6）、tsc 干净、lint 0 errors

### V2 P2 第二阶段补充：真实 LLM 冒烟 + proceed 高亮反馈
- 真实 LLM 冒烟 4/4：answer_inline/expand_current(NEEDS_EXAMPLE)/switch_explanation/proceed 全部正确分类，delta 无标记泄漏，正文无标记残留
- proceed UI 反馈：新增 `latestTutorActionIsProceed` 纯函数（当前任务最近完成回答为 proceed → true）；TaskBoundaryV2 新增 `highlightContinue` prop，proceed 时继续按钮 pulse 动画 + 提示文案「听起来你已准备好，可以继续了」
- 验证：TS 235/235（+3 proceed 高亮测试）、tsc 干净、lint 0 errors

### V2 P2 第二阶段：教学动作四意图（answer_inline / expand_current / switch_explanation / proceed）
- 完成定义达成：Tutor 回答携带教学动作分类（§2.6.2 四意图），模型根据问题意图自动判定 action type + reasonCode；快捷动作按钮（举例、换个讲法）发送预置问题文本触发分类
- 协议：Python `InlineTutorResponse` 新增 `action: TutorActionField`（type + reasonCode，Pydantic Literal 校验）；TS `TutorCompletedPayload` 新增 `action: TutorAction`；`TutorAnswerItem` 持久化 `action` 字段
- 意图分类：模型输出首行 `[ACTION:type:reasonCode]` 标记行 + 正文；服务端解析后剥离标记行，action 随 `tutor_completed` 载荷下发；无效动作值回退 `answer_inline`
- 流式体验：标记行不出现在 `tutor_block_delta` 流中——服务端 buffer 首个 delta 直到标记解析完毕（前缀匹配 + 等换行）或确定无标记后才下发正文，客户端不闪现标记文本
- UI：`InlineTutorInput` 新增快捷动作按钮行（举例/换个讲法），点击即提交对应问题文本；prompt 新增动作分类指令与 proceed 类型 80 字限制
- reducer：`applyTutorCompleted` 将 payload.action 存入 TutorAnswerItem
- 验证：pytest 78/78（+10 四意图新测试）、TS 232/232（+1 action 存储测试）、tsc 干净、lint 0 errors

## 2026-09-06

### 修复：TOC/Outline 生成卡死（glm-5.3-flash 思考耗尽 max_tokens 预算）
- 症状：生成课程一直 loading 无结果，TOC 流只出 thinking 无内容；错误信息笼统「课程目录生成失败」
- 根因：glm-5.3-flash 思考长度方差大（实测 3.4k~12k 字），带搜索工具定义时更长；max_tokens 预算被思考耗尽后 content 一个 token 未输出即截断（finish_reason=length）；旧预算按 deepseek-v4-flash（思考短）设定，今天切模型后暴露
- 铁证对照：带 tools → finish_reason=length、thinking 10259 字、content 0 字；不带 tools → finish_reason=stop、thinking 3374 字、content 1935 字
- 修复：max_tokens 调整 toc_agent 4000→16000、outline_agent 6000→12000（初始）/4000→8000（多轮回答），对齐 cards_agent 此前 16000 的先例；toc_agent 空目录兜底特判「思考耗尽预算」单独提示便于诊断（补 streaming_thinking 累积变量）
- 已知风险：chat_agent max_tokens=1500 理论上同样有截断风险（无实锤、场景不同，暂不动）
- 验证：pytest 68/68 绿；真实 LLM 冒烟：TOC 端到端完整输出（course_name + 12 节点 + complete 事件），本次 thinking 14067 字——旧预算 4000 必截断、16000 预算完整走完

### 修复：模型思考过程换行全部丢失（段落连成一行）
- 症状：outline 流式生成时「思考过程」所有内容连成一行，看不到段落结构；用户另观察到思考尾部已表达学习方向/学习目标（查明为模型先打草稿再誊写的正常行为，卡片数据从 content 流独立解析，非 bug）
- 根因：`minimax_agent.py` 的 `_do_streaming_call` 对每个 thinking/content_delta chunk 做 `rstrip('\n')`（2026-04-13 引入，无必要动机）——换行恰好落在 chunk 边界时被逐个剥离，5k 字思考流 0 换行；前端 `whitespace-pre-wrap` 渲染正常，数据在源头已丢失
- 修复：去掉两处 rstrip（换行是内容结构的一部分）；`StreamingMessage.tsx` 渲染层 `thinkingContent.trim()` 兜底流尾残留空白（数据保持原样）
- 惠及范围：`AgentClient` 为 outline/toc/cards/questions/chat 5 个 agent 共用，全部流式端点换行恢复
- 验证：TDD 先红后绿（新增 `test_stream_newlines.py` 构造 SSE 流断言换行保留）；pytest 68/68、TS 231/231、typecheck 干净、lint 0 errors；真实 LLM 冒烟：thinking 换行 0→79、content 0→6，段落结构完整；顺带重启了 8000 端口 8/31 残留旧进程

### 课程模型切换：zhipu/glm-5.3-flash（全链路）
- 全链路替换 `muses/deepseek-v4-flash` → `zhipu/glm-5.3-flash`，共 9 处：4 个 env 文件（`.env.local`、`python-agent/.env` 及两个 `.env.example` 占位符）`LLM_MODEL` 行、3 处源码硬编码默认值（`lib/minimax.ts`、`python-agent/lib/minimax.py`、`python-agent/services/memory_refine_service.py`——第 3 处为全链路 grep 才发现的兜底点）、CLAUDE.md / AGENTS.md 模型记录
- 端点不变：新模型同为 `provider/model` 命名，走同一 muses 网关
- 冒烟通过：内网直连 HTTP 200，流式 delta 含 `content` + `reasoning_content`（与 deepseek 相同结构，Python thinking 处理链路兼容，TS 侧 `callMiniMax` 非流式不受影响），中文回复无损
- 历史文档（`v2_课程生成逻辑.md` Spike 实测记录）为历史事实，有意不改

### 修复：首页全页面交互失效（dev server 长跑退化）
- 症状：首页 SSR HTML 正常显示，但所有按钮点击无反应、受控输入无法更新
- 根因：dev server 连续运行 10 天，`.next` 增量编译缓存退化——关键 chunk（`app-pages-internals.js`）磁盘丢失但 HTML 仍引用 → 浏览器 404 → React hydration 失败，全部交互死掉
- 修复：杀进程 + `rm -rf .next` + 双服务重启；验证关键 chunk 全 200、tutor 路由 422 正常返回（路由已加载）
- 非代码问题：P2 diff 未触及首页链路，代码本身无 bug

## 2026-09-01

### V2 P2 第一阶段：流内答疑（含最终审查修复波）
- 完成定义达成：任务流式生成中提问只入队（问题立即入流并立即落盘，任务完成后按队列顺序自动回答），边界提问立即启动流式回答；Tutor 完成后章节仍停在边界，不自动推进主线；回答失败只影响当前答疑，可局部重试
- 持久化与恢复：UserQuestion/TutorAnswer 立即进入学习流并经 commit 统一入口落盘；刷新后问题轨迹、在途回答与失败态不丢，被中断请求自动重试一次（再失败进入可见失败态且不再自动重试）；已完成回答不重复请求
- 双流隔离：Tutor 持独立代际/AbortController/忙闲标志，与主任务流互不取消；章节卸载/切换两者一并作废；问题串行回答、自动窗口 3 题（滑动窗口语义），超窗口排队不并发；旧章节残留流与版本/ID 不匹配事件一律丢弃
- 服务端：新增 Python `/api/learning/v2/tutor/stream`（SSE 完整事件序列，`extra='forbid'` 严格校验，幂等键解析章节/任务/问题并交叉校验，不匹配流前 422）+ Next 鉴权薄透传；错误走稳定中文 code/message/retryable
- 红线守住：回答仅中文 markdown、不输出思维过程；事件载荷禁含 evidence（真实冒烟实测 0 处）；课程计划、任务内容与证据不被 Tutor 修改；V1 ChatWidget 未改动
- 裁决记录：契约补齐 courseId（普通字段不入幂等键，客户端写入前比对）；任务上下文为标题+任务目标、近期问答限当前任务最近 3 组（spec §3.2 已对齐）；修复波补齐任务重试计数只认 `kind==='task'`、排队文案区分流中/边界超窗、`decideTutorSubmission` 相位白名单自防御
- 验证：TS 231/231 绿（流内答疑 78 项）、pytest 67/67 绿、typecheck 干净、lint 0 errors；HTTP 错误路径冒烟（422 稳定错误体）；真实 LLM 冒烟：事件序列完整、中文任意切分无损、约 1.1s
- ⚠️ 已知：8000 端口残留 2026-08-31 旧 python-agent 进程（无 tutor 路由），下次真实验证前需重启

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

### 基础设施：会话持久化与清理、嵌套仓库收敛（压缩归档）
- outline 会话文件持久化（`data/sessions/*.json`，内存为主磁盘恢复，原子写入防半截、单文件损坏跳过）+ 自动过期清理（启动清一次 + 后台周期清理，默认 24h 过期/1h 间隔，环境变量可覆盖）；验证 12/12、9/9 绿含真实重启
- 收敛 `python-agent/` 嵌套独立仓库（Railway 遗留）入主仓库：确认主仓库已跟踪全部文件后移除内层 `.git`（已备份）
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

## 2026-09-20 ~ 2026-09-28（原文归档）

### 流式体验与输入细节修复
- 默认关闭下一任务完整预取：继续学习改为真实 SSE 流式输出，避免缓存事件一次性重放造成“不流式”的观感；可用 `NEXT_PUBLIC_ENABLE_TASK_PREFETCH=1` 恢复零等待模式
- 核心要点支持 markdown 行内格式（加粗、代码等），同时保持要点卡紧凑间距
- 助理头像尺寸修正为标准 20px 并保持居中
- H5 输入框聚焦不再按固定比例滚动；仅在软键盘打开后确实遮挡输入框时才以 nearest 方式滚动
- 实测 Next.js 代理任务流：task_started 后约 2.3 秒出现首个内容增量，后续持续 delta
- 回归：TS 299/299、Python 168/168、`tsc --noEmit` 通过

### 学习页提问输入窗主题统一
- 底部输入窗复用目录页学习助理视觉语言：AssistantGlyph 头像、助理主题渐变、轻量光斑背景和毛玻璃输入面
- 发送按钮对齐 ChatInputForm：渐变背景、思考中态、hover/press 微动效
- 占位文案默认对齐「哪里卡住了，直接问我」
- 回归：TS 299/299、`tsc --noEmit` 通过

### 学习页提问体验修正
- 输入框聚焦不再主动滚动；仅移动端软键盘可能遮挡时才平滑滚到可视区域
- 学习流改按数组位置渲染：提问后继续学习的新内容出现在问题和 AI 回答之后，符合用户时间线
- AI 回答生成期间隐藏边界卡；回答完成后恢复，避免“本节要点”与回答流抢注意力
- 主内容生成中隐藏提问输入框，生成结束后再展示；移除“举个例子/换个讲法”快捷按钮
- 边界卡移除“本节要点”大块，仅保留轻量下一步提示，整体降低视觉强度
- AI 回答卡接入目录页学习助理头像与主题渐变，输入/重试按钮同步采用助理主题色
- 回归：TS 299/299、Python 168/168、`tsc --noEmit` 通过

### 学习页信息层级二次调整
- 移除任务卡与「第 x 节」编号：学习内容改为连续文章流，仅保留轻量任务标题；过渡线不再标注“下一节”
- 顶部与章节目标进度改为百分比表达，边界卡改为“本章还剩 n 节”，降低内部教学编号感知
- AI 回答改为轻量左侧强调条 + 白色内容面；失败态改为紧凑通知条，重试按钮内联
- 系统错误卡移除大块底部操作区，重试按钮与标题同行，降低视觉噪音
- 章节完成卡：下一章标题只显示在预览行或 Recap 中；按钮文案统一为「继续下一章」/「回到课程」
- 回归：TS 299/299、`tsc --noEmit` 通过

### 学习页 UI/UX 视觉升级
- 章节目标改为卡片式 hero：标题、目标、进度条和完成比例集中呈现；顶栏同步迷你进度
- 任务内容升级为卡片容器：任务编号徽标、标题层级、生成中高亮边框、来源卡与正文形成统一阅读区
- 规划 / 首节生成等待态从单行文案改为骨架卡 + spinner，降低等待焦虑
- 边界卡强化层级：主操作按钮 + 下一节说明双行结构，按钮增加轻微位移和阴影反馈
- 关键点 / 示例 / 对比 / 流程图块统一为更克制的卡片语言，移除 emoji 标签，改用小圆点 + 大写标签
- 提问输入、快捷操作、Checkpoint 选项、排序、提交与结果反馈统一圆角、边框、阴影和 hover/active 反馈
- 移动端底部留白扩大，避免边界卡 / 输入区遮挡内容
- 回归：TS 299/299、Python 168/168、`tsc --noEmit` 通过

### 章节证据与任务联合查询
- 新增 `task_evidence_coverage`：判断章节 EvidencePack 是否覆盖当前任务；英文/数字关键词命中即覆盖，纯中文需至少 2 个 2-gram，避免偶然匹配
- 任务补搜查询改为「课程主题 + 章节标题 + 任务标题 + 任务目标」联合构造，并复用权威域推断
- 覆盖不足且任务本身需要外部证据时才补搜；稳定任务即使弱覆盖也复用章节证据，不额外搜索
- 回归：Python 168/168、TS 299/299、`tsc --noEmit` 通过

### 任务级证据筛选
- 任务内容生成前按任务标题 / 任务目标对章节 EvidencePack 做相关性排序，只注入 Top 3 来源
- 轻量相关性算法：英文/数字词 + 中文 2-gram 匹配，相关性权重高于权威分，避免无关官方来源占据上下文
- 无匹配时保留章节证据原排序，作为兜底上下文；不影响流式生成速度，也不增加搜索请求
- 回归：Python 163/163、TS 299/299、`tsc --noEmit` 通过

### 补救内容证据化
- 用户答错后，补救讲解与等价新题读取同章节 EvidencePack
- 补救 prompt 增加证据红线：补救结论、新题正确答案、干扰项都必须与任务摘要或证据一致；证据不足时避免版本号/默认值/边界细节
- 新检查题的 `sourceRefs` 同样由服务端确定性附加并复用「题目来源」展示
- 回归：Python 160/160、TS 299/299、`tsc --noEmit` 通过

### Checkpoint 证据化
- 检查题生成读取同章节 EvidencePack，并把来源注入题目生成 prompt
- Prompt 增加证据红线：正确答案须被任务摘要或证据直接支撑；干扰项不得与证据矛盾；证据不足时避免版本号/默认值/边界细节；排序题必须有唯一顺序
- `CheckpointDefinition` 新增 `sourceRefs`，由服务端确定性附加，不采信模型输出
- 检查题卡片显示「题目来源」；任务内容与题目共用 `SourceRefsView`，链接清洗/去重逻辑一致
- 回归：Python 159/159、TS 299/299、`tsc --noEmit` 通过

### 课程级主题 EvidencePack
- TOC 生成阶段新增课程级证据包：按主题哈希持久化到 `python-agent/data/evidence/topics/`，7 天过期
- 课程目录 prompt 注入权威来源约束，要求优先覆盖来源中的核心变化与基础结构，不规划证据未支持的高风险版本细节
- TOC Agent 与非 Agent 链路都复用同一证据包；目录模型原有 tool-calling 搜索保留
- 回归：Python 156/156、TS 299/299、`tsc --noEmit` 通过

### 章节级 EvidencePack
- 新增 `services/evidence_store.py`：按课程文件 + 章节 key 持久化证据包，默认存于 `python-agent/data/evidence/`（已 gitignore）
- 章节计划阶段生成最小查询计划（官方域优先 + 通用兜底），搜索一次并保存 `evidenceId/title/url/domain/summary/authorityScore/retrievedAt`
- 同章节任务生成优先复用章节证据包；仅当没有证据包且任务命中搜索启发式时才补搜，减少重复免费搜索
- 章节计划 prompt 注入权威来源约束，避免规划证据未支持的高风险事实细节
- 证据包默认 7 天过期，损坏文件安全降级，不阻塞课程计划或任务生成
- 回归：Python 150/150、TS 299/299、`tsc --noEmit` 通过

### 免预算搜索路径加固
- 新增 `source_registry`：按主题推断官方文档域，React/Next/Vue/Tailwind/Node/Python/CSS 等优先命中权威源
- 搜索工具新增结构化接口：支持 `site:官方域` 查询、来源权威分、URL 规范化、去重、进程内 1 小时缓存
- 免费搜索后端改为 Google backend 优先，`duckduckgo lite` 和 `bing lite` 兜底；当前中文查询实测比原 auto 路径更稳定
- 任务证据包改为结构化结果，不再解析字符串格式；保留 `Jina Reader` 做来源深读
- 回归：Python 144/144、TS 299/299、`tsc --noEmit` 通过

### 本章小结流式化
- Python Agent 新增 `/api/learning/v2/chapters/recap/stream` SSE 端点；Next.js Recap 代理改为流式透传
- Recap 协议新增 `recap_started / recap_takeaway / recap_completed`；服务端在模型 JSON 的 `keyTakeaways` 每完成一条时立即下发，最终仍以完整 JSON 校验为准
- 学习流归约器支持 Recap 渐进写入：空小结先进入 streaming 态，逐条要点追加，`recap_completed` 后转 complete
- 完成收尾 UI：等待期显示骨架；第一条要点到达后切换为小结卡片并逐条渐显；最终完成卡复用同一 Recap 渲染
- 回归：TS 299/299、Python 140/140、`tsc --noEmit` 通过

### 来源引用展示
- 任务内容新增「参考来源」卡片：有搜索证据时展示来源标题 + 域名，最多 4 条
- 外链安全策略：仅渲染 http/https，自动按 URL 去重，非法链接降级为纯文本
- 新增 `getDisplaySourceRefs/getSourceDomain/getSourceDisplayTitle/isSafeHttpUrl` 纯函数与回归测试
- 回归：TS 298/298、`tsc --noEmit` 通过；ESLint 0 errors / 21 warnings

### 错误卡片合并重试 + 正文排版升级
- 学习流错误通知改为“末尾错误原地替换”：连续网络/任务/答疑失败不再堆叠多条错误；仅当错误不在末尾时才新增
- `SystemNoticeItem` 增加 `taskId/questionId/retryable` 上下文；错误卡片可直接“重新生成本节”或“重试回答”
- 错误/提示卡片重构为产品化卡片：图标 + 标题 + 说明 + 底部重试操作，替代单行纯文本
- `MarkdownContent` 统一挂载 `.prose`；参考 Notion/Medium/Anthropic 类文档排版节奏，正文行高 1.78，段落/列表/标题/引用间距分层更清晰
- 回归：TS 296/296、Python 137/137、`tsc --noEmit` 通过；ESLint 0 errors / 21 warnings

### 本章小结不再折叠学习流
- 章节完成收尾不再立即把已完成任务正文替换成摘要；用户刚阅读的学习流保持原样
- 压缩归档降级为存储配额不足时的兜底策略，避免“总结影响正文”的体验
- 章节小结等待期新增骨架占位，替换原本只有一行“正在收尾本章…”；真实小结出现时使用 260ms 渐显
- 回归：TS 295/295、Python 137/137、`tsc --noEmit` 通过

### 学习流渐显与滚动体验优化
- 新增 `StreamingMarkdown`：markdown 增量经 rAF 平滑补间，底部 34px 渐显；任务完成后残差继续缓释完，避免结尾突跳；`prefers-reduced-motion` 关闭渐显
- 学习流滚动改为任务级决策：点「继续学习」或命中预取切换任务时不抢滚动位置，新内容出现在当前位置下方；用户手动回到底部后恢复贴底跟随；同一任务内保持原跟随状态
- 回归：TS 295/295、`tsc --noEmit` 通过

### 学习流文本流式 + 流程图视觉升级
- `ContentStreamParser` 由“整行缓冲”改为“安全字符流”：未满一行的 markdown 正文立即产出 `markdown_delta`；仅 `:::` 标记前缀继续缓冲，避免半截标记误判为正文；结构化块仍完整后一次性产出
- 新增回归：markdown 未满一行立即流式、`:::key_point` 前缀不会被提前当正文；更新事件序列与流中断用例
- `TaskBlocksV2.DiagramBlockView` 改用 Mermaid `base` 主题 + 品牌化 `themeVariables`（暖色节点、浅色边框、更清晰文字），并放宽节点/层级间距、增加卡片阴影和失败降级样式
- 回归：pytest 137/137、TS 292/292、`tsc --noEmit` 通过；ESLint 0 errors / 21 warnings

### 安全与 V2 服务端存储边界加固
- 鉴权：生产环境未配置 `INVITE_CODES` 时拒绝所有格式有效的邀请码；本地开发保持空名单放行
- 服务间认证：新增 `PYTHON_INTERNAL_TOKEN`，Next.js 所有 Python 代理统一携带 `X-Internal-Token`，Python Agent 拦截未授权 `/api/*` 请求（`/health` 保留探活）
- V2 server 模式：课程创建、课程读取、章节树自愈与章节完成统一经 `LessonRepository`；服务端成功后写本地缓存，服务端失败不误降级为 V2
- 乐观锁：章节保存改用独立 `expectedUpdatedAt` revision；同一章节保存串行化，409 冲突返回服务端版本并在 UI 提供「加载服务端 / 本机覆盖」
- 回归：TS 292/292、Python 135/135、`tsc --noEmit` 通过；ESLint 0 errors / 21 warnings

### 切片 2/3/4：质量评测基线 + diagram 块 + 响应式重讲
- **切片 2**：`python-agent/scripts/evaluate_content_quality.py`（3 主题固定评测集 + 程序结构判分 + 可选 LLM rubric 质量评分）；`data/content-quality-topics.json`（评测主题配置）
- **切片 3**：`types/learning-v2` 新增 `DiagramBlock`（mermaid）；`content_stream_parser.py` 支持 :::diagram 块；`TaskBlocksV2` 新增 DiagramBlockView（动态 import mermaid 渲染，语法错误降级为代码块）；prompt 中 process/derive 配方加入 diagram 步骤 + Mermaid 语法规则
- **切片 4**：`lib/learning-v2/confusion-signal.ts`（困惑关键词匹配 + 连续计数）；`tutor-context.ts` 请求载荷新增 `reExplain` 字段（连续 ≥2 次困惑触发）；`inline_tutor.py` 新增 re_explain_mode 指令（强制 switch_explanation + 换类比/换表征重讲）
- 质量：pytest 131/131（+5 diagram + 6 confusion signal）、TS 全绿、质量门 4/4

### 切片 1：内容配方（Content Recipe）——多块流式输出
- 问题：task_content prompt 只有「300~500字正文+结尾引用块」，无块类型/结构约束 → 实测退化为纯文字 markdown（与竞品 HyperKnow 差距最大项）
- 实现：prompts/task_content.py 新增 CONTENT_RECIPES（8 种 teachingPattern 各定义显式块序列+内容量下限，循证依据 education-agent-skills 显性教学/记忆科学）
- 协议：LLM 按 :::type…::: 定界符输出混合内容；services/content_stream_parser.py 增量解析器（行缓冲状态机）将混合文本拆为 markdown 流式增量 + 结构化块一次性产出
- 前端零改动：applyContentBlockStarted 对非 markdown 块已 no-op、applyContentBlockCompleted 通用 upsert、task_completed 替换完整 blocks 数组
- 无定界符时优雅退化单 markdown 块；未闭合块降级 markdown；PROMPT_VERSION → task-content-v3
- 测试：pytest 126/126（+7：多块序列/comparison/example 解析/增量一致性/退化兜底/未闭合降级）、TS 276/276、质量门 4/4

### 补全：V2 任务内容接入搜索证据包（设计文档 §搜索策略）
- 背景走查发现：V1 链路（outline/toc/cards/questions）搜索工具齐全，但 **V2 新链路（chapter_plan/task_content）从未接搜索**——新课默认走 V2 后任务内容纯靠模型知识，时效性主题会过时
- 实现：`services/search_evidence.py`（时效性关键词启发式 needs_search：版本/最新/价格/对比/实践等命中才搜，DISABLE_WEB_SEARCH 可整体关闭；build_evidence_pack 复用 web_search，失败安全降级 None）
- task_content_service：命中启发式 → 先搜后写（证据包注入 system prompt + 引用来源要求）→ sources_ready 事件（协议预留字段首次启用）→ task_completed 携带 sourceRefs；PROMPT_VERSION → task-content-v2
- 真实搜索 + 真实 LLM 冒烟（React 19 主题）：4 个真实来源注入、sourceRefs 完整、正文 849 字提及来源、无 EMPTY_CONTENT；反例（认识 HTTP 缓存）正确跳过搜索
- 测试：pytest 119/119（+8）、TS 276/276

### 修复：glm-5.3-flash 思考预算全面排查（网页实测暴露 EMPTY_CONTENT）
- 症状：浏览器实测建课走章节时任务流返回 EMPTY_CONTENT（"任务内容生成为空"失败态），偶发；chapters/plan 也曾空内容（靠 repair 重试兜底成功）
- 根因：9/6 TOC 修复只调了 toc/outline/cards 的预算，**task_content(2000)/chapter_plan(3000)/tutor(1500)/recap(1500)/toc_service 非代理路径(2000)/chat(1500)/plan_patch(3000) 仍按旧模型 deepseek-v4-flash 思考短的假设设定**——glm-5.3-flash 思考 3.4k~12k 字耗尽预算后 content 0 字
- 修复：task_content 2000→16000、chapter_plan 3000→16000、tutor 1500→8000、recap 1500→8000、toc_service 2000→16000（两处）、plan_patch 3000→8000、chat 1500→8000
- 验证：真实 LLM 连跑 3 次任务流 3/3 无 EMPTY_CONTENT、task_completed 全出；pytest 111/111

## 2026-09-29 CHANGELOG 快照（归档）
以下为 2026-09-30 学习系统改造前的未归档条目快照。

### 当前架构速览
- 新增当前架构速览与 docs 分类索引，`docs:check` 纳入结构校验
- 根 README 重写为 AI/开发者快速入口，`npm test` 前置文档检查

### 学习体验与 Hook 拆分
- 修复重试成功后错误通知继续展示的问题；引入 stream-item-presentation 展示规则
- `useChapterLearning` 拆出 Checkpoint、章节完成、动态调度建议；Python `main.py` 拆出 Learning V2 与用户数据路由
- server 模式补齐课程删除；新增产品功能交接包

### V1 学习流下线
- 删除 V1 学习页、组件、API、Context、生成服务与系统课预生成脚本
- 系统课程改由大纲元数据映射 V2 蓝图；旧课程 beta 下不做迁移
- 验证：TS 296/296、Python 168/168、build 通过
