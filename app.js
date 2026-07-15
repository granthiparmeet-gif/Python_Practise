const state = {
  loading: true,
  error: "",
  domains: [],
  sourceInfo: {
    dynadot: false,
    namesilo: false,
    sav: false,
    spaceship: false,
    unstoppable: false,
    gmail: false,
  },
  sort: { key: "name", direction: "asc" },
};

const statusEl = document.getElementById("status");
const tableBodyEl = document.getElementById("domains-table-body");
const refreshBtn = document.getElementById("refresh-btn");
const providerStatusEl = document.getElementById("provider-status");
const headerButtons = Array.from(document.querySelectorAll("[data-sort]"));
const sortClickTimers = new Map();

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
      gmail: Boolean(data.providers?.gmail?.connected),
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
  providerBits.push(state.sourceInfo.gmail ? "Gmail connected" : "Gmail disconnected");
  if (state.providerErrors?.length) {
    providerBits.push(
      ...state.providerErrors.map((item) => `${item.provider}: ${item.error}`),
    );
  }
  providerStatusEl.textContent = providerBits.join(" | ");

  if (!state.sourceInfo.gmail) {
    providerStatusEl.textContent += " | Run `npm run gmail:setup` once to authorize Gmail.";
  }

  if (state.loading) {
    tableBodyEl.innerHTML = `<tr><td class="empty-cell" colspan="7">Fetching your portfolio from Dynadot, NameSilo, Sav, Spaceship, Unstoppable Domains, and Gmail.</td></tr>`;
    return;
  }

  if (state.error) {
    tableBodyEl.innerHTML = `<tr><td class="empty-cell error" colspan="7">${escapeHtml(state.error)}</td></tr>`;
    return;
  }

  if (!state.domains.length) {
    tableBodyEl.innerHTML = `<tr><td class="empty-cell" colspan="7">No domains returned by the connected APIs yet.</td></tr>`;
    return;
  }

  updateSortHeaders();

  const rows = getSortedDomains();

  tableBodyEl.innerHTML = rows
    .map(
      (domain) => `
        <tr>
          <td class="domain-name ${providerClass(domain.source)}">${escapeHtml(domain.name || "Unknown")}</td>
          <td>${escapeHtml(formatPurchase(domain.purchasePrice ?? domain.purchaseAmount) || (state.sourceInfo.gmail ? "" : "Setup pending"))}</td>
          <td>${escapeHtml(displayDate(domain.expiry))}</td>
          <td class="${daysRemainingClass(domain.expiry)}">${escapeHtml(daysRemainingValue(domain.expiry))}</td>
          <td>${escapeHtml(domain.registrar || domain.source || "-")}</td>
          <td>${escapeHtml(displayDate(domain.purchaseDate || domain.boughtOn) || (state.sourceInfo.gmail ? "" : "Setup pending"))}</td>
          <td>${escapeHtml(displayHolding(domain.holdingDays || domain.holding, domain.purchaseDate || domain.boughtOn) || (state.sourceInfo.gmail ? "" : "Setup pending"))}</td>
        </tr>
      `,
    )
    .join("");
}

function getSortedDomains() {
  const rows = [...state.domains];
  const { key, direction } = state.sort;
  const sortDirection = direction === "desc" ? -1 : 1;

  return rows.sort((a, b) => {
    const left = getSortValue(a, key);
    const right = getSortValue(b, key);

    const leftBlank = isBlankValue(left);
    const rightBlank = isBlankValue(right);
    if (leftBlank && rightBlank) return 0;
    if (leftBlank) return 1;
    if (rightBlank) return -1;

    const comparison = compareSortValues(left, right, key);
    return comparison * sortDirection;
  });
}

function getSortValue(domain, key) {
  switch (key) {
    case "name":
      return domain.name || "";
    case "purchase":
      return parseMoneyValue(domain.purchaseAmount ?? domain.purchasePrice ?? "");
    case "expiry":
      return domain.expiry || "";
    case "daysRemaining":
      return daysRemainingValue(domain.expiry);
    case "registrar":
      return domain.registrar || domain.source || "";
    case "boughtOn":
      return domain.purchaseDate || domain.boughtOn || "";
    case "holding":
      return domain.holdingDays || domain.holding || "";
    default:
      return domain[key] ?? "";
  }
}

function compareSortValues(left, right, key) {
  if (key === "purchase" || key === "daysRemaining" || key === "holding") {
    return Number(left) - Number(right);
  }

  if (key === "expiry" || key === "boughtOn") {
    return Date.parse(left) - Date.parse(right);
  }

  return String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
}

function isBlankValue(value) {
  return value === null || value === undefined || value === "";
}

function setSort(key, direction) {
  state.sort = { key, direction };
  updateSortHeaders();
  render();
}

function toggleSort(key) {
  if (state.sort.key === key) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort.key = key;
    state.sort.direction = "desc";
  }
  updateSortHeaders();
  render();
}

function updateSortHeaders() {
  headerButtons.forEach((button) => {
    const active = button.dataset.sort === state.sort.key;
    button.classList.toggle("is-sorted", active);
    button.setAttribute("aria-sort", active ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none");
  });
}

function daysRemainingValue(expiry) {
  if (!expiry) return "";
  const parsed = Date.parse(expiry);
  if (Number.isNaN(parsed)) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(parsed);
  target.setHours(0, 0, 0, 0);
  return String(Math.round((target - today) / 86400000));
}

function daysRemainingClass(expiry) {
  const value = Number(daysRemainingValue(expiry));
  if (!Number.isFinite(value)) return "";
  if (value < 0) return "days-over";
  if (value <= 30) return "days-soon";
  return "";
}

function providerClass(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("dynadot")) return "provider-dynadot";
  if (normalized.includes("namesilo")) return "provider-namesilo";
  if (normalized.includes("sav")) return "provider-sav";
  if (normalized.includes("spaceship")) return "provider-spaceship";
  if (normalized.includes("unstoppable")) return "provider-unstoppable";
  return "";
}

function displayDate(value) {
  if (!value) return "";
  const text = String(value);
  const datePart = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(text) ? text.slice(0, 10) : "";

  if (datePart) {
    const [year, month, day] = datePart.split("-").map(Number);
    if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, day)));
    }
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(parsed));
  }

  return text;
}

function formatPurchase(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  return String(value);
}

function displayHolding(value, purchaseDate) {
  if (value !== null && value !== undefined && value !== "") return String(value);
  if (!purchaseDate) return "";
  const parsed = Date.parse(String(purchaseDate));
  if (Number.isNaN(parsed)) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const purchase = new Date(parsed);
  purchase.setHours(0, 0, 0, 0);
  return String(Math.max(0, Math.round((today - purchase) / 86400000)));
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

headerButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;
    const existing = sortClickTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      toggleSort(key);
      sortClickTimers.delete(key);
    }, 160);

    sortClickTimers.set(key, timer);
  });

  button.addEventListener("dblclick", (event) => {
    event.preventDefault();
    const key = button.dataset.sort;
    const existing = sortClickTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      sortClickTimers.delete(key);
    }
    setSort(key, "asc");
  });
});

refreshBtn.addEventListener("click", loadDomains);

loadDomains();
