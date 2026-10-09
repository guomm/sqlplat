#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
uv sync --frozen
uv run alembic -c backend/alembic.ini upgrade head
PYTHONPATH=backend exec uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port "${API_PORT:-8001}" --workers 1
