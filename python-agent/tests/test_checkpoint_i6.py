"""I6 回归：checkpoint schema 校验纳入重试循环（畸形输出重试而非直接丢题）。"""
import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from services.checkpoint_service import generate_checkpoint


def _valid_checkpoint_json() -> str:
    return json.dumps({
        "kind": "scenario_choice",
        "prompt": "HTTP 缓存中 ETag 的作用是什么？",
        "options": [
            {"id": "a", "text": "资源版本标识，用于协商缓存"},
            {"id": "b", "text": "加密传输内容"},
            {"id": "c", "text": "压缩响应体"},
            {"id": "d", "text": "记录访问日志"},
        ],
        "correctAnswer": "a",
        "remediationHint": "ETag 是资源的版本指纹。",
    }, ensure_ascii=False)


def _invalid_checkpoint_json() -> str:
    # options 为字符串列表（非 {id,text} 对象）→ CheckpointOption 校验失败 → ValidationError
    return json.dumps({
        "kind": "scenario_choice",
        "prompt": "题",
        "options": ["a", "b", "c", "d"],
        "correctAnswer": "a",
        "remediationHint": "提示",
    }, ensure_ascii=False)


def _gen(fake_client):
    return generate_checkpoint(
        course_topic="HTTP", chapter_title="缓存", teaching_goal="理解协商缓存",
        task_id="t1", task_title="ETag", task_goal="理解 ETag",
        objective_id="obj-1", task_content_summary="内容摘要", client=fake_client,
    )


def test_i6_validation_failure_retries_and_rescues():
    async def run():
        fake_client = AsyncMock()
        fake_client.chat.side_effect = [
            {"choices": [{"message": {"content": _invalid_checkpoint_json()}}]},
            {"choices": [{"message": {"content": _valid_checkpoint_json()}}]},
        ]
        definition = await _gen(fake_client)
        assert fake_client.chat.call_count == 2  # 校验失败触发了一次重试
        return definition
    definition = asyncio.run(run())
    assert definition.kind == "scenario_choice"
    assert definition.correctAnswer == "a"
    assert len(definition.options) == 4


def test_i6_valid_first_output_unchanged():
    async def run():
        fake_client = AsyncMock()
        fake_client.chat.return_value = {"choices": [{"message": {"content": _valid_checkpoint_json()}}]}
        definition = await _gen(fake_client)
        assert fake_client.chat.call_count == 1  # 合法输出零额外调用
        return definition
    definition = asyncio.run(run())
    assert definition.correctAnswer == "a"


def test_i6_all_invalid_raises_after_retries():
    async def run():
        fake_client = AsyncMock()
        fake_client.chat.return_value = {"choices": [{"message": {"content": _invalid_checkpoint_json()}}]}
        with pytest.raises(ValidationError):
            await _gen(fake_client)
        assert fake_client.chat.call_count == 3  # 重试耗尽仍失败 → 上抛（调用方存 null，同旧行为）
    asyncio.run(run())
