import {
  defaultWorkflow,
  extractionMap,
  workflowDependencies,
} from "./workflowDefinitions.js";

const WORKFLOW_CTX_KEY = "shipmozo_workflow_context";
const WORKFLOW_MODE_KEY = "shipmozo_tester_mode";

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

export function getSavedTesterMode() {
  try {
    const m = sessionStorage.getItem(WORKFLOW_MODE_KEY);
    return m === "workflow" ? "workflow" : "single";
  } catch {
    return "single";
  }
}

export function saveTesterMode(mode) {
  try {
    sessionStorage.setItem(WORKFLOW_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function emptyContext() {
  return {
    public_key: "",
    private_key: "",
    order_id: "",
    reference_id: "",
    courier_id: "",
    courier_name: "",
    freight_amount: "",
    awb_number: "",
    label_url: "",
    tracking_status: "",
  };
}

export function loadWorkflowContext() {
  try {
    const raw = sessionStorage.getItem(WORKFLOW_CTX_KEY);
    if (raw) return { ...emptyContext(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return emptyContext();
}

export function saveWorkflowContext(ctx) {
  try {
    sessionStorage.setItem(WORKFLOW_CTX_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
}

export function findValueDeep(obj, possibleKeys) {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const v = findValueDeep(item, possibleKeys);
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  }
  if (typeof obj === "object") {
    for (const key of possibleKeys) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const v = obj[key];
        if (v !== undefined && v !== null && v !== "") return v;
      }
    }
    for (const val of Object.values(obj)) {
      const v = findValueDeep(val, possibleKeys);
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

export function extractFromResponse(payload, step) {
  const updates = {};
  const data = payload?.data ?? payload;

  if (step.id === "rate_calculator" && Array.isArray(data) && data.length) {
    const first = data[0];
    for (const field of step.outputs) {
      const keys = extractionMap[field];
      if (!keys) continue;
      const v = findValueDeep(first, keys);
      if (v !== undefined && v !== "") updates[field] = String(v);
    }
    updates._courierNote =
      data.length > 1
        ? "First available courier selected automatically. You can change courier_id manually before Assign Courier."
        : "";
    return updates;
  }

  for (const field of step.outputs) {
    const keys = extractionMap[field];
    if (!keys) continue;
    const v = findValueDeep(data, keys);
    if (v !== undefined && v !== "") {
      if (field === "label_url" && typeof v === "string" && v.length > 80 && !v.startsWith("http")) {
        updates[field] = "(base64 label in response)";
        updates._labelRaw = v;
      } else {
        updates[field] = String(v);
      }
    }
  }
  return updates;
}

export function contextFromCredentials(creds) {
  return {
    public_key: creds.publicKey || "",
    private_key: creds.privateKey || "",
  };
}

export function getMissingDeps(step, ctx) {
  const requires = workflowDependencies[step.id] || step.requires || [];
  return requires.filter((k) => !ctx[k]);
}

export function stepStatus(step, ctx, stepStates) {
  const saved = stepStates[step.id];
  if (saved === "success") return "Success";
  if (saved === "failed") return "Failed";
  const missing = getMissingDeps(step, ctx);
  if (missing.length) return "Blocked";
  return "Ready";
}

function maskKey(k) {
  if (!k) return "";
  if (k.length <= 8) return "••••••••";
  return `${k.slice(0, 6)}…`;
}

function copyBtn(value, label) {
  if (!value) return "";
  return `<button type="button" class="btn-ghost btn-sm wf-copy" data-copy="${encodeURIComponent(value)}" title="Copy ${label}">Copy</button>`;
}

export function renderWorkflowPanel(workflow, ctx, stepStates, selectedStepId) {
  const steps = workflow.steps;
  const progress = steps
    .map((s) => {
      const st = stepStatus(s, ctx, stepStates);
      const cls = st.toLowerCase().replace(" ", "-");
      return `<span class="wf-progress-item wf-st-${cls}">${esc(s.label)}</span>`;
    })
    .join('<span class="wf-progress-arrow">→</span>');

  const contextRows = [
    ["Order ID", ctx.order_id],
    ["Reference ID", ctx.reference_id],
    ["Courier ID", ctx.courier_id],
    ["Courier Name", ctx.courier_name],
    ["Freight", ctx.freight_amount],
    ["AWB", ctx.awb_number],
    ["Label", ctx.label_url],
    ["Tracking", ctx.tracking_status],
  ]
    .map(
      ([label, val]) => `
    <div class="wf-ctx-row">
      <span class="wf-ctx-label">${esc(label)}</span>
      <span class="wf-ctx-val">${val ? esc(val) : '<em class="muted">Not captured yet</em>'}</span>
      ${val ? copyBtn(val, label) : ""}
    </div>`
    )
    .join("");

  const cards = steps
    .map((step) => {
      const st = stepStatus(step, ctx, stepStates);
      const missing = getMissingDeps(step, ctx);
      const selected = step.id === selectedStepId ? " wf-step-selected" : "";
      let fixHtml = "";
      if (missing.length) {
        const prereq = (step.prerequisites || [])
          .map((p) => `<li>${esc(p.label)} → ${p.outputs.map((o) => esc(o)).join(", ")}</li>`)
          .join("");
        fixHtml = `
          <p class="wf-missing"><strong>Missing:</strong> ${missing.map((m) => esc(m)).join(", ")}</p>
          ${prereq ? `<p class="muted small">Run first:</p><ul class="wf-prereq">${prereq}</ul>` : ""}`;
      }
      return `
      <div class="card wf-step-card${selected}" data-step-id="${esc(step.id)}">
        <div class="wf-step-head">
          <strong>${esc(step.label)}</strong>
          <span class="wf-badge wf-badge-${st.toLowerCase().replace(" ", "-")}">${esc(st)}</span>
        </div>
        <p class="muted small">${esc(step.purpose)}</p>
        <p class="small"><strong>Required:</strong> ${esc((step.requires || []).join(" + "))}</p>
        <p class="small"><strong>Output:</strong> ${esc((step.outputs || []).join(", "))}</p>
        ${fixHtml}
        <button type="button" class="btn-secondary btn-sm wf-select-step" data-step-id="${esc(step.id)}">Select step</button>
      </div>`;
    })
    .join("");

  const selected = steps.find((s) => s.id === selectedStepId) || steps[0];
  const isGet = selected.method === "GET";
  const bodySection = isGet
    ? `<p class="muted small">This step uses <code>${esc(selected.method)}</code> — path/query parameters below (no JSON body).</p>
       <div id="wfParams"></div>`
    : `<label>Request body (JSON)</label>
       <textarea id="wfBody" rows="14"></textarea>`;

  return `
    <div class="wf-panel">
      <div class="wf-toolbar">
        <label class="wf-workflow-select-label">Workflow</label>
        <select id="wfWorkflowSelect" disabled>
          <option value="${esc(workflow.id)}">${esc(workflow.label)}</option>
        </select>
        <button type="button" class="btn-secondary btn-sm" id="wfResetBtn">Reset Workflow</button>
      </div>
      <p class="page-lead muted">${esc(workflow.description)}</p>
      <div class="note warn small" style="margin-bottom:16px">
        <strong>Real API calls:</strong> This workflow hits the live Shipmozo API and can create real orders and AWBs. Use test credentials and unique <code>order_id</code> values.
      </div>
      <div class="wf-progress">${progress}</div>
      <div class="card wf-context-panel">
        <h3>Workflow data captured</h3>
        <p class="muted small">Keys: public ${ctx.public_key ? esc(maskKey(ctx.public_key)) : "not set"} · private ${ctx.private_key ? "saved (masked)" : "not set"}</p>
        ${contextRows}
      </div>
      <div class="wf-steps-grid">${cards}</div>
      <div class="tester-grid" style="margin-top:20px">
        <div class="card tester-form">
          <h3>Step: ${esc(selected.label)}</h3>
          ${bodySection}
          <div class="tester-actions">
            <button type="button" class="btn-primary" id="wfRunStep">Run step</button>
          </div>
          <div id="wfStepNote" class="muted small"></div>
        </div>
        <div class="card">
          <h3>Response</h3>
          <div id="wfSummary" class="response-summary">Select a step and click Run step.</div>
          <div class="response-meta" id="wfMeta"></div>
          <div class="response-box"><pre id="wfOut">{}</pre></div>
        </div>
      </div>
    </div>`;
}

export function bindWorkflowPanel(root, api, state) {
  const workflow = defaultWorkflow;
  const st = state || {
    ctx: { ...loadWorkflowContext(), ...contextFromCredentials(api.getActiveCredentials()) },
    stepStates: {},
    selectedStepId: workflow.steps[0].id,
    courierNote: "",
  };
  let { ctx, stepStates, selectedStepId, courierNote } = st;

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];

  function persist() {
    saveWorkflowContext(ctx);
  }

  function refreshCredentials() {
    Object.assign(ctx, contextFromCredentials(api.getActiveCredentials()));
    persist();
  }

  function rebuild() {
    st.ctx = ctx;
    st.stepStates = stepStates;
    st.selectedStepId = selectedStepId;
    st.courierNote = courierNote;
    const mount = root.querySelector("#workflowModeMount");
    if (!mount) return;
    mount.innerHTML = renderWorkflowPanel(workflow, ctx, stepStates, selectedStepId);
    bindWorkflowPanel(root, api, st);
  }

  function buildStepBody(step) {
    if (step.buildSampleBody) return JSON.parse(JSON.stringify(step.buildSampleBody()));
    const body = JSON.parse(JSON.stringify(step.sampleBody || {}));
    if (step.id === "rate_calculator" && ctx.order_id) body.order_id = ctx.order_id;
    if (step.id === "assign_courier") {
      if (ctx.order_id) body.order_id = ctx.order_id;
      if (ctx.courier_id) body.courier_id = Number(ctx.courier_id) || ctx.courier_id;
    }
    return body;
  }

  function fillStepForm(step) {
    const paramsDiv = $("#wfParams");
    const bodyTa = $("#wfBody");
    if (paramsDiv) {
      paramsDiv.innerHTML = "";
      (step.pathParams || []).forEach((name) => {
        const lab = document.createElement("label");
        lab.textContent = `${name} (path) *`;
        const inp = document.createElement("input");
        inp.dataset.wfParam = name;
        inp.dataset.in = "path";
        inp.value = ctx[name] || ctx.awb_number || "";
        paramsDiv.appendChild(lab);
        paramsDiv.appendChild(inp);
      });
      (step.queryParams || []).forEach((name) => {
        const lab = document.createElement("label");
        lab.textContent = `${name} (query) *`;
        const inp = document.createElement("input");
        inp.dataset.wfParam = name;
        inp.dataset.in = "query";
        inp.value = ctx[name] || ctx.awb_number || "";
        paramsDiv.appendChild(lab);
        paramsDiv.appendChild(inp);
      });
    }
    if (bodyTa) {
      bodyTa.value = JSON.stringify(buildStepBody(step), null, 2);
    }
    const note = $("#wfStepNote");
    if (note) note.textContent = courierNote || "";
  }

  function buildPath(step) {
    let path = step.path;
    const qs = [];
    $("#wfParams")?.querySelectorAll("input[data-wf-param]").forEach((inp) => {
      if (inp.dataset.in === "path" && inp.value) {
        path = path.replace(`{${inp.dataset.wfParam}}`, encodeURIComponent(inp.value));
      }
      if (inp.dataset.in === "query" && inp.value) {
        qs.push(`${inp.dataset.wfParam}=${encodeURIComponent(inp.value)}`);
      }
    });
    if (!step.pathParams?.length && step.id === "generate_label" && ctx.awb_number) {
      path = path.replace("{awb_number}", encodeURIComponent(ctx.awb_number));
    }
    if (!step.queryParams?.length && step.id === "track_order" && ctx.awb_number) {
      qs.push(`awb_number=${encodeURIComponent(ctx.awb_number)}`);
    }
    if (qs.length) path += "?" + qs.join("&");
    return path;
  }

  function renderSummary(step, ok, payload, message, captured, nextStep) {
    const el = $("#wfSummary");
    if (!el) return;
    if (!ok) {
      el.className = "response-summary error";
      el.innerHTML = `<strong>Status: Failed</strong><p>${esc(message)}</p>`;
      return;
    }
    el.className = "response-summary ok";
    const capLines = Object.entries(captured)
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`)
      .join("");
    el.innerHTML = `
      <strong>Status: Success</strong>
      <p>${esc(payload?.message || message || "Request succeeded")}</p>
      ${capLines ? `<p>Captured:</p><ul>${capLines}</ul>` : ""}
      ${nextStep ? `<p><strong>Next:</strong> Run ${esc(nextStep.label)}</p>` : ""}
      ${courierNote ? `<p class="muted small">${esc(courierNote)}</p>` : ""}`;
  }

  function nextStepAfter(currentId) {
    const i = workflow.steps.findIndex((s) => s.id === currentId);
    return i >= 0 && i < workflow.steps.length - 1 ? workflow.steps[i + 1] : null;
  }

  const step = workflow.steps.find((s) => s.id === selectedStepId) || workflow.steps[0];
  fillStepForm(step);

  $$(".wf-select-step").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedStepId = btn.dataset.stepId;
      rebuild();
    });
  });

  $$(".wf-step-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      selectedStepId = card.dataset.stepId;
      rebuild();
    });
  });

  $$(".wf-copy").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const v = decodeURIComponent(btn.dataset.copy || "");
      navigator.clipboard.writeText(v);
      api.toast("Copied", "ok");
    });
  });

  $("#wfResetBtn")?.addEventListener("click", () => {
    const keys = { public_key: ctx.public_key, private_key: ctx.private_key };
    ctx = { ...emptyContext(), ...keys };
    stepStates = {};
    courierNote = "";
    persist();
    selectedStepId = workflow.steps[0].id;
    api.toast("Workflow reset (API keys kept)", "info");
    rebuild();
  });

  $("#wfRunStep")?.addEventListener("click", async () => {
    refreshCredentials();
    const current = workflow.steps.find((s) => s.id === selectedStepId);
    if (!current) return;

    const missing = getMissingDeps(current, ctx);
    if (missing.length) {
      const prereq = (current.prerequisites || []).map((p) => p.label).join(", ");
      $("#wfSummary").className = "response-summary error";
      $("#wfSummary").innerHTML = `
        <strong>This step cannot run yet</strong>
        <p>Missing: ${missing.map((m) => esc(m)).join(", ")}</p>
        <p>Run first: ${esc(prereq || "previous steps")}</p>`;
      return;
    }

    const headers = { ...api.authHeaders() };
    if (!headers["public-key"]) {
      $("#wfSummary").className = "response-summary error";
      $("#wfSummary").innerHTML =
        "<strong>Authentication Failed</strong><p>API keys are missing. Open Connect API and save your public/private keys.</p>";
      return;
    }

    let body;
    const bodyTa = $("#wfBody");
    if (current.method !== "GET" && bodyTa) {
      try {
        body = bodyTa.value.trim() ? JSON.parse(bodyTa.value) : undefined;
      } catch {
        $("#wfSummary").className = "response-summary error";
        $("#wfSummary").innerHTML =
          "<strong>Invalid JSON</strong><p>The request body is not valid JSON. Fix the syntax before running.</p>";
        return;
      }
    }

    const path = buildPath(current);
    $("#wfMeta").textContent = "Loading…";
    $("#wfRunStep").disabled = true;
    try {
      const wrapped = await api.proxyRequest({
        method: current.method,
        path,
        headers,
        body,
      });
      const payload = wrapped.data;
      const ok = payload?.result === "1";
      stepStates[current.id] = ok ? "success" : "failed";

      let captured = {};
      if (ok) {
        captured = extractFromResponse(payload, current);
        if (captured._courierNote) {
          courierNote = captured._courierNote;
          delete captured._courierNote;
        }
        Object.assign(ctx, captured);
        persist();
      }

      const failMsg = api.interpretShipmozoResponse?.(payload)?.text || payload?.message || wrapped.message || "Request failed";
      renderSummary(current, ok, payload, failMsg, captured, ok ? nextStepAfter(current.id) : null);

      $("#wfMeta").textContent = `${wrapped.status || ""} ${wrapped.statusText || ""} · ${wrapped.url || path}`.trim();
      $("#wfOut").textContent = JSON.stringify(
        { rateLimit: wrapped.rateLimit, shipmozo: payload },
        null,
        2
      );

      $$(".wf-step-card").forEach((card) => {
        const id = card.dataset.stepId;
        const st = stepStatus(workflow.steps.find((s) => s.id === id), ctx, stepStates);
        const badge = card.querySelector(".wf-badge");
        if (badge) {
          badge.textContent = st;
          badge.className = `wf-badge wf-badge-${st.toLowerCase().replace(" ", "-")}`;
        }
      });
    } catch (e) {
      stepStates[current.id] = "failed";
      $("#wfSummary").className = "response-summary error";
      $("#wfSummary").innerHTML = `<strong>Request failed</strong><p>${esc(e.message)}</p>`;
      $("#wfMeta").textContent = "Error";
      $("#wfOut").textContent = String(e.message);
    } finally {
      $("#wfRunStep").disabled = false;
    }
  });
}

export function renderModeToggle(currentMode) {
  return `
    <div class="tester-mode-bar card">
      <span class="tester-mode-label">Mode</span>
      <label class="mode-radio"><input type="radio" name="testerMode" value="single" ${currentMode === "single" ? "checked" : ""} /> Single API</label>
      <label class="mode-radio"><input type="radio" name="testerMode" value="workflow" ${currentMode === "workflow" ? "checked" : ""} /> Workflow</label>
    </div>`;
}

export function renderConnectionBar(proxyOk, keysOk) {
  let status = "proxy-unavailable";
  let label = "Proxy unavailable";
  if (proxyOk && keysOk) {
    status = "connected";
    label = "API connected";
  } else if (!keysOk && proxyOk) {
    status = "keys-missing";
    label = "Keys missing";
  }
  return `<span class="api-conn-status api-conn-${status}" id="apiConnStatus" title="Connection status">● ${label}</span>`;
}
