#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="/tmp"

kill_port() {
  local port="$1"
  lsof -ti :"$port" -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
}

kill_port 4100
kill_port 5174
kill_port 5173
kill_port 4300

: > "$PID_DIR/brainbox-backend.log"
: > "$PID_DIR/brainbox-frontend.log"
: > "$PID_DIR/brainbox-x86.log"
: > "$PID_DIR/brainbox-linux.log"

cd "$ROOT_DIR/brainbox/backend"
nohup npm run dev > "$PID_DIR/brainbox-backend.log" 2>&1 &
backend_pid=$!
echo "$backend_pid" > "$PID_DIR/brainbox-backend.pid"
disown "$backend_pid" 2>/dev/null || true

cd "$ROOT_DIR/brainbox/frontend"
nohup npm run dev -- --host 127.0.0.1 --strictPort --port 5174 > "$PID_DIR/brainbox-frontend.log" 2>&1 &
frontend_pid=$!
echo "$frontend_pid" > "$PID_DIR/brainbox-frontend.pid"
disown "$frontend_pid" 2>/dev/null || true

cd "$ROOT_DIR/brainbox/8086-studio"
nohup npm run dev -- --host 127.0.0.1 --strictPort --port 5173 > "$PID_DIR/brainbox-x86.log" 2>&1 &
x86_pid=$!
echo "$x86_pid" > "$PID_DIR/brainbox-x86.pid"
disown "$x86_pid" 2>/dev/null || true

cd "$ROOT_DIR/brainbox/linux-terminal"
nohup npm run dev > "$PID_DIR/brainbox-linux.log" 2>&1 &
linux_pid=$!
echo "$linux_pid" > "$PID_DIR/brainbox-linux.pid"
disown "$linux_pid" 2>/dev/null || true

sleep 1
if ! kill -0 "$backend_pid" 2>/dev/null; then
  echo "Backend failed to stay up. Check /tmp/brainbox-backend.log"
  exit 1
fi
if ! kill -0 "$frontend_pid" 2>/dev/null; then
  echo "Frontend failed to stay up. Check /tmp/brainbox-frontend.log"
  exit 1
fi
if ! kill -0 "$x86_pid" 2>/dev/null; then
  echo "x86 studio failed to stay up. Check /tmp/brainbox-x86.log"
  exit 1
fi
if ! kill -0 "$linux_pid" 2>/dev/null; then
  echo "Linux terminal failed to stay up. Check /tmp/brainbox-linux.log"
  exit 1
fi

for i in {1..20}; do
  ok_backend=0
  ok_frontend=0
  ok_x86=0
  ok_linux=0
  curl -sS http://127.0.0.1:4100/health >/dev/null 2>&1 && ok_backend=1
  curl -sS http://127.0.0.1:5174/ >/dev/null 2>&1 && ok_frontend=1
  curl -sS http://127.0.0.1:5173/ >/dev/null 2>&1 && ok_x86=1
  curl -sS http://127.0.0.1:4300/api/health >/dev/null 2>&1 && ok_linux=1
  if [[ "$ok_backend" -eq 1 && "$ok_frontend" -eq 1 && "$ok_x86" -eq 1 && "$ok_linux" -eq 1 ]]; then
    break
  fi
  sleep 1
done

if [[ "$ok_backend" -ne 1 || "$ok_frontend" -ne 1 || "$ok_x86" -ne 1 || "$ok_linux" -ne 1 ]]; then
  echo "One or more services failed to become reachable."
  echo
  echo "--- backend log (last 40 lines) ---"
  tail -n 40 "$PID_DIR/brainbox-backend.log" || true
  echo "--- frontend log (last 40 lines) ---"
  tail -n 40 "$PID_DIR/brainbox-frontend.log" || true
  echo "--- x86 log (last 40 lines) ---"
  tail -n 40 "$PID_DIR/brainbox-x86.log" || true
  echo "--- linux log (last 40 lines) ---"
  tail -n 40 "$PID_DIR/brainbox-linux.log" || true
  exit 1
fi

echo "backend: http://127.0.0.1:4100"
echo "frontend: http://127.0.0.1:5174"
echo "x86 app:  http://127.0.0.1:5173"
echo "linux:    http://127.0.0.1:4300"
echo
echo "--- quick status ---"
curl -sS http://127.0.0.1:4100/health || true
echo
curl -sSI http://127.0.0.1:5174/ | head -n 1 || true
curl -sSI http://127.0.0.1:5173/ | head -n 1 || true
curl -sSI http://127.0.0.1:4300/ | head -n 1 || true
echo
echo "Logs:"
echo "  /tmp/brainbox-backend.log"
echo "  /tmp/brainbox-frontend.log"
echo "  /tmp/brainbox-x86.log"
echo "  /tmp/brainbox-linux.log"
