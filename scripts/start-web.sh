#!/bin/sh
set -eu
cd "$(dirname "$0")/../frontend"
if [ ! -d node_modules ]; then npm ci; fi
exec npm run dev -- --port "${WEB_PORT:-5180}" --strictPort
