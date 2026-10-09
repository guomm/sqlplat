import pytest
from app.models import Connection, Execution


def create_connection(admin):
    response = admin.post(
        "/api/connections",
        json={
            "name": "待删除连接",
            "kind": "mysql",
            "host": "localhost",
            "port": 3306,
            "username": "reader",
            "password": "secret",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_delete_preserves_history_and_saved_sql_but_removes_credentials(admin, app):
    cid = create_connection(admin)
    saved = admin.post(
        "/api/saved-queries",
        json={
            "name": "保留查询",
            "sql": "SELECT 42",
            "connection_id": cid,
        },
    ).json()
    with app.state.db() as db:
        task = Execution(
            user_id=1,
            connection_id=cid,
            connection_name="待删除连接",
            sql="SELECT 42",
            status="success",
        )
        db.add(task)
        db.commit()
        eid = task.id
    assert admin.delete(f"/api/connections/{cid}").status_code == 204
    assert admin.get("/api/connections").json() == []
    history = admin.get(f"/api/executions/{eid}").json()
    assert history["sql"] == "SELECT 42"
    assert history["connection_name"] == "待删除连接"
    assert history["connection_id"] is None
    restored = admin.get(f"/api/saved-queries/{saved['id']}").json()
    assert restored["sql"] == "SELECT 42"
    assert restored["connection_id"] is None
    assert "已删除" in restored["connection_name"]
    with app.state.db() as db:
        conn = db.get(Connection, cid)
        assert conn.password_cipher == ""
        assert conn.username == ""
        assert conn.tls == {}
        assert not conn.enabled
    assert admin.delete(f"/api/connections/{cid}").status_code == 404
    assert admin.post(f"/api/connections/{cid}/test").status_code == 404
    assert admin.get(f"/api/connections/{cid}/databases").status_code == 404
    assert (
        admin.post(
            "/api/executions", json={"connection_id": cid, "sql": "SELECT 1"}
        ).status_code
        == 404
    )
    assert (
        admin.post(
            "/api/saved-queries",
            json={"name": "新查询", "sql": "SELECT 1", "connection_id": cid},
        ).status_code
        == 404
    )
    assert (
        admin.put(
            f"/api/connections/{cid}",
            json={
                "name": "不能恢复",
                "kind": "mysql",
                "host": "localhost",
                "port": 3306,
                "username": "u",
                "password": "",
            },
        ).status_code
        == 404
    )


@pytest.mark.parametrize("status", ["queued", "running"])
def test_delete_rejects_unfinished_tasks(admin, app, status):
    cid = create_connection(admin)
    with app.state.db() as db:
        db.add(
            Execution(
                user_id=2,
                connection_id=cid,
                connection_name="待删除连接",
                sql="SELECT 1",
                status=status,
            )
        )
        db.commit()
    assert admin.delete(f"/api/connections/{cid}").status_code == 409
    assert len(admin.get("/api/connections").json()) == 1


def test_delete_requires_admin_and_csrf(admin):
    cid = create_connection(admin)
    token = admin.headers.pop("X-CSRF-Token")
    assert admin.delete(f"/api/connections/{cid}").status_code == 403
    admin.headers["X-CSRF-Token"] = token
    login = admin.post(
        "/api/auth/login", json={"username": "other", "password": "other-password"}
    ).json()
    admin.headers["X-CSRF-Token"] = login["csrf_token"]
    assert admin.delete(f"/api/connections/{cid}").status_code == 403
    assert len(admin.get("/api/connections").json()) == 1
