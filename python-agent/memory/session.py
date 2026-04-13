import time
import uuid
from typing import Optional, Any
from dataclasses import dataclass, field


@dataclass
class Session:
    """Session 数据结构"""
    session_id: str
    agent_type: str
    state: dict
    created_at: int = field(default_factory=lambda: int(time.time()))
    updated_at: int = field(default_factory=lambda: int(time.time()))


class SessionStore:
    """内存 Session 存储"""

    def __init__(self):
        self._sessions: dict[str, Session] = {}

    def create(self, agent_type: str, initial_state: dict) -> Session:
        """创建新 Session"""
        session_id = str(uuid.uuid4())
        session = Session(
            session_id=session_id,
            agent_type=agent_type,
            state=initial_state,
        )
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Optional[Session]:
        """获取 Session"""
        return self._sessions.get(session_id)

    def update(self, session_id: str, state: dict) -> None:
        """更新 Session 状态"""
        if session_id in self._sessions:
            self._sessions[session_id].state = state
            self._sessions[session_id].updated_at = int(time.time())

    def delete(self, session_id: str) -> None:
        """删除 Session"""
        self._sessions.pop(session_id, None)

    def cleanup_old(self, max_age_seconds: int = 3600) -> int:
        """清理过期 Session，返回清理数量"""
        now = int(time.time())
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.updated_at > max_age_seconds
        ]
        for sid in expired:
            del self._sessions[sid]
        return len(expired)


# 全局 Session Store 实例
_global_store: Optional[SessionStore] = None


def get_session_store() -> SessionStore:
    """获取全局 Session Store"""
    global _global_store
    if _global_store is None:
        _global_store = SessionStore()
    return _global_store
