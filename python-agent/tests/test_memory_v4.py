from services.memory_v4_store import MemoryV4Store


def _profile(target_job: str = "AI 产品经理") -> dict:
    return {
        "targetJob": target_job,
        "workExperience": [{"company": "A", "position": "产品经理", "description": "负责增长"}],
        "education": [{"school": "B", "major": "计算机"}],
        "insights": {
            "workSummary": ["做过数据产品"],
            "educationSummary": ["有计算机基础"],
            "analogyExperiences": ["用健身计划类比学习节奏"],
            "learningStyle": "实践型",
            "technicalLevel": "业务级",
            "valuePriorities": ["效率"],
            "summary": "偏实践的学习者",
        },
    }


def _evidence(
    account: str,
    *,
    evidence_id: str = "ev-1",
    idem: str = "idem-1",
    outcome: str = "demonstrated",
    concept: str = "工具调用",
    created_at: int = 1000,
    attempt: int = 1,
    checkpoint_id: str | None = None,
) -> dict:
    return {
        "evidenceId": evidence_id,
        "evidenceKey": f"key-{evidence_id}",
        "idempotencyKey": idem,
        "accountId": account,
        "protocolVersion": 4,
        "courseId": "course-1",
        "chapterId": "ch-1",
        "courseTopic": "Agent",
        "topic": "Agent",
        "objectiveId": "obj-1",
        "conceptKeys": [concept],
        "taskId": "task-1",
        "checkpointId": checkpoint_id or f"cp-{evidence_id}",
        "kind": "scenario_choice",
        "outcome": outcome,
        "strength": "moderate",
        "score": 1,
        "confidence": 1,
        "attempt": attempt,
        "hintLevel": "none",
        "isRemediationAttempt": False,
        "sourceItemId": checkpoint_id or f"cp-{evidence_id}",
        "planVersion": 1,
        "evaluator": "rule",
        "evaluationVersion": "checkpoint-rule-v1",
        "misconceptionCodes": [] if outcome == "demonstrated" else ["混淆工具调用与工作流"],
        "createdAt": created_at,
    }


def test_profile_ingestion_auto_activates_facts_and_inferences(tmp_path):
    store = MemoryV4Store(tmp_path)
    result = store.ingest_profile("account-a", _profile(), now=1000)
    assert result["changed"] is True
    records = result["store"]["records"]
    assert any(r["kind"] == "goal" and "AI 产品经理" in r["content"] for r in records)
    inference = [r for r in records if r["sourceType"] == "user_profile_inference"]
    assert inference
    assert all(r["status"] == "active" for r in inference)
    assert result["store"]["profileIngestions"][0]["profileHash"]


def test_profile_inference_gate_keeps_high_risk_fields_out_of_active_memory(tmp_path):
    profile = _profile()
    profile["insights"]["valuePriorities"] = ["追求权力与地位"]
    result = MemoryV4Store(tmp_path).ingest_profile("account-a", profile, now=1000)
    active_inferences = [
        record for record in result["store"]["records"]
        if record.get("sourceType") == "user_profile_inference" and record.get("status") == "active"
    ]
    assert active_inferences
    assert all(record.get("kind") in {"fact", "preference"} for record in active_inferences)
    assert all("追求权力与地位" not in record.get("content", "") for record in active_inferences)


def test_profile_ingestion_is_idempotent_for_same_hash(tmp_path):
    store = MemoryV4Store(tmp_path)
    first = store.ingest_profile("account-a", _profile(), now=1000)
    second = store.ingest_profile("account-a", _profile(), now=2000)
    assert second["changed"] is False
    assert len(second["store"]["records"]) == len(first["store"]["records"])


def test_profile_change_updates_same_semantic_record(tmp_path):
    store = MemoryV4Store(tmp_path)
    first = store.ingest_profile("account-a", _profile("产品经理"), now=1000)
    second = store.ingest_profile("account-a", _profile("AI 产品负责人"), now=2000)
    old_goals = [r for r in second["store"]["records"] if r["kind"] == "goal"]
    assert len(old_goals) == 1
    assert old_goals[0]["status"] == "active"
    assert "AI 产品负责人" in old_goals[0]["content"]


def test_evidence_projection_and_idempotency(tmp_path):
    store = MemoryV4Store(tmp_path)
    first = store.append_evidence("account-a", _evidence("account-a"))
    state = first["store"]["projections"]["conceptStates"][0]
    assert state["conceptKey"] == "工具调用"
    assert state["status"] == "demonstrated"
    duplicate = store.append_evidence("account-a", _evidence("account-a"))
    assert duplicate["duplicate"] is True
    assert len(store.load_evidence("account-a")) == 1


def test_projection_dirty_state_recovers_after_partial_write(tmp_path, monkeypatch):
    import pytest
    store = MemoryV4Store(tmp_path)
    original = store._rebuild_projections

    def fail_rebuild(*args, **kwargs):
        raise RuntimeError("injected projection failure")

    monkeypatch.setattr(store, "_rebuild_projections", fail_rebuild)
    with pytest.raises(RuntimeError):
        store.append_evidence("account-a", _evidence("account-a"))
    monkeypatch.setattr(store, "_rebuild_projections", original)

    recovered = store.load_store("account-a")
    assert recovered["projections"]["dirty"] is False
    assert recovered["projections"]["conceptStates"][0]["conceptKey"] == "工具调用"
    assert len(store.load_evidence("account-a")) == 1


def test_retry_evidence_preserves_history_and_latest_drives_state(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.append_evidence("account-a", _evidence("account-a", evidence_id="ev-1", idem="idem-1", outcome="not_demonstrated", created_at=1000, attempt=1, checkpoint_id="cp-shared"))
    store.append_evidence("account-a", _evidence("account-a", evidence_id="ev-2", idem="idem-2", outcome="demonstrated", created_at=2000, attempt=2, checkpoint_id="cp-shared"))
    assert len(store.load_evidence("account-a")) == 2
    state = store.load_store("account-a")["projections"]["conceptStates"][0]
    assert state["status"] == "demonstrated"
    assert state["evidenceCount"] == 2


def test_account_isolation(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.append_evidence("account-a", _evidence("account-a"))
    assert store.load_store("account-b")["records"] == []
    assert store.load_evidence("account-b") == []


def test_tombstone_removes_record_from_active_projection_context(tmp_path):
    store = MemoryV4Store(tmp_path)
    result = store.ingest_profile("account-a", _profile(), now=1000)
    target = next(r for r in result["store"]["records"] if r["kind"] == "goal")
    deleted = store.tombstone_record("account-a", target["memoryId"], "user_correction")
    assert any(t["memoryId"] == target["memoryId"] for t in deleted["store"]["tombstones"])
    active_ids = [r["memoryId"] for r in deleted["store"]["records"] if r["status"] == "active"]
    assert target["memoryId"] not in active_ids
    assert target["memoryId"] not in deleted["store"]["core"]["sourceRecordIds"]


def test_chat_summary_round_trip_and_course_scope(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.upsert_chat_summary("account-a", "course-1", {
        "summary": "讨论了工具调用与工作流",
        "unresolvedConcepts": ["工具调用"],
        "preferredExplanationStyles": ["分步拆解"],
    }, now=1000)
    summary = store.get_chat_summary("account-a", "course-1")
    assert summary is not None
    assert "工具调用" in summary["summary"]
    assert summary["unresolvedConcepts"] == ["工具调用"]


def test_planning_and_chat_context_use_v4_store(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.ingest_profile("account-a", _profile(), now=1000)
    store.append_evidence("account-a", _evidence("account-a", outcome="not_demonstrated"))
    planning = store.build_planning_context("account-a", "Agent")
    chat = store.build_chat_context("account-a", "Agent", "工具调用")
    assert planning["userProfile"]["targetJob"] == "AI 产品经理"
    assert "工具调用" in planning["planningMemory"]["riskConcepts"]
    assert chat["riskConcepts"] == ["工具调用"]
    assert chat["preferredExplanationStyles"]


def test_sealed_checkpoint_is_account_scoped(tmp_path):
    store = MemoryV4Store(tmp_path)
    definition = {
        "checkpointId": "cp-1",
        "objectiveId": "obj-1",
        "taskId": "task-1",
        "conceptKeys": ["etag"],
        "kind": "scenario_choice",
        "prompt": "题",
        "options": [{"id": "a", "text": "A"}, {"id": "b", "text": "B"}],
        "correctAnswer": "b",
        "remediationHint": "提示",
        "estimatedSeconds": 45,
        "sourceRefs": [],
    }
    store.save_checkpoint_definition("account-a", definition, {"courseId": "c1", "chapterId": "ch1", "taskId": "task-1"})
    assert store.load_checkpoint("account-a", "cp-1") is not None
    assert store.load_checkpoint("account-b", "cp-1") is None


def _client():
    from fastapi.testclient import TestClient
    from main import app
    return TestClient(app)


def test_profile_ingest_and_context_endpoints(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    response = client.post("/api/user/memory/profile-ingest", json={"profile": _profile()}, headers=headers)
    assert response.status_code == 200
    assert response.json()["changed"] is True
    response = client.post("/api/user/memory/context", json={"scene": "course_planning", "topic": "Agent"}, headers=headers)
    assert response.status_code == 200
    context = response.json()["context"]
    assert context["scene"] == "course_planning"
    assert context["core"]["goals"]
    assert context["policyId"] == "memory-policy-course-planning"


def test_memory_api_account_isolation(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    client.post("/api/user/memory/profile-ingest", json={"profile": _profile()}, headers={"X-Account-Id": "account-a"})
    response = client.get("/api/user/memory", headers={"X-Account-Id": "account-b"})
    assert response.status_code == 200
    assert response.json()["store"]["records"] == []


def test_memory_delete_endpoint_tombstones_record(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    ingest = client.post("/api/user/memory/profile-ingest", json={"profile": _profile()}, headers=headers).json()
    store = memory_module.MemoryV4Store(tmp_path).load_store("account-a")
    target = next(r for r in store["records"] if r["kind"] == "goal")
    response = client.delete(f"/api/user/memory/records/{target['memoryId']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["tombstone"]["memoryId"] == target["memoryId"]


def test_same_idempotency_key_with_different_answer_conflicts(tmp_path):
    import pytest
    from services.memory_v4_store import EvidenceIdempotencyConflict
    store = MemoryV4Store(tmp_path)
    first = _evidence("account-a", evidence_id="ev-a", idem="same-key")
    store.append_evidence("account-a", first)
    second = _evidence("account-a", evidence_id="ev-b", idem="same-key")
    second["evidenceKey"] = "different-key"
    with pytest.raises(EvidenceIdempotencyConflict):
        store.append_evidence("account-a", second)


def test_checkpoint_evaluation_context_has_no_personal_memory(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    client.post("/api/user/memory/profile-ingest", json={"profile": _profile()}, headers=headers)
    response = client.post("/api/user/memory/context", json={"scene": "checkpoint_evaluation", "topic": "Agent"}, headers=headers)
    assert response.status_code == 200
    context = response.json()["context"]
    assert "core" not in context
    assert "learningState" not in context
    assert context["selectionTrace"]["droppedReasons"] == ["personal_memory_forbidden"]


def test_course_delete_removes_course_evidence_and_rebuilds_projection(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.append_evidence("account-a", _evidence("account-a", evidence_id="ev-course", idem="idem-course"))
    store.upsert_chat_summary("account-a", "course-1", {"summary": "课程摘要"}, now=1100)
    result = store.delete_course_memory("account-a", "course-1")
    assert result["removedEvidenceCount"] == 1
    assert store.load_evidence("account-a") == []
    assert store.load_store("account-a")["projections"]["conceptStates"] == []
    assert store.get_chat_summary("account-a", "course-1") is None


def test_profile_endpoint_reads_server_snapshot(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    client.post("/api/user/memory/profile-ingest", json={"profile": _profile()}, headers=headers)
    response = client.get("/api/user/memory/profile", headers=headers)
    assert response.status_code == 200
    assert response.json()["profile"]["targetJob"] == "AI 产品经理"


def test_chat_context_topic_summary_is_course_scoped(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.upsert_chat_summary("account-a", "course-1", {"summary": "课程一摘要"}, now=1000)
    store.upsert_chat_summary("account-a", "course-2", {"summary": "课程二摘要"}, now=2000)
    context = store.build_chat_context("account-a", "Agent", "工具调用", "course-1")
    assert context["topicSummary"] == "课程一摘要"


def test_profile_reverting_to_previous_value_reactivates_memory(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.ingest_profile("account-a", _profile("产品经理"), now=1000)
    store.ingest_profile("account-a", _profile("AI 产品负责人"), now=2000)
    result = store.ingest_profile("account-a", _profile("产品经理"), now=3000)
    active_goals = [r for r in result["store"]["records"] if r["kind"] == "goal" and r["status"] == "active"]
    assert any("产品经理" in r["content"] for r in active_goals)


def test_remediation_strategy_only_counts_after_complete_outcome(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.append_evidence("account-a", _evidence("account-a", evidence_id="ev-before", idem="idem-before", outcome="not_demonstrated", created_at=1000, checkpoint_id="cp-shared"))
    store.append_evidence("account-a", _evidence("account-a", evidence_id="ev-after", idem="idem-after", outcome="demonstrated", created_at=2000, attempt=2, checkpoint_id="cp-shared"))
    store.append_remediation("account-a", {
        "remediationId": "rem-1",
        "accountId": "account-a",
        "conceptKeys": ["工具调用"],
        "triggerEvidenceId": "ev-before",
        "beforeEvidenceId": "ev-before",
        "afterEvidenceId": None,
        "strategyKey": "llm-remediation-v1",
        "strategyVersion": "1",
        "round": 1,
        "outcome": "pending",
        "createdAt": 2500,
    })
    state = store.load_store("account-a")["projections"]["conceptStates"][0]
    assert state["effectiveRemediationStrategies"] == []
    store.update_remediation_after_evidence("account-a", "rem-1", "ev-after", "helped")
    state = store.load_store("account-a")["projections"]["conceptStates"][0]
    assert state["effectiveRemediationStrategies"][0]["successCount"] == 1


def test_profile_endpoint_returns_null_when_not_ingested(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    response = client.get("/api/user/memory/profile", headers={"X-Account-Id": "account-new"})
    assert response.status_code == 200
    assert response.json()["profile"] is None


def test_record_patch_appends_user_edit_source(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    response = client.post("/api/user/memory/profile-ingest", json={"profile": _profile()}, headers=headers)
    assert response.status_code == 200
    store = memory_module.MemoryV4Store(tmp_path).load_store("account-a")
    target = next(r for r in store["records"] if r["kind"] == "goal")
    patch = client.patch(
        f"/api/user/memory/records/{target['memoryId']}",
        json={"patch": {"content": "AI 产品负责人", "summary": "更新后的目标"}},
        headers=headers,
    )
    assert patch.status_code == 200
    record = patch.json()["record"]
    assert record["content"] == "AI 产品负责人"
    assert any(ref.get("type") == "user_edit" for ref in record["sourceRefs"])


def test_chapter_recap_creates_course_episode(tmp_path):
    store = MemoryV4Store(tmp_path)
    store.append_evidence("account-a", _evidence("account-a", outcome="demonstrated", concept="工具调用"))
    result = store.upsert_chapter_episode(
        "account-a",
        course_id="course-1",
        chapter_id="ch-1",
        topic="Agent",
        chapter_title="工具调用入门",
        teaching_goal="理解工具调用",
        recap={
            "chapterId": "ch-1",
            "keyTakeaways": ["工具调用是按需使用外部能力"],
            "demonstratedObjectives": ["obj-1"],
            "fragileObjectives": [],
            "unresolvedQuestions": [],
            "recommendedReview": "复习工具选择时机",
        },
        now=2000,
    )
    episode = result["episode"]
    assert episode["kind"] == "episode"
    assert episode["scope"] == {"type": "course", "courseId": "course-1"}
    assert "工具调用" in episode["conceptKeys"]
    assert episode["sourceRefs"][0]["type"] == "chapter_recap"


def test_chapter_episode_endpoint_and_summary_rebuild(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    memory_module.MemoryV4Store(tmp_path).save_chapter_recap_snapshot(
        "account-a",
        course_id="course-1",
        chapter_id="ch-1",
        topic="Agent",
        chapter_title="工具调用",
        teaching_goal="理解工具调用",
        recap={"keyTakeaways": ["按需调用工具"], "recommendedReview": "复习工具选择"},
    )
    response = client.post("/api/user/memory/chapter-episode", json={
        "courseId": "course-1",
        "chapterId": "ch-1",
    }, headers=headers)
    assert response.status_code == 200
    episode_id = response.json()["episodeId"]
    store = memory_module.MemoryV4Store(tmp_path).load_store("account-a")
    assert any(r["memoryId"] == episode_id and r["kind"] == "episode" for r in store["records"])


def test_chapter_episode_ignores_client_supplied_recap(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    store = memory_module.MemoryV4Store(tmp_path)
    store.save_chapter_recap_snapshot(
        "account-a",
        course_id="course-1",
        chapter_id="ch-1",
        topic="Agent",
        chapter_title="工具调用",
        teaching_goal="理解工具调用",
        recap={"keyTakeaways": ["服务端要点"]},
    )
    response = client.post("/api/user/memory/chapter-episode", json={
        "courseId": "course-1",
        "chapterId": "ch-1",
        "recap": {"keyTakeaways": ["伪造要点"]},
    }, headers=headers)
    assert response.status_code == 200
    saved = store.load_store("account-a")
    episode = next(r for r in saved["records"] if r["kind"] == "episode")
    assert "服务端要点" in episode["content"]
    assert "伪造要点" not in episode["content"]


def test_chat_summary_endpoint_uses_server_transcript(monkeypatch, tmp_path):
    import services.memory_v4_store as memory_module
    memory_module._DATA_ROOT = tmp_path
    client = _client()
    headers = {"X-Account-Id": "account-a"}
    store = memory_module.MemoryV4Store(tmp_path)
    store.append_chat_transcript(
        "account-a",
        "course-1",
        [
            {"messageId": "u1", "role": "user", "content": "我还是不太理解工具调用", "createdAt": 1000},
            {"messageId": "a1", "role": "assistant", "content": "可以把它想成按需调用的外部能力", "createdAt": 1001},
        ],
        now=1002,
    )
    response = client.post("/api/user/memory/chat-summary", json={
        "courseId": "course-1",
        "summary": {"summary": "客户端伪造摘要"},
    }, headers=headers)
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert "客户端伪造摘要" not in summary["summary"]
    assert "工具调用" in summary["summary"]
    saved = store.get_chat_summary("account-a", "course-1")
    assert saved["summary"] == summary["summary"]
    assert saved["sourceRefs"][0]["messageId"] == "u1"


def test_chat_summary_extracts_unresolved_fragment_not_preference(tmp_path):
    from services.chat_memory_service import build_server_chat_summary
    store = MemoryV4Store(tmp_path)
    store.append_chat_transcript(
        "account-a",
        "course-1",
        [
            {
                "messageId": "u1",
                "role": "user",
                "content": "以后请分步骤解释。另外我还是不理解 ETag 和 Last-Modified 为什么优先 ETag。",
                "createdAt": 1000,
            }
        ],
        now=1001,
    )
    summary = build_server_chat_summary(store, "account-a", "course-1")
    assert summary is not None
    assert summary["unresolvedConcepts"][0].startswith("不理解 ETag")
    assert all("以后请分步骤" not in item for item in summary["unresolvedConcepts"])


def test_same_evidence_key_with_different_idempotency_conflicts(tmp_path):
    import pytest
    from services.memory_v4_store import EvidenceIdempotencyConflict
    store = MemoryV4Store(tmp_path)
    first = _evidence("account-a", evidence_id="ev-a", idem="first")
    store.append_evidence("account-a", first)
    second = _evidence("account-a", evidence_id="ev-b", idem="second")
    second["evidenceKey"] = first["evidenceKey"]
    with pytest.raises(EvidenceIdempotencyConflict):
        store.append_evidence("account-a", second)


def test_checkpoint_evidence_rejects_out_of_order_attempt(tmp_path):
    import pytest
    from services.memory_v4_store import EvidenceAttemptOrderConflict
    store = MemoryV4Store(tmp_path)
    store.append_evidence("account-a", _evidence("account-a", evidence_id="ev-1", idem="idem-1", attempt=1, checkpoint_id="cp-shared"))
    with pytest.raises(EvidenceAttemptOrderConflict):
        store.append_evidence("account-a", _evidence("account-a", evidence_id="ev-3", idem="idem-3", attempt=3, checkpoint_id="cp-shared"))


def test_tombstoned_profile_field_does_not_reappear_after_profile_change(tmp_path):
    store = MemoryV4Store(tmp_path)
    first = store.ingest_profile("account-a", _profile("产品经理"), now=1000)
    goal = next(r for r in first["store"]["records"] if r["kind"] == "goal")
    store.tombstone_record("account-a", goal["memoryId"], "user_correction")
    second = store.ingest_profile("account-a", _profile("AI 产品负责人"), now=2000)
    active_goals = [r for r in second["store"]["records"] if r["kind"] == "goal" and r["status"] == "active"]
    assert active_goals == []
    assert any(t["dedupeKey"] == goal["dedupeKey"] for t in second["store"]["tombstones"])


def test_deleted_episode_and_chat_summary_are_not_recreated(tmp_path):
    store = MemoryV4Store(tmp_path)
    episode = store.upsert_chapter_episode(
        "account-a", course_id="course-1", chapter_id="ch-1", topic="Agent",
        chapter_title="工具调用", teaching_goal="理解工具调用", recap={"keyTakeaways": ["要点"]}, now=1000,
    )["episode"]
    store.tombstone_record("account-a", episode["memoryId"], "user_forget")
    second = store.upsert_chapter_episode(
        "account-a", course_id="course-1", chapter_id="ch-1", topic="Agent",
        chapter_title="工具调用", teaching_goal="理解工具调用", recap={"keyTakeaways": ["要点"]}, now=2000,
    )
    assert second["episode"] is None

    summary_record = store.upsert_chat_summary("account-a", "course-1", {"summary": "摘要"}, now=1000)["summary"]
    store.tombstone_record("account-a", summary_record["memoryId"], "user_forget")
    third = store.upsert_chat_summary("account-a", "course-1", {"summary": "新摘要"}, now=2000)
    assert third["summary"] is None
