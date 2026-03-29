from abc import ABC, abstractmethod
from typing import Any


class MCPTool(ABC):
    """MCP 工具基类"""

    def __init__(self, name: str, description: str):
        self.name = name
        self.description = description

    @abstractmethod
    def get_schema(self) -> dict:
        """返回工具的 JSON Schema"""
        pass

    @abstractmethod
    async def execute(self, parameters: dict) -> Any:
        """执行工具"""
        pass
