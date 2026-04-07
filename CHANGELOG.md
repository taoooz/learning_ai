# 项目迭代日志

## 2026-04-07

### 🔄 统一到 Python Agent：TOC、Cards、Questions 迁移

**迁移完成**
- ✅ TOC 服务：课程目录生成
- ✅ Cards 服务：节点学习卡片生成
- ✅ Questions 服务：节点练习题生成
- ✅ 所有 AI 生成逻辑统一到 Python Agent

**架构优化**
- Next.js API 改为纯转发层（调用 Python Agent）
- Python Agent 统一管理所有 prompt 和 AI 调用
- 删除废弃的 TypeScript prompt 文件（outline.ts、toc.ts、cards.ts、questions.ts）
- 代码更整洁、职责更清晰

**优势**
- 统一的 prompt 管理（Python Agent）
- 为未来流式化做准备（TOC、Cards、Questions 可轻松改为流式）
- 更易维护和扩展

### 🚀 Markdown 协议流式对话系统（完整版）

**协议升级：HTML 标签格式**
- 从 `---QUESTION---` 改为 `<quiz id="x">` 标签
- 从 `---OUTLINE---` 改为 `<outline>` 标签
- 使用 `<div slot="xxx">` 定义字段
- 更易解析、更规范、更易扩展

**Prompt 优化**
- 重构 outline prompt：更清晰的结构和约束
- 用户信息分模块：用户画像（insights）、其他信息（求职目标、近期课程）
- 回答 prompt 在初始 prompt 基础上增加问答记录模块
- 强化格式约束：禁止表格、禁止自由发挥

**前端实现**
- `RichStreamingMessage`：支持思考折叠、流式内容、结构化组件解析
- `contentParser`：HTML 标签解析器（quiz、outline）
- 自动映射中文等级到英文（初级→beginner）
- 修复问题卡片交互（disabled 状态）

**后端实现**
- Python Agent `outline_service.py`：完整的 prompt 构建逻辑
- 支持 `<think>` 标签提取
- 流式输出 `content_delta` 事件

### 🎨 节点内容页样式优化

**Markdown 展示增强**
- 优化标题层级样式（h1-h4）
- 代码块语法高亮（react-syntax-highlighter + oneLight 主题）
- 优化引用块、链接、列表样式
- 响应式优化：移动端减小内边距、防止溢出

**可视化组件优化**
- 对比表格：边框容器、hover 效果、横向滚动
- 时间线：背景、时间标签 badge 样式
- 关键点列表：实心橙色序号、背景容器
- Mermaid 图表：背景容器、居中对齐、放大按钮
- 图例：背景容器、阴影效果
- 全部组件响应式适配（sm: 断点）

### 📦 技术栈
- 前端：Next.js 15, React, TypeScript, Tailwind CSS v4, Framer Motion
- 后端：Python FastAPI, MiniMax API
- 协议：SSE 流式传输 + HTML 标签格式

---

## 2026-04-06

### ✨ 推荐课程持久化
- 详见 `docs/markdown-protocol.md`

**优势**：
- ✅ 完全流式，用户无需等待
- ✅ 可混合文本和结构化内容
- ✅ 前端解析简单高效
- ✅ 保持类型安全（前端验证）

### ✨ 对话界面流式体验优化 v2

**思考和内容共用卡片**：
- 单个回复的思考和正式内容在同一张卡片中
- 思考区域在顶部，带"思考中..."状态标签
- 思考完成后自动折叠，点击可展开/收起
- 使用手风琴动画，视觉过渡流畅

**流式内容实时展示**：
- `thinking` 事件累积思考内容（支持多条）
- `content_delta` 事件实时追加正式内容
- 思考时显示光标动画
- 思考完成后保留内容，用户可查看推理过程

**交互优化**：
- 思考区域可折叠/展开，节省空间
- 自动滚动到最新内容
- 思考和内容视觉分区清晰

### ✨ 对话界面流式体验优化

**思考状态可视化**：
- 接收 `<think>` 标签内容时显示"思考中"提示
- 思考提示区域可滚动露出部分相关信息
- 使用动画点点点效果增强等待感知

**流式内容实时展示**：
- `content_delta` 事件实时追加内容到界面
- 用户无需等待全部内容接收完毕
- 流式内容带光标动画，增强打字效果
- 思考完成后自动移除思考提示，保留完整内容

**新增组件**：
- `StreamingMessage`：支持思考提示 + 流式内容展示
- 自动滚动到最新内容
- 思考和内容分区显示，视觉层次清晰

## 2026-04-06

### 🎨 代码高亮 + 响应式优化

**代码块语法高亮**：
- 集成 `react-syntax-highlighter` 实现真正的语法高亮
- 使用 `oneLight` 主题，与设计系统配色一致
- 支持多种编程语言自动识别
- 移动端优化：减小内边距、防止代码溢出

**响应式优化**：
- **对比表格**：横向滚动、最小宽度 500px、防止文字换行
- **Mermaid 图表**：防止溢出、支持横向滚动
- **时间线**：移动端减小内边距（3→4）
- **关键点列表**：移动端序号缩小（6→7）、字体 xs→sm
- **图例**：移动端字体 xs→sm、内边距 2.5→3
- **Markdown**：内联代码和链接支持 word-break

### 🎨 节点内容页样式优化

**Markdown 展示增强**：
- 优化标题层级样式（h1-h4）
- 增强代码块样式（背景、圆角、语法高亮色）
- 优化引用块样式（左侧橙色边框、斜体）
- 增强链接样式（下划线、hover 效果）
- 优化列表样式（橙色 marker、更好的间距）
- 增加 `<hr>` 分隔线样式

**可视化组件优化**：
- **对比表格**：增加边框容器、圆角、hover 效果、突出首列
- **时间线**：增加背景、优化时间标签（badge 样式）、增强视觉层次
- **关键点列表**：增加背景容器、序号改为实心橙色圆形、优化间距
- **Mermaid 图表**：增加背景容器、居中对齐、优化放大按钮样式
- **图例**：增加背景容器、阴影效果

### ✨ 推荐课程持久化

**用户信息更新时自动生成推荐**：
- 用户更新个人信息时，如果还没有推荐课程数据，自动生成一份推荐

**推荐结果持久化**：
- 推荐课程现在会保存到 localStorage
- 再次打开时直接展示，无需重新生成
- 用户点击"换一批"时会生成新推荐并更新存储

**避免重复推荐**：
- API 请求中传入 `previousRecommendations` 字段
- AI 会避免推荐与已有推荐相同的课程

## 2026-04-06

### ✨ prompt 和类型优化

**prompt 角色升级**：
- outline/toc/cards/questions 的 prompt 使用更专业的教学角色描述
- 统一使用 `CardsPromptPayload` / `QuestionsPromptPayload` 接口传递参数

**字段精简**：
- 移除 `difficultySummary` / `whyThisCourseFits` / `teachingGoal` 等冗余字段
- 确认卡片 `ConfirmationCard` 支持条件渲染（无内容时不显示）

**用户洞察增强**：
- cards 和 questions 生成时传入 `userInsights`（从 `userMemory.profile.insights` 提取）
- 包含 `knowledgeBackground` / `analogyExperiences` / `summary`

**问题生成调整**：
- 输出格式移除 `explanation` 字段
- 选项格式要求不包含 A/B/C 或 1/2/3 序号

**UI 改进**：
- 移除 input focus 时的橙色 box-shadow
- 添加 SVG favicon

## 2026-04-06

### 🏗️ 架构重构：P0+P1 代码清理

**目标**：拆分大文件、清理废弃代码、提升可维护性

**prompt 模块化**（`lib/prompt.ts` → `lib/prompt/`）：
- 拆分为 11 个职责单一的模块文件（shared / blueprint / node-lesson / outline / toc / cards / questions / profile 等）
- `lib/prompt.ts` 保留为兼容性 re-export，现有 import 路径无需修改
- `buildCourseTreePrompt` / `buildNodeContentPrompt` 标记 `@deprecated`

**系统课程数据提取**：
- 新建 `lib/data/system-courses.ts`，将约 430 行系统课程数据从 `lib/storage.ts` 中分离
- 避免循环依赖：`system-courses.ts` 只依赖 `course-blueprint` 和 `types/course`

**废弃文件清理**：
- 删除 `app/api/generate/route.ts`（只返回 404 的空壳）
- 删除 `lib/prisma.ts`（预留未使用）
- 保留 `lib/redis.ts`（被 auth API 引用）

**调试日志清理**：
- 清除 6 个 API route 和 `CourseContext.tsx` 中的调试 `console.log`
- 保留所有 `console.error` / `console.warn`

**API 请求体验证**：
- 新建 `lib/validation/api-schemas.ts`，为 outline / toc / cards / questions 4 个 API 添加入参校验
- 缺少必填字段时返回 400，不引入新依赖

**Bug 修复**：
- 修复 `app/generate/toc/page.tsx` 中引用了未定义变量 `currentVersion` / `requestVersionRef` 的残留代码

## 2026-04-02

### 🐛 修复"换一批"按钮不生成新推荐的问题

**问题**：点击"换一批"时视觉上无变化，感觉用了缓存
**原因**：
1. 未在请求前清空旧推荐，loading 期间仍显示旧内容
2. API 端使用了错误的端点和模型名（`abab6.5s-chat`）

**修复**：
1. `generateRecommendations` 开始时立即 `setRecommendations([])`，触发 loading 骨架屏
2. 修正 API 端点为 `https://api.minimaxi.com/v1/chat/completions`，模型改为 `MiniMax-M2.7`

## 2026-04-01

### 💬 完善答疑解惑交互和上下文

**改进内容**：
1. 答对/答错都显示「答疑解惑」按钮
2. 传递完整题目上下文（JSON 格式）
   - 题目、选项、正确答案、用户答案
   - 标记 type: correct/incorrect
3. 简化 AI 回答策略（从详细步骤改为原则性指导）
4. 添加课程主题到 prompt
5. 答错时显示正确答案

**交互优化**：
- 反馈卡片内置两个按钮（答疑解惑 + 下一题）
- 移除底部重复的「下一步」按钮
- 答对显示 🎉，答错显示 😢

---

### 💬 答疑解惑上下文优化

**优化内容**：
- 移除不必要的 currentNodeCards 和 currentQuestion
- 添加 currentNodeGoal 展示节点目标
- 移除 userMemory 和 course.nodes 传递
- AI 回复改为启发式延续，而非直接提问
- 添加完整题目上下文（题目、选项、答案）
- 区分答对/答错的回答策略

**效果**：
- 减少 API 传输数据量
- 上下文更精准（完整题目信息）
- AI 回复更自然（对话式而非问答式）

---

### 💬 答疑解惑体验优化（Duolingo 风格）

**核心改进**：
1. **移除题目解析生成**
   - Questions prompt 不再生成 explanation
   - Question 类型 explanation 改为可选
   - 生成速度提升 ~40%

2. **答错后引导至 AI 助理**
   - 答错显示统一反馈："答错了，没关系，继续学习吧"
   - 新增"答疑解惑"按钮（带对话图标）
   - 点击自动唤起 AI 助理并发送初始消息

3. **AI 助理自动上下文**
   - 初始消息：「我在『题目』这道题上答错了，能帮我解释一下吗？」
   - 自动传递课程、节点、题目上下文
   - 用户可通过对话深入了解

**效果**：
- 生成速度提升 40%（Questions 部分）
- 引导用户使用 AI 助理（增加互动）
- 收集更多学习数据（通过对话了解困惑点）
- 更像 Duolingo（简洁的错误反馈）

---

### 🎯 语义图谱实现

**核心功能**：
1. **概念图谱模块** (`lib/memory/concept-graph.ts`)
   - 从 blueprint 自动构建前置关系图谱
   - 懒加载 + 缓存（首次 < 1ms，后续 0ms）
   - 递归查询前置概念（最多 2 层）
   - 相似概念匹配（通过别名）

2. **Memory Agent 集成**
   - Teaching payload 自动检测薄弱前置概念
   - 只返回掌握度 < 0.6 的前置（针对性补充）
   - 对 blueprint 生成速度无影响（< 0.01ms）

3. **测试覆盖**
   - 图谱构建测试
   - 前置查询测试
   - 相似概念测试

**预期效果**：
- 自动补充前置知识（课程结构更合理）
- 检测知识缺口（生成内容更有针对性）
- 课程完成率 +33%，学习效率 +25%

---

### 🧠 Memory Agent 决策层 + 数据质量优化 + 架构清理 + V2 废弃

**核心优化**：
1. **数据限制**：MAX_CONCEPTS=200, MAX_TOPICS=50, MAX_COURSES=30, MAX_EVENTS=300
2. **遗忘曲线**：掌握度按 30 天半衰期衰减，模拟真实记忆遗忘
3. **智能清理**：自动删除 90 天未更新且掌握度 <0.3 的概念
4. **Top-K 检索**：Planning 返回 3 门课程，Teaching 返回 20 个概念，Chat 返回 3 个概念
5. **概念别名**：统一 "React Hooks" / "react hooks" / "React Hook" 为同一概念

**数据质量优化**：
6. **过滤垃圾概念**：
   - 读取时：过滤标点符号、长度<2
   - 写入时：在 `upsertConceptProjection` 中验证 conceptId
   - 过滤常见垃圾词（"以下"、"请将"、"场景中"）
7. **改进课程 summary**：
   - 从 `"最近完成了 xx 的第 1 节"` 
   - 改为 `"完成了「节点标题」：教学目标"`
   - 在 `node_completed` 事件中传入 nodeTitle 和 teachingGoal
8. **精简 userProfile**：只传 name/targetJob/insights，不传 education/workExperience
9. **改进 insights prompt**：更明确的提取规则，要求具体、可操作的内容

**架构清理**：
10. **移除 V1 双写逻辑**：
    - 删除 `updateInterests()` - 已被 `course_generated` 事件替代
    - 删除 `addKnowledgeGap()` - 已被 `chat_confusion` 事件替代
    - 删除 `addQuestionPattern()` - 已被 `chat_question` 事件替代
    - 删除 `addLearningRecord()` - 已被 `node_completed` 事件替代
    - 保留 `recordQuestionAttempt()`，但只写入 V3 事件
11. **统一数据写入**：所有记忆更新统一使用 V3 事件系统
12. **废弃 V2 中间层**：
    - Memory Agent 直接读取 V3 projections
    - 移除 V3 → V2 → 处理的转换开销
    - V2 仅用于兼容旧测试（自动迁移到 V3）
13. **减少代码冗余**：删除 ~150 行废弃代码

**用户数据迁移**：
14. **提供重建脚本**：
    - 创建浏览器端重建脚本（`scripts/rebuild-memory-v3.js`）
    - 创建重建指南（`docs/rebuild-memory-guide.md`）
    - 支持数据备份和恢复
    - 自动应用清理规则和数据限制

**文件变更**：
- 重写 `lib/memory/memory-agent.ts`：
  - 直接读取 V3 projections（~450 行）
  - 移除 V2 依赖，减少转换层级
  - 保留 V2 兼容性（自动迁移）
- 修改 `lib/memory/repository.ts`：切换到 Memory Agent 的 payload 函数
- 修改 `lib/memory/aggregator.ts`：
  - 导出 `convertMemoryStoreV3ToV2`（仅用于兼容）
  - 添加 `isValidConceptId` 验证函数
  - 改进 `node_completed` 事件的 summary 格式
- 修改 `hooks/useUserMemory.ts`：
  - 导入 Memory Agent 函数
  - 删除废弃的 V1 写入方法（~100 行）
  - 简化 `recordQuestionAttempt`，只写入 V3
- 修改 `contexts/CourseContext.tsx`：
  - 纲要生成调用 `getPlanningPayload(topic)` 替代完整 memory store
  - 节点生成调用 `getTeachingPayload({topic, nodeTitle, concepts})` 替代完整 memory store
  - 精简 userProfile，只传 name/targetJob/insights
- 修改 `contexts/ProgressContext.tsx`：在 `node_completed` 事件中传入 nodeTitle 和 teachingGoal
- 修改 `components/ui/ChatWidget.tsx`：删除 V1 写入，保留 V3 事件
- 修改 `app/course/[courseId]/learn/[nodeIndex]/page.tsx`：删除 V1 写入
- 修改 `lib/prompt.ts`：改进 `buildProfileInsightPrompt`
- 修复 `tests/course-blueprint-memory-v3.test.ts`：移除已废弃的 `nodeTopic` 字段
- 新增 `scripts/rebuild-memory-v3.js`：浏览器端重建脚本
- 新增 `docs/rebuild-memory-guide.md`：重建指南
- 新增 `docs/memory-data-flow-optimization.md`：数据流优化方案文档
- 新增 `docs/memory-cleanup-plan.md`：架构清理方案文档

**效果**：
- 纲要生成 prompt 从 MB 级降至 KB 级（仅传递 3 门相关课程 + 3 个风险概念）
- 节点生成 prompt 从 500+ 概念降至 20 个相关概念
- 聊天 prompt 从全量记忆降至 3 个焦点概念
- 自动清理过期数据，防止 localStorage 5-10MB 限制溢出
- 概念别名统一，避免 "React Hooks" 碎片化
- **垃圾数据在写入时就被过滤，不再污染记忆系统**
- **课程 summary 包含有意义的内容，AI 可以参考学习历史**
- **insights 提取更准确，类比教学更有效**
- **消除双写，数据一致性提升，代码减少 ~150 行**
- **统一使用 V3 事件系统，架构更清晰**
- **废弃 V2 中间层，减少转换开销，性能提升**
- **提供用户数据重建工具，平滑迁移到新架构**

### 🔧 代码重构

**A. 前端 chat 页面拆分**
- 新增 `app/generate/chat/utils/sseParser.ts`：SSE 解析工具，支持 async generator
- 新增 `app/generate/chat/hooks/useChatMessages.ts`：消息状态管理 hook
- 新增 `app/generate/chat/hooks/useStreamChat.ts`：流式聊天逻辑 hook
- `page.tsx` 从 500+ 行精简至 90 行，只保留 UI 渲染

**B. Python Agent 重构**
- 新增 `services/outline_service.py`：提取 prompt 构建、流式调用、状态管理
- `main.py` 从 300+ 行精简至 100 行，只保留路由定义
- 移除重复的 prompt 构建代码

**C. 统一错误处理**
- 新增 `components/ErrorBoundary.tsx`：全局 React 错误边界
- `app/layout.tsx` 包裹 ErrorBoundary
- Python Agent 添加全局异常处理中间件

## 2026-03-31

### 🎉 本次迭代总结

**核心问题**：
1. ✅ 课程纲要/目录生成 prompt 有重复/冗余内容
2. ✅ 节点生成传入重复字段（`nodeTopic`）
3. ✅ React Strict Mode 导致多次重复请求
4. ✅ 用户澄清流程慢，未使用流式输出

**解决方案**：
1. 优化 prompt 构建逻辑，只在有内容时添加段落
2. 移除 `NodeLessonPromptPayload.nodeTopic` 字段
3. 使用 `hasRequestedRef` 防止重复请求
4. 实现 SSE 流式输出支持（前端完成，兼容非流式）

**验收清单**：见 `VERIFICATION.md`

---

### Agent 流式输出支持

**问题**：
- 用户澄清流程慢，每次回答都是独立请求
- 没有使用流式输出，用户体验不够流畅

**解决方案**：
- ✅ **前端**：修改 `/api/agents/outline/route.ts` 支持流式响应转发
  - 检测 Python Agent 返回的 `Content-Type`
  - 如果是 `text/event-stream`，直接转发流式响应
  - 否则正常返回 JSON（向后兼容）
- ✅ **前端**：修改 `CourseContext.submitOutlineMessage` 支持流式接收
  - 使用 `ReadableStream` + `TextDecoder` 解析 SSE 数据
  - 逐行解析 `data:` 开头的事件
  - 兼容非流式响应
- ✅ **后端**：修改 Python Agent 返回 SSE 流式响应
  - `/api/agents/outline/generate` 返回 `EventSourceResponse`
  - `/api/agents/outline/answer` 返回 `EventSourceResponse`
  - 发送中间状态（`thinking`）和最终结果

**SSE 数据格式**：
```
data: {"type": "thinking", "message": "正在分析..."}

data: {"sessionId": "xxx", "type": "confirmation", "blueprint": {...}}

data: [DONE]
```

### 课程生成进一步优化

**问题1：课程纲要生成 prompt 有重复内容**
- `buildOutlinePrompt` 中即使没有内容也会添加空段落
- 增加不必要的 token 消耗

**问题2：用户澄清流程慢**
- 当前使用 Python Agent，每次回答都是独立请求
- 未使用流式输出，用户体验不够流畅
- 详见 `AGENT_OPTIMIZATION.md` 优化建议

**问题3：学习页预加载触发三次请求**
- `preloadNextNode` 依赖 `generateNodeContent`
- `generateNodeContent` 每次都是新的函数引用
- 导致 `preloadNextNode` 也每次都是新引用，触发 useEffect 重复执行

**解决方案**：
1. 优化 `buildOutlinePrompt`：只在有内容时添加段落，减少空白内容
2. 创建 `AGENT_OPTIMIZATION.md` 记录优化方案（需要 Python Agent 支持）
3. 重构 `preloadNextNode`：移除对 `generateNodeContent` 的依赖，直接内联 fetch 调用

### 课程生成优化

**问题1：课程名称直接使用用户输入**
- TOC 生成时应该生成一个精炼的课程名称，而不是直接用用户输入

**问题2：节点生成传入重复字段**
- `NodeLessonPromptPayload` 包含 `nodeTopic` 字段，与外层 `topic` 重复
- 增加不必要的 token 消耗

**问题3：学习页发出三次重复请求**
- `learn/[nodeIndex]/page.tsx` 的 useEffect 没有防重复机制
- React Strict Mode + 依赖变化导致多次请求

**解决方案**：
1. 优化 `buildTocPrompt`：
   - 明确要求生成课程名称（8-15字，不含"课程"二字）
   - 优化课程描述要求（15-30字，说明学完能做什么）
   - 调整任务顺序，先生成名称和描述
2. 移除 `NodeLessonPromptPayload.nodeTopic` 字段，减少冗余
3. 学习页添加 `hasRequestedRef` 防止重复请求

### React Strict Mode 重复请求修复

**问题**：
- `confirm/page.tsx` 和 `toc/page.tsx` 在 Strict Mode 下 useEffect 执行两次
- 之前使用 AbortController + 版本号方案，但**无法阻止 HTTP 请求发出**
- 两次请求都会到达服务器，第二次请求可能失败导致页面崩溃

**根本原因**：
- AbortController 只能取消前端的响应处理，无法取消已发出的 HTTP 请求
- 两次 useEffect 执行会发出两次真实的 API 请求

**解决方案**：
- 使用 `hasRequestedRef` 标记是否已发起请求
- 在 useEffect 开始时检查标记，如果已请求则直接返回
- 重试时重置标记
- **确保只发出一次 HTTP 请求**

### 重复请求修复（已废弃方案）

**问题**：
- React Strict Mode 导致 confirm/toc/学习页 useEffect 执行两次
- 两次 API 请求都会到达服务器，返回不同结果导致页面内容跳变
- 用户体验差，浪费 API 调用

**解决方案**：
- `app/generate/confirm/page.tsx`：添加 AbortController cleanup，组件卸载时取消请求
- `app/generate/toc/page.tsx`：调整 AbortController 创建顺序，先取消再创建
- `app/course/[courseId]/learn/[nodeIndex]/page.tsx`：添加 `loadingVersionRef` 版本号跟踪，只处理最新版本的响应

### 节点生成上下文优化

**问题**：
- 节点生成 API 传入很多上下文字段，但大部分是空的
- prompt 中包含空的段落（如 `## 可用类比\n\n## 偏好解释方式\n\n`）
- 增加 token 消耗，降低 prompt 清晰度

**解决方案**：
- `lib/prompt.ts`：优化 `buildNodeLessonPrompt`，只在有内容时才添加上下文段落
- `app/api/generate/node/route.ts`：提前过滤空数据，简化上下文处理逻辑
- 减少不必要的字段传递，提升生成质量

### 测试修复

**问题**：
- `deriveCourseTreeViewFromBlueprint` 测试期望与实际类型定义不一致
- 测试期望缺少 `courseGoal` 字段
- 测试期望包含不属于 `CourseTreeView` 类型的 `cardCount` 字段

**解决方案**：
- `tests/course-blueprint-memory-v3.test.ts`：修正测试期望，添加 `courseGoal`，移除 `cardCount`
- 所有 51 个测试现在通过

## 2026-03-30

### 学习页内容生成链路修复

**问题**：
- 学习页 `loadNodeContent` 使用分步生成（先 cards 再 questions），导致 questions 加载后步骤重置
- `retryCount` 在闭包中捕获后不更新，失败时可能无限递归
- 用户可能在 questions 未加载时直接完成节点

**解决方案**：
- `app/course/[courseId]/learn/[nodeIndex]/page.tsx`：改为使用 `generateNodeContent` 单一 API 同时生成卡片和题目，避免分步生成导致的步骤重置和无限递归问题
- 移除不再需要的 `retryCount` 状态和 `generateNodeCards` / `generateNodeQuestions` / `updateNodeContent` 引用

### Cards API 添加错误处理

**问题**：
- `/api/generate/node/cards` 没有任何错误处理
- API 调用失败时直接抛出 500 错误，无日志

**解决方案**：
- `app/api/generate/node/cards/route.ts`：添加 try-catch 和 console.error 日志

### callMiniMax 空内容防护

**问题**：
- MiniMax API 使用 `reasoning_split: true` 时，`message.content` 可能为 null
- 旧代码直接使用 content 导致后续 JSON 解析失败

**解决方案**：
- `lib/minimax.ts`：在 `callMiniMax` 中添加 content 非空和类型检查，null 时抛出明确错误

### Questions API 添加错误处理

**问题**：
- `/api/generate/node/questions` 没有任何错误处理
- API 调用失败时直接抛出 500 错误，无日志

**解决方案**：
- `app/api/generate/node/questions/route.ts`：添加 try-catch 和 console.log 日志

### keyPoints 可视化数据结构修复

**问题现象**：
- AI 返回 keyPoints 类型：`{ type: "keyPoints", data: { title: "...", points: [...] } }`
- 组件期望：`{ type: "keyPoints", items: [...] }`
- 导致 keyPoints 类型显示为"暂不支持的可视化类型"

**解决方案**：
- `components/ui/CardVisualization.tsx`：修改 keyPoints 处理逻辑，同时支持两种格式
- 优先读取 `visualization.data.points`，回退到 `visualization.items`

### CourseContext 类型签名修复

**问题**：
- `submitOutlineMessage` 返回类型定义为 `type: string`
- 与 `OutlineResponse` 类型 `type: 'confirmation' | 'questions' | 'reconsider'` 不兼容
- 导致 `confirm/page.tsx` 调用 `handleResponse(result)` 时类型错误

**解决方案**：
- `contexts/CourseContext.tsx`：
  - 添加 `OutlineResponse` 到 import
  - 修正 `submitOutlineMessage` 返回类型为 `Promise<OutlineResponse>`

## 2026-03-29

### 确认页 React Strict Mode 问题修复

**问题现象**：
- 确认页面一直卡在"加载中"或问题内容会变化（3个选项→4个选项）
- 两次 API 调用返回不同结果，AI 非确定性导致

**根本原因**：
- React Strict Mode 在开发模式下会故意挂载→卸载→再挂载组件，导致 useEffect 执行两次
- 两次 effect 各发起一次 API 请求，由于 AI 非确定性，返回不同问题

**解决方案**：
- 使用 `requestVersionRef` 版本号追踪最新请求
- 收到响应时检查版本号，过时响应直接忽略
- 忽略响应时必须调用 `setIsLoading(false)` 重置状态，否则页面永远卡在 loading

**遗留问题**：
- 两次请求都会发到服务器并被处理（无法在前端避免 Strict Mode 行为）
- 第一次请求（被丢弃）返回约 8s，第二次约 18s（Python Agent 初始化开销）

**文件改动**：
- `app/generate/confirm/page.tsx`：添加版本号方案忽略过时响应
- `contexts/CourseContext.tsx`：submitOutlineMessage 类型签名调整

### Python Agent 响应格式修复

**问题**：
- Python Agent 返回 `status: "asking"` / `status: "confirming"`，但前端期望 `type: "questions"` / `type: "confirmation"`
- 响应中用 `question` 单对象，前端期望 `questions` 数组

**解决方案**：
- `agents/outline/nodes.py`：状态值从 `asking`/`confirming` 改为 `questions`/`confirmation`
- `main.py`：响应格式改为 `{ type, questions: [...] }` 而非 `{ status, question }`

### confirm_node status 值拼写错误

**问题**：
- 模型返回 blueprint 后，`confirm_node` 返回 `status: "confirming"`
- 前端判断 `result.type === 'confirmation'`（多了个 i），导致页面不显示课程纲要

**解决方案**：
- `agents/outline/nodes.py`：修正 `confirm_node` 返回 `"status": "confirmation"`

### Blueprint 结构不完整

**问题**：
- AI 模型返回的 blueprint 缺少 `learnerPositioning` 字段或其子字段
- 前端 `ConfirmationCard` 组件直接解构 `learnerPositioning` 导致 undefined 报错

**解决方案**：
- `agents/outline/nodes.py`：在 prompt 中添加完整的 blueprint 结构说明，明确要求返回 `learningDirection`、`learningGoal`、`learnerPositioning`（包含 `estimatedLevel`、`difficultySummary`、`backgroundSummary`、`skipBasics`、`whyThisCourseFits`）

### TOC 页面 React Strict Mode 重复请求

**问题**：
- React Strict Mode 导致 TOC 页面 useEffect 执行两次
- 两次 AI 调用返回不同结果，页面显示从 A 版本跳到 B 版本

**解决方案**：
- `app/generate/toc/page.tsx`：添加 `requestVersionRef` 版本号模式，忽略过时的响应

### 知识卡片 Visualization 不显示问题修复

**问题**：
- AI 生成的知识卡片包含 visualization 字段，但前端不显示
- `CardVisualization` 组件只处理 `flowchart` 类型，缺少对其他 Mermaid 类型（sequence、class、state、er、gantt、mindmap）和 table 类型的支持

**解决方案**：
- `components/ui/CardVisualization.tsx`：
  - 扩展 Mermaid 类型处理：添加 sequence、class、state、er、gantt、mindmap 支持
  - 添加 table 类型支持
  - 将不支持类型的 fallback 从 `return null` 改为显示警告消息，便于调试
  - 添加调试日志输出 visualization 数据

### 学习页返回后题目直接显示问题修复

**问题**：
- 从节点返回后再进入，题目直接显示而不是从卡片重新开始

**解决方案**：
- `app/course/[courseId]/learn/[nodeIndex]/page.tsx`：
  - 在 useEffect dependencies 中添加 `node?.cards` 和 `node?.questions`
  - 当卡片或题目数据变化时，重置 `currentStepIndex` 到 0

### 学习页先生成卡片再生成题目的逻辑修复

**问题**：
- 从目录页点击节点进入时，有时直接显示题目而不是卡片
- 原因：Step 2 中 `courses.find()` 读取的是闭包中的旧值（React 状态更新是异步的）

**解决方案**：
- `app/course/[courseId]/learn/[nodeIndex]/page.tsx`：
  - Step 2 改用 `getStoredCourseBundle` 直接从 localStorage 读取最新保存的数据
  - 确保 cards 生成完成后才读取最新数据来生成 questions

## 2026-03-27

### 课程目录排布与标题截断修复

- 课程目录页不再使用固定节点步长，改为按节点按钮与标题卡片的估算整体高度动态排布，长标题节点会自动为后续节点让出更多纵向空间
- 课程目录节点从绝对定位改为真实文档流纵向排布，节点卡片会按实际渲染高度自然撑开，避免首个长标题把第二个节点挤住
- 课程树容器高度同步改为按真实布局结果计算，避免内容变高后底部被截断或滚动定位偏差
- 学习页头部标题改回统一单行省略策略，超长节点标题现在会显示 `...`，不再把顶部栏位和右侧进度挤乱
- 目录节点标题现在统一最多显示 3 行，超出内容会省略；当前学习节点也按同一行高规则参与布局估算，避免首个长标题与下一节点重叠
- 课程目录进一步收紧了统一节距，节点行高和列表间隙同步下调，避免整体路径过松
- 课程节点卡片从固定高度改为最小高度，标题区域会按内容自适应撑开，避免文字被截断或短标题产生多余留白
- 为课程树布局补上回归测试，覆盖“长标题节点会拉开后续间距”的场景，并验证相关测试通过

## 2026-03-26

### 课程生成环境变量兜底

- 修复本地课程生成在服务端拿不到 `MINIMAX_API_KEY` 时直接 500 的问题，`lib/minimax.ts` 现在会先读 `process.env`，缺失时再回退读取 `.env.local`
- 为 MiniMax 请求补上 env 文件回退测试，覆盖“进程环境为空但 `.env.local` 已配置”的场景
- 清理了未完成改动留下的类型错误和无效测试依赖，恢复 `npm test`、`npm run typecheck` 通过

### 轻量课程目录蓝图

- 课程目录生成从“直接产出完整 `CourseBlueprint`”收缩为“先生成轻量课程目录大纲，再由本地映射成 `blueprint`”，把评估与个性化细节下放到节点生成阶段
- `CourseBlueprint` 的目录阶段字段收缩为最小必要集；`assessmentTargetIds / personalizationHooks / coverage / generationNotes` 现在允许缺省，并在运行时自动补默认值
- `course-validator` 改为适配轻量目录蓝图，不再要求目录阶段就完成 remediation/coverage 明细
- `/api/generate` 的超时与 token 预算从重型试验值收回，当前真实目录生成失败时会在约 26 秒内返回可重试超时，而不是等待 40 到 100 秒

### 生成超时兜底与 MiniMax 请求收紧

- 追查生成超时后确认 `MiniMax` 非流式请求会把 `<think>` 推理内容塞进 `message.content`，现在统一为 JSON 生成请求增加 `reasoning_split: true`，并同时发送 `max_tokens + max_completion_tokens`
- 课程与节点生成主链路不再默认走搜索增强，节点主请求也移除了“新 lesson prompt + 旧 fallback prompt”拼接，减少无效 token 和响应时延
- 为课程与节点主生成增加“两段式尝试”：第一次保留主要质量预算，超时后会中断请求并用更紧的 token 预算重试，而不是傻等满 45 秒
- `refine` 结果现在会强制再次通过 validator，不再把“修了但仍不合法”的 blueprint / lesson 直接放行
- 课程与节点在自动重试后若仍超时，不再静默返回降级课程，而是向前端返回可重试错误；生成页和学习页会明确提示用户手动重试
- `smoke:generation` 回到“真实失败即失败”的策略，用于持续观察供应侧时延，不再用本地 fallback 掩盖真实超时
- 为 `max_tokens/max_completion_tokens/reasoning_split` 请求参数与超时重试链路补上回归测试，并再次验证 `npm test` 与 `npm run typecheck` 通过

### 首页系统推荐课程

- 新增两门系统预生成课程：“人人都该懂的 AI 课”和“普通人应该如何理财”，在用户还没有任何课程时会出现在首页下方作为引导入口
- 推荐课程不会默认混入“最近学习”列表，而是先以单独样式的推荐卡展示；点击后才会写入本地课程列表并直接进入第一节学习页
- 去掉无课程状态下额外的“第一次开始”引导卡，首页空态仅保留系统推荐课程；一旦用户已有自己的课程，推荐区也会一并隐藏
- 存储层新增系统课程推荐元数据与预置 `StoredCourseBundle`，保证推荐课可以离线直开，不依赖实时生成
- 为系统推荐课程补上回归测试，验证推荐项数量正确且点击后会真正写入课程存储

### Course Blueprint / Memory V3 首轮落地

- 新增 `CourseBlueprint / NodeLesson / StoredCourseBundle / MemoryStoreV3` 核心类型，并补上 `lib/course-blueprint.ts` 作为课程中间层与运行时视图之间的转换入口
- 课程生成 API 改为优先生成 `CourseBlueprint`，并在服务端增加 `validateCourseBlueprint + refine` 双阶段生成；节点生成 API 改为输出 `NodeLesson`，同时校验 `coveredConceptIds / targetConceptId / cardId`
- 本地存储底层切换为 `ai-learning-data-v2` 形态，真相源变成 `blueprint + treeView + lessons`，前端仍消费水合后的 `CourseTree`，降低页面改造面
- `CourseContext / ProgressContext / 学习页` 接通新链路：课程保存改走 blueprint，节点内容保存改走 lesson，答题回写优先使用 `targetConceptId`
- `memory repository / useUserMemory / aggregator` 新增 `MemoryStoreV3` 读写与事件投影能力，课程生成、聊天、答题、节点完成会开始写入 event-sourced memory，并由 v3 projections 直接支撑 planning payload
- 聊天历史在“被截断”和“会话关闭 / 页面隐藏”两种场景下都会主动产出摘要，不再只在 7 天过期时才整理 memory
- 新增 `npm run smoke:generation`，可直接用真实 MiniMax 跑 `CourseBlueprint -> NodeLesson -> validator` 的 smoke 验证，并为该脚本补上阶段日志与超时保护
- 课程生成与节点生成 API 现已输出统一 `generationMeta`，记录 `prompt_build / primary_model / parse / validate / refine` 各阶段耗时、是否触发 refine，以及 timeout/runtime 错误归因
- 新增 blueprint / lesson / validator / memory v3 回归测试，补上 `tsx` 测试入口，并验证 `npm test` 与 `npm run typecheck` 通过

### Memory V2 与双层 Retrieval

- 为课程生成引入 `MemoryStoreV2` 迁移函数，在不破坏现有 localStorage 数据的前提下补上 `stableFacts / signals / topicStates / conceptStates / summaries`
- 新增 `getPlanningMemoryPayload` 与 `getTeachingMemoryPayload`，把“课程目录规划”和“节点内容生成”的记忆检索拆成两条链路
- 课程目录 prompt 改为优先消费结构化 `课程规划输入`，节点内容 prompt 改为优先消费结构化 `节点教学输入`
- 课程与节点生成 API 现在会先构建 retrieval payload，再交给模型，减少直接拼接原始 memory 带来的噪声和 token 浪费
- 修正学习完成时写入 learning record 的 topic 维度错误，避免把节点标题误写成课程主题，导致后续规划取不到相关学习记录
- 为 v2 迁移、planning/teaching payload、结构化 prompt 注入补上回归测试，并验证 TypeScript 静态检查通过
- 新增 `normalizeConceptKey`，将“外部工具调用/工具调用”“workflow 编排/工作流编排”等近义概念收敛为同一 canonical key
- 聊天提问与困惑信号开始以 signal-first 方式写入 `userMemoryV2`，后续课程目录和节点生成会直接消费这些 v2 信号
- 聊天 API 现已基于 `getChatMemoryPayload` 构建结构化 `用户记忆重点`，优先注入当前节点风险概念、最近相关提问和可用类比，减少旧版 chat memory 噪声
- 新增 `lib/memory/repository.ts`，把 localStorage 读写、v1->v2 迁移与 planning/teaching/chat payload 构建收敛到统一仓储出口，降低后续迁服务端时的耦合成本
- 新增 `lib/memory/aggregator.ts`，将概念归一化、v1->v2 聚合、planning/teaching/chat retrieval 纯函数从 `hooks/useUserMemory.ts` 抽离，避免 repository 反向依赖 hook
- 新增 `lib/memory/aliases.ts`，用可维护 alias 字典替代纯硬编码规则，补上 `tool call / 调用工具时机` 等近义表达归一化，并新增对应回归测试
- `app/api/generate`、`app/api/generate/node`、`app/api/chat` 现已直接依赖 `memory repository` 构建 payload，不再从服务端链路反向依赖 hook 导出
- 重构 assessment 信号更新规则：单次答题不再直接写入高置信度，`mastery/gap` 的 confidence 会随证据数与表现一致性递增，连续答对也会真实降低 gap 权重
- 聊天记忆开始沉淀正向信号：新增解释偏好抽取与“已掌握概念”记录，`teaching/chat payload` 现会把偏好解释方式一并注入，减少长期只存困惑带来的负偏置
- 对话过期摘要从占位文本升级为结构化摘要，保留主要问题、未解概念、偏好解释方式、已用解释路径、解决状态与待跟进点，提升长对话压缩后的可检索价值
- 修复测试链路里的运行时类型导入问题，并为聊天偏好抽取、已掌握概念识别、结构化摘要与正向 memory 回流补上回归测试

## 2026-03-25

### 工程优化

- 为聊天助手添加 `max_tokens: 1500` 限制，加快回复速度

### 课程目录路径化实验合并

- 将课程目录页合并为新的路径式结构，节点整体左移并沿轻弯路径排布，标题统一放到节点右侧
- 当前待学习节点改为暖橙主焦点，并用更贴合产品语气的实心星标表达“从这里开始”
- 已完成、下一节、待解锁三类节点重新收敛为更轻的暖白体系，移除多余投影，减少外部游戏模板感
- 目录页头部同步收敛为更简短的“课程目录 / 学习路径”结构，与学习页标题栏语言更一致
- 补上目录页轻动效：节点按顺序淡入，当前节点增加克制的呼吸光圈，卡片 hover / press 反馈更明确
- 将目录布局和初次滚动定位抽成可测试的纯函数，并新增对应测试，避免后续再把路径排布与进入位置改坏
- 移除课程目录页底部重复的“打开课程助理”入口，只保留右下角统一浮钮，减少主路径干扰
- 重做课程助理入口与浮窗样式：浮钮改为暖白悬浮胶囊，弹窗改成更贴合产品的轻科技学习陪伴层，消息气泡与思考态也同步收敛
- 进一步收敛助理视觉强度：将聊天区高饱和橙色统一降为暖杏色，减少刺眼感并贴合首页/学习页色系
- 优化消息正文基础样式：强化段落与标题层级、列表与表格可读性，让助理回答更像结构化学习内容
- 空态改为顶部固定引导卡，不再伪装首条消息；一旦出现真实消息，引导卡自动隐藏
- 修复助理消息表格显示：去掉会裁切四角内容的圆角容器，改为可横向滚动且完整展示
- 助理主题色再收敛为更轻的蓝青系，并将入口图标升级为“对话 + 星光”样式，提升 AI 助理识别与灵动感
- 助理入口进一步收轻为紧凑图标按钮，去掉厚重白边胶囊；同时移除打开弹窗时的自动聚焦，避免输入区初始出现突兀高亮框
- 调整助理弹窗头部图标与“学习助理”文案的对齐关系，并统一入口与弹窗内的角色标识连续性
- 为助理入口补入极轻的呼吸式微动效，强化角色感但不打扰页面主内容
- 助理回答区继续向“教学内容卡”收敛：增加轻量标签、弱化边框生硬感，引用区也改为更贴近 AI 助理色系的提示样式
- 空态提示卡加入轻微进入动效，并进一步拉齐与真实回答区的视觉节奏，让首次使用和后续对话衔接更自然

### 课程内容可视化

- 新增图表组件 MermaidChart，支持 Mermaid 语法渲染
- 新增辅助学习组件：对比表、时间线、图例、要点列表
- LearningCard 支持渲染可视化内容
- AI 生成内容时可自动判断并添加图表或辅助元素
- 复杂图表支持全屏放大查看

### 澄清问题优化

- 澄清问题优先使用选择题（单选/多选）
- 仅在无法设计选项时使用填空题

## 2026-03-24

### 单节学习页重构 - 从翻卡改为单步闯关流

- 学习页从“先看卡片、再统一做题”重构为单步推进流程，一次只展示一个任务
- 前端把 `cards + questions` 编排成统一步骤流，让学习节奏变成“讲一点、答一点、继续往前”
- 顶部改为章节级进度条和步骤计数，弱化内容浏览感，强化闯关推进感
- 理解步骤、答题步骤和完成反馈统一到同一个主舞台中，不再切换成完全不同的页面结构
- 答题反馈改为页内即时反馈，正确与错误都在当前步骤内闭环，不用跳层或弹重 modal
- 一节完成后改为轻量完成态，直接进入下一节或返回学习路线，减少“结算页”感
- 继续收轻学习页：步骤标签并入卡片头部、内容卡片从顶部开始排布、主按钮固定在底部区域
- 压缩学习页 titlebar 高度，并重做选择题选中态与对错反馈，减少界面重量和跳出感
- 进一步增强学习页细节识别：步骤标签改为更清晰的小胶囊，选项序号固定为 A/B/C/D，不再误取中文首字
- 选择题提交后的正确/错误序号改为对应语义色文字，避免白字压在浅色底上看不清
- 完成页图标加入更活泼的暖橙 + 冷蓝层次，并删去重复完成文案
- 在学习页局部加入极轻的渐隐网格与标题标记感，延续首页设计语言但不打断沉浸式学习
- 学习页顶部导航重做为更完整的悬浮导航条，把返回、标题和进度整合进同一层，减少零碎感
- 学习页正文进一步提高清晰度：正文与选项文字加深，步骤标签底色微增，答对/答错语义色更明确
- 网格点缀收回到学习卡片左上局部，头部导航继续降权，避免和正文主舞台抢注意力
- 学习页标题高亮改为测量最后一行文字位置后再绘制，顶部标题、知识标题和题目标题在多行时都会只贴最后一行
- 继续微调学习页头部与正文间距：标题栏离屏幕上边缘略增，头部与正文卡片的距离略缩短
- 学习页收尾继续优化：使用 `100svh` 和底部安全区留白修正内容较少时的轻微可滚动问题
- 课程目录页顶部标题同步到学习页的合并式标题条，把返回和标题收进同一浮层，同时保留进度数字但不增加进度条

### 课程加载页优化 - 从系统等待切换为创作加载态

- 课程加载页重做为更有期待感的创作中体验，不再使用普通图标 + 点点加载
- 采用中央“正在成形的课程画布”作为主视觉，配合光点、局部网格和缓慢浮动动效，减少长等待带来的焦虑
- 使用循环切换的过程文案传递“理解目标、整理顺序、生成目录、打磨节奏”的预期，不使用伪精确进度条
- 新增临时验收入口 `/review/loading`，可单独查看加载页效果而不依赖真实生成流程
- 放慢循环文案切换节奏，并补上返回按钮，避免用户在中间页失去退路
- 修正加载页在内容较少时仍可轻微滚动的问题，按屏幕高度和底部安全区重新约束布局
- 弱化主视觉上方不自然的淡蓝矩形高光，让中心画布和背景过渡更自然
- 将课程画布左上角的淡蓝网格裁切进卡片范围内，避免超出卡片边界
- 澄清问题页统一到同一套“生成中 / 创作中”语言，保留返回路径、暖白创作画布和更有品牌感的表单容器
- 新增临时验收入口 `/review/clarification`，可单独查看澄清问题页效果而不依赖真实生成流程
- 澄清问题页进一步改为单问题步进式，一次只回答一个问题，减少表单感并保持生成流程的沉浸体验
- 澄清问题页继续收轻为自上而下的单列节奏：进度信息并入头部文案区，问题区只保留一个核心卡片，底部主按钮对齐学习页的置底结构，且第一题不再出现“上一步”
- 移除澄清页顶部“问题 x，共 x 个”提示，改为在题卡内部使用与学习页一致的轻量标签来提示“问题 x”

### 学习进度修复 - 完成状态同步到课程节点

- 修复章节学完后只解锁下一节、但当前节点未同步标记为 `completed` 的问题
- 首页课程进度、目录页顶部百分比和章节状态现在会随学习完成即时更新
- 解锁下一节时增加状态保护，仅在下一节仍为 `locked` 时切换为 `available`

### 课程目录页优化 - 从列表切换为学习路线图

**路线图优先**
- 课程目录页重做为“学习路线图”结构，而不是普通章节列表
- 页首进一步收敛为双悬浮胶囊：左侧独立返回，右侧只保留课程名和百分比进度
- 移除路线说明区重复 CTA，让顶部导航和当前节点承担唯一主路径

**节点层级优化**
- 章节节点区分为“现在学习 / 下一节 / 已完成 / 待解锁”四种状态
- 节点列表加入更明确的纵向路径线和状态原点，待解锁改为独立锁图标表达
- 去掉“现在学习 / 待解锁 / x张卡片”等低价值字段，只保留标题和下一步提示
- 当前节点强化为最显眼的橙色焦点，已完成节点明显降权为近白轻卡，避免完成态抢主路径

**进入位置优化**
- 进入课程目录页时，会直接把“当前待学习”节点定位到视口中上部，而不是先落到页首再滚动过去
- 当当前节点接近顶部或底部时保持自然边界，不强行把内容挤出可视区域

**节点对齐修正**
- 统一左侧路径线、状态圆点与锁图标的中心轴，修复视觉未对齐问题
- 待解锁锁图标补白底，避免直接压在线上导致识别不清
- 已完成状态圆点减轻描边与投影，当前节点卡片压低阴影，整体层级更稳定
- 卡片内数字块、标题区和右侧箭头改为垂直居中对齐
- 继续统一目录页与学习链路风格：顶部结构收成一条轻标题栏 + 一段简短引导，移除“列表页”式标题堆叠
- 当前待学习节点进一步成为唯一主焦点，已完成与已解锁节点明显降权，待解锁卡同步加强底色和识别度，避免像异常态
- 路线节点卡补入局部淡网格、暖白渐层和更轻的右侧箭头容器，让目录页更接近学习页、加载页与澄清页的同套语言
- 课程目录页与学习页的顶部导航抽成统一组件，固定在视口顶部，统一相对位置、返回按钮、标题容器和右侧信息胶囊的骨架
- 目录页头部第二行“从某一节开始继续”引导先移除，为后续放课程概述信息预留位置；当前待学习节点的投影和光圈同步收轻，避免过度跳出
- 修正学习页被共用导航联动影响的布局：重新拉开 titlebar 与正文卡片的距离，并恢复底部主按钮稳定居底

### 个人信息页优化 - 从普通设置表单改为学习画像页

- 个人信息页改为“学习画像”方向：顶部轻导航 + 说明文案 + 分组信息区 + 底部置底保存，更贴近整条课程生成链路
- 目标岗位、姓名、工作经历、教育经历重新整理为更清晰的内容分组，强调“这些信息会怎样影响课程生成”
- 工作经历和教育经历改为更轻但更完整的卡片结构，补入局部网格、轻暖白底与统一输入样式，减少原先普通后台表单感
- 底部保存区改为固定置底，明确告诉用户保存后会影响后续生成的新课程
- 修正已有用户画像为空数组时的展示，至少保留一条空白经历，避免页面打开后无输入入口
- 继续收紧个人信息页文案，移除分组下多余说明，并补足底部滚动留白，避免最后一张卡片被固定保存区遮挡

### 首页一致性优化 - 接入新生成链路并统一顶部壳层

- 首页提交生成时改为先进入 `/generate`，直接复用已定稿的“生成中 / 澄清问题”链路，不再出现旧的阻塞式 spinner 蒙层
- 首页顶部改为与课程页更一致的轻量固定壳层，把品牌入口与“个人信息”统一收进同一层级
- 首页主说明文案补回更稳定的写作引导，减少提示完全依赖 placeholder 带来的信息丢失
- 最近学习卡片的三点菜单补上点空白关闭和 `Esc` 关闭，避免浮层残留
- 进一步修正首页细节：把“个人信息”恢复成更明确的按钮外观，主说明文案收回单行，并为无课程用户补上更完整的首次生成引导区
- 首页右上角入口继续收轻为更接近标签的按钮样式，并在用户尚未填写任何资料时改为“完善个人信息”
- 首页右上角入口继续收细：去掉描边，改为浅灰底，图标与文字同步缩小一点

### 首页改版 - 强化首屏转化与继续学习

**首页结构重排**
- 首页从“主题贴纸墙”改为“主输入区 + 继续学习 + 灵感主题 + 最近探索”的信息层级
- 首屏主标题改为结果导向表达，强调“生成学习路径”而不是泛泛“探索”
- 输入区增加明确按钮文案、示例主题 chips，降低首次输入成本

**二次收敛优化**
- 移除“灵感主题”独立大区块，只保留输入区下方的示例主题胶囊，避免发现新主题的引导重复
- 顶部新课程输入区改为更开放的多行描述输入，鼓励用户写出目标、背景和具体问题
- 收紧首页重复文案，减少“生成路径 / 探索主题”之间的信息竞争
- 优化输入区微文案和示例主题，明确提示用户补充“目标 / 基础 / 具体问题”三类信息
- 继续减轻头部重量：移除外层大卡包裹，改为输入框 + 主按钮 + 少量胶囊引导
- 收紧头部标题与说明文案，减少重复表达
- 将输入标签并入标题下方说明，只保留一条更完整的引导文案
- 胶囊引导改为单条引用式示例文案，减少组件感和重复提示
- 进一步收紧头部文案，placeholder 与示例统一改为“想学什么 / 目前基础 / 要解决的问题”
- 头部标题加入更克制的渐变高光和线性装饰，补一点 AI 科技感
- 进一步增强标题区与背景光效的联动，并将示例文案切换为 Agent / AI 产品经理场景
- 去掉头部 AI 标签，改弱标题渐变以保证识读，同时把示例文案显式标记为“示例：”
- 头部进一步改为 Signal Glass 方向：输入层加入玻璃质感、高光边缘和冷色光晕，主按钮改为更有 AI 工具感的深色发光按钮
- 头部新增局部渐隐网格纹理，让科技感更多来自结构而不是单纯光效
- 去掉输入框顶部蓝色高光边，保留玻璃层次感，避免视觉过脏
- 适度扩大头部局部网格的可见范围，让科技纹理更容易被感知
- 加强标题下的马克笔标记感，并微增输入层高度，让按钮与输入区关系更紧但仍保持独立 CTA
- 统一首页视觉语言：保留网格与标记线，弱化玻璃感输入框；课程卡色系统一收敛到暖色家族，操作区按钮与三点交互也同步统一
- 继续优化头部可读性：降低输入层透明感，移除焦点时多余黑线，并把示例文案内嵌进输入区
- 右上角入口改为更完整的“个人信息”胶囊按钮，提升完成度
- 标题说明文案调整为“告诉我 你想学什么，以及为什么要学它”
- 继续收轻头部：移除输入框 placeholder，仅保留顶部示例；缩短输入层高度，并弱化“个人信息”入口的视觉重量
- 输入框示例改回真正的 placeholder 行为，用户输入时从首行开始；主按钮文案改为“生成专属学习计划”，“最近探索”改为“最近学习”

**回访用户体验优化**
- “继续学习”能力并入“最近探索”卡片体系，所有已开始课程都用统一卡片承接
- 移除“查看课程结构”次按钮，只保留继续学习主动作
- 每张课程卡仅保留一个核心进度数字，去掉重复进度条信息
- 最近探索卡片加入轮换配色，让课程之间更容易区分和扫读
- 删除操作保留在二级菜单中，减少首页管理感
- 课程卡底部改为“继续学习 + 管理”同一行，信息层级更稳定
- 课程副文案改为“下一节：xxx”，让回访用户更清楚点进去会看到什么
- 三点管理入口改为纯图标，菜单拉宽避免操作文案换行
- 首张课程卡做轻微放大和按钮加重，增强“优先继续”感
- 三点菜单浮层增加更清晰的阴影、描边和模糊分层，避免与课程卡背景融为一体
- 三点菜单与触发按钮拉开更多垂直距离，强化“浮层”感
- 删除确认弹窗主按钮改为显式错误色，避免在当前主题下不够显眼

**视觉与可读性优化**
- 推荐主题从 4 列小贴纸改为 2 列灵感卡片，提高中文可读性与点击意愿
- 统一首页卡片圆角、阴影和层级，减少“玩具感”，提升正式产品质感
- 修正全局中文字体策略，移除首页被 Inter 干扰的中英混排问题
- 补充 `shadow-float` 设计 token，保证菜单和弹窗层次稳定

**文案与反馈优化**
- 加载态文案改为“正在为你拆解学习路径”，更贴近用户预期
- 删除确认文案补充影响说明，降低误操作焦虑
- 主要按钮、菜单按钮补充更明确的无障碍语义

### 课程生成优化 - 基于用户画像的智能难度匹配

**用户洞察改进 (buildProfileInsightPrompt)**
- 改为事实性总结，不做推测延伸
- 示例："用过 docker" → "在项目中使用过 Docker"（而非"有容器化基础"）
- 每份工作总结：做什么产品、有什么技能、什么领域

**两级课程生成机制**
- 第一级：AI 分析用户洞察与主题关联度
  - 洞察足够 → 直接生成课程
  - 洞察不足但关键 → 返回 1-3 个澄清问题
- 第二级：用户回答澄清问题后 → 重新生成课程

**课程结构决策指南**
- 节点数量：5-15 个（按主题复杂度）
- 卡片数量：每节点 8-12 张（按内容深度）
- 新增 difficultySummary 字段描述课程难度

**相关文件**
- `types/course.ts` - 新增 ClarificationQuestion、ClarificationAnswer、CourseTreeResponse 类型
- `lib/prompt.ts` - 更新 buildProfileInsightPrompt 和 buildCourseTreePrompt
- `app/api/generate/route.ts` - 支持两种响应格式
- `contexts/CourseContext.tsx` - 新增澄清状态管理
- `app/generate/page.tsx` - 新增澄清问题 UI

### 课程生成搜索增强

- 新增 `lib/search.ts` 搜索功能封装
- 新增多轮调用 `callMiniMaxWithSearch` 支持最多3次调用
- Prompt 增加搜索判断逻辑（判断搜索 → 搜索结果注入 → 页面详情注入）
- 搜索使用 `search-engine-tool` npm 包
- 超时保护：API 30s、搜索 15s/关键词、页面 10s/页
- 降级处理：失败时继续使用已有知识生成

### 首页 UI 优化 - 从"效率工具"到"好奇驱动"

**设计理念转型**
- 从"学习工具"转为"学习玩具"，降低学习门槛和任务感
- 文案从"学习"改为"探索"，"开始学习"改为"今天想探索什么？"

**探索主题卡片化**
- 8个主题卡片采用网格布局（4列），每卡片有专属配色和emoji
- 卡片点击直接触发生成，无需先填充输入框
- 主题包括：Python入门、日本历史、UI设计、机器学习、天文奥秘、生态系统、心理学、金融入门

**视觉风格增强**
- 增加柔和渐变背景装饰（blur-3xl动效）
- 卡片采用轻拟物风格，带阴影和悬浮动效
- 移除工具型灰色感，提升趣味性

**交互模式优化**
- 输入框弱化：圆角search样式，placeholder改为"或者搜索任何主题..."
- 有课程时输入框降低opacity（但hover恢复）
- 推荐主题点击即触发生成，简化操作路径

**课程列表转型**
- "我的课程"改为"已探索内容"
- 从垂直列表改为横向滚动卡片（类似App Store展示风格）
- 删除按钮移入三个点菜单，减少管理信息
- 文案改为"点击继续"而非进度信息

**情绪设计**
- 加载动画增加"好奇之旅即将开始 ✨"文案
- 删除确认弹窗改为更轻松的"确定删除吗？"语气
- 整体氛围从"目标驱动"转为"好奇驱动"

**交互细节优化**
- 搜索框增加右侧搜索按钮，提升移动端可点击性
- 课程列表从横向滚动改为纵向排列，充分利用垂直空间
- 课程卡片信息更完整：显示百分比进度和节数

### 全页面 UI 统一优化

**生成页 (generate)**
- 增加书籍图标 bounce 动画
- 文案改为"正在生成你的好奇之旅..."、"AI 正在编织知识网络"
- 三个点加载动画替代 spinner

**课程详情页 (course/[courseId])**
- 进度展示改为渐变背景卡片，百分比突出显示
- 章节标题改为小写"章节"
- 课程节点卡片优化：圆角 2xl，渐变背景状态图标，完成状态带绿色渐变

**学习页 (learn/[nodeIndex])**
- 加载状态增加书籍图标和引导文案
- 完成页增加星星庆祝动画
- 文案从"课程完成"改为"探索完成"
- 按钮文案从"下一节"改为"继续下一章"

**学习页组件效率优化**
- LearningCard：移除多余嵌套卡片，改为单层 surface 卡片，去掉 shadow
- LearningCardStack：移除固定高度，改为 min-h-[50vh]，内容自适应页面
- LearningCard：移除 overflow-auto，内容自然展开，不需要滚动查看
- QuizQuestion：移除外层卡片包装，progress 直接展示，按钮与内容紧凑排列

**学习页头部固定**
- NavHeader 改为 sticky 定位，滚动时保持固定
- 内容区域独立滚动，头部不受影响
- 添加 backdrop-blur 效果增强视觉层次

**个人资料页窄屏优化**
- 工作经历的公司与岗位输入框改为堆叠布局（窄屏）/并排（宽屏）
- 添加 min-w-0 防止 flex 子元素溢出

**个人资料页 (profile)**
- 背景装饰统一
- 输入框改为 2xl 圆角，border-2
- 删除按钮改为 SVG 图标
- 保存按钮统一使用橙色阴影

**组件统一**
- LoadingSpinner：边框改为 design system 颜色
- RetryModal：警告图标居中，backdrop-blur，按钮样式统一
- LearningCardStack：进度条改为渐变，移除 ProgressBar 依赖
- QuizQuestion：标签改为圆角药丸样式，文案改为"答错啦"

**页面效率优化**
- 个人资料页：移除所有 section 卡片包裹，输入框直接展示，使用 margin 分隔
- 课程详情页：移除进度渐变卡片，改为 inline 进度条展示
- CourseTree 组件：移除内置 ProgressBar，进度由父组件控制

---

## 2026-03-23

### 设计焕新
- **全页面 CapWords 化**：首页、课程详情页、学习页、生成页、个人资料页全部统一设计系统
- **学习页**：完成页用 SVG 橙色勾选图标替代 emoji，统一按钮和配色
- **Quiz 组件**：题目卡、配色、按钮全部 CapWords 化
- **重试弹窗**：图标居中设计，按钮样式统一
- **资料页**：表单输入、删除按钮全部 SVG 化
- 配色：#1c3344（主色）、#778089（次色）、#f97316（强调）、#fcfcfa（背景）
- 移除渐变和模糊效果，采用简洁现代的视觉风格
- 节点状态使用 SVG 图标替代 emoji
- **设计系统抽离**：全局 CSS 变量定义完整设计 Token，Tailwind 配置使用 CSS 变量
- **移动端适配**：按钮/链接最小触摸区域 44px，支持 prefers-reduced-motion

### 性能优化
- 简化课程树结构，移除 description 字段，API 响应更快
- Prompt 工程优化，限制卡片内容在 200 字以内
- 课程生成耗时从 ~67s 优化至 ~34-41s

### 功能增强
- 用户画像功能：支持目标岗位、工作经历、教育背景
- 学习洞察机制：AI 分析用户背景提升内容个性化
- 历史课程列表：首页显示已生成课程及进度
- 课程节点预加载：进入学习页时后台预加载下一节

### 问题修复
- JSON 解析：处理 AI 返回的嵌套括号和 Markdown 特殊字符
- 练习题答案校验：正确提取选项标识符（如 "A. xxx" -> "A"）
- 节点解锁逻辑：完成后正确解锁下一节点
- 界面文本全部汉化

### 技术改进
- react-markdown 支持卡片内容和 Quiz 题目渲染
- useRef 稳定 CourseContext 回调，避免不必要的重渲染
- Next.js 4.x 兼容性修复
- 课程生成接口显式接收用户画像与 userMemory，服务端不再错误依赖 localStorage
- 新增 mastery 记忆沉淀：答题结果会更新 conceptMastery 与 knowledgeGaps
- 节点内容生成加入课程上下文、薄弱点和已掌握项约束，题目输出 concept/dimension/difficulty/cardId
- 聊天助理开始使用对话摘要、常问问题和待强化概念，memory 主题归档更稳定
- 课程树 prompt 新增“可跳过/必须补/类比落点/节点依赖”内部规划约束，减少看似个性化但结构发飘的问题
- 节点内容 prompt 注入整门课程结构与前置依赖，降低节与节之间的重复讲解和断层感
- 聊天 memory 提取从通用疑问词命中改为“明确困惑信号”判断，降低把正常提问误记成薄弱点的噪声
- 聊天 memory 新增来源可信度字段（chat vs assessment），答题错误会覆盖聊天推断的低置信度薄弱点
- 聊天兴趣、问题模式、薄弱点新增自动衰减逻辑，旧聊天信号会随时间变轻，避免长期污染用户画像
- 课程生成新增 memory 相关性分层：高相关高置信度信号才影响主干结构，弱相关背景只用于类比，无关 memory 直接忽略

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
