"""
MiniMax Agent 客户端 — 支持 function calling 的 Agent 循环
基于 MiniMaxClient 扩展，增加 tools 调用能力
"""
import json
import re
import httpx
from typing import Iterator, Optional, Callable, Any
from lib.minimax import MiniMaxClient


def _clean_tool_xml(content: str) -> str:
    """清理 content 中的 XML 格式工具调用标签

    MiniMax 模型有时会在 content 中输出工具调用的 XML，
    格式可能不完整或有错误（缺少闭合引号、缺少闭合标签等）。
    """
    # 1. 先清理有完整闭合标签的 <minimax:tool_call>...</minimax:tool_call>
    content = re.sub(r'<minimax:tool_call>.*?</minimax:tool_call>', '', content, flags=re.DOTALL)
    # 2. 清理没有闭合标签的 <minimax:tool_call>（从标签到内容末尾）
    content = re.sub(r'<minimax:tool_call>.*', '', content, flags=re.DOTALL)
    # 3. 清理有完整闭合标签的 <invoke name="...">...</invoke>
    content = re.sub(r'<invoke\s+name=["\'][^"\']*["\']\s*>.*?</invoke\s*>', '', content, flags=re.DOTALL)
    # 4. 清理格式错误的 <invoke>（name 缺少闭合引号）
    content = re.sub(r'<invoke\s+name="[^"]*>.*?</invoke\s*>', '', content, flags=re.DOTALL)
    content = re.sub(r"<invoke\s+name='[^']*>.*?</invoke\s*>", '', content, flags=re.DOTALL)
    # 5. 清理没有闭合标签的 <invoke>（从标签到内容末尾）
    content = re.sub(r'<invoke\s+[^>]*>.*', '', content, flags=re.DOTALL)
    return content.strip()


def _extract_tool_calls_from_content(content: str) -> list[dict] | None:
    """从 content 中解析模型错误输出的 <invoke> 格式工具调用

    MiniMax 有时会在 content 中输出 XML 格式的工具调用而不是通过 tool_calls 返回，
    例如: <minimax:tool_call><invoke name="web_search"><parameter name="query">...</parameter></invoke></minimax:tool_call>
    """
    tool_calls = []

    # 匹配所有 invoke 块
    for m in re.finditer(r'<invoke\s+name=["\'](\w+)["\']\s*>(.*?)</invoke\s*>', content, re.DOTALL):
        tool_name = m.group(1)
        body = m.group(2)
        # 提取 <parameter name="xxx">yyy</parameter> 中的参数
        params = {}
        for pm in re.finditer(r'<parameter\s+name=["\'](\w+)["\']>(.*?)</parameter>', body, re.DOTALL):
            params[pm.group(1)] = pm.group(2)
        tool_calls.append({"name": tool_name, "arguments": params})

    return tool_calls if tool_calls else None


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

            # 先将 assistant 完整响应加入历史
            messages.append(self._build_assistant_message(message, reasoning_split))

            # 再执行工具并追加结果
            for tc in tool_calls:
                func_name = tc["function"]["name"]
                func_args = json.loads(tc["function"]["arguments"])
                tool_call_id = tc["id"]

                result = ""
                if func_name in tool_functions:
                    try:
                        result = str(tool_functions[func_name](**func_args))
                        # 截断过长结果，减少 token 消耗
                        if len(result) > 1500:
                            result = result[:1500] + "\n...(结果已截断)"
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
        """支持 tools 的流式调用，yield SSE 事件

        事件类型:
            - thinking: 思考过程
            - tool_call: 工具调用信息
            - tool_result: 工具执行结果
            - content_delta: 内容增量
            - done: 完成标记
        """
        iteration = 0
        while iteration < max_iterations:
            # 首次 LLM 调用（非流式，因为需要检查 finish_reason）
            response = self._call_llm(messages, tools, model, max_tokens, reasoning_split)
            choice = response.get("choices", [{}])[0]
            message = choice.get("message", {})

            # 提取并 yield thinking
            reasoning = self._extract_reasoning(message, reasoning_split)
            if reasoning:
                yield {"type": "thinking", "message": reasoning}

            if not self._has_tool_calls(response):
                # 检查 content 中是否包含 <invoke> 格式的工具调用
                content = message.get("content", "")

                # 尝试从 content 中解析 <invoke> 格式的工具调用
                extracted_calls = _extract_tool_calls_from_content(content)

                if extracted_calls:
                    # 从 content 中去除 invoke XML
                    clean_content = _clean_tool_xml(content)

                    # 将 assistant message 加入历史
                    messages.append({"role": "assistant", "content": clean_content})

                    # 执行工具调用并追加 tool results
                    for call_info in extracted_calls:
                        func_name = call_info["name"]
                        func_args = call_info["arguments"]
                        yield {"type": "tool_call", "tool": func_name, "args": func_args}

                        result = ""
                        if func_name in tool_functions:
                            try:
                                result = str(tool_functions[func_name](**func_args))
                                if len(result) > 1500:
                                    result = result[:1500] + "\n...(结果已截断)"
                            except Exception as e:
                                result = f"工具执行失败: {e}"
                        else:
                            result = f"未知工具: {func_name}"

                        yield {"type": "tool_result", "tool": func_name, "result": result}

                        messages.append({
                            "role": "tool",
                            "tool_call_id": f"extracted_{func_name}",
                            "content": result,
                        })

                    iteration += 1
                    if iteration < max_iterations:
                        continue
                    else:
                        yield {"type": "done"}
                        return

                # 无工具调用，yield 最终内容
                content = _clean_tool_xml(content)
                if content:
                    yield {"type": "content_delta", "content": content}
                yield {"type": "done"}
                return

            # 处理 tool_calls
            tool_calls = message.get("tool_calls", [])

            # 先将 assistant message 加入历史（必须在 tool results 之前）
            messages.append(self._build_assistant_message(message, reasoning_split))

            # 再追加所有 tool results
            for tc in tool_calls:
                func_name = tc["function"]["name"]
                func_args = json.loads(tc["function"]["arguments"])
                yield {"type": "tool_call", "tool": func_name, "args": func_args}

                result = ""
                if func_name in tool_functions:
                    try:
                        result = str(tool_functions[func_name](**func_args))
                        if len(result) > 1500:
                            result = result[:1500] + "\n...(结果已截断)"
                    except Exception as e:
                        result = f"工具执行失败: {e}"
                else:
                    result = f"未知工具: {func_name}"

                yield {"type": "tool_result", "tool": func_name, "result": result}

                # 追加 tool 结果到 messages
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result,
                })

            iteration += 1

        # 超过最大迭代次数，获取最终响应
        final_response = self._call_llm(messages, [], model, max_tokens, reasoning_split)
        final_choice = final_response.get("choices", [{}])[0]
        final_message = final_choice.get("message", {})

        # 提取最终 thinking
        final_reasoning = self._extract_reasoning(final_message, reasoning_split)
        if final_reasoning:
            yield {"type": "thinking", "message": final_reasoning}

        # 提取最终内容（清理可能的 XML 格式工具调用）
        content = _clean_tool_xml(final_message.get("content", ""))
        if content:
            yield {"type": "content_delta", "content": content}

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
                    timeout=90.0,
                )
                if response.status_code >= 400:
                    import sys
                    sys.stderr.write(f"[ERROR] MiniMax API error: status={response.status_code}, body={response.text[:300]}\n")
                    sys.stderr.flush()
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
