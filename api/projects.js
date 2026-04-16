/**
 * Vercel Serverless Function — lists subdomains from Cloudflare DNS,
 * filters by HEAD checks, and enriches with sitemap routes.
 */

const CF_API = "https://api.cloudflare.com/client/v4";

/** Exact hostnames to omit from the directory */
const EXCLUDED_HOSTS = new Set([
  "www.elijahfrost.com",
  "projects.elijahfrost.com",
]);
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

function cfHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function fetchAllDnsRecords(zoneId, token) {
  const all = [];
  let page = 1;
  const perPage = 500;
  for (;;) {
    const url = `${CF_API}/zones/${zoneId}/dns_records?per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: cfHeaders(token) });
    const body = await res.json();
    if (!body.success) {
      const msg = body.errors?.map((e) => e.message).join("; ") || "Unknown error";
      throw new Error(`Cloudflare DNS list failed: ${msg}`);
    }
    const batch = body.result || [];
    all.push(...batch);
    const info = body.result_info;
    if (!info || page >= info.total_pages) break;
    page += 1;
  }
  return all;
}

function extractHostnamesFromRecords(records) {
  const hosts = new Set();
  const zoneSuffix = ".elijahfrost.com";
  for (const r of records) {
    if (r.type !== "A" && r.type !== "CNAME") continue;
    let name = (r.name || "").toLowerCase().replace(/\.$/, "");
    if (!name.endsWith(zoneSuffix)) continue;
    if (name === "elijahfrost.com") continue;
    if (EXCLUDED_HOSTS.has(name)) continue;
    const prefix = name.slice(0, -zoneSuffix.length);
    if (!prefix) continue;
    hosts.add(name);
  }
  return [...hosts];
}

function hostToProjectName(hostname) {
  const zoneSuffix = ".elijahfrost.com";
  return hostname.toLowerCase().endsWith(zoneSuffix)
    ? hostname.slice(0, -zoneSuffix.length)
    : hostname;
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

  const zoneId = process.env.CF_ZONE_ID;
  const token = process.env.CF_API_TOKEN;
  if (!zoneId || !token) {
    return res.status(500).json({
      error: "Missing CF_ZONE_ID or CF_API_TOKEN",
    });
  }

  try {
    const records = await fetchAllDnsRecords(zoneId, token);
    const hostnames = extractHostnamesFromRecords(records);

    const headResults = await mapWithConcurrency(hostnames, 30, async (host) => {
      const origin = `https://${host}`;
      const ok = await headOk(origin, 3000);
      return { host, origin, ok };
    });

    const passed = headResults.filter((x) => x.ok);

    const projects = await mapWithConcurrency(passed, 10, async ({ host, origin }) => {
      const name = hostToProjectName(host);
      const routes = await fetchSitemapRoutes(origin, 12000);
      return {
        name,
        url: origin,
        routes,
      };
    });

    projects.sort((a, b) => a.name.localeCompare(b.name));

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
