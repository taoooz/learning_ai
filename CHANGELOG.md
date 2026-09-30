# 项目迭代日志

> 详细历史见 `docs/archive/CHANGELOG-2026-09.md`（2026-09-29 及更早）。

### 设计规范对齐（2026-09-30）
- `design-system/MASTER.md` 与 `globals.css` 实际 token 对齐：正文色改为 #5C5C5C，圆角/阴影以 token 为准
- 新增 WCAG 对比度约束、reduced motion、焦点可见、触控区与交付前自检；登记到 docs 索引

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
