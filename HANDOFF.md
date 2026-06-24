# MarkItDownUI Handoff

## Current Milestone

- [x] Update the root README so it leads with the local MarkItDownUI product
      description before the upstream MarkItDown library copy.
- [x] Add MarkItDownUI as a first-class Perci surface in `/Users/toshonjennings/opal`.
- [x] Add a lower Dashboard tile for MarkItDownUI and keep the tile logo filling
      its rounded square container.
- [x] Add light/dark MarkItDownUI page backgrounds from the latest Downloads
      images. The standalone UI uses `markitdown-bg-light.jpeg` by default and
      `markitdown-bg-dark.jpeg` under `prefers-color-scheme: dark`; Perci gets
      the same background because its first-class surface embeds this localhost
      UI.
- [x] Add explicit MarkItDownUI theme control. Standalone now has a persisted
      System/Light/Dark segmented theme control in the top bar, and the app accepts
      `?theme=light|dark|system` so Perci can pass its resolved theme into the
      embedded surface.
- [x] Fix blank image-upload results. If MarkItDown returns empty Markdown for
      a JPEG/PNG because no EXIF fields or multimodal LLM caption are available,
      the web API now returns useful image metadata (filename, MIME type, size,
      dimensions, format, color mode) plus a short "No embedded text was found"
      note instead of a blank result or setup instructions.
- [x] Perci-embedded image vision now reuses Perci's existing encrypted
      `openrouter_key` instead of asking for another key. Direct image uploads
      in the Perci iframe post the image to the parent window; Perci main calls
      OpenRouter with `openai/gpt-4o-mini` and returns Markdown. Standalone
      MarkItDownUI still stays local unless a standalone provider path is added.
- [x] Perci can start the MarkItDownUI server from the MarkItDown window. The
      offline surface has a Start server button that calls Perci Electron main,
      runs `/Users/toshonjennings/markitdown-ui/webui/run.sh`, waits on
      `http://127.0.0.1:8920/api/health`, then reloads the embedded UI.
- [x] MarkItDownUI now exposes dependency/capability status. `/api/health`
      includes `capabilities`, `/api/capabilities` is available directly, and
      the UI shows compact ExifTool and image-vision readiness pills. ExifTool
      is optional and currently missing on this machine; the UI shows
      `brew install exiftool`. In Perci, image vision is marked ready because
      direct image uploads use Perci's OpenRouter key.
- [x] Perci-embedded MarkItDownUI can install ExifTool from the UI. When
      ExifTool is missing, the ExifTool readiness pill shows an Install button
      in Perci. The button confirms with the user, posts a fixed install
      request to the parent window, and Perci main runs `brew install exiftool`
      through `markitdown:install-exiftool`. The server now detects ExifTool
      at conversion time, including `/opt/homebrew/bin/exiftool`, so the
      install can be picked up without relying only on startup PATH.
- [x] MarkItDownUI adds explicit CORS/frame headers for Perci embedding:
      `Access-Control-Allow-Origin`, `Cross-Origin-Resource-Policy:
      cross-origin`. The earlier `frame-ancestors` CSP was removed because
      Perci/Electron was still reporting `ERR_BLOCKED_BY_RESPONSE`; a local
      tool is better served by sending no frame blocker at all.

## Notes

- The web UI lives in `webui/` and defaults to `http://127.0.0.1:8920`.
- `webui/run.sh` now installs from `webui/requirements.txt` on first run so
  the launcher stays aligned with server dependencies such as Pillow.
- `http://localhost:1337/v1` is not listening on this machine. Jan's detected
  local bridge is `http://127.0.0.1:6767/v1`. After the user loaded a model,
  `/v1/models` returned `Jan-v2-VL-high-Q4_K_M`, a text+image model, plus one
  text-only cached model. LM Studio is live at `http://127.0.0.1:1234/v1/models`
  and currently reports local models.
- `SUMMARY.md` is not present yet; create it from
  `/Users/toshonjennings/summary-md/SUMMARY_TEMPLATE.md` when there is time for
  fuller repo orientation.
