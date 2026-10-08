# services/style_lint.py — 课程内容文风 lint（观测模式：只记录，不拦截、不重试）
#
# 规范来源：内容文风规范（精简四条版）。prompt 层负责预防（prompts/*_style_rules），
# 本模块负责兜底观测：统计生成内容里的模型腔命中情况，为后续是否收紧 prompt 提供数据。
#
# 设计约束：
# - 零依赖、纯正则，单次调用微秒级，可安全挂在流式生成完成路径上
# - 粗正则允许少量误报（如字面义的“说到底”），观测数据可容忍
# - 不新增硬禁词时保持克制：只统计下面明确列出的模式

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger("style_lint")


@dataclass(frozen=True)
class _Rule:
    name: str
    pattern: re.Pattern[str]


_RULES: tuple[_Rule, ...] = (
    _Rule(
        "翻案腔",
        re.compile(
            r"(不是[^。，；]{1,20}，?而是|并非[^。，；]{1,20}，?而是"
            r"|与其说[^。]{1,30}不如说|表面[^。]{1,15}，?实际"
            r"|看似[^。]{1,15}，?实则|你以为[^。]{1,20}，?其实)"
        ),
    ),
    _Rule("提示性冒号", re.compile(r"(一句话总结|核心是|说白了|说穿了|先说结论)[:：]")),
    _Rule(
        "商业黑话",
        re.compile(
            r"(赋能|抓手|底层逻辑|降本增效|拉通|组合拳|全链路"
            r"|打开想象空间|技术底座|认知升级|商业闭环|价值闭环)"
        ),
    ),
    _Rule("洞察路标", re.compile(r"(值得注意的是|需要指出的是|更微妙的是|还有一层)")),
    _Rule(
        "拟人化比喻",
        re.compile(r"[（(]?[^。，；]{0,10}(?:接住|托住|兜住)"),
    ),
)


def lint_prose(text: str) -> list[dict]:
    """检查一段中文文本，返回命中列表：[{rule, match}]。干净文本返回空列表。"""
    if not text:
        return []
    findings: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for rule in _RULES:
        for match in rule.pattern.finditer(text):
            key = (rule.name, match.group(0))
            if key in seen:
                continue
            seen.add(key)
            findings.append({"rule": rule.name, "match": match.group(0)})
    return findings


def lint_task_blocks(blocks: list[dict]) -> list[dict]:
    """按块类型提取正文再检查：markdown/示例/要点/要点行。"""
    findings: list[dict] = []
    for block in blocks or []:
        block_type = block.get("type")
        if block_type == "markdown":
            findings.extend(lint_prose(block.get("markdown", "")))
        elif block_type in ("example", "key_point", "comparison", "diagram"):
            # 结构化块：拼接全部字符串字段（跳过 id/证据行），观察面更完整
            texts = [
                v
                for k, v in block.items()
                if isinstance(v, str) and k not in ("blockId", "evidenceRefs")
            ]
            for key, value in block.items():
                if isinstance(value, list):
                    texts.extend(item for item in value if isinstance(item, str))
            findings.extend(lint_prose("\n".join(texts)))
    return findings


def log_prose_findings(label: str, findings: list[dict]) -> None:
    """观测打点：只记日志，不改变生成结果。"""
    if not findings:
        return
    summary = "; ".join(f"{f['rule']}:{f['match']}" for f in findings)
    logger.warning("style_lint[%s] 命中 %d 处：%s", label, len(findings), summary)
