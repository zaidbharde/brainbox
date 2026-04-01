#!/usr/bin/env bash
set -euo pipefail

for f in /tmp/8086-backend.pid /tmp/8086-frontend.pid; do
  if [[ -f "$f" ]]; then
    pid="$(cat "$f")"
    kill "$pid" 2>/dev/null || true
    rm -f "$f"
  fi
done

lsof -ti :4000 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
lsof -ti :5173 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true

echo "Stopped 8086 backend/frontend."
