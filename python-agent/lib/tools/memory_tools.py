"""模型按需检索 Memory V4 的只读工具。"""
from __future__ import annotations

import json
import re
from typing import Callable

from services.memory_v4_store import MemoryV4Store


MEMORY_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "memory_search",
        "description": (
            "按需检索学习者的长期记忆。只有在当前规划摘要不足以判断背景、已掌握内容、"
            "薄弱概念或教学偏好时调用。返回可教学内容摘要，不返回内部 record ID。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "要查找的背景、概念、偏好或学习经历关键词",
                },
                "max_results": {
                    "type": "integer",
                    "description": "最多返回几条记忆，默认 5，最多 8",
                },
            },
            "required": ["query"],
        },
    },
}

MEMORY_SEARCH_POLICY = """## Memory 检索策略
- 输入中的 Planning Memory 与画像只是已筛选摘要，不是全量长期记忆。
- 只有当摘要不足以判断学习者背景、已掌握内容、薄弱概念或教学偏好时，才调用 memory_search。
- memory_search 的结果不包含内部 record ID；不要臆测或编造未检索到的个人背景。
- 已经获得足够信息时不要为了“更了解用户”而重复检索。"""


def _terms(text: str) -> set[str]:
    normalized = text.lower().strip()
    terms = set(re.findall(r"[a-z0-9_]+", normalized))
    cjk = "".join(re.findall(r"[一-鿿]", normalized))
    terms.update(cjk[index:index + 2] for index in range(max(0, len(cjk) - 1)))
    return terms


def create_memory_search(account_id: str) -> Callable[..., str]:
    def memory_search(query: str, max_results: int = 5) -> str:
        query = str(query or "").strip()
        if not query:
            return "检索关键词为空。"
        limit = max(1, min(8, int(max_results or 5)))
        try:
            store = MemoryV4Store().load_store(account_id)
        except Exception as exc:  # noqa: BLE001 调试工具只返回可读错误
            return f"记忆检索失败：{exc}"

        query_terms = _terms(query)
        ranked = []
        for record in store.get("records") or []:
            if record.get("status") != "active":
                continue
            text = " ".join([
                str(record.get("title") or ""),
                str(record.get("summary") or ""),
                str(record.get("content") or ""),
                " ".join(str(item) for item in record.get("conceptKeys") or []),
                " ".join(str(item) for item in record.get("tags") or []),
            ])
            if query.lower() in text.lower():
                score = 10
            else:
                record_terms = _terms(text)
                score = len(query_terms & record_terms) / max(1, len(query_terms))
            if score <= 0:
                continue
            ranked.append((score, float(record.get("importance") or 0), record))

        ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
        selected = [item[2] for item in ranked[:limit]]
        if not selected:
            return "没有找到相关记忆。"

        results = []
        for record in selected:
            results.append({
                "kind": record.get("kind"),
                "title": record.get("title"),
                "summary": record.get("summary"),
                "content": str(record.get("content") or "")[:800],
                "conceptKeys": record.get("conceptKeys") or [],
            })
        return json.dumps(results, ensure_ascii=False, indent=2)

    return memory_search
