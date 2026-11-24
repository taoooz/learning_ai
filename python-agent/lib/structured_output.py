"""response_format json_schema(strict) 迁移基础设施。

背景（2026-11-23 实测，litellm 网关 + ark/deepseek-v4-1-flash）：
- 小/大 strict schema 均真实强制约束输出（scripts/probe_strict_schema.py 七用例）；
- response_format 与 tools 可同传：工具轮正常发起 tool_calls，最终轮输出仍受 schema 约束；
- 流式（stream=True）同样受约束；nullable 用 type 联合（如 ["array","null"]）可用；
- 网关不校验 strict schema 自身的合规性（缺 required 也返回 200），
  因此 schema 合法性由本模块 validate_strict_schema 在测试中把关。

降级链：json_schema → json_object → 不带 response_format。
网关以 4xx 拒绝 response_format 时自动逐级降级并记日志，保证生产不炸。
env 开关 LLM_STRICT_JSON_SCHEMA=0 可整体退回 B2 的 json_object 现状。
"""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

STRICT_JSON_SCHEMA_ENV = "LLM_STRICT_JSON_SCHEMA"

# 网关拒绝 response_format 的典型状态码：
# 400 参数不支持 / 404 路由或模型不支持该能力 / 415 媒体类型 / 422 参数校验失败
_RESPONSE_FORMAT_REJECTION_STATUSES = (400, 404, 415, 422)


def strict_schema_enabled() -> bool:
    """迁移总开关：默认启用；显式置 0/false/off/no 时退回 json_object。"""
    return os.getenv(STRICT_JSON_SCHEMA_ENV, "1").strip().lower() not in ("0", "false", "off", "no")


def json_schema_format(name: str, schema: dict) -> dict:
    """构造 OpenAI 兼容的 json_schema(strict) response_format。"""
    return {
        "type": "json_schema",
        "json_schema": {"name": name, "strict": True, "schema": schema},
    }


def plan_response_format(name: str, schema: dict) -> dict:
    """主路径大 JSON 调用的 response_format：开关开启用 strict schema，否则 json_object。"""
    if strict_schema_enabled():
        return json_schema_format(name, schema)
    return {"type": "json_object"}


def downgrade_response_format(response_format: dict | None) -> dict | None:
    """逐级降级：json_schema → json_object → None（不带约束）。"""
    if not response_format:
        return None
    if response_format.get("type") == "json_schema":
        return {"type": "json_object"}
    return None


def is_response_format_rejection(status_code: int) -> bool:
    """判断 HTTP 状态码是否可能是网关拒绝 response_format（而非瞬时故障）。"""
    return status_code in _RESPONSE_FORMAT_REJECTION_STATUSES


def apply_response_format_downgrade(payload: dict, context: str, status_code: int) -> bool:
    """就地把 payload 的 response_format 降一级并记日志。

    返回 True 表示发生了降级（调用方应立即重试）；False 表示无可降级项。
    """
    current = payload.get("response_format")
    if not current or not is_response_format_rejection(status_code):
        return False
    downgraded = downgrade_response_format(current)
    logger.warning(
        "[structured-output] %s: 网关拒绝 response_format(type=%s, status=%s)，降级为 %s",
        context,
        current.get("type"),
        status_code,
        downgraded.get("type") if downgraded else "无约束",
    )
    if downgraded:
        payload["response_format"] = downgraded
    else:
        payload.pop("response_format", None)
    return True


def validate_strict_schema(schema: dict, path: str = "$") -> list[str]:
    """校验 JSON Schema 是否满足 strict 模式约束（OpenAI structured outputs 规则）。

    规则：根节点为 object；每个 object 节点 additionalProperties 必须为 false、
    required 必须覆盖全部 properties；任何节点不允许 default。
    返回问题列表（空列表 = 合规）。网关不做此校验，由回归测试把关。
    """
    problems: list[str] = []
    if path == "$" and schema.get("type") != "object":
        problems.append("$: strict 模式根节点必须是 object")

    def walk(node: dict, where: str) -> None:
        if not isinstance(node, dict):
            return
        if "default" in node:
            problems.append(f"{where}: strict 模式不允许 default")
        node_type = node.get("type")
        types = node_type if isinstance(node_type, list) else [node_type]
        if "object" in types:
            if node.get("additionalProperties") is not False:
                problems.append(f"{where}: object 节点必须 additionalProperties: false")
            properties = node.get("properties", {})
            required = set(node.get("required", []))
            missing = set(properties) - required
            if missing:
                problems.append(f"{where}: required 未覆盖字段 {sorted(missing)}")
            for key, sub in properties.items():
                walk(sub, f"{where}.{key}")
        if "array" in types and isinstance(node.get("items"), dict):
            walk(node["items"], f"{where}[]")

    walk(schema, path)
    return problems
