"""MySQL statement scanner; equivalent implementation lives in frontend/src/sql.ts.

SQL mode contract: standard MySQL escaping, not ANSI_QUOTES or NO_BACKSLASH_ESCAPES.
Stored routines/DELIMITER and explicit transaction control are outside v1.
"""

import re


def split_statements(text):
    result = []
    start = 0
    i = 0
    quote = None
    comment = None
    meaningful = False
    while i < len(text):
        c = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if comment == "line":
            if c in "\r\n":
                comment = None
        elif comment == "block":
            if c == "*" and nxt == "/":
                comment = None
                i += 1
        elif quote:
            if c == "\\":
                i += 1
            elif c == quote:
                if nxt == quote:
                    i += 1
                else:
                    quote = None
        elif c in "'\"`":
            quote = c
            meaningful = True
        elif c == "#" or (
            c == "-" and nxt == "-" and (i + 2 == len(text) or text[i + 2].isspace())
        ):
            comment = "line"
        elif c == "/" and nxt == "*":
            if i + 2 < len(text) and text[i + 2] == "!":
                meaningful = True
            comment = "block"
            i += 1
        elif c == ";":
            if meaningful:
                result.append(
                    {"sql": text[start:i].strip(), "start": start, "end": i + 1}
                )
            start = i + 1
            meaningful = False
        elif not c.isspace():
            meaningful = True
        i += 1
    if quote or comment == "block":
        raise ValueError("SQL 字符串或块注释未闭合")
    if meaningful:
        result.append({"sql": text[start:].strip(), "start": start, "end": len(text)})
    return result


def statement_at(text, offset):
    parts = split_statements(text)
    for part in parts:
        if part["start"] <= offset < part["end"]:
            return part["sql"]
    return parts[-1]["sql"] if parts and offset == len(text) else ""


def validate_sql(text):
    parts = split_statements(text)
    if not parts:
        raise ValueError("请输入可执行的 SQL")
    for part in parts:
        # Executable version comments run on the server; inspect their bodies.
        effective = re.sub(
            r"/\*!(?:\d+\s*)?(.*?)\*/",
            lambda m: " " + m.group(1) + " ",
            part["sql"],
            flags=re.S,
        )
        clean = re.sub(
            r"'(?:(?:\\.)|''|[^'])*'|\"(?:(?:\\.)|\"\"|[^\"])*\"", "''", effective
        )
        clean = re.sub(
            r"/\*.*?\*/|--(?=\s|$)[^\n]*|#[^\n]*", " ", clean, flags=re.S
        ).strip()
        if re.match(
            r"(?i)^(DELIMITER|BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)\b",
            clean,
        ):
            raise ValueError("首版使用自动提交，不支持 DELIMITER 或手动事务控制")
        if re.match(r"(?i)^SET\b", clean) and re.search(
            r"(?i)(?<![@\w])(?:@@(?:(?:SESSION|LOCAL|GLOBAL)\.)?)?(?:AUTOCOMMIT|SQL_MODE)\b",
            clean.replace("`", ""),
        ):
            raise ValueError("首版不允许修改 AUTOCOMMIT 或 SQL_MODE")
    return parts
