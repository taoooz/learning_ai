"""
V2 章节 Recap 生成服务（非流式）
章节全部任务完成后产出 keyTakeaways / recommendedReview? / nextChapterPreview?，
与 types/learning-v2/learning-stream.ts ChapterRecap 对齐。

证据红线（画像文档 §7.1）：demonstratedObjectives / fragileObjectives /
unresolvedQuestions 是能力证据字段，P1 阶段无任何掌握度证据——
无论模型输出什么，服务端一律确定性填空数组。
"""
import time

from lib.minimax import MiniMaxClient, parse_json_response
from prompts import build_prompt
from schemas.learning_v2 import ChapterRecapRequest
from services.learning_v2_errors import RecapValidationError

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
            max_tokens=1500,
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
                },
            }

        last_errors = errors
        repair_notes = _format_repair_notes(errors)

    raise RecapValidationError(last_errors)
