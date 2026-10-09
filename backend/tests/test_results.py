from datetime import datetime
from decimal import Decimal
import json
from openpyxl import load_workbook


def test_result_types_and_export_precision(tmp_path):
    from app.results import serialize, ResultStore

    assert serialize(9007199254740993) == "9007199254740993"
    assert serialize(Decimal("1.000000000000000001")) == "1.000000000000000001"
    assert serialize(datetime(2026, 10, 9, 12, 30)) == "2026-10-09T12:30:00"
    store = ResultStore(tmp_path)
    store.path("result.jsonl").write_text(
        json.dumps(["=1+1", "9007199254740993", None, "中文"]) + "\n", encoding="utf-8"
    )
    cols = [{"name": "x"}] * 4
    csv = b"".join(store.csv_chunks("result.jsonl", cols)).decode("utf-8-sig")
    assert "'=1+1" in csv and "中文" in csv
    with store.xlsx_file("result.jsonl", cols) as f:
        wb = load_workbook(f)
        assert wb.active["A2"].value == "=1+1"
        assert wb.active["A2"].data_type == "s"
        assert wb.active["B2"].value == "9007199254740993"


def test_cleanup_cannot_delete_leased_result(tmp_path):
    from app.results import ResultStore

    store = ResultStore(tmp_path)
    store.path("a.jsonl").write_text("[]\n")
    with store.lease("a.jsonl"):
        assert not store.delete("a.jsonl")
    assert store.delete("a.jsonl")


def test_disconnect_before_body_releases_result_lease(tmp_path):
    import asyncio
    import pytest
    from app.results import ResultStore, LeasedStreamingResponse

    store = ResultStore(tmp_path)
    store.path("result.jsonl").write_text("[]\n")
    lease = store.lease("result.jsonl")
    lease.__enter__()
    response = LeasedStreamingResponse(
        iter([b"content"]), cleanup=lambda: lease.__exit__(None, None, None)
    )

    async def send(message):
        raise OSError("client disconnected")

    async def receive():
        return {"type": "http.disconnect"}

    with pytest.raises(Exception):
        asyncio.run(
            response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
        )
    assert store.delete("result.jsonl")
