# AGENTS.md

## Cursor Cloud specific instructions

This repo is the **Shipmozo API Developer Portal** — a single Node.js/Express app (no database, no monorepo). It serves a static docs SPA plus a server-side CORS proxy (`POST /api/proxy`) that forwards to the external Shipmozo API. See `README.md` for the full product/URL overview and `package.json` for all scripts.

- **Run (dev):** `npm start`. This first runs the `prestart` hook (`npm run build`), which regenerates the OpenAPI spec and Postman files into `spec/` and `public/assets/` before booting `server.js`. A bare `npm start` therefore works from a clean checkout. The server listens on port `3000` (override with `PORT`); host defaults to `0.0.0.0` (override with `HOST`).
- **No hot reload:** there is no watcher/nodemon. After editing `server.js`, `lib/`, or `scripts/`, restart the process. Editing `public/` static assets only needs a browser refresh, but changes to spec sources (`shipmozo-openapi.json`, `shipmozo-enrichment.json`, `lib/`) require re-running `npm run build` (or restarting, since `prestart` rebuilds).
- **Health check:** `GET /health` returns JSON `{"status":"ok","proxy":true,...}`. If it returns HTML instead, a stale/other server is on port 3000.
- **Lint/validate:** `npm run validate` (`npx @redocly/cli lint public/assets/spec.json`). It currently exits non-zero with pre-existing spec errors/warnings — this is the repo's baseline, not a setup failure.
- **Proxy / API Tester:** the `/#/execute` API Tester calls `/api/proxy`, which only forwards allow-listed paths (from the OpenAPI spec, plus `/info`) to `appiify.com` (dev, default) or `shipping-api.com` (live, set `SHIPMOZO_BACKEND=live`). Live requests need outbound internet and valid user-supplied `public-key`/`private-key` headers; without valid keys the upstream returns `{"result":"0","message":"unauthorised..."}`, which still proves the proxy works end-to-end. No credentials are stored server-side.
