"use strict";

// ---------- Element refs ----------
const $ = (sel) => document.querySelector(sel);
const dropzone = $("#dropzone");
const fileInput = $("#fileInput");
const urlForm = $("#urlForm");
const urlInput = $("#urlInput");
const result = $("#result");
const preview = $("#preview");
const rawCode = $("#raw").querySelector("code");
const rawWrap = $("#raw");
const loading = $("#loading");
const loadingText = $("#loadingText");
const errorBox = $("#error");
const resultTitle = $("#resultTitle");
const resultSub = $("#resultSub");
const toast = $("#toast");
const visionStatus = $("#visionStatus");
const privacyNotice = $("#privacyNotice");
const exiftoolStatus = $("#exiftoolStatus");
const installExiftoolBtn = $("#installExiftoolBtn");
const visionCapabilityStatus = $("#visionCapabilityStatus");
const themeChoices = Array.from(document.querySelectorAll("[data-theme-choice]"));

let currentMarkdown = "";
let currentName = "document";
let visionRequestCounter = 0;
let installRequestCounter = 0;
const pendingVisionRequests = new Map();
const pendingInstallRequests = new Map();

// ---------- Theme ----------
const THEME_STORAGE_KEY = "markitdown-ui-theme";
const VALID_THEMES = new Set(["light", "dark", "system"]);
const themeParams = new URLSearchParams(window.location.search);
const themeFromUrl = themeParams.get("theme");
const isPerciEmbedded = themeParams.get("perci") === "1" && window.parent !== window;
const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
let themeMode = VALID_THEMES.has(themeFromUrl)
  ? themeFromUrl
  : localStorage.getItem(THEME_STORAGE_KEY) || "system";
if (!VALID_THEMES.has(themeMode)) themeMode = "system";

function resolvedTheme() {
  if (themeMode === "system") return prefersDark.matches ? "dark" : "light";
  return themeMode;
}

function applyTheme({ persist = true } = {}) {
  if (themeMode === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = themeMode;

  const current = resolvedTheme();
  document.documentElement.style.colorScheme = current;
  themeChoices.forEach((btn) => {
    const active = btn.dataset.themeChoice === themeMode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
  if (persist && !VALID_THEMES.has(themeFromUrl)) localStorage.setItem(THEME_STORAGE_KEY, themeMode);
}

applyTheme({ persist: !VALID_THEMES.has(themeFromUrl) });
prefersDark.addEventListener?.("change", () => {
  if (themeMode === "system") applyTheme({ persist: false });
});
themeChoices.forEach((btn) => {
  btn.addEventListener("click", () => {
    const next = btn.dataset.themeChoice;
    if (!VALID_THEMES.has(next)) return;
    themeMode = next;
    applyTheme();
  });
});

if (isPerciEmbedded) {
  visionStatus.textContent = "OpenRouter vision via Perci";
  visionStatus.classList.remove("hidden");
  privacyNotice.textContent = "Local conversion · direct image uploads can use Perci's OpenRouter key for vision extraction.";
}

function setReadiness(el, state, text) {
  if (!el) return;
  el.classList.remove("pending", "ready", "missing");
  el.classList.add(state);
  const span = el.querySelector("span");
  if (span) span.textContent = text;
}

function updateCapabilities(capabilities = {}) {
  const exif = capabilities.exiftool || {};
  if (installExiftoolBtn) {
    const canInstall = isPerciEmbedded && !exif.available;
    installExiftoolBtn.classList.toggle("hidden", !canInstall);
    installExiftoolBtn.disabled = false;
    installExiftoolBtn.textContent = "Install";
  }
  setReadiness(
    exiftoolStatus,
    exif.available ? "ready" : "missing",
    exif.available ? "Installed for richer metadata" : `Optional metadata: ${exif.install_hint || "install ExifTool"}`
  );

  if (isPerciEmbedded) {
    setReadiness(visionCapabilityStatus, "ready", "OpenRouter via Perci for image uploads");
    return;
  }

  const vision = capabilities.vision || {};
  setReadiness(
    visionCapabilityStatus,
    vision.available ? "ready" : "missing",
    vision.available ? "Configured for image descriptions" : "Needs a vision provider for descriptions"
  );
}

async function refreshCapabilities() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    if (data.ui_version) $("#version").textContent = `v${data.ui_version}`;
    updateCapabilities(data.capabilities);
  } catch {
    try {
      const res = await fetch("/api/capabilities");
      updateCapabilities(await res.json());
    } catch {
      setReadiness(exiftoolStatus, "missing", "Could not check metadata tools");
      setReadiness(visionCapabilityStatus, isPerciEmbedded ? "ready" : "missing", isPerciEmbedded ? "OpenRouter via Perci" : "Could not check vision support");
    }
  }
}

installExiftoolBtn?.addEventListener("click", async () => {
  if (!isPerciEmbedded) {
    showToast("Install ExifTool from Perci");
    return;
  }
  const ok = window.confirm("Install ExifTool with Homebrew?\n\nThis will run: brew install exiftool");
  if (!ok) return;

  installExiftoolBtn.disabled = true;
  installExiftoolBtn.textContent = "Installing";
  setReadiness(exiftoolStatus, "pending", "Installing ExifTool with Homebrew…");
  try {
    const result = await requestPerciInstallExifTool();
    setReadiness(exiftoolStatus, result.ok ? "ready" : "missing", result.message || (result.ok ? "ExifTool installed" : "Install failed"));
    await refreshCapabilities();
  } catch (err) {
    setReadiness(exiftoolStatus, "missing", err.message || "ExifTool install failed");
    installExiftoolBtn.disabled = false;
    installExiftoolBtn.textContent = "Retry";
  }
});

// ---------- Mode switch (File / URL) ----------
document.querySelectorAll(".segmented [data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-mode]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.mode;
    $("#panel-file").classList.toggle("hidden", mode !== "file");
    $("#panel-url").classList.toggle("hidden", mode !== "url");
  });
});

// ---------- Result view switch (Preview / Markdown) ----------
document.querySelectorAll("[data-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-view]").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const raw = btn.dataset.view === "raw";
    preview.classList.toggle("hidden", raw);
    rawWrap.classList.toggle("hidden", !raw);
  });
});

// ---------- Dropzone ----------
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) uploadFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    if (evt === "dragleave" && dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove("dragover");
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
});

// ---------- URL form ----------
urlForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (url) convertUrl(url);
});

// ---------- Conversion requests ----------
async function uploadFile(file) {
  currentName = file.name.replace(/\.[^.]+$/, "") || "document";
  if (shouldUsePerciVision(file)) {
    await runPerciVisionConversion(file);
    return;
  }
  const fd = new FormData();
  fd.append("file", file);
  await runConversion(`Converting ${file.name}…`, "/api/convert", { body: fd });
}

async function convertUrl(url) {
  currentName = "page";
  const fd = new FormData();
  fd.append("url", url);
  await runConversion("Fetching & converting…", "/api/convert-url", { body: fd });
}

async function runConversion(label, endpoint, opts) {
  showLoading(label);
  try {
    const res = await fetch(endpoint, { method: "POST", ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
    showResult(data);
  } catch (err) {
    showError(err.message || "Something went wrong.");
  } finally {
    loading.classList.add("hidden");
  }
}

function shouldUsePerciVision(file) {
  return isPerciEmbedded && /^image\/(png|jpe?g|webp|gif)$/i.test(file.type || "");
}

async function runPerciVisionConversion(file) {
  showLoading(`Analyzing ${file.name} with OpenRouter vision…`);
  try {
    const markdown = await requestPerciVision(file);
    showResult({
      filename: file.name,
      title: file.name,
      markdown,
      chars: markdown.length,
    });
  } catch (err) {
    showError(err.message || "Perci vision extraction failed.");
  } finally {
    loading.classList.add("hidden");
  }
}

function requestPerciVision(file) {
  return new Promise((resolve, reject) => {
    const id = `vision-${Date.now()}-${++visionRequestCounter}`;
    const reader = new FileReader();
    const timeout = setTimeout(() => {
      pendingVisionRequests.delete(id);
      reject(new Error("Perci vision extraction timed out."));
    }, 120000);

    pendingVisionRequests.set(id, {
      resolve: (markdown) => {
        clearTimeout(timeout);
        resolve(markdown);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    reader.onerror = () => {
      pendingVisionRequests.delete(id);
      clearTimeout(timeout);
      reject(new Error("Could not read image file."));
    };
    reader.onload = () => {
      window.parent.postMessage({
        type: "markitdown:vision-request",
        id,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataUrl: reader.result,
      }, "*");
    };
    reader.readAsDataURL(file);
  });
}

function requestPerciInstallExifTool() {
  return new Promise((resolve, reject) => {
    const id = `install-exiftool-${Date.now()}-${++installRequestCounter}`;
    const timeout = setTimeout(() => {
      pendingInstallRequests.delete(id);
      reject(new Error("ExifTool installation timed out."));
    }, 600000);

    pendingInstallRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    window.parent.postMessage({
      type: "markitdown:install-exiftool-request",
      id,
    }, "*");
  });
}

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const message = event.data || {};
  if (message.type === "markitdown:vision-response") {
    const pending = pendingVisionRequests.get(message.id);
    if (!pending) return;
    pendingVisionRequests.delete(message.id);
    if (message.ok) {
      pending.resolve(String(message.markdown || ""));
    } else {
      pending.reject(new Error(message.error || "Perci vision extraction failed."));
    }
    return;
  }
  if (message.type === "markitdown:install-exiftool-response") {
    const pending = pendingInstallRequests.get(message.id);
    if (!pending) return;
    pendingInstallRequests.delete(message.id);
    if (message.ok) {
      pending.resolve(message);
    } else {
      pending.reject(new Error(message.error || "ExifTool installation failed."));
    }
  }
});

// ---------- UI state ----------
function showLoading(text) {
  errorBox.classList.add("hidden");
  result.classList.add("hidden");
  loadingText.textContent = text;
  loading.classList.remove("hidden");
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
}

function showResult(data) {
  currentMarkdown = data.markdown || "";
  resultTitle.textContent = data.title || data.filename || "Result";
  resultSub.textContent = `${(data.chars ?? currentMarkdown.length).toLocaleString()} characters`;
  rawCode.textContent = currentMarkdown;
  preview.innerHTML = renderMarkdown(currentMarkdown);
  result.classList.remove("hidden");
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- Copy / Download ----------
$("#copyBtn").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    showToast("Copied to clipboard");
  } catch {
    showToast("Copy failed");
  }
});

$("#downloadBtn").addEventListener("click", () => {
  const blob = new Blob([currentMarkdown], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${currentName}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast("Downloaded");
});

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

// ---------- Version badge ----------
refreshCapabilities();

// ---------- Minimal, safe Markdown renderer ----------
// Escapes all HTML first, then applies a small subset of Markdown. Keeps the
// app fully offline (no CDN) and avoids injecting untrusted HTML.
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Allow only safe URL schemes. Blocks javascript:, data:, vbscript:, etc.
// Input is already HTML-escaped, so "&amp;" etc. are inert here.
function safeUrl(url) {
  const trimmed = url.trim();
  if (/^(https?:|mailto:|#|\/|\.)/i.test(trimmed)) return trimmed;
  return "#";
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, src) => `<img alt="${alt}" src="${safeUrl(src)}">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_, txt, href) => `<a href="${safeUrl(href)}" target="_blank" rel="noopener noreferrer">${txt}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>");
}

function renderMarkdown(src) {
  const lines = escapeHtml(src).replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;
  let listType = null; // "ul" | "ol"

  const closeList = () => { if (listType) { html += `</${listType}>`; listType = null; } };

  while (i < lines.length) {
    let line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      html += `<pre><code>${buf.join("\n")}</code></pre>`;
      continue;
    }

    // Table (header row followed by separator row)
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      closeList();
      const splitRow = (r) => r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const headers = splitRow(line);
      i += 2;
      let rows = "";
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") {
        const cells = splitRow(lines[i]);
        rows += "<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>";
        i++;
      }
      html += "<table><thead><tr>" + headers.map((h) => `<th>${inline(h)}</th>`).join("") +
        "</tr></thead><tbody>" + rows + "</tbody></table>";
      continue;
    }

    // Headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }

    // Horizontal rule
    if (/^(\*\*\*|---|___)\s*$/.test(line)) { closeList(); html += "<hr>"; i++; continue; }

    // Blockquote
    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      html += `<blockquote>${inline(buf.join(" "))}</blockquote>`;
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      if (listType !== "ul") { closeList(); html += "<ul>"; listType = "ul"; }
      html += `<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`;
      i++; continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (listType !== "ol") { closeList(); html += "<ol>"; listType = "ol"; }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`;
      i++; continue;
    }

    // Blank line
    if (line.trim() === "") { closeList(); i++; continue; }

    // Paragraph (gather consecutive non-blank, non-special lines)
    closeList();
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|```)/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    html += `<p>${inline(buf.join("<br>"))}</p>`;
  }

  closeList();
  return html;
}
