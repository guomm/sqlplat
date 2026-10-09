import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


@pytest.fixture
def app(tmp_path):
    from app.config import Settings
    from app.main import create_app
    from app.models import Base, User
    from app.security import hash_password

    settings = Settings(
        database_url="sqlite:///" + str(tmp_path / "db.sqlite"),
        encryption_key=Fernet.generate_key().decode(),
        result_dir=tmp_path / "results",
        cookie_secure=False,
    )
    engine = create_engine(
        settings.database_url, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    with sessionmaker(engine)() as db:
        db.add_all(
            [
                User(
                    username="admin",
                    password_hash=hash_password("admin-password"),
                    role="admin",
                ),
                User(username="other", password_hash=hash_password("other-password")),
            ]
        )
        db.commit()
    application = create_app(settings)
    with TestClient(application) as client:
        application.test_client = client
        yield application


@pytest.fixture
def client(app):
    return app.test_client


@pytest.fixture
def admin(client):
    response = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin-password"}
    )
    assert response.status_code == 200
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    return client
