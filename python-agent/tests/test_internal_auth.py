# 服务间认证回归：配置令牌后，Python Agent 的 /api/* 必须拒绝无凭证请求。

from fastapi.testclient import TestClient

from main import app


client = TestClient(app)


def test_health_does_not_require_internal_token():
    assert client.get("/health").status_code == 200


def test_api_rejected_without_token(monkeypatch):
    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "secret")
    response = client.get("/api/user/courses")
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"


def test_api_rejected_with_wrong_token(monkeypatch):
    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "secret")
    response = client.get(
        "/api/user/courses",
        headers={"X-Internal-Token": "wrong"},
    )
    assert response.status_code == 401


def test_api_passes_with_correct_token(monkeypatch):
    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "secret")
    response = client.get(
        "/api/user/courses",
        headers={"X-Internal-Token": "secret"},
    )
    # 无账户身份应进入业务层校验，而不是被服务间认证拦截
    assert response.status_code == 401
    assert response.json()["message"] == "缺少账户身份"


def test_delete_course_requires_course_id(monkeypatch):
    monkeypatch.setenv("PYTHON_INTERNAL_TOKEN", "secret")
    response = client.request(
        "DELETE",
        "/api/user/courses",
        headers={"X-Internal-Token": "secret", "X-Account-Id": "test-user"},
    )
    assert response.status_code == 422
    assert response.json()["message"] == "缺少 courseId"
