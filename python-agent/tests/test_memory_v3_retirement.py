# 旧 Memory V3 refine 入口必须保持彻底移除。

from fastapi.testclient import TestClient

from main import app


def test_memory_v3_refine_route_is_removed(monkeypatch):
    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "retirement-token")
    client = TestClient(app)

    response = client.post(
        "/api/agents/memory/refine",
        json={"recentMessages": [{"role": "user", "content": "测试"}]},
        headers={"X-Internal-Token": "retirement-token"},
    )

    assert response.status_code == 404
