#!/bin/bash
# Runs every test the project has: pure unit tests first (instant), then the
# interactive suite in a real Chrome.
#   ./tools/run-tests.sh
# Requires node 22+, python3 and Google Chrome. No npm dependencies.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${DEYE_PORT:-8899}"
export DEYE_ORIGIN="http://127.0.0.1:${PORT}"
export DEYE_SHOTS="${DEYE_SHOTS:-/tmp/deye-shots}"

# Unit tests: no browser, no server, and they fail in under a second.
node "$ROOT/tools/test-ranges.mjs"
node "$ROOT/tools/test-config.mjs"
node "$ROOT/tools/test-model.mjs"
python3 "$ROOT/tools/test-deploy.py"

cd "$ROOT/deye-dashboard"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT

# Wait for the server rather than guessing: a port already in use would
# otherwise show up as a page full of network errors.
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "$DEYE_ORIGIN/index.html"; then break; fi
  if [ "$i" = 60 ]; then echo "no server on $DEYE_ORIGIN (port already in use?)" >&2; exit 1; fi
  sleep 0.25
done

echo "Dashboard: $DEYE_ORIGIN/index.html   screenshots: $DEYE_SHOTS"
node "$ROOT/tools/test-dashboard.mjs"
