#!/usr/bin/env bash
# Launch the MarkItDown Web UI. Creates a venv + installs deps on first run.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

VENV=".venv"
PY="$VENV/bin/python"

if [ ! -x "$PY" ]; then
  echo "› Creating virtual environment…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --upgrade pip >/dev/null
  echo "› Installing dependencies (first run only)…"
  "$VENV/bin/pip" install -r requirements.txt
fi

PORT="${MARKITDOWN_UI_PORT:-8920}"
echo "› MarkItDown UI → http://127.0.0.1:${PORT}"
exec "$PY" server.py
