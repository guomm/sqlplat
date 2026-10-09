"""Shared validation for platform account identifiers."""

import re

EMAIL = re.compile(
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+"
)


def normalize_account(value: str) -> str:
    value = value.strip()
    custom = value and all(c.isalnum() or c in "_.-" for c in value)
    if not 1 <= len(value) <= 80 or not (custom or EMAIL.fullmatch(value)):
        raise ValueError(
            "账号需为邮箱或自定义名称（中文、字母、数字、点、下划线、短横线），最多 80 位"
        )
    return value
