"""Administrative commands: python -m app.cli create-admin USERNAME."""

import argparse
import getpass

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from .accounts import normalize_account
from .config import Settings
from .models import User
from .security import hash_password


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["create-admin"])
    parser.add_argument("username")
    args = parser.parse_args()
    try:
        args.username = normalize_account(args.username)
    except ValueError as exc:
        parser.error(str(exc))
    password = getpass.getpass("管理员密码（至少 8 位）: ")
    if not 8 <= len(password) <= 1024 or password != getpass.getpass("再次输入密码: "):
        parser.error("密码长度不足或两次密码不一致")
    settings = Settings()
    with Session(create_engine(settings.database_url)) as db:
        if db.scalar(select(User).where(User.username == args.username)):
            parser.error("账号已存在，请通过管理页面修改")
        db.add(
            User(
                username=args.username,
                password_hash=hash_password(password),
                role="admin",
            )
        )
        db.commit()
    print("管理员已创建")


if __name__ == "__main__":
    main()
