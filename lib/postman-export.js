const { API_BACKENDS } = require("./api-bases");

function schemaFromProperties(props) {
  if (!props) return null;
  const o = {};
  for (const [k, v] of Object.entries(props)) {
    if (v.default !== undefined && v.default !== "") o[k] = v.default;
    else if (v.example !== undefined) o[k] = v.example;
    else if (v.type === "array") o[k] = v.example || [];
    else if (v.type === "number" || v.type === "integer") o[k] = 0;
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
  const schema = content.schema;
  if (schema?.example !== undefined) return schema.example;
  if (schema?.properties) return schemaFromProperties(schema.properties);
  return null;
}

function needsAuth(op) {
  if (op.operationId === "Login" || op.operationId === "getApiInfo") return false;
  return op.security !== undefined && op.security.length > 0;
}

function buildUrl(pathKey, op) {
  let url = `{{baseUrl}}${pathKey}`;
  const params = op.parameters || [];
  for (const p of params) {
    if (p.in === "path" && p.schema?.default) {
      url = url.replace(`{${p.name}}`, p.schema.default);
    } else if (p.in === "path") {
      url = url.replace(`{${p.name}}`, `{{${p.name}}}`);
    }
  }
  const query = params.filter((p) => p.in === "query");
  if (query.length) {
    const qs = query
      .map((p, i) => {
        const val = p.schema?.default ?? p.schema?.example ?? `{{${p.name}}}`;
        return `${i === 0 ? "?" : "&"}${p.name}=${encodeURIComponent(String(val))}`;
      })
      .join("");
    url += qs.replace(/^\?/, "?");
  }
  return url;
}

function buildHeaders(op, method) {
  const headers = [{ key: "Accept", value: "application/json", type: "text" }];
  if (needsAuth(op)) {
    headers.push(
      { key: "public-key", value: "{{public-key}}", type: "text" },
      { key: "private-key", value: "{{private-key}}", type: "text" }
    );
  }
  if (method !== "GET" && method !== "HEAD" && op.requestBody) {
    headers.push({ key: "Content-Type", value: "application/json", type: "text" });
  }
  return headers;
}

function buildRequest(pathKey, method, op) {
  const upper = method.toUpperCase();
  const bodyExample = getRequestExample(op);
  const req = {
    name: op.summary || pathKey,
    request: {
      method: upper,
      header: buildHeaders(op, upper),
      url: buildUrl(pathKey, op),
      description: op.description || "",
    },
    response: [],
  };
  if (bodyExample && upper !== "GET" && upper !== "HEAD") {
    req.request.body = {
      mode: "raw",
      raw: JSON.stringify(bodyExample, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  return req;
}

function buildPostmanCollection(spec) {
  const byTag = {};
  for (const [pathKey, methods] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const tag = (op.tags && op.tags[0]) || "Other";
      if (!byTag[tag]) byTag[tag] = [];
      byTag[tag].push(buildRequest(pathKey, method, op));
    }
  }

  const folders = Object.entries(byTag)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, items]) => ({
      name: tag,
      item: items.sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return {
    info: {
      _postman_id: "shipmozo-api-collection",
      name: "Shipmozo Shipping API",
      description:
        "Shipmozo REST API — orders, couriers, tracking, warehouses, NDR, and labels.\n\n" +
        "1. Import the **Shipmozo** environment (or set `baseUrl` yourself).\n" +
        "2. Set `public-key` and `private-key` from Panel → Profile.\n" +
        "3. Send requests — check `result` (`1` = success, `0` = failure).\n\n" +
        "Generated from the developer portal OpenAPI spec.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: API_BACKENDS.live.baseUrl },
      { key: "public-key", value: "" },
      { key: "private-key", value: "" },
    ],
    item: folders,
  };
}

function buildPostmanEnvironment(id, label, baseUrl) {
  return {
    id,
    name: label,
    values: [
      { key: "baseUrl", value: baseUrl, type: "default", enabled: true },
      { key: "public-key", value: "", type: "secret", enabled: true },
      { key: "private-key", value: "", type: "secret", enabled: true },
    ],
    _postman_variable_scope: "environment",
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: "shipmozo-developer-portal",
  };
}

function buildPostmanEnvironments() {
  return {
    live: buildPostmanEnvironment("shipmozo-env", "Shipmozo", API_BACKENDS.live.baseUrl),
    // Kept for silent /dev portal path Postman asset; not advertised in UI.
    dev: buildPostmanEnvironment("shipmozo-env-dev", "Shipmozo", API_BACKENDS.dev.baseUrl),
  };
}

module.exports = { buildPostmanCollection, buildPostmanEnvironments };
