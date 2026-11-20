from services.memory_dimension_view import build_memory_dimension_view


def _record(memory_id, kind, title, content, **overrides):
    base = {
        "memoryId": memory_id,
        "accountId": "account-a",
        "kind": kind,
        "scope": {"type": "user"},
        "status": "active",
        "title": title,
        "summary": content,
        "content": content,
        "tags": [],
        "conceptKeys": [],
        "sourceType": "explicit_user_statement",
        "sourceRefs": [],
        "evidenceIds": [],
        "dedupeKey": memory_id,
        "confidence": 0.9,
        "importance": 0.7,
        "durability": "long_term",
        "sensitivity": "normal",
        "observedAt": 1000,
        "createdAt": 1000,
        "updatedAt": 1000,
        "version": 1,
        "createdBy": "rule",
    }
    base.update(overrides)
    return base


def test_dimension_view_groups_records_into_fixed_five_dimensions():
    records = [
        _record("goal", "goal", "目标岗位", "AI 产品经理", importance=0.92),
        _record(
            "duplicate-target",
            "fact",
            "目标岗位背景",
            "目标岗位：AI 产品经理",
            dedupeKey="profile:targetJob:background",
            tags=["background", "targetJob"],
        ),
        _record(
            "work",
            "fact",
            "工作经历",
            "字节跳动，飞书 IM 产品经理",
            tags=["background", "work"],
        ),
        _record(
            "analogy",
            "fact",
            "类比经历",
            "负责飞书 IM 的全部产品工作",
            tags=["analogy"],
            sourceType="user_profile_inference",
        ),
        _record("pref-step", "preference", "分步骤解释偏好", "以后复杂概念请分步骤解释"),
        _record("pref-example", "preference", "生活例子偏好", "多举生活中的例子"),
        _record(
            "strategy-a",
            "teaching_strategy",
            "已验证的补救策略",
            "补救策略「llm-remediation-v1」在概念「304、ETag」上已验证有效。",
            sourceType="learning_evidence",
        ),
        _record(
            "strategy-b",
            "teaching_strategy",
            "已验证的补救策略",
            "补救策略「llm-remediation-v1」在概念「验证机制、判读方法」上已验证有效。",
            sourceType="learning_evidence",
        ),
        _record(
            "episode",
            "episode",
            "章节经验：HTTP 缓存",
            "完成 HTTP 缓存章节",
            scope={"type": "course", "courseId": "course-1"},
        ),
    ]
    store = {"revision": 7, "records": records}
    dimensions = {item["id"]: item for item in build_memory_dimension_view(store)}

    assert set(dimensions) == {"direction", "background", "preferences", "teaching", "history"}
    assert dimensions["direction"]["summary"] == "AI 产品经理"
    assert dimensions["background"]["sourceCount"] == 2
    assert "1 段工作经历" in dimensions["background"]["summary"]
    assert "1 条可迁移经历" in dimensions["background"]["summary"]
    assert "分步骤解释" in dimensions["preferences"]["summary"]
    assert "生活例子" in dimensions["preferences"]["summary"]
    assert "已验证 1 种补救策略" in dimensions["teaching"]["summary"]
    assert "覆盖 4 个概念" in dimensions["teaching"]["summary"]
    assert dimensions["history"]["sourceCount"] == 1
    assert all(item["sourceRevision"] == 7 for item in dimensions.values())
