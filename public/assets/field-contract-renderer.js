let contractsCache = null;

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s ?? "";
  return d.innerHTML;
}

export async function loadFieldContracts() {
  if (contractsCache) return contractsCache;
  const res = await fetch("/assets/field-contracts.json");
  contractsCache = await res.json();
  return contractsCache;
}

function renderTip(entry) {
  if (!entry?.tip) return "";
  return `<p class="note tip field-contract-tip">${esc(entry.tip)}</p>`;
}

function requiredBadge(required) {
  return required
    ? `<span class="param-required-badge">Required</span>`
    : `<span class="param-optional-badge">Optional</span>`;
}

/** Wrap long inline JSON in Notes so it wraps inside the cell instead of widening the table. */
function formatNotes(notes) {
  if (!notes) return "";
  const match = String(notes).match(/^(.*?)(\[[\s\S]*\]|\{[\s\S]*\})(.*)$/);
  if (match && match[2].length >= 40) {
    const [, before, json, after] = match;
    return `${esc(before)}<pre class="field-contract-note-json">${esc(json)}</pre>${esc(after)}`;
  }
  return esc(notes);
}

/** Public copy when content is not ready — never render raw [PLACEHOLDER …] markers. */
export function unavailableCopy(kind = "example") {
  if (kind === "payload") {
    return "Full request payload reference not yet available for this endpoint.";
  }
  if (kind === "response") {
    return "Example response not yet available for this endpoint.";
  }
  return "Documentation for this section is not yet available.";
}

export function renderFieldContract(operationId, contracts, options = {}) {
  const entry = contracts?.[operationId];
  if (!entry) {
    const noBody = options.method === "GET" || options.noBody;
    return `
      <div class="field-contract-section"${noBody ? "" : ' data-docs-unverified="payload"'}>
        <h2>Request Payload Reference</h2>
        <p class="muted">${esc(noBody ? "This API does not require a request payload." : unavailableCopy("payload"))}</p>
      </div>`;
  }

  if (entry.deferred) {
    return `
      <div class="field-contract-section">
        <h2>Request Payload Reference</h2>
        <p class="note warn">NDR Action request payload reference is deferred until verified values are available.</p>
      </div>`;
  }

  // Internal: entry.placeholder marks unverified content for engineering — never show bracket markers.
  if (entry.placeholder && (!entry.fields || !entry.fields.length)) {
    return `
      <div class="field-contract-section" data-docs-unverified="payload">
        <h2>Request Payload Reference</h2>
        ${renderTip(entry)}
        <p class="note warn">${esc(entry.unavailableMessage || unavailableCopy("payload"))}</p>
      </div>`;
  }

  const notice = entry.partialNotice
    ? `<p class="note warn small">Full request payload reference not yet available — showing known fields only.</p>`
    : "";

  const rows = (entry.fields || [])
    .map(
      (f) => `
      <tr>
        <td><code>${esc(f.field)}</code></td>
        <td>${esc(f.type)}</td>
        <td>${requiredBadge(!!f.required)}</td>
        <td>${esc(f.values || "—")}</td>
        <td class="field-contract-notes">${formatNotes(f.notes || "")}</td>
      </tr>`
    )
    .join("");

  return `
    <div class="field-contract-section">
      <h2>Request Payload Reference</h2>
      ${renderTip(entry)}
      ${notice}
      <table class="field-contract-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Required</th>
            <th>Accepted values / units</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function renderFieldContractCollapsible(operationId, contracts) {
  const inner = renderFieldContract(operationId, contracts);
  return `
    <details class="field-contract-details" open>
      <summary>Request Payload Reference</summary>
      ${inner}
    </details>`;
}
