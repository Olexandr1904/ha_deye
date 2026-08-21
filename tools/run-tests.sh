#!/bin/bash
# Runs the interactive dashboard tests in a real Chrome.
#   ./tools/run-tests.sh
# Requires node 22+ and Google Chrome. No npm dependencies.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${DEYE_PORT:-8899}"
export DEYE_ORIGIN="http://127.0.0.1:${PORT}"
export DEYE_SHOTS="${DEYE_SHOTS:-/tmp/deye-shots}"

cd "$ROOT/deye-dashboard"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 1.5

echo "Dashboard: $DEYE_ORIGIN/index.html   screenshots: $DEYE_SHOTS"
node "$ROOT/tools/test-dashboard.mjs"
