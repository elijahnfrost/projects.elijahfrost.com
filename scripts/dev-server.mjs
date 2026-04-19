/**
 * Local static server + mock GET /api/projects so the directory UI (and stagger
 * animation) can be previewed without Vercel env / Cloudflare credentials.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
/* Default avoids common Vite (5173) / Next dev collisions; override with PORT=. */
const port = Number(process.env.PORT || 3847);

const MOCK_PROJECTS = [
  {
    name: "elijahfrost",
    url: "https://elijahfrost.com",
    label: "Elijah Frost",
    routes: [],
  },
  {
    name: "projects",
    url: "https://projects.elijahfrost.com",
    routes: [],
  },
  {
    name: "careertracker",
    url: "https://careertracker.elijahfrost.com",
    routes: [],
  },
  {
    name: "musclelabeler",
    url: "https://musclelabeler.elijahfrost.com",
    routes: [],
  },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function safeResolveFile(base, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0] || "/");
  const rel = decoded.replace(/^\/+/, "");
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

function sendFile(filePath, res, headOnly) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    if (headOnly) res.end();
    else res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/projects") {
    const body = JSON.stringify(MOCK_PROJECTS);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(body);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }

  const headOnly = req.method === "HEAD";
  const resolved = safeResolveFile(root, url.pathname);
  if (!resolved) {
    res.writeHead(403).end();
    return;
  }

  fs.stat(resolved, (err, st) => {
    if (!err && st.isFile()) {
      sendFile(resolved, res, headOnly);
      return;
    }
    if (!err && st.isDirectory()) {
      const indexPath = path.join(resolved, "index.html");
      fs.stat(indexPath, (e2, st2) => {
        if (!e2 && st2.isFile()) sendFile(indexPath, res, headOnly);
        else res.writeHead(404).end("Not found");
      });
      return;
    }
    res.writeHead(404).end("Not found");
  });
});

server.listen(port, () => {
  console.log(`Project directory dev server at http://localhost:${port}/`);
  console.log("Mock API: GET /api/projects");
});
