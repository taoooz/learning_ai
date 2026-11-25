# evals：课程生成全链路 trace 与离线 runner

质量度量闭环的原料层：让课程生成全链路（蓝图 → 章节计划 → 任务正文）可离线
复跑，并采集**修复前原始输出**的逐阶段 trace，供质量归因使用。

## 组成

| 文件 | 职责 |
| --- | --- |
| `evals/trace.py` | trace 采集：`EVAL_TRACE_DIR` 开关 + 契约写盘（零依赖新增） |
| `evals/runner.py` | 离线 CLI：golden set → architect → chapter_plan → 抽样任务正文 |

hook 点（最小侵入，逻辑零改动）：

- `lib/minimax.py`：`chat` 返回前、`stream_chat` 流结束/中断时捕获修复前 raw；
  `parse_json_response` / `parse_enforced_json` 记录 `repair_applied` 与修复步骤明细。
- `lib/minimax_agent.py`：`_call_llm` 返回前、`_do_streaming_call` 完整响应 yield 前捕获。
- 三个服务只加阶段标签（`eval_trace.stage(...)`）与证据/组装快照，不改生成逻辑。

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
                                 repair_steps / fallback_level / call_count / source …
  stage_<name>_calls.json        仅多次调用（工具轮/修复轮）时写入，按序保留全部调用
  evidence_snapshot.json         各阶段检索到的证据 pack 快照列表
  course.json                    最终组装：architecture + blueprint + 章节计划 + 任务内容块
EVAL_TRACE_DIR/<run_id>/run_meta.json   整次运行元信息（含逐 spec LLM 调用数）
```

阶段名：`architect_chapters`、`architect_meta`、`chapter_plan`、`search_decision`、
`task_content_<taskId>`；审查触发时另有 `architect_review`、`chapter_plan_review`。

语义约定：

- **raw 先于修复**：捕获点在 LLM 响应返回处；`repair_applied=true` 表示解析链
  改动了原始文本，`repair_steps` 给出明细（`fence_strip` / `tool_xml_clean` /
  `thinking_strip` / `json_slice` / `quote_repair`）。
- **fallback_level**：捕获时请求的 `response_format`——`strict`（json_schema）→
  `json_object` → `none`；`response_format_initial` / `response_format_downgraded`
  记录网关拒绝后的降级过程。
- 契约四件套取该阶段**最后一次**调用；最初原始输出与修复轮历史在 `_calls.json`。
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
每章按 order 抽样前 `--max-tasks` 个任务跑 `stream_task_events`。
真实调用全部复用现有服务函数，不重写生成逻辑；单 spec 失败不中断整批
（course.json 记 `status=failed` 与 error）。

成本参考（单 spec，2 章 × 2 任务，无修复轮）：architect 2 次 + 每章计划 1 次
+ 每任务搜索决策 1 次、正文 1 次 ≈ **12 次 LLM 调用**；审查/修复轮按需增加，
精确计数见 `run_meta.json` 的 `llmCalls`。

## 测试

```bash
cd python-agent
python -m pytest tests/test_eval_trace.py tests/test_eval_runner.py -q
```

覆盖：trace 契约完整性、开关关闭零副作用、raw 捕获先于修复链、降级记录、
多次调用历史、写盘失败不阻断、runner dry-run 全链路装配与 blueprint 编译规则。