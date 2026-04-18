/**
 * Vercel Serverless Function — lists subdomains from Cloudflare DNS,
 * filters by HEAD checks, and enriches with sitemap routes.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

/** Exact hostnames to omit from the directory (www is a duplicate of apex). */
const EXCLUDED_HOSTS = new Set(["www.elijahfrost.com"]);

/** Always listed first: primary site, then this directory — not only “subdomain” DNS names. */
const PRIORITY_HOSTS = ["elijahfrost.com", "projects.elijahfrost.com"];

const DISPLAY_LABEL = {
  elijahfrost: "Elijah Frost",
  projects: "Directory",
};
const STATIC_EXT =
  /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|map|json)$/i;

const PATH_PREFIX_DENY = [
  /^\/api(\/|$)/,
  /^\/_next(\/|$)/,
  /^\/static(\/|$)/,
  /^\/_astro(\/|$)/,
];

const PATH_EXACT_DENY = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
]);

/** Vercel serverless limits (avoids relying on vercel.json `functions` for this path). */
export const config = {
  maxDuration: 60,
};

/**
 * Prefer API token (Bearer). Alternative: Global API Key via CF_AUTH_EMAIL + CF_GLOBAL_API_KEY
 * (Bearer must NOT be used with the Global Key — that causes "Authentication error").
 */
function buildCfRequestHeaders() {
  const token = (process.env.CF_API_TOKEN || "").trim();
  const email = (process.env.CF_AUTH_EMAIL || "").trim();
  const globalKey = (process.env.CF_GLOBAL_API_KEY || "").trim();

  if (token) {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
  }
  if (email && globalKey) {
    return {
      headers: {
        "X-Auth-Email": email,
        "X-Auth-Key": globalKey,
        "Content-Type": "application/json",
      },
    };
  }
  return null;
}

async function parseJsonResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _parseError: true, text: text.slice(0, 200) };
  }
}

function formatCfDnsError(res, body) {
  const msgs =
    body && !body._parseError && Array.isArray(body.errors)
      ? body.errors.map((e) => `${e.code ?? "?"}: ${e.message}`)
      : [];
  const detail = msgs.length ? msgs.join("; ") : `HTTP ${res.status}`;
  let hint = "";
  if (
    res.status === 401 ||
    res.status === 403 ||
    /authentication/i.test(detail) ||
    /\b9109\b/.test(detail)
  ) {
    hint =
      " Ensure CF_API_TOKEN is an API token (Create Custom Token), not the Global API Key in a Bearer header. Or omit CF_API_TOKEN and set CF_AUTH_EMAIL + CF_GLOBAL_API_KEY.";
  }
  if (/6003|invalid.*token|9109/i.test(detail) && !hint) {
    hint =
      " Invalid or revoked credentials — create a new token with Zone → Zone → Read and Zone → DNS → Read on elijahfrost.com.";
  }
  return `Cloudflare DNS list failed: ${detail}.${hint}`;
}

async function fetchAllDnsRecords(zoneId, requestHeaders) {
  const all = [];
  let page = 1;
  const perPage = 500;
  for (;;) {
    const url = `${CF_API}/zones/${zoneId}/dns_records?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: requestHeaders });
    const body = await parseJsonResponse(res);
    if (!body || body._parseError) {
      throw new Error(
        `Cloudflare DNS list failed: bad response (${res.status}).${body?.text ? ` Body: ${body.text}` : ""}`
      );
    }
    if (!body.success) {
      throw new Error(formatCfDnsError(res, body));
    }
    const batch = body.result || [];
    all.push(...batch);
    const info = body.result_info;
    if (!info || page >= info.total_pages) break;
    page += 1;
  }
  return all;
}

const ZONE_APEX = "elijahfrost.com";

/**
 * Cloudflare may return the short name (e.g. "projects") or the FQDN
 * ("projects.elijahfrost.com"). Normalize so we never drop valid zone records.
 */
function recordNameToFqdn(rawName) {
  let name = (rawName || "").toLowerCase().replace(/\.$/, "");
  if (!name) return null;
  if (name === ZONE_APEX) return ZONE_APEX;
  const suffix = `.${ZONE_APEX}`;
  if (name.endsWith(suffix)) return name;
  return `${name}.${ZONE_APEX}`;
}

function extractHostnamesFromRecords(records) {
  const hosts = new Set();
  const zoneSuffix = `.${ZONE_APEX}`;
  for (const r of records) {
    if (r.type !== "A" && r.type !== "CNAME") continue;
    const fqdn = recordNameToFqdn(r.name);
    if (!fqdn || !fqdn.endsWith(zoneSuffix)) continue;
    if (fqdn === ZONE_APEX) continue;
    if (EXCLUDED_HOSTS.has(fqdn)) continue;
    const prefix = fqdn.slice(0, -zoneSuffix.length);
    if (!prefix) continue;
    hosts.add(fqdn);
  }
  return [...hosts];
}

/** DNS-derived hostnames + priority hosts (apex + this site), deduped, fixed order. */
function mergeHostnames(dnsHostnames) {
  const seen = new Set();
  const out = [];
  for (const h of PRIORITY_HOSTS) {
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  for (const h of dnsHostnames) {
    if (seen.has(h) || EXCLUDED_HOSTS.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

function hostToProjectName(hostname) {
  const h = (hostname || "").toLowerCase();
  const zoneSuffix = ".elijahfrost.com";
  if (h === "elijahfrost.com") return "elijahfrost";
  if (h.endsWith(zoneSuffix)) return h.slice(0, -zoneSuffix.length);
  return h;
}

/** Normalize aliases like `career-tracker` and `careertracker` to one key. */
function canonicalProjectKey(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function preferHostname(currentHost, candidateHost) {
  if (!currentHost) return candidateHost;
  const curPriority = priorityIndex(currentHost);
  const nextPriority = priorityIndex(candidateHost);
  if (curPriority !== nextPriority) {
    return nextPriority < curPriority ? candidateHost : currentHost;
  }
  const curName = hostToProjectName(currentHost);
  const nextName = hostToProjectName(candidateHost);
  const curHasSeparator = /[-_.]/.test(curName);
  const nextHasSeparator = /[-_.]/.test(nextName);
  if (curHasSeparator !== nextHasSeparator) {
    return nextHasSeparator ? candidateHost : currentHost;
  }
  return candidateHost.localeCompare(currentHost) < 0 ? candidateHost : currentHost;
}

function priorityIndex(hostname) {
  const i = PRIORITY_HOSTS.indexOf(hostname);
  return i === -1 ? 1000 : i;
}

async function headOk(url, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ac.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) break;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    worker()
  );
  await Promise.all(workers);
  return results;
}

function shouldSkipPath(pathname) {
  if (!pathname || pathname === "/") return true;
  for (const re of PATH_PREFIX_DENY) {
    if (re.test(pathname)) return true;
  }
  if (PATH_EXACT_DENY.has(pathname)) return true;
  if (STATIC_EXT.test(pathname)) return true;
  return false;
}

function locUrlsFromSitemapXml(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim());
  }
  return out;
}

async function fetchSitemapRoutes(origin, timeoutMs) {
  const sitemapUrl = `${origin}/sitemap.xml`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(sitemapUrl, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const locs = locUrlsFromSitemapXml(xml);
    const base = new URL(origin);
    const routes = new Set();
    for (const loc of locs) {
      if (loc.includes("?")) continue;
      let u;
      try {
        u = new URL(loc);
      } catch {
        continue;
      }
      if (u.hostname !== base.hostname) continue;
      if (u.search) continue;
      const path = u.pathname;
      if (shouldSkipPath(path)) continue;
      routes.add(path);
    }
    return [...routes].sort();
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    return res.status(204).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const zoneId = (process.env.CF_ZONE_ID || "").trim();
  const auth = buildCfRequestHeaders();
  if (!zoneId) {
    return res.status(500).json({
      error: "Missing CF_ZONE_ID (Cloudflare zone Overview for elijahfrost.com).",
    });
  }
  if (!auth) {
    return res.status(500).json({
      error:
        "Missing Cloudflare credentials. Set CF_API_TOKEN (API token), or CF_AUTH_EMAIL + CF_GLOBAL_API_KEY (Global API Key — do not put the Global Key in CF_API_TOKEN).",
    });
  }

  try {
    const records = await fetchAllDnsRecords(zoneId, auth.headers);
    const fromDns = extractHostnamesFromRecords(records);
    const hostnames = mergeHostnames(fromDns);

    const headResults = await mapWithConcurrency(hostnames, 30, async (host) => {
      const origin = `https://${host}`;
      const ok = await headOk(origin, 3000);
      const pinned = PRIORITY_HOSTS.includes(host);
      return { host, origin, ok, pinned };
    });

    const passed = headResults.filter((x) => x.ok || x.pinned);
    const dedupedByProject = new Map();
    for (const entry of passed) {
      const name = hostToProjectName(entry.host);
      const key = canonicalProjectKey(name);
      const existing = dedupedByProject.get(key);
      if (!existing) {
        dedupedByProject.set(key, entry);
        continue;
      }
      const preferredHost = preferHostname(existing.host, entry.host);
      if (preferredHost === entry.host) {
        dedupedByProject.set(key, entry);
      }
    }
    const uniqueHosts = [...dedupedByProject.values()];

    const projects = await mapWithConcurrency(uniqueHosts, 10, async ({ host }) => {
      const origin = `https://${host}`;
      const name = hostToProjectName(host);
      const routes = await fetchSitemapRoutes(origin, 12000);
      const label = DISPLAY_LABEL[name];
      return {
        name,
        url: origin,
        routes,
        ...(label ? { label } : {}),
      };
    });

    projects.sort((a, b) => {
      const ha = new URL(a.url).hostname;
      const hb = new URL(b.url).hostname;
      const pa = priorityIndex(ha);
      const pb = priorityIndex(hb);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(projects);
  } catch (e) {
    console.error(e);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal error",
    });
  }
}
