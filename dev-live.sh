#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo
  echo "Stopping BrainBox live servers..."
  kill ${BACKEND_PID:-} ${FRONTEND_PID:-} ${X86_PID:-} ${LINUX_PID:-} 2>/dev/null || true
}
trap cleanup INT TERM EXIT

lsof -ti :4100 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
lsof -ti :5174 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
lsof -ti :5173 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
lsof -ti :4300 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true

: > /tmp/brainbox-backend.log
: > /tmp/brainbox-frontend.log
: > /tmp/brainbox-x86.log
: > /tmp/brainbox-linux.log

cd "$ROOT_DIR/brainbox/backend"
npm run dev > /tmp/brainbox-backend.log 2>&1 &
BACKEND_PID=$!

cd "$ROOT_DIR/brainbox/frontend"
npm run dev -- --host 127.0.0.1 --strictPort --port 5174 > /tmp/brainbox-frontend.log 2>&1 &
FRONTEND_PID=$!

cd "$ROOT_DIR/brainbox/8086-studio"
npm run dev -- --host 127.0.0.1 --strictPort --port 5173 > /tmp/brainbox-x86.log 2>&1 &
X86_PID=$!

cd "$ROOT_DIR/brainbox/linux-terminal"
npm run dev > /tmp/brainbox-linux.log 2>&1 &
LINUX_PID=$!

echo "BrainBox live mode started"
echo "frontend: http://127.0.0.1:5174"
echo "x86:      http://127.0.0.1:5173"
echo "linux:    http://127.0.0.1:4300"
echo "backend:  http://127.0.0.1:4100/health"
echo
echo "Keep this terminal open. Press Ctrl+C to stop all."
echo "Logs: /tmp/brainbox-backend.log /tmp/brainbox-frontend.log /tmp/brainbox-x86.log /tmp/brainbox-linux.log"

wait
