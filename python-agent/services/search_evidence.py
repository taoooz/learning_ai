"""模型驱动的搜索证据工具：执行工具调用、合并 EvidencePack、生成搜索策略提示。"""
import os

from lib.tools.search_tools import read_url as fetch_url, search_web_structured
from lib.tools.source_registry import infer_preferred_domains
from services.evidence_store import get_chapter_evidence, merge_chapter_evidence_results

class ChapterEvidenceCollector:
    """模型工具调用期间的章节证据收集器。

    模型决定是否调用 web_search；本类只负责执行搜索、格式化工具结果、
    合并 EvidencePack 和持久化。搜索时机不再由关键词规则控制。
    """

    def __init__(
        self,
        course_id: str,
        chapter_id: str,
        course_topic: str,
        chapter_title: str,
        *,
        task_title: str = "",
        task_goal: str = "",
    ):
        self.course_id = course_id
        self.chapter_id = chapter_id
        self.course_topic = course_topic
        self.chapter_title = chapter_title
        self.task_title = task_title
        self.task_goal = task_goal
        self.pack = get_chapter_evidence(course_id, chapter_id)

    @property
    def tool_functions(self) -> dict:
        return {"web_search": self.web_search, "read_url": self.read_url}

    def web_search(self, query: str, max_results: int = 4) -> str:
        """执行模型请求的搜索，并把结构化结果并入章节证据包。"""
        if not search_tools_enabled():
            return "联网搜索已禁用，请基于已有信息完成生成。"
        preferred_domains = infer_preferred_domains(
            self.course_topic,
            self.chapter_title,
            self.task_title,
            self.task_goal,
        )
        # 模型已经写 site: 时不再追加偏好域，避免生成重复 site: 查询。
        if "site:" in query.lower():
            preferred_domains = []
        try:
            results = search_web_structured(
                query,
                max_results=max_results,
                preferred_domains=preferred_domains,
            )
        except Exception as exc:  # noqa: BLE001 搜索失败交还模型自行降级
            return f"搜索出错：{exc}"

        query_plan = [{
            "kind": "agent",
            "query": query,
            "preferredDomains": preferred_domains,
        }]
        self.pack, sources = merge_chapter_evidence_results(
            self.course_id,
            self.chapter_id,
            self.course_topic,
            self.chapter_title,
            query_plan,
            results,
        )
        lines = []
        for source in sources:
            lines.append(
                f"- {source.get('title', '')}\n"
                f"  {source.get('summary', '')}\n"
                f"  来源: {source.get('url', '')}\n"
                f"  证据ID: {source.get('evidenceId', '')} | 类型: {source.get('kind', 'knowledge')}"
            )
        text = "\n\n".join(lines)
        return text[:3000] + ("\n...(搜索结果已截断)" if len(text) > 3000 else "")

    def read_url(self, url: str) -> str:
        """读取模型指定网页；正文由模型消费，不再额外生成证据摘要。"""
        if not search_tools_enabled():
            return "联网读取已禁用，请基于已有信息完成生成。"
        return fetch_url(url)


def search_tools_enabled() -> bool:
    """保留离线/应急关闭搜索的总开关。"""
    disabled = (
        os.getenv("DISABLE_WEB_SEARCH", "").lower() in ("1", "true", "yes")
        or os.getenv("DISABLE_EVIDENCE_SEARCH", "").lower() in ("1", "true", "yes")
    )
    return not disabled


def format_search_decision_policy(max_searches: int = 2) -> str:
    """供章节计划/任务正文复用的模型自主搜索规则。"""
    return f"""

## 联网搜索决策（由你判断）
- 你可以使用 web_search 工具搜索互联网，必要时可用 read_url 深入读取单个网页。
- 先检查上下文中已有的搜索证据；证据足够时直接生成，不要为了“保险”重复搜索。
- 只有以下情况需要搜索：信息可能已过时、涉及最新版本/价格/政策/产品能力、关键事实不确定，或已有证据无法覆盖当前任务。
- 稳定基础知识、已有证据能够支撑的解释和例子不要搜索。
- 最多执行 {max_searches} 次 web_search。搜索后基于已有信息继续完成任务，不要无限追查。
- 引用外部事实时只能使用工具结果中出现的来源和证据 ID，禁止编造 URL 或依据训练记忆补造来源。
""".rstrip()
