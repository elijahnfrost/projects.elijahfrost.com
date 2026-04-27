const CACHE_KEY = "project-directory-cache-v1";
/** Project list cache TTL (localStorage). */
const TTL_MS = 60 * 60 * 1000;

/** Iframe layout size (16:9); scaled down via CSS so embedded pages use a “desktop” width. */
const PREVIEW_VIEWPORT_W = 1280;
const PREVIEW_VIEWPORT_H = 720;

/** Start loading before previews scroll into view (larger = earlier fetch, snappier scroll). */
const PREVIEW_IO_MARGIN = "520px 0px 420px 0px";

/** Assign `src` immediately for the first N rows so above-the-fold previews don’t wait on IntersectionObserver. */
const PREVIEW_EAGER_COUNT = 2;

/** Origins we’ve already injected `<link rel="preconnect">` for (persists across re-renders). */
const preconnectedOrigins = new Set();

/** After this, show iframe even if `load` never fires (blocked / odd SPAs). */
const PREVIEW_LOAD_TIMEOUT_MS = 14000;

const rootEl = document.getElementById("root");
const statusEl = document.getElementById("status");
const updatedEl = document.getElementById("updated");

/** Avoid overlapping fetches from interval + visibility + online handlers. */
let fetchInFlight = false;

/**
 * Loading overlay is shown by index.html and removed once the directory has
 * something to display (cached list, fresh data, or an error message). The
 * safety timeout keeps the screen from getting stuck if a request hangs.
 */
const LOADER_SAFETY_MS = 12000;
let loaderHidden = false;

function hidePageLoader() {
  if (loaderHidden) return;
  loaderHidden = true;
  document.documentElement.setAttribute("data-loaded", "");
  document.dispatchEvent(new CustomEvent("page:loaded"));
}

setTimeout(hidePageLoader, LOADER_SAFETY_MS);

function readCacheEntry() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.ts !== "number" ||
      parsed.data === undefined ||
      !Array.isArray(parsed.data)
    ) {
      return null;
    }
    return {
      data: parsed.data,
      ts: parsed.ts,
      stale: Date.now() - parsed.ts > TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeCache(data) {
  localStorage.setItem(
    CACHE_KEY,
    JSON.stringify({ ts: Date.now(), data })
  );
}

function toTitle(name) {
  return name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map(
      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(" ");
}

function projectHeading(p) {
  if (typeof p.label === "string" && p.label.trim()) return p.label.trim();
  if (p.name === "projects") return "Project index";
  return toTitle(p.name);
}

/** Tried in order — origin favicon first, then CDNs (Google is often generic). */
function faviconUrlsForProject(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const origin = `${u.protocol}//${u.hostname}`;
    return [
      `${origin}/favicon.ico`,
      `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
    ];
  } catch {
    return [];
  }
}

let previewObserver = null;
let previewResizeObserver = null;

function disconnectPreviewObserver() {
  if (previewObserver) {
    previewObserver.disconnect();
    previewObserver = null;
  }
}

function disconnectPreviewResizeObserver() {
  if (previewResizeObserver) {
    previewResizeObserver.disconnect();
    previewResizeObserver = null;
  }
  window.removeEventListener("resize", syncPreviewScalesFromWindow);
}

function applyPreviewFrameScale(frame) {
  const w = frame.clientWidth;
  if (w <= 0) return;
  frame.style.setProperty(
    "--preview-scale",
    String(w / PREVIEW_VIEWPORT_W)
  );
}

function syncPreviewScalesFromWindow() {
  rootEl.querySelectorAll(".project-preview-frame").forEach(applyPreviewFrameScale);
}

/** Warm TLS/DNS for each project origin before iframes request a document. */
/**
 * We can’t turn off cross-origin sites’ own loading UIs. Hide the iframe until `load` so
 * spinners / skeletons aren’t visible; then reveal in one step.
 */
function attachPreviewReveal(frame, iframe) {
  if (!frame || !iframe) return;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    frame.classList.add("project-preview-frame--revealed");
    clearTimeout(timeoutId);
  };
  const timeoutId = setTimeout(finish, PREVIEW_LOAD_TIMEOUT_MS);
  iframe.addEventListener("load", finish, { once: true });
  iframe.addEventListener("error", finish, { once: true });
}

function assignPreviewIframeSrc(iframe, url) {
  const frame = iframe.closest(".project-preview-frame");
  attachPreviewReveal(frame, iframe);
  iframe.src = url;
}

function preconnectProjectOrigins(projects) {
  for (const p of projects) {
    if (!p.url || typeof p.url !== "string") continue;
    try {
      const origin = new URL(p.url).origin;
      if (preconnectedOrigins.has(origin)) continue;
      preconnectedOrigins.add(origin);
      const link = document.createElement("link");
      link.rel = "preconnect";
      link.href = origin;
      document.head.appendChild(link);
    } catch {
      /* ignore bad URLs */
    }
  }
}

/**
 * `transform: scale(calc(100cqw/1280))` on iframes is unreliable (often applies as 1× → looks
 * “cropped / zoomed”). Measure each frame width and set --preview-scale explicitly.
 */
function connectPreviewResizeObservers() {
  disconnectPreviewResizeObserver();
  const frames = rootEl.querySelectorAll(".project-preview-frame");
  frames.forEach(applyPreviewFrameScale);

  if (typeof ResizeObserver === "undefined") {
    window.addEventListener("resize", syncPreviewScalesFromWindow);
    return;
  }

  previewResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      if (w <= 0) continue;
      entry.target.style.setProperty(
        "--preview-scale",
        String(w / PREVIEW_VIEWPORT_W)
      );
    }
  });
  frames.forEach((frame) => previewResizeObserver.observe(frame));
}

/**
 * Eager-load first rows, lazy-load the rest with a generous margin so loads start before scroll.
 */
function connectPreviewLazyLoading() {
  disconnectPreviewObserver();
  const candidates = rootEl.querySelectorAll(
    "iframe.project-preview-iframe[data-preview-src]"
  );
  if (!candidates.length) return;

  if (typeof IntersectionObserver === "undefined") {
    candidates.forEach((iframe) => {
      const u = iframe.getAttribute("data-preview-src");
      if (u) assignPreviewIframeSrc(iframe, u);
    });
    return;
  }

  previewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const iframe = entry.target;
        const u = iframe.getAttribute("data-preview-src");
        if (u && !iframe.getAttribute("src")) {
          assignPreviewIframeSrc(iframe, u);
        }
        previewObserver.unobserve(iframe);
      }
    },
    { root: null, rootMargin: PREVIEW_IO_MARGIN, threshold: 0 }
  );

  candidates.forEach((iframe, index) => {
    const u = iframe.getAttribute("data-preview-src");
    if (!u) return;
    if (index < PREVIEW_EAGER_COUNT) {
      if ("fetchPriority" in iframe) {
        try {
          iframe.fetchPriority = "high";
        } catch {
          /* ignore */
        }
      }
      assignPreviewIframeSrc(iframe, u);
      return;
    }
    previewObserver.observe(iframe);
  });
}

function render(projects, options = {}) {
  const animate = options.animate !== false;
  preconnectProjectOrigins(projects);
  disconnectPreviewObserver();
  disconnectPreviewResizeObserver();
  rootEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  projects.forEach((p, index) => {
    const li = document.createElement("li");
    li.className = "project-row";
    const inner = document.createElement("div");
    inner.className = "project-inner";
    if (animate && index > 0) {
      inner.classList.add("project-inner--enter");
      inner.style.setProperty("--project-stagger", String(index));
    }

    const hit = document.createElement("a");
    hit.className = "project-row-hit";
    hit.href = p.url;
    hit.rel = "noopener noreferrer";
    hit.setAttribute(
      "aria-label",
      `Open ${projectHeading(p)} (${p.url})`
    );
    inner.appendChild(hit);

    const body = document.createElement("div");
    body.className = animate ? "project-body project-body-enter" : "project-body";
    if (animate) {
      /* Order matches API array (pinned hosts first, then alphabetical). */
      body.style.setProperty("--project-stagger", String(index));
    }

    const line = document.createElement("div");
    line.className = "project-line";

    const titleEl = document.createElement("span");
    titleEl.className = "project-title";
    const titlePart = document.createElement("span");
    titlePart.className = "project-heading";
    titlePart.textContent = projectHeading(p);
    titleEl.appendChild(titlePart);

    const linkRow = document.createElement("div");
    linkRow.className = "project-link-row";
    const favUrls = faviconUrlsForProject(p.url);
    if (favUrls.length) {
      const icon = document.createElement("img");
      icon.className = "project-link-favicon";
      icon.alt = "";
      icon.width = 16;
      icon.height = 16;
      icon.decoding = "async";
      icon.loading = "lazy";
      let favIndex = 0;
      icon.src = favUrls[favIndex];
      icon.addEventListener("error", function onFavError() {
        favIndex += 1;
        if (favIndex < favUrls.length) {
          icon.src = favUrls[favIndex];
        } else {
          icon.remove();
        }
      });
      linkRow.appendChild(icon);
    }
    const urlEl = document.createElement("span");
    urlEl.className = "project-url project-url-display";
    urlEl.textContent = p.url;
    linkRow.appendChild(urlEl);

    line.appendChild(titleEl);
    line.appendChild(linkRow);
    body.appendChild(line);

    const routes = Array.isArray(p.routes) ? p.routes : [];
    if (routes.length) {
      const det = document.createElement("details");
      det.className = "project-routes";

      const sum = document.createElement("summary");
      sum.className = "routes-summary";
      const n = routes.length;
      sum.textContent = `${n} path${n === 1 ? "" : "s"} from sitemap`;

      const sub = document.createElement("ul");
      sub.className = "route-list";
      for (const route of routes) {
        const rli = document.createElement("li");
        const ra = document.createElement("a");
        ra.className = "route-link";
        const full = `${p.url.replace(/\/$/, "")}${route}`;
        ra.href = full;
        ra.rel = "noopener noreferrer";
        ra.textContent = route;
        rli.appendChild(ra);
        sub.appendChild(rli);
      }
      det.appendChild(sum);
      det.appendChild(sub);
      body.appendChild(det);
    }
    inner.appendChild(body);

    const preview = document.createElement("div");
    preview.className = "project-preview";
    if (animate) {
      preview.classList.add("project-preview-enter");
      preview.style.setProperty("--project-stagger", String(index));
    }

    const frame = document.createElement("div");
    frame.className = "project-preview-frame";
    const iframe = document.createElement("iframe");
    iframe.className = "project-preview-iframe";
    iframe.setAttribute("width", String(PREVIEW_VIEWPORT_W));
    iframe.setAttribute("height", String(PREVIEW_VIEWPORT_H));
    iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
    iframe.title = `Preview of ${projectHeading(p)}`;
    iframe.setAttribute("data-preview-src", p.url);
    iframe.tabIndex = -1;
    frame.appendChild(iframe);
    preview.appendChild(frame);
    inner.appendChild(preview);

    li.appendChild(inner);
    frag.appendChild(li);
  });
  rootEl.appendChild(frag);
  /* Ensure layout so staggered keyframes reliably start in WebKit after DOM insert. */
  void rootEl.offsetHeight;
  connectPreviewResizeObservers();
  connectPreviewLazyLoading();
}

function setUpdatedLine(iso) {
  if (!updatedEl) return;
  const d = new Date(iso);
  updatedEl.textContent = d.toLocaleString();
}

async function fetchProjects() {
  if (fetchInFlight) return;

  const entry = readCacheEntry();

  if (entry) {
    render(entry.data, { animate: true });
    setUpdatedLine(new Date(entry.ts).toISOString());
    if (statusEl) statusEl.textContent = entry.stale ? "Updating…" : "";
    hidePageLoader();
    if (!entry.stale) return;
  } else if (statusEl) {
    statusEl.textContent = "Loading…";
  }

  fetchInFlight = true;
  try {
    const res = await fetch("/api/projects", {
      /* Stale localStorage refresh must bypass HTTP cache; warm loads may use disk cache. */
      cache: entry?.stale ? "no-store" : "default",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (statusEl) {
        statusEl.textContent = entry
          ? `Could not refresh (${res.status})${errText ? `: ${errText}` : ""}. Showing cached list.`
          : `Error ${res.status}${errText ? `: ${errText}` : ""}`;
      }
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      if (statusEl) statusEl.textContent = "Unexpected response.";
      return;
    }
    writeCache(data);
    render(data, { animate: true });
    if (statusEl) statusEl.textContent = "";
    setUpdatedLine(new Date().toISOString());
  } finally {
    fetchInFlight = false;
    hidePageLoader();
  }
}

fetchProjects();

setInterval(() => {
  fetchProjects();
}, TTL_MS);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    fetchProjects();
  }
});

window.addEventListener("online", () => {
  fetchProjects();
});
