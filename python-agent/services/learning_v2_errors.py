"""
V2 学习流共享错误定义
包含请求数据错误、计划校验异常，以及与 SSE 错误码表对齐的 LLM 异常分类
"""
import httpx


class ChapterNotFoundError(ValueError):
    """蓝图中找不到请求的章节"""


class BlueprintDataError(ValueError):
    """蓝图数据不完整或引用无效（如章节目标缺失）"""


class PlanValidationError(Exception):
    """章节计划结构校验失败；errors 为 [{code, taskId?, message}] 列表"""

    def __init__(self, errors: list[dict]):
        self.errors = errors
        first = errors[0] if errors else {}
        super().__init__(first.get("message", "章节计划校验失败"))


class RecapValidationError(Exception):
    """章节 Recap 输出校验失败；errors 为 [{code, message}] 列表"""

    def __init__(self, errors: list[dict]):
        self.errors = errors
        first = errors[0] if errors else {}
        super().__init__(first.get("message", "章节小结校验失败"))


# 错误码 → HTTP 状态码（仅非流式端点使用；流式端点按协议发事件）
LLM_ERROR_STATUS = {
    "LLM_TIMEOUT": 504,
    "LLM_RATE_LIMITED": 429,
    "LLM_UNAVAILABLE": 503,
    "UPSTREAM_ERROR": 502,
    "UPSTREAM_STREAM_BROKEN": 502,
    "EMPTY_CONTENT": 502,
}


def classify_llm_error(exc: Exception) -> tuple[str, str]:
    """将 LLM 调用异常分类为 (错误码, 用户可见消息)；这些错误均视为可重试"""
    if isinstance(exc, httpx.TimeoutException):
        return "LLM_TIMEOUT", "模型响应超时，请稍后重试"
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code == 429:
            return "LLM_RATE_LIMITED", "模型请求过于频繁，请稍后重试"
        return "UPSTREAM_ERROR", f"模型服务返回异常（{status_code}），请稍后重试"
    if isinstance(exc, httpx.NetworkError):
        return "LLM_UNAVAILABLE", "无法连接模型服务，请稍后重试"
    return "UPSTREAM_ERROR", "内容生成出现异常，请稍后重试"
