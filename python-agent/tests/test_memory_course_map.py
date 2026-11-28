"""R1：课程架构阶段地图确定性投影进 memory（复用已生成内容，零额外 LLM）。"""


def _staged_architecture():
    return {
        "courseTopic": "SuperAgent 设计思想",
        "thesis": {
            "targetCapability": "能判断一个需求该不该用 SuperAgent 架构",
            "nonGoals": ["不讲模型训练", "不讲代码实现"],
        },
        "stages": [
            {"stageId": "s1", "title": "问题定义", "stageGoal": "看清人当消息总线的代价", "chapterIds": ["c1"]},
            {"stageId": "s2", "title": "核心架构", "stageGoal": "理解两层职责边界", "chapterIds": ["c2"]},
        ],
        "chapters": [
            {"chapterId": "c1", "title": "注意力瓶颈", "roleInCourse": "建立问题意识",
             "stageId": "s1", "conceptIds": ["attention-bus"]},
            {"chapterId": "c2", "title": "Router 与 Worker", "roleInCourse": "给出结构答案",
             "stageId": "s2", "conceptIds": ["router-worker"]},
        ],
    }


def test_course_map_projects_stages_roles_and_non_goals(tmp_path):
    from services.memory_v4_store import MemoryV4Store

    result = MemoryV4Store(tmp_path).upsert_course_map(
        "account-a", topic="SuperAgent", course_title="SuperAgent 设计思想",
        target_capability="能判断该不该用", architecture=_staged_architecture(), now=1000,
    )
    record = result["map"]
    assert record["scope"] == {"type": "topic", "topic": "SuperAgent"}
    assert record["sourceType"] == "system_rule"
    assert "问题定义" in record["content"] and "核心架构" in record["content"]
    assert "建立问题意识" in record["content"]
    assert "不讲模型训练" in record["content"]
    assert record["summary"] == "问题定义 → 核心架构"
    assert record["conceptKeys"] == ["attention-bus", "router-worker"]


def test_course_map_flat_architecture_lists_chapters(tmp_path):
    from services.memory_v4_store import MemoryV4Store

    arch = _staged_architecture()
    arch["stages"] = []
    for chapter in arch["chapters"]:
        chapter["stageId"] = None
    record = MemoryV4Store(tmp_path).upsert_course_map(
        "account-a", topic="SuperAgent", course_title="t", target_capability="",
        architecture=arch, now=1000,
    )["map"]
    assert "2 章" in record["content"]
    assert "注意力瓶颈" in record["content"]


def test_course_map_reupsert_updates_in_place(tmp_path):
    from services.memory_v4_store import MemoryV4Store

    store = MemoryV4Store(tmp_path)
    first = store.upsert_course_map(
        "account-a", topic="SuperAgent", course_title="t", target_capability="",
        architecture=_staged_architecture(), now=1000,
    )["map"]
    arch = _staged_architecture()
    arch["stages"][0]["title"] = "问题再定义"
    second = store.upsert_course_map(
        "account-a", topic="SuperAgent", course_title="t", target_capability="",
        architecture=arch, now=2000,
    )["map"]
    assert second["memoryId"] == first["memoryId"]
    assert second["version"] == 2
    assert second["createdAt"] == first["createdAt"]
    active = [r for r in store.load_store("account-a")["records"]
              if r.get("dedupeKey") == "coursemap:topic:SuperAgent" and r["status"] == "active"]
    assert len(active) == 1
    assert "问题再定义" in active[0]["content"]


def test_course_map_skips_empty_topic(tmp_path):
    from services.memory_v4_store import MemoryV4Store

    assert MemoryV4Store(tmp_path).upsert_course_map(
        "account-a", topic="  ", course_title="t", target_capability="",
        architecture=_staged_architecture(),
    )["map"] is None


def _patch_toc(monkeypatch, architecture):
    import services.toc_agent as toc

    def fake_stream(**kwargs):
        yield {"type": "result", "result": {"architecture": architecture, "issues": []}}

    monkeypatch.setattr(toc, "stream_course_architecture", fake_stream)
    monkeypatch.setattr(toc, "get_topic_evidence", lambda topic: {})
    monkeypatch.setattr(toc, "evidence_to_prompt", lambda pack: ("", []))
    monkeypatch.setattr(toc, "architecture_chapter_to_node", lambda chapter, index: {"id": chapter["chapterId"]})
    return toc


def test_toc_agent_writes_course_map(monkeypatch):
    architecture = _staged_architecture()
    architecture["thesis"]["audience"] = "产品经理"
    toc = _patch_toc(monkeypatch, architecture)

    calls = []

    class FakeStore:
        def upsert_course_map(self, account_id, **kwargs):
            calls.append((account_id, kwargs["topic"]))
            return {"map": {}}

    import services.memory_v4_store as store_module
    monkeypatch.setattr(store_module, "MemoryV4Store", FakeStore)

    blueprint = {"topic": "SuperAgent", "learnerPositioning": {"backgroundSummary": "产品经理"}}
    list(toc.stream_toc_with_tools(blueprint, account_id="account-a"))
    assert calls == [("account-a", "SuperAgent")]


def test_toc_agent_survives_memory_write_failure(monkeypatch):
    architecture = _staged_architecture()
    architecture["thesis"]["audience"] = "产品经理"
    toc = _patch_toc(monkeypatch, architecture)

    class BrokenStore:
        def upsert_course_map(self, *args, **kwargs):
            raise RuntimeError("disk full")

    import services.memory_v4_store as store_module
    monkeypatch.setattr(store_module, "MemoryV4Store", BrokenStore)

    blueprint = {"topic": "SuperAgent", "learnerPositioning": {"backgroundSummary": "产品经理"}}
    events = list(toc.stream_toc_with_tools(blueprint, account_id="account-a"))
    assert any('"type": "complete"' in event for event in events)


def test_toc_agent_without_account_skips_memory(monkeypatch):
    architecture = _staged_architecture()
    architecture["thesis"]["audience"] = "产品经理"
    toc = _patch_toc(monkeypatch, architecture)

    class NoCallStore:
        def upsert_course_map(self, *args, **kwargs):
            raise AssertionError("不应在无 account 时写 memory")

    import services.memory_v4_store as store_module
    monkeypatch.setattr(store_module, "MemoryV4Store", NoCallStore)

    blueprint = {"topic": "SuperAgent", "learnerPositioning": {"backgroundSummary": "产品经理"}}
    events = list(toc.stream_toc_with_tools(blueprint))
    assert any('"type": "complete"' in event for event in events)