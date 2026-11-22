import json
from unittest.mock import patch

import services.toc_agent as toc_agent
from tests.test_course_architecture import _valid_architecture


def _events(blueprint=None):
    events = []
    with patch.object(toc_agent, "generate_course_architecture_sync", return_value={
        "architecture": _valid_architecture(),
        "issues": [],
        "reviewUnavailable": False,
        "promptVersion": "course-architect-v1",
        "modelVersion": "fake-model",
    }):
        for raw in toc_agent.stream_toc_with_tools(
            blueprint or {"topic": "推荐系统核心链路", "learnerPositioning": {"estimatedLevel": "intermediate"}},
        ):
            if not raw.startswith("data: "):
                continue
            body = raw[6:].strip()
            if body != "[DONE]":
                events.append(json.loads(body))
    return events


def test_toc_agent_renders_architecture_nodes_and_complete_result():
    events = _events()
    types = [event["type"] for event in events]
    assert types == ["thinking", "course_name", "course_description", "node", "node", "complete"]
    complete = events[-1]["result"]
    assert complete["courseName"] == "推荐系统核心链路"
    assert len(complete["nodes"]) == len(complete["architecture"]["chapters"])
    assert complete["nodes"][0]["description"].startswith("建立召回、排序、重排的诊断框架")
    assert complete["modelVersion"] == "fake-model"


def test_toc_agent_blocks_unreviewed_architecture():
    with patch.object(toc_agent, "generate_course_architecture_sync", return_value={
        "architecture": _valid_architecture(),
        "issues": ["[DUPLICATE_CHAPTER] 两章重复"],
        "reviewUnavailable": False,
        "promptVersion": "course-architect-v1",
        "modelVersion": "fake-model",
    }):
        events = [
            json.loads(raw[6:].strip())
            for raw in toc_agent.stream_toc_with_tools(
                blueprint={"topic": "推荐系统核心链路", "learnerPositioning": {"estimatedLevel": "intermediate"}},
            )
            if raw.startswith("data: ") and raw[6:].strip() != "[DONE]"
        ]
    assert [event["type"] for event in events] == ["thinking", "error"]
    assert "审查未通过" in events[-1]["message"]
