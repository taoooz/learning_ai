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
- **课程协议：** V1 节点学习流已下线；新课程只允许 V2 蓝图和章节学习流。

## 2. 核心用户路径

1. **登录：** `/login` 输入邀请码；cookie 鉴权由 `middleware.ts` 保护页面路由。
2. **创建课程：** `/generate/chat` 生成学习纲要 → `/generate/toc` 生成课程目录 → 前端映射为 `CourseBlueprintV2` 并落库。
3. **系统课程：** 首页点击系统推荐课程，由内置大纲元数据派生 V2 蓝图，章节内容按需生成。
4. **课程页：** `/course/{courseId}` 展示章节树、进度和当前可学章节。
5. **章节学习：** `/course/{courseId}/chapter/{chapterId}` 按需生成章节计划，再流式输出任务内容。
6. **学习互动：** 任务边界、流内提问、检查点判分、补救内容、计划补丁建议和章节总结。
7. **完成与恢复：** 章节完成后刷新课程树并解锁下一章；刷新页面后按章节真实状态恢复。

## 3. 模块地图

| 领域 | 主要入口 |
|---|---|
| 登录与鉴权 | `middleware.ts`, `app/api/auth`, `lib/auth.ts` |
| 课程创建 | `app/generate`, `app/api/agents/outline`, `app/api/generate/toc` |
| 系统课程 | `lib/data/system-courses.ts` |
| 课程容器与分发 | `lib/learning-v2/dispatch.ts`, `lib/learning-v2/blueprint-map.ts` |
| 首页课程列表 | `lib/learning-v2/course-list.ts`, `components/CourseCard.tsx` |
| 章节学习编排 | `hooks/learning-v2`, `lib/learning-v2/reducers.ts`, `lib/learning-v2/state-machine.ts` |
| 学习流 UI | `components/learning-v2`, `lib/learning-v2/stream-item-presentation.ts` |
| 存储抽象 | `lib/learning-v2/lesson-repository.ts` |
| 本地存储 | `lib/storage.ts`, `lib/learning-v2/storage.ts` |
| 服务端存储 | `app/api/user`, `python-agent/routers/user_data.py`, `python-agent/services/user_data_store.py` |
| Python 学习流 API | `python-agent/routers/learning_v2.py`, `python-agent/services` |
| 内容生成与校验 | `python-agent/prompts`, `python-agent/services` |
| 记忆与画像 | `lib/memory`, `app/profile` |
| 测试 | `tests`, `python-agent/tests` |

## 4. 关键不变量

1. 新课程不得写入 V1 `courses` 容器；首页和课程页只消费 `StoredDataV2.v2Courses`。
2. V2 蓝图校验失败、空目录或保存失败时必须显示错误，不得降级为半可用课程。
3. 章节解锁必须由章节真实完成状态派生，不能只信任课程树缓存。
4. server 模式创建课程时，服务端保存成功后才写本地镜像；保存失败不得静默当作成功。
5. 删除课程必须清理课程容器、章节学习流和参与信号，并走 `LessonRepository.deleteCourse`。
6. 任务/答疑错误通知在对应请求成功后从 UI 隐藏，但数据层保留原始 `system_notice` 用于恢复与审计。
7. 用户可见文本使用中文；API 错误应包含可理解的中文信息和可重试标记。
8. 密钥只放 `.env*`，不得进入源码或文档。

## 5. 详细文档索引

- [文档索引](docs/README.md)：先读这里，区分当前事实、长期规格、长期参考和历史材料。
- [产品功能交接包](docs/architecture/2026-09-29-产品功能交接包.md)：当前 V2 单一学习流的功能契约、数据契约和 API 契约；读代码前先读这份。
- [V2 项目综述](docs/architecture/v2_项目综述.md)：V2 目标架构、阶段边界和文档阅读顺序。
- [V2 课程生成逻辑](docs/architecture/v2_课程生成逻辑.md)：课程蓝图、章节计划和协议设计。
- [V2 用户画像维护逻辑](docs/architecture/v2_用户画像维护逻辑.md)：学习证据、画像状态和个性化数据边界。
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
cd python-agent && .venv/bin/python -m pytest tests/ -q
```

本地联调 Python Agent 时需要配置 `PYTHON_AGENT_URL` 和 `PYTHON_INTERNAL_TOKEN`，并确保 Next 与 Python 使用同一个服务间令牌。
