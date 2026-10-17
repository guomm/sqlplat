#!/bin/bash
set -eu
cd "$(dirname "$0")/.."
uv sync --default-index https://mirrors.aliyun.com/pypi/simple/
# uv run alembic -c backend/alembic.ini upgrade head

PID_FILE="uvicorn.pid"
LOG_FILE="uvicorn.log"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "already running: $(cat "$PID_FILE")"
    exit 1
fi

PYTHONPATH=backend nohup uv run uvicorn app.main:create_app \
    --factory \
    --host 127.0.0.1 \
    --port "${API_PORT:-8001}" \
    --workers 1 \
    > "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"
echo "started: $(cat "$PID_FILE")"