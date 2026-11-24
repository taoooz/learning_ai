"""实测 litellm 网关对大 JSON schema 的 response_format json_schema(strict) 支持。

背景：B2 批次（2026-11-23）只验证过小 schema（{"ok":true,"n":3}）。
本脚本用章节计划 / architect 两阶段的代表性大 schema 实测：
  1. small_strict          — 复测 B2 小样例基线
  2. chapter_plan_large    — 章节计划 10 字段任务 schema，非流式、无 tools
  3. chapter_plan_tools    — 同 schema + tools(web_search)，观察模型是否仍发起工具调用
  4. chapter_plan_stream   — 同 schema，stream=True
  5. architect_chapters    — architect 第一阶段嵌套 schema，stream=True
  6. architect_meta        — architect 第二阶段 schema（含 nullable 数组），非流式
  7. bad_schema_negative   — 故意不合规的 strict schema（缺 required），观察网关拒绝行为

运行：.venv/bin/python scripts/probe_strict_schema.py
凭证：python-agent/.env（LLM_API_KEY / LLM_API_BASE / LLM_MODEL）
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

BASE = os.getenv("LLM_API_BASE", "http://muses-openapi-prod.weizhipin.com/v1")
KEY = os.getenv("LLM_API_KEY", "")
MODEL = os.getenv("LLM_MODEL", "ark/deepseek-v4-1-flash")

TEACHING_PATTERNS = [
    "explain", "worked_example", "compare", "process",
    "derive", "practice", "case_analysis", "recap",
]

CHAPTER_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "taskId": {"type": "string"},
                    "order": {"type": "integer"},
                    "title": {"type": "string"},
                    "objectiveId": {"type": "string"},
                    "taskGoal": {"type": "string"},
                    "observableOutcome": {"type": "string"},
                    "conceptKeys": {"type": "array", "items": {"type": "string"}},
                    "prerequisiteTaskIds": {"type": "array", "items": {"type": "string"}},
                    "teachingPattern": {"type": "string", "enum": TEACHING_PATTERNS},
                    "expectedMinutes": {"type": "integer"},
                },
                "required": [
                    "taskId", "order", "title", "objectiveId", "taskGoal",
                    "observableOutcome", "conceptKeys", "prerequisiteTaskIds",
                    "teachingPattern", "expectedMinutes",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["tasks"],
    "additionalProperties": False,
}

ARCHITECT_CHAPTERS_SCHEMA = {
    "type": "object",
    "properties": {
        "architectureVersion": {"type": "integer", "enum": [1]},
        "courseTopic": {"type": "string"},
        "chapters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "chapterId": {"type": "string"},
                    "title": {"type": "string"},
                    "roleInCourse": {"type": "string"},
                    "conceptIds": {"type": "array", "items": {"type": "string"}},
                    "deliverable": {"type": "string"},
                    "prerequisites": {"type": "array", "items": {"type": "string"}},
                    "assessmentMode": {"type": "string", "enum": ["none", "self_report", "checkpoint"]},
                },
                "required": [
                    "chapterId", "title", "roleInCourse", "conceptIds",
                    "deliverable", "prerequisites", "assessmentMode",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["architectureVersion", "courseTopic", "chapters"],
    "additionalProperties": False,
}

ARCHITECT_META_SCHEMA = {
    "type": "object",
    "properties": {
        "thesis": {
            "type": "object",
            "properties": {
                "audience": {"type": "string"},
                "currentBoundary": {"type": "array", "items": {"type": "string"}},
                "targetCapability": {"type": "string"},
                "learningDelta": {"type": "array", "items": {"type": "string"}},
                "nonGoals": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["audience", "currentBoundary", "targetCapability", "learningDelta", "nonGoals"],
            "additionalProperties": False,
        },
        "conceptGraph": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "conceptId": {"type": "string"},
                    "label": {"type": "string"},
                    "targetDepth": {"type": "string", "enum": ["skip", "refresh", "understand", "apply", "transfer"]},
                    "rationale": {"type": "string"},
                    "prerequisiteConceptIds": {"type": "array", "items": {"type": "string"}},
                    "evidenceIds": {"type": ["array", "null"], "items": {"type": "string"}},
                },
                "required": [
                    "conceptId", "label", "targetDepth", "rationale",
                    "prerequisiteConceptIds", "evidenceIds",
                ],
                "additionalProperties": False,
            },
        },
        "examplePolicy": {
            "type": "object",
            "properties": {
                "preferredDomains": {"type": "array", "items": {"type": "string"}},
                "personalExampleLimit": {"type": "integer"},
                "avoidRepeatedScenarios": {"type": "boolean"},
            },
            "required": ["preferredDomains", "personalExampleLimit", "avoidRepeatedScenarios"],
            "additionalProperties": False,
        },
    },
    "required": ["thesis", "conceptGraph", "examplePolicy"],
    "additionalProperties": False,
}

WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_search",
        "description": "联网搜索，返回结果摘要与来源",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "搜索关键词"}},
            "required": ["query"],
        },
    },
}


def rf(schema: dict, name: str) -> dict:
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def check_schema(value, schema: dict, path: str = "$") -> list[str]:
    """极简 strict schema 符合性检查（required/type/enum/additionalProperties）。"""
    problems: list[str] = []
    expected = schema.get("type")
    types = expected if isinstance(expected, list) else [expected]
    type_map = {
        "object": dict, "array": list, "string": str,
        "integer": int, "number": (int, float), "boolean": bool, "null": type(None),
    }
    if not any(isinstance(value, type_map[t]) for t in types if t in type_map):
        return [f"{path}: 期望 {expected}，实际 {type(value).__name__}"]
    if "enum" in schema and value not in schema["enum"]:
        problems.append(f"{path}: {value!r} 不在 enum {schema['enum']}")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                problems.append(f"{path}: 缺 required 字段 {key}")
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    problems.append(f"{path}: 多余字段 {key}")
        for key, sub in props.items():
            if key in value:
                problems.extend(check_schema(value[key], sub, f"{path}.{key}"))
    elif isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            problems.extend(check_schema(item, schema["items"], f"{path}[{index}]"))
    return problems


def post(body: dict, stream: bool = False):
    headers = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    url = f"{BASE}/chat/completions"
    started = time.monotonic()
    if not stream:
        response = httpx.post(url, headers=headers, json=body, timeout=120.0)
        elapsed = int((time.monotonic() - started) * 1000)
        if response.status_code >= 400:
            return {"error": response.status_code, "body": response.text[:400], "ms": elapsed}
        data = response.json()
        message = data["choices"][0]["message"]
        return {
            "content": message.get("content") or "",
            "tool_calls": message.get("tool_calls"),
            "finish_reason": data["choices"][0].get("finish_reason"),
            "usage": data.get("usage"),
            "ms": elapsed,
        }
    content = ""
    tool_calls: dict[int, dict] = {}
    finish_reason = None
    with httpx.Client() as client:
        with client.stream("POST", url, headers=headers, json=body, timeout=120.0) as response:
            if response.status_code >= 400:
                return {"error": response.status_code, "body": response.read().decode()[:400]}
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:]
                if data == "[DONE]":
                    break
                chunk = json.loads(data)
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {})
                finish_reason = choices[0].get("finish_reason") or finish_reason
                content += delta.get("content") or ""
                for tc in delta.get("tool_calls") or []:
                    idx = tc.get("index", 0)
                    slot = tool_calls.setdefault(idx, {"id": "", "function": {"name": "", "arguments": ""}})
                    slot["id"] = tc.get("id") or slot["id"]
                    func = tc.get("function", {})
                    slot["function"]["name"] += func.get("name") or ""
                    slot["function"]["arguments"] += func.get("arguments") or ""
    return {
        "content": content,
        "tool_calls": [tool_calls[i] for i in sorted(tool_calls)] or None,
        "finish_reason": finish_reason,
        "ms": int((time.monotonic() - started) * 1000),
    }


def report(label: str, result: dict, schema: dict | None = None) -> dict | None:
    if "error" in result:
        print(f"[{label}] HTTP {result['error']} ({result.get('ms', '?')}ms): {result['body']}")
        return None
    content = result["content"]
    parsed = None
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        print(f"[{label}] JSON 解析失败：{exc}；content 前 200 字：{content[:200]!r}")
    problems = check_schema(parsed, schema) if (parsed is not None and schema) else []
    print(
        f"[{label}] {result['ms']}ms finish={result['finish_reason']} "
        f"tool_calls={'有' if result['tool_calls'] else '无'} "
        f"json={'OK' if parsed is not None else 'FAIL'} "
        f"schema={'OK' if parsed is not None and not problems else problems[:5]} "
        f"len={len(content)}"
    )
    if result["tool_calls"]:
        for tc in result["tool_calls"]:
            print(f"    tool_call: {tc['function']['name']}({tc['function']['arguments'][:120]})")
    return parsed


def main() -> None:
    if not KEY:
        print("缺少 LLM_API_KEY")
        sys.exit(1)
    print(f"endpoint={BASE} model={MODEL}")
    base_body = {"model": MODEL, "max_tokens": 3000, "reasoning_effort": "none"}

    # 1. 小 schema 基线
    small = {"type": "object", "properties": {"ok": {"type": "boolean"}, "n": {"type": "integer"}},
             "required": ["ok", "n"], "additionalProperties": False}
    report("small_strict", post({**base_body, "max_tokens": 100,
        "messages": [{"role": "user", "content": '输出 {"ok": true, "n": 3}'}],
        "response_format": rf(small, "small")}), small)

    # 2. 章节计划大 schema，非流式无 tools
    plan_messages = [
        {"role": "system", "content": "你是课程计划架构师。只返回 JSON。"},
        {"role": "user", "content": (
            "为章节「提示词的指令与上下文」生成 3 个学习任务。课程目标 obj-1：能写出指令清晰的提示词。"
            "taskId 取 t1/t2/t3，order 从 1 递增，objectiveId 固定 obj-1，"
            "teachingPattern 从枚举单选，expectedMinutes 为 2～6 整数，"
            "prerequisiteTaskIds 填前一个任务的 taskId（首个为空数组）。"
        )},
    ]
    report("chapter_plan_large", post({**base_body, "messages": plan_messages,
        "response_format": rf(CHAPTER_PLAN_SCHEMA, "chapter_plan")}), CHAPTER_PLAN_SCHEMA)

    # 3. 大 schema + tools：模型是否仍发起搜索
    tools_messages = [
        {"role": "system", "content": "你是课程计划架构师。证据不足时先用 web_search 搜索，再输出 JSON 计划。"},
        {"role": "user", "content": (
            "为章节「RAG 检索增强生成」生成 3 个学习任务（目标 obj-1：能搭建最小 RAG 链路）。"
            "本地没有证据，请先调用 web_search 搜索「RAG 检索增强生成 最小实现」，再输出计划。"
        )},
    ]
    tools_result = post({**base_body, "messages": tools_messages, "tools": [WEB_SEARCH_TOOL],
        "response_format": rf(CHAPTER_PLAN_SCHEMA, "chapter_plan")})
    report("chapter_plan_tools", tools_result, CHAPTER_PLAN_SCHEMA)
    if tools_result.get("tool_calls"):
        # 第二轮：喂回工具结果，验证最终输出仍受 schema 约束
        tc = tools_result["tool_calls"][0]
        followup = tools_messages + [
            {"role": "assistant", "content": tools_result["content"] or None,
             "tool_calls": [{"id": tc["id"], "type": "function", "function": tc["function"]}]},
            {"role": "tool", "tool_call_id": tc["id"],
             "content": "搜索结果：RAG = 检索 + 生成。最小链路：文档切块→向量化→检索 top-k→拼上下文→LLM 生成。来源：示例文档（证据ID ev-demo-01）"},
        ]
        report("chapter_plan_tools_round2", post({**base_body, "messages": followup,
            "response_format": rf(CHAPTER_PLAN_SCHEMA, "chapter_plan")}), CHAPTER_PLAN_SCHEMA)

    # 4. 大 schema + stream
    report("chapter_plan_stream", post({**base_body, "messages": plan_messages, "stream": True,
        "response_format": rf(CHAPTER_PLAN_SCHEMA, "chapter_plan")}, stream=True), CHAPTER_PLAN_SCHEMA)

    # 5. architect 章节 schema + stream
    architect_messages = [
        {"role": "system", "content": "你是课程架构师。只返回 JSON，不要解释。"},
        {"role": "user", "content": (
            "为主题「推荐系统核心链路」设计 2 章目录。architectureVersion 固定 1；"
            "chapterId 取 ch-1/ch-2；conceptIds 用完整语义 ID（如 c1-recall-ranking）；"
            "deliverable 是可观察的行为或产物；assessmentMode 从枚举选；prerequisites 填前置 chapterId。"
        )},
    ]
    report("architect_chapters_stream", post({**base_body, "messages": architect_messages, "stream": True,
        "response_format": rf(ARCHITECT_CHAPTERS_SCHEMA, "course_chapters")}, stream=True), ARCHITECT_CHAPTERS_SCHEMA)

    # 6. architect meta schema（nullable 数组）非流式
    meta_messages = [
        {"role": "system", "content": "你是课程架构师。只返回 JSON，不要解释。"},
        {"role": "user", "content": (
            "章节已固定：ch-1 推荐链路职责边界（概念 c1-recall-ranking）、ch-2 推荐效果评估（概念 c2-metrics）。"
            "补全 thesis、conceptGraph（两个概念都要覆盖，targetDepth 从枚举选，evidenceIds 可为 null 或字符串数组）、"
            "examplePolicy（personalExampleLimit 0～3 整数）。"
        )},
    ]
    report("architect_meta", post({**base_body, "messages": meta_messages,
        "response_format": rf(ARCHITECT_META_SCHEMA, "course_meta")}), ARCHITECT_META_SCHEMA)

    # 7. 负样例：strict schema 缺 required，观察网关拒绝行为（校准降级判定）
    bad = {"type": "object", "properties": {"x": {"type": "string"}}, "additionalProperties": False}
    report("bad_schema_negative", post({**base_body, "max_tokens": 100,
        "messages": [{"role": "user", "content": '输出 {"x": "y"}'}],
        "response_format": rf(bad, "bad")}), None)


if __name__ == "__main__":
    main()
