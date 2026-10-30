"""MySQL/PostgreSQL statement scanner; counterpart in frontend/src/sql.ts.

SQL mode contract: standard MySQL escaping, not ANSI_QUOTES or NO_BACKSLASH_ESCAPES.
Stored routines/DELIMITER and explicit transaction control are outside v1.
"""

import re


def split_statements(text, kind="mysql"):
    result = []
    start = 0
    i = 0
    dollar = None
    depth = 0
    quote = None
    comment = None
    meaningful = False
    while i < len(text):
        c = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if dollar:
            if text.startswith(dollar, i):
                i += len(dollar)
                dollar = None
                continue
        elif comment == "line":
            if c in "\r\n":
                comment = None
        elif comment == "block":
            if c == "*" and nxt == "/":
                depth -= 1
                if not depth:
                    comment = None
                i += 1
            elif kind == "postgresql" and c == "/" and nxt == "*":
                depth += 1
                i += 1
        elif quote:
            if c == "\\" and (kind != "postgresql" or escape_quote):
                i += 1
            elif c == quote:
                if nxt == quote:
                    i += 1
                else:
                    quote = None
        elif kind == "postgresql" and c == "$" and (match := re.match(r"\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$", text[i:])):
            dollar = match.group()
            meaningful = True
            i += len(dollar)
            continue
        elif c in "'\"`":
            escape_quote = i > 0 and text[i - 1] in "eE" and (i < 2 or not (text[i - 2].isalnum() or text[i - 2] == "_"))
            quote = c
            meaningful = True
        elif (c == "#" and kind != "postgresql") or (
            c == "-" and nxt == "-" and (kind == "postgresql" or i + 2 == len(text) or text[i + 2].isspace())
        ):
            comment = "line"
        elif c == "/" and nxt == "*":
            if i + 2 < len(text) and text[i + 2] == "!":
                meaningful = True
            comment = "block"
            depth = 1
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
    if quote or dollar or comment == "block":
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


def validate_sql(text, kind="mysql"):
    parts = split_statements(text, kind)
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
        if kind == "postgresql":
            clean = re.sub(r"--[^\n]*", " ", part["sql"])
            while re.search(r"/\*(?:(?!/\*|\*/)[\s\S])*\*/", clean):
                clean = re.sub(r"/\*(?:(?!/\*|\*/)[\s\S])*\*/", " ", clean)
            clean = clean.strip()
        if re.match(
            r"(?i)^(DELIMITER|BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT)\b",
            clean,
        ):
            raise ValueError("首版使用自动提交，不支持 DELIMITER 或手动事务控制")
        if kind == "postgresql" and re.match(
            r"(?i)^(?:END|ABORT|RELEASE|PREPARE\s+TRANSACTION|SET\s+(?:(?:SESSION|LOCAL)\s+)?(?:TRANSACTION|SESSION\s+CHARACTERISTICS|STANDARD_CONFORMING_STRINGS))\b", clean
        ):
            raise ValueError("不支持手动事务或修改 SQL 字符串转义规则")
        if re.match(r"(?i)^SET\b", clean) and re.search(
            r"(?i)(?<![@\w])(?:@@(?:(?:SESSION|LOCAL|GLOBAL)\.)?)?(?:AUTOCOMMIT|SQL_MODE)\b",
            clean.replace("`", ""),
        ):
            raise ValueError("首版不允许修改 AUTOCOMMIT 或 SQL_MODE")
    return parts
