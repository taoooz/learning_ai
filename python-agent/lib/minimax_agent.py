"""
MiniMax Agent 客户端 — 支持 function calling 的 Agent 循环
基于 MiniMaxClient 扩展，增加 tools 调用能力
"""
import json
import re
import httpx
from typing import Iterator, Callable, Any
from lib.minimax import MiniMaxClient


def _clean_tool_xml(content: str) -> str:
    """清理 content 中的 XML 格式工具调用标签"""
    content = re.sub(r'<minimax:tool_call>.*?</minimax:tool_call>', '', content, flags=re.DOTALL)
    content = re.sub(r'<minimax:tool_call>.*', '', content, flags=re.DOTALL)
    content = re.sub(r'<invoke\s+name=["\'][^"\']*["\']\s*>.*?</invoke\s*>', '', content, flags=re.DOTALL)
    content = re.sub(r'<invoke\s+name="[^"]*>.*?</invoke\s*>', '', content, flags=re.DOTALL)
    content = re.sub(r"<invoke\s+name='[^']*>.*?</invoke\s*>", '', content, flags=re.DOTALL)
    content = re.sub(r'<invoke\s+[^>]*>.*', '', content, flags=re.DOTALL)
    return content.strip()


def _extract_tool_calls_from_content(content: str) -> list[dict] | None:
    """从 content 中解析模型错误输出的 <invoke> 格式工具调用"""
    tool_calls = []
    for m in re.finditer(r'<invoke\s+name=["\'](\w+)["\']\s*>(.*?)</invoke\s*>', content, re.DOTALL):
        tool_name = m.group(1)
        body = m.group(2)
        params = {}
        for pm in re.finditer(r'<parameter\s+name=["\'](\w+)["\']>(.*?)</parameter>', body, re.DOTALL):
            params[pm.group(1)] = pm.group(2)
        tool_calls.append({"name": tool_name, "arguments": params})
    return tool_calls if tool_calls else None


def _do_streaming_call(
    client: "AgentClient",
    payload: dict,
    max_retries: int = 3,
) -> Iterator[dict]:
    """执行一次流式 HTTP 请求，实时 yield thinking/content，最后 yield 完整响应

    Yields:
        - {"type": "thinking", "message": "..."} — reasoning token 片段
        - {"type": "response", "response": {...}} — 完整累积的响应 dict
    """
    import sys

    for attempt in range(max_retries):
        full_content = ""
        full_reasoning = ""
        tool_calls_accum: dict[int, dict] = {}
        finish_reason = None

        # 重复检测：追踪最近 N 个 thinking chunk，检测模型退化循环
        _recent_thinking_chunks: list[str] = []
        _repeat_count = 0
        _MAX_REPEAT = 3  # 同一段文本连续出现 3 次即判定为循环

        try:
            with httpx.Client() as http_client:
                with http_client.stream("POST", f"{client.base_url}/chat/completions",
                    headers=client._get_headers(),
                    json=payload,
                    timeout=90.0,
                ) as response:
                    if response.status_code >= 400:
                        error_body = ""
                        for line in response.iter_lines():
                            error_body += line
                            if len(error_body) > 300:
                                break
                        sys.stderr.write(f"[ERROR] MiniMax API error: status={response.status_code}, body={error_body[:300]}\n")
                        sys.stderr.flush()
                        # 529/500/502/503 可重试
                        if response.status_code in (529, 500, 502, 503) and attempt < max_retries - 1:
                            wait = 2 ** attempt
                            sys.stderr.write(f"[RETRY] attempt {attempt+1}/{max_retries} failed ({response.status_code}), waiting {wait}s...\n")
                            sys.stderr.flush()
                            import time
                            time.sleep(wait)
                            continue  # 重试
                        response.raise_for_status()

                    for line in response.iter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue

                        choices = chunk.get("choices", [])
                        if not choices:
                            continue

                        delta = choices[0].get("delta", {})
                        finish_reason = choices[0].get("finish_reason", finish_reason)

                        reasoning_content = delta.get("reasoning_content")
                        if reasoning_content:
                            full_reasoning += reasoning_content
                            yield {"type": "thinking", "message": reasoning_content.rstrip('\n')}

                            # 重复检测：模型退化循环时同一段文本会反复出现
                            _recent_thinking_chunks.append(reasoning_content.strip())
                            if len(_recent_thinking_chunks) > _MAX_REPEAT:
                                _recent_thinking_chunks.pop(0)
                            if len(_recent_thinking_chunks) >= _MAX_REPEAT and len(set(_recent_thinking_chunks)) == 1 and _recent_thinking_chunks[0]:
                                sys.stderr.write(f"[WARN] 检测到 thinking 重复循环，提前终止流: {repr(_recent_thinking_chunks[0][:80])}\n")
                                sys.stderr.flush()
                                finish_reason = "stop"
                                break

                        content = delta.get("content")
                        if content:
                            full_content += content
                            if not any(tag in content for tag in ('<invoke', '</minimax:tool_call>')):
                                yield {"type": "content_delta", "content": content.rstrip('\n')}

                        delta_tool_calls = delta.get("tool_calls")
                        if delta_tool_calls:
                            for tc in delta_tool_calls:
                                idx = tc.get("index", 0)
                                if idx not in tool_calls_accum:
                                    tool_calls_accum[idx] = {
                                        "id": tc.get("id", ""),
                                        "type": tc.get("type", "function"),
                                        "function": {"name": "", "arguments": ""},
                                    }
                                func = tc.get("function", {})
                                if func.get("name"):
                                    tool_calls_accum[idx]["function"]["name"] = func["name"]
                                if func.get("arguments"):
                                    tool_calls_accum[idx]["function"]["arguments"] += func["arguments"]

            # 构建完整响应
            complete_message: dict[str, Any] = {"role": "assistant", "content": full_content}
            if tool_calls_accum:
                complete_message["tool_calls"] = [tool_calls_accum[i] for i in sorted(tool_calls_accum)]
            reasoning_split = payload.get("reasoning_split", True)
            if reasoning_split and full_reasoning:
                complete_message["reasoning_details"] = [{"text": full_reasoning}]

            yield {"type": "response", "response": {
                "choices": [{"message": complete_message, "finish_reason": finish_reason}]
            }}
            return  # 成功完成

        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status in (529, 500, 502, 503) and attempt < max_retries - 1:
                wait = 2 ** attempt
                sys.stderr.write(f"[RETRY] httpx status={status}, attempt {attempt+1}/{max_retries}, waiting {wait}s...\n")
                sys.stderr.flush()
                import time
                time.sleep(wait)
                continue
            raise

    # 所有重试都失败（不会执行到这里，raise 已抛出）
    raise RuntimeError(f"MiniMax API failed after {max_retries} retries")

class AgentClient(MiniMaxClient):
    """支持 function calling 的 MiniMax 客户端"""

    def chat_with_tools(self, messages, tools, tool_functions,
                        model=None, max_tokens=2000,
                        reasoning_split=True, max_iterations=3) -> dict:
        """同步调用 chat API，自动处理 tool_calls 循环"""
        model = model or self.model
        iteration = 0
        while iteration < max_iterations:
            response = self._call_llm(messages, tools, model, max_tokens, reasoning_split)
            choice = response.get("choices", [{}])[0]
            message = choice.get("message", {})

            if not self._has_tool_calls(response):
                return response

            messages.append(self._build_assistant_message(message, reasoning_split))

            for tc in message.get("tool_calls", []):
                func_name = tc["function"]["name"]
                func_args = json.loads(tc["function"]["arguments"])
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
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})

            iteration += 1

        return self._call_llm(messages, [], model, max_tokens, reasoning_split)

    def stream_chat_with_tools(
        self,
        messages: list[dict],
        tools: list[dict],
        tool_functions: dict[str, Callable],
        model: str | None = None,
        max_tokens: int = 2000,
        reasoning_split: bool = True,
        max_iterations: int = 3,
        max_searches: int = 3,
    ) -> Iterator[dict]:
        """流式 Agent 调用 — thinking 逐 token 实时推送到前端

        事件类型:
            - thinking: 思考过程（逐 token，实时）
            - tool_call: 工具调用信息
            - tool_result: 工具执行结果
            - content_delta: 内容增量
            - done: 完成标记
        """
        model = model or self.model
        iteration = 0
        search_count = 0
        stop_search_instruction_added = False
        while iteration < max_iterations:
            # 搜索次数达上限后不再传 tools，强制模型直接生成最终回答
            effective_tools = tools if search_count < max_searches else None

            # 搜索配额用完时，追加一次指令明确要求模型停止搜索、直接输出
            if search_count >= max_searches and not stop_search_instruction_added:
                messages.append({
                    "role": "user",
                    "content": "搜索次数已达上限。请直接基于已有信息生成最终回复，不要再尝试调用搜索工具。",
                })
                stop_search_instruction_added = True

            payload: dict[str, Any] = {
                "model": model,
                "messages": messages,
                "max_tokens": max_tokens,
                "stream": True,
                "reasoning_split": reasoning_split,
            }
            if effective_tools:
                payload["tools"] = effective_tools

            # 流式调用 — thinking/content token 实时 yield，最后得到完整响应
            response = None
            for event in _do_streaming_call(self, payload):
                if event["type"] in ("thinking", "content_delta"):
                    yield event  # 实时推送到前端
                elif event["type"] == "response":
                    response = event["response"]

            choice = response.get("choices", [{}])[0]
            message = choice.get("message", {})

            if not self._has_tool_calls(response):
                content = message.get("content", "")

                # 仅在搜索配额未用完时才从 content 中提取 XML 工具调用
                # 搜索配额用完后，忽略模型误输出的 XML，直接视为最终内容
                extracted_calls = _extract_tool_calls_from_content(content) if search_count < max_searches else None

                if extracted_calls:
                    clean_content = _clean_tool_xml(content)
                    # 构造带 tool_calls 的 assistant message，使 MiniMax 能正确关联 tool result
                    import uuid
                    synthetic_tool_calls = []
                    for call_info in extracted_calls:
                        call_id = f"call_{uuid.uuid4().hex[:12]}"
                        synthetic_tool_calls.append({
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": call_info["name"],
                                "arguments": json.dumps(call_info["arguments"], ensure_ascii=False),
                            },
                        })
                    messages.append({"role": "assistant", "content": clean_content, "tool_calls": synthetic_tool_calls})

                    for i, call_info in enumerate(extracted_calls):
                        func_name = call_info["name"]
                        func_args = call_info["arguments"]
                        call_id = synthetic_tool_calls[i]["id"]
                        if func_name == "web_search":
                            search_count += 1
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
                            "tool_call_id": call_id,
                            "content": result,
                        })

                    iteration += 1
                    if iteration < max_iterations:
                        continue
                    else:
                        yield {"type": "done"}
                        return

                # 无工具调用，content_delta 已在流中推送，直接结束
                yield {"type": "done"}
                return

            # 处理 tool_calls
            tool_calls = message.get("tool_calls", [])
            messages.append(self._build_assistant_message(message, reasoning_split))

            for tc in tool_calls:
                func_name = tc["function"]["name"]
                func_args = json.loads(tc["function"]["arguments"])
                if func_name == "web_search":
                    search_count += 1
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
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result})

            iteration += 1

        # 超过最大迭代次数，最终调用（无 tools）
        final_payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "stream": True,
            "reasoning_split": reasoning_split,
        }
        for event in _do_streaming_call(self, final_payload):
            if event["type"] in ("thinking", "content_delta"):
                yield event
            elif event["type"] == "response":
                final_message = event["response"].get("choices", [{}])[0].get("message", {})
                # content_delta 已在流中推送，这里不再重复

        yield {"type": "done"}

    # ---- 以下为内部方法 ----

    def _call_llm(self, messages, tools, model, max_tokens, reasoning_split, max_retries=3):
        """非流式 LLM 调用（自动重试），仅供 chat_with_tools 使用"""
        import concurrent.futures
        import time

        payload: dict[str, Any] = {
            "model": model, "messages": messages,
            "max_tokens": max_tokens, "reasoning_split": reasoning_split,
        }
        if tools:
            payload["tools"] = tools

        def _call():
            with httpx.Client() as client:
                response = client.post(
                    f"{self.base_url}/chat/completions",
                    headers=self._get_headers(), json=payload, timeout=90.0,
                )
                if response.status_code >= 400:
                    import sys
                    sys.stderr.write(f"[ERROR] MiniMax API error: status={response.status_code}, body={response.text[:300]}\n")
                    sys.stderr.flush()
                response.raise_for_status()
                return response.json()

        last_error = None
        for attempt in range(1, max_retries + 1):
            try:
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(_call)
                    return future.result()
            except (httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout) as e:
                last_error = e
                status = getattr(getattr(e, 'response', None), 'status_code', None)
                if status not in (429, 500, 529, 502, 503) and not isinstance(e, (httpx.ReadTimeout, httpx.ConnectError)):
                    raise
                wait = 2 ** attempt
                print(f"[MiniMax] API error {status or type(e).__name__}, retry {attempt}/{max_retries} in {wait}s...")
                time.sleep(wait)
        raise last_error  # type: ignore

    def _has_tool_calls(self, response: dict) -> bool:
        choices = response.get("choices", [])
        if not choices:
            return False
        return bool(choices[0].get("message", {}).get("tool_calls"))

    def _extract_reasoning(self, message: dict, reasoning_split: bool) -> str:
        if reasoning_split:
            details = message.get("reasoning_details", [])
            if details:
                return details[0].get("text", "")
        content = message.get("content", "")
        if "Thinking" in content:
            thinks = re.findall(r'Thinking(.*?)Thinking', content, re.DOTALL)
            return "\n".join(t.strip() for t in thinks if t.strip())
        return ""

    def _build_assistant_message(self, message: dict, reasoning_split: bool) -> dict:
        msg: dict[str, Any] = {"role": "assistant", "content": message.get("content", "")}
        if message.get("tool_calls"):
            msg["tool_calls"] = message["tool_calls"]
        if reasoning_split and message.get("reasoning_details"):
            msg["reasoning_details"] = message["reasoning_details"]
        return msg
