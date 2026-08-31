import json
import os
import time
import uuid
from pathlib import Path
from typing import Optional
from dataclasses import dataclass, field, asdict


# Session 持久化目录（python-agent/data/sessions），重启后从这里恢复
_DATA_DIR = Path(__file__).parent.parent / "data" / "sessions"


@dataclass
class Session:
    """Session 数据结构"""
    session_id: str
    agent_type: str
    state: dict
    created_at: int = field(default_factory=lambda: int(time.time()))
    updated_at: int = field(default_factory=lambda: int(time.time()))

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Session":
        return cls(
            session_id=data["session_id"],
            agent_type=data["agent_type"],
            state=data.get("state", {}),
            created_at=data.get("created_at", int(time.time())),
            updated_at=data.get("updated_at", int(time.time())),
        )


class SessionStore:
    """内存 Session 存储 + 文件持久化（重启后可恢复）

    内存 dict 是主存储，磁盘文件仅用于跨重启恢复：
    启动时从 data_dir 加载全部会话；每次 create/update/delete 同步落盘。
    """

    def __init__(self, data_dir: Optional[Path] = None):
        self._sessions: dict[str, Session] = {}
        self._data_dir = data_dir if data_dir is not None else _DATA_DIR
        self._load_from_disk()

    # ---- 持久化内部实现 ----

    def _session_path(self, session_id: str) -> Path:
        return self._data_dir / f"{session_id}.json"

    def _load_from_disk(self) -> None:
        """启动时从磁盘加载全部会话；单个文件损坏只跳过并告警"""
        if not self._data_dir.exists():
            return
        for fp in self._data_dir.glob("*.json"):
            try:
                with open(fp, encoding="utf-8") as f:
                    session = Session.from_dict(json.load(f))
                self._sessions[session.session_id] = session
            except (json.JSONDecodeError, KeyError, TypeError, OSError) as e:
                print(f"[WARN] 加载 session 文件失败，跳过 {fp.name}: {e}")

    def _persist(self, session: Session) -> None:
        """原子写入单个会话：先写 .tmp 再 os.replace，避免半截文件"""
        try:
            self._data_dir.mkdir(parents=True, exist_ok=True)
            target = self._session_path(session.session_id)
            tmp = target.with_suffix(".json.tmp")
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(session.to_dict(), f, ensure_ascii=False)
            os.replace(tmp, target)
        except (OSError, TypeError, ValueError) as e:
            # 持久化失败不阻断主流程（内存态仍可用），但要显式告警
            print(f"[WARN] 持久化 session 失败 {session.session_id}: {e}")

    def _remove_file(self, session_id: str) -> None:
        try:
            self._session_path(session_id).unlink(missing_ok=True)
        except OSError as e:
            print(f"[WARN] 删除 session 文件失败 {session_id}: {e}")

    # ---- 对外接口（保持不变）----

    def create(self, agent_type: str, initial_state: dict) -> Session:
        """创建新 Session"""
        session_id = str(uuid.uuid4())
        session = Session(
            session_id=session_id,
            agent_type=agent_type,
            state=initial_state,
        )
        self._sessions[session_id] = session
        self._persist(session)
        return session

    def get(self, session_id: str) -> Optional[Session]:
        """获取 Session"""
        return self._sessions.get(session_id)

    def update(self, session_id: str, state: dict) -> None:
        """更新 Session 状态"""
        if session_id in self._sessions:
            session = self._sessions[session_id]
            session.state = state
            session.updated_at = int(time.time())
            self._persist(session)

    def delete(self, session_id: str) -> None:
        """删除 Session"""
        self._sessions.pop(session_id, None)
        self._remove_file(session_id)

    def cleanup_old(self, max_age_seconds: int = 3600) -> int:
        """清理过期 Session，返回清理数量"""
        now = int(time.time())
        expired = [
            sid for sid, s in self._sessions.items()
            if now - s.updated_at > max_age_seconds
        ]
        for sid in expired:
            del self._sessions[sid]
            self._remove_file(sid)
        return len(expired)


# 全局 Session Store 实例
_global_store: Optional[SessionStore] = None


def get_session_store() -> SessionStore:
    """获取全局 Session Store"""
    global _global_store
    if _global_store is None:
        _global_store = SessionStore()
    return _global_store
