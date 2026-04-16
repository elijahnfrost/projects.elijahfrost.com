const CACHE_KEY = "project-directory-cache-v1";
const TTL_MS = 60 * 60 * 1000;

const rootEl = document.getElementById("root");
const statusEl = document.getElementById("status");
const updatedEl = document.getElementById("updated");
const refreshBtn = document.getElementById("refresh");

function setRefreshLoading(loading) {
  if (!refreshBtn) return;
  refreshBtn.disabled = loading;
  refreshBtn.setAttribute("aria-busy", loading ? "true" : "false");
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.ts !== "number" ||
      parsed.data === undefined
    ) {
      return null;
    }
    if (Date.now() - parsed.ts > TTL_MS) return null;
    return { data: parsed.data, ts: parsed.ts };
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

function clearCache() {
  localStorage.removeItem(CACHE_KEY);
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
  return toTitle(p.name);
}

function render(projects) {
  rootEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const p of projects) {
    const li = document.createElement("li");
    const line = document.createElement("span");
    line.className = "project-line";
    const a = document.createElement("a");
    a.className = "project-title";
    a.href = p.url;
    a.rel = "noopener noreferrer";
    const titlePart = document.createElement("span");
    titlePart.className = "project-heading";
    titlePart.textContent = `${projectHeading(p)} `;
    const dim = document.createElement("span");
    dim.className = "project-url";
    dim.textContent = p.url;
    a.appendChild(titlePart);
    a.appendChild(dim);
    line.appendChild(a);
    li.appendChild(line);

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
      li.appendChild(det);
    }
    frag.appendChild(li);
  }
  rootEl.appendChild(frag);
}

function setUpdatedLine(iso) {
  if (!updatedEl) return;
  const d = new Date(iso);
  updatedEl.textContent = d.toLocaleString();
}

async function fetchProjects(bypassCache) {
  if (!bypassCache) {
    const cached = readCache();
    if (cached) {
      render(cached.data);
      if (statusEl) statusEl.textContent = "";
      setUpdatedLine(new Date(cached.ts).toISOString());
      return;
    }
  } else {
    clearCache();
  }

  setRefreshLoading(true);
  if (statusEl) statusEl.textContent = "Loading…";

  try {
    const res = await fetch("/api/projects", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (statusEl)
        statusEl.textContent = `Error ${res.status}${errText ? `: ${errText}` : ""}`;
      return;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      if (statusEl) statusEl.textContent = "Unexpected response.";
      return;
    }
    writeCache(data);
    render(data);
    if (statusEl) statusEl.textContent = "";
    setUpdatedLine(new Date().toISOString());
  } finally {
    setRefreshLoading(false);
  }
}

refreshBtn?.addEventListener("click", () => {
  fetchProjects(true);
});

fetchProjects(false);
