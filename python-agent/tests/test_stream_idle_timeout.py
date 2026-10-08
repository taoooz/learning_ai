# tests/test_stream_idle_timeout.py — 流式空闲超时：验证 IdleStreamError 包装语义
# （stream_chat 的网络层不易单测，这里覆盖异常类型与常量约定；行为由集成观测）

import asyncio

import pytest

from lib.minimax import IdleStreamError, _STREAM_IDLE_TIMEOUT


def test_idle_timeout_constant():
    assert _STREAM_IDLE_TIMEOUT == 60.0


def test_idle_error_is_exception():
    assert isinstance(IdleStreamError("x"), Exception)


def test_wait_for_timeout_raises_timeout_error():
    """asyncio.wait_for 对挂起的迭代抛 TimeoutError，stream_chat 侧会转成 IdleStreamError"""

    async def stalled():
        await asyncio.sleep(999)
        yield {}  # pragma: no cover

    async def run():
        ait = stalled().__aiter__()
        return await asyncio.wait_for(anext(ait), timeout=0.05)

    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(run())
