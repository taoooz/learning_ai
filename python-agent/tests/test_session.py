import json
import time

from memory.session import SessionStore, Session


def test_create_persists_to_disk(tmp_path):
    """create 后应立即落盘"""
    store = SessionStore(data_dir=tmp_path)
    session = store.create("outline", {"answers": {}})
    fp = tmp_path / f"{session.session_id}.json"
    assert fp.exists()
    data = json.loads(fp.read_text(encoding="utf-8"))
    assert data["agent_type"] == "outline"


def test_restart_recovers_sessions(tmp_path):
    """模拟重启：新建的 store 实例应从磁盘恢复会话"""
    store = SessionStore(data_dir=tmp_path)
    session = store.create("outline", {"q": 1})
    store.update(session.session_id, {"q": 2, "answers": {"a": 1}})

    # 新实例 = 进程重启
    revived = SessionStore(data_dir=tmp_path)
    got = revived.get(session.session_id)
    assert got is not None
    assert got.agent_type == "outline"
    assert got.state == {"q": 2, "answers": {"a": 1}}


def test_update_persists(tmp_path):
    store = SessionStore(data_dir=tmp_path)
    session = store.create("outline", {"v": 1})
    store.update(session.session_id, {"v": 99})

    revived = SessionStore(data_dir=tmp_path)
    assert revived.get(session.session_id).state == {"v": 99}


def test_delete_removes_file(tmp_path):
    store = SessionStore(data_dir=tmp_path)
    session = store.create("outline", {})
    fp = tmp_path / f"{session.session_id}.json"
    assert fp.exists()

    store.delete(session.session_id)
    assert store.get(session.session_id) is None
    assert not fp.exists()
    # 重启后也不应复活
    assert SessionStore(data_dir=tmp_path).get(session.session_id) is None


def test_cleanup_old_removes_expired(tmp_path):
    store = SessionStore(data_dir=tmp_path)
    session = store.create("outline", {})
    fp = tmp_path / f"{session.session_id}.json"

    # 人为改成 2 小时前更新，超过 1 小时阈值
    store.get(session.session_id).updated_at = int(time.time()) - 7200
    removed = store.cleanup_old(max_age_seconds=3600)

    assert removed == 1
    assert store.get(session.session_id) is None
    assert not fp.exists()


def test_cleanup_keeps_fresh_sessions(tmp_path):
    """刚创建/活跃的会话不应被清理误删"""
    store = SessionStore(data_dir=tmp_path)
    fresh = store.create("outline", {"v": 1})
    removed = store.cleanup_old(max_age_seconds=3600)
    assert removed == 0
    assert store.get(fresh.session_id) is not None
    assert (tmp_path / f"{fresh.session_id}.json").exists()


def test_cleanup_mixed_only_removes_expired(tmp_path):
    """新旧会话并存时只删过期的，保留活跃的"""
    store = SessionStore(data_dir=tmp_path)
    fresh = store.create("outline", {"v": 1})
    stale = store.create("outline", {"v": 2})
    store.get(stale.session_id).updated_at = int(time.time()) - 7200

    removed = store.cleanup_old(max_age_seconds=3600)
    assert removed == 1
    assert store.get(fresh.session_id) is not None
    assert store.get(stale.session_id) is None
    assert not (tmp_path / f"{stale.session_id}.json").exists()


def test_corrupt_file_is_skipped(tmp_path):
    """单个损坏文件不应阻断其余会话加载"""
    store = SessionStore(data_dir=tmp_path)
    good = store.create("outline", {"ok": True})
    (tmp_path / "broken.json").write_text("{not valid json", encoding="utf-8")

    revived = SessionStore(data_dir=tmp_path)
    assert revived.get(good.session_id) is not None
    assert revived.get("broken") is None


def test_session_roundtrip():
    """Session 序列化/反序列化保持字段一致"""
    s = Session(session_id="id-1", agent_type="outline", state={"a": [1, 2]})
    back = Session.from_dict(s.to_dict())
    assert back.session_id == s.session_id
    assert back.agent_type == s.agent_type
    assert back.state == s.state
    assert back.created_at == s.created_at
    assert back.updated_at == s.updated_at
