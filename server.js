const express = require("express");
const path = require("path");
const fs = require("fs");
const { loadMergedSpec } = require("./lib/merge-spec");
const {
  resolveBackendBase,
  API_BACKENDS,
  DEFAULT_BACKEND,
  getBackendMeta,
} = require("./lib/api-bases");

const POSTMAN_FILES = {
  collection: "shipmozo.postman_collection.json",
  envDev: "shipmozo.postman_environment.dev.json",
  envLive: "shipmozo.postman_environment.live.json",
};

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const publicDir = path.join(__dirname, "public");
const swaggerDocument = loadMergedSpec(__dirname);

app.use(express.json({ limit: "4mb" }));

function postmanUrls(origin, mountPath) {
  const prefix = mountPath || "";
  const envFile = mountPath ? POSTMAN_FILES.envDev : POSTMAN_FILES.envLive;
  return {
    collection: `${origin}${prefix}/assets/${POSTMAN_FILES.collection}`,
    environment: `${origin}${prefix}/assets/${envFile}`,
  };
}

function registerPortalRoutes(mountPath, backendId) {
  const prefix = mountPath || "";
  const backendMeta = getBackendMeta(backendId);

  app.get(`${prefix}/api/spec.json`, (_req, res) => {
    res.type("application/json").json(swaggerDocument);
  });

  app.get(`${prefix}/health`, (req, res) => {
    const origin = `${req.protocol}://${req.get("host")}`;
    res.json({
      status: "ok",
      portal: "shipmozo-developer-portal",
      proxy: true,
      backend: backendMeta.id,
      baseUrl: backendMeta.baseUrl,
      defaultBackend: backendMeta.id,
      postman: postmanUrls(origin, prefix),
    });
  });

  app.get(`${prefix}/openapi.json`, (_req, res) => {
    res.redirect(301, `${prefix}/api/spec.json`);
  });

  for (const [route, file] of Object.entries({
    "collection.json": POSTMAN_FILES.collection,
    "environment.json": mountPath ? POSTMAN_FILES.envDev : POSTMAN_FILES.envLive,
    "environment.dev.json": POSTMAN_FILES.envDev,
    "environment.live.json": POSTMAN_FILES.envLive,
  })) {
    app.get(`${prefix}/postman/${route}`, (_req, res) => {
      const filePath = path.join(publicDir, "assets", file);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "Postman file not found", file });
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.type("application/json");
      res.sendFile(filePath);
    });
  }

  app.post(`${prefix}/api/proxy`, async (req, res) => {
    const { method = "GET", path: apiPath, headers = {}, body } = req.body || {};
    if (!apiPath || typeof apiPath !== "string") {
      return res.status(400).json({ error: "path is required", data: null });
    }

    const normalized = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
    const pathOnly = normalized.split("?")[0];
    const queryPart = normalized.includes("?")
      ? "?" + normalized.split("?").slice(1).join("?")
      : "";

    const allowed = Object.keys(swaggerDocument.paths || {}).some((p) => {
      const pattern = "^" + p.replace(/\{[^}]+\}/g, "[^/]+") + "$";
      return new RegExp(pattern).test(pathOnly);
    });

    if (!allowed && pathOnly !== "/info") {
      return res.status(403).json({
        error: "Path not allowed",
        path: pathOnly,
        data: null,
        hint: "Use paths from this portal's API reference only.",
      });
    }

    const apiBase = resolveBackendBase(backendId);
    const url = apiBase + pathOnly + queryPart;
    const forwardHeaders = { Accept: "application/json" };

    for (const [key, value] of Object.entries(headers)) {
      if (!value) continue;
      const k = key.toLowerCase();
      if (k === "public-key") forwardHeaders["public-key"] = value;
      else if (k === "private-key") forwardHeaders["private-key"] = value;
      else if (k === "authorization") forwardHeaders.Authorization = value;
    }

    try {
      const init = { method: method.toUpperCase(), headers: forwardHeaders };
      if (body && !["GET", "HEAD"].includes(init.method)) {
        forwardHeaders["Content-Type"] = "application/json";
        init.body = typeof body === "string" ? body : JSON.stringify(body);
      }

      const upstream = await fetch(url, init);
      const text = await upstream.text();
      const trimmed = text.trim();

      if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
        return res.status(502).json({
          status: upstream.status,
          statusText: upstream.statusText,
          url,
          error: "UPSTREAM_HTML",
          message:
            "Shipmozo returned an HTML page instead of JSON. Check base URL (no trailing slash), API keys, and that the endpoint path is correct.",
          data: null,
        });
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { _raw: text };
      }

      const rateLimit = {
        limit: upstream.headers.get("x-ratelimit-limit"),
        remaining: upstream.headers.get("x-ratelimit-remaining"),
        observedAt: new Date().toISOString(),
      };

      res.status(upstream.status).json({
        status: upstream.status,
        statusText: upstream.statusText,
        url,
        backend: backendId,
        data: parsed,
        rateLimit: rateLimit.limit || rateLimit.remaining ? rateLimit : undefined,
        rateLimitHeaders: {
          "x-ratelimit-limit": rateLimit.limit,
          "x-ratelimit-remaining": rateLimit.remaining,
        },
      });
    } catch (err) {
      res.status(502).json({
        error: "UPSTREAM_FAILED",
        message: err.message,
        url,
        data: null,
      });
    }
  });

  if (prefix) {
    app.get([prefix, `${prefix}/`], (_req, res) => {
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  app.use(
    prefix || "/",
    express.static(publicDir, {
      index: false,
      redirect: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith("openapi.json")) {
          res.setHeader("Cache-Control", "no-store");
        }
      },
    })
  );

  app.get(`${prefix}/docs`, (_req, res) => res.redirect(prefix || "/"));
}

/** Public (live) + silent internal /dev mount (same UI, Dev API). */
registerPortalRoutes("", DEFAULT_BACKEND === "dev" ? "dev" : "live");
registerPortalRoutes("/dev", "dev");

/** SPA fallback — HTML routes only (never swallow /api/* or static assets) */
app.get("*", (req, res, next) => {
  const p = req.path;
  if (p.startsWith("/api/") || p.startsWith("/dev/api/") || p === "/health" || p === "/dev/health") {
    return res.status(404).json({ error: "Not found", path: p });
  }
  if (p.includes(".")) return next();
  res.sendFile(path.join(publicDir, "index.html"));
});

app.use((_req, res) => {
  res.status(404).type("text/plain").send("Not found");
});

app.listen(PORT, HOST, () => {
  console.log(`Shipmozo Developer Portal: http://${HOST}:${PORT}/`);
  console.log(`API Tester:              http://${HOST}:${PORT}/#/execute`);
  console.log(`OpenAPI:                 http://${HOST}:${PORT}/api/spec.json`);
});
