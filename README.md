# AI Learning

面向中文用户的 Duolingo 风格 AI 学习产品：用户输入学习诉求后，系统生成中文课程目录，再按章节流式学习，支持提问、检测、补救和总结。

这份 README 是给后续开发者和 AI Agent 的**快速入口**。这里只描述当前架构契约和模块地图；实现细节请按“详细文档索引”跳转，不要把本文当作完整设计文档。

## 1. 产品快照

- **用户：** 中文用户，界面与生成内容均为中文。
- **产品形态：** Web 应用，课程生成 + 章节学习流。
- **前端：** Next.js App Router、React、Tailwind CSS v4、Framer Motion。
- **后端：** Next API 作为 BFF 薄代理，转发到 Python FastAPI Agent；Python Agent 负责大纲、目录、任务内容、答疑、检查点、补救、总结等 LLM 编排。
- **LLM：** OpenAI 兼容接口，模型由 `LLM_MODEL` 控制。
- **存储：** `NEXT_PUBLIC_LESSON_STORE=local`（默认 localStorage）或 `server`（服务端文件存储 + 本地缓存兜底）。
- **课程协议：** V1 节点学习流已下线；新课程只允许当前课程蓝图和章节学习流。

## 2. 核心用户路径

1. **登录：** `/login` 输入邀请码；cookie 鉴权由 `middleware.ts` 保护页面路由。
2. **创建课程：** `/generate/chat` 在信息不足时一次批量澄清并统一提交，生成学习纲要与 `CourseMission` → `/generate/toc` 由 Course Architect 两阶段生成：先流式输出章节目录并逐章展示，再定向补全 `thesis`、`conceptGraph` 与 `examplePolicy` → 前端用 Blueprint Compiler 落库。
3. **系统课程：** 首页点击系统推荐课程，由内置大纲元数据派生课程蓝图，章节内容按需生成。
4. **课程页：** `/course/{courseId}` 展示章节树、进度、当前可学章节、课程速查卡和统一术语。
5. **章节学习：** `/course/{courseId}/chapter/{chapterId}` 按需生成章节计划，再流式输出任务内容。
6. **学习互动：** 任务边界、流内提问、章末检查点、补救内容、计划补丁建议和章节总结。
7. **完成与恢复：** 章节完成后刷新课程树并解锁下一章；刷新页面后按章节真实状态恢复。

## 3. 模块地图

| 领域 | 主要入口 |
|---|---|
| 登录与鉴权 | `middleware.ts`, `app/api/auth`, `lib/auth.ts` |
| 课程创建 | `app/generate`, `app/api/agents/outline`, `app/api/generate/toc`, `python-agent/services/course_architect_service.py`, `lib/learning-v2/blueprint-from-architecture.ts` |
| 系统课程 | `lib/data/system-courses.ts` |
| 课程容器与分发 | `lib/learning-v2/dispatch.ts`, `lib/learning-v2/blueprint-map.ts` |
| 首页课程列表 | `lib/learning-v2/course-list.ts`, `components/CourseCard.tsx` |
| 章节学习编排 | `hooks/learning-v2`, `lib/learning-v2/reducers.ts`, `lib/learning-v2/state-machine.ts` |
| 学习流 UI | `components/learning-v2`, `lib/learning-v2/stream-item-presentation.ts` |
| 课程参考资料 | `lib/learning-v2/reference.ts`, `components/learning-v2/CourseReferencePanel.tsx` |
| 课程教学状态 | `types/learning-v2/teaching-state.ts`, `lib/learning-v2/teaching-state.ts` |
| 存储抽象 | `lib/learning-v2/lesson-repository.ts`, `lib/learning-v2/latest-save-queue.ts` |
| 本地存储 | `lib/storage.ts`, `lib/learning-v2/storage.ts` |
| 服务端存储 | `app/api/user`, `python-agent/routers/user_data.py`, `python-agent/services/user_data_store.py` |
| Python 学习流 API | `python-agent/routers/learning_v2.py`, `python-agent/services` |
| 内容生成与校验 | `python-agent/prompts`, `python-agent/services` |
| Prompt 调试台 | `app/debug/course-pipeline`, `components/prompt-lab`, `python-agent/routers/prompt_lab.py`, `python-agent/services/prompt_lab_service.py` |
| 用户 Memory / 画像 | `types/memory-v4.ts`, `python-agent/services/memory_v4_store.py`, `python-agent/services/memory_context_v4.py`, `python-agent/services/memory_candidate_service.py`, `python-agent/services/memory_summary_service.py`, `python-agent/routers/memory_v4.py`, `app/api/user/memory`, `hooks/useUserMemory.ts`, `components/profile/MemoryPanel.tsx`, `components/ReviewQueueCard.tsx`, `app/profile` |
| 测试 | `tests`, `python-agent/tests`, `tests/e2e`, `playwright.config.ts` |

## 4. 关键不变量

1. 学习数据只持久化 `courses`、`userProfile`、`recommendations`；旧 V1 独立 `courses` 容器、`currentCourseId`、`courseProgress` 已删除，当前 `courses` 是唯一课程容器。localStorage key 仍保持 `ai-learning-data-v2`；读取时校验当前课程容器结构，旧树形或损坏课程直接忽略，不进入渲染链路。
2. `CourseBlueprint.mission` 必填且必须通过 `validateCourseBlueprint`；蓝图校验失败、空目录或保存失败时必须显示错误，不得降级为半可用课程。
3. 章节解锁必须由章节真实完成状态派生，不能只信任课程树缓存。
4. server 模式创建课程时，服务端保存成功后才写本地镜像；保存失败不得静默当作成功。
5. 删除课程必须清理课程容器、章节学习流和参与信号，并走 `LessonRepository.deleteCourse`。
6. 任务/答疑错误通知在对应请求成功后从 UI 隐藏，但数据层保留原始 `system_notice` 用于恢复与审计。
7. 用户可见文本使用中文；API 错误应包含可理解的中文信息和可重试标记。
8. 每章最后一个任务必须触发 Checkpoint；服务端从蓝图/章节容器反查范围，sealed definition 判分成功后才按服务端 attempt 顺序追加 Learning Evidence；客户端不得提交正确答案、topic、planVersion 或任务摘要。补救沿题链（previousCheckpointId）服务端封顶连续 2 轮，已达标（demonstrated）不得再请求补救。
9. 密钥只放 `.env*`，不得进入源码或文档。
10. 用户画像输入经服务端 Memory V4 ingestion 后，课程生成与聊天只读取场景 Resolver 选中的 V4 Memory；不保留 V3 Memory 兼容层。Chat Summary 与 Chapter Episode 只由服务端 transcript、lesson、Evidence、recap snapshot 生成；旧 `/api/memory/refine` 与 `/api/agents/memory/refine` 已删除，不得恢复双轨写入；localStorage 不迁移无账户后缀的旧 key。
11. server 模式 lesson 保存必须单写入器串行执行；写入在途时只合并为最新快照，不能让旧快照排队覆盖新状态。
12. Profile Memory 使用固定五维派生视图（方向、背景、偏好、教学策略、学习轨迹）；摘要通过 `sourceRecordIds` 与 `sourceRevision` 指向原子记录，不形成第二事实层。
13. Chat Agent API 只接受 `{ courseTopic, messages }` 结构化输入；不支持仅传 `messages` 的旧直连模式。
14. 课程起点不得把“缺少主题学习记录”直接当成零基础：`LearnerStartingPoint` 可带水平置信度、背景、可能缺口和例子策略；低置信度且存在可迁移背景时必须先校准。Course Architect 必须两阶段生成：第一阶段只流式输出 `courseTopic + chapters`，第二阶段固定章节并只补全 `thesis + conceptGraph + examplePolicy`；任一阶段失败只能做阶段内定向修复，不得重新生成完整课程。最终架构需通过确定性结构校验（章节数硬上限 12），LLM 架构审查仅在 auto 风险模式下按需触发，默认软门（修复一次后仍不通过则携带 reviewIssues 放行，`ARCHITECT_REVIEW_STRICT=1` 恢复硬门）；章节计划进入内容生成前按风险信号执行概念重复/过基础/过度拆分审查。
15. Prompt Lab 与正式业务完全隔离：只复用生产 Prompt Builder，编辑后的 Prompt 仅作为本次调试覆盖；不得写入课程、章节、Memory 或 engagement。课程生成 Prompt 必须拆成静态 system（角色、行为、协议）与动态 user（本轮诉求、画像、Memory、证据、上游产物）；Planning Memory 不暴露内部 record ID，模型需要细节时通过只读 `memory_search` 工具按需检索。Prompt Lab 内置按环节优化的助手，可主动对话、评测最近输出并生成可应用的 Prompt 改写。调试数据只存 `ai-learning-prompt-lab-v1`，生产默认关闭，显式设置 `ENABLE_PROMPT_DEBUGGER=1` 才会开放。

## 5. 详细文档索引

- [文档索引](docs/README.md)：先读这里，区分当前事实、长期规格、长期参考和历史材料。
- [当前架构速览](docs/architecture/当前架构速览.md)：当前工程事实、数据流、存储模式和模块状态；读代码前先读这份。
- [产品功能交接包](docs/architecture/2026-09-29-产品功能交接包.md)：当前 V2 单一学习流的功能契约、数据契约和 API 契约。
- [V2 项目综述](docs/architecture/v2_项目综述.md)：V2 目标架构、阶段边界和文档阅读顺序。
- [V2 课程生成逻辑](docs/architecture/v2_课程生成逻辑.md)：课程蓝图、章节计划和协议设计。
- [V2 用户画像维护逻辑](docs/architecture/v2_用户画像维护逻辑.md)：学习证据、画像状态和个性化数据边界。
- [Memory V4 架构](docs/architecture/memory-v4.md)：当前用户学习 Memory 的存储、证据、画像导入、场景披露和 API 契约。
- [课程质量提升计划](docs/reference/课程质量提升计划-对齐竞品.md)：内容质量目标与迭代方向。
- [开源方案调研](docs/reference/开源方案调研-课程内容丰富度.md)：内容丰富度竞品调研。
- [历史材料](docs/history/README.md)：历史设计、评审、记忆方案和 superpowers 计划。
- [历史更新日志](docs/archive/CHANGELOG-2026-09.md)：2026-09-28 及更早的归档记录。

判断当前行为时，优先级是：代码与产品功能交接包 > V2 长期规格 > reference 调研 > history/archive。

## 6. 开发与验证

常用命令：

```bash
npm run dev        # 启动 Next.js
npm test           # 文档结构检查 + TS 测试
npm run typecheck  # TypeScript 检查
npm run lint       # ESLint
npm run build      # 生产构建
npm run docs:check # 只检查 README / CHANGELOG / 文档引用
npm run test:e2e  # Playwright server 模式 E2E（需先安装浏览器）
npm run test:e2e:install # 首次/CI 安装 Chromium
cd python-agent && .venv/bin/python -m pytest tests/ -q
```

本地联调 Python Agent 时需要配置 `PYTHON_AGENT_URL` 和 `PYTHON_INTERNAL_TOKEN`，并确保 Next 与 Python 使用同一个服务间令牌。
