"""
MiniMax Agent 客户端 — 支持 function calling 的 Agent 循环
基于 MiniMaxClient 扩展，增加 tools 调用能力
"""
import json
import httpx
from typing import Iterator, Optional, Callable, Any
from lib.minimax import MiniMaxClient


class AgentClient(MiniMaxClient):
    """支持 function calling 的 MiniMax 客户端"""

    def chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        tool_functions: dict[str, Callable],
        model: str = "MiniMax-M2.7",
        max_tokens: int = 2000,
        reasoning_split: bool = True,
        max_iterations: int = 3,
    ) -> dict:
        """同步调用 chat API，自动处理 tool_calls 循环

        Args:
            messages: 对话历史
            tools: 工具定义列表（OpenAI 格式）
            tool_functions: 工具名 -> 执行函数的映射
            model: 模型名
            max_tokens: 最大 token
            reasoning_split: 是否分离思考内容到 reasoning_details
            max_iterations: 最大工具调用轮次

        Returns:
            最终 LLM 响应
        """
        iteration = 0
        while iteration < max_iterations:
            response = self._call_llm(messages, tools, model, max_tokens, reasoning_split)
            choice = response.get("choices", [{}])[0]
            message = choice.get("message", {})

            if not self._has_tool_calls(response):
                return response

            # yield thinking 事件供调用方处理
            reasoning = self._extract_reasoning(message, reasoning_split)
            tool_calls = message.get("tool_calls", [])

            # 将 assistant 完整响应加入历史
            messages.append(self._build_assistant_message(message, reasoning_split))

            # 执行工具并追加结果
            for tc in tool_calls:
                func_name = tc["function"]["name"]
                func_args = json.loads(tc["function"]["arguments"])
                tool_call_id = tc["id"]

                result = ""
                if func_name in tool_functions:
                    try:
                        result = str(tool_functions[func_name](**func_args))
                        # 截断过长结果
                        if len(result) > 3000:
                            result = result[:3000] + "\n...(结果已截断)"
                    except Exception as e:
                        result = f"工具执行失败: {e}"
                else:
                    result = f"未知工具: {func_name}"

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "content": result,
                })

            iteration += 1

        # 超过最大迭代次数，再做一次无 tools 调用获取最终结果
        return self._call_llm(messages, [], model, max_tokens, reasoning_split)

    def _call_llm_streaming(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        model: str,
        max_tokens: int,
        reasoning_split: bool,
    ) -> Iterator[dict]:
        """流式 LLM 调用，逐 token yield MiniMax SSE chunk"""
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": True,
            "reasoning_split": reasoning_split,
        }
        if tools:
            payload["tools"] = tools

        with httpx.Client() as client:
            with client.stream(
                "POST",
                f"{self.base_url}/chat/completions",
                headers=self._get_headers(),
                json=payload,
                timeout=httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0),
            ) as response:
                response.raise_for_status()
                for line in response.iter_lines():
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break
                    try:
                        yield json.loads(data)
                    except json.JSONDecodeError:
                        continue

    def stream_chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        tool_functions: dict[str, Callable],
        model: str = "MiniMax-M2.7",
        max_tokens: int = 2000,
        reasoning_split: bool = True,
        max_iterations: int = 3,
    ) -> Iterator[dict]:
        """支持 tools 的流式调用，逐 token yield 事件

        事件类型:
            - thinking: 思考过程（逐 token）
            - tool_call: 工具调用信息
            - tool_result: 工具执行结果
            - content_delta: 内容增量（逐 token）
            - done: 完成标记
        """
        iteration = 0
        while iteration < max_iterations:
            # 流式 LLM 调用
            chunks = self._call_llm_streaming(messages, tools, model, max_tokens, reasoning_split)

            # 积累 tool_calls，同时逐 token yield thinking/content
            tool_calls_acc: dict[int, dict] = {}
            content_parts = []
            reasoning_details_raw = []
            finish_reason = None

            for chunk in chunks:
                choice = chunk.get("choices", [{}])[0]
                delta = choice.get("delta", {})

                if choice.get("finish_reason"):
                    finish_reason = choice["finish_reason"]

                # reasoning_details → 逐 token yield thinking
                if delta.get("reasoning_details"):
                    for rd in delta["reasoning_details"]:
                        text = rd.get("text", "")
                        if text:
                            reasoning_details_raw.append(rd)
                            yield {"type": "thinking", "message": text}

                # content → 逐 token yield content_delta
                if delta.get("content"):
                    content_parts.append(delta["content"])
                    yield {"type": "content_delta", "content": delta["content"]}

                # tool_calls → 增量拼接
                if delta.get("tool_calls"):
                    for tc_delta in delta["tool_calls"]:
                        idx = tc_delta.get("index", 0)
                        if idx not in tool_calls_acc:
                            tool_calls_acc[idx] = {
                                "id": tc_delta.get("id", ""),
                                "type": "function",
                                "function": {"name": "", "arguments": ""},
                            }
                        acc = tool_calls_acc[idx]
                        if tc_delta.get("id"):
                            acc["id"] = tc_delta["id"]
                        if tc_delta.get("function"):
                            fn = tc_delta["function"]
                            if fn.get("name"):
                                acc["function"]["name"] += fn["name"]
                            if fn.get("arguments"):
                                acc["function"]["arguments"] += fn["arguments"]

            # 无 tool_calls → 完成
            if not tool_calls_acc:
                yield {"type": "done"}
                return

            # 构建 assistant 消息加入历史
            msg_to_add: dict[str, Any] = {"role": "assistant", "content": "".join(content_parts)}
            if reasoning_details_raw:
                msg_to_add["reasoning_details"] = reasoning_details_raw
            sorted_tcs = [tool_calls_acc[i] for i in sorted(tool_calls_acc)]
            msg_to_add["tool_calls"] = sorted_tcs
            messages.append(msg_to_add)

            # 执行工具
            for tc in sorted_tcs:
                func_name = tc["function"]["name"]
                func_args = json.loads(tc["function"]["arguments"])
                yield {"type": "tool_call", "tool": func_name, "args": func_args}

                result = ""
                if func_name in tool_functions:
                    try:
                        result = str(tool_functions[func_name](**func_args))
                        if len(result) > 3000:
                            result = result[:3000] + "\n...(结果已截断)"
                    except Exception as e:
                        result = f"工具执行失败: {e}"
                else:
                    result = f"未知工具: {func_name}"

                yield {"type": "tool_result", "tool": func_name, "result": result}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": func_name,
                    "content": result,
                })

            iteration += 1

        yield {"type": "done"}

    def _call_llm(
        self,
        messages: list[dict],
        tools: list[dict] | None,
        model: str,
        max_tokens: int,
        reasoning_split: bool,
    ) -> dict:
        """底层 LLM 调用"""
        import concurrent.futures

        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "reasoning_split": reasoning_split,
        }
        # 有 tools 时才传入
        if tools:
            payload["tools"] = tools

        def _call():
            with httpx.Client() as client:
                response = client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._get_headers(),
                    json=payload,
                    timeout=60.0,
                )
                response.raise_for_status()
                return response.json()

        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(_call)
            return future.result()

    def _has_tool_calls(self, response: dict) -> bool:
        """检查响应是否包含 tool_calls"""
        choices = response.get("choices", [])
        if not choices:
            return False
        message = choices[0].get("message", {})
        return bool(message.get("tool_calls"))

    def _extract_reasoning(self, message: dict, reasoning_split: bool) -> str:
        """提取思考内容"""
        if reasoning_split:
            # reasoning_split=True 时，思考在 reasoning_details 字段
            details = message.get("reasoning_details", [])
            if details:
                return details[0].get("text", "")
        # reasoning_split=False 时，思考在 content 的 thinking 标签中
        content = message.get("content", "")
        if "Thinking" in content:
            import re
            thinks = re.findall(r'Thinking(.*?)Thinking', content, re.DOTALL)
            return "\n".join(t.strip() for t in thinks if t.strip())
        return ""

    def _build_assistant_message(self, message: dict, reasoning_split: bool) -> dict:
        """构建要加入历史的 assistant message

        必须保留完整信息（含 tool_calls 和 reasoning_details），
        否则会中断 Interleaved Thinking 链路
        """
        msg: dict[str, Any] = {"role": "assistant", "content": message.get("content", "")}

        if message.get("tool_calls"):
            msg["tool_calls"] = message["tool_calls"]

        if reasoning_split and message.get("reasoning_details"):
            msg["reasoning_details"] = message["reasoning_details"]

        return msg
