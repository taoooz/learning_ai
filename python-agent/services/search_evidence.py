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


def _do_search(query: str) -> dict | None:
    """同步执行搜索（在线程池中调用），返回证据包或 None"""
    from lib.tools.search_tools import web_search

    try:
        result_text = web_search(query, max_results=4)
    except Exception as exc:  # noqa: BLE001
        print(f"[SearchEvidence] 搜索异常: {exc}")
        return None
    if not result_text or "未找到相关结果" in result_text or "搜索出错" in result_text:
        return None

    # 解析来源（web_search 行格式：- title\n  body\n  来源: href）
    sources: list[dict] = []
    current_title = ""
    for line in result_text.splitlines():
        line = line.strip()
        if line.startswith("- ") and "\n" not in line:
            current_title = line[2:].strip()
        elif line.startswith("来源: ") and current_title:
            sources.append({"title": current_title[:60], "url": line[4:].strip()})
            current_title = ""
    return {"evidence": result_text, "sources": sources}


async def build_evidence_pack(query: str) -> dict | None:
    """构建搜索证据包（线程池执行同步搜索）；失败返回 None 安全降级"""
    try:
        return await asyncio.to_thread(_do_search, query)
    except Exception as exc:  # noqa: BLE001
        print(f"[SearchEvidence] 证据包构建失败: {exc}")
        return None
