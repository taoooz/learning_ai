# 项目迭代日志

## 2026-08-31

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

## 2026-06-07

### 第一阶段课程生成优化方案

- 收窄 `docs/architecture/课程生成与用户画像策略-v2.md` 的第一阶段范围：先优化课程生成和节点学习体验，用户画像更新后置
- 明确单节点内容从“知识卡片 + 问题卡片”改为“多个流式学习任务 + 用户主动继续”
- 参考 Hyperlearn 的课程质量原则，补充需求解构、单元聚类、认知负荷控制、任务动词化、梯度排序、内容模板匹配等设计约束
- 明确第一阶段暂不生成练习题，不做答题正确率和新画像字段更新
- 确认第一阶段交互极简化：逐任务流式生成，任务间只有“继续”按钮；不做再讲、深入、单独总结页
- 更新迁移路径：优先落地 `NodeTaskPlan`、任务内容流式生成、最后任务收束与下一节引导、节点完成状态
- 确认 `NodeTaskPlan` 只包含任务骨架（taskId/taskTitle/taskDescription），任务内容独立流式生成；目录生成后预热首个节点任务计划，上个节点首个任务生成完后预热下个节点任务计划

## 2026-05-31

### 课程生成与用户画像策略 V2

- 新增 `docs/architecture/课程生成与用户画像策略-v2.md`，整理课程生成从“章节卡片内容”升级为“章节目标簇 + 动态任务计划 + 每步理解检查”的产品与架构方案
- 明确 V2 课程体验：短步推进、每步停顿、答错补救、答对提速、困惑换讲法、目录稳定
- 设计新的生成链路：需求解构 → 课程蓝图 → 目标簇章节 → 章节任务计划 → 任务即时生成 → Check-in → 画像更新
- 补充用户画像五层模型：Stable Profile、Knowledge Profile、Learning Behavior Profile、Explanation Preference、Recovery Profile
- 给出 P0-P5 渐进迁移路径，建议先验证章节任务流，再重构 Agent 与 Prompt 协议

## 2026-04-20（压缩）

- 学习页 complete 阶段新增"学习小结"：关键收获/练习正确率/薄弱知识点/下节预告四卡片，纯前端计算不调 AI
- Prompt 全部外置到 `python-agent/prompts/`（outline/toc/cards/questions/chat/memory_refine 6 模块 + PromptManager：按需加载、模板变量、缓存、`reload_prompts()` 热更新），6 个 service 去硬编码 f-string
- 新增 Memory LLM 精炼系统：`MemoryStoreV3.learningSummary` + Python Agent `memory/refine` 端点 + `/api/memory/refine` 代理；聊天完成后自动触发（fire-and-forget、5 分钟去重），精炼结果注入 Chat/Planning prompt
- Outline/Chat 上下文瘦身：前端改发 `getPlanningMemoryPayload()`/`getChatMemoryPayload()` 精简 payload，不再发全量 MemoryStoreV3；字段 `user_memory` → `planning_memory`；chat prompt 构建迁到 Python Agent `chat_agent.py`

## 2026-04-17（压缩）

- 系统课程数据整合：删除约 400 行手写简化内容，改为从 `data/system-courses/generated/*.json` 静态导入；`lib/data/system-courses.ts` 重构为从 JSON 加载 lessons 并动态构建 `CourseBlueprint`

## 2026-04-13（压缩）

**批量 Bug 修复**
- 修复：Blueprint 卡片渲染后消失、同标签页重新生成触发 answer_agent 422（sessionId 竞态）、节点内容 404 及 cards 重复请求（`pendingNodeRequests` 去重）、LoginContent Rules of Hooks 错误
- TOC 目录页恢复流式展示（SSE 透传 + 实时增量解析）；修复 outline thinking 无限循环（同一 chunk 连续 3 次即终止流）；TOC 完成跳转改为底部悬浮提示条（3 秒倒计时）

**代码架构优化（八阶段）**
- P0 修复：`useUserMemory` 去桶重构、3 个路由补异常捕获、邀请码迁 `INVITE_CODES` 环境变量、Redis 客户端单例
- 消冗余：新增 `lib/python-agent.ts` 统一代理调用；重写 recommendations 路由（复用 `callMiniMax`，降级标记 `degraded`）
- 组件拆分：ConfirmModal/CourseCard/SystemCourseRecommendations 独立；`app/page.tsx` 406→218 行
- API 规范化：新增 `lib/api-response.ts`（`apiSuccess`/`apiError`/`requireAuth`），4 个路由统一迁移
- ChatWidget 拆分（480→233 行）为 5 子组件 + `useChatSubmit` hook；`types/course.ts`（561 行）拆为 6 个领域文件，35 处导入零改动
- CourseContext 提取 11 个 action 到 `hooks/useCourseActions.ts`；23 测试全绿

## 2026-04-09（压缩）

- Agent 搜索能力推广：新增 `toc_agent`/`cards_agent`/`questions_agent` 及 3 个 `_agent` 路由，原非 Agent 版保留为 fallback；前端 toc/cards/questions 路由全部转发 Python Agent
- Chat 迁移到 `chat_agent.py`（AI 自主判断是否搜索，输出兼容 SSE 格式，前端零改动）；outline answer 也支持搜索；删除废弃 `/api/generate/outline` 路由
- 清理：删除废弃 `agents/`（LangGraph）、`mcp/` 目录；`lib/minimax.ts` 353→181 行；`lib/prompt.ts` 删 4 个已迁移函数及 2 个空壳路由
- 新增 `lib/agent-config.ts` 统一 `PYTHON_AGENT_URL`；set-cookie 改 httpOnly

## 2026-03-27（压缩）

- 课程目录从固定节点步长改为按估算高度动态排布 + 真实文档流纵向布局；节点卡片改最小高度自适应；标题统一最多 3 行；补长标题场景回归测试

## 2026-03-26（压缩）

- 课程生成环境变量兜底：服务端拿不到 key 时回退读 `.env.local`，补 env 文件回退测试
- 轻量课程目录蓝图：目录阶段只产轻量大纲再映射成 blueprint，评估与个性化下放到节点阶段；生成超时从重型试验值收回（约 26 秒可重试超时）
- 生成超时兜底：JSON 请求统一 `reasoning_split` + 双 token 参数（MiniMax 时代 workaround）；两段式重试（超时后收紧 token 预算）；refine 结果强制再校验；失败返回可重试错误而非静默降级
- 首页新增两门系统推荐课程（AI/理财，预生成可离线直开），不混入最近学习列表
- Course Blueprint / Memory V3 首轮落地：新增 `CourseBlueprint/NodeLesson/StoredCourseBundle/MemoryStoreV3` 类型；存储切 `ai-learning-data-v2`；validator + refine 双阶段；memory 改 event-sourced + projections；新增 `smoke:generation` 与 `generationMeta`
- Memory V2 与双层 Retrieval：planning/teaching/chat 三条 payload 链路；`normalizeConceptKey` + alias 字典概念归一；`lib/memory/repository.ts` + `aggregator.ts` 统一出口；assessment 信号改证据累积式置信度；正向信号沉淀（解释偏好、已掌握概念）

## 2026-03-25（压缩）

- 聊天助手加 `max_tokens: 1500` 提速
- 课程目录合并为路径式结构（节点左移轻弯路径、标题右侧、暖橙焦点 + 四态节点体系），布局抽成可测纯函数
- 课程内容可视化：MermaidChart + 对比表/时间线/图例/要点组件，AI 生成时自动判断添加，复杂图表支持全屏
- 澄清问题优先选择题（单选/多选），仅无法设计选项时用填空
- 课程助理浮窗多轮视觉收敛（暖白胶囊 → 轻科技学习陪伴层，空态引导卡、表格可横向滚动）

## 2026-03-24（压缩）

- 单节学习页重构为单步闯关流：cards+questions 编排统一步骤流，顶部进度条 + 步骤计数，反馈在同一主舞台即时闭环
- 课程加载页重做为"创作中"体验（中央画布主视觉 + 循环文案，不用伪进度条）；澄清问题改单问题步进式
- 修复章节学完后当前节点未标记 completed 的问题
- 目录页重做为"学习路线图"：四态节点 + 纵向路径线，待学习节点进视口定位
- 个人信息页改"学习画像"方向；首页重排信息层级；课程生成支持画像驱动难度匹配（洞察足够直接生成，不足问 1-3 个澄清问题）+ 搜索增强（最多 3 轮，超时降级）

## 2026-03-23

### 设计焕新 / 性能 / 功能 / 修复（压缩归档）

- 设计焕新：全页面统一 CapWords 风格（首页/课程详情/学习页/生成页/资料页），图标按钮 SVG 化，移除渐变与模糊，全局 CSS 变量设计 Token，移动端触摸区域 ≥44px
- 性能：课程树移除 description 字段、卡片内容限 200 字内，课程生成 ~67s 优化至 ~34-41s
- 功能增强：用户画像（目标岗位/工作经历/教育背景）、AI 学习洞察、历史课程列表、节点内容预加载下一节
- 修复：JSON 嵌套括号与 Markdown 特殊字符解析、练习题答案标识提取（"A. xxx" → "A"）、节点解锁逻辑、界面文本全汉化
- 技术：react-markdown 渲染卡片与题目；课程生成显式接收画像与 userMemory，服务端不再依赖 localStorage；答题沉淀 mastery 记忆（conceptMastery/knowledgeGaps）；节点生成注入课程上下文、薄弱点与已掌握项，题目输出 concept/dimension/difficulty/cardId
- 记忆降噪：聊天 memory 提取改“明确困惑信号”判断、新增来源可信度（chat vs assessment，答题错误覆盖低置信聊天推断）、旧信号自动衰减、相关性分层（高相关高置信才影响主干，弱相关只做类比，无关忽略）
- Prompt 约束：课程树新增“可跳过/必须补/类比落点/节点依赖”规划约束；节点内容注入整门课程结构与前置依赖，减少重复讲解和断层

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
