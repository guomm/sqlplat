import pytest


def test_login_requires_correct_password(client):
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"username": "admin", "password": "wrong"}
        ).status_code
        == 401
    )
    res = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin-password"}
    )
    assert res.status_code == 200
    assert "httponly" in res.headers["set-cookie"].lower()
    assert client.get("/api/auth/me").json()["user"]["role"] == "admin"


def test_csrf_required_and_user_disable_invalidates_session(admin):
    data = {"username": "reader", "password": "reader-password", "role": "user"}
    token = admin.headers.pop("X-CSRF-Token")
    assert admin.post("/api/users", json=data).status_code == 403
    admin.headers["X-CSRF-Token"] = token
    assert admin.post("/api/users", json=data).status_code == 201
    assert admin.patch("/api/users/1", json={"enabled": False}).status_code == 409
    users = admin.get("/api/users").json()
    reader = next(u for u in users if u["username"] == "reader")
    assert (
        admin.patch(
            "/api/users/" + str(reader["id"]), json={"enabled": False}
        ).status_code
        == 200
    )
    assert (
        admin.post(
            "/api/auth/login",
            json={"username": "reader", "password": "reader-password"},
        ).status_code
        == 401
    )


def test_password_change_revokes_other_sessions(admin):
    assert (
        admin.post(
            "/api/auth/password",
            json={"old_password": "wrong", "new_password": "new-password"},
        ).status_code
        == 400
    )
    assert (
        admin.post(
            "/api/auth/password",
            json={"old_password": "admin-password", "new_password": "new-password"},
        ).status_code
        == 200
    )
    assert admin.get("/api/auth/me").status_code == 401
    assert (
        admin.post(
            "/api/auth/login", json={"username": "admin", "password": "new-password"}
        ).status_code
        == 200
    )


def test_regular_user_cannot_manage_users(client):
    data = client.post(
        "/api/auth/login", json={"username": "other", "password": "other-password"}
    ).json()
    client.headers["X-CSRF-Token"] = data["csrf_token"]
    assert client.get("/api/users").status_code == 403


@pytest.mark.parametrize(
    "account",
    ["sql.reader", "reader@example.com", "reader+sql@example.com", "数据分析员"],
)
def test_email_or_custom_account_and_eight_character_password(admin, account):
    rejected = admin.post(
        "/api/users", json={"username": account, "password": "1234567"}
    )
    assert rejected.status_code == 422
    created = admin.post(
        "/api/users", json={"username": " " + account + " ", "password": "12345678"}
    )
    assert created.status_code == 201
    assert created.json()["username"] == account
    assert (
        admin.post(
            "/api/auth/login",
            json={"username": " " + account + " ", "password": "12345678"},
        ).status_code
        == 200
    )


def test_reset_and_change_password_minimum_eight(admin):
    created = admin.post(
        "/api/users",
        json={"username": "password.reader", "password": "reader-password"},
    ).json()
    url = "/api/users/" + str(created["id"])
    assert admin.patch(url, json={"password": "1234567"}).status_code == 422
    assert admin.patch(url, json={"password": "12345678"}).status_code == 200
    login = admin.post(
        "/api/auth/login", json={"username": "password.reader", "password": "12345678"}
    )
    assert login.status_code == 200
    admin.headers["X-CSRF-Token"] = login.json()["csrf_token"]
    assert (
        admin.post(
            "/api/auth/password",
            json={"old_password": "12345678", "new_password": "abcdefg"},
        ).status_code
        == 422
    )
    assert (
        admin.post(
            "/api/auth/password",
            json={"old_password": "12345678", "new_password": "abcdefgh"},
        ).status_code
        == 200
    )
    assert admin.get("/api/auth/me").status_code == 401
    assert (
        admin.post(
            "/api/auth/login",
            json={"username": "password.reader", "password": "abcdefgh"},
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "account",
    [
        "",
        "   ",
        "has space",
        "user@",
        "user@@example.com",
        "user@-example.com",
        "x" * 81,
    ],
)
def test_invalid_account_rejected(admin, account):
    assert (
        admin.post(
            "/api/users", json={"username": account, "password": "12345678"}
        ).status_code
        == 422
    )
