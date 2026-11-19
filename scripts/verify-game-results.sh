#!/usr/bin/env bash
# Build and start the app in mock mode on an isolated data directory, run the
# Concept Quest browser checks (student, teacher, damaged-record recovery) against it, then stop the server.
#
#   scripts/verify-game-results.sh                 # new temp data dir, port 3100
#   PORT=3200 scripts/verify-game-results.sh
#   DITO_DATA_DIR=/tmp/my-dir scripts/verify-game-results.sh   # reuse a directory
#   SKIP_BUILD=1 scripts/verify-game-results.sh     # reuse the existing .next build
#   SHOTS=/tmp/shots scripts/verify-game-results.sh # also save screenshots
#
# Needs Python 3 with Playwright (and its Chromium). The data directory is kept
# afterwards; its path is printed so you can inspect it or start the app on it.
set -euo pipefail
cd "$(dirname "$0")/.."

# One exported value, so the build, the server and both scripts all use the same directory.
export DITO_DATA_DIR="${DITO_DATA_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/dito-verify-XXXXXX")}"
export PORT="${PORT:-3100}"
export BASE="http://localhost:${PORT}"
# Mock mode even if .env.local has keys: an empty value in the environment wins over .env files.
export ANTHROPIC_API_KEY= EVERMIND_API_KEY= RUNPOD_API_KEY= RUNPOD_IMAGE_ENDPOINT= RUNPOD_TTS_ENDPOINT= RUNPOD_MUSIC_ENDPOINT= RUNPOD_VIDEO_ENDPOINT=
export NEXT_TELEMETRY_DISABLED=1
LOG="${DITO_DATA_DIR%/}.server.log"

echo "data dir:   $DITO_DATA_DIR"
echo "server log: $LOG"
if curl -s -o /dev/null "$BASE/"; then
  echo "Something is already listening on $BASE; choose another PORT." >&2
  exit 2
fi
if [ "${SKIP_BUILD:-0}" != "1" ]; then npm run build; fi

npx next start -p "$PORT" > "$LOG" 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true; wait "$SERVER" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -s -o /dev/null "$BASE/" && break
  sleep 1
done

shots=()
if [ -n "${SHOTS:-}" ]; then shots=(--shots "$SHOTS"); fi
status=0
echo; echo "== tests/browser/game_results.py (student)"
python3 tests/browser/game_results.py "${shots[@]}" || status=1
echo; echo "== tests/browser/teacher_game_results.py (teacher)"
python3 tests/browser/teacher_game_results.py "${shots[@]}" || status=1
echo; echo "== tests/browser/game_recovery.py (damaged records)"
python3 tests/browser/game_recovery.py "${shots[@]}" || status=1

echo
echo "data dir kept: $DITO_DATA_DIR"
echo "to browse it:  DITO_DATA_DIR=$DITO_DATA_DIR ANTHROPIC_API_KEY= npm start"
exit $status
