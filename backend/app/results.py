import base64
import csv
import io
import json
import math
import threading
from collections import defaultdict
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryFile

from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE


def serialize(value):
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return str(value) if abs(value) > 9007199254740991 else value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return "base64:" + base64.b64encode(value).decode()
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    return str(value)


def csv_safe(value):
    if isinstance(value, str) and value.lstrip().startswith(
        ("=", "+", "-", "@", "\t", "\r")
    ):
        return "'" + value
    return value


class ResultStore:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.readers = defaultdict(int)

    def path(self, filename):
        if Path(filename).name != filename or not filename:
            raise ValueError("无效结果文件")
        return self.root / filename

    @contextmanager
    def lease(self, filename):
        with self.lock:
            path = self.path(filename)
            if not path.exists():
                raise FileNotFoundError(filename)
            self.readers[filename] += 1
        try:
            yield path
        finally:
            with self.lock:
                self.readers[filename] -= 1
                if not self.readers[filename]:
                    del self.readers[filename]

    def delete(self, filename):
        with self.lock:
            if self.readers.get(filename):
                return False
            self.path(filename).unlink(missing_ok=True)
            return True

    def rows(self, path):
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                yield json.loads(line)

    def page(self, filename, offset, limit):
        from itertools import islice

        with self.lease(filename) as path:
            return list(islice(self.rows(path), offset, offset + limit))

    def csv_chunks(self, filename, columns):
        with self.lease(filename) as path:
            yield "\ufeff".encode()
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow([csv_safe(c["name"]) for c in columns])
            yield buf.getvalue().encode("utf-8")
            for row in self.rows(path):
                buf.seek(0)
                buf.truncate(0)
                writer.writerow([csv_safe(value) for value in row])
                yield buf.getvalue().encode("utf-8")

    def xlsx_file(self, filename, columns):
        wb = Workbook(write_only=True)
        ws = wb.create_sheet("查询结果")

        def cells(row):
            for value in row:
                if isinstance(value, int) and abs(value) >= 10**15:
                    value = str(value)
                if isinstance(value, str):
                    value = ILLEGAL_CHARACTERS_RE.sub("�", value)
                cell = WriteOnlyCell(ws, value=value)
                if isinstance(value, str):
                    cell.data_type = "s"
                yield cell

        with self.lease(filename) as path:
            ws.append(list(cells([c["name"] for c in columns])))
            for row in self.rows(path):
                ws.append(list(cells(row)))
            out = TemporaryFile(mode="w+b")
            wb.save(out)
        out.seek(0)
        return out


class LeasedStreamingResponse(StreamingResponse):
    """Release resources even when the client disconnects before the first byte."""

    def __init__(self, content, cleanup, **kwargs):
        self.cleanup = cleanup
        self.source = content
        super().__init__(content, **kwargs)

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            try:
                if hasattr(self.source, "close"):
                    self.source.close()
            finally:
                self.cleanup()
