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

export function renderFieldContract(operationId, contracts) {
  const entry = contracts?.[operationId];
  if (!entry) {
    return `
      <div class="field-contract-section">
        <h2>Request Payload Reference</h2>
        <p class="muted">Not yet documented for this endpoint.</p>
      </div>`;
  }

  if (entry.deferred) {
    return `
      <div class="field-contract-section">
        <h2>Request Payload Reference</h2>
        <p class="note warn">NDR Action request payload reference is explicitly deferred — values not yet provided.</p>
      </div>`;
  }

  if (entry.placeholder && (!entry.fields || !entry.fields.length)) {
    return `
      <div class="field-contract-section">
        <h2>Request Payload Reference</h2>
        ${renderTip(entry)}
        <p class="note warn"><strong>[PLACEHOLDER — entire table]</strong> Full request payload reference not yet available for ${esc(entry.title || operationId)}.</p>
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
        <td>${f.required ? "Yes" : "No"}</td>
        <td>${esc(f.values || "—")}</td>
        <td>${esc(f.notes || "")}</td>
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
