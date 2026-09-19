import os
import json
import httpx
from typing import AsyncIterator, Iterator

DEFAULT_LLM_API_BASE = "http://muses-openapi-prod.weizhipin.com/v1"
DEFAULT_LLM_MODEL = "zhipu/glm-5.3-flash"


class MiniMaxClient:
    """LLM API 客户端（OpenAI 兼容格式，当前接入 zhipu/glm-5.3-flash）"""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.getenv("LLM_API_KEY", "")
        self.base_url = base_url or os.getenv("LLM_API_BASE", DEFAULT_LLM_API_BASE)
        self.model = os.getenv("LLM_MODEL", DEFAULT_LLM_MODEL)

    def _get_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def stream_chat_sync(
        self,
        messages: list[dict],
        model: str | None = None,
        max_tokens: int = 1500,
    ) -> Iterator[dict]:
        """同步流式调用 chat API"""
        model = model or self.model
        with httpx.Client() as client:
            with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": max_tokens,
                },
                timeout=90.0,
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        yield json.loads(data)

    async def chat(
        self,
        messages: list[dict],
        model: str | None = None,
        max_tokens: int = 1500,
    ) -> dict:
        """同步调用 chat API"""
        model = model or self.model
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": max_tokens,
                },
                timeout=60.0,
            )
            response.raise_for_status()
            return response.json()

    async def stream_chat(
        self,
        messages: list[dict],
        model: str | None = None,
        max_tokens: int = 1500,
    ) -> AsyncIterator[dict]:
        """流式调用 chat API"""
        model = model or self.model
        async with httpx.AsyncClient() as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json={
                    "model": model,
                    "messages": messages,
                    "stream": True,
                    "max_tokens": max_tokens,
                },
                timeout=60.0,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        yield json.loads(data)


def _is_json_balanced(text: str) -> bool:
    """检查 JSON 文本的大括号/方括号是否平衡（忽略字符串内部的括号）"""
    brace_depth = 0
    bracket_depth = 0
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == '{':
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
        elif ch == '[':
            bracket_depth += 1
        elif ch == ']':
            bracket_depth -= 1
    return not in_string and brace_depth == 0 and bracket_depth == 0


def _repair_unescaped_quotes(text: str) -> str:
    """修复字符串值内未转义的英文双引号（模型输出 JSON 的常见错误）

    启发式：在字符串内部遇到 " 时，若其后第一个非空白字符不是
    JSON 结构符（, } ] :），则视为内容引号并补转义。
    """
    result = []
    in_string = False
    i = 0
    n = len(text)
    terminators = ",}]:"
    while i < n:
        ch = text[i]
        if not in_string:
            if ch == '"':
                in_string = True
            result.append(ch)
            i += 1
            continue
        if ch == '\\':  # 保留已有的转义序列
            result.append(text[i:i + 2])
            i += 2
            continue
        if ch == '"':
            # 向后找第一个非空白字符，判断是结束引号还是内容引号
            j = i + 1
            while j < n and text[j] in ' \t\r\n':
                j += 1
            if j >= n or text[j] in terminators:
                in_string = False
                result.append(ch)
            else:
                result.append('\\"')
            i += 1
            continue
        result.append(ch)
        i += 1
    return ''.join(result)


def parse_json_response(content: str) -> dict:
    """解析 JSON 响应，处理 markdown 代码块和工具调用 XML"""
    import re
    content = content.strip()

    # 移除 markdown 代码块
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]

    # 清理模型输出的工具调用 XML（MiniMax M2.7 有时在 content 中输出而非使用 tool_calls）
    content = re.sub(r'<minimax:tool_call>.*?</minimax:tool_call>', '', content, flags=re.DOTALL)
    content = re.sub(r'<minimax:tool_call>.*', '', content, flags=re.DOTALL)
    content = re.sub(r'<invoke\s+name=["\'][^"\']*["\']\s*>.*?</invoke\s*>', '', content, flags=re.DOTALL)
    content = re.sub(r'<invoke\s+[^>]*>.*', '', content, flags=re.DOTALL)
    # 清理 Thinking 标签
    content = re.sub(r'Thinking.*?Thinking', '', content, flags=re.DOTALL)
    content = content.strip()

    # 找到第一个 {
    first_brace = content.find("{")
    if first_brace == -1:
        raise ValueError(f"No JSON found in response: {content[:200]}")

    # 尝试解析
    json_str = content[first_brace:]

    # 处理不完整的 JSON（找最后一个 }）
    last_brace = json_str.rfind("}")
    if last_brace != -1:
        json_str = json_str[:last_brace + 1]

    try:
        # strict=False：容忍字符串值内的裸控制字符（如未转义的换行）
        return json.loads(json_str, strict=False)
    except json.JSONDecodeError as e:
        # 兜底修复：模型常在字符串值内输出未转义的英文双引号
        repaired = _repair_unescaped_quotes(json_str)
        if repaired != json_str:
            try:
                return json.loads(repaired, strict=False)
            except json.JSONDecodeError:
                pass
        # 括号不平衡说明模型输出被截断（如 max_tokens 耗尽），
        # 明确报截断错误，避免上层把残缺内容误当成正常结果
        if not _is_json_balanced(json_str):
            raise ValueError(f"JSON response truncated (unbalanced brackets): {json_str[:200]}")
        raise ValueError(f"Invalid JSON: {e}, content: {json_str[:200]}")


def extract_usage(response: dict) -> dict | None:
    """从 LLM 响应中提取 token 用量（P5 可观测性，§P5.4）

    OpenAI 兼容格式：response.usage.{prompt_tokens, completion_tokens, total_tokens}
    无 usage 字段（流式未开 include_usage 等）时返回 None，调用方省略该字段。
    """
    usage = response.get("usage")
    if not isinstance(usage, dict):
        return None
    prompt_tokens = usage.get("prompt_tokens")
    completion_tokens = usage.get("completion_tokens")
    total_tokens = usage.get("total_tokens")
    if not isinstance(prompt_tokens, int) or not isinstance(completion_tokens, int):
        return None
    return {
        "promptTokens": prompt_tokens,
        "completionTokens": completion_tokens,
        "totalTokens": total_tokens if isinstance(total_tokens, int) else prompt_tokens + completion_tokens,
    }
