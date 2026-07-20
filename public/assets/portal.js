const API_BACKENDS = {
  dev: { label: "Dev server", baseUrl: "https://appiify.com/app/api/v1" },
  live: { label: "Live server", baseUrl: "https://shipping-api.com/app/api/v1" },
};
const AUTH_STORAGE = "shipmozo_api_keys";
const BACKEND_STORAGE = "shipmozo_api_backend";
/** Static file works even when a generic static server is used; /api/spec.json needs node server.js */
const POSTMAN_ASSETS = {
  collection: "/assets/shipmozo.postman_collection.json",
  envDev: "/assets/shipmozo.postman_environment.dev.json",
  envLive: "/assets/shipmozo.postman_environment.live.json",
};
const SPEC_URLS = ["/assets/spec.json", "/api/spec.json"];

function currentPostmanEnvAsset() {
  return backendEnv === "live" ? POSTMAN_ASSETS.envLive : POSTMAN_ASSETS.envDev;
}

function currentPostmanEnvDownloadName() {
  return backendEnv === "live" ? "shipmozo-live.postman_environment.json" : "shipmozo-dev.postman_environment.json";
}

function renderPostmanActions(compact = false) {
  const envLabel = getBackendLabel();
  if (compact) {
    return `
      <a href="${esc(POSTMAN_ASSETS.collection)}" download="shipmozo.postman_collection.json" class="btn-secondary postman-btn">Postman collection</a>
      <a href="${esc(currentPostmanEnvAsset())}" download="${esc(currentPostmanEnvDownloadName())}" class="btn-secondary postman-btn" title="Download ${esc(envLabel)} environment">Postman environment</a>`;
  }
  return `
    <div class="section postman-section">
      <h2>Postman</h2>
      <p class="page-lead">Download the Shipmozo API collection and environment, then import in Postman: <strong>Import → Upload Files</strong>.</p>
      <div class="hero-actions postman-actions">
        <a href="${esc(POSTMAN_ASSETS.collection)}" download="shipmozo.postman_collection.json" class="btn-primary postman-btn">Download collection</a>
        <a href="${esc(currentPostmanEnvAsset())}" download="${esc(currentPostmanEnvDownloadName())}" class="btn-secondary">Download ${esc(envLabel)} environment</a>
      </div>
      <div class="note" style="margin-top:12px">
        <strong>Setup:</strong> Import both files in Postman, select the <strong>${esc(envLabel)}</strong> environment, set <code>public-key</code> and <code>private-key</code>, then send requests.
      </div>
    </div>`;
}

let spec = null;
let portalMeta = null;
let operations = [];
let credentialsByEnv = {
  dev: { publicKey: "", privateKey: "" },
  live: { publicKey: "", privateKey: "" },
};
let credentials = credentialsByEnv.dev;
let backendEnv = "dev";

function getApiBase() {
  return API_BACKENDS[backendEnv]?.baseUrl || API_BACKENDS.dev.baseUrl;
}

function getBackendLabel() {
  return API_BACKENDS[backendEnv]?.label || "Dev server";
}

function loadBackend() {
  try {
    const saved = localStorage.getItem(BACKEND_STORAGE);
    if (saved === "live" || saved === "dev") backendEnv = saved;
  } catch {
    /* ignore */
  }
}

function saveBackend(env) {
  if (env !== "live" && env !== "dev") return;
  persistCredentialsToStore();
  backendEnv = env;
  localStorage.setItem(BACKEND_STORAGE, env);
  applyActiveCredentials();
  syncBackendUI();
  syncAuthUI();
  $("#authUsername") && ($("#authUsername").value = "");
  $("#authPassword") && ($("#authPassword").value = "");
  $("#authLoginMsg") && ($("#authLoginMsg").textContent = "");
}

function syncBackendUI() {
  const sel = $("#backendEnv");
  if (sel) sel.value = backendEnv;
  const hint = $("#authBackendHint");
  if (hint) hint.textContent = getBackendLabel();
}

function bindBackendSwitch() {
  $("#backendEnv")?.addEventListener("change", (e) => {
    saveBackend(e.target.value);
    toast(`Using ${getBackendLabel()} — ${getApiBase()}`, "info");
    route();
  });
}

const $ = (sel, root = document) => root.querySelector(sel);

function toast(message, type = "info") {
  const host = $("#toastHost");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/** Parse JSON safely — surfaces HTML/login-page responses clearly */
async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith("<!") || trimmed.startsWith("<html")) {
    throw new Error(
      "Server returned HTML instead of JSON. Run the portal with npm start from the logistics-api folder (not an old process on port 3000)."
    );
  }
  let data;
  try {
    data = trimmed ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Invalid JSON (${res.status}): ${trimmed.slice(0, 120)}…`);
  }
  return { res, data };
}

function getActiveCredentials() {
  const pub = $("#authPublicKey")?.value?.trim();
  const priv = $("#authPrivateKey")?.value?.trim();
  return {
    publicKey: pub || credentials.publicKey,
    privateKey: priv || credentials.privateKey,
  };
}

async function proxyRequest({ method, path, headers = {}, body }) {
  const { res, data } = await fetchJson("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path, headers, body, backend: backendEnv }),
  });
  if (!res.ok && data.error && !data.data) {
    throw new Error(data.message || data.error);
  }
  return data;
}

/** Lightweight ping to read current x-ratelimit-* from Shipmozo (uses one request from your quota). */
async function fetchLiveRateLimit() {
  const headers = authHeaders();
  const path = headers["public-key"] ? "/get-warehouses" : "/info";
  const wrapped = await proxyRequest({ method: "GET", path, headers });
  return {
    rateLimit: wrapped.rateLimit,
    rateLimitHeaders: wrapped.rateLimitHeaders,
    via: path,
  };
}

function renderLiveRateLimitBox() {
  return `
    <div class="rate-live card" id="rateLiveBox">
      <div class="rate-live-head">
        <h3>Live rate limit</h3>
        <button type="button" class="btn-secondary btn-sm" id="rateLiveBtn">Check now</button>
      </div>
      <p class="muted small">Makes one real API call and reads <code>x-ratelimit-*</code> headers. The number does <strong>not</strong> update until you click again.</p>
      <div class="rate-live-values" id="rateLiveValues">Not checked yet</div>
    </div>`;
}

function bindLiveRateLimit(root) {
  const btn = root.querySelector("#rateLiveBtn");
  const out = root.querySelector("#rateLiveValues");
  if (!btn || !out) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    out.textContent = "Calling Shipmozo…";
    try {
      const live = await fetchLiveRateLimit();
      const rl = live.rateLimit;
      if (!rl?.limit) {
        out.innerHTML = `<span class="error-text">No rate-limit headers returned (via ${esc(live.via)})</span>`;
        return;
      }
      out.innerHTML = `
        <div class="rate-live-big"><strong>${esc(String(rl.remaining))}</strong> / ${esc(String(rl.limit))} remaining</div>
        <div class="muted small">Observed: ${esc(rl.observedAt || "now")} · via <code>${esc(live.via)}</code></div>
        <div class="muted small">Execute again after ~60s to see remaining recover toward 500.</div>`;
    } catch (e) {
      out.innerHTML = `<span class="error-text">${esc(e.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  });
}

function applyActiveCredentials() {
  if (!credentialsByEnv[backendEnv]) {
    credentialsByEnv[backendEnv] = { publicKey: "", privateKey: "" };
  }
  credentials = credentialsByEnv[backendEnv];
}

function persistCredentialsToStore() {
  const c = getActiveCredentials();
  credentialsByEnv[backendEnv] = {
    publicKey: c.publicKey || "",
    privateKey: c.privateKey || "",
  };
  credentials = credentialsByEnv[backendEnv];
  try {
    localStorage.setItem(AUTH_STORAGE, JSON.stringify(credentialsByEnv));
  } catch {
    /* ignore quota errors */
  }
}

function loadCredentials() {
  credentialsByEnv = {
    dev: { publicKey: "", privateKey: "" },
    live: { publicKey: "", privateKey: "" },
  };
  try {
    const raw = localStorage.getItem(AUTH_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.dev || parsed.live) {
        if (parsed.dev) credentialsByEnv.dev = { ...credentialsByEnv.dev, ...parsed.dev };
        if (parsed.live) credentialsByEnv.live = { ...credentialsByEnv.live, ...parsed.live };
      } else if (parsed.publicKey !== undefined || parsed.privateKey !== undefined) {
        const legacy = {
          publicKey: parsed.publicKey || "",
          privateKey: parsed.privateKey || "",
        };
        credentialsByEnv.dev = { ...legacy };
        credentialsByEnv.live = { ...legacy };
      }
    }
  } catch {
    credentialsByEnv = {
      dev: { publicKey: "", privateKey: "" },
      live: { publicKey: "", privateKey: "" },
    };
  }
  applyActiveCredentials();
  syncAuthUI();
}

function saveCredentials() {
  persistCredentialsToStore();
  syncAuthUI();
}

function clearCredentials() {
  credentials = { publicKey: "", privateKey: "" };
  credentialsByEnv[backendEnv] = { ...credentials };
  try {
    localStorage.setItem(AUTH_STORAGE, JSON.stringify(credentialsByEnv));
  } catch {
    /* ignore */
  }
  syncAuthUI();
}

function syncAuthUI(accountHint) {
  const status = $("#authStatus");
  const pub = $("#authPublicKey");
  const priv = $("#authPrivateKey");
  if (pub) pub.value = credentials.publicKey;
  if (priv) priv.value = credentials.privateKey;
  const active = getActiveCredentials();
  status.classList.remove("connected", "pending");

  if (active.publicKey && active.privateKey) {
    setJourney({ connected: true });
    const envTag = getBackendLabel();
    if (accountHint === "verified") {
      status.textContent = `${envTag} · Ready`;
      status.classList.add("connected");
      status.title = "Keys saved — account active";
    } else if (accountHint === "pending") {
      status.textContent = `${envTag} · Pending`;
      status.classList.add("pending");
      status.title = "Keys work, but Shipmozo profile is under verification";
    } else {
      status.textContent = `${envTag} · Keys saved`;
      status.classList.add("connected");
      status.title = `public-key: ${active.publicKey.slice(0, 10)}…`;
    }
  } else if (active.publicKey || active.privateKey) {
    status.textContent = `${getBackendLabel()} · Incomplete`;
    status.title = "Enter both public-key and private-key";
  } else {
    status.textContent = "Not connected";
    status.title = "Click Connect API";
  }
}

/** Explain Shipmozo result/message in plain language */
function interpretShipmozoResponse(payload) {
  if (!payload || typeof payload !== "object") return null;
  const message = payload.message || "";
  const msg = message.toLowerCase();
  const failureReason = payload.data?.error || message || "The API returned result 0.";
  if (payload.result === "1" || payload.result === 1) {
    return { type: "ok", title: "✅ Success", text: message || "Request succeeded." };
  }
  if (msg.includes("under verification") || msg.includes("profile is under")) {
    return {
      type: "pending",
      title: "⏳ Account pending verification (not an API key issue)",
      text: "Your public-key and private-key are accepted, but Shipmozo has not activated your seller profile yet. Complete verification in the Shipmozo panel (KYC / documents). API calls will return result \"0\" until approval.",
    };
  }
  if (msg.includes("invalid") && (msg.includes("key") || msg.includes("credential"))) {
    return {
      type: "error",
      title: "❌ Failed: Invalid API keys",
      text: "Shipmozo rejected the keys. Copy fresh keys from Panel → Profile or sign in again.",
    };
  }
  return {
    type: "error",
    title: `❌ Failed: ${failureReason}`,
    text: "HTTP status can still be 200 — check result, then data.error or message.",
  };
}

async function probeAccountStatus() {
  const headers = authHeaders();
  if (!headers["public-key"] || !headers["private-key"]) return null;
  try {
    const wrapped = await proxyRequest({
      method: "GET",
      path: "/get-warehouses",
      headers,
    });
    const payload = wrapped.data;
    if (payload?.result === "1") return "verified";
    const hint = interpretShipmozoResponse(payload);
    if (hint?.type === "pending") return "pending";
    return "unknown";
  } catch {
    return null;
  }
}

async function loginWithPassword(username, password) {
  const wrapped = await proxyRequest({
    method: "POST",
    path: "/login",
    headers: {},
    body: { username, password },
  });
  const payload = wrapped.data;
  if (payload?.result !== "1" || !Array.isArray(payload.data) || !payload.data[0]) {
    throw new Error(payload?.message || wrapped.message || "Login failed");
  }
  credentials.publicKey = payload.data[0].public_key || "";
  credentials.privateKey = payload.data[0].private_key || "";
  saveCredentials();
  return payload.data[0];
}

function authHeaders() {
  const c = getActiveCredentials();
  const h = {};
  if (c.publicKey) h["public-key"] = c.publicKey;
  if (c.privateKey) h["private-key"] = c.privateKey;
  return h;
}

async function loadSpec() {
  let lastError;
  for (const url of SPEC_URLS) {
    try {
      const { data } = await fetchJson(url);
      if (!data?.paths) throw new Error("Spec missing paths");
      spec = data;
      portalMeta = spec["x-portal"] || {};
      operations = [];
      for (const [pathKey, methods] of Object.entries(spec.paths || {})) {
        for (const [method, op] of Object.entries(methods)) {
          if (["get", "post", "put", "patch", "delete"].includes(method)) {
            operations.push({
              id: `${method}-${pathKey}`.replace(/[{}]/g, ""),
              method: method.toUpperCase(),
              path: pathKey,
              op,
              tag: (op.tags && op.tags[0]) || "Other",
              summary: op.summary || pathKey,
            });
          }
        }
      }
      return;
    } catch (e) {
      lastError = new Error(`${url}: ${e.message}`);
    }
  }
  throw lastError || new Error("Could not load API spec");
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function resolveRef(ref) {
  if (!ref || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let cur = spec;
  for (const p of parts) cur = cur?.[p];
  return cur;
}

function schemaFromProperties(props) {
  if (!props) return null;
  const o = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.default !== undefined && v.default !== "") o[k] = v.default;
    else if (v.example !== undefined) o[k] = v.example;
    else if (v.type === "array") o[k] = v.example || [];
    else if (v.type === "number") o[k] = 0;
    else o[k] = "";
  }
  return o;
}

function getRequestExample(op) {
  const content = op.requestBody?.content?.["application/json"];
  if (!content) return null;
  if (content.example !== undefined) return content.example;
  const ex = content.examples && Object.values(content.examples)[0]?.value;
  if (ex) return ex;
  const schema = content.schema?.$ref ? resolveRef(content.schema.$ref) : content.schema;
  if (schema?.example !== undefined) return schema.example;
  if (schema?.properties) return schemaFromProperties(schema.properties);
  return schemaExample(schema);
}

function schemaExample(schema, depth = 0) {
  if (!schema || depth > 4) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.$ref) schema = resolveRef(schema.$ref) || schema;
  if (schema.properties) return schemaFromProperties(schema.properties);
  if (schema.type === "array") return [schemaExample(schema.items, depth + 1)];
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "boolean") return true;
  return schema.type === "string" ? "" : null;
}

function getResponseExample(op, status = "200") {
  const resp = op.responses?.[status];
  const content = resp?.content?.["application/json"];
  if (!content) return null;
  if (content.schema?.example) return content.schema.example;
  return schemaExample(content.schema);
}

function collectParams(op, path) {
  const params = [];
  const add = (p) => {
    if (!p) return;
    const resolved = p.$ref ? resolveRef(p.$ref) : p;
    if (resolved) params.push(resolved);
  };
  (op.parameters || []).forEach(add);
  const pathParams = path.match(/\{([^}]+)\}/g) || [];
  pathParams.forEach((m) => {
    const name = m.slice(1, -1);
    if (!params.find((x) => x.name === name && x.in === "path")) {
      params.push({ name, in: "path", required: true, schema: { type: "string" } });
    }
  });
  return params;
}

function needsAuth(op) {
  return op.security !== undefined && op.security.length > 0;
}

function maskHeaderValue(name, value) {
  if (!value || !["public-key", "private-key"].includes(name.toLowerCase()) || /^YOUR_/i.test(value)) {
    return value;
  }
  return `${value.slice(0, 3)}••••`;
}

function buildCurl(method, url, headers, body) {
  let s = `curl -X ${method} "${url}"`;
  for (const [k, v] of Object.entries(headers)) {
    if (v) s += ` \\\n  -H "${k}: ${maskHeaderValue(k, v)}"`;
  }
  if (body)
    s += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`;
  return s;
}

function buildNode(method, url, headers, body) {
  const opts = { method, headers: { ...headers, Accept: "application/json" } };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = "JSON.stringify(payload)";
  }
  return `const payload = ${JSON.stringify(body || {}, null, 2)};
const res = await fetch("${url}", ${JSON.stringify(opts, null, 2).replace('"JSON.stringify(payload)"', "JSON.stringify(payload)")});
const data = await res.json();
console.log(data);`;
}

function buildPython(method, url, headers, body) {
  const h = JSON.stringify(headers, null, 4);
  if (body) {
    return `import requests\n\npayload = ${JSON.stringify(body, null, 4)}\nheaders = ${h}\nr = requests.${method.toLowerCase()}("${url}", json=payload, headers=headers)\nprint(r.status_code, r.json())`;
  }
  return `import requests\n\nheaders = ${h}\nr = requests.${method.toLowerCase()}("${url}", headers=headers)\nprint(r.status_code, r.json())`;
}

function renderCodeTabs(curl, node, python) {
  const id = "code-" + Math.random().toString(36).slice(2, 9);
  const tabs = [
    ["cURL", curl],
    ["Node.js", node],
    ["Python", python],
  ];
  return `
    <div class="code-tabs" data-tabs="${id}">
      <div class="code-tab-bar">
        ${tabs.map(([name], i) => `<button type="button" class="code-tab${i === 0 ? " active" : ""}" data-tab="${i}">${name}</button>`).join("")}
      </div>
      ${tabs
        .map(
          ([, code], i) => `
        <div class="code-block-wrap${i === 0 ? "" : " hidden"}" data-panel="${i}">
          <button type="button" class="copy-btn" data-copy>Copy</button>
          <pre><code>${esc(code)}</code></pre>
        </div>`
        )
        .join("")}
    </div>`;
}

function bindCodeTabs(root) {
  root.querySelectorAll("[data-tabs]").forEach((wrap) => {
    const panels = wrap.querySelectorAll("[data-panel]");
    wrap.querySelectorAll(".code-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = btn.dataset.tab;
        wrap.querySelectorAll(".code-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === i));
        panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== i));
      });
    });
    wrap.querySelectorAll(".copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pre = btn.parentElement.querySelector("pre code");
        navigator.clipboard.writeText(pre.textContent);
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      });
    });
  });
}

function renderParamTable(params) {
  if (!params.length) return "<p class='muted'>No parameters.</p>";
  return `<table>
    <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
    <tbody>
      ${params
        .map((p) => {
          const req = p.required ? '<span class="tag-required">Required</span>' : "Optional";
          const type = p.schema?.type || p.schema?.format || "—";
          return `<tr>
            <td><code>${esc(p.name)}</code></td>
            <td>${esc(p.in)}</td>
            <td>${esc(String(type))}</td>
            <td>${req}</td>
            <td>${esc(p.description || "")}</td>
          </tr>`;
        })
        .join("")}
    </tbody>
  </table>`;
}

function formatRateLimitLine(op) {
  const rl = op?.["x-rateLimit"];
  const g = portalMeta.rateLimitGlobal;
  const limit = typeof rl === "object" ? rl.limit : g?.limit ?? 500;
  const window = g?.window || "1 minute";
  return `${limit} requests / ${window} (shared) · remaining refills each minute`;
}

function renderRateLimitByEndpointTable() {
  const rows = portalMeta.rateLimitsByEndpoint || [];
  if (!rows.length) return "";
  return `<table class="rate-api-table">
    <thead><tr><th>Method</th><th>Path</th><th>Limit</th><th>Auth</th><th>Notes</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr>
          <td><span class="method-badge method-${r.method}">${r.method}</span></td>
          <td><code>${esc(r.path)}</code></td>
          <td><strong>${r.limit}</strong> <span class="muted small">(shared)</span></td>
          <td>${r.auth ? "Keys" : "—"}</td>
          <td class="muted small">${esc(r.notes || "")}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function renderStaticIntro() {
  const g = portalMeta.rateLimitGlobal || { limit: 500 };
  const rlHeaders = portalMeta.rateLimitHeaders;
  const connected = !!(getActiveCredentials().publicKey && getActiveCredentials().privateKey);
  return `
    <div class="hero-banner">
      <div class="hero-logo-wrap">
        <img src="/assets/shipmozo-logo.png" alt="Shipmozo" class="hero-logo" width="160" height="52" />
      </div>
      <h2>Developer portal</h2>
      <p>Integrate orders, couriers, tracking, warehouses, and returns. Connect your API keys and test live from the browser.</p>
      <div class="hero-actions">
        <button type="button" class="btn-primary" id="heroConnectBtn">${connected ? "Manage API keys" : "Connect API keys"}</button>
        <a href="#/execute" class="btn-secondary">Open API Tester</a>
        ${renderPostmanActions(true)}
      </div>
      ${
        connected
          ? ""
          : `<p class="hero-start-hint">Start here: connect your keys before using the API Tester or Postman downloads.</p>`
      }
    </div>
    <div class="note warn"><strong>Dev sandbox behavior:</strong> Dev requests run against a live sandbox. Pushing an order creates a real order and AWB on your account, so cancel test orders when you're done. Dev and Live use separate keys.</div>

    <div class="section">
      <h2>What you can build</h2>
      <div class="card-grid">
        <div class="card"><h3>Forward orders</h3><p>Push orders, compare rates, assign courier, schedule pickup, print labels.</p></div>
        <div class="card"><h3>Returns</h3><p>Return reasons, push return orders, track reverse logistics.</p></div>
        <div class="card"><h3>Operations</h3><p>Warehouses, NDR actions, manifests, international shipments.</p></div>
      </div>
    </div>

    <div class="section">
      <h2>Base URL</h2>
      <div class="url-box card">
        <label>${esc(getBackendLabel())}</label>
        <code>${getApiBase()}</code>
      </div>
      <p class="base-url-note">
        <strong>Dev</strong> (<code>appiify.com</code>) is the staging host used by this portal when Dev is selected.
        <strong>Live</strong> (<code>shipping-api.com</code>) is the production API documented for go-live.
        Switch servers in the header — API Tester and code samples follow the selection. Keys are stored separately per environment.
      </p>
      <p class="muted small">Switch between <strong>Dev</strong> and <strong>Live</strong> in the header. API Tester and code samples use the selected server.</p>
      <div class="note warn"><strong>No trailing slash.</strong> Using <code>.../v1/</code> can cause CORS failures in browsers.</div>
    </div>

    ${renderPostmanActions()}

    <div class="section">
      <h2>Response format</h2>
      <p>Every API returns JSON with three fields:</p>
      <table>
        <thead><tr><th>Field</th><th>Values</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><code>result</code></td><td><code>"1"</code> / <code>"0"</code></td><td>Success vs failure (check this first)</td></tr>
          <tr><td><code>message</code></td><td>string</td><td>Human-readable outcome</td></tr>
          <tr><td><code>data</code></td><td>object / array</td><td>Payload or error details</td></tr>
        </tbody>
      </table>
    </div>

    <div class="section">
      <h2>Rate limits</h2>
      <p>All <strong>24 APIs</strong> share <strong>${g.limit || 500} requests per minute</strong> per API key. Each call lowers <code>x-ratelimit-remaining</code> by 1; when the minute ends, the counter <strong>refreshes</strong> back toward 500.</p>
      ${
        rlHeaders
          ? `<table style="margin-top:12px"><thead><tr><th>Header</th><th>Example</th><th>Meaning</th></tr></thead><tbody>${rlHeaders.headers
              .map((h) => `<tr><td><code>${esc(h.name)}</code></td><td>${esc(h.example)}</td><td>${esc(h.meaning)}</td></tr>`)
              .join("")}</tbody></table>`
          : ""
      }
      <p style="margin-top:16px"><a href="#/rate-limits">Per-API rate limit table →</a> · <a href="#/errors">Error codes →</a></p>
    </div>

    <div class="section">
      <h2>Quick start</h2>
      <ol>
        <li>Sign in via the sidebar (or paste keys from Shipmozo panel → Profile).</li>
        <li>Open <a href="#/workflows">Integration flows</a> and pick your use case.</li>
        <li>Use <a href="#/execute">API Tester</a> — credentials are sent automatically.</li>
      </ol>
    </div>`;
}

function renderAuthPage() {
  return `
    <h1 class="page-title">Authentication</h1>
    <p class="page-lead">Shipmozo uses API key headers on every protected request. Keys are never sent as query parameters.</p>

    <div class="section">
      <h2>Option 1 — Login API (recommended for setup)</h2>
      <p>Exchange panel username and password for keys. Use the sidebar <strong>Sign in</strong> in this portal — keys are stored locally and attached to every test request.</p>
      ${renderCodeTabs(
        buildCurl("POST", `${getApiBase()}/login`, {}, { username: "your_username", password: "your_password" }),
        buildNode("POST", `${getApiBase()}/login`, {}, { username: "your_username", password: "your_password" }),
        buildPython("POST", `${getApiBase()}/login`, {}, { username: "your_username", password: "your_password" })
      )}
      <p>Success response includes <code>public_key</code> and <code>private_key</code> inside <code>data[0]</code>.</p>
    </div>

    <div class="section">
      <h2>Option 2 — Panel profile</h2>
      <p>Log into the Shipmozo panel → User profile → copy <code>public-key</code> and <code>private-key</code>.</p>
    </div>

    <div class="section">
      <h2>Send keys on every request</h2>
      ${renderCodeTabs(
        buildCurl("GET", `${getApiBase()}/get-warehouses`, { "public-key": "YOUR_PUBLIC_KEY", "private-key": "YOUR_PRIVATE_KEY" }, null),
        buildNode("GET", `${getApiBase()}/get-warehouses`, { "public-key": "YOUR_PUBLIC_KEY", "private-key": "YOUR_PRIVATE_KEY" }, null),
        buildPython("GET", `${getApiBase()}/get-warehouses`, { "public-key": "YOUR_PUBLIC_KEY", "private-key": "YOUR_PRIVATE_KEY" }, null)
      )}
    </div>

    <div class="note warn"><strong>Dev sandbox behavior:</strong> Dev requests can create real orders and AWBs on your account. Cancel test orders when you're done. Dev and Live use separate keys.</div>
    <div class="note"><strong>Security:</strong> Never expose <code>private-key</code> in front-end apps or mobile clients. Call Shipmozo from your backend only.</div>`;
}

function renderWorkflows() {
  const flows = portalMeta.workflows || [];
  return `
    <h1 class="page-title">Integration flows</h1>
    <p class="page-lead">End-to-end sequences.</p>
    ${flows
      .map(
        (f) => `
      <div class="section flow-card">
        <h2>${esc(f.title)}</h2>
        <ol class="flow-steps">
          ${f.steps.map((s) => `<li><code>${esc(s)}</code></li>`).join("")}
        </ol>
      </div>`
      )
      .join("")}
    <div class="section">
      <h2>Glossary</h2>
      ${renderParamTable(
        (portalMeta.glossary || []).map((g) => ({
          name: g.term,
          in: "—",
          schema: { type: "term" },
          required: false,
          description: g.meaning,
        }))
      )}
    </div>`;
}

function renderRateLimitsPage() {
  const g = portalMeta.rateLimitGlobal || {};
  const rlHeaders = portalMeta.rateLimitHeaders;
  return `
    <h1 class="page-title">Rate limits — all APIs</h1>
    <p class="page-lead">Every Shipmozo v1 endpoint shares <strong>500 requests per minute</strong> per API key. <code>x-ratelimit-remaining</code> is returned on each response — it is <strong>not</strong> a live timer on this page.</p>

    ${renderLiveRateLimitBox()}

    <div class="section">
      <h2>How the 1-minute window works</h2>
      <div class="note warn" style="margin-bottom:16px"><strong>Why it looks "stuck" at 498:</strong> Documentation examples use 498 to mean "2 calls used." The real value only updates when you <strong>make another API request</strong> and read the new headers — not by waiting on this page.</div>
      <ol>
        <li><strong>Each API call you make:</strong> <code>remaining</code> decreases by 1 in that response</li>
        <li><strong>Wait ~60s, then call again:</strong> next response usually shows <code>remaining</code> higher (e.g. 499–500)</li>
        <li><strong>Docs / examples:</strong> static text — use <strong>Check now</strong> or API Tester for live values</li>
        <li><strong>If you hit 0:</strong> wait and retry; you may get HTTP 429 until the window recovers</li>
      </ol>
      <p class="muted small">${esc(g.windowBehavior || "")}</p>
    </div>

    <div class="section">
      <h2>Response headers</h2>
      ${
        rlHeaders
          ? `<table><thead><tr><th>Header</th><th>Example</th><th>Meaning</th></tr></thead><tbody>${rlHeaders.headers
              .map((h) => `<tr><td><code>${esc(h.name)}</code></td><td>${esc(h.example)}</td><td>${esc(h.meaning)}</td></tr>`)
              .join("")}</tbody></table><p class="note" style="margin-top:12px">${esc(rlHeaders.note || "")}</p>`
          : ""
      }
      <p><strong>Shared quota:</strong> All endpoints use the same <code>remaining</code> counter for your key within each 1-minute window.</p>
      <p><strong>When exceeded:</strong> ${esc(g.whenExceeded || "HTTP 429")}</p>
    </div>

    <div class="section">
      <h2>Per-endpoint reference (24 APIs)</h2>
      ${renderRateLimitByEndpointTable()}
    </div>`;
}

function renderErrors() {
  const codes = portalMeta.errorCodes || [];
  return `
    <h1 class="page-title">Error codes &amp; troubleshooting</h1>
    <p class="page-lead">Shipmozo returns HTTP 200 with <code>result: "0"</code> for business errors. Use <code>message</code> and <code>data.error</code> for details.</p>
    <p><a href="#/rate-limits">View all API rate limits →</a></p>

    <div class="section">
      <h2>Error reference</h2>
      <table class="error-table">
        <thead><tr><th>Code</th><th>result</th><th>Typical message</th><th>When</th><th>Action</th></tr></thead>
        <tbody>
          ${codes
            .map(
              (e) => `<tr>
              <td><code>${esc(e.code)}</code></td>
              <td>${esc(e.result)}</td>
              <td>${esc(e.typicalMessage)}</td>
              <td>${esc(e.when)}</td>
              <td>${esc(e.action)}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function renderBestPractices() {
  return `
    <h1 class="page-title">Best practices</h1>
    <div class="section">
      <ol>
        <li>Always check <code>result === "1"</code> before reading <code>data</code>.</li>
        <li>Use unique <code>order_id</code> values from your OMS — they are the join key across APIs.</li>
        <li>Call <code>pincode-serviceability</code> and <code>rate-calculator</code> before <code>push-order</code> at checkout.</li>
        <li>Store <code>awb_number</code> from assign / auto-assign for tracking and labels.</li>
        <li>If <code>pickups_automatically_scheduled</code> is <code>NO</code>, call <code>schedule-pickup</code> after assign.</li>
        <li>Implement exponential backoff on rate-limit and 5xx responses.</li>
        <li>Keep <code>private-key</code> on server-side only.</li>
      </ol>
    </div>`;
}

function renderEndpoint(item) {
  const { method, path, op } = item;
  const params = collectParams(op, path);
  const bodyExample = getRequestExample(op);
  const fullUrl = getApiBase() + path;
  const headers = { ...authHeaders(), "public-key": "YOUR_PUBLIC_KEY", "private-key": "YOUR_PRIVATE_KEY" };
  if (needsAuth(op) && !op.operationId?.includes("Login")) {
    delete headers["public-key"];
    Object.assign(headers, { "public-key": "YOUR_PUBLIC_KEY", "private-key": "YOUR_PRIVATE_KEY" });
  }
  if (op.operationId === "Login" || op.operationId === "getApiInfo") {
    delete headers["public-key"];
    delete headers["private-key"];
  }

  const successEx = getResponseExample(op, "200") || {
    result: "1",
    message: "Success",
    data: {},
  };
  const errorEx = { result: "0", message: "Error description", data: { error: "details" } };
  const useCases = op["x-useCases"] || [];
  const errorRefs = op["x-errors"] || [];
  const rateLine = formatRateLimitLine(op);
  const rl = op["x-rateLimit"];
  const rateNotes = typeof rl === "object" ? rl.notes : "";

  return `
    <article class="endpoint-header">
      <p class="tag-line">${esc(item.tag)}</p>
      <h1>${esc(op.summary || path)}</h1>
      <p class="lead-muted">${esc(op.description || "")}</p>

      <div class="endpoint-url">
        <span class="method-badge method-${method}">${method}</span>
        <code class="endpoint-path">${esc(path)}</code>
      </div>

      <div class="meta-pills">
        <span class="pill">Rate limit: ${esc(rateLine)}</span>
        ${needsAuth(op) ? `<span class="pill pill-auth">Requires API keys</span>` : `<span class="pill">No auth</span>`}
      </div>
      ${rateNotes ? `<p class="muted small">${esc(rateNotes)}</p>` : ""}

      <div class="url-box card" style="margin:16px 0">
        <label>${esc(getBackendLabel())} URL</label>
        <code>${esc(fullUrl)}</code>
      </div>

      ${
        useCases.length
          ? `<div class="section"><h2>Use cases</h2><ul>${useCases.map((u) => `<li>${esc(u)}</li>`).join("")}</ul></div>`
          : ""
      }

      <div class="section">
        <h2>Request</h2>
        <h3>Headers</h3>
        ${renderParamTable(
          params.filter((p) => p.in === "header").length
            ? params.filter((p) => p.in === "header")
            : needsAuth(op)
              ? [
                  { name: "public-key", in: "header", required: true, schema: { type: "string" }, description: "API public key" },
                  { name: "private-key", in: "header", required: true, schema: { type: "string" }, description: "API private key" },
                  { name: "Content-Type", in: "header", required: method !== "GET", schema: { type: "string" }, description: "application/json for POST bodies" },
                ]
              : [{ name: "Content-Type", in: "header", required: false, schema: { type: "string" }, description: "application/json when sending body" }]
        )}
        <h3>Path &amp; query</h3>
        ${renderParamTable(params.filter((p) => p.in === "path" || p.in === "query"))}
        ${
          bodyExample
            ? `<h3>Body example</h3>${renderCodeTabs(
                buildCurl(method, fullUrl, headers, bodyExample),
                buildNode(method, fullUrl, headers, bodyExample),
                buildPython(method, fullUrl, headers, bodyExample)
              )}`
            : ""
        }
      </div>

      <div class="section">
        <h2>Responses</h2>
        <h3><span class="status-pill status-2xx">result: 1</span> Success</h3>
        <div class="code-block-wrap"><pre><code>${esc(JSON.stringify(successEx, null, 2))}</code></pre></div>
        <h3><span class="status-pill status-4xx">result: 0</span> Failure</h3>
        <div class="code-block-wrap"><pre><code>${esc(JSON.stringify(errorEx, null, 2))}</code></pre></div>
        ${
          errorRefs.length
            ? `<p>Common errors: ${errorRefs.map((c) => `<a href="#/errors">${esc(c)}</a>`).join(", ")}</p>`
            : ""
        }
      </div>

      <p style="margin-top:24px"><a href="#/execute?op=${encodeURIComponent(item.id)}" class="btn-primary inline-btn">Test this API →</a></p>
    </article>`;
}

const JOURNEY_STORAGE = "shipmozo_portal_journey_v1";
const DEFAULT_TESTER_OPERATION_ID = "get-/info";

const TESTER_ENUM_OPTIONS = {
  payment_type: ["PREPAID", "COD"],
  shipment_type: ["FORWARD", "RETURN"],
  type_of_package: ["SPS", "B2B", "MPS"],
  rov_type: ["ROV_OWNER", "ROV_CARRIER"],
  order_type: ["ESSENTIALS", "NON ESSENTIALS"],
  shipment_purpose: ["SCSB4", "CSB5", "DSCB4"],
};

const TESTER_UNIT_FACTS = {
  "/push-order": "Weight is in grams. Dimensions (length, width, height) are in cm. Dates use YYYY-MM-DD.",
  "/rate-calculator": "Weight is in grams. Dimensions (length, width, height) are in cm.",
  "/push-return-order": "Weight is in kg. Dimensions (length, width, height) are in cm. Dates use YYYY-MM-DD.",
};

const TESTER_PREREQS = {
  "/push-order": {
    text: "You'll need: warehouse_id (from Get Warehouses).",
    opId: "get-/get-warehouses",
    label: "Get Warehouses",
  },
  "/push-return-order": {
    text: "You'll need: warehouse_id (from Get Warehouses) and return_reason_id (from Get Return Reason).",
    opId: "get-/get-warehouses",
    label: "Get Warehouses",
  },
  "/assign-courier": {
    text: "You'll need: courier_id (from Rate Calculator) and an existing order_id.",
    opId: "post-/rate-calculator",
    label: "Rate Calculator",
  },
  "/auto-assign-order": {
    text: "You'll need: an order created via Push Order first.",
    opId: "post-/push-order",
    label: "Push Order",
  },
  "/schedule-pickup": {
    text: "You'll need: an assigned shipment / AWB from Assign Courier.",
    opId: "post-/assign-courier",
    label: "Assign Courier",
  },
  "/get-order-label/{awb_number}": {
    text: "You'll need: awb_number from Assign Courier (or order detail).",
    opId: "post-/assign-courier",
    label: "Assign Courier",
  },
  "/track-order": {
    text: "You'll need: awb_number or order identifiers from a pushed/assigned shipment.",
    opId: "post-/push-order",
    label: "Push Order",
  },
  "/order/update-warehouse": {
    text: "You'll need: warehouse_id from Get Warehouses or Create Warehouse.",
    opId: "get-/get-warehouses",
    label: "Get Warehouses",
  },
};

const OPTGROUP_ORDER = [
  { key: "Orders", label: "Orders", tags: ["Orders"] },
  { key: "Tracking", label: "Tracking", tags: ["Track", "Label"] },
  { key: "Warehouse", label: "Warehouse", tags: ["Warehouse"] },
  { key: "Utility", label: "Utility", tags: ["Utility", "Common"] },
  { key: "Auth", label: "Auth", tags: [] },
];

function getJourney() {
  try {
    return JSON.parse(sessionStorage.getItem(JOURNEY_STORAGE) || "{}") || {};
  } catch {
    return {};
  }
}

function setJourney(patch) {
  const next = { ...getJourney(), ...patch };
  try {
    sessionStorage.setItem(JOURNEY_STORAGE, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

function syncJourneyFromAuth() {
  const c = getActiveCredentials();
  if (c.publicKey && c.privateKey) setJourney({ connected: true });
}

function updateJourneyFromCall(item, payload) {
  if (!item) return;
  setJourney({ tested: true });
  const ok = payload && (payload.result === "1" || payload.result === 1);
  if (!ok) return;
  if (["/get-warehouses", "/create-warehouse"].includes(item.path)) setJourney({ warehouseReady: true });
  if (item.path === "/push-order" || item.path === "/push-return-order") setJourney({ pushed: true });
  if (["/rate-calculator", "/international-rate-calculator"].includes(item.path)) setJourney({ rated: true });
  if (["/assign-courier", "/auto-assign-order"].includes(item.path)) setJourney({ courierAssigned: true });
  if (["/get-order-label/{awb_number}", "/generate-manifest"].includes(item.path)) setJourney({ labeled: true });
  if (["/track-order", "/cancel-order"].includes(item.path)) setJourney({ completed: true });
}

function renderJourneyStrip() {
  syncJourneyFromAuth();
  const j = getJourney();
  const steps = [
    { id: "connected", label: "Connect", done: !!j.connected },
    { id: "tested", label: "Test a call", done: !!j.tested },
    { id: "warehouseReady", label: "Create / Get warehouse", done: !!j.warehouseReady },
    { id: "pushed", label: "Push order", done: !!j.pushed },
    { id: "rated", label: "Rate calculator", done: !!j.rated },
    { id: "courierAssigned", label: "Assign courier", done: !!j.courierAssigned },
    { id: "labeled", label: "Label", done: !!j.labeled },
    { id: "completed", label: "Track or cancel", done: !!j.completed },
  ];
  let foundCurrent = false;
  const parts = [];
  steps.forEach((s, i) => {
    let cls = "journey-step";
    if (s.done) cls += " done";
    else if (!foundCurrent) {
      cls += " current";
      foundCurrent = true;
    }
    if (i > 0) parts.push(`<span class="journey-sep" aria-hidden="true">→</span>`);
    parts.push(
      `<span class="${cls}"><span class="journey-num">${s.done ? "✓" : i + 1}</span>${esc(s.label)}</span>`
    );
  });
  return `<nav class="journey-strip" aria-label="Integration progress">${parts.join("")}</nav>`;
}

function testerGroupForOp(o) {
  if (o.path === "/login") return "Auth";
  for (const g of OPTGROUP_ORDER) {
    if (g.tags.includes(o.tag)) return g.key;
  }
  return "Utility";
}

function renderTesterOpOptions(preselectId) {
  const preferredFirst = "post-/push-order";
  const groups = Object.fromEntries(OPTGROUP_ORDER.map((g) => [g.key, []]));
  operations.forEach((o) => {
    const g = testerGroupForOp(o);
    if (!groups[g]) groups[g] = [];
    groups[g].push(o);
  });
  if (groups.Orders?.length) {
    groups.Orders.sort((a, b) => {
      if (a.id === preferredFirst) return -1;
      if (b.id === preferredFirst) return 1;
      return a.path.localeCompare(b.path);
    });
  }
  return OPTGROUP_ORDER.map((g) => {
    const list = groups[g.key] || [];
    if (!list.length) return "";
    const opts = list
      .map(
        (o) =>
          `<option value="${o.id}" ${o.id === preselectId ? "selected" : ""}>${o.method} ${o.path} — ${esc(o.summary)}</option>`
      )
      .join("");
    return `<optgroup label="${esc(g.label)}">${opts}</optgroup>`;
  }).join("");
}

function renderTester(preselectId) {
  const opts = renderTesterOpOptions(preselectId);

  return `
    <div class="tester-layout">
      <h1 class="page-title">API Tester</h1>
      <p class="page-lead">Live requests go through this portal's proxy to <code>${getApiBase()}</code> (<strong>${esc(getBackendLabel())}</strong>). Connect API keys in the header — they are sent as <code>public-key</code> and <code>private-key</code> on every call.</p>
      ${renderJourneyStrip()}

      <div class="tester-grid">
        <div class="card tester-form" id="testerForm">
          <label for="testerOp">API endpoint</label>
          <select id="testerOp" aria-label="API endpoint">${opts}</select>
          <div id="testerPrereq" class="tester-prereq hidden"></div>
          <div id="testerParams"></div>
          <label for="testerBody">Request body (JSON)</label>
          <textarea id="testerBody" rows="12" placeholder="{}" aria-label="Request body (JSON)"></textarea>
          <div id="testerEnumHints" class="tester-enum-hints hidden"></div>
          <div class="tester-actions">
            <button type="button" class="btn-primary" id="testerRun">Execute API</button>
            <button type="button" class="btn-secondary" id="testerCurl">Copy cURL</button>
            <button type="button" class="btn-secondary" id="testerRateBtn">Check rate limit</button>
          </div>
          <p class="muted small" id="testerAuthHint"></p>
          <div class="rate-live-values small" id="testerRateLive">Rate limit: click Execute or Check rate limit</div>
        </div>
        <div class="card">
          <h2 class="tester-response-title">Response</h2>
          <div class="response-meta" id="testerMeta">Select an API and click Execute.</div>
          <div class="response-box"><pre id="testerOut">{}</pre></div>
        </div>
      </div>
    </div>`;
}

function bindTester(preselectId) {
  const opSelect = $("#testerOp");
  const paramsDiv = $("#testerParams");
  const bodyTa = $("#testerBody");
  const hint = $("#testerAuthHint");
  const prereqEl = $("#testerPrereq");
  const enumEl = $("#testerEnumHints");

  function currentOp() {
    return operations.find((o) => o.id === opSelect.value);
  }

  function updateEndpointHelpers() {
    const item = currentOp();
    if (!item) return;
    const prereq = TESTER_PREREQS[item.path];
    if (prereq && prereqEl) {
      prereqEl.classList.remove("hidden");
      prereqEl.innerHTML = `${esc(prereq.text)} <a href="#/execute?op=${encodeURIComponent(prereq.opId)}">Jump to ${esc(prereq.label)} →</a>`;
    } else if (prereqEl) {
      prereqEl.classList.add("hidden");
      prereqEl.innerHTML = "";
    }
    const enums = TESTER_ENUM_HINTS[item.path];
    if (enums?.length && enumEl) {
      enumEl.classList.remove("hidden");
      enumEl.innerHTML =
        `<strong>Allowed values:</strong> ` +
        enums.map((e) => `<code>${esc(e.field)}</code> → ${esc(e.values)}`).join(" · ");
    } else if (enumEl) {
      enumEl.classList.add("hidden");
      enumEl.innerHTML = "";
    }
  }

  function fillForm() {
    const item = currentOp();
    if (!item) return;
    paramsDiv.innerHTML = "";
    collectParams(item.op, item.path)
      .filter((p) => p.in === "path" || p.in === "query")
      .forEach((p) => {
        const lab = document.createElement("label");
        lab.textContent = `${p.name} (${p.in})${p.required ? " *" : ""}`;
        const inp = document.createElement("input");
        inp.dataset.param = p.name;
        inp.dataset.in = p.in;
        inp.placeholder = p.schema?.example || p.name;
        inp.setAttribute("aria-label", `${p.name} (${p.in})`);
        if (p.name === "awb_number") inp.value = "";
        if (p.name === "order_id") inp.value = "test123";
        paramsDiv.appendChild(lab);
        paramsDiv.appendChild(inp);
      });
    const ex = getRequestExample(item.op);
    bodyTa.value = ex ? JSON.stringify(ex, null, 2) : "";
    const hideBody = item.method === "GET";
    bodyTa.classList.toggle("hidden", hideBody);
    const bodyLabel = bodyTa.previousElementSibling;
    if (bodyLabel?.tagName === "LABEL") bodyLabel.classList.toggle("hidden", hideBody);

    const authRequired = needsAuth(item.op);
    const creds = getActiveCredentials();
    if (authRequired && !creds.publicKey) {
      hint.className = "hint-warn";
      hint.textContent = "Connect API keys (header button) or paste keys and click Save.";
    } else if (authRequired) {
      hint.className = "hint-ok";
      hint.textContent = "API keys will be sent as public-key and private-key headers.";
    } else {
      hint.className = "hint-ok";
      hint.textContent = "No API keys required for this endpoint.";
    }
    updateEndpointHelpers();
  }

  opSelect.addEventListener("change", () => {
    fillForm();
    const item = currentOp();
    if (item) history.replaceState(null, "", `#/execute?op=${encodeURIComponent(item.id)}`);
  });
  fillForm();
  if (preselectId) {
    opSelect.value = preselectId;
    fillForm();
  }

  function buildPathAndQuery() {
    const item = currentOp();
    let path = item.path;
    const qs = [];
    paramsDiv.querySelectorAll("input[data-param]").forEach((inp) => {
      if (inp.dataset.in === "path" && inp.value) path = path.replace(`{${inp.dataset.param}}`, encodeURIComponent(inp.value));
      if (inp.dataset.in === "query" && inp.value) qs.push(`${inp.dataset.param}=${encodeURIComponent(inp.value)}`);
    });
    if (qs.length) path += "?" + qs.join("&");
    return { item, path };
  }

  $("#testerRun").addEventListener("click", async () => {
    const { item, path } = buildPathAndQuery();
    const headers = { ...authHeaders() };
    let body;
    if (!["GET"].includes(item.method)) {
      try {
        body = bodyTa.value.trim() ? JSON.parse(bodyTa.value) : undefined;
      } catch {
        $("#testerOut").textContent = "Invalid JSON in request body";
        return;
      }
    }
    if (needsAuth(item.op) && !headers["public-key"]) {
      $("#testerMeta").textContent = "Missing credentials";
      $("#testerOut").textContent = 'Click "Connect API" in the header, paste keys, and Save.';
      $("#testerOut").parentElement?.classList.add("error");
      return;
    }
    $("#testerMeta").textContent = "Loading…";
    $("#testerOut").parentElement?.classList.remove("error");
    const runBtn = $("#testerRun");
    runBtn.disabled = true;
    try {
      const wrapped = await proxyRequest({
        method: item.method,
        path,
        headers,
        body,
      });
      let meta = `${wrapped.status} ${wrapped.statusText || ""} · ${wrapped.url || path}`.trim();
      if (wrapped.rateLimit?.limit) {
        meta += ` · Rate limit: ${wrapped.rateLimit.remaining ?? "?"}/${wrapped.rateLimit.limit} @ ${wrapped.rateLimit.observedAt || ""}`;
        const rlEl = $("#testerRateLive");
        if (rlEl) {
          rlEl.innerHTML = `Live headers: <strong>${esc(String(wrapped.rateLimit.remaining))}</strong> / ${esc(String(wrapped.rateLimit.limit))} remaining (this request)`;
        }
      }
      $("#testerMeta").textContent = meta;
      if (wrapped.error === "UPSTREAM_HTML") {
        $("#testerOut").parentElement?.classList.add("error");
        $("#testerOut").textContent = wrapped.message;
      } else {
        const payload = wrapped.data;
        updateJourneyFromCall(item, payload);
        const strip = document.querySelector(".journey-strip");
        if (strip) strip.outerHTML = renderJourneyStrip();
        const interpretation = interpretShipmozoResponse(payload);
        const pre = $("#testerOut");
        const bannerId = "testerResultBanner";
        let banner = document.getElementById(bannerId);
        if (interpretation) {
          if (!banner && pre?.parentElement) {
            banner = document.createElement("div");
            banner.id = bannerId;
            banner.setAttribute("role", "status");
            pre.parentElement.insertBefore(banner, pre);
          }
          if (banner) {
            banner.className = `result-banner ${interpretation.type}`;
            banner.innerHTML = `<strong>${esc(interpretation.title)}</strong><p>${esc(interpretation.text)}</p>`;
          }
          if (interpretation.type === "pending") syncAuthUI("pending");
        } else if (banner) {
          banner.remove();
        }
        const display = {
          rateLimit: wrapped.rateLimit,
          rateLimitHeaders: wrapped.rateLimitHeaders,
          shipmozo: payload,
        };
        pre.textContent = JSON.stringify(display, null, 2);
      }
    } catch (e) {
      $("#testerMeta").textContent = "Request failed";
      $("#testerOut").parentElement?.classList.add("error");
      $("#testerOut").textContent = String(e.message);
    } finally {
      runBtn.disabled = false;
    }
  });

  $("#testerRateBtn")?.addEventListener("click", async () => {
    const rlEl = $("#testerRateLive");
    if (rlEl) rlEl.textContent = "Checking…";
    try {
      const live = await fetchLiveRateLimit();
      const rl = live.rateLimit;
      if (rlEl && rl?.limit) {
        rlEl.innerHTML = `Live headers: <strong>${esc(String(rl.remaining))}</strong> / ${esc(String(rl.limit))} via <code>${esc(live.via)}</code> @ ${esc(rl.observedAt || "")}`;
      }
    } catch (e) {
      if (rlEl) rlEl.textContent = e.message;
    }
  });

  $("#testerCurl").addEventListener("click", () => {
    const { item, path } = buildPathAndQuery();
    const url = getApiBase() + path;
    const headers = { ...authHeaders() };
    let body;
    try {
      body = bodyTa.value.trim() ? JSON.parse(bodyTa.value) : undefined;
    } catch {
      return;
    }
    navigator.clipboard.writeText(buildCurl(item.method, url, headers, body));
    $("#testerCurl").textContent = "Copied!";
    setTimeout(() => ($("#testerCurl").textContent = "Copy cURL"), 1500);
  });
}

function resolveTesterOperationId(requestedId) {
  if (requestedId && operations.some((operation) => operation.id === requestedId)) return requestedId;
  if (operations.some((operation) => operation.id === DEFAULT_TESTER_OPERATION_ID)) return DEFAULT_TESTER_OPERATION_ID;
  return operations[0]?.id || "";
}

function getRequestBodySchema(op) {
  const schema = op.requestBody?.content?.["application/json"]?.schema;
  return schema?.$ref ? resolveRef(schema.$ref) : schema;
}

function getEnumFieldsForOperation(item) {
  const properties = getRequestBodySchema(item.op)?.properties || {};
  return Object.keys(TESTER_ENUM_OPTIONS).filter((field) => Object.hasOwn(properties, field));
}

function getTesterExampleText(item) {
  const example = getRequestExample(item.op);
  return example ? JSON.stringify(example, null, 2) : "";
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied`, "ok");
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
    toast(`${label} copied`, "ok");
  }
}

function renderPhase1Tester(preselectId) {
  const selectedId = resolveTesterOperationId(preselectId);
  const opts = renderTesterOpOptions(selectedId);

  return `
    <div class="tester-layout">
      <h1 class="page-title">API Tester</h1>
      <p class="page-lead">Requests go through this portal's proxy to <code>${getApiBase()}</code> (<strong>${esc(getBackendLabel())}</strong>). The response body below is the exact Shipmozo API body.</p>
      <div class="tester-safety-note"><strong>Dev requests run against a live sandbox:</strong> pushing an order creates a real order and AWB on your account. Cancel test orders when you're done. Dev and Live use separate keys.</div>
      ${renderJourneyStrip()}

      <div class="tester-grid">
        <div class="card tester-form" id="testerForm">
          <label for="testerOp">API endpoint</label>
          <select id="testerOp" aria-label="API endpoint">${opts}</select>
          <div id="testerPrereq" class="tester-prereq hidden"></div>
          <div id="testerUnitFacts" class="tester-unit-facts hidden"></div>
          <div id="testerParams"></div>
          <label for="testerBody">Request body (JSON)</label>
          <textarea id="testerBody" rows="12" placeholder="{}" aria-label="Request body (JSON)"></textarea>
          <div id="testerEnumControls" class="tester-enum-controls hidden"></div>
          <div class="tester-actions">
            <button type="button" class="btn-primary" id="testerRun">Execute API</button>
            <button type="button" class="btn-secondary" id="testerCurl">Copy cURL</button>
            <button type="button" class="btn-secondary" id="testerCopyRequest">Copy request</button>
            <button type="button" class="btn-secondary" id="testerReset">Reset example</button>
            <button type="button" class="btn-secondary" id="testerRateBtn">Check rate limit</button>
          </div>
          <p class="muted small" id="testerAuthHint"></p>
          <div class="rate-live-values small" id="testerRateLive">Rate limit: click Execute or Check rate limit</div>
        </div>
        <div class="card tester-response-card">
          <div class="tester-response-head">
            <h2 class="tester-response-title">Response</h2>
            <button type="button" class="btn-secondary btn-sm" id="testerCopyResponse">Copy response</button>
          </div>
          <div class="response-meta" id="testerMeta">Select an API and click Execute.</div>
          <div class="result-banner hidden" id="testerResultBanner" role="status"></div>
          <div class="response-tabs" role="tablist" aria-label="Response views">
            <button type="button" class="response-tab active" role="tab" aria-selected="true" data-response-tab="body">Response Body</button>
            <button type="button" class="response-tab" role="tab" aria-selected="false" data-response-tab="headers">Response Headers</button>
            <button type="button" class="response-tab" role="tab" aria-selected="false" data-response-tab="debug">Debug</button>
          </div>
          <div class="response-panel" data-response-panel="body">
            <div class="response-box"><pre id="testerOut">{}</pre></div>
            <div class="label-preview hidden" id="testerLabelPreview"></div>
          </div>
          <div class="response-panel hidden" data-response-panel="headers">
            <div class="response-box"><pre id="testerHeadersOut">{}</pre></div>
          </div>
          <div class="response-panel hidden" data-response-panel="debug">
            <div class="response-box"><pre id="testerDebugOut">{}</pre></div>
          </div>
        </div>
      </div>
    </div>`;
}

function bindPhase1Tester(preselectId) {
  const opSelect = $("#testerOp");
  const paramsDiv = $("#testerParams");
  const bodyTa = $("#testerBody");
  const hint = $("#testerAuthHint");
  const prereqEl = $("#testerPrereq");
  const unitFactsEl = $("#testerUnitFacts");
  const enumControlsEl = $("#testerEnumControls");
  const bodyLabel = document.querySelector('label[for="testerBody"]');
  let latestResponseBody = {};

  function currentOp() {
    return operations.find((operation) => operation.id === opSelect.value);
  }

  function getBodyObject() {
    const raw = bodyTa.value.trim();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getQueryObject() {
    return Object.fromEntries(
      [...paramsDiv.querySelectorAll('input[data-in="query"]')]
        .filter((input) => input.value)
        .map((input) => [input.dataset.param, input.value])
    );
  }

  function setResponseTab(tabName) {
    document.querySelectorAll("[data-response-tab]").forEach((tab) => {
      const active = tab.dataset.responseTab === tabName;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-response-panel]").forEach((panel) => {
      panel.classList.toggle("hidden", panel.dataset.responsePanel !== tabName);
    });
  }

  function updateResultBanner(payload) {
    const banner = $("#testerResultBanner");
    const interpretation = interpretShipmozoResponse(payload);
    if (!banner || !interpretation) {
      banner?.classList.add("hidden");
      return;
    }
    banner.className = `result-banner ${interpretation.type}`;
    banner.innerHTML = `<strong>${esc(interpretation.title)}</strong><p>${esc(interpretation.text)}</p>`;
  }

  function renderLabelPreview(payload) {
    const host = $("#testerLabelPreview");
    if (!host) return;
    const entries = Array.isArray(payload?.data) ? payload.data : [payload?.data];
    const rawLabel = entries.find((entry) => typeof entry?.label === "string")?.label;
    if (!rawLabel) {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
    const source = rawLabel.startsWith("data:")
      ? rawLabel
      : `data:image/png;base64,${rawLabel.replace(/\s/g, "")}`;
    host.classList.remove("hidden");
    host.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = "Shipping label preview";
    const image = document.createElement("img");
    image.src = source;
    image.alt = "Shipping label returned by Shipmozo";
    const download = document.createElement("a");
    download.href = source;
    download.download = "shipmozo-label.png";
    download.className = "btn-secondary btn-sm";
    download.textContent = "Download label";
    host.append(heading, image, download);
  }

  function renderResponse(payload, wrapped, durationMs) {
    latestResponseBody = payload ?? {};
    $("#testerOut").textContent = JSON.stringify(latestResponseBody, null, 2);
    $("#testerHeadersOut").textContent = JSON.stringify(wrapped.rateLimitHeaders || {}, null, 2);
    $("#testerDebugOut").textContent = JSON.stringify(
      {
        httpStatus: wrapped.status ?? 200,
        requestDurationMs: Math.round(durationMs),
        rateLimit: wrapped.rateLimit || {},
      },
      null,
      2
    );
    updateResultBanner(payload);
    renderLabelPreview(payload);
    setResponseTab("body");
  }

  function syncEnumControlsFromBody() {
    const body = getBodyObject();
    if (!body) return;
    enumControlsEl.querySelectorAll("select[data-enum-field]").forEach((select) => {
      const value = body[select.dataset.enumField];
      if (value && [...select.options].some((option) => option.value === String(value))) {
        select.value = String(value);
      }
    });
  }

  function renderEnumControls(item) {
    const fields = getEnumFieldsForOperation(item);
    if (!fields.length) {
      enumControlsEl.classList.add("hidden");
      enumControlsEl.innerHTML = "";
      return;
    }
    const body = getBodyObject() || {};
    enumControlsEl.classList.remove("hidden");
    enumControlsEl.innerHTML = `
      <p class="tester-enum-title">Guided values <span>Selections update the JSON request body.</span></p>
      <div class="tester-enum-grid">
        ${fields
          .map(
            (field) => `<label for="enum-${field}">${esc(field.replaceAll("_", " "))}</label>
              <select id="enum-${field}" data-enum-field="${field}" aria-label="${esc(field)}">
                ${TESTER_ENUM_OPTIONS[field]
                  .map((value) => `<option value="${esc(value)}" ${body[field] === value ? "selected" : ""}>${esc(value)}</option>`)
                  .join("")}
              </select>`
          )
          .join("")}
      </div>`;
    enumControlsEl.querySelectorAll("select[data-enum-field]").forEach((select) => {
      select.addEventListener("change", () => {
        const updatedBody = getBodyObject();
        if (!updatedBody) {
          toast("Fix the JSON request body before using guided values.", "error");
          syncEnumControlsFromBody();
          return;
        }
        updatedBody[select.dataset.enumField] = select.value;
        bodyTa.value = JSON.stringify(updatedBody, null, 2);
      });
    });
  }

  function updateEndpointHelpers(item) {
    const prereq = TESTER_PREREQS[item.path];
    if (prereq) {
      prereqEl.classList.remove("hidden");
      prereqEl.innerHTML = `${esc(prereq.text)} <a href="#/execute?op=${encodeURIComponent(prereq.opId)}">Jump to ${esc(prereq.label)} →</a>`;
    } else {
      prereqEl.classList.add("hidden");
      prereqEl.innerHTML = "";
    }
    const facts = TESTER_UNIT_FACTS[item.path];
    unitFactsEl.classList.toggle("hidden", !facts);
    unitFactsEl.textContent = facts || "";
    renderEnumControls(item);
  }

  function fillForm() {
    const item = currentOp();
    if (!item) return;
    paramsDiv.innerHTML = "";
    collectParams(item.op, item.path)
      .filter((parameter) => parameter.in === "path" || parameter.in === "query")
      .forEach((parameter) => {
        const label = document.createElement("label");
        label.textContent = `${parameter.name} (${parameter.in})${parameter.required ? " *" : ""}`;
        const input = document.createElement("input");
        input.dataset.param = parameter.name;
        input.dataset.in = parameter.in;
        input.placeholder = parameter.schema?.example || parameter.name;
        input.setAttribute("aria-label", `${parameter.name} (${parameter.in})`);
        paramsDiv.append(label, input);
      });

    bodyTa.value = getTesterExampleText(item);
    const hideBody = item.method === "GET";
    bodyTa.classList.toggle("hidden", hideBody);
    bodyLabel?.classList.toggle("hidden", hideBody);

    const authRequired = needsAuth(item.op);
    const credentials = getActiveCredentials();
    if (authRequired && !credentials.publicKey) {
      hint.className = "hint-warn";
      hint.textContent = "Connect API keys (header button) or paste keys and click Save.";
    } else if (authRequired) {
      hint.className = "hint-ok";
      hint.textContent = "API keys will be sent as public-key and private-key headers.";
    } else {
      hint.className = "hint-ok";
      hint.textContent = "No API keys required for this endpoint.";
    }
    updateEndpointHelpers(item);
  }

  function buildPathAndQuery() {
    const item = currentOp();
    let path = item.path;
    const query = [];
    paramsDiv.querySelectorAll("input[data-param]").forEach((input) => {
      if (input.dataset.in === "path" && input.value) path = path.replace(`{${input.dataset.param}}`, encodeURIComponent(input.value));
      if (input.dataset.in === "query" && input.value) query.push(`${input.dataset.param}=${encodeURIComponent(input.value)}`);
    });
    if (query.length) path += `?${query.join("&")}`;
    return { item, path };
  }

  document.querySelectorAll("[data-response-tab]").forEach((tab) => {
    tab.addEventListener("click", () => setResponseTab(tab.dataset.responseTab));
  });
  bodyTa.addEventListener("input", syncEnumControlsFromBody);
  opSelect.value = resolveTesterOperationId(preselectId);
  fillForm();

  opSelect.addEventListener("change", () => {
    fillForm();
    const item = currentOp();
    if (item) history.replaceState(null, "", `#/execute?op=${encodeURIComponent(item.id)}`);
  });

  $("#testerRun").addEventListener("click", async () => {
    const { item, path } = buildPathAndQuery();
    const headers = { ...authHeaders() };
    let body;
    if (item.method !== "GET") {
      body = getBodyObject();
      if (!body) {
        $("#testerMeta").textContent = "Invalid JSON in request body";
        return;
      }
    }
    if (needsAuth(item.op) && !headers["public-key"]) {
      $("#testerMeta").textContent = "Missing credentials";
      renderResponse(
        { result: "0", message: "Missing credentials", data: { error: 'Click "Connect API" in the header, paste keys, and Save.' } },
        {},
        0
      );
      return;
    }

    $("#testerMeta").textContent = "Loading…";
    const runBtn = $("#testerRun");
    runBtn.disabled = true;
    const startedAt = performance.now();
    try {
      const wrapped = await proxyRequest({ method: item.method, path, headers, body });
      const durationMs = performance.now() - startedAt;
      $("#testerMeta").textContent = `${item.method} ${path} · ${Math.round(durationMs)} ms`;
      renderResponse(wrapped.data, wrapped, durationMs);
      updateJourneyFromCall(item, wrapped.data);
      const strip = document.querySelector(".journey-strip");
      if (strip) strip.outerHTML = renderJourneyStrip();
      if (wrapped.rateLimit?.limit) {
        $("#testerRateLive").innerHTML = `Live headers: <strong>${esc(String(wrapped.rateLimit.remaining))}</strong> / ${esc(String(wrapped.rateLimit.limit))} remaining (this request)`;
      }
    } catch (error) {
      const durationMs = performance.now() - startedAt;
      $("#testerMeta").textContent = `Request failed · ${Math.round(durationMs)} ms`;
      renderResponse({ result: "0", message: error.message, data: { error: error.message } }, {}, durationMs);
    } finally {
      runBtn.disabled = false;
    }
  });

  $("#testerCopyRequest").addEventListener("click", () => {
    const item = currentOp();
    const value = item.method === "GET" ? JSON.stringify(getQueryObject(), null, 2) : bodyTa.value || "{}";
    copyText(value, "Request");
  });

  $("#testerCopyResponse").addEventListener("click", () => {
    copyText(JSON.stringify(latestResponseBody, null, 2), "Response");
  });

  $("#testerReset").addEventListener("click", () => {
    bodyTa.value = getTesterExampleText(currentOp());
    syncEnumControlsFromBody();
    toast("Example restored", "ok");
  });

  $("#testerCurl").addEventListener("click", () => {
    const { item, path } = buildPathAndQuery();
    const body = item.method === "GET" ? undefined : getBodyObject();
    if (item.method !== "GET" && !body) {
      toast("Fix the JSON request body before copying cURL.", "error");
      return;
    }
    copyText(buildCurl(item.method, getApiBase() + path, authHeaders(), body), "cURL");
  });

  $("#testerRateBtn")?.addEventListener("click", async () => {
    const rateLimitOutput = $("#testerRateLive");
    rateLimitOutput.textContent = "Checking…";
    try {
      const live = await fetchLiveRateLimit();
      const rateLimit = live.rateLimit;
      if (rateLimit?.limit) {
        rateLimitOutput.innerHTML = `Live headers: <strong>${esc(String(rateLimit.remaining))}</strong> / ${esc(String(rateLimit.limit))} via <code>${esc(live.via)}</code> @ ${esc(rateLimit.observedAt || "")}`;
      } else {
        rateLimitOutput.textContent = "No rate-limit headers returned.";
      }
    } catch (error) {
      rateLimitOutput.textContent = error.message;
    }
  });
}

function buildSidebar(filter = "") {
  const nav = $("#sidebarNav");
  const q = filter.toLowerCase();
  const staticGroups = [
    {
      title: "Getting started",
      links: [
        { href: "#/", label: "Overview" },
        { href: "#/auth", label: "Authentication" },
        { href: "#/workflows", label: "Integration flows" },
        { href: "#/rate-limits", label: "Rate limits" },
        { href: "#/errors", label: "Error codes" },
        { href: "#/best-practices", label: "Best practices" },
      ],
    },
  ];

  const byTag = {};
  operations.forEach((o) => {
    if (q && !`${o.method} ${o.path} ${o.summary}`.toLowerCase().includes(q)) return;
    if (!byTag[o.tag]) byTag[o.tag] = [];
    byTag[o.tag].push(o);
  });

  let html = "";
  staticGroups.forEach((g) => {
    html += `<div class="nav-group"><div class="nav-group-title">${g.title}</div>`;
    g.links.forEach((l) => {
      html += `<a class="nav-link" href="${l.href}">${esc(l.label)}</a>`;
    });
    html += `</div>`;
  });

  html += `<div class="nav-group"><div class="nav-group-title">Tools</div><a class="nav-link" href="#/execute">API Tester</a></div>`;

  const tagOrder = ["Common", "Warehouse", "Orders", "Track", "Label", "Utility"];
  const tags = [...new Set([...tagOrder, ...Object.keys(byTag)])];
  tags.forEach((tag) => {
    if (!byTag[tag]?.length) return;
    html += `<div class="nav-group"><div class="nav-group-title">${esc(tag)}</div>`;
    const items = [...byTag[tag]];
    if (tag === "Orders") {
      const rateCalculator = operations.find((operation) => operation.path === "/rate-calculator");
      const rateCalculatorMatchesFilter =
        !q || `${rateCalculator?.method} ${rateCalculator?.path} ${rateCalculator?.summary}`.toLowerCase().includes(q);
      const assignCourierIndex = items.findIndex((operation) => operation.path === "/assign-courier");
      if (rateCalculator && rateCalculatorMatchesFilter && assignCourierIndex >= 0) {
        items.splice(assignCourierIndex, 0, rateCalculator);
      }
    }
    items.forEach((o) => {
      html += `<a class="nav-link" href="#/api/${o.id}"><span class="method method-${o.method}">${o.method}</span>${esc(o.summary)}</a>`;
    });
    html += `</div>`;
  });

  nav.innerHTML = html;
}

function setActiveNav() {
  const hash = location.hash || "#/";
  const h = hash.split("?")[0];
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === h);
  });
  document.querySelectorAll(".topnav-link").forEach((a) => {
    const nav = a.dataset.nav;
    a.classList.toggle(
      "active",
      (nav === "execute" && h === "#/execute") ||
        (nav === "workflows" && h === "#/workflows") ||
        (nav === "errors" && h === "#/errors") ||
        (nav === "rate-limits" && h === "#/rate-limits") ||
        (nav === "docs" && !["#/execute", "#/workflows", "#/errors", "#/rate-limits"].includes(h))
    );
  });
}

async function route() {
  const main = $("#main");
  const hash = location.hash || "#/";
  const searchInput = $("#searchInput");
  if (searchInput?.value) {
    searchInput.value = "";
    buildSidebar();
  }
  setActiveNav();

  if (hash.startsWith("#/execute")) {
    const op = new URLSearchParams(hash.split("?")[1] || "").get("op");
    main.innerHTML = renderPhase1Tester(op);
    bindPhase1Tester(op);
    return;
  }
  if (hash === "#/" || hash === "#") {
    main.innerHTML = renderStaticIntro();
    bindCodeTabs(main);
    $("#heroConnectBtn")?.addEventListener("click", openAuthDialog);
    return;
  }
  if (hash === "#/auth") {
    main.innerHTML = renderAuthPage();
    bindCodeTabs(main);
    return;
  }
  if (hash === "#/workflows") {
    main.innerHTML = renderWorkflows();
    return;
  }
  if (hash === "#/rate-limits") {
    main.innerHTML = renderRateLimitsPage();
    bindLiveRateLimit(main);
    return;
  }
  if (hash === "#/errors") {
    main.innerHTML = renderErrors();
    return;
  }
  if (hash === "#/best-practices") {
    main.innerHTML = renderBestPractices();
    return;
  }

  const apiMatch = hash.match(/^#\/api\/(.+)$/);
  if (apiMatch) {
    const item = operations.find((o) => o.id === apiMatch[1]);
    if (item) {
      main.innerHTML = renderEndpoint(item);
      bindCodeTabs(main);
      return;
    }
  }

  main.innerHTML = renderStaticIntro();
  bindCodeTabs(main);
}

function setModalOpen(open) {
  document.body.classList.toggle("modal-open", !!open);
  if (open) document.body.style.overflow = "hidden";
  else document.body.style.overflow = "";
}

function openAuthDialog() {
  const dlg = $("#authDialog");
  if (!dlg) return;
  setModalOpen(true);
  if (dlg.showModal) dlg.showModal();
  else dlg.setAttribute("open", "");
}

function closeAuthDialog() {
  const dlg = $("#authDialog");
  dlg?.close?.();
  dlg?.removeAttribute("open");
  setModalOpen(false);
}

function bindAuthDialog() {
  $("#openAuthBtn")?.addEventListener("click", openAuthDialog);
  $("#closeAuthBtn")?.addEventListener("click", closeAuthDialog);

  const dlg = $("#authDialog");
  dlg?.addEventListener("close", () => setModalOpen(false));
  dlg?.addEventListener("cancel", () => setModalOpen(false));

  $("#authLoginBtn")?.addEventListener("click", async () => {
    const u = $("#authUsername").value.trim();
    const p = $("#authPassword").value;
    const msg = $("#authLoginMsg");
    if (!u || !p) {
      msg.className = "auth-login-msg error";
      msg.textContent = "Enter username and password.";
      return;
    }
    $("#authLoginBtn").disabled = true;
    msg.textContent = "Signing in…";
    msg.className = "auth-login-msg";
    try {
      await loginWithPassword(u, p);
      setJourney({ connected: true });
      msg.className = "auth-login-msg ok";
      msg.textContent = "Keys saved. You can close this dialog.";
      toast("API keys connected", "ok");
      closeAuthDialog();
    } catch (e) {
      msg.className = "auth-login-msg error";
      msg.textContent = e.message;
    } finally {
      $("#authLoginBtn").disabled = false;
    }
  });

  $("#authSaveKeysBtn")?.addEventListener("click", async () => {
    const c = getActiveCredentials();
    const msg = $("#authLoginMsg");
    if (!c.publicKey || !c.privateKey) {
      toast("Enter both public-key and private-key", "error");
      return;
    }
    credentials.publicKey = c.publicKey;
    credentials.privateKey = c.privateKey;
    saveCredentials();
    setJourney({ connected: true });
    msg.className = "auth-login-msg";
    msg.textContent = "Checking account with Shipmozo…";
    const accountState = await probeAccountStatus();
    syncAuthUI(accountState === "verified" ? "verified" : accountState === "pending" ? "pending" : undefined);
    if (accountState === "pending") {
      msg.className = "auth-login-msg error";
      msg.textContent =
        "Keys are saved and valid, but your Shipmozo profile is still under verification. Complete KYC in the panel — APIs will return result 0 until approved.";
      toast("Keys saved — account pending verification", "error");
    } else if (accountState === "verified") {
      msg.className = "auth-login-msg ok";
      msg.textContent = "Keys saved. Account is active.";
      toast("Keys saved — account ready", "ok");
      closeAuthDialog();
    } else {
      msg.className = "auth-login-msg ok";
      msg.textContent = "Keys saved locally.";
      toast("API keys saved", "ok");
      closeAuthDialog();
    }
  });

  $("#authClearBtn")?.addEventListener("click", () => {
    clearCredentials();
    $("#authUsername").value = "";
    $("#authPassword").value = "";
    $("#authLoginMsg").textContent = "";
    toast("Disconnected", "info");
  });
}

async function checkProxyAvailable() {
  try {
    const { data } = await fetchJson("/health");
    return data?.proxy === true;
  } catch {
    return false;
  }
}

function showProxyWarning() {
  const main = $("#main");
  if (!main || document.getElementById("proxyWarn")) return;
  const banner = document.createElement("div");
  banner.id = "proxyWarn";
  banner.className = "note warn";
  banner.style.marginBottom = "20px";
  banner.innerHTML = `<strong>API Tester offline.</strong> Docs work, but live API calls need the Node server. In terminal: <code>cd logistics-api</code> then <code>npm start</code> (stop Live Server / other app on port 3000 first).`;
  main.prepend(banner);
}

async function init() {
  loadBackend();
  loadCredentials();
  syncBackendUI();
  bindAuthDialog();
  bindBackendSwitch();
  try {
    await loadSpec();
    $("#loading")?.remove();
    buildSidebar();
    $("#searchInput").addEventListener("input", (e) => buildSidebar(e.target.value));
    window.addEventListener("hashchange", route);
    route();
    const proxyOk = await checkProxyAvailable();
    if (!proxyOk) showProxyWarning();
  } catch (e) {
    $("#main").innerHTML = `<p class="error-text">Failed to load API spec: ${esc(e.message)}</p>
      <p class="muted" style="padding:0 24px">Run <code>npm run build:spec</code> then <code>npm start</code> from the logistics-api folder. Hard-refresh (Ctrl+Shift+R).</p>`;
  }
}

init();
