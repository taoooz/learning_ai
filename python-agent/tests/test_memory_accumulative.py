"""R2：累积型个人经历（类比经验）按内容定身份，重排/新增/缺席都不丢历史。"""

from services.memory_v4_store import MemoryV4Store


def _profile(analogies, target_job="AI 产品经理"):
    return {
        "targetJob": target_job,
        "insights": {"analogyExperiences": analogies},
    }


def _active_analogies(store, account="account-a"):
    records = store.load_store(account)["records"]
    return [
        record["content"] for record in records
        if record.get("status") == "active" and "analogy" in (record.get("tags") or [])
    ]


def test_new_analogy_accumulates_instead_of_overwriting(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.ingest_profile("account-a", _profile(["开过奶茶店，懂选址与备货"]))
    store.ingest_profile("account-a", _profile(["开过奶茶店，懂选址与备货", "做过三年推荐位运营"]))
    active = _active_analogies(store)
    assert len(active) == 2
    assert any("奶茶店" in text for text in active)
    assert any("推荐位" in text for text in active)


def test_reordered_analogies_do_not_churn_records(tmp_path):
    store = MemoryV4Store(tmp_path)
    first = ["开过奶茶店", "做过推荐位运营"]
    store.ingest_profile("account-a", _profile(first))
    before = {
        record["memoryId"]: record["version"]
        for record in store.load_store("account-a")["records"]
        if "analogy" in (record.get("tags") or [])
    }
    store.ingest_profile("account-a", _profile(list(reversed(first))))
    after = {
        record["memoryId"]: record["version"]
        for record in store.load_store("account-a")["records"]
        if "analogy" in (record.get("tags") or [])
    }
    assert before == after  # 顺序变化不改身份、不涨版本


def test_same_analogy_reingested_is_idempotent(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.ingest_profile("account-a", _profile(["开过奶茶店"]))
    store.ingest_profile("account-a", _profile(["开过奶茶店", "带过客服团队"]))
    store.ingest_profile("account-a", _profile(["带过客服团队", "开过奶茶店"]))
    assert len(_active_analogies(store)) == 2


def test_omitted_analogy_stays_active(tmp_path):
    """模型这次没再提到某段经历，不代表它没发生过——只有显式删除才移除。"""
    store = MemoryV4Store(tmp_path)
    store.ingest_profile("account-a", _profile(["开过奶茶店", "做过推荐位运营"]))
    store.ingest_profile("account-a", _profile(["做过推荐位运营"]))
    active = _active_analogies(store)
    assert any("奶茶店" in text for text in active)


def test_explicit_deletion_still_removes_analogy(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.ingest_profile("account-a", _profile(["开过奶茶店"]))
    target = next(
        record for record in store.load_store("account-a")["records"]
        if "analogy" in (record.get("tags") or [])
    )
    store.tombstone_record("account-a", target["memoryId"], reason="用户删除")
    store.ingest_profile("account-a", _profile(["开过奶茶店", "做过推荐位运营"]))
    active = _active_analogies(store)
    assert not any("奶茶店" in text for text in active)
    assert any("推荐位" in text for text in active)


def test_state_fields_still_supersede_on_change(tmp_path):
    """目标岗位是状态字段：改了就该替换，不能像经历那样累积。"""
    store = MemoryV4Store(tmp_path)
    store.ingest_profile("account-a", _profile(["开过奶茶店"], target_job="AI 产品经理"))
    store.ingest_profile("account-a", _profile(["开过奶茶店"], target_job="算法产品经理"))
    goals = [
        record for record in store.load_store("account-a")["records"]
        if record.get("kind") == "goal" and record.get("status") == "active"
    ]
    assert len(goals) == 1
    assert goals[0]["content"] == "算法产品经理"