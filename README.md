# Project directory

This site lists every live subdomain on `elijahfrost.com` that appears in your Cloudflare DNS (A or CNAME), except the apex, `www`, and `projects`. Each project is probed with `HEAD`, sitemap paths are read from `https://<subdomain>.elijahfrost.com/sitemap.xml` when present, and the UI shows a simple nested outline. Deploy a new project to a new subdomain and the directory updates on the next fetch—no manual list to maintain.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CF_ZONE_ID` | Zone ID for `elijahfrost.com` (**Overview** in Cloudflare). |
| `CF_API_TOKEN` | **API token** (recommended): **Zone → Zone → Read**, **Zone → DNS → Read** (and **DNS → Edit** if you use the DNS script). Scoped to `elijahfrost.com`. Do **not** put the **Global API Key** here — it only works with Bearer API tokens. |
| `CF_AUTH_EMAIL` | (Optional alternative to `CF_API_TOKEN`) Your Cloudflare account email. |
| `CF_GLOBAL_API_KEY` | (Optional) Global API Key from **My Profile → API Keys**. Use **with** `CF_AUTH_EMAIL`; leave `CF_API_TOKEN` unset when using this pair. |

Set these in Vercel (**Settings → Environment Variables**) for Production. If auth still fails, create a new [API token](https://dash.cloudflare.com/profile/api-tokens) and redeploy.

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

## GitHub

The repo is initialized locally on `main`. To publish it under **`project-directory`** on your GitHub account (after [installing `gh`](https://cli.github.com/) and signing in):

```bash
gh auth login
gh repo create project-directory --public --source=. --remote=origin --push
```

## Local development

1. Copy `.env.example` to `.env` and fill in `CF_ZONE_ID` and `CF_API_TOKEN`.
2. Run `npm run vercel-build` so `api/projects.js` exists (copied from `functions/api/projects.js`).
3. Run `npx vercel dev` from the repo root to serve the static files and the API route.

## Repository layout

- `index.html`, `style.css`, `script.js` — static frontend (source of truth at repo root).
- `functions/api/projects.js` — source for the serverless handler.
- `public/` — filled by `npm run vercel-build` (copies the three static files); that folder is ignored by git. Vercel’s **Output Directory** is `public`.
- `api/projects.js` — synced from `functions/api/projects.js` on each build; tracked in git so Vercel always sees `api/` in the repo.
