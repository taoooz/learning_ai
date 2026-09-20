# tests/test_user_data_store.py — P5.1 服务端用户数据存储：roundtrip / 乐观锁 / engagement / 目录隔离

import pytest

from services.user_data_store import OptimisticLockConflict, UserDataStore


@pytest.fixture()
def store(tmp_path):
    return UserDataStore(data_root=tmp_path)


def test_courses_roundtrip(store):
    assert store.load_courses("user-a") == []
    store.save_courses("user-a", [{"courseId": "c1", "blueprint": {"topic": "t"}}])
    courses = store.load_courses("user-a")
    assert len(courses) == 1
    assert courses[0]["courseId"] == "c1"


def test_account_isolation(store):
    store.save_courses("user-a", [{"courseId": "c1"}])
    assert store.load_courses("user-b") == [], "账户之间数据必须隔离"


def test_lesson_roundtrip(store):
    lesson = {"protocolVersion": 2, "chapterId": "ch-1", "updatedAt": 100, "streamItems": []}
    result = store.save_lesson("user-a", "c1", "ch-1", lesson)
    assert result["saved"] is True
    loaded = store.load_lesson("user-a", "c1", "ch-1")
    assert loaded is not None
    assert loaded["updatedAt"] == 100


def test_lesson_optimistic_lock_conflict(store):
    store.save_lesson("user-a", "c1", "ch-1", {"updatedAt": 200})
    with pytest.raises(OptimisticLockConflict) as exc_info:
        store.save_lesson("user-a", "c1", "ch-1", {"updatedAt": 100}, expect_updated_at=100)
    assert exc_info.value.server_updated_at == 200


def test_lesson_optimistic_lock_passes_when_server_older(store):
    store.save_lesson("user-a", "c1", "ch-1", {"updatedAt": 100})
    result = store.save_lesson("user-a", "c1", "ch-1", {"updatedAt": 300}, expect_updated_at=100)
    assert result["saved"] is True


def test_lesson_optimistic_lock_no_existing_file(store):
    """无既有文件时乐观锁检查直接通过（首次保存）"""
    result = store.save_lesson("user-a", "c1", "ch-new", {"updatedAt": 100}, expect_updated_at=100)
    assert result["saved"] is True


def test_lesson_load_missing_returns_none(store):
    assert store.load_lesson("user-a", "c-none", "ch-none") is None


def test_engagement_append_and_count(store):
    events = [
        {"eventType": "task_completed", "chapterId": "ch-1", "at": 100},
        {"eventType": "chapter_opened", "at": 101},
        {"invalid": True},  # 无 eventType，跳过
    ]
    count = store.append_engagement("user-a", "c1", events)
    assert count == 2


def test_engagement_corrupt_course_id_sanitized(store):
    """路径注入防护：courseId 特殊字符被清洗"""
    store.append_engagement("user-a", "../../evil", [{"eventType": "x", "at": 1}])
    # 不应逃出 user_data 目录；文件名只含清洗后字符
    import pathlib
    engagement_dir = store._account_dir("user-a") / "engagement"
    files = list(engagement_dir.glob("*.jsonl"))
    assert len(files) == 1
    assert "/" not in files[0].name and ".." not in files[0].name


def test_corrupt_courses_file_returns_empty(store, tmp_path):
    store.save_courses("user-a", [{"courseId": "c1"}])
    path = store._courses_path("user-a")
    path.write_text("{corrupt", encoding="utf-8")
    assert store.load_courses("user-a") == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
