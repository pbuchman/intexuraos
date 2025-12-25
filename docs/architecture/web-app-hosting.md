# Web App Hosting (GCS + Load Balancer)

## Goal

Host the React SPA (`apps/web`) on a custom domain using:

- a public GCS bucket for static files
- a global external HTTP(S) Load Balancer (optionally with Cloud CDN)

This is optimized for:

- simple, low-maintenance static hosting
- predictable deploys via `gsutil rsync`

> This setup is a _static file host_. It is not a full-featured SPA hosting platform.

---

## Source of truth

- App source: `apps/web/**`
- Built artifacts: `apps/web/dist/**` (Vite output)

---

## Infrastructure (Terraform)

Module: `terraform/modules/web-app`

Creates:

- `google_storage_bucket.web_app` (public read)
- `google_compute_backend_bucket.web_app` (CDN optional)
- `google_compute_url_map.web_app`
- HTTPS cert + proxies + forwarding rules (when `enable_load_balancer = true` and `domain != ""`)

### Root path behavior (`/`)

**Important:** GCS `website.main_page_suffix` is _not applied_ when the bucket is served via a backend bucket behind an external HTTP(S) LB.

To avoid `GET / -> 404`, the URL map explicitly rewrites:

- `/` → `/index.html`

Implementation lives in `google_compute_url_map.web_app`.

---

## Routing strategy (SPA links)

### Why we use hash routing

Backend buckets do **not** support a general "SPA fallback" rewrite (e.g., rewrite `/notion` → `/index.html`).

That means:

- `GET /` can be fixed (rewrite to `/index.html`)
- `GET /assets/...` works
- but `GET /notion` will 404 on hard refresh

To make navigation links work under static hosting without server rewrites, the web app uses **hash routing**:

- `/#/` (dashboard)
- `/#/login`
- `/#/notion`
- `/#/whatsapp`

Implementation: `apps/web/src/App.tsx` uses `HashRouter`.

---

## Deployment (Cloud Build)

Script: `cloudbuild/scripts/deploy-web.sh`

It uploads the build output to:

- `gs://intexuraos-web-${ENVIRONMENT}/`

using:

- `gsutil -m rsync -r -d apps/web/dist/ gs://.../`

### Content-type fixes

The script also sets `Content-Type:image/png` for common PNG paths.

---

## Debug checklist

### Symptom: root `/` returns 404

Likely causes:

- URL map missing `/` → `/index.html` rewrite
- `index.html` missing from bucket (deploy didn’t upload)

Quick checks:

- Confirm `index.html` exists in the bucket.
- Confirm the URL map has the root rewrite rule.

### Symptom: `/#/...` works but `/some-route` 404s

Expected with backend bucket hosting.
Use hash routing links.

---

## Future options (if clean URLs are required)

If you want `/notion` to work on hard refresh:

1. Host via Cloud Run (nginx/caddy) behind the same LB and configure `try_files` / SPA fallback.
2. Use a hosting platform that supports SPA rewrites (e.g., Firebase Hosting, Cloudflare Pages).
