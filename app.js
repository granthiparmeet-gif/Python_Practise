const state = {
  loading: true,
  error: "",
  domains: [],
  sourceInfo: { dynadot: false, namesilo: false, sav: false, spaceship: false, unstoppable: false },
};

const statusEl = document.getElementById("status");
const listEl = document.getElementById("domains-list");
const refreshBtn = document.getElementById("refresh-btn");
const providerStatusEl = document.getElementById("provider-status");

async function loadDomains() {
  state.loading = true;
  state.error = "";
  render();

  try {
    const response = await fetch("/api/domains");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.details || data?.error || "Failed to load domains");
    }
    state.domains = Array.isArray(data.domains) ? data.domains : [];
    state.providerErrors = Array.isArray(data.providerErrors) ? data.providerErrors : [];
    state.sourceInfo = {
      dynadot: Boolean(data.providers?.dynadot?.ok),
      namesilo: Boolean(data.providers?.namesilo?.ok),
      sav: Boolean(data.providers?.sav?.ok),
      spaceship: Boolean(data.providers?.spaceship?.ok),
      unstoppable: Boolean(data.providers?.unstoppable?.ok),
    };
  } catch (error) {
    state.error = error.message || "Unexpected error";
    state.domains = [];
    state.providerErrors = [];
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  if (state.loading) {
    statusEl.textContent = "Loading domains...";
  } else if (state.error) {
    statusEl.textContent = state.error;
  } else {
    statusEl.textContent = `${state.domains.length} domain${state.domains.length === 1 ? "" : "s"} found`;
  }

  const providerBits = [];
  if (state.sourceInfo.dynadot) providerBits.push("Dynadot connected");
  if (state.sourceInfo.namesilo) providerBits.push("NameSilo connected");
  if (state.sourceInfo.sav) providerBits.push("Sav connected");
  if (state.sourceInfo.spaceship) providerBits.push("Spaceship connected");
  if (state.sourceInfo.unstoppable) providerBits.push("Unstoppable connected");
  if (state.providerErrors?.length) {
    providerBits.push(
      ...state.providerErrors.map((item) => `${item.provider}: ${item.error}`),
    );
  }
  providerStatusEl.textContent = providerBits.join(" | ");

  if (state.loading) {
    listEl.innerHTML = `<div class="empty-state">Fetching your portfolio from Dynadot, NameSilo, Sav, Spaceship, and Unstoppable Domains.</div>`;
    return;
  }

  if (state.error) {
    listEl.innerHTML = `<div class="empty-state error">${escapeHtml(state.error)}</div>`;
    return;
  }

  if (!state.domains.length) {
    listEl.innerHTML = `<div class="empty-state">No domains returned by the connected APIs yet.</div>`;
    return;
  }

  listEl.innerHTML = state.domains
    .map(
      (domain) => `
        <article class="domain-card">
          <div class="domain-head">
            <div>
              <h2>${escapeHtml(domain.name || "Unknown")}</h2>
              <p>${escapeHtml(domain.status || "status unavailable")}</p>
            </div>
            <span class="source-badge">${escapeHtml(domain.source || "API")}</span>
          </div>
          <dl>
            <div>
              <dt>Registrar</dt>
              <dd>${escapeHtml(domain.registrar || domain.source || "-")}</dd>
            </div>
            <div>
              <dt>Purchased</dt>
              <dd>${escapeHtml(domain.registration || "-")}</dd>
            </div>
            <div>
              <dt>Expiry</dt>
              <dd>${escapeHtml(domain.expiry || "-")}</dd>
            </div>
            <div>
              <dt>Renew</dt>
              <dd>${escapeHtml(domain.renewOption || "-")}</dd>
            </div>
            <div>
              <dt>Transfer</dt>
              <dd>${escapeHtml(domain.transferStatus || "-")}</dd>
            </div>
            <div>
              <dt>Privacy</dt>
              <dd>${escapeHtml(domain.privacy || "-")}</dd>
            </div>
            <div>
              <dt>Registry</dt>
              <dd>${escapeHtml(domain.registryType || "-")}</dd>
            </div>
          </dl>
        </article>
      `,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

refreshBtn.addEventListener("click", loadDomains);
loadDomains();
