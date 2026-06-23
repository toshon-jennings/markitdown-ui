#!/usr/bin/env bash
# Launch the MarkItDown Web UI. Creates a venv + installs deps on first run.
set -euo pipefail
cd "$(dirname "$0")"

VENV=".venv"
PY="$VENV/bin/python"

if [ ! -x "$PY" ]; then
  echo "› Creating virtual environment…"
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install --upgrade pip >/dev/null
  echo "› Installing dependencies (first run only)…"
  "$VENV/bin/pip" install \
    "../packages/markitdown[pptx,docx,xlsx,xls,pdf,outlook,audio-transcription,youtube-transcription]" \
    "fastapi>=0.110" "uvicorn[standard]>=0.27" "python-multipart>=0.0.9"
fi

PORT="${MARKITDOWN_UI_PORT:-8920}"
echo "› MarkItDown UI → http://127.0.0.1:${PORT}"
exec "$PY" server.py
