"""
P5.1 服务端用户数据存储：课程 / 学习容器 / 参与信号的文件持久化
- 目录：data/user_data/{accountId}/（accountId = 鉴权 invite code）
- 模式对齐 memory/session.py：内存缓存 + 同步落盘 + 单文件损坏跳过 + 原子写入
- 乐观锁：save_lesson 携带客户端 updatedAt，服务端更新则 409（设计文档 §5）
"""
import json
import os
import time
from pathlib import Path

_DATA_ROOT = Path(__file__).parent.parent / "data" / "user_data"


class OptimisticLockConflict(Exception):
    """服务端数据比客户端新（updatedAt 冲突），调用方返回 409"""

    def __init__(self, server_updated_at: int):
        self.server_updated_at = server_updated_at
        super().__init__(f"服务端数据更新（updatedAt={server_updated_at}）")


class UserDataStore:
    """按账户隔离的用户数据存储（课程 / 学习容器 / 参与信号）"""

    def __init__(self, data_root: Path | None = None):
        self._root = data_root if data_root is not None else _DATA_ROOT

    # ---- 目录辅助 ----

    def _account_dir(self, account_id: str) -> Path:
        # 目录名安全：invite code 格式受鉴权约束，但此处仍做保守清洗
        safe = "".join(c for c in account_id if c.isalnum() or c == "-")
        return self._root / safe

    def _courses_path(self, account_id: str) -> Path:
        return self._account_dir(account_id) / "courses.json"

    def _lesson_path(self, account_id: str, course_id: str, chapter_id: str) -> Path:
        safe_course = "".join(c for c in course_id if c.isalnum() or c == "-")
        safe_chapter = "".join(c for c in chapter_id if c.isalnum() or c == "-")
        return self._account_dir(account_id) / "lessons" / f"{safe_course}__{safe_chapter}.json"

    def _engagement_path(self, account_id: str, course_id: str) -> Path:
        safe_course = "".join(c for c in course_id if c.isalnum() or c == "-")
        return self._account_dir(account_id) / "engagement" / f"{safe_course}.jsonl"

    @staticmethod
    def _atomic_write(path: Path, content: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, path)

    # ---- 课程主对象 ----

    def load_courses(self, account_id: str) -> list[dict]:
        path = self._courses_path(account_id)
        if not path.exists():
            return []
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print(f"[UserDataStore] courses.json 损坏，返回空（account={account_id}）")
            return []

    def save_courses(self, account_id: str, courses: list[dict]) -> None:
        self._atomic_write(self._courses_path(account_id), json.dumps(courses, ensure_ascii=False))

    # ---- 学习容器（乐观锁） ----

    def load_lesson(self, account_id: str, course_id: str, chapter_id: str) -> dict | None:
        path = self._lesson_path(account_id, course_id, chapter_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print(f"[UserDataStore] lesson 文件损坏: {path.name}")
            return None

    def save_lesson(
        self,
        account_id: str,
        course_id: str,
        chapter_id: str,
        lesson: dict,
        expect_updated_at: int | None = None,
    ) -> dict:
        """保存学习容器；expect_updated_at 非空时执行乐观锁检查

        返回 {"saved": True, "serverUpdatedAt": ...}；
        冲突时抛 OptimisticLockConflict（端点层转 409 + 服务端当前版本）。
        """
        path = self._lesson_path(account_id, course_id, chapter_id)
        if expect_updated_at is not None and path.exists():
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
                server_at = int(existing.get("updatedAt", 0))
                if server_at > int(expect_updated_at):
                    raise OptimisticLockConflict(server_at)
            except json.JSONDecodeError:
                pass  # 损坏文件视为空，允许覆盖
        self._atomic_write(path, json.dumps(lesson, ensure_ascii=False))
        return {"saved": True, "serverUpdatedAt": int(lesson.get("updatedAt", 0))}

    # ---- 参与信号（append-only JSONL） ----

    def append_engagement(self, account_id: str, course_id: str, events: list[dict]) -> int:
        """批量追加参与信号；返回追加条数。单条格式非法即跳过"""
        valid = [e for e in events if isinstance(e, dict) and e.get("eventType")]
        if not valid:
            return 0
        path = self._engagement_path(account_id, course_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in valid)
        with open(path, "a", encoding="utf-8") as f:
            f.write(lines)
        return len(valid)
