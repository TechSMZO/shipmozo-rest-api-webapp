import { demoWorkflows } from "./demo-scripts.js";

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

function randomDelay() {
  return 300 + Math.floor(Math.random() * 500);
}

function displayLabel(workflow) {
  return (workflow.label || "").replace(/^[A-C]\.\s*/, "");
}

function renderLandingCards() {
  return `
    <div class="demo-hero" id="demoLanding">
      <span class="demo-hero-badge">DEMO – NO ACCOUNT NEEDED</span>
      <h1 class="demo-hero-title">Watch a full workflow, no keys required</h1>
      <p class="demo-hero-lead">Pre-recorded responses. Zero network calls to Shipmozo. Perfect for a first look.</p>
      <div class="demo-workflow-cards" role="list">
        ${demoWorkflows
          .map(
            (w) => `
          <button type="button" class="demo-workflow-card" data-demo-workflow="${esc(w.id)}" role="listitem">
            <div class="demo-workflow-card-top">
              <strong class="demo-workflow-card-title">${esc(displayLabel(w))}</strong>
              <span class="demo-workflow-tag ${w.verified ? "demo-tag-verified" : "demo-tag-illustrative"}">
                ${w.verified ? "Verified" : "Illustrative"}
              </span>
            </div>
            <p class="demo-workflow-card-meta muted small">${w.steps.length} steps</p>
            <p class="demo-workflow-card-desc muted small">${esc(w.description || "")}</p>
          </button>`
          )
          .join("")}
      </div>
    </div>`;
}

export function renderDemoPage() {
  return `
    <div class="demo-layout">
      ${renderLandingCards()}
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
  const first = workflow.steps[0];
  return `
    <div class="demo-player">
      <div class="demo-player-toolbar">
        <button type="button" class="btn-secondary btn-sm" id="demoBackBtn">← Choose another workflow</button>
        <span class="demo-data-badge">DEMO DATA</span>
      </div>
      <h2>${esc(displayLabel(workflow))}</h2>
      ${
        workflow.verified
          ? ""
          : `<p class="note warn small">Illustrative data — not independently verified live.</p>`
      }
      <p class="muted small" id="demoStepHint">Press <strong>Play demo</strong> to run step 1: ${esc(first?.name || "")}. Use <strong>Next</strong> for each following API.</p>
      <div class="demo-playback-controls">
        <button type="button" class="btn-primary" id="demoPlayBtn">Play demo</button>
        <button type="button" class="btn-secondary" id="demoNextBtn" disabled>Next API →</button>
        <span class="muted small" id="demoProgressLabel">Step 0 of ${workflow.steps.length}</span>
      </div>
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
  const root = document.querySelector(".demo-layout");
  const landing = document.querySelector("#demoLanding");
  const mount = document.querySelector("#demoPlayerMount");
  let sessionId = 0;

  if (!root || !landing || !mount) return;

  function openWorkflow(workflow) {
    const sid = ++sessionId;
    let nextIndex = 0;
    let busy = false;

    landing.classList.add("hidden");
    mount.classList.remove("hidden");
    mount.innerHTML = renderPlayer(workflow);

    const playBtn = mount.querySelector("#demoPlayBtn");
    const nextBtn = mount.querySelector("#demoNextBtn");
    const progressLabel = mount.querySelector("#demoProgressLabel");
    const hint = mount.querySelector("#demoStepHint");
    const end = mount.querySelector("#demoEnd");
    const note = mount.querySelector("#demoClosingNote");

    function updateControls() {
      if (sid !== sessionId) return;
      const done = nextIndex >= workflow.steps.length;
      progressLabel.textContent = done
        ? `All ${workflow.steps.length} steps complete`
        : `Step ${nextIndex} of ${workflow.steps.length} ready`;

      if (done) {
        playBtn.disabled = true;
        playBtn.textContent = "Demo complete";
        nextBtn.disabled = true;
        if (hint) hint.textContent = "Workflow finished. Try it for real or choose another workflow.";
        end?.classList.remove("hidden");
        if (note) note.textContent = workflow.closingNote || "";
        return;
      }

      playBtn.disabled = busy || nextIndex > 0;
      playBtn.textContent = nextIndex === 0 ? "Play demo" : "Playing…";
      nextBtn.disabled = busy || nextIndex === 0;
      nextBtn.textContent =
        nextIndex === 0
          ? "Next API →"
          : nextIndex === workflow.steps.length - 1
            ? `Run last: ${workflow.steps[nextIndex].name} →`
            : `Next: ${workflow.steps[nextIndex].name} →`;

      if (hint) {
        const step = workflow.steps[nextIndex];
        hint.innerHTML =
          nextIndex === 0
            ? `Press <strong>Play demo</strong> to run step 1: ${esc(step.name)}.`
            : `Press <strong>Next</strong> to run step ${nextIndex + 1}: ${esc(step.name)}.`;
      }
    }

    async function runStep(index) {
      if (sid !== sessionId || busy || index !== nextIndex || index >= workflow.steps.length) return;
      busy = true;
      updateControls();

      const step = workflow.steps[index];
      const card = mount.querySelector(`[data-demo-step="${index}"]`);
      const pill = card?.querySelector(".demo-step-pill");
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });

      if (pill) {
        pill.textContent = "Running…";
        pill.className = "demo-step-pill demo-pill-running";
      }
      card?.classList.remove("demo-st-pending");
      card?.classList.add("demo-st-running");

      await new Promise((r) => setTimeout(r, randomDelay()));
      if (sid !== sessionId) return;

      card?.querySelector(`[data-demo-body="${index}"]`)?.classList.remove("hidden");
      if (step.labelPreview) {
        const labelSlot = card?.querySelector(`[data-demo-label="${index}"]`);
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

      nextIndex = index + 1;
      busy = false;
      updateControls();
    }

    mount.querySelector("#demoBackBtn")?.addEventListener("click", () => {
      sessionId += 1;
      mount.classList.add("hidden");
      mount.innerHTML = "";
      landing.classList.remove("hidden");
    });

    playBtn?.addEventListener("click", () => {
      if (nextIndex === 0) runStep(0);
    });

    nextBtn?.addEventListener("click", () => {
      if (nextIndex > 0 && nextIndex < workflow.steps.length) runStep(nextIndex);
    });

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

    updateControls();
  }

  root.querySelectorAll("[data-demo-workflow]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const workflow = demoWorkflows.find((w) => w.id === btn.dataset.demoWorkflow);
      if (workflow) openWorkflow(workflow);
    });
  });
}
