"""
搜索工具 — ddgs (DuckDuckGo 搜索库) + Jina Reader
提供 web_search 和 read_url 两个工具函数
"""
import httpx
from ddgs import DDGS

JINA_READER = "https://r.jina.ai/"


def web_search(query: str, max_results: int = 5) -> str:
    """搜索互联网，返回相关结果摘要（DuckDuckGo via ddgs 库）"""
    try:
        results = []
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                title = r.get("title", "")
                href = r.get("href", "")
                body = r.get("body", "")
                if title and body:
                    results.append(f"- {title}\n  {body[:200]}\n  来源: {href}")

        if results:
            result_text = "\n\n".join(results)
            if len(result_text) > 3000:
                result_text = result_text[:3000] + "\n...(搜索结果已截断)"
            return result_text

        return "未找到相关结果"
    except Exception as e:
        return f"搜索出错：{e}"


def read_url(url: str) -> str:
    """读取指定网页内容，返回 Markdown 格式（Jina Reader API）"""
    try:
        response = httpx.get(
            f"{JINA_READER}{url}",
            headers={
                "Accept": "text/markdown",
                "X-Return-Format": "markdown",
            },
            timeout=15,
        )
        response.raise_for_status()
        text = response.text.strip()
        if len(text) > 4000:
            text = text[:4000] + "\n...(网页内容已截断)"
        return text
    except httpx.TimeoutException:
        return "读取超时，请稍后重试"
    except Exception as e:
        return f"读取出错：{e}"


# OpenAI 格式的工具定义，用于 MiniMax function calling
SEARCH_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取最新信息。适用于查找行业趋势、技术文档、最新案例、概念定义等。返回搜索结果的摘要。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词，简洁明确，建议 5-15 个字",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_url",
            "description": "读取指定网页的完整内容，返回 Markdown 格式。适用于深度阅读特定文章或文档。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "网页 URL，以 http:// 或 https:// 开头",
                    }
                },
                "required": ["url"],
            },
        },
    },
]

# 工具名 -> 执行函数的映射
TOOL_FUNCTIONS = {
    "web_search": web_search,
    "read_url": read_url,
}
