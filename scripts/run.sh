#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python || ! -d node_modules ]]; then
  echo "Install dependencies first; see README.md."
  exit 1
fi
npm run build
exec .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-proxy-headers --no-access-log --timeout-graceful-shutdown 3
