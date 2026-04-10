"""
搜索工具 — 使用 Jina Reader API（免费无 Key）
提供 web_search 和 read_url 两个工具函数
"""
import requests

JINA_READER = "https://r.jina.ai/"
JINA_SEARCH = "https://s.jina.ai/"


def web_search(query: str, max_results: int = 5) -> str:
    """搜索互联网，返回 Markdown 格式结果摘要

    Args:
        query: 搜索关键词
        max_results: 最大结果数（预留，当前由 API 控制）
    """
    try:
        response = requests.get(
            f"{JINA_SEARCH}{query}",
            headers={
                "Accept": "text/markdown",
                "X-Return-Format": "markdown",
            },
            timeout=15,
        )
        if response.status_code == 200:
            text = response.text.strip()
            # 截取前 3000 字符避免 prompt 过长
            if len(text) > 3000:
                text = text[:3000] + "\n...(搜索结果已截断)"
            return text
        return f"搜索失败：HTTP {response.status_code}"
    except requests.exceptions.Timeout:
        return "搜索超时，请稍后重试"
    except Exception as e:
        return f"搜索出错：{e}"


def read_url(url: str) -> str:
    """读取指定网页内容，返回 Markdown 格式

    Args:
        url: 网页 URL
    """
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
