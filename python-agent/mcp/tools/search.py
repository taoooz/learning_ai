import httpx
from typing import Any
from .base import MCPTool


class SearchWebTool(MCPTool):
    """网页搜索工具（使用 DuckDuckGo 搜索）"""

    def __init__(self):
        super().__init__(
            name="search_web",
            description="搜索互联网获取最新信息"
        )
        self._base_url = "https://api.duckduckgo.com/"

    def get_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索查询"
                    }
                },
                "required": ["query"]
            }
        }

    async def execute(self, parameters: dict) -> dict:
        query = parameters.get("query", "")
        results = await self._search(query)
        return {
            "query": query,
            "results": results,
            "summary": self._summarize(results)
        }

    async def _search(self, query: str) -> list[dict]:
        """执行搜索"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    self._base_url,
                    params={
                        "q": query,
                        "format": "json",
                        "no_redirect": 1,
                        "no_html": 1,
                    },
                    timeout=10.0,
                )
                response.raise_for_status()
                data = response.json()

                results = []
                for topic in data.get("RelatedTopics", [])[:5]:
                    if "Text" in topic:
                        results.append({
                            "title": topic.get("Text", "")[:100],
                            "url": topic.get("URL", ""),
                        })
                return results
        except Exception as e:
            return [{"error": str(e)}]

    def _summarize(self, results: list[dict]) -> str:
        """生成搜索结果摘要"""
        if not results:
            return "未找到相关结果"
        return " | ".join([r.get("title", "")[:50] for r in results[:3]])
