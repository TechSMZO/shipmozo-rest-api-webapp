import { demoWorkflows } from "./demo-scripts.js";

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function randomDelay() {
  return 300 + Math.floor(Math.random() * 500);
}

export function renderDemoPage() {
  return `
    <div class="demo-layout">
      <h1 class="page-title">Run Demo</h1>
      <p class="page-lead">Watch a full shipment workflow with <strong>no API keys</strong> and <strong>no network calls</strong>. Every response is pre-recorded demo data.</p>
      <div class="demo-badge-bar"><span class="demo-data-badge">DEMO DATA</span> All responses below are simulated — not live Shipmozo data.</div>
      <div class="demo-workflow-picker card">
        <label for="demoWorkflowSelect">Choose workflow</label>
        <select id="demoWorkflowSelect">
          ${demoWorkflows.map((w) => `<option value="${esc(w.id)}">${esc(w.label)}${w.verified ? "" : " (illustrative)"}</option>`).join("")}
        </select>
        <p class="muted small" id="demoWorkflowDesc"></p>
        <button type="button" class="btn-primary" id="demoStartBtn">Start demo</button>
      </div>
      <div id="demoPlayerMount" class="demo-player-mount hidden"></div>
    </div>`;
}

function renderStepCard(step, index, status) {
  const statusLabel = { pending: "Pending", running: "Running…", done: "Done" }[status] || status;
  return `
    <div class="demo-step-card demo-st-${status}" data-demo-step="${index}">
      <div class="demo-step-head">
        <strong>${index + 1}. ${esc(step.name)}</strong>
        <span class="demo-step-pill demo-pill-${status}">${statusLabel}</span>
      </div>
      <p class="demo-step-purpose muted small">${esc(step.purpose || `${step.method} ${step.path}`)}</p>
      <div class="demo-step-body hidden" data-demo-body="${index}">
        <p class="small"><code>${esc(step.method)} ${esc(step.path)}</code></p>
        ${step.request ? `<pre class="demo-request">${esc(JSON.stringify(step.request, null, 2))}</pre>` : ""}
        <div class="demo-response-wrap">
          <span class="demo-data-badge">DEMO DATA</span>
          <pre class="demo-response">${esc(JSON.stringify(step.response, null, 2))}</pre>
        </div>
        <div class="demo-label-slot hidden" data-demo-label="${index}"></div>
      </div>
    </div>`;
}

function renderPlayer(workflow) {
  return `
    <div class="demo-player">
      <h2>${esc(workflow.label)}</h2>
      ${workflow.verified ? "" : `<p class="note warn small">⚠️ Illustrative data — not independently verified live.</p>`}
      <div class="demo-steps-grid" id="demoSteps">
        ${workflow.steps.map((s, i) => renderStepCard(s, i, "pending")).join("")}
      </div>
      <div class="demo-end hidden" id="demoEnd">
        <p id="demoClosingNote"></p>
        <a href="#" class="btn-primary" id="demoTryRealBtn">Try this for real →</a>
      </div>
    </div>`;
}

export function bindDemoPage() {
  const select = document.querySelector("#demoWorkflowSelect");
  const desc = document.querySelector("#demoWorkflowDesc");
  const mount = document.querySelector("#demoPlayerMount");
  const startBtn = document.querySelector("#demoStartBtn");

  function updateDesc() {
    const wf = demoWorkflows.find((w) => w.id === select.value);
    if (desc && wf) desc.textContent = wf.description;
  }

  select?.addEventListener("change", updateDesc);
  updateDesc();

  startBtn?.addEventListener("click", async () => {
    const workflow = demoWorkflows.find((w) => w.id === select.value);
    if (!workflow || !mount) return;
    mount.classList.remove("hidden");
    mount.innerHTML = renderPlayer(workflow);
    startBtn.disabled = true;

    for (let i = 0; i < workflow.steps.length; i++) {
      const card = mount.querySelector(`[data-demo-step="${i}"]`);
      const pill = card?.querySelector(".demo-step-pill");
      if (pill) {
        pill.textContent = "Running…";
        pill.className = "demo-step-pill demo-pill-running";
      }
      card?.classList.remove("demo-st-pending");
      card?.classList.add("demo-st-running");
      await new Promise((r) => setTimeout(r, randomDelay()));
      card?.querySelector(`[data-demo-body="${i}"]`)?.classList.remove("hidden");
      if (workflow.steps[i].labelPreview) {
        const labelSlot = card?.querySelector(`[data-demo-label="${i}"]`);
        if (labelSlot) {
          labelSlot.classList.remove("hidden");
          labelSlot.innerHTML = `<h3>Shipping label preview</h3><img src="/assets/demo-label.svg" alt="Demo shipping label" class="demo-label-img" />`;
        }
      }
      if (pill) {
        pill.textContent = "Done";
        pill.className = "demo-step-pill demo-pill-done";
      }
      card?.classList.remove("demo-st-running");
      card?.classList.add("demo-st-done");
    }

    const end = mount.querySelector("#demoEnd");
    end?.classList.remove("hidden");
    const note = mount.querySelector("#demoClosingNote");
    if (note) note.textContent = workflow.closingNote || "";

    mount.querySelector("#demoTryRealBtn")?.addEventListener("click", (e) => {
      e.preventDefault();
      const h = workflow.handoff;
      if (h?.mode === "lifecycle") {
        sessionStorage.setItem("shipmozo_tester_mode", "lifecycle");
        location.hash = "#/execute?mode=lifecycle";
      } else if (h?.op) {
        sessionStorage.setItem("shipmozo_tester_mode", "single");
        location.hash = `#/execute?op=${encodeURIComponent(h.op)}`;
      } else {
        location.hash = "#/execute";
      }
    });

    startBtn.disabled = false;
  });
}
