"""Memory V4 固定维度派生视图。

原始 MemoryRecord 是唯一事实源；本模块只生成可重建的 Profile 读取模型，
不持久化为第二事实层。
"""
from __future__ import annotations

import re
from typing import Any

DIMENSION_SPECS = (
    ("direction", "学习方向"),
    ("background", "背景与可迁移经历"),
    ("preferences", "学习偏好"),
    ("teaching", "教学策略"),
    ("history", "学习轨迹"),
)

_STYLE_RULES = (
    ("分步骤解释", ("分步骤", "分步", "一步一步")),
    ("生活例子", ("例子", "举例", "比如")),
    ("类比解释", ("类比", "比喻", "打比方")),
    ("通俗解释", ("通俗", "简单点", "白话")),
    ("对比讲解", ("对比", "区别")),
)

_STRATEGY_RE = re.compile(r"补救策略「(.+?)」在概念「(.+?)」上已验证有效")


def _text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _short(value: Any, limit: int) -> str:
    text = _text(value)
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _dimension_for(record: dict[str, Any]) -> str | None:
    kind = record.get("kind")
    if kind in {"goal", "constraint"}:
        return "direction"
    if kind == "preference":
        return "preferences"
    if kind == "teaching_strategy":
        return "teaching"
    if kind == "episode":
        return "history"
    if kind == "fact":
        return "background"
    return None


def _is_rendered_record(record: dict[str, Any]) -> bool:
    if record.get("status") != "active":
        return False
    # 旧画像导入曾把 targetJob 同时写成 goal 与 fact；读取层只保留 goal。
    if record.get("dedupeKey") == "profile:targetJob:background":
        return False
    return _dimension_for(record) is not None


def _record_sort_key(record: dict[str, Any]) -> tuple[float, float, float]:
    return (
        float(record.get("importance", 0)),
        float(record.get("confidence", 0)),
        float(record.get("updatedAt", 0)),
    )


def _preference_labels(records: list[dict[str, Any]]) -> list[str]:
    labels: list[str] = []
    for record in records:
        text = _text(record.get("content"))
        matched = next((label for label, cues in _STYLE_RULES if any(cue in text for cue in cues)), None)
        label = matched or re.sub(r"^(用户多次表达偏好[:：]|重复表达的学习偏好[:：]?)", "", text).strip()
        if label and label not in labels:
            labels.append(_short(label, 18))
    return labels[:4]


def _teaching_groups(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for record in records:
        match = _STRATEGY_RE.search(_text(record.get("content")))
        strategy = match.group(1) if match else _text(record.get("title")) or "补救策略"
        concepts = [item for item in re.split(r"[、,，]", match.group(2)) if item] if match else []
        group = groups.setdefault(
            strategy,
            {"strategy": strategy, "concepts": [], "recordIds": [], "updatedAt": 0},
        )
        for concept in concepts:
            clean = concept.strip()
            if clean and clean not in group["concepts"]:
                group["concepts"].append(clean)
        group["recordIds"].append(record.get("memoryId"))
        group["updatedAt"] = max(group["updatedAt"], int(record.get("updatedAt", 0)))
    return sorted(groups.values(), key=lambda item: item["updatedAt"], reverse=True)


def _build_summary(dimension_id: str, records: list[dict[str, Any]]) -> tuple[str, list[str]]:
    records = sorted(records, key=_record_sort_key, reverse=True)
    if not records:
        return "", []

    if dimension_id == "direction":
        goals = [record for record in records if record.get("kind") == "goal"]
        constraints = [record for record in records if record.get("kind") == "constraint"]
        parts = []
        if goals:
            parts.append(_short(goals[0].get("content"), 48))
        if constraints:
            parts.append("约束：" + "、".join(_short(item.get("content"), 20) for item in constraints[:3]))
        return "；".join(parts), [_short(record.get("content"), 56) for record in records[:3]]

    if dimension_id == "background":
        user_facts = [record for record in records if record.get("sourceType") == "user_profile_input"]
        inferred = [record for record in records if record.get("sourceType") != "user_profile_input"]
        highlights = user_facts[:3] or inferred[:3]
        work_count = sum(1 for record in records if "work" in (record.get("tags") or []))
        analogy_count = sum(1 for record in records if "analogy" in (record.get("tags") or []))
        parts = []
        if work_count:
            parts.append(f"{work_count} 段工作经历")
        education_count = sum(1 for record in records if "education" in (record.get("tags") or []))
        if education_count:
            parts.append(f"{education_count} 段教育经历")
        if analogy_count:
            parts.append(f"{analogy_count} 条可迁移经历")
        summary = "、".join(parts) or f"已整理 {len(records)} 条背景事实"
        return summary, [_short(record.get("content"), 58) for record in highlights]

    if dimension_id == "preferences":
        labels = _preference_labels(records)
        summary = "偏好" + "、".join(labels) if labels else f"已整理 {len(records)} 条学习偏好"
        return summary, labels

    if dimension_id == "teaching":
        groups = _teaching_groups(records)
        concept_keys = {
            concept
            for group in groups
            for concept in group.get("concepts", [])
        }
        summary = f"已验证 {len(groups)} 种补救策略"
        if concept_keys:
            summary += f"，覆盖 {len(concept_keys)} 个概念"
        highlights = []
        for group in groups[:2]:
            concepts = "、".join(group["concepts"][:5])
            highlights.append(f"{group['strategy']}：{concepts or '当前目标概念'}")
        return summary, highlights

    if dimension_id == "history":
        episodes = sorted(records, key=lambda item: int(item.get("updatedAt", 0)), reverse=True)
        has_episode = any(record.get("kind") == "episode" for record in episodes)
        summary = f"最近 {min(len(episodes), 3)} 条学习记录" if has_episode else "暂无学习轨迹"
        highlights = [_short(record.get("title"), 42) for record in episodes[:3]]
        return summary, highlights

    return f"已整理 {len(records)} 条记忆", [_short(record.get("content"), 56) for record in records[:3]]


def build_memory_dimension_view(store: dict[str, Any]) -> list[dict[str, Any]]:
    """从原子记录派生固定五维读取视图；结果完全可重建。"""
    records = [record for record in (store.get("records") or []) if _is_rendered_record(record)]
    dimensions: list[dict[str, Any]] = []
    for dimension_id, title in DIMENSION_SPECS:
        scoped = [record for record in records if _dimension_for(record) == dimension_id]
        summary, highlights = _build_summary(dimension_id, scoped)
        dimensions.append({
            "id": dimension_id,
            "title": title,
            "summary": summary,
            "highlights": highlights,
            "recordIds": [record.get("memoryId") for record in scoped if record.get("memoryId")],
            "sourceCount": len(scoped),
            "updatedAt": max((int(record.get("updatedAt", 0)) for record in scoped), default=0),
            "sourceRevision": int(store.get("revision", 0)),
        })
    return dimensions
