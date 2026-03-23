# 项目迭代日志

## 2026-03-23

### 新功能

#### 1. 首页显示历史课程列表
**功能描述：** 用户已生成的课程显示在首页下方，方便快速进入继续学习。

**实现方案：**
1. 首页从 `useCourse()` 获取课程列表
2. 按时间倒序排列（最新在前）
3. 显示课程主题、完成进度
4. 当前课程标记"进行中"

**修改文件：** `app/page.tsx`

#### 2. 用户画像功能
**功能描述：** 用户可以维护个人简历和求职意向，生成课程时自动使用这些信息提升内容质量。

**数据结构：**
- `UserProfile`：包含目标岗位、工作经历、教育背景
- `WorkExperience`：公司、岗位、工作内容
- `Education`：学校、专业

**页面入口：**
- 首页右上角用户图标 → `/profile` 页面

**Prompt 增强：**
- 生成课程时拼接用户背景信息
- AI 会根据用户工作经历相关性调整课程深度
- 结合目标岗位需求设计内容侧重点

**修改文件：**
- `types/course.ts` - 新增 UserProfile 等类型
- `lib/storage.ts` - 新增 getUserProfile, saveUserProfile
- `contexts/UserProfileContext.tsx` - 新增用户画像 Context
- `app/profile/page.tsx` - 新增个人设置页面
- `app/page.tsx` - 首页添加入口
- `lib/prompt.ts` - 扩展 Prompt 支持用户背景
- `app/api/generate/route.ts` - API 集成用户画像

#### 3. 课程详情页添加返回首页按钮
**功能描述：** 用户在课程详情页可以方便地返回首页。

**修改文件：** `app/course/[courseId]/page.tsx`

#### 4. 用户画像洞察机制
**功能描述：** 从用户背景信息中自动提取学习洞察，用于提升课程内容的个性化程度。

**数据结构：**
- `LearningInsight`：包含知识背景（knowledgeBackground）、类比经历（analogyExperiences）、总结（summary）

**API 端点：**
- `POST /api/profile/insights` - 提取用户洞察

**实现方案：**
1. 用户保存个人信息后自动触发洞察提取
2. AI 分析用户工作经历和教育背景，生成个性化学习建议
3. 洞察结果与用户画像关联存储

**修改文件：**
- `types/course.ts` - 新增 LearningInsight 类型
- `app/api/profile/insights/route.ts` - 新增洞察提取 API
- `contexts/UserProfileContext.tsx` - 保存后自动提取洞察

#### 5. Prompt 工程优化
**功能描述：** 优化课程生成的 Prompt 质量标准，提升卡片和 Quiz 的内容质量。

**课程树生成 Prompt 增强：**
- 增加质量标准指导
- 要求结合用户洞察设计课程结构

**节点内容 Prompt 增强：**
- 新增"好卡片"质量标准：
  - 场景引入：具体使用场景
  - 清晰定义：明确概念解释
  - 避坑提示：常见错误提醒
  - 一句话总结：核心要点提炼

- 新增"好 Quiz"质量标准：
  - 考察维度：知识点覆盖
  - 难度等级：L1-L5 分级
  - 对应卡片：标注关联的 learningCard id

**Question 类型扩展：**
- 新增 `dimension` 字段：考察维度
- 新增 `difficulty` 字段：难度等级（L1-L5）
- 新增 `cardId` 字段：对应的 learningCard id

**修改文件：**
- `types/course.ts` - Question 接口新增字段
- `lib/prompt.ts` - 优化 Prompt 模板

---

### 问题修复

#### 3. 练习题答案校验逻辑修复
**问题描述：** 练习题没有正确校验用户答案，同一给的错误评价。

**根本原因：**
- AI 返回的答案是 `"A"`，但选项格式是 `"A. 1603年"`（带前缀）
- 原代码直接比较选项字符串和答案字符串，导致永远不匹配

**修复方案：**
- 新增 `extractAnswerKey()` 函数，从选项中提取答案标识符（如 `"A. xxx" -> "A"`）
- 新增 `checkIsCorrect()` 函数，正确处理单选、多选、填空题的答案校验

**修改文件：** `components/QuizQuestion.tsx`

#### 4. 界面文本英文改中文
**问题描述：** 产品面向中文用户，但界面中存在大量英文提示。

**修复方案：** 更新以下文件的用户可见文本为中文：

| 文件 | 修改内容 |
|------|---------|
| `app/page.tsx` | 错误提示、按钮文本、示例主题标签 |
| `app/course/[courseId]/page.tsx` | 加载提示、未找到课程、返回按钮 |
| `app/course/[courseId]/learn/[nodeIndex]/page.tsx` | 加载提示、返回按钮、完成页面文本 |
| `app/generate/page.tsx` | 加载提示文本 |
| `components/LearningCardStack.tsx` | 导航按钮文本 |
| `components/RetryModal.tsx` | 弹窗标题、按钮文本 |
| `components/ui/ProgressBar.tsx` | 进度标签 |
| `components/ui/LoadingSpinner.tsx` | 默认加载文本 |
| `components/CourseTree.tsx` | 课程节数文本 |
| `components/QuizQuestion.tsx` | 题目类型、按钮文本（之前已改） |

#### 5. 课程节点解锁逻辑修复
**问题描述：** 完成第一节课后，第二节仍然处于锁定状态。

**根本原因：**
- `markNodeCompleted()` 在 `storage.ts` 中确实会将下一个节点状态设为 `available`
- 但 `CourseContext` 的 state 没有同步更新，导致 UI 仍显示旧状态

**修复方案：**
1. 在 `ProgressContext` 中新增 `refreshProgress()` 函数
2. `markCompleted()` 时触发自定义事件 `node-completed`
3. `CourseContext` 监听该事件，从 localStorage 重新加载最新课程数据

**修改文件：**
- `contexts/ProgressContext.tsx` - 添加事件触发逻辑
- `contexts/CourseContext.tsx` - 监听事件刷新数据

### 其他改进

#### 课程内容预加载优化
**功能描述：** 用户进入某个节点学习时，后台自动预加载下一个节点的内容。

**实现方案：**
1. 在 `CourseContext` 中新增 `preloadNextNode()` 函数
2. 该函数使用 fire-and-forget 模式，不阻塞主流程
3. 在 `LearnPage` 进入时调用

**修改文件：**
- `contexts/CourseContext.tsx` - 添加 preloadNextNode 函数
- `app/course/[courseId]/learn/[nodeIndex]/page.tsx` - 调用预加载

#### JSON 解析优化
**问题描述：** MiniMax API 返回的内容可能包含 JSON 之外的多余文本，导致 `JSON.parse` 失败。

**修复方案：** 重写 `parseJSONResponse()` 函数，使用大括号深度计数来准确提取 JSON 对象，而非贪婪正则表达式。

**修改文件：** `lib/minimax.ts`

#### Next.js 警告修复
**问题描述：** 浏览器控制台出现 `scroll-behavior: smooth` 警告。

**修复方案：** 在 `app/layout.tsx` 的 html 元素上添加 `data-scroll-behavior="smooth"` 属性。

**修改文件：** `app/layout.tsx`

#### API 参数修正
**问题描述：** 课程内容生成 API 调用返回 400 错误。

**根本原因：** 前端传递了 `courseId`, `nodeIndex` 参数，但 API 实际需要 `topic`, `title`, `cardCount`。

**修复方案：** 更新 `CourseContext.tsx` 中的 `generateNodeContent()` 函数，传递正确的参数。

**修改文件：** `contexts/CourseContext.tsx`

### 技术细节

#### MiniMax API 集成
- **端点：** `https://api.minimaxi.com/v1/chat/completions`
- **模型：** `MiniMax-M2.7`
- **修复历史：** 初始使用错误端点 `/v1/text/chatcompletion_v2`，后根据官方文档修正

#### Tailwind CSS v4 兼容性
- **问题：** v4 版本使用 `@import "tailwindcss"` 而非 `@tailwind` 指令
- **修复：** 更新 `app/globals.css` 使用正确的导入语法

---

## 待优化项

1. [ ] 学习卡片翻转动画体验优化
2. [ ] 错误处理的用户提示优化
3. [ ] 离线支持（无网络时显示已缓存内容）
4. [ ] 移动端适配优化
