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

let currentMarkdown = "";
let currentName = "document";

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
fetch("/api/health")
  .then((r) => r.json())
  .then((d) => { if (d.ui_version) $("#version").textContent = `v${d.ui_version}`; })
  .catch(() => {});

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
