"""One-time local bootstrap, using MYSQL_HOST/PORT/USER/PASSWORD environment.

Creates only sqlplat and sqlplat_demo namespaces. Does not reset existing data.
Run: uv run python scripts/bootstrap-local.py
"""

import os
import secrets
import sys
from pathlib import Path
from urllib.parse import quote

import pymysql
from alembic import command
from alembic.config import Config
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))

# Application imports follow local path setup intentionally.
from app.config import Settings  # noqa: E402
from app.models import Connection, User  # noqa: E402
from app.security import hash_password  # noqa: E402

os.chdir(root)
local = root / ".local"
local.mkdir(exist_ok=True)
config_file = root / ".env"
if not config_file.exists():
    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    port = int(os.environ.get("MYSQL_PORT", "3306"))
    user = os.environ.get("MYSQL_USER", "root")
    import getpass

    password = os.environ.get("MYSQL_PASSWORD") or getpass.getpass("本地 MySQL 密码: ")
    with pymysql.connect(
        host=host, port=port, user=user, password=password, autocommit=True
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE DATABASE IF NOT EXISTS sqlplat CHARACTER SET utf8mb4")
    key = Fernet.generate_key().decode()
    text = f"DATABASE_URL=mysql+pymysql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}/sqlplat?charset=utf8mb4\nENCRYPTION_KEY={key}\nRESULT_DIR=.local/results\nCOOKIE_SECURE=false\n"
    config_file.write_text(text)
    config_file.chmod(0o600)
settings = Settings()
command.upgrade(Config(str(root / "backend/alembic.ini")), "head")
engine = create_engine(settings.database_url)
with Session(engine) as db:
    if not db.scalar(select(User).where(User.role == "admin")):
        initial = secrets.token_urlsafe(16)
        db.add(
            User(username="admin", password_hash=hash_password(initial), role="admin")
        )
        db.commit()
        access = local / "admin-access.txt"
        access.write_text("账号：admin\n密码：" + initial + "\n登录后请修改密码。\n")
        access.chmod(0o600)
        print("初始管理员凭据已保存到 .local/admin-access.txt（未输出密码）")
    existing = db.scalar(select(Connection).where(Connection.name == "本地 MySQL"))
    url = engine.url
    # Never expose the platform credential as a shared SQL execution credential.
    if not existing or existing.username == url.username:
        target_user = "sqlplat_target_" + secrets.token_hex(4)
        target_password = secrets.token_urlsafe(24)
        with pymysql.connect(
            host=url.host,
            port=url.port or 3306,
            user=url.username,
            password=url.password,
            autocommit=True,
        ) as server:
            with server.cursor() as cursor:
                cursor.execute(
                    "CREATE DATABASE IF NOT EXISTS sqlplat_demo CHARACTER SET utf8mb4"
                )
                cursor.execute(
                    "CREATE USER %s@'localhost' IDENTIFIED BY %s",
                    (target_user, target_password),
                )
                cursor.execute(
                    "GRANT ALL ON sqlplat_demo.* TO %s@'localhost'", (target_user,)
                )
        if not existing:
            existing = Connection(
                name="本地 MySQL",
                kind="mysql",
                host=url.host or "127.0.0.1",
                port=url.port or 3306,
                database="sqlplat_demo",
                enabled=True,
                tls={"enabled": False},
            )
        existing.username = target_user
        existing.password_cipher = (
            settings.crypto().encrypt(target_password.encode()).decode()
        )
        db.add(existing)
        db.commit()
url = engine.url
with pymysql.connect(
    host=url.host,
    port=url.port or 3306,
    user=url.username,
    password=url.password,
    autocommit=True,
    charset="utf8mb4",
) as conn:
    with conn.cursor() as cur:
        cur.execute("CREATE DATABASE IF NOT EXISTS sqlplat_demo CHARACTER SET utf8mb4")
        cur.execute(
            "CREATE TABLE IF NOT EXISTS sqlplat_demo.atelier_demo_orders (id BIGINT PRIMARY KEY, region VARCHAR(32), product VARCHAR(64), amount DECIMAL(20,4), ordered_at DATETIME)"
        )
        cur.execute("SELECT COUNT(*) FROM sqlplat_demo.atelier_demo_orders")
        if cur.fetchone()[0] == 0:
            cur.executemany(
                "INSERT INTO sqlplat_demo.atelier_demo_orders VALUES (%s,%s,%s,%s,%s)",
                [
                    (
                        i,
                        ["华东", "华南", "华北"][i % 3],
                        ["数据服务", "分析工作台", "云存储"][i % 3],
                        str(1200 + i * 137.25),
                        "2026-10-09 09:30:00",
                    )
                    for i in range(1, 13)
                ],
            )
print("本地平台初始化完成；示例数据位于 sqlplat_demo.atelier_demo_orders")
