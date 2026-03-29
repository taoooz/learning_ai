from .registry import ToolRegistry
from .tools.base import MCPTool
from .tools.search import SearchWebTool

# 自动注册默认工具
_search_tool = SearchWebTool()
ToolRegistry.register("search_web", _search_tool, agents=["outline_agent"])

__all__ = ["ToolRegistry", "MCPTool"]
