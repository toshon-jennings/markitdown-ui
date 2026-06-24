"""
MarkItDown Web UI — a clean, local FastAPI server that wraps the MarkItDown
library and serves an Apple-inspired single-page frontend.

Run:
    python -m webui.server          # from repo root
    # or
    cd webui && python server.py
"""

from __future__ import annotations

import io
import ipaddress
import logging
import os
import re
import socket
import shutil
from pathlib import Path
from urllib.parse import urlparse, urljoin

import requests
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

from markitdown import (
    MarkItDown,
    StreamInfo,
    MarkItDownException,
    UnsupportedFormatException,
)

logger = logging.getLogger("markitdown_ui")

STATIC_DIR = Path(__file__).parent / "static"


def _ui_version() -> str:
    """Read the webui version from __init__.py, regardless of how the server is
    launched (as a module or as a bare `python server.py` script)."""
    init = (Path(__file__).parent / "__init__.py").read_text(encoding="utf-8")
    m = re.search(r'__version__\s*=\s*"([^"]+)"', init)
    return m.group(1) if m else "0"


UI_VERSION = _ui_version()

# Cap how much remote content we'll pull in for a URL conversion.
MAX_URL_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_REDIRECTS = 5
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
EXIFTOOL_CANDIDATE_PATHS = (
    "/opt/homebrew/bin/exiftool",
    "/usr/local/bin/exiftool",
    "/usr/bin/exiftool",
)


def _find_exiftool() -> str | None:
    candidate = shutil.which("exiftool")
    if candidate:
        return candidate
    for candidate_path in EXIFTOOL_CANDIDATE_PATHS:
        if Path(candidate_path).is_file():
            return candidate_path
    return None


def _make_markitdown() -> MarkItDown:
    exiftool_path = _find_exiftool()
    kwargs = {"enable_plugins": False}
    if exiftool_path:
        kwargs["exiftool_path"] = exiftool_path
    return MarkItDown(**kwargs)


def _assert_public_host(host: str | None) -> None:
    """Reject hostnames that resolve to loopback/private/link-local/reserved IPs.

    Guards the URL-conversion endpoint against SSRF toward localhost, the
    private network, and cloud metadata services (e.g. 169.254.169.254).
    """
    if not host:
        raise HTTPException(status_code=400, detail="URL is missing a hostname.")
    host = host.rstrip(".").lower()
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve host.")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise HTTPException(
                status_code=400,
                detail="Blocked address: URL resolves to a non-public host.",
            )


def _safe_get(url: str) -> requests.Response:
    """Fetch a URL, re-validating the host on every redirect hop.

    Redirects are followed manually (instead of letting requests follow them)
    so an allowlisted host can't 302 us into an internal address.
    """
    for _ in range(MAX_REDIRECTS + 1):
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            raise HTTPException(status_code=400, detail="URL must be http:// or https://")
        _assert_public_host(parsed.hostname)

        resp = requests.get(url, stream=True, allow_redirects=False, timeout=20)
        if resp.is_redirect or resp.is_permanent_redirect:
            location = resp.headers.get("Location")
            resp.close()
            if not location:
                raise HTTPException(status_code=502, detail="Redirect without a location.")
            url = urljoin(url, location)
            continue

        resp.raise_for_status()
        return resp

    raise HTTPException(status_code=502, detail="Too many redirects.")


def _read_capped(response: requests.Response) -> tuple[io.BytesIO, StreamInfo]:
    """Read the response body into memory, capped at MAX_URL_BYTES, and build a
    StreamInfo from its headers/URL (mimetype, charset, filename, extension)."""
    mimetype = charset = filename = extension = None

    ctype = response.headers.get("content-type")
    if ctype:
        parts = ctype.split(";")
        mimetype = parts[0].strip() or None
        for part in parts[1:]:
            if part.strip().startswith("charset="):
                charset = part.split("=", 1)[1].strip() or None

    disp = response.headers.get("content-disposition")
    if disp:
        m = re.search(r"filename=([^;]+)", disp)
        if m:
            filename = m.group(1).strip("\"'")
            extension = os.path.splitext(filename)[1] or None
    if filename is None:
        path_ext = os.path.splitext(urlparse(response.url).path)[1]
        if path_ext:
            filename = os.path.basename(urlparse(response.url).path)
            extension = path_ext

    buffer = io.BytesIO()
    for chunk in response.iter_content(chunk_size=64 * 1024):
        buffer.write(chunk)
        if buffer.tell() > MAX_URL_BYTES:
            raise HTTPException(status_code=413, detail="Remote file is too large.")
    buffer.seek(0)

    return buffer, StreamInfo(
        mimetype=mimetype,
        charset=charset,
        filename=filename,
        extension=extension,
        url=response.url,
    )


def _is_image_input(filename: str | None, content_type: str | None, extension: str | None = None) -> bool:
    if content_type and content_type.lower().startswith("image/"):
        return True
    ext = (extension or os.path.splitext(filename or "")[1]).lower()
    return ext in IMAGE_EXTENSIONS


def _image_metadata_markdown(data: bytes, filename: str, content_type: str | None) -> str:
    lines = [
        f"# {filename}",
        "",
        "No embedded text was found in this image.",
        "",
        "## Image metadata",
        "",
        f"- Filename: `{filename}`",
    ]
    if content_type:
        lines.append(f"- MIME type: `{content_type}`")
    lines.append(f"- File size: {len(data):,} bytes")

    try:
        with Image.open(io.BytesIO(data)) as image:
            lines.extend([
                f"- Format: {image.format or 'unknown'}",
                f"- Dimensions: {image.width} x {image.height}px",
                f"- Color mode: `{image.mode}`",
            ])
    except Exception:
        lines.append("- Dimensions: unavailable")

    return "\n".join(lines)

app = FastAPI(title="MarkItDownUI", docs_url=None, redoc_url=None)


@app.middleware("http")
async def add_embed_headers(request, call_next):
    if request.method == "OPTIONS":
        response = JSONResponse({})
    else:
        response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = request.headers.get("origin", "*")
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response.headers["Cross-Origin-Resource-Policy"] = "cross-origin"
    response.headers["Vary"] = "Origin"
    return response

@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC_DIR / "index.html").read_text(encoding="utf-8"))


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse(STATIC_DIR / "favicon.ico", media_type="image/x-icon")


@app.get("/api/health")
def health() -> JSONResponse:
    from markitdown import __version__ as markitdown_version

    return JSONResponse(
        {
            "ok": True,
            "ui_version": UI_VERSION,
            "markitdown_version": markitdown_version,
            "capabilities": _capabilities(),
        }
    )


def _capabilities() -> dict:
    exiftool_path = _find_exiftool()
    return {
        "exiftool": {
            "available": bool(exiftool_path),
            "path": exiftool_path,
            "install_hint": "brew install exiftool",
            "purpose": "Extracts richer camera and file metadata from images.",
            "required": False,
        },
        "vision": {
            "available": False,
            "purpose": "Generates visual descriptions and OCR-like extraction for image uploads.",
            "required": False,
            "install_hint": "Use the Perci embedded surface with an OpenRouter key, or configure a local OpenAI-compatible vision provider.",
        },
    }


@app.get("/api/capabilities")
def capabilities() -> JSONResponse:
    return JSONResponse(_capabilities())


@app.post("/api/convert")
async def convert(file: UploadFile = File(...)) -> JSONResponse:
    """Convert a single uploaded file to Markdown."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    filename = file.filename or "upload"
    extension = os.path.splitext(filename)[1] or None
    stream_info = StreamInfo(
        filename=filename,
        extension=extension,
        mimetype=file.content_type or None,
    )

    try:
        result = _make_markitdown().convert_stream(io.BytesIO(data), stream_info=stream_info)
    except UnsupportedFormatException as exc:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file format for “{filename}”. {exc}",
        )
    except MarkItDownException as exc:
        raise HTTPException(status_code=422, detail=f"Could not convert file: {exc}")
    except Exception:  # noqa: BLE001 — log internally, return a generic message
        logger.exception("File conversion failed for %r", filename)
        raise HTTPException(status_code=500, detail="Unexpected error while converting file.")

    markdown = result.markdown
    if not markdown.strip() and _is_image_input(filename, file.content_type, extension):
        markdown = _image_metadata_markdown(data, filename, file.content_type)

    return JSONResponse(
        {
            "filename": filename,
            "title": result.title,
            "markdown": markdown,
            "chars": len(markdown),
        }
    )


@app.post("/api/convert-url")
async def convert_url(url: str = Form(...)) -> JSONResponse:
    """Convert a URL (web page, YouTube, Wikipedia, etc.) to Markdown."""
    url = url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Please provide a URL.")
    if not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    # SSRF guard: validate the host (and every redirect hop) before fetching,
    # then read a size-capped buffer and hand it to MarkItDown.
    response = _safe_get(url)
    try:
        buffer, stream_info = _read_capped(response)
        result = _make_markitdown().convert_stream(buffer, stream_info=stream_info)
    except HTTPException:
        raise
    except MarkItDownException as exc:
        raise HTTPException(status_code=422, detail=f"Could not convert URL: {exc}")
    except requests.RequestException:
        logger.exception("Fetching URL failed")
        raise HTTPException(status_code=502, detail="Could not fetch the URL.")
    except Exception:  # noqa: BLE001
        logger.exception("URL conversion failed")
        raise HTTPException(status_code=500, detail="Unexpected error while converting URL.")
    finally:
        response.close()

    markdown = result.markdown
    if not markdown.strip() and _is_image_input(stream_info.filename, stream_info.mimetype, stream_info.extension):
        markdown = _image_metadata_markdown(buffer.getvalue(), stream_info.filename or url, stream_info.mimetype)

    return JSONResponse(
        {
            "filename": url,
            "title": result.title,
            "markdown": markdown,
            "chars": len(markdown),
        }
    )


# Static assets (styles.js, app.js). Mounted last so it doesn't shadow routes.
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("MARKITDOWN_UI_HOST", "127.0.0.1")
    port = int(os.environ.get("MARKITDOWN_UI_PORT", "8920"))
    uvicorn.run(app, host=host, port=port)
