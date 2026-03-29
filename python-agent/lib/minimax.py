import os
import json
import httpx
from typing import AsyncIterator


class MiniMaxClient:
    """MiniMax API 客户端"""

    def __init__(self, api_key: str | None = None, base_url: str | None = None):
        self.api_key = api_key or os.getenv("MINIMAX_API_KEY", "")
        self.base_url = base_url or os.getenv("MINIMAX_API_BASE", "https://api.minimaxi.com/v1")

    def _get_headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def chat(
        self,
        messages: list[dict],
        model: str = "MiniMax-M2.7",
        max_tokens: int = 1500,
    ) -> dict:
        """同步调用 chat API"""
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
        model: str = "MiniMax-M2.7",
        max_tokens: int = 1500,
    ) -> AsyncIterator[dict]:
        """流式调用 chat API"""
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


def parse_json_response(content: str) -> dict:
    """解析 JSON 响应，处理 markdown 代码块"""
    content = content.strip()

    # 移除 markdown 代码块
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]

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
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}, content: {json_str[:200]}")
