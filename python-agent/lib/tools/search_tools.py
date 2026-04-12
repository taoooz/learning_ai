"""
搜索工具 — ddgs (DuckDuckGo) + Jina Reader 读取网页
"""
import requests
from ddgs import DDGS


def web_search(query: str, max_results: int = 5) -> str:
    """使用 ddgs (DuckDuckGo) 搜索"""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))

        if not results:
            return "未找到相关搜索结果"

        parts = []
        for r in results:
            title = r.get("title", "")
            url = r.get("href", "")
            snippet = r.get("body", "")[:150]
            parts.append(f"- {title}\n  {url}\n  {snippet}")

        text = "\n\n".join(parts)
        if len(text) > 3000:
            text = text[:3000] + "\n...(搜索结果已截断)"
        return text
    except Exception as e:
        return f"搜索出错：{e}"


def read_url(url: str) -> str:
    """读取指定网页内容，返回 Markdown 格式"""
    JINA_READER = "https://r.jina.ai/"
    try:
        response = requests.get(
            f"{JINA_READER}{url}",
            headers={
                "Accept": "text/markdown",
                "X-Return-Format": "markdown",
            },
            timeout=15,
        )
        if response.status_code == 200:
            text = response.text.strip()
            if len(text) > 4000:
                text = text[:4000] + "\n...(网页内容已截断)"
            return text
        return f"读取失败：HTTP {response.status_code}"
    except requests.exceptions.Timeout:
        return "读取超时，请稍后重试"
    except Exception as e:
        return f"读取出错：{e}"


# OpenAI 格式的工具定义
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

TOOL_FUNCTIONS = {
    "web_search": web_search,
    "read_url": read_url,
}
