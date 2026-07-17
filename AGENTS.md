# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single Node.js/Express service: the **Shipmozo API Developer Portal** (`server.js`). No database or other backing services are required. Standard commands live in `package.json` and `README.md` — prefer those.

- **Dependencies** are refreshed automatically by the startup update script (`npm install`). Node 18+ is required (repo Docker image uses Node 22).
- **Run (dev):** `npm start`. There is no separate dev/watch mode; `server.js` has no hot reload, so restart the process after editing server code. It listens on `PORT` (default `3000`), host `0.0.0.0`.
- **Build:** `npm run build` regenerates the OpenAPI spec and Postman assets from `shipmozo-openapi.json` + `shipmozo-enrichment.json`. This runs automatically via the `prestart` hook before every `npm start`, so a manual build is rarely needed.
  - Build outputs are committed generated files (`spec/openapi.json`, `public/assets/spec.json`, `public/assets/shipmozo.postman_*.json`). Each build rewrites a `_postman_exported_at` timestamp in the Postman env files, so expect (and usually discard) that no-op diff after building.
- **Lint/validate:** `npm run validate` (`npx @redocly/cli lint public/assets/spec.json`) — needs network to fetch the CLI on first run. Note it currently reports pre-existing spec warnings/errors and exits non-zero; that is an existing spec-content issue, not an environment problem.
- **Core feature — API Tester:** the browser calls `POST /api/proxy`, which forwards to the upstream Shipmozo API (`dev` = `appiify.com`, `live` = `shipping-api.com`). Testing the round trip requires outbound network to those hosts. API keys are entered in the browser ("Connect API") and stored in `localStorage` — they are never stored server-side, and no secrets/env vars are needed to run the app. The frontend blocks "Execute" until keys are saved; save any (even dummy) keys to exercise the proxy end to end. Invalid keys return an authentic upstream `unauthorised` JSON response, which still proves the proxy works.
- **Health check:** `GET /health` returns `{"status":"ok","proxy":true,...}`.
