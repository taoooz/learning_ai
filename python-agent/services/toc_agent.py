"""TOC Agent：Course Architect 生成课程架构后确定性渲染课程目录。"""
import json
from typing import Generator

from services.course_architect_service import (
    architecture_chapter_to_node,
    stream_course_architecture,
)
from services.evidence_store import get_topic_evidence, evidence_to_prompt


def _learner_from_blueprint(blueprint: dict, planning_payload: dict | None) -> dict:
    learner = blueprint.get("learnerPositioning")
    if isinstance(learner, dict) and learner:
        return learner
    snapshot = (planning_payload or {}).get("learnerSnapshot") or {}
    return {
        "estimatedLevel": snapshot.get("estimatedLevel", "beginner"),
        "backgroundSummary": "",
        "skipBasics": (planning_payload or {}).get("skippableBasics", []),
        "likelyGaps": (planning_payload or {}).get("mustCoverConcepts", []),
        "levelConfidence": snapshot.get("confidence", 0.35),
        "preferredExampleDomains": [],
        "personalExampleLimit": 1,
    }


def _toc_result(architecture: dict) -> dict:
    nodes = []
    for index, chapter in enumerate(architecture["chapters"], start=1):
        nodes.append(architecture_chapter_to_node(chapter, index))
    return {
        "courseName": architecture["courseTopic"],
        "courseDescription": architecture["thesis"]["targetCapability"],
        "nodes": nodes,
        "architecture": architecture,
    }


def stream_toc_with_tools(
    blueprint: dict,
    planning_payload: dict = None,
    user_profile: dict = None,
    account_id: str | None = None,
) -> Generator[str, None, None]:
    """设计并审查课程架构，再把架构确定性地渲染为前端 TOC 事件。"""
    topic = blueprint.get("topic", blueprint.get("learningDirection", ""))
    learner = _learner_from_blueprint(blueprint, planning_payload)
    evidence_pack = get_topic_evidence(topic)
    evidence, sources = evidence_to_prompt(evidence_pack)
    # B3：搜索判断交给模型（覆盖度在架构 prompt 内降级为提示），不再按关键词命中禁搜。
    # learner 已携带校准后的定位（来自纲要或 learnerSnapshot）；
    # planningMemory 里再带一份 learnerSnapshot 属于同源重复注入，剔除。
    planning_for_prompt = {
        key: value
        for key, value in (planning_payload or {}).items()
        if key != "learnerSnapshot"
    }
    memory_context = {
        "scene": "course_architecture",
        "planningMemory": planning_for_prompt,
        "userProfile": user_profile or {},
    }

    yield f"data: {json.dumps({'type': 'thinking', 'message': '正在设计并审查课程架构'}, ensure_ascii=False)}\n\n"

    try:
        architecture_result = None
        for event in stream_course_architecture(
            topic=topic,
            outline=blueprint,
            learner=learner,
            memory_context=memory_context,
            evidence=evidence,
            sources=sources,
            account_id=account_id,
        ):
            event_type = event.get("type")
            if event_type == "node":
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            elif event_type == "progress":
                yield f"data: {json.dumps({'type': 'progress', 'message': event.get('message', '正在校验课程架构…')}, ensure_ascii=False)}\n\n"
            elif event_type in {"course_name", "course_description"}:
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            elif event_type == "result":
                architecture_result = event.get("result")

        if not architecture_result:
            raise ValueError("课程架构未返回结果")
    except Exception as exc:  # noqa: BLE001 架构失败时不生成低质量目录
        print(f"[TOC Agent] 课程架构生成失败: {exc}")
        yield f"data: {json.dumps({'type': 'error', 'message': '课程架构生成失败，请重试'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    if architecture_result.get("issues"):
        print(f"[TOC Agent] 课程架构审查未通过: {architecture_result['issues']}")
        yield f"data: {json.dumps({'type': 'error', 'message': '课程架构审查未通过，请重试'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"
        return

    result = _toc_result(architecture_result["architecture"])
    result["modelVersion"] = architecture_result.get("modelVersion")
    result["promptVersion"] = architecture_result.get("promptVersion")

    yield f"data: {json.dumps({'type': 'course_name', 'value': result['courseName']}, ensure_ascii=False)}\n\n"
    yield f"data: {json.dumps({'type': 'course_description', 'value': result['courseDescription']}, ensure_ascii=False)}\n\n"
    for node in result["nodes"]:
        yield f"data: {json.dumps({'type': 'node', 'node': node}, ensure_ascii=False)}\n\n"
    yield f"data: {json.dumps({'type': 'complete', 'result': result}, ensure_ascii=False)}\n\n"
    yield "data: [DONE]\n\n"
