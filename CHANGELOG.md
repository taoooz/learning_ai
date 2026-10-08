# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09-29 及更早）。

### 设计规范对齐（2026-09-30）
- `design-system/MASTER.md` 与 `globals.css` 实际 token 对齐：正文色改为 #5C5C5C，圆角/阴影以 token 为准
- 新增 WCAG 对比度约束、reduced motion、焦点可见、触控区与交付前自检；登记到 docs 索引

### 交互内容块 Phase 1（2026-10-08）
- 新增 `interactive` 内容块类型与首批两个消费型组件：`parameter-demo`（改参数看结果，命名变量白名单公式求值）、`step-walkthrough`（分步演示）
- Python 侧：流式解析器支持 interactive 块，schema 校验 + 公式试算，任一失败整块降级为等价 markdown（不阻塞生成流）；前端新增 InteractiveBlockV2 渲染器与 `lib/interactive/formula` 求值器（未知组件降级渲染）
- Prompt：流程/机制类任务优先用分步演示模板，含数值参数关系用参数演示模板；交互结果不计入掌握度证据（Phase 2 再打通）
- 新增 Python 5 个 + Node 6 个单测；架构文档补充 InteractiveBlock 数据契约

### 课程内容文风规范（精简版，2026-10-08）
- 任务内容/流内答疑/章节小结 prompt 注入四条文风规则：篇幅随素材（禁止注水与假细节）、知识状态分层（定论/惯例/无定论）、禁提示性开场与翻案腔、按学习者问题推进
- 新增 `services/style_lint.py` 文风观测 lint（纯正则，零依赖）：挂到任务内容、答疑、小结生成完成路径，只记日志不拦截不重试；新增 4 个单测
- 速度影响：prompt 增加约 300 tokens/次（毫秒级 prefill），lint 微秒级；后续按命中率数据决定是否收紧
- 参考 Karpathy 的 ASD-STE100 受控英语建议（36kr 文章），补充两条规则：同一概念全篇同名（优先用课程统一术语表）、程序性步骤一句一操作

### 可读性与可访问性定点修复（2026-09-30）
- 错误通知改为 inline 横幅（左色条 + 浅底），提问输入框去掉径向渐变与毛玻璃，改为白底 + 边框 + 聚焦环
- 修复学习流中带透明度的颜色类（如 `bg-error/10`、`border-accent/45`）因颜色未进 Tailwind 主题而不生效的问题：检查点选中态、评估结果、关键点/示例/对比底色、错误横幅等改为显式色值
- 颜色注册进 Tailwind v4 `@theme`（`--color-*` 供背景/边框/渐变、`--text-color-*` 供文字），全站带透明度的颜色类恢复生效；手写实心工具类优先级不变，现有视觉零变化
- 学习页体验修复：头部毛玻璃胶囊保留原形态、透明度 80%→95%（消除滚动鬼影，保留玻璃感）；失败态只保留一个主重试操作、错误通知内改为文字链；恢复中途时显示“从这里继续”提示；任务标题加“第 X 步 · 共 Y 步”并加大字号与间距；移动端头部进度只留圆点给标题让位
- 错误色 `--color-error` 由 #EF476F 加深为 #C43A5B：文字与描边在白底/暖底上对比度 3.6:1 → 4.8:1
- 橙/黄/粉蓝底上的白字统一改为近黑 `text-primary`（对比度 2.4:1 → 7:1）；删除确认与错误 Toast 改为描边/浅底样式
- 修复键盘焦点环被全局清除的问题；新增 `MotionProvider` 全局尊重系统“减少动态效果”
- 零散 `rounded-[Npx]` 收敛到现有 12/16/24/32/9999 圆角 token；`MASTER.md` 文字色/圆角表与代码对齐

### 学习系统分层升级（2026-09-30）
- 新增 `CourseMission`：从 outline 派生 why / targetScenario / successCriteria / constraints / outOfScope，并贯穿 TOC、章节计划、任务内容与 Checkpoint prompt
- 章节计划新增确定性理解闸门：最后一个任务 `evidencePolicy=checkpoint`，服务端强制写入，TS 校验兜底；测题生成同时受课程使命与证据约束
- 章末收尾增加检查闸门：测题生成/作答/补救完成前禁用“完成本章”；检查生成失败写入可见通知且不永久锁死章节
- 新增课程级教学状态 `CourseTeachingState`：记录当前教学焦点、待用户反馈材料、可复用教学素材和课程内备注；章节完成后确定性更新并贯穿章节计划与任务内容 prompt
- 证据来源支持 `isPrimary` 主推来源；搜索结果优先官方域并按 knowledge/wisdom、权威分排序，来源卡突出“主推来源”
- 扩展官方域名覆盖：Meta、Vercel、Rust、Go、Java/Spring、Kubernetes/Docker、HuggingFace 等；社区来源默认标记 wisdom
- 补充中文权威域：`.gov.cn` 政府机构、`.edu.cn` 高校、`.cas.cn/.ac.cn` 科研机构、新华网/人民网、CNKI、阿里云/腾讯云/华为云官方文档；知乎、SegmentFault、V2EX、掘金、博客园、CSDN 等中文社区默认标记为经验参考
- 端到端实测通过：Mission 贯穿建课、任务流式输出、来源引用、章末检查、章节完成、课程速查卡、统一术语和 Memory 概念投影
- 新增 Checkpoint 证据到用户 Memory 的投影：`checkpoint_evaluated` 事件更新概念掌握、错误记录、误解提示和下次复习时间；覆盖不等于掌握
- 新增课程参考资料：章节完成后从 key_point / comparison / diagram 确定性提取速查卡，课程页可展开查看
- 新增课程统一术语表：从关键点卡提取 preferredTerm 与定义，课程页展示；后续任务 prompt 可复用
- 证据系统升级：来源支持 `evidenceId / kind(knowledge|wisdom) / useFor`；结构化内容块支持 `evidenceRefs`，来源卡区分“事实依据 / 经验参考”
- 存储兼容：`StoredCourseV2.references/glossary`、`CourseMission` 与块级 `evidenceRefs` 均为可选字段，旧课程可继续打开
- 回归：TS 309/309、Python 171/171、`tsc --noEmit` 通过；文档结构检查通过

### 2026-09-29（压缩）
- 新增当前架构速览、docs 分类索引和根 README 快速入口；`npm test` 前置 `docs:check`
- V1 学习流完整下线：新课程和系统课只写 V2；旧课程 beta 下不迁移
- server 模式补齐课程删除；课程、章节与 engagement 同步清理
- 学习流 Hook 与 Python main 持续拆分；错误通知在请求成功后从 UI 隐藏
- 端到端验证覆盖本地登录、系统课、新建课程、章节任务流、删除课程和 server 刷新恢复
