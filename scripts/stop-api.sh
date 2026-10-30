#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")/.."

[[ -f uvicorn.pid ]] || { echo "No API PID file"; exit 0; }
pid=$(cat uvicorn.pid)
[[ "$pid" =~ ^[0-9]+$ ]] && (( pid > 1 )) || { echo "Invalid PID"; exit 1; }
if kill -0 "$pid" 2>/dev/null; then
    command=$(ps -p "$pid" -o args= || true)
    [[ "$command" == *uvicorn*app.main:create_app* ]] || { echo "Unrelated PID; refusing to stop it"; exit 1; }
    # Also stop a child left by the old uv run launcher.
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for ((i = 0; i < 30; i++)); do
        state=$(ps -p "$pid" -o stat= || true)
        [[ -z "$state" || "$state" == *Z* ]] && break
        sleep 1
    done
    [[ -z "$state" || "$state" == *Z* ]] || { echo "API still stopping; PID file retained"; exit 1; }
fi
rm -f uvicorn.pid
echo "API stopped: $pid"
