#!/usr/bin/env bash
PID_FILE="uvicorn.pid"
[[ -f "$PID_FILE" ]] && kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"