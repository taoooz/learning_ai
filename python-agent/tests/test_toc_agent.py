import json
from unittest.mock import patch

import services.toc_agent as toc_agent
from tests.test_course_architecture import _valid_architecture


def _result():
    return {
        "architecture": _valid_architecture(),
        "issues": [],
        "reviewUnavailable": False,
        "reviewSkipped": True,
        "promptVersion": "course-architect-v1",
        "modelVersion": "fake-model",
    }


def _stream(result):
    architecture = result["architecture"]
    yield {"type": "course_name", "value": architecture["courseTopic"]}
    for index, chapter in enumerate(architecture["chapters"], start=1):
        yield {
            "type": "node",
            "node": {
                "index": index,
                "title": chapter["title"],
                "description": f"{chapter['roleInCourse']}。本章交付：{chapter['deliverable']}",
                "frame": "total_split_total",
            },
        }
    yield {"type": "result", "result": result}


def _events(blueprint=None):
    events = []
    with patch.object(toc_agent, "stream_course_architecture", side_effect=lambda **_: _stream(_result())):
        for raw in toc_agent.stream_toc_with_tools(
            blueprint or {"topic": "推荐系统核心链路", "learnerPositioning": {"estimatedLevel": "intermediate"}},
        ):
            if not raw.startswith("data: "):
                continue
            body = raw[6:].strip()
            if body != "[DONE]":
                events.append(json.loads(body))
    return events


def test_toc_agent_streams_architecture_nodes_and_complete_result():
    events = _events()
    types = [event["type"] for event in events]
    assert types == [
        "thinking",
        "course_name",
        "node",
        "node",
        "course_name",
        "course_description",
        "node",
        "node",
        "complete",
    ]
    complete = events[-1]["result"]
    assert complete["courseName"] == "推荐系统核心链路"
    assert len(complete["nodes"]) == len(complete["architecture"]["chapters"])
    assert complete["nodes"][0]["description"].startswith("建立召回、排序、重排的诊断框架")
    assert complete["modelVersion"] == "fake-model"


def test_toc_agent_blocks_unreviewed_architecture():
    bad_result = {
        **_result(),
        "issues": ["[DUPLICATE_CHAPTER] 两章重复"],
    }
    with patch.object(toc_agent, "stream_course_architecture", side_effect=lambda **_: iter([{"type": "result", "result": bad_result}])):
        events = [
            json.loads(raw[6:].strip())
            for raw in toc_agent.stream_toc_with_tools(
                blueprint={"topic": "推荐系统核心链路", "learnerPositioning": {"estimatedLevel": "intermediate"}},
            )
            if raw.startswith("data: ") and raw[6:].strip() != "[DONE]"
        ]
    assert [event["type"] for event in events] == ["thinking", "error"]
    assert "审查未通过" in events[-1]["message"]
