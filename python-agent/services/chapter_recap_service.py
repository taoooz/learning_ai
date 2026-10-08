"""
V2 章节 Recap 生成服务
支持 SSE 流式输出：模型 JSON 中的 keyTakeaways 每解析出一条就立即下发。
章节全部任务完成后产出 keyTakeaways / recommendedReview? / nextChapterPreview?，
与 types/learning-v2/learning-stream.ts ChapterRecap 对齐。

证据红线（画像文档 §7.1）：demonstratedObjectives / fragileObjectives /
unresolvedQuestions 是能力证据字段，P1 阶段无任何掌握度证据——
无论模型输出什么，服务端一律确定性填空数组。
"""
import json
import time
from typing import AsyncIterator
from uuid import uuid4

from lib.minimax import MiniMaxClient, extract_usage, parse_json_response
from services.style_lint import lint_prose, log_prose_findings
from prompts import build_prompt
from schemas.learning_v2 import ChapterRecapRequest
from services.learning_v2_errors import RecapValidationError, classify_llm_error

PROMPT_VERSION = "chapter_recap_v2"

# keyTakeaways 条数上限：超出直接截断（软约束，不为此多跑一轮重试）
MAX_KEY_TAKEAWAYS = 8

RECAP_VALIDATION_CODES = {
    "INVALID_JSON": "INVALID_JSON",
    "EMPTY_TAKEAWAYS": "EMPTY_TAKEAWAYS",
    "INVALID_TAKEAWAY_ENTRY": "INVALID_TAKEAWAY_ENTRY",
}


def _build_tasks_section(request: ChapterRecapRequest) -> str:
    """把已完成任务标题+要点拼成 prompt 输入段"""
    if not request.tasks:
        return "（本章没有任务要点记录）"
    lines = []
    for index, task in enumerate(request.tasks, start=1):
        takeaway = (task.takeaway or "").strip() or "（该任务没有记录要点）"
        lines.append(f"{index}. {task.title}\n   要点：{takeaway}")
    return "\n".join(lines)


def _validate_recap(parsed: dict) -> tuple[list[dict], dict | None]:
    """校验模型输出，返回 (错误列表, 归一化结果)；结果不含任何掌握度字段"""
    errors: list[dict] = []
    codes = RECAP_VALIDATION_CODES

    raw_takeaways = parsed.get("keyTakeaways")
    if not isinstance(raw_takeaways, list) or len(raw_takeaways) == 0:
        errors.append({"code": codes["EMPTY_TAKEAWAYS"], "message": "keyTakeaways 必须是非空数组"})
        return errors, None

    takeaways: list[str] = []
    for entry in raw_takeaways:
        if not isinstance(entry, str):
            errors.append({"code": codes["INVALID_TAKEAWAY_ENTRY"], "message": "keyTakeaways 每项必须为字符串"})
            return errors, None
        stripped = entry.strip()
        if stripped:
            takeaways.append(stripped)
    if not takeaways:
        errors.append({"code": codes["EMPTY_TAKEAWAYS"], "message": "keyTakeaways 全为空白字符串"})
        return errors, None

    def _optional_text(field: str) -> str | None:
        value = parsed.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    return [], {
        "keyTakeaways": takeaways[:MAX_KEY_TAKEAWAYS],
        "recommendedReview": _optional_text("recommendedReview"),
        "nextChapterPreview": _optional_text("nextChapterPreview"),
    }


class TakeawayStreamParser:
    """增量扫描模型 JSON 中的 keyTakeaways 字符串。

    这里不要求整个 JSON 提前完整；只要某条 takeaway 字符串已闭合，就立刻下发。
    最终仍以完整 JSON 解析和 _validate_recap 的结果为准，避免半截内容误入持久化。
    """

    def __init__(self):
        self._content = ""
        self._array_start: int | None = None
        self._cursor = 0
        self._done = False

    def feed(self, delta: str) -> list[str]:
        if self._done:
            return []
        self._content += delta
        content = self._content
        if self._array_start is None:
            key_index = content.find('"keyTakeaways"')
            if key_index == -1:
                return []
            array_index = content.find('[', key_index + len('"keyTakeaways"'))
            if array_index == -1:
                return []
            self._array_start = array_index + 1
            self._cursor = self._array_start

        results: list[str] = []
        i = self._cursor
        while i < len(content):
            while i < len(content) and content[i] in ' \t\r\n,':
                i += 1
            if i >= len(content):
                break
            if content[i] == ']':
                self._done = True
                self._cursor = i + 1
                break
            if content[i] != '"':
                i += 1
                continue

            closing = self._find_closing_quote(content, i)
            if closing == -1:
                break
            raw = content[i:closing + 1]
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                value = raw[1:-1]
            if isinstance(value, str) and value.strip():
                results.append(value.strip())
            i = closing + 1

        self._cursor = i
        return results

    @staticmethod
    def _find_closing_quote(content: str, opening: int) -> int:
        escaped = False
        for index in range(opening + 1, len(content)):
            char = content[index]
            if escaped:
                escaped = False
            elif char == '\\':
                escaped = True
            elif char == '"':
                return index
        return -1


def _format_repair_notes(errors: list[dict]) -> str:
    """把校验错误拼成给模型的修复提示"""
    return "\n".join(f"- [{error['code']}] {error['message']}" for error in errors)


async def generate_chapter_recap(request: ChapterRecapRequest, client: MiniMaxClient | None = None) -> dict:
    """生成章节 Recap；校验失败带修复提示重试一次，仍失败抛 RecapValidationError"""
    client = client or MiniMaxClient()

    system_prompt = build_prompt(
        "chapter_recap",
        topic=request.courseTopic,
        chapter_title=request.chapter.title,
        teaching_goal=request.chapter.teachingGoal,
        tasks_section=_build_tasks_section(request),
        next_chapter_title=request.nextChapterTitle or "（暂无）",
    )

    started = time.monotonic()
    last_errors: list[dict] = []
    repair_notes: str | None = None

    for _round in range(2):
        user_message = "请为这个刚完成的章节生成学习回顾。"
        if repair_notes:
            user_message += f"\n\n上一版输出存在以下问题，请修正后重新输出完整 JSON：\n{repair_notes}"

        response = await client.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            max_tokens=8000,
        )
        content = (response.get("choices") or [{}])[0].get("message", {}).get("content", "")

        try:
            parsed = parse_json_response(content)
        except ValueError as exc:
            last_errors = [{"code": RECAP_VALIDATION_CODES["INVALID_JSON"], "message": f"输出不是合法 JSON：{exc}"}]
            repair_notes = _format_repair_notes(last_errors)
            continue

        errors, recap_fields = _validate_recap(parsed)
        if not errors and recap_fields is not None:
            now_ms = time.time_ns() // 1_000_000
            return {
                "chapterId": request.chapterId,
                **recap_fields,
                # 证据红线（画像文档 §7.1）：服务端确定性填空数组，不采信模型输出
                "demonstratedObjectives": [],
                "fragileObjectives": [],
                "unresolvedQuestions": [],
                "generationMeta": {
                    "promptVersion": PROMPT_VERSION,
                    "modelVersion": getattr(client, "model", None) or "unknown",
                    "generatedAt": now_ms,
                    "durationMs": int((time.monotonic() - started) * 1000),
                    "degraded": False,
                    **({"tokenUsage": usage} if (usage := extract_usage(response)) else {}),
                },
            }

        last_errors = errors
        repair_notes = _format_repair_notes(errors)

    raise RecapValidationError(last_errors)


async def stream_chapter_recap_events(
    request: ChapterRecapRequest,
    client: MiniMaxClient | None = None,
    request_id: str | None = None,
) -> AsyncIterator[dict]:
    """流式生成章节 Recap：started → N×takeaway → completed → request_completed"""
    client = client or MiniMaxClient()
    req_id = request_id or f"req-{uuid4().hex[:12]}"
    sequence = 0
    started = time.monotonic()

    def make_event(event_type: str, payload: dict) -> dict:
        nonlocal sequence
        sequence += 1
        return {
            "eventId": f"{req_id}:{sequence}",
            "requestId": req_id,
            "type": event_type,
            "courseId": request.courseId,
            "chapterId": request.chapterId,
            "planVersion": request.planVersion,
            "sequence": sequence,
            "timestamp": time.time_ns() // 1_000_000,
            "payload": payload,
        }

    system_prompt = build_prompt(
        "chapter_recap",
        topic=request.courseTopic,
        chapter_title=request.chapter.title,
        teaching_goal=request.chapter.teachingGoal,
        tasks_section=_build_tasks_section(request),
        next_chapter_title=request.nextChapterTitle or "（暂无）",
    )

    yield make_event("recap_started", {})
    parser = TakeawayStreamParser()
    takeaway_index = 0
    accumulated = ""
    received_delta = False

    try:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "请为这个刚完成的章节生成学习回顾。"},
        ]
        async for chunk in client.stream_chat(messages=messages, max_tokens=8000):
            delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content", "")
            if not delta:
                continue
            received_delta = True
            accumulated += delta
            for takeaway in parser.feed(accumulated):
                yield make_event(
                    "recap_takeaway",
                    {"index": takeaway_index, "takeaway": takeaway},
                )
                takeaway_index += 1

        if not accumulated.strip():
            yield make_event("request_error", {"code": "EMPTY_CONTENT", "message": "章节小结生成为空，请重试", "retryable": True})
            yield make_event("request_completed", {"requestId": req_id, "status": "failed", "errorCode": "EMPTY_CONTENT"})
            return

        parsed = parse_json_response(accumulated)
        errors, recap_fields = _validate_recap(parsed)
        if errors or recap_fields is None:
            yield make_event("request_error", {"code": "RECAP_VALIDATION_FAILED", "message": "章节小结未通过校验，请重试", "retryable": False})
            yield make_event("request_completed", {"requestId": req_id, "status": "failed", "errorCode": "RECAP_VALIDATION_FAILED"})
            return

        _recap_texts = [recap_fields.get("summary", "")] + [
            item if isinstance(item, str) else str(item)
            for item in (recap_fields.get("keyTakeaways") or [])
        ]
        log_prose_findings("chapter_recap", lint_prose("\n".join(filter(None, _recap_texts))))

        now_ms = time.time_ns() // 1_000_000
        recap = {
            "chapterId": request.chapterId,
            **recap_fields,
            "demonstratedObjectives": [],
            "fragileObjectives": [],
            "unresolvedQuestions": [],
            "generationMeta": {
                "promptVersion": PROMPT_VERSION,
                "modelVersion": getattr(client, "model", None) or "unknown",
                "generatedAt": now_ms,
                "durationMs": int((time.monotonic() - started) * 1000),
                "degraded": False,
            },
        }
        yield make_event("recap_completed", {"recap": recap})
        yield make_event("request_completed", {"requestId": req_id, "status": "completed"})
    except Exception as exc:  # noqa: BLE001
        code, message = ("UPSTREAM_STREAM_BROKEN", "小结流中断，请重试") if received_delta else classify_llm_error(exc)
        print(f"[Learning V2 Recap Stream] 生成失败 code={code}: {exc}")
        yield make_event("request_error", {"code": code, "message": message, "retryable": True})
        yield make_event("request_completed", {"requestId": req_id, "status": "failed", "errorCode": code})
