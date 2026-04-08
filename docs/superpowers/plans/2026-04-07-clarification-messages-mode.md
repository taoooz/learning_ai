# 澄清环节 Messages 数组模式改造

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将澄清环节从"每次重新拼接完整 prompt"改为"messages 数组多轮对话"，消除 AI 重复思考用户背景的问题。

**Architecture:** 改造 `stream_llm_and_parse` 使其接受 messages 数组而非单个 prompt 字符串。改造 `answer_question` 端点，在 session 中保存每轮 AI 的完整回复（去掉 think 标签后的纯正文），构建真正的多轮 messages 数组传给 MiniMax API。

**Tech Stack:** Python (FastAPI), MiniMax API (messages 数组), SSE

---

### Task 1: 改造 `stream_llm_and_parse` 支持 messages 数组

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/outline_service.py:190-221`

- [ ] **Step 1: 修改 `stream_llm_and_parse`，新增 `messages` 参数**

将函数签名从 `stream_llm_and_parse(prompt: str, ...)` 改为 `stream_llm_and_parse(messages: list[dict], ...)`。当传入旧格式的 prompt 字符串时自动包装为 messages 数组，保持向后兼容。

```python
async def stream_llm_and_parse(messages: list[dict] | str, max_tokens: int = 1000):
    """流式调用 LLM，yield thinking + content_delta 事件
    messages: messages 数组，或单个 prompt 字符串（自动包装）
    """
    # 向后兼容：如果传入字符串，自动包装为 messages
    if isinstance(messages, str):
        messages = [{"role": "system", "content": ""}, {"role": "user", "content": messages}]

    client = get_client()
    full_content = ""

    for chunk in client.stream_chat_sync(
        messages=messages,
        max_tokens=max_tokens,
    ):
        delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
        if not delta:
            continue

        full_content += delta
        yield {"type": "content_delta", "content": delta}

    # 处理完整内容，提取 thinking 和正文
    import re
    think_pattern = r'默默思考.*?真的在思考'
    thinks = re.findall(think_pattern, full_content, re.DOTALL)

    # 移除 think 标签，得到正文
    content_without_think = re.sub(think_pattern, '', full_content, flags=re.DOTALL).strip()

    # 如果有 thinking 内容，发送 thinking 事件
    if thinks:
        for think in thinks:
            yield {"type": "thinking", "message": think.strip()}

    # 解析问题和纲要
    parsed = parse_content_blocks(content_without_think)
    yield {"type": "__full_content__", "content": content_without_think, "parsed": parsed}
```

注意：`think_pattern` 保持与原代码一致（使用实际的 `minimax_think` 标签），请读取原文件确认实际的正则表达式并原样保留。

---

### Task 2: Session 新增 `llm_messages` 字段，保存多轮对话历史

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/outline_service.py:273-289`
- Modify: `.worktrees/agent-feature/python-agent/agents/outline/state.py` (如存在 OutlineState TypedDict)

- [ ] **Step 1: 在 `make_initial_state` 中新增 `llm_messages` 字段**

```python
def make_initial_state(topic: str, user_profile: dict, user_memory: dict) -> OutlineState:
    return {
        "session_id": "",
        "agent_type": "outline",
        "topic": topic,
        "user_profile": user_profile,
        "user_memory": user_memory,
        "messages": [],
        "llm_messages": [],  # 新增：MiniMax messages 数组，用于多轮对话
        "current_question": None,
        "question_count": 0,
        "questions_asked": [],
        "answers": [],
        "blueprint": None,
        "status": "initial",
        "needs_tools": False,
        "tool_results": [],
    }
```

---

### Task 3: 改造 `generate_outline` 端点 — 首次生成后保存 messages

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/main.py:65-98`

- [ ] **Step 1: 在 `generate_outline` 中，流式完成后保存首次 messages 到 session**

在创建 session 并处理完 `__full_content__` 事件后，将初始 prompt 和 AI 回复存入 `llm_messages`。

```python
@app.post("/api/agents/outline/generate")
async def generate_outline(req: OutlineRequest):
    """启动 outline 生成（流式）"""
    async def event_generator():
        state = make_initial_state(req.topic, req.userProfile, req.userMemory)
        prompt = build_initial_prompt(req.topic, req.userProfile, req.userMemory)
        session_id = None

        async for event in stream_llm_and_parse(prompt):
            if event["type"] == "__full_content__":
                parsed = event.get("parsed", {})

                session = session_store.create("outline", state)
                state["session_id"] = session.session_id
                session_id = session.session_id

                if parsed.get("questions"):
                    q = parsed["questions"][0]
                    state["questions_asked"].append(q["question"])
                    state["current_question"] = q

                # 新增：保存首次 messages 到 llm_messages
                ai_reply = event.get("content", "")
                state["llm_messages"] = [
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": ai_reply},
                ]

                session_store.update(session.session_id, state)
            else:
                yield f"data: {json.dumps(event)}\n\n"

        if session_id:
            yield f"data: {json.dumps({'type': 'session_created', 'sessionId': session_id})}\n\n"

        yield "data: [DONE]\n\n"

    return EventSourceResponse(event_generator(), media_type="text/event-stream")
```

---

### Task 4: 改造 `answer_question` 端点 — 用 messages 数组替代 `build_answer_prompt`

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/main.py:99-138`

- [ ] **Step 1: 重写 `answer_question`，基于 `llm_messages` 构建多轮对话**

不再调用 `build_answer_prompt`，而是在 session 的 `llm_messages` 基础上追加用户回答，直接传给 `stream_llm_and_parse`。

```python
@app.post("/api/agents/outline/answer")
async def answer_question(req: OutlineAnswerRequest):
    """提交问题答案（流式）"""
    async def event_generator():
        session = session_store.get(req.sessionId)
        if not session:
            yield f"data: {json.dumps({'type': 'error', 'message': 'Session not found'})}\n\n"
            return

        state = session.state
        state["answers"].append(req.answer)
        state["question_count"] += 1

        # 构建多轮 messages：历史 + 本轮用户回答
        llm_messages = list(state.get("llm_messages", []))
        llm_messages.append({"role": "user", "content": req.answer})

        async for event in stream_llm_and_parse(llm_messages, max_tokens=1500):
            if event["type"] == "__full_content__":
                parsed = event.get("parsed", {})

                if parsed.get("questions"):
                    q = parsed["questions"][0]
                    state["questions_asked"].append(q["question"])
                    state["current_question"] = q

                # 保存 AI 回复到 llm_messages
                ai_reply = event.get("content", "")
                llm_messages.append({"role": "assistant", "content": ai_reply})
                state["llm_messages"] = llm_messages

                session_store.update(req.sessionId, state)
            else:
                yield f"data: {json.dumps(event)}\n\n"

        yield "data: [DONE]\n\n"

    return EventSourceResponse(event_generator(), media_type="text/event-stream")
```

---

### Task 5: 清理 — 移除 `build_answer_prompt` 和相关 import

**Files:**
- Modify: `.worktrees/agent-feature/python-agent/services/outline_service.py:108-187` (删除 `build_answer_prompt` 函数)
- Modify: `.worktrees/agent-feature/python-agent/main.py:22-23` (移除 `build_answer_prompt` import)

- [ ] **Step 1: 删除 `build_answer_prompt` 函数**

删除 `outline_service.py` 中整个 `build_answer_prompt` 函数（第 108-187 行），因为它不再被使用。

- [ ] **Step 2: 更新 `main.py` 的 import**

将 `main.py` 第 22 行的 import 从：
```python
from services.outline_service import (
    build_initial_prompt, build_answer_prompt,
    stream_llm_and_parse, stream_blueprint_fields, make_initial_state
)
```
改为：
```python
from services.outline_service import (
    build_initial_prompt,
    stream_llm_and_parse, stream_blueprint_fields, make_initial_state
)
```

---

### Task 6: 验证 & 提交

- [ ] **Step 1: 启动 Python Agent 确认无语法错误**

```bash
cd .worktrees/agent-feature/python-agent && python -c "from services.outline_service import stream_llm_and_parse, make_initial_state; print('OK')"
```

Expected: `OK`

- [ ] **Step 2: 端到端测试**

手动测试流程：
1. 启动 Python Agent
2. 发送 generate 请求，收到第一个问题
3. 发送 answer 请求，观察 AI thinking 是否不再重复分析背景
4. 确认第二个问题的生成是基于前一轮对话上下文

- [ ] **Step 3: 提交**

```bash
git add .worktrees/agent-feature/python-agent/services/outline_service.py .worktrees/agent-feature/python-agent/main.py
git commit -m "refactor: 澄清环节改用 messages 数组实现多轮对话连续性

- stream_llm_and_parse 支持传入 messages 数组
- session 新增 llm_messages 字段保存完整对话历史
- answer 端点基于历史 messages 追加而非重新构建 prompt
- 删除不再使用的 build_answer_prompt 函数

Co-Authored-By: Claude <noreply@anthropic.com>"
```
