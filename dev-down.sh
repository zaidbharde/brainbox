#!/bin/zsh
set -euo pipefail

for pid_file in /tmp/brainbox-backend.pid /tmp/brainbox-frontend.pid /tmp/brainbox-x86.pid; do
  if [[ -f "$pid_file" ]]; then
    pid=$(cat "$pid_file" || true)
    if [[ -n "${pid:-}" ]]; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
done

lsof -ti :4100 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
lsof -ti :5174 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
lsof -ti :5173 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true

echo "BrainBox/x86 dev servers stopped."
