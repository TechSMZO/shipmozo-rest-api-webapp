import {
  renderModeToggle,
  getSavedTesterMode,
  saveTesterMode,
  renderWorkflowPanel,
  bindWorkflowPanel,
  loadWorkflowContext,
  loadLifecycleScenarioId,
  getLifecycleWorkflow,
} from "./workflow-tester.js?v=42";
import { loadFieldContracts, renderFieldContract } from "./field-contract-renderer.js?v=34";
import { renderDemoPage, bindDemoPage } from "./demo-player.js?v=34";

const API_BACKENDS = {
  dev: { label: "Shipmozo API", baseUrl: "https://appiify.com/app/api/v1" },
  live: { label: "Shipmozo API", baseUrl: "https://shipping-api.com/app/api/v1" },
};
const AUTH_STORAGE = "shipmozo_api_keys";
const AUTH_CONNECTED_STORAGE = "shipmozo_api_connected";
const SIDEBAR_STORAGE = "shipmozo_sidebar_collapsed";
/** Static file works even when a generic static server is used; /api/spec.json needs node server.js */
const POSTMAN_ASSETS = {
  collection: "/assets/shipmozo.postman_collection.json",
  environment: "/assets/shipmozo.postman_environment.live.json",
};

/** Silent internal path: /dev uses the Dev API host. No Dig/Live switch in the UI. */
function isDevPortalPath() {
  const p = (location.pathname || "/").replace(/\/+$/, "") || "/";
  return p === "/dev" || p.startsWith("/dev/");
}

function getPortalPrefix() {
  return isDevPortalPath() ? "/dev" : "";
}

function getSpecUrls() {
  const prefix = getPortalPrefix();
  return [`${prefix}/assets/spec.json`, `${prefix}/api/spec.json`, "/assets/spec.json", "/api/spec.json"];
}

function portalUrl(path) {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${getPortalPrefix()}${path}`;
}

/** Mistaken hash Dig URL (/#/dev) → real pathname Dig portal (/dev/#/). */
function redirectMistakenDevHash() {
  if (isDevPortalPath()) return false;
  const raw = location.hash || "";
  const pathPart = raw.split("?")[0];
  if (pathPart !== "#/dev" && !pathPart.startsWith("#/dev/")) return false;
  const rest = pathPart === "#/dev" ? "#/" : `#/${pathPart.slice("#/dev/".length)}`;
  const qs = raw.includes("?") ? `?${raw.split("?")[1]}` : "";
  location.replace(`/dev/${rest}${qs}`);
  return true;
}

function currentPostmanEnvAsset() {
  return isDevPortalPath()
    ? "/assets/shipmozo.postman_environment.dev.json"
    : POSTMAN_ASSETS.environment;
}

/** Active-env badge / toast label (Dig shows Dev connected). */
function getConnectedLabel(pending = false) {
  if (isDevPortalPath()) return pending ? "Dev connected · Pending" : "Dev connected";
  return pending ? "Connected · Pending" : "Connected";
}

/** Sync path-derived Dig/live mode and active credential slot. */
function applyPortalMode() {
  backendEnv = isDevPortalPath() ? "dev" : "live";
  applyActiveCredentials();
  syncAuthUI();
  syncJourneyFromAuth();
}

function currentPostmanEnvDownloadName() {
  return "shipmozo.postman_environment.json";
}

function renderPostmanActions(compact = false) {
  if (compact) {
    return `
      <a href="${esc(POSTMAN_ASSETS.collection)}" download="shipmozo.postman_collection.json" class="btn-secondary postman-btn">Postman collection</a>
      <a href="${esc(currentPostmanEnvAsset())}" download="${esc(currentPostmanEnvDownloadName())}" class="btn-secondary postman-btn" title="Download Postman environment">Postman environment</a>`;
  }
  return `
    <div class="section postman-section">
      <h2>Postman</h2>
      <p class="page-lead">Download the Shipmozo API collection and environment, then import in Postman: <strong>Import → Upload Files</strong>.</p>
      <div class="hero-actions postman-actions">
        <a href="${esc(POSTMAN_ASSETS.collection)}" download="shipmozo.postman_collection.json" class="btn-primary postman-btn">Download collection</a>
        <a href="${esc(currentPostmanEnvAsset())}" download="${esc(currentPostmanEnvDownloadName())}" class="btn-secondary">Download environment</a>
      </div>
      <div class="note" style="margin-top:12px">
        <strong>Setup:</strong> Import both files in Postman, select the Shipmozo environment, set <code>public-key</code> and <code>private-key</code>, then send requests.
      </div>
    </div>`;
}

let spec = null;
let portalMeta = null;
let operations = [];
let fieldContracts = null;
let fieldHints = null;
let scenarios = null;
let credentialsByEnv = {
  dev: { publicKey: "", privateKey: "" },
  live: { publicKey: "", privateKey: "" },
};
/** Per-env: true = use saved keys on requests; false = keys may exist but do not send until Connect. */
let connectedByEnv = { dev: false, live: false };
/** Path-derived only — / is live, /dev is silent Dev API. No UI switch. */
let backendEnv = isDevPortalPath() ? "dev" : "live";
let credentials = credentialsByEnv[backendEnv];

function getApiBase() {
  return API_BACKENDS[backendEnv]?.baseUrl || API_BACKENDS.live.baseUrl;
}

function getBackendLabel() {
  return "Shipmozo API";
}

function getEnvShortLabel(_env = backendEnv) {
  return "";
}

function hasKeysFor(env = backendEnv) {
  const c = credentialsByEnv[env] || {};
  return !!(c.publicKey && c.privateKey);
}

function isEnvConnected(env = backendEnv) {
  return !!connectedByEnv[env] && hasKeysFor(env);
}

function persistConnectedFlags() {
  try {
    localStorage.setItem(AUTH_CONNECTED_STORAGE, JSON.stringify(connectedByEnv));
  } catch {
    /* ignore */
  }
}

function setEnvConnected(env, connected) {
  if (env !== "dev" && env !== "live") return;
  connectedByEnv[env] = !!connected;
  persistConnectedFlags();
}

function loadConnectedFlags() {
  try {
    const raw = localStorage.getItem(AUTH_CONNECTED_STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw);
      connectedByEnv = {
        dev: !!parsed.dev,
        live: !!parsed.live,
      };
      return;
    }
  } catch {
    /* fall through to migrate */
  }
  // First load after this feature: if keys exist, treat as connected.
  connectedByEnv = {
    dev: hasKeysFor("dev"),
    live: hasKeysFor("live"),
  };
  persistConnectedFlags();
}

function renderSandboxWarningNote() {
  return `<div class="note warn"><strong>Real API:</strong> Requests hit <code>${esc(getApiBase())}</code>. Pushing an order creates a real order and AWB on your account — cancel test orders when you are done.</div>`;
}

function sameKeyPair(a, b) {
  return !!(
    a?.publicKey &&
    a?.privateKey &&
    b?.publicKey &&
    b?.privateKey &&
    a.publicKey === b.publicKey &&
    a.privateKey === b.privateKey
  );
}

/** Legacy storage may have mirrored one key pair into both slots — keep the active path's keys. */
function scrubMirroredLiveKeys() {
  if (!sameKeyPair(credentialsByEnv.dev, credentialsByEnv.live)) return false;
  const other = backendEnv === "live" ? "dev" : "live";
  credentialsByEnv[other] = { publicKey: "", privateKey: "" };
  connectedByEnv[other] = false;
  try {
    localStorage.setItem(AUTH_STORAGE, JSON.stringify(credentialsByEnv));
  } catch {
    /* ignore */
  }
  persistConnectedFlags();
  return true;
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
  const pubInput = $("#authPublicKey")?.value?.trim();
  const privInput = $("#authPrivateKey")?.value?.trim();
  return {
    publicKey: pubInput || credentials.publicKey,
    privateKey: privInput || credentials.privateKey,
  };
}

async function proxyRequest({ method, path, headers = {}, body }) {
  const { res, data } = await fetchJson(portalUrl("/api/proxy"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, path, headers, body }),
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
        <h3>Rate limit</h3>
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
  let migratedFromSession = false;
  try {
    let raw = localStorage.getItem(AUTH_STORAGE);
    if (!raw) {
      try {
        raw = sessionStorage.getItem(AUTH_STORAGE);
        if (raw) migratedFromSession = true;
      } catch {
        /* ignore */
      }
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.dev || parsed.live) {
        if (parsed.dev) credentialsByEnv.dev = { ...credentialsByEnv.dev, ...parsed.dev };
        if (parsed.live) credentialsByEnv.live = { ...credentialsByEnv.live, ...parsed.live };
      } else if (parsed.publicKey !== undefined || parsed.privateKey !== undefined) {
        // Flat legacy blob — keep under the silent /dev slot; public / uses live.
        credentialsByEnv.live = {
          publicKey: parsed.publicKey || "",
          privateKey: parsed.privateKey || "",
        };
        credentialsByEnv.dev = { publicKey: "", privateKey: "" };
      }
      if (migratedFromSession || (!parsed.dev && !parsed.live && (parsed.publicKey || parsed.privateKey))) {
        try {
          localStorage.setItem(AUTH_STORAGE, JSON.stringify(credentialsByEnv));
          if (migratedFromSession) sessionStorage.removeItem(AUTH_STORAGE);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    credentialsByEnv = {
      dev: { publicKey: "", privateKey: "" },
      live: { publicKey: "", privateKey: "" },
    };
  }
  applyActiveCredentials();
  loadConnectedFlags();
  scrubMirroredLiveKeys();
  applyActiveCredentials();
  syncAuthUI();
}

function saveCredentials() {
  persistCredentialsToStore();
  setEnvConnected(backendEnv, hasKeysFor(backendEnv));
  syncAuthUI();
}

/** Disconnect current env: stop using keys for requests, but keep them saved. */
function disconnectCurrentEnv() {
  setEnvConnected(backendEnv, false);
  syncAuthUI();
}

/** Reconnect current env using keys already saved in the browser. */
function connectCurrentEnv() {
  if (!hasKeysFor(backendEnv)) return false;
  setEnvConnected(backendEnv, true);
  syncAuthUI();
  return true;
}

function syncAuthActionButtons() {
  const clearBtn = $("#authClearBtn");
  if (!clearBtn) return;
  const keys = hasKeysFor(backendEnv);
  const connected = isEnvConnected(backendEnv);
  if (connected) {
    clearBtn.hidden = false;
    clearBtn.disabled = false;
    clearBtn.textContent = "Disconnect";
    clearBtn.dataset.authAction = "disconnect";
  } else if (keys) {
    clearBtn.hidden = false;
    clearBtn.disabled = false;
    clearBtn.textContent = "Connect";
    clearBtn.dataset.authAction = "connect";
  } else {
    clearBtn.hidden = true;
    clearBtn.disabled = true;
    clearBtn.textContent = "Disconnect";
    clearBtn.dataset.authAction = "";
  }
}

function syncAuthUI(accountHint) {
  const status = $("#authStatus");
  const pub = $("#authPublicKey");
  const priv = $("#authPrivateKey");
  const stored = credentialsByEnv[backendEnv] || { publicKey: "", privateKey: "" };
  if (pub) pub.value = stored.publicKey || "";
  if (priv) priv.value = stored.privateKey || "";
  if (status) status.classList.remove("connected", "pending", "saved", "rejected");

  const connected = isEnvConnected(backendEnv);
  const keys = hasKeysFor(backendEnv);

  if (!status) {
    syncAuthActionButtons();
    return;
  }

  if (accountHint === "unauthorized") {
    status.textContent = "Keys rejected";
    status.classList.add("rejected");
    status.title = "These keys are not valid. Sign in again or paste keys from Panel → Profile.";
    setJourney({ connected: false });
  } else if (connected) {
    setJourney({ connected: true });
    if (accountHint === "pending") {
      status.textContent = getConnectedLabel(true);
      status.classList.add("pending");
      status.title = "Keys work, but Shipmozo profile is under verification";
    } else {
      status.textContent = getConnectedLabel(false);
      status.classList.add("connected");
      status.title =
        accountHint === "verified"
          ? "Keys saved — account active"
          : `public-key: ${(stored.publicKey || "").slice(0, 10)}…`;
    }
  } else if (keys) {
    status.textContent = "Keys saved, not connected";
    status.classList.add("saved");
    status.title = "Keys are saved. Click Connect to use them.";
    setJourney({ connected: false });
  } else if (stored.publicKey || stored.privateKey) {
    status.textContent = "Incomplete keys";
    status.title = "Enter both public-key and private-key";
    setJourney({ connected: false });
  } else {
    status.textContent = "Not connected";
    status.title = "Click Connect API";
    setJourney({ connected: false });
  }
  syncAuthActionButtons();
}

/** Explain Shipmozo result/message in plain language */
function interpretShipmozoResponse(payload) {
  if (!payload || typeof payload !== "object") return null;
  const message = payload.message || "";
  const msg = message.toLowerCase();
  const failureReason = payload.data?.error || message || "The API returned result 0.";
  if (payload.result === "1" || payload.result === 1) {
    const genericSuccess = !message || /^success\.?$/i.test(message.trim());
    return {
      type: "ok",
      title: "✅ Success",
      text: genericSuccess ? "Request succeeded." : message,
    };
  }
  if (msg.includes("under verification") || msg.includes("profile is under")) {
    return {
      type: "pending",
      title: "⏳ Account pending verification (not an API key issue)",
      text: "Your public-key and private-key are accepted, but Shipmozo has not activated your seller profile yet. Complete verification in the Shipmozo panel (KYC / documents). API calls will return result \"0\" until approval.",
    };
  }
  if (msg.includes("unauthorised") || msg.includes("unauthorized")) {
    return {
      type: "unauthorized",
      title: "❌ Failed: Keys not valid for this server",
      text: "Shipmozo rejected these API keys. Sign in again or paste fresh keys from Panel → Profile.",
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

function accountHintFromProbe(accountState) {
  if (accountState === "verified") return "verified";
  if (accountState === "pending") return "pending";
  if (accountState === "unauthorized") return "unauthorized";
  return undefined;
}

async function refreshAuthStatusFromKeys() {
  if (!isEnvConnected(backendEnv)) {
    syncAuthUI();
    return;
  }
  const accountState = await probeAccountStatus();
  if (accountState === "unauthorized") {
    // Stay disconnected so the badge cannot claim Connected while keys are rejected.
    setEnvConnected(backendEnv, false);
    syncAuthUI("unauthorized");
    toast("These keys were rejected — sign in again or paste keys from Panel → Profile", "error");
    return;
  }
  syncAuthUI(accountHintFromProbe(accountState));
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
    if (payload?.result === "1" || payload?.result === 1) return "verified";
    const hint = interpretShipmozoResponse(payload);
    if (hint?.type === "pending") return "pending";
    if (hint?.type === "unauthorized") return "unauthorized";
    return "unknown";
  } catch {
    return null;
  }
}

function extractLoginKeys(payload) {
  if (!payload || (payload.result !== "1" && payload.result !== 1)) return null;
  const row = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  if (!row || typeof row !== "object") return null;
  const publicKey = row.public_key || row.publicKey || "";
  const privateKey = row.private_key || row.privateKey || "";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, row };
}

function applyLoginKeysFromPayload(payload) {
  const extracted = extractLoginKeys(payload);
  if (!extracted) return false;
  credentials.publicKey = extracted.publicKey;
  credentials.privateKey = extracted.privateKey;
  saveCredentials();
  setJourney({ connected: true });
  return true;
}

function isLoginOperation(item) {
  if (!item) return false;
  const pathOnly = String(item.path || "").split("?")[0];
  return pathOnly === "/login" || item.op?.operationId === "Login";
}

async function loginWithPassword(username, password) {
  const wrapped = await proxyRequest({
    method: "POST",
    path: "/login",
    headers: {},
    body: { username, password },
  });
  const payload = wrapped.data;
  if (!applyLoginKeysFromPayload(payload)) {
    throw new Error(payload?.message || wrapped.message || "Login failed");
  }
  return extractLoginKeys(payload)?.row || payload.data?.[0];
}

function authHeaders() {
  if (!isEnvConnected(backendEnv)) return {};
  const c = credentialsByEnv[backendEnv] || {};
  const h = {};
  if (c.publicKey) h["public-key"] = c.publicKey;
  if (c.privateKey) h["private-key"] = c.privateKey;
  return h;
}

function getWorkflowCategories() {
  const configured = portalMeta?.navigation?.categories || [];
  return [
    ...configured.map((category, index) => ({ ...category, order: index })),
    { id: "other-apis", label: "Other APIs", keywords: [], order: Number.MAX_SAFE_INTEGER },
  ];
}

function getWorkflowGroups(items = operations) {
  const categories = getWorkflowCategories();
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  const grouped = new Map(categories.map((category) => [category.id, []]));

  items.forEach((item) => {
    const categoryId = categoriesById.has(item.workflowCategoryId) ? item.workflowCategoryId : "other-apis";
    grouped.get(categoryId).push(item);
  });

  return categories
    .map((category) => ({
      ...category,
      items: (grouped.get(category.id) || []).sort(
        (a, b) => a.workflowOrder - b.workflowOrder || a.summary.localeCompare(b.summary)
      ),
    }))
    .filter((category) => category.items.length);
}

function matchesWorkflowSearch(item, query) {
  if (!query) return true;
  return [
    item.method,
    item.path,
    item.summary,
    item.workflowCategoryLabel,
    ...(item.workflowKeywords || []),
  ]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

async function loadSpec() {
  let lastError;
  for (const url of getSpecUrls()) {
    try {
      const { data } = await fetchJson(url);
      if (!data?.paths) throw new Error("Spec missing paths");
      spec = data;
      portalMeta = spec["x-portal"] || {};
      const categoryById = new Map(getWorkflowCategories().map((category) => [category.id, category]));
      const operationNavigation = portalMeta.navigation?.operations || {};
      operations = [];
      for (const [pathKey, methods] of Object.entries(spec.paths || {})) {
        for (const [method, op] of Object.entries(methods)) {
          if (["get", "post", "put", "patch", "delete"].includes(method)) {
            const navigation = operationNavigation[op.operationId] || {};
            const category = categoryById.get(navigation.category) || categoryById.get("other-apis");
            operations.push({
              id: `${method}-${pathKey}`.replace(/[{}]/g, ""),
              method: method.toUpperCase(),
              path: pathKey,
              op,
              tag: (op.tags && op.tags[0]) || "Other",
              summary: op.summary || pathKey,
              workflowCategoryId: category.id,
              workflowCategoryLabel: category.label,
              workflowKeywords: [...(category.keywords || []), ...(navigation.keywords || [])],
              workflowOrder: navigation.order ?? Number.MAX_SAFE_INTEGER,
            });
          }
        }
      }
      operations.sort((a, b) => {
        const categoryDifference =
          (categoryById.get(a.workflowCategoryId)?.order ?? Number.MAX_SAFE_INTEGER) -
          (categoryById.get(b.workflowCategoryId)?.order ?? Number.MAX_SAFE_INTEGER);
        return categoryDifference || a.workflowOrder - b.workflowOrder || a.summary.localeCompare(b.summary);
      });
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
  const rowsByOperationId = new Map(rows.map((row) => [row.operationId, row]));
  const renderTable = (items) => `<table class="rate-api-table">
    <thead><tr><th>Method</th><th>Path</th><th>Limit</th><th>Auth</th><th>Notes</th></tr></thead>
    <tbody>
      ${items
        .map(
          (item) => {
            const row = rowsByOperationId.get(item.op.operationId) || {};
            return `<tr>
          <td><span class="method-badge method-${item.method}">${item.method}</span></td>
          <td><code>${esc(item.path)}</code></td>
          <td><strong>${esc(String(row.limit ?? 500))}</strong> <span class="muted small">(shared)</span></td>
          <td>${needsAuth(item.op) ? "Keys" : "—"}</td>
          <td class="muted small">${esc(row.notes || "")}</td>
        </tr>`
          }
        )
        .join("")}
    </tbody>
  </table>`;

  return getWorkflowGroups()
    .map((category) => `<h3 class="rate-category-title">${esc(category.label)}</h3>${renderTable(category.items)}`)
    .join("");
}

function renderStaticIntro() {
  const g = portalMeta.rateLimitGlobal || { limit: 500 };
  const rlHeaders = portalMeta.rateLimitHeaders;
  const connected = isEnvConnected(backendEnv);
  return `
    <div class="hero-banner">
      <div class="hero-logo-wrap">
        <img src="/assets/shipmozo-logo.png" alt="Shipmozo" class="hero-logo" width="160" height="52" />
      </div>
      <h2>Developer portal</h2>
      <p>Integrate orders, couriers, tracking, warehouses, and return orders. Connect your API keys and test from the browser.</p>
      <div class="hero-actions">
        <button type="button" class="btn-primary" id="heroConnectBtn">${connected ? "Manage API keys" : "Connect API keys"}</button>
        <a href="#/execute" class="btn-secondary">Open API Tester</a>
        <a href="#/demo" class="btn-secondary">Run Demo</a>
        ${renderPostmanActions(true)}
      </div>
      ${
        connected
          ? ""
          : `<p class="hero-start-hint">Start here: connect your keys before using the API Tester or Postman downloads.</p>`
      }
    </div>
    ${renderSandboxWarningNote()}

    <div class="section">
      <h2>Build With Shipmozo APIs</h2>
      <div class="card-grid">
        <div class="card"><h3>Forward orders</h3><p>Push orders, compare courier rates using the Rate Calculator, assign the best courier partner, schedule pickup and print shipping labels.</p></div>
        <div class="card"><h3>Reverse Orders (returns)</h3><p>get Return reasons, push return orders, track reverse orders.</p></div>
        <div class="card"><h3>Operations</h3><p>Manage warehouses, handle NDRs, generate manifests, and international shipments.</p></div>
      </div>
    </div>

    <div class="section">
      <h2>Base URL</h2>
      <div class="url-box card">
        <label>API base URL</label>
        <code>${getApiBase()}</code>
      </div>
      <p class="base-url-note">
        All portal requests and code samples use <code>${esc(getApiBase())}</code>.
        Do not add a trailing slash after <code>/v1</code>.
      </p>
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
      <p>All <strong>${operations.length || 23} APIs</strong> share <strong>${g.limit || 500} requests per minute</strong> per API key. Each call lowers <code>x-ratelimit-remaining</code> by 1; when the minute ends, the counter <strong>refreshes</strong> back toward 500.</p>
      ${
        rlHeaders
          ? `<table style="margin-top:12px"><thead><tr><th>Header</th><th>Example</th><th>Meaning</th></tr></thead><tbody>${rlHeaders.headers
              .map((h) => `<tr><td><code>${esc(h.name)}</code></td><td>${esc(h.example)}</td><td>${esc(h.meaning)}</td></tr>`)
              .join("")}</tbody></table>`
          : ""
      }
      ${renderLiveRateLimitBox()}
      <p style="margin-top:16px"><a href="#/errors">Error codes →</a></p>
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

    ${renderSandboxWarningNote()}
    <div class="note"><strong>Security:</strong> Never expose <code>private-key</code> in front-end apps or mobile clients. Call Shipmozo from your backend only.</div>`;
}

function renderWorkflowStep(step) {
  const raw = typeof step === "string" ? step : String(step?.line || step?.text || "");
  const parts = raw.split("\n");
  const main = parts[0].trim();
  const note = parts
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const targets = operations.filter((operation) => main.includes(operation.path));
  const alreadyHasTesterLink = /API Tester/i.test(main);
  const links = alreadyHasTesterLink
    ? ""
    : targets
        .map(
          (operation) =>
            `<a href="#/execute?op=${encodeURIComponent(operation.id)}">Open ${esc(operation.summary)} in API Tester</a>`
        )
        .join(" · ");
  return `<li class="workflow-step">
    <div class="workflow-step-main"><code>${esc(main)}</code>${
      links ? ` <span class="workflow-step-links">${links}</span>` : ""
    }</div>${note ? `<div class="workflow-step-note">${esc(note)}</div>` : ""}
  </li>`;
}

function renderWorkflows() {
  const flows = portalMeta.workflows || [];
  return `
    <h1 class="page-title">Integration flows</h1>
    <p class="page-lead">Complete API workflows for shipping, tracking, returns, and operations.</p>
    ${flows
      .map(
        (f) => `
      <div class="section flow-card">
        <h2>${esc(f.title)}</h2>
        <ol class="flow-steps">
          ${f.steps.map(renderWorkflowStep).join("")}
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
        <li>Call <code>rate-calculator</code> before <code>push-order</code> at checkout — an empty courier list means the pincode pair is not serviceable.</li>
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
  const rateCalculatorTip =
    path === "/rate-calculator"
      ? `<div class="note tip"><strong>Tip:</strong> to check if a pincode pair is serviceable, call this endpoint — one or more couriers returned means the route is serviceable. An empty list or <code>result: "0"</code> means not serviceable.</div>`
      : "";

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
        ${needsAuth(op) ? `<span class="pill pill-auth">Requires API keys</span>` : `<span class="pill">No auth</span>`}
      </div>

      <div class="url-box card" style="margin:16px 0">
        <label>API URL</label>
        <code>${esc(fullUrl)}</code>
      </div>

      <div class="endpoint-doc-columns">
        <div class="endpoint-doc-request">
          ${rateCalculatorTip}
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

          ${renderFieldContract(op.operationId, fieldContracts)}
        </div>

        <aside class="endpoint-doc-responses">
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
        </aside>
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
    text: 'Needs a valid warehouse_id. Get one from Get Warehouses (use the one with default: YES).',
    links: [{ opId: "get-/get-warehouses", label: "Get Warehouses" }],
  },
  "/push-return-order": {
    text: "Needs a return_reason_id from Get Return Reason. Weight here is in kg (unlike Push Order, which uses grams).",
    links: [
      { opId: "get-/get-return-reason", label: "Get Return Reason" },
      { opId: "get-/get-warehouses", label: "Get Warehouses" },
    ],
  },
  "/assign-courier": {
    text: "Needs the internal order_id from Push Order's response, and a courier_id from Rate Calculator.",
    links: [
      { opId: "post-/push-order", label: "Push Order" },
      { opId: "post-/rate-calculator", label: "Rate Calculator" },
    ],
  },
  "/auto-assign-order": {
    text: "You'll need: an order created via Push Order first.",
    links: [{ opId: "post-/push-order", label: "Push Order" }],
  },
  "/schedule-pickup": {
    text: "Only needed if the chosen courier's pickups_automatically_scheduled is NO in Rate Calculator. Otherwise the AWB is already assigned.",
    links: [{ opId: "post-/rate-calculator", label: "Rate Calculator" }],
  },
  "/cancel-order": {
    text: "Needs the internal order_id and the awb_number from Assign Courier.",
    links: [{ opId: "post-/assign-courier", label: "Assign Courier" }],
  },
  "/get-order-label/{awb_number}": {
    text: "Needs the awb_number from Assign Courier or Schedule Pickup.",
    links: [
      { opId: "post-/assign-courier", label: "Assign Courier" },
      { opId: "post-/schedule-pickup", label: "Schedule Pickup" },
    ],
  },
  "/track-order": {
    text: "Needs the awb_number from Assign Courier or Schedule Pickup.",
    links: [
      { opId: "post-/assign-courier", label: "Assign Courier" },
      { opId: "post-/schedule-pickup", label: "Schedule Pickup" },
    ],
  },
  "/order/update-warehouse": {
    text: "Needs the internal order_id from Push Order and a warehouse_id from Get Warehouses.",
    links: [
      { opId: "post-/push-order", label: "Push Order" },
      { opId: "get-/get-warehouses", label: "Get Warehouses" },
    ],
  },
};

function renderPrereqHtml(prereq) {
  if (!prereq) return "";
  const links = (prereq.links || (prereq.opId ? [{ opId: prereq.opId, label: prereq.label }] : []))
    .map((link) => `<a href="#/execute?op=${encodeURIComponent(link.opId)}">${esc(link.label)}</a>`)
    .join(" · ");
  return `${esc(prereq.text)}${links ? ` ${links}` : ""}`;
}

function getFieldHint(path, fieldName) {
  if (!fieldHints) return "";
  return fieldHints[`${path}.${fieldName}`] || fieldHints[`${path}.${fieldName.split(".").pop()}`] || "";
}

async function loadPortalAssets() {
  fieldContracts = await loadFieldContracts();
  try {
    const [hintsRes, scenariosRes] = await Promise.all([
      fetch("/assets/field-hints.json"),
      fetch("/assets/scenarios.json"),
    ]);
    fieldHints = await hintsRes.json();
    scenarios = await scenariosRes.json();
  } catch {
    fieldHints = fieldHints || {};
    scenarios = scenarios || {};
  }
}

function workflowApiDeps() {
  return {
    proxyRequest,
    authHeaders,
    getActiveCredentials,
    interpretShipmozoResponse,
    toast,
    applyLoginKeysFromPayload,
    isLoginOperation,
  };
}

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
  setJourney({ connected: isEnvConnected(backendEnv) });
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

function renderTesterOpOptions(preselectId) {
  return getWorkflowGroups()
    .map((category) => {
      const opts = category.items
      .map(
        (o) =>
          `<option value="${o.id}" ${o.id === preselectId ? "selected" : ""}>${o.method} ${o.path} — ${esc(o.summary)}</option>`
      )
      .join("");
      return `<optgroup label="${esc(category.label)}">${opts}</optgroup>`;
    })
    .join("");
}

function renderTester(preselectId) {
  const opts = renderTesterOpOptions(preselectId);

  return `
    <div class="tester-layout">
      <h1 class="page-title">API Tester</h1>
      <p class="page-lead">Requests go through this portal's proxy to <code>${getApiBase()}</code>. Connect API keys in the header — they are sent as <code>public-key</code> and <code>private-key</code> on every call.</p>
      ${renderJourneyStrip()}

      <div class="tester-grid">
        <div class="card tester-form" id="testerForm">
          <label for="testerOp">API endpoint</label>
          <select id="testerOp" aria-label="API endpoint">${opts}</select>
          <div id="testerPrereq" class="tester-prereq hidden"></div>
          <div class="tester-actions">
            <button type="button" class="btn-primary" id="testerRun">Execute API</button>
            <button type="button" class="btn-secondary" id="testerCurl">Copy cURL</button>
          </div>
          <p class="muted small" id="testerAuthHint"></p>
          <div id="testerEnumHints" class="tester-enum-hints hidden"></div>
          <div id="testerParams"></div>
          <label for="testerBody">Request body (JSON)</label>
          <textarea id="testerBody" rows="12" placeholder="{}" aria-label="Request body (JSON)"></textarea>
        </div>
        <div class="card tester-response-card">
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
    if (authRequired && !isEnvConnected(backendEnv)) {
      hint.className = "hint-warn";
      hint.textContent = hasKeysFor(backendEnv)
        ? "Keys are saved but not connected. Open Connect API and click Connect."
        : "Connect API keys (header button) or paste keys and click Save.";
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
      $("#testerMeta").textContent = meta;
      if (wrapped.error === "UPSTREAM_HTML") {
        $("#testerOut").parentElement?.classList.add("error");
        $("#testerOut").textContent = wrapped.message;
      } else {
        const payload = wrapped.data;
        updateJourneyFromCall(item, payload);
        if (isLoginOperation(item) && applyLoginKeysFromPayload(payload)) {
          toast(getConnectedLabel(false), "ok");
        }
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
        pre.textContent = JSON.stringify(payload, null, 2);
      }
    } catch (e) {
      $("#testerMeta").textContent = "Request failed";
      $("#testerOut").parentElement?.classList.add("error");
      $("#testerOut").textContent = String(e.message);
    } finally {
      runBtn.disabled = false;
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
  const mode = getSavedTesterMode();
  const lifecycle = mode === "lifecycle";

  return `
    <div class="tester-layout" id="testerRoot">
      ${renderModeToggle(mode)}
      ${lifecycle ? "" : renderJourneyStrip()}

      <div id="singleModePanel" class="${lifecycle ? "hidden" : ""}">
      <div class="tester-grid">
        <div class="tester-request-col">
          <div class="card tester-form" id="testerForm">
            <label for="testerOp">API endpoint</label>
            <select id="testerOp" aria-label="API endpoint">${opts}</select>
            <label for="testerScenario">Load scenario</label>
            <select id="testerScenario" aria-label="Load scenario"><option value="">— Choose a scenario —</option></select>
            <p class="scenario-expected hidden" id="testerScenarioExpected"></p>
            <div id="testerPrereq" class="tester-prereq hidden"></div>
            <div id="testerUnitFacts" class="tester-unit-facts hidden"></div>
            <div class="tester-actions">
              <button type="button" class="btn-primary" id="testerRun">Execute API</button>
              <button type="button" class="btn-secondary" id="testerCurl">Copy cURL</button>
              <button type="button" class="btn-secondary" id="testerCopyRequest">Copy request</button>
              <button type="button" class="btn-secondary" id="testerCopyResponse">Copy response</button>
              <button type="button" class="btn-secondary" id="testerReset">Reset example</button>
            </div>
            <p class="muted small" id="testerAuthHint"></p>
            <div id="testerEnumControls" class="tester-enum-controls hidden"></div>
            <div id="testerParams"></div>
            <label for="testerBody">Request body (JSON)</label>
            <div id="testerBodyHints" class="tester-body-hints hidden"></div>
            <textarea id="testerBody" rows="12" placeholder="{}" aria-label="Request body (JSON)"></textarea>
          </div>
          <div id="testerFieldContract" class="tester-field-contract-bottom"></div>
        </div>
        <div class="card tester-response-card">
          <div class="tester-response-head">
            <h2 class="tester-response-title">Response</h2>
          </div>
          <div class="response-meta" id="testerMeta">Select an API and click Execute.</div>
          <div class="result-banner hidden" id="testerResultBanner" role="status"></div>
          <div class="response-tabs" role="tablist" aria-label="Response views">
            <button type="button" class="response-tab active" role="tab" aria-selected="true" data-response-tab="body">Response Body</button>
            <button type="button" class="response-tab hidden" role="tab" aria-selected="false" data-response-tab="label" id="testerLabelTab">Label</button>
            <button type="button" class="response-tab" role="tab" aria-selected="false" data-response-tab="debug">Debug</button>
          </div>
          <div class="response-panel" data-response-panel="body">
            <div class="response-box"><pre id="testerOut">{}</pre></div>
          </div>
          <div class="response-panel hidden" data-response-panel="label">
            <div class="label-preview hidden" id="testerLabelPreview"></div>
          </div>
          <div class="response-panel hidden" data-response-panel="debug">
            <div class="response-box"><pre id="testerDebugOut">{}</pre></div>
          </div>
        </div>
      </div>
      </div>

      <div id="workflowModeMount" class="${lifecycle ? "" : "hidden"}">
        ${
          lifecycle
            ? (() => {
                const scenarioId = loadLifecycleScenarioId();
                const wf = getLifecycleWorkflow(scenarioId);
                return renderWorkflowPanel(
                  wf,
                  { ...loadWorkflowContext() },
                  {},
                  wf.steps[0].id,
                  null,
                  scenarioId
                );
              })()
            : ""
        }
      </div>
    </div>`;
}

function bindPhase1Tester(preselectId) {
  const root = $("#testerRoot") || $("#main");
  const mode = getSavedTesterMode();

  root.querySelectorAll('input[name="testerMode"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      saveTesterMode(e.target.value);
      const params = new URLSearchParams(location.hash.split("?")[1] || "");
      if (e.target.value === "lifecycle") {
        params.set("mode", "lifecycle");
        location.hash = `#/execute?${params.toString()}`;
      } else {
        params.delete("mode");
        const qs = params.toString();
        location.hash = qs ? `#/execute?${qs}` : "#/execute";
      }
    });
  });

  if (mode === "lifecycle") {
    bindWorkflowPanel(root, workflowApiDeps());
    return;
  }

  const opSelect = $("#testerOp");
  const scenarioSelect = $("#testerScenario");
  const scenarioExpected = $("#testerScenarioExpected");
  const fieldContractEl = $("#testerFieldContract");
  const bodyHintsEl = $("#testerBodyHints");
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
    const labelTab = $("#testerLabelTab");
    if (!host) return;
    const entries = Array.isArray(payload?.data) ? payload.data : [payload?.data];
    const rawLabel = entries.find((entry) => typeof entry?.label === "string")?.label;
    if (!rawLabel) {
      host.classList.add("hidden");
      host.innerHTML = "";
      labelTab?.classList.add("hidden");
      if (labelTab?.classList.contains("active") || labelTab?.getAttribute("aria-selected") === "true") {
        setResponseTab("body");
      }
      return;
    }
    const source = rawLabel.startsWith("data:")
      ? rawLabel
      : `data:image/png;base64,${rawLabel.replace(/\s/g, "")}`;
    host.classList.remove("hidden");
    host.innerHTML = "";
    const heading = document.createElement("h3");
    heading.textContent = "Shipping label preview";
    const frame = document.createElement("div");
    frame.className = "label-preview-frame";
    const image = document.createElement("img");
    image.src = source;
    image.alt = "Shipping label returned by Shipmozo";
    frame.append(image);
    const download = document.createElement("a");
    download.href = source;
    download.download = "shipmozo-label.png";
    download.className = "btn-secondary btn-sm";
    download.textContent = "Download label";
    host.append(heading, frame, download);
    labelTab?.classList.remove("hidden");
    setResponseTab("label");
  }

  function renderResponse(payload, wrapped, durationMs) {
    latestResponseBody = payload ?? {};
    $("#testerOut").textContent = JSON.stringify(latestResponseBody, null, 2);
    $("#testerDebugOut").textContent = JSON.stringify(
      {
        httpStatus: wrapped.status ?? 200,
        requestDurationMs: Math.round(durationMs),
      },
      null,
      2
    );
    updateResultBanner(payload);
    renderLabelPreview(payload);
    const hasLabel = Array.isArray(payload?.data)
      ? payload.data.some((entry) => typeof entry?.label === "string")
      : typeof payload?.data?.label === "string";
    if (!hasLabel) setResponseTab("body");
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
      prereqEl.innerHTML = renderPrereqHtml(prereq);
    } else {
      prereqEl.classList.add("hidden");
      prereqEl.innerHTML = "";
    }
    const facts = TESTER_UNIT_FACTS[item.path];
    unitFactsEl.classList.toggle("hidden", !facts);
    unitFactsEl.textContent = facts || "";
    if (fieldContractEl) {
      fieldContractEl.innerHTML = renderFieldContract(item.op.operationId, fieldContracts);
    }
    if (bodyHintsEl && fieldHints) {
      const hints = Object.entries(fieldHints)
        .filter(([key]) => key.startsWith(`${item.path}.`))
        .map(([key, text]) => {
          const field = key.slice(item.path.length + 1);
          return `<span class="field-hint-item"><code>${esc(field)}</code> — ${esc(text)}</span>`;
        });
      if (hints.length) {
        bodyHintsEl.classList.remove("hidden");
        bodyHintsEl.innerHTML = hints.join(" · ");
      } else {
        bodyHintsEl.classList.add("hidden");
        bodyHintsEl.innerHTML = "";
      }
    }
    renderEnumControls(item);
    populateScenarioSelect(item);
  }

  function populateScenarioSelect(item) {
    if (!scenarioSelect) return;
    const list = scenarios?.[item.id];
    scenarioSelect.innerHTML = '<option value="">— Choose a scenario —</option>';
    if (!list || !list.length) {
      if (item.path.includes("international")) {
        scenarioSelect.innerHTML += '<option value="" disabled>Coming soon — insufficient verified field data</option>';
      }
      scenarioExpected?.classList.add("hidden");
      return;
    }
    list.forEach((scenario, index) => {
      const opt = document.createElement("option");
      opt.value = String(index);
      opt.textContent = scenario.label;
      scenarioSelect.appendChild(opt);
    });
    scenarioExpected?.classList.add("hidden");
  }

  function applyScenario(index) {
    const item = currentOp();
    const list = scenarios?.[item?.id];
    const scenario = list?.[Number(index)];
    if (!scenario) {
      scenarioExpected?.classList.add("hidden");
      return;
    }
    if (scenario.body) bodyTa.value = JSON.stringify(scenario.body, null, 2);
    if (scenario.params) {
      Object.entries(scenario.params).forEach(([name, value]) => {
        const input = paramsDiv.querySelector(`input[data-param="${name}"]`);
        if (input) input.value = value;
      });
    }
    syncEnumControlsFromBody();
    if (scenarioExpected) {
      scenarioExpected.classList.remove("hidden");
      scenarioExpected.textContent = `Expected: ${scenario.expected || "See API response"}`;
    }
  }

  function appendFieldHint(labelEl, path, fieldName) {
    const hintText = getFieldHint(path, fieldName);
    if (!hintText) return;
    const span = document.createElement("span");
    span.className = "field-hint";
    span.textContent = hintText;
    labelEl.appendChild(span);
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
        appendFieldHint(label, item.path, parameter.name);
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
    if (authRequired && !isEnvConnected(backendEnv)) {
      hint.className = "hint-warn";
      hint.textContent = hasKeysFor(backendEnv)
        ? "Keys are saved but not connected. Open Connect API and click Connect."
        : "Connect API keys (header button) or paste keys and click Save.";
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

  scenarioSelect?.addEventListener("change", () => applyScenario(scenarioSelect.value));

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
      if (isLoginOperation(item) && applyLoginKeysFromPayload(wrapped.data)) {
        toast(getConnectedLabel(false), "ok");
      }
      const strip = document.querySelector(".journey-strip");
      if (strip) strip.outerHTML = renderJourneyStrip();
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
        { href: "#/errors", label: "Error codes" },
        { href: "#/best-practices", label: "Best practices" },
      ],
    },
  ];

  const workflowGroups = getWorkflowGroups(operations.filter((operation) => matchesWorkflowSearch(operation, q)));

  let html = "";
  staticGroups.forEach((g) => {
    html += `<div class="nav-group"><div class="nav-group-title">${g.title}</div>`;
    g.links.forEach((l) => {
      html += `<a class="nav-link" href="${l.href}">${esc(l.label)}</a>`;
    });
    html += `</div>`;
  });

  html += `<div class="nav-group"><div class="nav-group-title">Tools</div><a class="nav-link" href="#/execute">API Tester</a></div>`;

  workflowGroups.forEach((category) => {
    html += `<div class="nav-group"><div class="nav-group-title">${esc(category.label)}</div>`;
    category.items.forEach((o) => {
      html += `<a class="nav-link" href="#/api/${o.id}"><span class="method method-${o.method}">${o.method}</span>${esc(o.summary)}</a>`;
    });
    html += `</div>`;
  });

  nav.innerHTML = html;
}

function setActiveNav() {
  const hash = location.hash || "#/";
  const h = hash.split("?")[0];
  const query = hash.includes("?") ? hash.split("?")[1] : "";
  const params = new URLSearchParams(query);
  const isLifecycle = h === "#/execute" && params.get("mode") === "lifecycle";
  const isExecute = h === "#/execute" && !isLifecycle;
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === h);
  });
  document.querySelectorAll(".topnav-link").forEach((a) => {
    const nav = a.dataset.nav;
    a.classList.toggle(
      "active",
      (nav === "execute" && isExecute) ||
        (nav === "lifecycle" && isLifecycle) ||
        (nav === "demo" && h === "#/demo") ||
        (nav === "workflows" && h === "#/workflows") ||
        (nav === "errors" && h === "#/errors") ||
        (nav === "docs" && !["#/execute", "#/workflows", "#/errors", "#/demo"].includes(h))
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
    const query = hash.split("?")[1] || "";
    const params = new URLSearchParams(query);
    const op = params.get("op");
    if (params.get("mode") === "lifecycle") {
      saveTesterMode("lifecycle");
    } else if (params.has("op")) {
      saveTesterMode("single");
    }
    main.innerHTML = renderPhase1Tester(op);
    bindPhase1Tester(op);
    return;
  }
  if (hash.startsWith("#/demo")) {
    main.innerHTML = renderDemoPage();
    bindDemoPage();
    return;
  }
  if (hash === "#/" || hash === "#") {
    main.innerHTML = renderStaticIntro();
    bindCodeTabs(main);
    bindLiveRateLimit(main);
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
    location.hash = "#/";
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
  syncAuthUI();
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
      msg.textContent = `${getConnectedLabel(false)}. You can close this dialog.`;
      toast(getConnectedLabel(false), "ok");
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
    msg.className = "auth-login-msg";
    msg.textContent = "Checking account with Shipmozo…";
    const accountState = await probeAccountStatus();
    if (accountState === "unauthorized") {
      setEnvConnected(backendEnv, false);
      syncAuthUI("unauthorized");
      msg.className = "auth-login-msg error";
      msg.textContent = `These keys were rejected. Sign in again or paste keys from Panel → Profile.`;
      toast("These keys were rejected", "error");
      return;
    }
    setJourney({ connected: true });
    syncAuthUI(accountHintFromProbe(accountState));
    if (accountState === "pending") {
      msg.className = "auth-login-msg error";
      msg.textContent =
        "Keys are saved and valid, but your Shipmozo profile is still under verification. Complete KYC in the panel — APIs will return result 0 until approved.";
      toast(getConnectedLabel(true), "error");
    } else if (accountState === "verified") {
      msg.className = "auth-login-msg ok";
      msg.textContent = `${getConnectedLabel(false)}. Account is active.`;
      toast(getConnectedLabel(false), "ok");
      closeAuthDialog();
    } else {
      msg.className = "auth-login-msg ok";
      msg.textContent = `${getConnectedLabel(false)}. Keys saved locally.`;
      toast(getConnectedLabel(false), "ok");
      closeAuthDialog();
    }
  });

  $("#authClearBtn")?.addEventListener("click", async () => {
    const action = $("#authClearBtn")?.dataset?.authAction;
    const msg = $("#authLoginMsg");
    if (action === "connect") {
      if (!connectCurrentEnv()) {
        toast("No saved keys", "error");
        return;
      }
      msg.className = "auth-login-msg";
      msg.textContent = "Checking account with Shipmozo…";
      const accountState = await probeAccountStatus();
      if (accountState === "unauthorized") {
        setEnvConnected(backendEnv, false);
        syncAuthUI("unauthorized");
        msg.className = "auth-login-msg error";
        msg.textContent = `Saved keys were rejected. Sign in again or paste keys from Panel → Profile.`;
        toast("These keys were rejected", "error");
        return;
      }
      setJourney({ connected: true });
      syncAuthUI(accountHintFromProbe(accountState));
      if (accountState === "pending") {
        msg.className = "auth-login-msg error";
        msg.textContent =
          "Connected with saved keys, but your Shipmozo profile is still under verification.";
        toast(getConnectedLabel(true), "error");
      } else {
        msg.className = "auth-login-msg ok";
        msg.textContent = `${getConnectedLabel(false)}.`;
        toast(getConnectedLabel(false), "ok");
        closeAuthDialog();
      }
      return;
    }
    if (action === "disconnect") {
      disconnectCurrentEnv();
      $("#authUsername").value = "";
      $("#authPassword").value = "";
      msg.textContent = "";
      toast("Disconnected — keys kept in browser", "info");
    }
  });
}

async function checkProxyAvailable() {
  try {
    const { data } = await fetchJson(portalUrl("/health"));
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
  banner.innerHTML = `<strong>API Tester offline.</strong> Docs work, but API calls need the Node server. In terminal: <code>npm start</code> (stop any other app on port 3000 first).`;
  main.prepend(banner);
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 960px)").matches;
}

function getSidebarCollapsedPref() {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    /* ignore */
  }
  return isMobileLayout();
}

function setSidebarCollapsed(collapsed, { persist = true } = {}) {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  const sidebar = $("#sidebar");
  const btn = $("#sidebarToggle");
  if (sidebar) {
    sidebar.setAttribute("aria-hidden", collapsed ? "true" : "false");
    if (collapsed) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
  }
  if (btn) {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.setAttribute("aria-label", collapsed ? "Open sidebar" : "Close sidebar");
    btn.title = collapsed ? "Open sidebar" : "Close sidebar";
  }
  if (persist) {
    try {
      localStorage.setItem(SIDEBAR_STORAGE, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

function bindSidebarToggle() {
  const btn = $("#sidebarToggle");
  if (!btn) return;

  setSidebarCollapsed(getSidebarCollapsedPref());

  btn.addEventListener("click", () => {
    setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
  });

  $("#sidebarNav")?.addEventListener("click", (e) => {
    if (!isMobileLayout()) return;
    if (e.target.closest("a.nav-link")) setSidebarCollapsed(true);
  });

  window.matchMedia("(max-width: 960px)").addEventListener("change", () => {
    try {
      if (localStorage.getItem(SIDEBAR_STORAGE) != null) return;
    } catch {
      /* ignore */
    }
    setSidebarCollapsed(isMobileLayout(), { persist: false });
  });
}

async function init() {
  if (redirectMistakenDevHash()) return;
  applyPortalMode();
  loadCredentials();
  applyPortalMode();
  bindAuthDialog();
  bindSidebarToggle();
  refreshAuthStatusFromKeys();
  try {
    await loadSpec();
    await loadPortalAssets();
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
