import { defaultWorkflow } from "./workflowDefinitions.js";
import {
  lifecycleWorkflow,
  extractLifecycleResponse,
  shouldSkipSchedulePickup,
  resolveAwbNumber,
} from "./lifecycle-workflow.js";

const WORKFLOW_CTX_KEY = "shipmozo_lifecycle_context";
const WORKFLOW_MODE_KEY = "shipmozo_tester_mode";

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

export function getSavedTesterMode() {
  try {
    const m = sessionStorage.getItem(WORKFLOW_MODE_KEY);
    if (m === "lifecycle" || m === "workflow") return "lifecycle";
    return "single";
  } catch {
    return "single";
  }
}

export function saveTesterMode(mode) {
  try {
    sessionStorage.setItem(WORKFLOW_MODE_KEY, mode === "lifecycle" ? "lifecycle" : "single");
  } catch {
    /* ignore */
  }
}

function emptyContext() {
  return {
    public_key: "",
    private_key: "",
    warehouse_id: "",
    warehouse_pincode: "",
    warehouse_name: "",
    order_id: "",
    reference_id: "",
    courier_id: "",
    courier_name: "",
    pickups_automatically_scheduled: "",
    awb_number: "",
    lr_number: "",
    tracking_status: "",
    delivery_pincode: "122001",
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

export function contextFromCredentials(creds) {
  return {
    public_key: creds.publicKey || "",
    private_key: creds.privateKey || "",
  };
}

export function getMissingDeps(step, ctx, workflow) {
  const requires = workflow?.stepDeps?.[step.id] || step.requires || [];
  return requires.filter((k) => {
    if (step.id === "cancel_order" && k === "awb_number" && ctx.order_id) {
      return false;
    }
    return !ctx[k];
  });
}

function stepPillStatus(step, ctx, stepStates, runningId) {
  if (runningId === step.id) return "running";
  const saved = stepStates[step.id];
  if (saved === "skipped") return "skipped";
  if (saved === "success") return "success";
  if (saved === "warn") return "warn";
  if (saved === "failed") return "failed";
  if (step.conditional === "skip_when_auto_pickup" && shouldSkipSchedulePickup(ctx)) return "skipped";
  const missing = getMissingDeps(step, ctx, { stepDeps: lifecycleWorkflow.stepDeps });
  if (missing.length) return "pending";
  return "ready";
}

function stepStatusLabel(status) {
  const map = {
    pending: "Pending",
    ready: "Ready",
    running: "Running…",
    success: "Success",
    failed: "Failed",
    skipped: "Skipped",
    warn: "Warning",
  };
  return map[status] || status;
}

function copyBtn(value, label) {
  if (!value) return "";
  return `<button type="button" class="btn-ghost btn-sm wf-copy" data-copy="${encodeURIComponent(value)}" title="Copy ${label}">Copy</button>`;
}

function renderResponseTabs(idPrefix) {
  return `
    <div class="response-tabs wf-response-tabs" role="tablist" aria-label="Response views">
      <button type="button" class="response-tab active" role="tab" data-wf-tab="${idPrefix}-body">Response Body</button>
      <button type="button" class="response-tab hidden" role="tab" data-wf-tab="${idPrefix}-label" id="${idPrefix}LabelTab">Label</button>
      <button type="button" class="response-tab" role="tab" data-wf-tab="${idPrefix}-headers">Response Headers</button>
      <button type="button" class="response-tab" role="tab" data-wf-tab="${idPrefix}-debug">Debug</button>
    </div>
    <div class="response-panel" data-wf-panel="${idPrefix}-body">
      <div class="response-box"><pre id="${idPrefix}Out">{}</pre></div>
    </div>
    <div class="response-panel hidden" data-wf-panel="${idPrefix}-label">
      <div class="label-preview hidden" id="${idPrefix}LabelPreview"></div>
    </div>
    <div class="response-panel hidden" data-wf-panel="${idPrefix}-headers">
      <div class="response-box"><pre id="${idPrefix}Headers">{}</pre></div>
    </div>
    <div class="response-panel hidden" data-wf-panel="${idPrefix}-debug">
      <div class="response-box"><pre id="${idPrefix}Debug">{}</pre></div>
    </div>`;
}

export function renderWorkflowPanel(workflow, ctx, stepStates, selectedStepId, runningStepId = null) {
  const isLifecycle = workflow.id === lifecycleWorkflow.id;
  const steps = workflow.steps;

  const progress = steps
    .map((s) => {
      const st = stepPillStatus(s, ctx, stepStates, runningStepId);
      return `<span class="wf-progress-item wf-st-${st}" data-step-pill="${esc(s.id)}">${esc(s.label)}</span>`;
    })
    .join('<span class="wf-progress-arrow">→</span>');

  const contextRows = isLifecycle
    ? [
        ["Warehouse ID", ctx.warehouse_id],
        ["Internal order_id", ctx.order_id],
        ["Courier ID", ctx.courier_id],
        ["AWB", ctx.awb_number],
      ]
    : [
        ["Order ID", ctx.order_id],
        ["Reference ID", ctx.reference_id],
        ["Courier ID", ctx.courier_id],
        ["AWB", ctx.awb_number],
      ];

  const contextHtml = contextRows
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
      const st = stepPillStatus(step, ctx, stepStates, runningStepId);
      const missing = getMissingDeps(step, ctx, workflow);
      const selected = step.id === selectedStepId ? " wf-step-selected" : "";
      let fixHtml = "";
      if (missing.length && st !== "skipped") {
        fixHtml = `<p class="wf-missing"><strong>Missing:</strong> ${missing.map((m) => esc(m)).join(", ")}</p>`;
      }
      if (step.conditional === "skip_when_auto_pickup" && shouldSkipSchedulePickup(ctx)) {
        fixHtml += `<p class="muted small">Auto pickup enabled — this step will be skipped.</p>`;
      }
      return `
      <div class="card wf-step-card${selected}" data-step-id="${esc(step.id)}">
        <div class="wf-step-head">
          <strong>${esc(step.label)}</strong>
          <span class="wf-badge wf-badge-${st}">${esc(stepStatusLabel(st))}</span>
        </div>
        <p class="muted small">${esc(step.purpose)}</p>
        ${fixHtml}
        <button type="button" class="btn-secondary btn-sm wf-select-step" data-step-id="${esc(step.id)}">Select step</button>
      </div>`;
    })
    .join("");

  const selected = steps.find((s) => s.id === selectedStepId) || steps[0];
  const isGet = selected.method === "GET";
  const deliveryPin =
    selected.hasDeliveryPincode && isLifecycle
      ? `<label for="wfDeliveryPincode">Delivery pincode</label>
         <input type="text" id="wfDeliveryPincode" value="${esc(ctx.delivery_pincode || "122001")}" />`
      : "";
  const bodySection = isGet
    ? `<p class="muted small">This step uses <code>${esc(selected.method)}</code> — path/query parameters below.</p>
       <div id="wfParams"></div>`
    : `${deliveryPin}
       <label for="wfBody">Request body (JSON)</label>
       <textarea id="wfBody" rows="14"></textarea>`;

  return `
    <div class="wf-panel">
      <div class="wf-toolbar">
        <span class="wf-workflow-select-label">${esc(workflow.label)}</span>
        <button type="button" class="btn-secondary btn-sm" id="wfResetBtn">Reset lifecycle</button>
        <button type="button" class="btn-primary btn-sm" id="wfRunAllBtn">Run full lifecycle</button>
      </div>
      <p class="page-lead muted">${esc(workflow.description)}</p>
      <div class="note warn small" style="margin-bottom:16px">
        <strong>Real API calls:</strong> Creates real orders on Dev. Every run ends with mandatory <strong>Cancel Order</strong> cleanup.
      </div>
      <div class="wf-progress">${progress}</div>
      <div class="card wf-context-panel">
        <h3>Captured values</h3>
        ${contextHtml}
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
        <div class="card tester-response-card">
          <div class="tester-response-head">
            <h3>Response</h3>
          </div>
          <div id="wfSummary" class="response-summary muted">Select a step and click Run step.</div>
          <div class="response-meta" id="wfMeta"></div>
          <div class="result-banner hidden" id="wfResultBanner" role="status"></div>
          ${renderResponseTabs("wf")}
        </div>
      </div>
    </div>`;
}

function setWfTab(root, name) {
  root.querySelectorAll("[data-wf-tab]").forEach((t) => {
    const active = t.dataset.wfTab === name;
    t.classList.toggle("active", active);
    t.setAttribute("aria-selected", String(active));
  });
  root.querySelectorAll("[data-wf-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.wfPanel !== name);
  });
}

function bindResponseTabs(root) {
  root.querySelectorAll("[data-wf-tab]").forEach((tab) => {
    tab.addEventListener("click", () => setWfTab(root, tab.dataset.wfTab));
  });
}

function renderLabelPreview(host, payload, root) {
  if (!host) return false;
  const labelTab = root?.querySelector("#wfLabelTab");
  const entries = Array.isArray(payload?.data) ? payload.data : [payload?.data];
  const rawLabel = entries.find((entry) => typeof entry?.label === "string")?.label;
  if (!rawLabel) {
    host.classList.add("hidden");
    host.innerHTML = "";
    labelTab?.classList.add("hidden");
    return false;
  }
  const source = rawLabel.startsWith("data:") ? rawLabel : `data:image/png;base64,${rawLabel.replace(/\s/g, "")}`;
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
  return true;
}

function renderStepResponse(root, api, ok, payload, wrapped, durationMs, step) {
  const banner = root.querySelector("#wfResultBanner");
  const interpretation = api.interpretShipmozoResponse?.(payload);
  if (banner) {
    if (interpretation) {
      banner.className = `result-banner ${interpretation.type}`;
      banner.innerHTML = `<strong>${esc(interpretation.title)}</strong><p>${esc(interpretation.text)}</p>`;
      banner.classList.remove("hidden");
    } else {
      banner.classList.add("hidden");
    }
  }
  const outEl = root.querySelector("#wfOut");
  if (outEl) outEl.textContent = JSON.stringify(payload ?? {}, null, 2);
  const headersEl = root.querySelector("#wfHeaders");
  if (headersEl) headersEl.textContent = JSON.stringify(wrapped?.rateLimitHeaders || {}, null, 2);
  const debugEl = root.querySelector("#wfDebug");
  if (debugEl) debugEl.textContent = JSON.stringify(
    {
      httpStatus: wrapped?.status ?? 200,
      requestDurationMs: Math.round(durationMs),
      rateLimit: wrapped?.rateLimit || {},
    },
    null,
    2
  );
  if (step?.id === "get_order_label" || step?.id === "generate_label") {
    const shown = renderLabelPreview(root.querySelector("#wfLabelPreview"), payload, root);
    setWfTab(root, shown ? "wf-label" : "wf-body");
  } else {
    root.querySelector("#wfLabelTab")?.classList.add("hidden");
    setWfTab(root, "wf-body");
  }
}

export function bindWorkflowPanel(root, api, state) {
  const workflow = lifecycleWorkflow;
  const st = state || {
    ctx: { ...loadWorkflowContext(), ...contextFromCredentials(api.getActiveCredentials()) },
    stepStates: {},
    selectedStepId: workflow.steps[0].id,
    courierNote: "",
    runningStepId: null,
    stepResponses: new Map(),
  };
  if (!st.stepResponses) st.stepResponses = new Map();
  let { ctx, stepStates, selectedStepId, courierNote, runningStepId } = st;
  const stepResponses = st.stepResponses;

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
    st.runningStepId = runningStepId;
    st.stepResponses = stepResponses;
    const mount = root.querySelector("#workflowModeMount");
    if (!mount) return;
    mount.innerHTML = renderWorkflowPanel(workflow, ctx, stepStates, selectedStepId, runningStepId);
    bindWorkflowPanel(root, api, st);
  }

  function buildStepBody(step) {
    if (step.buildSampleBody) {
      const delivery = $("#wfDeliveryPincode")?.value || ctx.delivery_pincode || "122001";
      if (step.hasDeliveryPincode) ctx.delivery_pincode = delivery;
      return JSON.parse(JSON.stringify(step.buildSampleBody(ctx, delivery)));
    }
    const body = JSON.parse(JSON.stringify(step.sampleBody || {}));
    if (step.id === "push_order" && ctx.warehouse_id) body.warehouse_id = String(ctx.warehouse_id);
    if (step.id === "assign_courier") {
      if (ctx.order_id) body.order_id = ctx.order_id;
      if (ctx.courier_id) body.courier_id = Number(ctx.courier_id) || ctx.courier_id;
    }
    if (step.id === "schedule_pickup" && ctx.order_id) body.order_id = ctx.order_id;
    if (step.id === "cancel_order") {
      if (ctx.order_id) body.order_id = ctx.order_id;
      if (ctx.awb_number) body.awb_number = ctx.awb_number;
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
    if (bodyTa) bodyTa.value = JSON.stringify(buildStepBody(step), null, 2);
    const note = $("#wfStepNote");
    if (note) note.textContent = courierNote || "";
  }

  function paramValue(name, inputValue) {
    if (inputValue) return inputValue;
    if (ctx[name]) return ctx[name];
    if (name === "awb_number" && ctx.awb_number) return ctx.awb_number;
    return "";
  }

  function buildPath(step) {
    let path = step.path;
    const qs = [];
    const seenQuery = new Set();

    $("#wfParams")?.querySelectorAll("input[data-wf-param]").forEach((inp) => {
      const name = inp.dataset.wfParam;
      const val = paramValue(name, inp.value?.trim());
      if (inp.dataset.in === "path" && val) {
        path = path.replace(`{${name}}`, encodeURIComponent(val));
      }
      if (inp.dataset.in === "query" && val) {
        qs.push(`${name}=${encodeURIComponent(val)}`);
        seenQuery.add(name);
      }
    });

    (step.pathParams || []).forEach((name) => {
      if (path.includes(`{${name}}`)) {
        const val = paramValue(name, "");
        if (val) path = path.replace(`{${name}}`, encodeURIComponent(val));
      }
    });

    (step.queryParams || []).forEach((name) => {
      if (seenQuery.has(name)) return;
      const val = paramValue(name, "");
      if (val) qs.push(`${name}=${encodeURIComponent(val)}`);
    });

    if (qs.length) path += "?" + qs.join("&");
    return path;
  }

  async function executeStep(step) {
    refreshCredentials();
    if (step.conditional === "skip_when_auto_pickup" && shouldSkipSchedulePickup(ctx)) {
      stepStates[step.id] = "skipped";
      return { ok: true, skipped: true, payload: { message: "Skipped — pickups automatically scheduled" } };
    }

    const missing = getMissingDeps(step, ctx, workflow);
    if (missing.length) {
      throw new Error(`Missing: ${missing.join(", ")}`);
    }

    const headers = { ...api.authHeaders() };
    if (!headers["public-key"]) {
      throw new Error("API keys are missing. Open Connect API and save your public/private keys.");
    }

    let body;
    if (step.method !== "GET") {
      try {
        body = buildStepBody(step);
        const bodyTa = $("#wfBody");
        if (bodyTa?.value.trim()) body = JSON.parse(bodyTa.value);
      } catch {
        throw new Error("Invalid JSON in request body");
      }
    }

    const path = buildPath(step);
    const startedAt = performance.now();
    const wrapped = await api.proxyRequest({ method: step.method, path, headers, body });
    const durationMs = performance.now() - startedAt;
    const payload = wrapped.data;
    const ok = payload?.result === "1";
    return { ok, payload, wrapped, durationMs, path };
  }

  function renderSummary(step, result) {
    const el = $("#wfSummary");
    if (!el) return;
    if (result.skipped) {
      el.className = "response-summary muted";
      el.innerHTML = `<strong>Skipped</strong><p>${esc(result.payload.message)}</p>`;
      return;
    }
    if (!result.ok) {
      const warn = step.warnOnFail;
      el.className = warn ? "response-summary warn" : "response-summary error";
      const msg = api.interpretShipmozoResponse?.(result.payload)?.text || result.payload?.message || "Request failed";
      el.innerHTML = `<strong>${warn ? "Warning" : "Failed"}</strong><p>${esc(msg)}</p>`;
      return;
    }
    el.className = "response-summary ok";
    el.innerHTML = `<strong>Success</strong><p>${esc(result.payload?.message || "Request succeeded")}</p>`;
  }

  async function runStep(step, silent = false) {
    if (!silent) {
      runningStepId = step.id;
      rebuild();
    }
    try {
      const result = await executeStep(step);
      if (result.skipped) {
        stepStates[step.id] = "skipped";
        if (!silent) renderSummary(step, result);
        return result;
      }
      const ok = result.ok;
      if (step.warnOnFail && !ok) stepStates[step.id] = "warn";
      else stepStates[step.id] = ok ? "success" : "failed";

        if (ok) {
          await applyStepCapture(step, result);
        }

      stepResponses.set(step.id, { step, result });

      if (!silent) {
        renderSummary(step, result);
        $("#wfMeta").textContent = `${result.wrapped?.status || ""} ${result.path || ""} · ${Math.round(result.durationMs)} ms`.trim();
        renderStepResponse(root, api, ok, result.payload, result.wrapped, result.durationMs, step);
      }
      return result;
    } finally {
      if (!silent) {
        runningStepId = null;
        rebuild();
      }
    }
  }

  async function applyStepCapture(step, result) {
    const captured = extractLifecycleResponse(result.payload, step);
    if (captured._courierNote) {
      courierNote = captured._courierNote;
      delete captured._courierNote;
    }
    Object.assign(ctx, captured);
    if (step.id === "assign_courier" && !ctx.awb_number) {
      const awb = await resolveAwbNumber(api, ctx);
      if (awb) {
        ctx.awb_number = awb;
        courierNote =
          (courierNote ? `${courierNote} ` : "") +
          "AWB resolved via get-order-detail (auto-pickup courier).";
      }
    }
    if (
      (step.id === "track_order" || step.id === "get_order_label") &&
      !ctx.awb_number &&
      ctx.order_id
    ) {
      const awb = await resolveAwbNumber(api, ctx);
      if (awb) ctx.awb_number = awb;
    }
    persist();
  }

  async function runLifecycleStep(step, { silent = false } = {}) {
    if (step.conditional === "skip_when_auto_pickup" && shouldSkipSchedulePickup(ctx)) {
      stepStates[step.id] = "skipped";
      return { ok: true, skipped: true, payload: { message: "Skipped — pickups automatically scheduled" } };
    }

    if (!silent) {
      runningStepId = step.id;
      selectedStepId = step.id;
      rebuild();
      fillStepForm(step);
    }

    const result = await executeStep(step);
    if (result.skipped) {
      stepStates[step.id] = "skipped";
      return result;
    }

    const ok = result.ok;
    if (step.warnOnFail && !ok) stepStates[step.id] = "warn";
    else stepStates[step.id] = ok ? "success" : "failed";

    if (ok) {
      await applyStepCapture(step, result);
    }

    stepResponses.set(step.id, { step, result });

    if (!silent) {
      renderSummary(step, result);
      $("#wfMeta").textContent = `${result.wrapped?.status || ""} ${result.path || ""} · ${Math.round(result.durationMs)} ms`.trim();
      renderStepResponse(root, api, ok, result.payload, result.wrapped, result.durationMs, step);
    }

    return result;
  }

  async function runFullLifecycle() {
    const runAllBtn = $("#wfRunAllBtn");
    if (runAllBtn) runAllBtn.disabled = true;
    refreshCredentials();
    runningStepId = null;
    api.toast?.("Running full lifecycle…", "info");

    const cancelStep = workflow.steps.find((s) => s.id === "cancel_order");
    const mainSteps = workflow.steps.filter((s) => s.id !== "cancel_order");
    let chainBroken = false;
    let lastFailedStep = null;

    for (const step of mainSteps) {
      try {
        const result = await runLifecycleStep(step);
        $("#wfRunAllBtn") && ($("#wfRunAllBtn").disabled = true);
        if (result.skipped) continue;

        if (!result.ok && !step.warnOnFail) {
          chainBroken = true;
          lastFailedStep = step;
          api.toast?.(`${step.label} failed — continuing to mandatory cancel`, "error");
          break;
        }

        await new Promise((r) => setTimeout(r, 400));
      } catch (e) {
        stepStates[step.id] = "failed";
        chainBroken = true;
        lastFailedStep = step;
        api.toast?.(e.message, "error");
        break;
      }
    }

    if (cancelStep && ctx.order_id) {
      try {
        if (!ctx.awb_number) {
          const awb = await resolveAwbNumber(api, ctx, { attempts: 3, delayMs: 1000 });
          if (awb) ctx.awb_number = awb;
          persist();
        }
        runningStepId = cancelStep.id;
        selectedStepId = cancelStep.id;
        rebuild();
        fillStepForm(cancelStep);
        const cancelResult = await runLifecycleStep(cancelStep);
        if (!cancelResult.ok && !cancelResult.skipped) {
          api.toast?.("Cancel order failed — check Dev panel for orphaned test order", "error");
        }
      } catch (e) {
        stepStates.cancel_order = "failed";
        api.toast?.(`Cancel order error: ${e.message}`, "error");
      }
    } else if (chainBroken && lastFailedStep) {
      api.toast?.(`${lastFailedStep.label} failed — no order_id for cancel`, "error");
    }

    runningStepId = null;
    rebuild();
    if (runAllBtn) runAllBtn.disabled = false;
    const cancelState = stepStates.cancel_order;
    if (cancelState === "success" || cancelState === "warn") {
      api.toast?.("Lifecycle complete — order cleanup attempted", cancelState === "warn" ? "info" : "ok");
    } else if (!chainBroken && cancelState === "skipped") {
      api.toast?.("Lifecycle complete", "ok");
    }
  }

  const step = workflow.steps.find((s) => s.id === selectedStepId) || workflow.steps[0];
  fillStepForm(step);
  bindResponseTabs(root);

  // Restore cached response for the selected step
  const cached = stepResponses.get(selectedStepId);
  if (cached && cached.result && !cached.result.skipped) {
    renderSummary(cached.step, cached.result);
    const meta = $("#wfMeta");
    if (meta) meta.textContent = `${cached.result.wrapped?.status || ""} ${cached.result.path || ""} · ${Math.round(cached.result.durationMs)} ms`.trim();
    renderStepResponse(root, api, cached.result.ok, cached.result.payload, cached.result.wrapped, cached.result.durationMs, cached.step);
  } else if (cached && cached.result?.skipped) {
    renderSummary(cached.step, cached.result);
  }

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
      api.toast?.("Copied", "ok");
    });
  });

  $("#wfResetBtn")?.addEventListener("click", () => {
    const keys = { public_key: ctx.public_key, private_key: ctx.private_key };
    ctx = { ...emptyContext(), ...keys };
    stepStates = {};
    courierNote = "";
    persist();
    selectedStepId = workflow.steps[0].id;
    api.toast?.("Lifecycle reset (API keys kept)", "info");
    rebuild();
  });

  $("#wfRunAllBtn")?.addEventListener("click", () => runFullLifecycle());

  $("#wfRunStep")?.addEventListener("click", async () => {
    const current = workflow.steps.find((s) => s.id === selectedStepId);
    if (!current) return;
    try {
      await runStep(current);
    } catch (e) {
      $("#wfSummary").className = "response-summary error";
      $("#wfSummary").innerHTML = `<strong>Request failed</strong><p>${esc(e.message)}</p>`;
    }
  });
}

export function renderModeToggle(currentMode) {
  const lifecycle = currentMode === "lifecycle" || currentMode === "workflow";
  return `
    <div class="tester-mode-bar card">
      <span class="tester-mode-label">Mode</span>
      <label class="mode-radio"><input type="radio" name="testerMode" value="single" ${!lifecycle ? "checked" : ""} /> Single API</label>
      <label class="mode-radio"><input type="radio" name="testerMode" value="lifecycle" ${lifecycle ? "checked" : ""} /> Lifecycle simulator</label>
      <a href="#/demo" class="btn-secondary btn-sm tester-demo-link">Demo — no account needed</a>
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

/** @deprecated kept for workflowDefinitions.js compatibility */
export { defaultWorkflow };
