"""课程生成全链路 trace 采集（质量度量闭环的原料层）。

开关：环境变量 EVAL_TRACE_DIR。未设置时所有函数都是空操作（无 I/O、
不累积内容、不改变生成行为）；设置后按以下契约写盘：

    EVAL_TRACE_DIR/<run_id>/<spec_id>/
        spec.json                     归一化后的评测 spec
        stage_<name>_request.json     该阶段最后一次 LLM 调用的请求体（不含鉴权头）
        stage_<name>_raw.txt          修复前原始模型输出（parse/修复链改动之前）
        stage_<name>_parsed.json      解析产物（JSON dict 或任务内容块）
        stage_<name>_meta.json        model / latency_ms / usage / repair_applied /
                                      fallback_level / call_count 等
        stage_<name>_calls.json       仅当该阶段有多次调用（工具轮/修复轮）时写入，
                                      按顺序保留全部调用（含最初原始输出）
        evidence_snapshot.json        各阶段检索到的证据 pack 快照列表
        course.json                   最终组装（蓝图+章节计划+任务内容块），runner 写入
    EVAL_TRACE_DIR/<run_id>/run_meta.json   整次运行元信息，runner 写入

阶段名（带章/任务作用域，由 runner 经 scope() 设置；services/ 不改）：
    architect_chapters / architect_meta / architect_review       课程级，无作用域
    chapter_plan_<chapterId> / chapter_plan_review_<chapterId>   章级
    search_decision_<chapterId>_<taskId>                         任务级
    task_content_<chapterId>_<taskId>                            任务级
    checkpoints_<chapterId>                                      章级（runner 检查点阶段）
无作用域时保持原名（chapter_plan / search_decision / task_content_<taskId>），
旧 trace 与未包 scope 的调用方按原名可读。taskId 可跨章复用（每章都叫 t1），
作用域命名保证各章四件套互不覆盖。

calls.json 每条历史带 scope={"chapter_id","task_id"}：同 scope 内多条 =
该阶段的重试/工具轮（重试计数 = 同 scope 条数）；作用域命名下不同章/任务
已分桶，不再混入同一 calls 历史。

设计约束：
- 任何写盘失败只记日志，绝不向生成主流程抛异常。
- 不记录 API key：请求快照只挑选白名单字段（鉴权在 HTTP 头，不在请求体）。
- raw 捕获点在 LLM 响应返回处（lib/minimax.py、lib/minimax_agent.py），
  先于 parse_json_response / parse_enforced_json 的修复链。
- repair_applied = 解析链对原始文本做了任何改动（剥围栏/XML 清理/Thinking
  清理/首尾截取/引号修复），meta.repair_steps 给出明细。
- fallback_level 记录捕获时请求的 response_format：strict(json_schema) →
  json_object → none；response_format_initial/downgraded 记录降级过程。
- 跨线程：服务层经 asyncio.to_thread 调用 LLM，contextvars 随线程拷贝传播，
  spec/stage 状态对象按引用共享，采集在同一 spec 内顺序发生。
"""
from __future__ import annotations

import contextvars
import json
import logging
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

logger = logging.getLogger("evals.trace")

TRACE_DIR_ENV = "EVAL_TRACE_DIR"

_spec_state_var: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "eval_trace_spec", default=None
)
_stage_var: contextvars.ContextVar[tuple[dict, str] | None] = contextvars.ContextVar(
    "eval_trace_stage", default=None
)
_scope_var: contextvars.ContextVar[tuple[str, str]] = contextvars.ContextVar(
    "eval_trace_scope", default=("", "")
)

# 任务级阶段：阶段名追加 章+任务 作用域；其余阶段只追加章作用域。
# task_content_<taskId> 名字已含任务 ID，只插入章 ID（见 _scoped_name）。
_TASK_LEVEL_STAGES = frozenset({"search_decision"})


@contextmanager
def scope(chapter_id: str = "", task_id: str = "") -> Iterator[None]:
    """章/任务作用域：范围内阶段名自动展开为带章/任务 ID 的名字。

    runner 在服务调用外设置（services/ 禁改）；嵌套时内层继承外层 chapter_id。
    contextvars 随 asyncio.to_thread 拷贝传播，服务层阶段标签自动带上作用域。
    EVAL_TRACE_DIR 未设置时仅设上下文变量，无 I/O。
    """
    prev_chapter, _prev_task = _scope_var.get()
    token = _scope_var.set((chapter_id or prev_chapter, task_id))
    try:
        yield
    finally:
        _scope_var.reset(token)


def _scoped_name(name: str) -> str:
    """按当前作用域展开阶段名；无章作用域时保持原名（课程级/旧调用方兼容）。"""
    chapter_id, task_id = _scope_var.get()
    if not chapter_id:
        return name
    if name.startswith("task_content_"):
        return f"task_content_{chapter_id}_{name[len('task_content_'):]}"
    if task_id and name in _TASK_LEVEL_STAGES:
        return f"{name}_{chapter_id}_{task_id}"
    return f"{name}_{chapter_id}"

# 请求体白名单：只记录生成参数，绝不记录鉴权信息（key 在 HTTP 头，不在 body）
_SAFE_REQUEST_FIELDS = (
    "model", "messages", "max_tokens", "response_format", "tools", "tool_choice",
    "stream", "stream_options", "reasoning_effort", "reasoning_split",
    "temperature", "top_p",
)


def is_enabled() -> bool:
    """EVAL_TRACE_DIR 未设置 = 关闭（零行为变化）。"""
    return bool(os.environ.get(TRACE_DIR_ENV))


def _fallback_level(response_format: dict | None) -> str:
    rf_type = (response_format or {}).get("type")
    if rf_type == "json_schema":
        return "strict"
    if rf_type == "json_object":
        return "json_object"
    return "none"


def _dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


def _safe_write(path: Path, text: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    except Exception as exc:  # noqa: BLE001 trace 失败不得影响生成主流程
        logger.warning("[eval-trace] 写盘失败 %s: %s", path, exc)


def begin_spec(run_id: str, spec_id: str, spec: dict) -> Path | None:
    """开启一个 spec 的采集上下文并写 spec.json；返回 spec 目录。"""
    if not is_enabled():
        return None
    root = Path(os.environ[TRACE_DIR_ENV]) / run_id / spec_id
    state = {"run_id": run_id, "spec_id": spec_id, "dir": root, "stages": {}, "evidence": []}
    _spec_state_var.set(state)
    _safe_write(root / "spec.json", _dump(spec))
    return root


def end_spec() -> None:
    _spec_state_var.set(None)


def current_spec_dir() -> Path | None:
    state = _spec_state_var.get()
    return state["dir"] if state else None


def _bucket(state: dict, name: str) -> dict:
    return state["stages"].setdefault(name, {"calls": [], "parsed": None, "parse": None})


@contextmanager
def stage(name: str) -> Iterator[None]:
    """阶段标签：范围内的 LLM 调用/解析按阶段名聚合写盘。

    同名阶段可多次进入（修复轮/重试轮），调用历史累积在同一 bucket；
    退出时刷盘：契约文件取最后一次调用，全部历史在 calls.json。
    阶段名按当前 scope() 展开（chapter_plan → chapter_plan_<chapterId> 等）。
    """
    state = _spec_state_var.get()
    if not is_enabled() or state is None:
        yield
        return
    name = _scoped_name(name)
    token = _stage_var.set((state, name))
    try:
        yield
    finally:
        _stage_var.reset(token)
        _flush_stage(state, name)


def capture_llm_response(
    response: dict,
    *,
    request: dict,
    started_at: float | None = None,
    source: str = "",
    initial_response_format: str | None = None,
    stream_completed: bool = True,
) -> None:
    """在 LLM 响应返回处捕获修复前 raw（hook 点：minimax/minimax_agent）。

    request 是活请求体（可能被降级就地改写、messages 可能后续追加），
    这里立即深快照白名单字段，避免后续改动污染记录。
    """
    if not is_enabled():
        return
    active = _stage_var.get()
    if active is None:
        return
    state, name = active
    try:
        message = ((response.get("choices") or [{}])[0].get("message")) or {}
        raw = message.get("content") or ""
        req_snapshot = {k: request[k] for k in _SAFE_REQUEST_FIELDS if k in request}
        req_snapshot = json.loads(json.dumps(req_snapshot, ensure_ascii=False, default=str))
        rf = request.get("response_format")
        meta: dict[str, Any] = {
            "model": request.get("model"),
            "latency_ms": int((time.monotonic() - started_at) * 1000) if started_at is not None else None,
            "usage": response.get("usage"),
            "fallback_level": _fallback_level(rf),
            "repair_applied": False,
            "source": source,
            "stream_completed": stream_completed,
            "captured_at": int(time.time() * 1000),
        }
        if initial_response_format is not None:
            meta["response_format_initial"] = initial_response_format
            meta["response_format_downgraded"] = initial_response_format != (rf or {}).get("type")
        chapter_id, task_id = _scope_var.get()
        call_scope = {"chapter_id": chapter_id, "task_id": task_id}
        meta["scope"] = call_scope
        call: dict[str, Any] = {"request": req_snapshot, "raw": raw, "meta": meta, "scope": call_scope}
        if message.get("tool_calls"):
            meta["has_tool_calls"] = True
            call["tool_calls"] = json.loads(json.dumps(message["tool_calls"], ensure_ascii=False, default=str))
        _bucket(state, name)["calls"].append(call)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[eval-trace] 捕获失败 stage=%s: %s", name, exc)


def record_parse(
    parsed: Any,
    *,
    repair_applied: bool = False,
    repair_steps: list[str] | None = None,
    parser: str = "",
) -> None:
    """解析成功处记录 parsed 产物与修复标记（hook 点：两个 parse 函数）。"""
    if not is_enabled():
        return
    active = _stage_var.get()
    if active is None:
        return
    state, name = active
    try:
        bucket = _bucket(state, name)
        bucket["parsed"] = parsed
        bucket["parse"] = {
            "repair_applied": bool(repair_applied),
            "repair_steps": list(repair_steps or []),
            "parser": parser,
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("[eval-trace] 解析记录失败 stage=%s: %s", name, exc)


def record_stage_parsed(
    stage_name: str,
    parsed: Any,
    *,
    parser: str = "",
    repair_applied: bool = False,
    repair_steps: list[str] | None = None,
) -> None:
    """直接向指定阶段写 parsed（服务层在阶段上下文之外组装最终产物时用）。

    阶段名与 stage() 一样按当前 scope() 展开，保证 parsed 与四件套同桶。
    """
    if not is_enabled():
        return
    state = _spec_state_var.get()
    if state is None:
        return
    try:
        stage_name = _scoped_name(stage_name)
        bucket = _bucket(state, stage_name)
        bucket["parsed"] = parsed
        bucket["parse"] = {
            "repair_applied": bool(repair_applied),
            "repair_steps": list(repair_steps or []),
            "parser": parser,
        }
        _flush_stage(state, stage_name)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[eval-trace] 阶段解析记录失败 stage=%s: %s", stage_name, exc)


def _flush_stage(state: dict, name: str) -> None:
    try:
        bucket = state["stages"].get(name)
        if not bucket:
            return
        root = state["dir"]
        calls = bucket["calls"]
        if calls:
            last = calls[-1]
            _safe_write(root / f"stage_{name}_request.json", _dump(last["request"]))
            _safe_write(root / f"stage_{name}_raw.txt", last["raw"])
            meta = dict(last["meta"])
            meta["call_count"] = len(calls)
            if bucket["parse"]:
                meta.update(bucket["parse"])
            _safe_write(root / f"stage_{name}_meta.json", _dump(meta))
            if len(calls) > 1:
                _safe_write(root / f"stage_{name}_calls.json", _dump(calls))
        if bucket["parsed"] is not None:
            _safe_write(root / f"stage_{name}_parsed.json", _dump(bucket["parsed"]))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[eval-trace] 阶段刷盘失败 stage=%s: %s", name, exc)


def record_evidence(pack: Any, *, stage: str = "", chapter_id: str = "", task_id: str = "") -> None:
    """追加快照：某阶段结束时检索到的证据 pack（ChapterEvidenceCollector.pack）。"""
    if not is_enabled():
        return
    state = _spec_state_var.get()
    if state is None:
        return
    try:
        state["evidence"].append({
            "stage": stage,
            "chapterId": chapter_id,
            "taskId": task_id,
            "capturedAt": int(time.time() * 1000),
            "pack": json.loads(json.dumps(pack, ensure_ascii=False, default=str)),
        })
        _safe_write(state["dir"] / "evidence_snapshot.json", _dump(state["evidence"]))
    except Exception as exc:  # noqa: BLE001
        logger.warning("[eval-trace] 证据快照失败 stage=%s: %s", stage, exc)


def write_course(course: dict) -> None:
    """最终组装快照（蓝图+章节计划+任务内容块），由 runner 写入。"""
    if not is_enabled():
        return
    state = _spec_state_var.get()
    if state is None:
        return
    _safe_write(state["dir"] / "course.json", _dump(course))


def write_run_meta(run_id: str, meta: dict) -> None:
    if not is_enabled():
        return
    _safe_write(Path(os.environ[TRACE_DIR_ENV]) / run_id / "run_meta.json", _dump(meta))


def stage_call_counts() -> dict[str, int]:
    """当前 spec 各阶段 LLM 调用次数（成本统计用）；未开启时返回空 dict。"""
    state = _spec_state_var.get()
    if not is_enabled() or state is None:
        return {}
    return {name: len(bucket["calls"]) for name, bucket in state["stages"].items()}
