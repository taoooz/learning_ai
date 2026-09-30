# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09-28 及更早）。

### AI 快速入口与文档回流机制
- 新增根 `README.md`（83 行）：当前架构、核心用户路径、模块地图、关键不变量和详细文档索引
- `AGENTS.md` 增加“架构文档回流”规则：契约变化必须同步 README，纯内部实现不强制更新
- 新增 `npm run docs:check`：检查 README 章节/行数、CHANGELOG 行数、AGENTS 回流规则和本地文档路径
- `npm test` 前置执行 `docs:check`，让文档过期直接影响回归结果

### 学习体验收尾与 Hook 继续拆分
- 修复体验问题：任务/答疑重试成功后，历史错误通知不再继续显示；原始 system_notice 仍保留在数据中用于恢复与审计
- 新增 `stream-item-presentation` 纯函数与 4 项测试锁定展示规则
- `next.config.ts` 增加 `allowedDevOrigins`，消除本地 127.0.0.1 ↔ localhost 开发警告
- `useChapterLearning` 继续拆出 Checkpoint（生成/判分/补救）、章节完成（Recap）、动态调度建议三个 Hook；1174 → 799 行

### 服务端删除、交接文档与热点文件拆分
- server 模式补齐课程删除：`LessonRepository.deleteCourse` → Next `DELETE /api/user/courses` → Python `DELETE /api/user/courses`，同时清理课程、章节 lesson 与 engagement 文件
- 新增产品功能交接包 `docs/architecture/2026-09-29-产品功能交接包.md`，按功能契约整理 V1 下线后的单一学习流
- 拆分 `useChapterLearning.ts`：纯状态机/reducer 抽到 `lib/learning-v2/chapter-learning-state.ts`，任务预取执行器抽到 `task-prefetch-runtime.ts`（1408 → 1174 行）
- 拆分 `python-agent/main.py`：用户数据 API 与 Learning V2 API 分别移入 `routers/user_data.py`、`routers/learning_v2.py`（910 → 425 行）
- 端到端实测：本地登录、系统课启动、章节计划与任务流、新建课程（outline → TOC → V2 课程页）均通过

### V1 学习流下线，课程统一走 V2（P0）
- 删除 V1 学习链路：`/learn/[nodeIndex]` 学习页、`/complete` 完成页、`CourseTree`、`/api/generate/node/*`、`ProgressContext`、`useCourseActions` 及 7 个 V1 专用组件
- Python Agent 删除 V1 端点 `agents/cards|questions/generate[_agent]` 及对应 service、prompt；保留 `/api/agents/toc/generate`（与 V2 共用）
- 系统推荐课程改为“大纲元数据 → `mapTocToBlueprintV2`”映射，启动即写 V2 容器，章节内容按需生成；删除 V1 预生成脚本与 `data/system-courses/`
- `/generate/toc` 不再双写 V1，也不再降级：蓝图校验或落盘失败直接提示失败，避免半写课程
- 旧课程不再兼容（beta 定位）：打开 V1 旧课程落到「找不到这门课程」，引导重新生成
- 新增 `lib/learning-v2/course-list.ts`（首页课程列表派生 + 删除课程时清理章节 key），首页/课程页/卡片组件改消费 V2 数据
- 清理 `lib/storage.ts` V1 导出（`getStoredData`/`activateSystemCourse`/`markNodeCompleted` 等）与 `node-validator`
- 测试：TS 296/296（新增 6 项 V1 下线集成测试）、Python 168/168、`tsc --noEmit` 通过、`next build` 通过

### 2026-09-20 ~ 09-28（压缩）
- 内容侧：V2 任务流接入搜索证据包；来源引用展示；内容配方（多块流式）+ diagram 块 + 响应式重讲；本章小结流式化且不再折叠
- 体验侧：学习流渐显与滚动优化、正文排版升级、错误卡片合并重试、章节树与输入窗视觉统一
- 修复：glm-5.3-flash 思考预算全面排查（各链路 max_tokens 上调，消除 EMPTY_CONTENT）
- P5.1：Hook 全面接入 `LessonRepository`，`NEXT_PUBLIC_LESSON_STORE=server` 可切服务端持久化；engagement 服务端环形上限
