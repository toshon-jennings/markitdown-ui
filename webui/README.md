# MarkItDownUI

A clean, Apple-inspired web interface for Microsoft's
[MarkItDown](https://github.com/microsoft/markitdown) — drag in a file (or paste
a URL) and get polished Markdown instantly.

- This UI: <https://github.com/toshon-jennings/markitdown-ui>
- Upstream library: <https://github.com/microsoft/markitdown>

![mode: file / url · drag-and-drop · live preview · copy / download](#)

## Features

- **Drag & drop** any supported file (PDF, DOCX, PPTX, XLSX, HTML, images, audio, **video**, ZIP…)
  — audio/video files are transcribed to text (requires `ffmpeg` for non-WAV formats)
- **URL mode** for web pages, Wikipedia, YouTube, RSS, and Bing results
- **Live preview** of rendered Markdown, with a raw-Markdown toggle
- **Copy** to clipboard or **download** as `.md`
- **Light/dark** mode that follows your system appearance
- **Fully local & offline** — files are converted on your machine; no CDNs, no telemetry

## Quick start

```bash
cd webui
./run.sh          # first run creates a venv and installs deps
```

Then open **http://127.0.0.1:8920**.

### Manual run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install "../packages/markitdown[pptx,docx,xlsx,xls,pdf,outlook,audio-transcription,youtube-transcription]" \
            "fastapi>=0.110" "uvicorn[standard]>=0.27" "python-multipart>=0.0.9"
python server.py
```

### Configuration

| Env var                | Default     | Description          |
| ---------------------- | ----------- | -------------------- |
| `MARKITDOWN_UI_HOST`   | `127.0.0.1` | Bind address         |
| `MARKITDOWN_UI_PORT`   | `8920`      | Port                 |

> **Note:** binds to localhost by default. Only expose it on other interfaces on
> a trusted network — it will convert any file or URL it's given.

## How it works

`server.py` is a small FastAPI app that wraps `MarkItDown`:

- `GET  /`              → serves the single-page UI
- `POST /api/convert`     → converts an uploaded file (streamed, never written to disk)
- `POST /api/convert-url` → converts a URL
- `GET  /api/health`      → version / liveness check

The frontend (`static/`) is dependency-free vanilla HTML/CSS/JS, including a tiny
built-in Markdown renderer that HTML-escapes all content before rendering.

## Python version note

On Python 3.14 the `markitdown[all]` extra can't resolve (a transitive pin caps
at <3.14), so the installer uses an explicit list of common-format extras
instead. Everyday document/spreadsheet/PDF/audio conversion is fully covered.
