# evals：课程生成全链路 trace 与离线 runner

质量度量闭环的原料层：让课程生成全链路（蓝图 → 章节计划 → 任务正文）可离线
复跑，并采集**修复前原始输出**的逐阶段 trace，供质量归因使用。

## 组成

| 文件 | 职责 |
| --- | --- |
| `evals/trace.py` | trace 采集：`EVAL_TRACE_DIR` 开关 + 章/任务作用域 + 契约写盘（零依赖新增） |
| `evals/runner.py` | 离线 CLI：golden set → architect → chapter_plan → 抽样任务正文 → checkpoint |
| `evals/grounding.py` | 事实溯源：声明分解 → 证据归因；区分 no_retrieval / no_evidence，evidence_coverage |
| `evals/alignment.py` | 对齐审计：目标↔任务覆盖矩阵（plan 映射）+ 断裂编码 + judge 质量 |
| `evals/report.py` | 基线报告：五维分数 / 溯源 / 断裂 / 成本；新旧阶段命名兼容拼装 |

hook 点（最小侵入，逻辑零改动）：

- `lib/minimax.py`：`chat` 返回前、`stream_chat` 流结束/中断时捕获修复前 raw；
  `parse_json_response` / `parse_enforced_json` 记录 `repair_applied` 与修复步骤明细。
- `lib/minimax_agent.py`：`_call_llm` 返回前、`_do_streaming_call` 完整响应 yield 前捕获。
- 三个服务只加阶段标签（`eval_trace.stage(...)`）与证据/组装快照，不改生成逻辑。
- checkpoint 阶段由 **runner** 包 `eval_trace.stage("checkpoints")` 调用现有
  `services/checkpoint_service.generate_checkpoint`（服务本身不改、不加 hook）。

## trace 开关与契约

`EVAL_TRACE_DIR` **未设置 = 完全关闭**：所有采集函数空操作，无 I/O、无内容累积、
零行为变化。设置后写盘：

```
EVAL_TRACE_DIR/<run_id>/<spec_id>/
  spec.json                      归一化后的评测 spec
  stage_<name>_request.json      该阶段最后一次 LLM 调用请求体（白名单字段，无鉴权信息）
  stage_<name>_raw.txt           修复前原始模型输出（parse/修复链改动之前）
  stage_<name>_parsed.json       解析产物（JSON dict；任务正文为 blocks+boundaryPrompt）
  stage_<name>_meta.json         model / latency_ms / usage / repair_applied /
                                 repair_steps / fallback_level / call_count / scope / source …
  stage_<name>_calls.json        仅多次调用（工具轮/修复轮）时写入，按序保留全部调用，
                                 每条带 scope={chapter_id,task_id}（重试计数=同 scope 条数）
  evidence_snapshot.json         各阶段检索到的证据 pack 快照列表
  course.json                    最终组装：architecture + blueprint + 章节计划 + 任务内容块
                                 + checkpoints（每任务一道理解检查题）
EVAL_TRACE_DIR/<run_id>/run_meta.json   整次运行元信息（含逐 spec LLM 调用数 / checkpoints 开关）
```

阶段名（**章/任务作用域**，避免跨章同名任务互相覆盖）：

- 课程级（无作用域）：`architect_chapters`、`architect_meta`、`architect_review`。
- 章级：`chapter_plan_<chapterId>`、`chapter_plan_review_<chapterId>`、`checkpoints_<chapterId>`。
- 章+任务级：`search_decision_<chapterId>_<taskId>`、`task_content_<chapterId>_<taskId>`。

runner 用 `eval_trace.scope(chapter_id=…, task_id=…)` 传入作用域；`stage()` 与
`record_stage_parsed()` 都按当前 scope 展开名字。**无作用域时保持原名**
（`chapter_plan`、`task_content_<taskId>` 等），旧 trace（如 pilot-0）仍可读。

语义约定：

- **raw 先于修复**：捕获点在 LLM 响应返回处；`repair_applied=true` 表示解析链
  改动了原始文本，`repair_steps` 给出明细（`fence_strip` / `tool_xml_clean` /
  `thinking_strip` / `json_slice` / `quote_repair`）。
- **fallback_level**：捕获时请求的 `response_format`——`strict`（json_schema）/
  `json_object` / `none`。`none` 是流式正文与 search_decision 的正常形态（本就不要求
  结构化输出），**不算降级**；只有 `json_object` 代表从 strict 的真实降级。
  `response_format_initial` / `response_format_downgraded` 记录网关拒绝后的降级过程。
  report 成本统计按此归一化（兼容旧数字夹具）。
- 契约四件套取该阶段**最后一次**调用；最初原始输出与修复轮历史在 `_calls.json`。
- **scope**：meta 与 calls 每条都带 `{chapter_id, task_id}`；`call_count` 是该作用域内
  的调用数（重试计数），跨章同名任务各自独立成桶，不再互相覆盖。
- 任何写盘失败只记日志（`[eval-trace]`），绝不影响生成主流程；不记录 API key。

## runner 用法

```bash
cd python-agent

# 真实调用（读 .env 的 LLM_API_KEY/LLM_API_BASE/LLM_MODEL）
python -m evals.runner golden.json --run-id r1

# 常用开关
python -m evals.runner golden.json \
  --specs spec-01,spec-03 \   # 按 id 过滤
  --max-tasks 2 \             # 每章最多 2 个任务正文（默认，控成本）
  --max-chapters 3 \          # 每门课最多 3 章（0=全部）
  --no-search \               # 关闭全链路联网搜索（离线复跑/控成本）
  --no-checkpoints \          # 关闭 checkpoint 生成阶段（默认开启，每任务 +1 次调用）
  --trace-dir eval-traces \   # trace 根目录（默认 ./eval-traces）
  --env-file /path/to/.env \  # dotenv 文件（默认 python-agent/.env）
  --evidence-dir /path/dir    # 证据库（默认隔离到 <trace_dir>/<run_id>/_evidence）

# dry-run：不调 LLM，罐头输出走真实服务与真实 trace hook，验证装配
python -m evals.runner golden.json --dry-run --run-id smoke
```

golden set 宽松契约（JSON 列表，或 `{"specs": [...]}`）：

```json
[
  {
    "id": "spec-01",
    "topic": "Python 装饰器",
    "difficulty": "beginner",
    "learningGoal": "能独立写出带参数的装饰器",
    "learnerPositioning": {
      "estimatedLevel": "beginner",
      "backgroundSummary": "会基础语法，没写过装饰器",
      "skipBasics": [], "likelyGaps": ["闭包"], "levelConfidence": 0.8
    }
  },
  { "topic": "SQL 索引" }
]
```

`topic` 必需；其余缺省给默认（id 自动编号、learner 默认 beginner、
learningGoal 默认「完成 <topic> 的独立学习目标」）。

链路：`generate_course_architecture` → blueprint 编译
（`lib/learning-v2/blueprint-from-architecture.ts` 的确定性 Python 移植，
`course-architecture-compiler-v1`）→ 逐章 `generate_chapter_plan` →
每章按 order 抽样前 `--max-tasks` 个任务跑 `stream_task_events` →
每章为每个成功任务调 `generate_checkpoint`（`checkpoints_<chapterId>` 阶段）。
真实调用全部复用现有服务函数，不重写生成逻辑；单 spec 失败不中断整批
（course.json 记 `status=failed` 与 error）；单任务/单 checkpoint 失败记
`status=failed` 条目并把 spec 标 `partial`，失败阶段 raw/meta 仍保留可审计。

checkpoint 的 `objectiveId` 来自 `chapters[].plan.tasks` 映射（生成内容任务本身
只有 taskId/blocks，不带 objectiveId）；证据走 `get_chapter_evidence` +
`evidence_to_prompt`（只读，失败不阻塞，与 `routers/learning_v2.py` 同契约）。

成本参考（单 spec，2 章 × 2 任务，无修复轮）：architect 2 次 + 每章计划 1 次
+ 每任务搜索决策 1 次、正文 1 次 ≈ 12 次；**checkpoint 每任务 +1 次**（2×2=4 次）
≈ **16 次 LLM 调用**。`--no-checkpoints` 回到 12 次；审查/修复轮按需增加，
精确计数见 `run_meta.json` 的 `llmCalls`。

## 溯源与对齐语义（grounding / alignment）

- **no_retrieval ≠ no_evidence**：模型选 NO_SEARCH（`evidencePolicy=none`、
  snapshot pack 全 null）时内容纯靠参数化知识生成。此时全部声明记 `no_retrieval`，
  `grounding_rate=null`、flag `no_retrieval`，**不计溯源失败**；`no_evidence` 专指
  「有检索证据但不支持」。溯源率分母 = 可归因声明（total − no_retrieval）。
- **evidence_coverage**：有 ≥1 条 supported 声明的任务 / 有声明的任务（按
  (chapterId, taskId) 区分跨章同名任务）；无声明任务时为 null。
- **证据回退**：snapshot 无可用证据时，从 `stage_task_content_*` /
  `stage_search_decision*` 的 request/calls 快照 messages 里提取注入的证据段落
  （`evidence_source=request_fallback`），新旧命名都兼容。
- **对齐 plan 映射**：覆盖矩阵用 `chapters[].plan.tasks` 的 taskId→objectiveId
  补齐生成任务的目标归属；taskId 跨章复用按 (chapterId, taskId) 定位，不串章。

## 测试

```bash
cd python-agent
python -m pytest tests/test_eval_trace.py tests/test_eval_runner.py \
  tests/test_eval_alignment.py tests/test_eval_grounding.py \
  tests/test_eval_report.py tests/test_eval_judge.py tests/test_eval_stats.py -q
```

覆盖：trace 契约完整性、开关关闭零副作用、raw 捕获先于修复链、降级记录、
多次调用历史、写盘失败不阻断、**章/任务作用域（跨章同名 t1 不覆盖）+ calls scope**、
runner dry-run 全链路装配与 blueprint 编译规则、**checkpoint 阶段与 --no-checkpoints
开关 / 失败降级 partial**、**alignment plan 映射 + 跨章覆盖矩阵**、
**grounding no_retrieval 语义 / 证据回退 / evidence_coverage**、
**report 新旧命名拼装 + fallback_level 归一化 + 新指标展示**。