#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."

if [[ -f uvicorn.pid ]] && kill -0 "$(cat uvicorn.pid)" 2>/dev/null; then
    echo "API already running: $(cat uvicorn.pid)"
    exit 1
fi

uv sync --default-index https://mirrors.aliyun.com/pypi/simple/
PYTHONPATH=backend nohup .venv/bin/uvicorn app.main:create_app \
    --factory --host 127.0.0.1 --port "${API_PORT:-8001}" --workers 1 \
    > uvicorn.log 2>&1 &
pid=$!
echo "$pid" > uvicorn.pid
sleep 1

if ! kill -0 "$pid" 2>/dev/null; then
    rm -f uvicorn.pid
    tail -n 20 uvicorn.log
    exit 1
fi
echo "API process started: $pid; log: $PWD/uvicorn.log"
