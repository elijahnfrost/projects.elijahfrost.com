# Project directory

This site lists every live subdomain on `elijahfrost.com` that appears in your Cloudflare DNS (A or CNAME), except the apex, `www`, and `projects`. Each project is probed with `HEAD`, sitemap paths are read from `https://<subdomain>.elijahfrost.com/sitemap.xml` when present, and the UI shows a simple nested outline. Deploy a new project to a new subdomain and the directory updates on the next fetch—no manual list to maintain.

## Environment variables

| Variable       | Purpose |
|----------------|---------|
| `CF_ZONE_ID`   | Cloudflare zone ID for `elijahfrost.com`. |
| `CF_API_TOKEN` | Cloudflare API token with **Zone:DNS:Read** (to list records). Use **Zone:DNS:Edit** as well if you automate the `projects` CNAME from scripts or CI. **Zone:Read** helps resolve the zone ID via the API. |

Set these in the Vercel project (**Settings → Environment Variables**) for Production (and Preview if you want the API to work on preview deployments).

If `CF_API_TOKEN` is rejected by Cloudflare (`9109 Invalid access token`), create a new **Account API Token** at [Cloudflare API tokens](https://dash.cloudflare.com/profile/api-tokens) with at least **Zone → Zone → Read**, **Zone → DNS → Read**, and **Zone → DNS → Edit** (edit is only needed for the DNS script below). Paste the token into Vercel and redeploy. You can read **Zone ID** on the domain’s **Overview** page (right-hand column).

### DNS for `projects.elijahfrost.com` (Vercel)

Vercel expects an **A** record: `projects.elijahfrost.com` → `76.76.21.21` (shown in `vercel domains inspect` after the hostname is attached to the project). With a working `CF_API_TOKEN` and `CF_ZONE_ID` in `.env`, run:

```bash
./scripts/cloudflare-dns-projects-a-record.sh
```

Then wait for DNS to propagate and redeploy or trigger a new production deployment so TLS can finish issuing.

## Add a new project

Point a new DNS name at your app (for example `my-app.elijahfrost.com`) as you already do for any deployment. After DNS is live and the site answers with a successful `HEAD` on `https://my-app.elijahfrost.com/`, it appears in this directory automatically.

## How sub-routes appear

Publish a `sitemap.xml` at the root of the subdomain (`https://<sub>.elijahfrost.com/sitemap.xml`). URLs in `<loc>` become nested links; entries are filtered per the rules in the API (API routes, framework internals, static assets, and query strings are dropped).

## Refresh from the UI

Use **Refresh** to clear the browser cache and request `/api/projects` again. Without **Refresh**, responses are cached in `localStorage` for one hour.

## Local development

1. Copy `.env.example` to `.env` and fill in `CF_ZONE_ID` and `CF_API_TOKEN`.
2. Run `npm run vercel-build` so `api/projects.js` exists (copied from `functions/api/projects.js`).
3. Run `npx vercel dev` from the repo root to serve the static files and the API route.

## Repository layout

- `index.html`, `style.css`, `script.js` — static frontend (source of truth at repo root).
- `functions/api/projects.js` — source for the serverless handler.
- `public/` — filled by `npm run vercel-build` (copies the three static files); that folder is ignored by git. Vercel’s **Output Directory** is `public`.
- `api/projects.js` — generated on build; ignored by git.
