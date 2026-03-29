from typing import Optional
from .tools.base import MCPTool


class ToolRegistry:
    """全局工具注册中心，支持多 Agent 共享工具"""

    _tools: dict[str, MCPTool] = {}
    _agent_tools: dict[str, list[str]] = {}

    @classmethod
    def register(cls, name: str, tool: MCPTool, agents: list[str] | None = None):
        """注册工具，可指定可用的 Agent 列表"""
        cls._tools[name] = tool
        if agents:
            for agent in agents:
                if agent not in cls._agent_tools:
                    cls._agent_tools[agent] = []
                cls._agent_tools[agent].append(name)

    @classmethod
    def get(cls, name: str) -> Optional[MCPTool]:
        return cls._tools.get(name)

    @classmethod
    def get_for_agent(cls, agent_name: str) -> list[MCPTool]:
        """获取指定 Agent 可用的工具"""
        tool_names = cls._agent_tools.get(agent_name, [])
        return [cls._tools[name] for name in tool_names if name in cls._tools]

    @classmethod
    def list_all(cls) -> list[dict]:
        return [{"name": n, **t.get_schema()} for n, t in cls._tools.items()]

    @classmethod
    async def execute_tool(cls, name: str, parameters: dict) -> dict:
        """执行工具"""
        tool = cls._tools.get(name)
        if not tool:
            raise ValueError(f"Tool {name} not found")
        return await tool.execute(parameters)
