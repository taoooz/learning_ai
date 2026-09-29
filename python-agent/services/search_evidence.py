"""
P5 补全：V2 任务内容的搜索证据包（设计文档 §搜索策略）
- needs_search：时效性关键词启发式判定（稳定基础知识不搜索，控制延迟）
- build_evidence_pack：web_search → 压缩证据包 + 来源列表
- 搜索失败/无结果安全降级（返回 None，生成流程照常无证据进行）
"""
import asyncio
import os
import re

# 时效性/事实性信号：命中才搜索（§搜索策略「必须搜索或校验」的启发式）
_SEARCH_HINT_RE = re.compile(
    r"版本|最新|新版|价格|收费|定价|发布|更新| deprecated|弃用|对比|选型|"
    r"20[12]\d|前沿|趋势|生态|工具|库|框架|配置|实践|实战|排查"
)

# 稳定基础概念：明确不搜索（数学/语言基础概念等）
_SKIP_RE = re.compile(r"^(什么是|认识|初识|理解).{0,12}(概念|本质|原理|思想)$")


def needs_search(task_title: str, task_goal: str) -> bool:
    """时效性/工具类主题启发式：命中关键词才搜索

    环境变量 DISABLE_WEB_SEARCH=1 可整体关闭（调试/离线用）。
    """
    if os.getenv("DISABLE_WEB_SEARCH", "").lower() in ("1", "true", "yes"):
        return False
    text = f"{task_title} {task_goal}"
    if _SKIP_RE.search(task_title.strip()):
        return False
    return bool(_SEARCH_HINT_RE.search(text))


def _do_search(query: str, preferred_domains: list[str] | None = None) -> dict | None:
    """同步执行免费搜索；优先权威域，失败安全降级。"""
    from lib.tools.search_tools import search_web_structured
    try:
        results = search_web_structured(query, max_results=4, preferred_domains=preferred_domains or [])
    except Exception as exc:  # noqa: BLE001
        print(f"[SearchEvidence] 搜索异常: {exc}")
        return None
    if not results:
        return None

    lines = [f"- {item['title']}\n  {item['body']}\n  来源: {item['url']}" for item in results]
    sources = [
        {"title": item["title"][:60], "url": item["url"], "authorityScore": item["authorityScore"]}
        for item in results
    ]
    return {"evidence": "\n\n".join(lines)[:3000], "sources": sources}


async def build_evidence_pack(query: str, preferred_domains: list[str] | None = None) -> dict | None:
    """构建搜索证据包（线程池执行同步搜索）；失败返回 None 安全降级"""
    try:
        return await asyncio.to_thread(_do_search, query, preferred_domains)
    except Exception as exc:  # noqa: BLE001
        print(f"[SearchEvidence] 证据包构建失败: {exc}")
        return None


async def build_evidence_pack_with_context(
    course_topic: str,
    task_title: str,
    task_goal: str,
    chapter_title: str = "",
) -> dict | None:
    """结合课程/章节/任务上下文推断权威域，再走免费搜索。

    章节标题会参与联合查询：章节证据不足以覆盖任务时，补搜结果更贴近当前教学块。
    """
    from lib.tools.source_registry import infer_preferred_domains

    preferred_domains = infer_preferred_domains(course_topic, chapter_title, task_title, task_goal)
    query = " ".join(part for part in (course_topic, chapter_title, task_title, task_goal) if part)
    return await build_evidence_pack(query, preferred_domains)
