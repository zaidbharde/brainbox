#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="/Users/khantabish/kkkk/.local/node/bin"

export PATH="$NODE_BIN:$PATH"

kill_port() {
  local port="$1"
  lsof -ti :"$port" -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
}

kill_port 4000
kill_port 5173

: > /tmp/8086-backend.log
: > /tmp/8086-frontend.log

cd "$ROOT_DIR/backend"
nohup env HOST=127.0.0.1 npm start >/tmp/8086-backend.log 2>&1 < /dev/null &
echo $! >/tmp/8086-backend.pid

cd "$ROOT_DIR"
nohup npm run dev -- --host 127.0.0.1 >/tmp/8086-frontend.log 2>&1 < /dev/null &
echo $! >/tmp/8086-frontend.pid

sleep 2

echo "backend pid: $(cat /tmp/8086-backend.pid)"
echo "frontend pid: $(cat /tmp/8086-frontend.pid)"
echo "frontend: http://127.0.0.1:5173"
echo "backend:  http://127.0.0.1:4000/health"

if ! curl -sS http://127.0.0.1:4000/health >/dev/null; then
  echo "backend failed to respond on http://127.0.0.1:4000/health"
  tail -n 40 /tmp/8086-backend.log || true
  exit 1
fi

if ! curl -sSI http://127.0.0.1:5173 >/dev/null; then
  echo "frontend failed to respond on http://127.0.0.1:5173"
  tail -n 40 /tmp/8086-frontend.log || true
  exit 1
fi
