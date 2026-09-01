const SHARED_VIEWS = [
  { value: "sold", label: "Sold" },
  { value: "expired", label: "Expired" },
  { value: "expenses", label: "Expenses" },
];

function isSharedView(view) {
  return SHARED_VIEWS.some((item) => item.value === view);
}

const state = {
  loading: true,
  error: "",
  view: localStorage.getItem("domainLedgerView") || "",
  mailboxes: [],
  reminders: null,
  rndCoverage: null,
  defaultAccount: "",
  domains: [],
  views: {
    sold: [],
    expired: [],
    expenses: [],
  },
  providerErrors: [],
  currency: localStorage.getItem("domainLedgerCurrency") === "INR" ? "INR" : "USD",
  sourceInfo: {
    dynadot: false,
    namesilo: false,
    spaceship: false,
    unstoppable: false,
    gmail: false,
  },
  sort: { key: "name", direction: "asc" },
  search: "",
};

const statusEl = document.getElementById("status");
const healthBarEl = document.getElementById("health-bar");
const viewKickerEl = document.getElementById("view-kicker");
const viewSummaryEl = document.getElementById("view-summary");
const tableBodyEl = document.getElementById("domains-table-body");
const tableHeadEl = document.getElementById("table-head");
const refreshBtn = document.getElementById("refresh-btn");
const gmailSyncBtn = document.getElementById("gmail-sync-btn");
const currencyUsdBtn = document.getElementById("currency-usd-btn");
const currencyInrBtn = document.getElementById("currency-inr-btn");
const providerStatusEl = document.getElementById("provider-status");
const remindersBannerEl = document.getElementById("reminders-banner");
const viewSelect = document.getElementById("view-select");
const domainSearchEl = document.getElementById("domain-search");
const tableEl = document.getElementById("main-table");
const tableWrapEl = document.querySelector(".table-wrap");
const tableColsEl = document.getElementById("table-cols");
const connectMailboxLink = document.getElementById("connect-mailbox-link");
const manualBtn = document.getElementById("manual-entry-btn");
const manualDialog = document.getElementById("manual-dialog");
const manualForm = document.getElementById("manual-form");
const manualMailbox = document.getElementById("manual-mailbox");
const sourceDialog = document.getElementById("source-dialog");
const sourceDialogTitle = document.getElementById("source-dialog-title");
const sourceDialogSummary = document.getElementById("source-dialog-summary");
const sourceDialogList = document.getElementById("source-dialog-list");
const sourceDialogMail = document.getElementById("source-dialog-mail");
const sourceDialogClose = document.getElementById("source-dialog-close");
const sourceBackBtn = document.getElementById("source-back-btn");
const sourceMailSubject = document.getElementById("source-mail-subject");
const sourceMailMeta = document.getElementById("source-mail-meta");
const sourceMailBody = document.getElementById("source-mail-body");
const sourceMailOpen = document.getElementById("source-mail-open");

let sourceDialogEvents = [];
let sourceRequestSeq = 0;
let sourceEmailSeq = 0;
let sourceListAbort = null;
let sourceMailAbort = null;

function mailboxAlias(email) {
  const key = String(email || "")
    .trim()
    .toLowerCase();
  if (!key) return "";
  const mailbox = state.mailboxes.find((item) => item.email === key);
  if (mailbox?.alias || mailbox?.label) return mailbox.alias || mailbox.label;
  return key.includes("@") ? key.split("@")[0] : String(email || "");
}

function setDisplayCurrency(currency) {
  state.currency = currency === "INR" ? "INR" : "USD";
  localStorage.setItem("domainLedgerCurrency", state.currency);
  if (currencyUsdBtn) currencyUsdBtn.classList.toggle("is-active", state.currency === "USD");
  if (currencyInrBtn) currencyInrBtn.classList.toggle("is-active", state.currency === "INR");
  render();
}

function setView(view) {
  state.view = view || state.defaultAccount || state.mailboxes[0]?.email || "sold";
  localStorage.setItem("domainLedgerView", state.view);
  if (viewSelect) viewSelect.value = state.view;
  state.sort = defaultSortForView(state.view);
  updateConnectLink();
  render();
}

function updateConnectLink() {
  if (!connectMailboxLink) return;
  connectMailboxLink.hidden = true;
}

function populateMailboxControls(mailboxes, defaultAccount) {
  state.mailboxes = Array.isArray(mailboxes) ? mailboxes : [];
  state.defaultAccount = defaultAccount || state.mailboxes.find((item) => item.primary)?.email || state.mailboxes[0]?.email || "";

  if (viewSelect) {
    const mailboxOptions = state.mailboxes
      .map((item) => {
        const mark = item.connected ? "" : " (not connected)";
        return `<option value="${escapeHtml(item.email)}" title="${escapeHtml(item.email)}">${escapeHtml(mailboxAlias(item.email))}${mark}</option>`;
      })
      .join("");
    const fixedOptions = SHARED_VIEWS.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
    viewSelect.innerHTML = `${mailboxOptions}${fixedOptions}`;
  }

  if (manualMailbox) {
    manualMailbox.innerHTML = state.mailboxes
      .map((item) => `<option value="${escapeHtml(item.email)}">${escapeHtml(mailboxAlias(item.email))}</option>`)
      .join("");
  }

  const preferred = state.view && (state.views[state.view] || isSharedView(state.view))
    ? state.view
    : state.defaultAccount;
  setView(preferred || "sold");
}

function defaultSortForView(view) {
  if (view === "sold") return { key: "saleDate", direction: "desc" };
  if (view === "expenses") return { key: "date", direction: "desc" };
  return { key: "name", direction: "asc" };
}

async function loadMailboxes() {
  try {
    const response = await fetch("/api/mailboxes");
    const data = await response.json();
    if (response.ok) {
      populateMailboxControls(data.mailboxes || [], data.defaultAccount || "");
      return;
    }
  } catch {
    // fall through
  }
  populateMailboxControls([], "");
}

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
    state.views = {
      sold: data.views?.sold || data.soldDomains || [],
      expired: data.views?.expired || data.expiredDomains || [],
      expenses: data.views?.expenses || data.expenses || [],
    };
    for (const mailbox of data.mailboxes || []) {
      state.views[mailbox.email] = data.views?.[mailbox.email] || [];
    }
    if (data.mailboxes?.length) {
      populateMailboxControls(
        data.mailboxes.map((item) => ({
          ...item,
          connected: data.providers?.gmail?.accounts?.find((row) => row.email === item.email)?.connected,
        })),
        data.providers?.gmail?.defaultAccount || data.mailboxes.find((item) => item.primary)?.email || "",
      );
    }
    state.providerErrors = Array.isArray(data.providerErrors) ? data.providerErrors : [];
    state.reminders = data.reminders || null;
    state.rndCoverage = data.rndCoverage || null;
    state.sourceInfo = {
      dynadot: Boolean(data.providers?.dynadot?.ok),
      namesilo: Boolean(data.providers?.namesilo?.ok),
      spaceship: Boolean(data.providers?.spaceship?.ok),
      unstoppable: Boolean(data.providers?.unstoppable?.ok),
      gmail: Boolean(data.providers?.gmail?.connected),
      gmailEvents: data.providers?.gmail?.events || null,
      portfolio: data.portfolio || null,
      mode: data.mode || "",
      accounts: data.providers?.gmail?.accounts || [],
    };
  } catch (error) {
    state.error = error.message || "Unexpected error";
    state.domains = [];
  } finally {
    state.loading = false;
    render();
  }
}

function renderRemindersBanner() {
  if (!remindersBannerEl) return;
  const items = Array.isArray(state.reminders?.items) ? state.reminders.items : [];
  if (!items.length) {
    remindersBannerEl.hidden = true;
    remindersBannerEl.innerHTML = "";
    return;
  }

  const groups = [
    { type: "expiry_soon", title: "Expiring soon" },
    { type: "recently_removed", title: "Recently removed" },
    { type: "recent_sale", title: "Recent sales" },
  ].map((group) => ({
    ...group,
    items: items.filter((item) => item.type === group.type),
  })).filter((group) => group.items.length);

  const extra = items.filter((item) => !["expiry_soon", "recently_removed", "recent_sale"].includes(item.type));
  if (extra.length) groups.push({ type: "other", title: "Other", items: extra });

  remindersBannerEl.hidden = false;
  remindersBannerEl.innerHTML = `
    <div class="reminders-head">
    </div>
    <div class="reminders-groups">
      ${groups
        .map(
          (group) => `
        <section class="reminder-group">
          <h3>${escapeHtml(group.title)} <span>${group.items.length}</span></h3>
          <ul>
            ${group.items
              .slice(0, 8)
              .map(
                (item) => `
              <li>
                <button type="button" class="reminder-chip reminder-${escapeHtml(item.severity || "low")}" data-reminder-domain="${escapeHtml(item.domain || "")}">
                  <span class="reminder-dot"></span>
                  <span class="reminder-name">${escapeHtml(item.domain || item.message || "")}</span>
                  <span class="reminder-note">${escapeHtml(reminderNote(item))}</span>
                </button>
              </li>`,
              )
              .join("")}
          </ul>
        </section>`,
        )
        .join("")}
    </div>`;
}

function reminderNote(item) {
  if (item.type === "expiry_soon") {
    const match = String(item.message || "").match(/expires in (.+)$/i);
    return match ? match[1] : "expiring";
  }
  if (item.type === "recent_sale") {
    return item.saleDate || String(item.message || "").replace(/^.*sold recently\s*/i, "sold ") || "sold";
  }
  if (item.type === "recently_removed") {
    return item.removedAt ? `removed ${displayDate(item.removedAt)}` : "removed";
  }
  return String(item.message || "").replace(item.domain || "", "").trim();
}

function renderHealthBar() {
  if (!healthBarEl) return;
  const events = state.sourceInfo.gmailEvents;
  const synced = events?.lastGmailSyncAt ? relativeTime(events.lastGmailSyncAt) : "";

  healthBarEl.hidden = false;
  healthBarEl.innerHTML = `
    <div class="health-main health-rows">
      ${renderHealthMailboxRows()}
      ${synced ? `<span class="health-chip is-quiet">Synced ${escapeHtml(synced)}</span>` : ""}
    </div>
  `;
}

function renderHealthMailboxRows() {
  if (!state.mailboxes.length) {
    return `<div class="health-mailbox-row"><span class="health-chip is-off">No inbox</span></div>`;
  }

  return state.mailboxes
    .map((mailbox) => {
      const registrarChips = renderMailboxRegistrarChips(mailbox.email);
      const connected = Boolean(mailbox.connected);
      return `
        <div class="health-mailbox-row">
          <span class="health-chip ${connected ? "is-ok" : "is-off"}" title="${escapeHtml(mailbox.email)} ${connected ? "connected" : "not connected"}">${escapeHtml(mailbox.alias || mailbox.label || mailboxAlias(mailbox.email))}</span>
          <div class="health-row-chips">${registrarChips}</div>
        </div>`;
    })
    .join("");
}

function renderMailboxRegistrarChips(mailboxEmail) {
  const rows = Array.isArray(state.views?.[mailboxEmail]) ? state.views[mailboxEmail] : [];
  const order = new Map([
    ["Dynadot", 0],
    ["NameSilo", 1],
    ["Spaceship", 2],
    ["Unstoppable", 3],
    ["Sav", 4],
    ["Domain.com", 5],
    ["Name.com", 6],
    ["Namecheap", 7],
    ["GoDaddy", 8],
    ["DropCatch", 9],
    ["NameBright", 10],
    ["Porkbun", 11],
    ["Cosmotown", 12],
    ["SnapNames", 13],
    ["Network Solutions", 14],
    ["Hostinger", 15],
    ["Afternic", 16],
  ]);
  const registrars = new Map();
  for (const row of rows) {
    const name = String(row?.currentRegistrar || row?.registrar || row?.source || "").trim();
    if (!name) continue;
    if (!registrars.has(name)) registrars.set(name, false);
    if (row?.apiConfirmed) registrars.set(name, true);
  }
  const chips = [...registrars.entries()]
    .sort(([a], [b]) => {
      const aRank = order.has(a) ? order.get(a) : 1000;
      const bRank = order.has(b) ? order.get(b) : 1000;
      return aRank === bRank ? a.localeCompare(b) : aRank - bRank;
    })
    .map(
      ([name, ok]) =>
        `<span class="health-chip ${ok ? "is-ok" : "is-off"}" title="${escapeHtml(name)} ${ok ? "connected" : "not connected"}">${escapeHtml(name)}</span>`,
    )
    .join("");
  return chips || `<span class="health-chip is-off">No registrars</span>`;
}

function relativeTime(value) {
  const parsed = Date.parse(value || "");
  if (Number.isNaN(parsed)) return "";
  const delta = Date.now() - parsed;
  const minutes = Math.round(delta / 60000);
  if (Math.abs(minutes) < 1) return "just now";
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ago`;
}

function sumMoney(rows, getter) {
  let total = 0;
  let any = false;
  for (const row of rows) {
    const value = getter(row);
    if (value === "" || value == null) continue;
    const amount = Number(value);
    if (!Number.isFinite(amount)) continue;
    any = true;
    total += amount;
  }
  return any ? total : null;
}

function expenseAmount(row) {
  return state.currency === "INR" ? parseMoneyValue(row.amountInr ?? "") : parseMoneyValue(row.amountUsd ?? row.amount ?? "");
}

function summarizeCurrentView() {
  const rows = currentRows();
  const count = rows.length;
  if (state.view === "expenses") {
    return {
      title: "Expenses",
      cards: [
        { label: "Receipts", value: String(count), hint: state.search ? "matching search" : "this tab" },
        { label: "Spent", value: formatMoneyTotal(sumMoney(rows, expenseAmount)), hint: "other tools & services" },
      ],
    };
  }
  if (state.view === "sold") {
    const invested = sumMoney(rows, getTotalSpentValue);
    const soldFor = sumMoney(rows, (row) => parseMoneyValue(row.soldFor ?? ""));
    const net = sumMoney(rows, (row) => parseMoneyValue(row.soldNet ?? ""));
    const profit = sumMoney(rows, (row) => parseMoneyValue(row.profit ?? ""));
    return {
      title: "Sold",
      cards: [
        { label: "Names sold", value: String(count), hint: "across all inboxes" },
        { label: "Invested", value: formatMoneyTotal(invested), hint: "buy + renewals" },
        { label: "Sold for", value: formatMoneyTotal(soldFor), hint: "gross" },
        { label: "Received", value: formatMoneyTotal(net), hint: "after commission" },
        { label: "Profit", value: formatMoneyTotal(profit), hint: "net − cost", tone: Number(profit) < 0 ? "down" : "up" },
      ],
    };
  }
  if (state.view === "expired") {
    const bought = sumMoney(rows, getBoughtForValue);
    const renewals = sumMoney(rows, getRenewalSpendValue);
    const spent = sumMoney(rows, getTotalSpentValue);
    return {
      title: "Expired",
      cards: [
        { label: "Names", value: String(count), hint: "expired or dropped" },
        { label: "Bought for", value: formatMoneyTotal(bought), hint: "acquisition cost" },
        { label: "Renewals", value: formatMoneyTotal(renewals), hint: "keep-alive spend" },
        { label: "Total spent", value: formatMoneyTotal(spent), hint: "buy + renewals" },
      ],
    };
  }
  const bought = sumMoney(rows, getBoughtForValue);
  const renewals = sumMoney(rows, getRenewalSpendValue);
  const spent = sumMoney(rows, getTotalSpentValue);
  const expiring = rows.filter((row) => {
    const days = Number(daysRemainingValue(row.expiry));
    return Number.isFinite(days) && days >= 0 && days <= 30;
  }).length;
  return {
    title: labelForView(state.view),
    cards: [
      { label: "Names held", value: String(count), hint: mailboxAlias(state.view) || "this inbox" },
      { label: "Invested", value: formatMoneyTotal(spent), hint: "buy + renewals" },
      { label: "Bought for", value: formatMoneyTotal(bought), hint: "acquisition" },
      { label: "Renewals", value: formatMoneyTotal(renewals), hint: "keep-alive spend" },
      { label: "Expiring", value: String(expiring), hint: "next 30 days" },
    ],
  };
}

function formatMoneyTotal(value) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: state.currency === "INR" ? "INR" : "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

function renderViewSummary() {
  if (!viewSummaryEl) return;
  if (state.loading || state.error) {
    viewSummaryEl.hidden = true;
    viewSummaryEl.innerHTML = "";
    return;
  }
  const summary = summarizeCurrentView();
  if (viewKickerEl) viewKickerEl.textContent = summary.title;
  viewSummaryEl.hidden = false;
  viewSummaryEl.innerHTML = summary.cards
    .map(
      (card) => `
      <article class="summary-card ${card.tone ? `is-${card.tone}` : ""}">
        <p class="summary-label">${escapeHtml(card.label)}</p>
        <p class="summary-value">${escapeHtml(card.value)}</p>
        <p class="summary-hint">${escapeHtml(card.hint || "")}</p>
      </article>`,
    )
    .join("");
}

function setStatusMessage(text, { error = false } = {}) {
  if (!statusEl) return;
  const value = String(text || "").trim();
  statusEl.hidden = !value;
  statusEl.textContent = value;
  statusEl.classList.toggle("is-error", Boolean(error));
}

function currentRows() {
  const rows = rawRowsForView(state.view);
  const query = String(state.search || "").trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => rowMatchesSearch(row, query));
}

function rawRowsForView(view) {
  if (view === "sold") return state.views.sold || [];
  if (view === "expired") return state.views.expired || [];
  if (view === "expenses") return state.views.expenses || [];
  return state.views[view] || [];
}

function rowMatchesSearch(row, query) {
  const hay = `${row.name || ""} ${row.domain || ""} ${row.vendor || ""}`.toLowerCase();
  return hay.includes(query);
}

function findViewForSearch(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return "";
  const views = [
    ...state.mailboxes.map((item) => item.email),
    "sold",
    "expired",
    "expenses",
  ];
  for (const view of views) {
    if (rawRowsForView(view).some((row) => rowMatchesSearch(row, q))) return view;
  }
  return "";
}

function applyDomainSearch(value, { switchView = true } = {}) {
  state.search = String(value || "").trim();
  if (domainSearchEl && domainSearchEl.value !== state.search) domainSearchEl.value = state.search;
  if (switchView && state.search) {
    const localHits = rawRowsForView(state.view).some((row) => rowMatchesSearch(row, state.search.toLowerCase()));
    if (!localHits) {
      const other = findViewForSearch(state.search);
      if (other && other !== state.view) {
        state.view = other;
        localStorage.setItem("domainLedgerView", state.view);
        if (viewSelect) viewSelect.value = state.view;
        state.sort = defaultSortForView(state.view);
        updateConnectLink();
      }
    }
  }
  render();
}

function render() {
  if (state.loading) {
    setStatusMessage("Loading domains…");
  } else if (state.error) {
    setStatusMessage(state.error, { error: true });
  } else {
    setStatusMessage("");
  }

  if (providerStatusEl) {
    const errors = (state.providerErrors || []).map((item) => `${item.provider}: ${item.error}`);
    if (errors.length && !state.sourceInfo.gmail) {
      providerStatusEl.hidden = false;
      providerStatusEl.textContent = errors.join(" · ");
    } else {
      providerStatusEl.hidden = true;
      providerStatusEl.textContent = "";
    }
  }

  renderHealthBar();
  renderViewSummary();
  renderRemindersBanner();
  renderTableColumns();
  renderTableHead();

  if (state.loading) {
    tableBodyEl.innerHTML = `<tr><td class="empty-cell" colspan="12">Building portfolio from Gmail events…</td></tr>`;
    return;
  }
  if (state.error) {
    tableBodyEl.innerHTML = `<tr><td class="empty-cell error" colspan="12">${escapeHtml(state.error)}</td></tr>`;
    return;
  }

  const rows = getSortedRows(currentRows());
  if (!rows.length) {
    tableBodyEl.innerHTML = `<tr><td class="empty-cell" colspan="12">${emptyMessageForView(state.view)}</td></tr>`;
    return;
  }

  if (state.view === "expenses") {
    tableBodyEl.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${escapeHtml(row.vendor || "-")}</td>
          <td>${sourceCell(formatMoney(state.currency === "INR" ? row.amountInr : row.amountUsd), row.domain || row.vendor, "expense", row)}</td>
          <td>${sourceCell(displayDate(row.date), row.domain || row.vendor, "expense", row)}</td>
          <td>${escapeHtml(mailboxAlias(row.mailbox))}</td>
          <td>${sourceCell(row.subject || "Open email", row.domain || row.vendor, "expense", row)}</td>
        </tr>`,
      )
      .join("");
    return;
  }

  if (state.view === "sold") {
    tableBodyEl.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td class="domain-cell"><span class="domain-pill pill-sold ${toneClass(row)}">${escapeHtml(row.name || "")}</span></td>
          <td>${escapeHtml(row.buyPlatform || row.registrar || "")}</td>
          <td>${escapeHtml(row.sellPlatform || "")}</td>
          <td>${sourceCell(formatMoney(row.soldFor), row.name, "soldFor", row)}</td>
          <td>${sourceCell(formatMoney(row.soldNet), row.name, "soldNet", row)}</td>
          <td>${sourceCell(formatBoughtFor(row), row.name, "purchase", row)}</td>
          <td>${sourceCell(formatRenewals(row), row.name, "renewal", row)}</td>
          <td>${sourceCell(formatMoney(row.profit), row.name, "profit", row)}</td>
          <td>${sourceCell(displayDate(row.saleDate), row.name, "saleDate", row)}</td>
          <td>${escapeHtml(displayHeldFor(row))}</td>
          <td>${escapeHtml(mailboxAlias(row.mailbox))}</td>
        </tr>`,
      )
      .join("");
    return;
  }

  if (state.view === "expired") {
    tableBodyEl.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td class="domain-cell"><span class="domain-pill pill-expired ${toneClass(row)}">${escapeHtml(row.name || "")}</span></td>
          <td>${sourceCell(formatBoughtFor(row), row.name, "purchase", row)}</td>
          <td>${sourceCell(formatRenewals(row), row.name, "renewal", row)}</td>
          <td>${sourceCell(formatTotalSpent(row), row.name, "total", row)}</td>
          <td>${sourceCell(displayDate(row.expiry), row.name, "expiry", row)}</td>
          <td>${sourceCell(displayDate(row.removedAt), row.name, "removedAt", row)}</td>
          <td>${escapeHtml(displayHeldFor(row))}</td>
          <td>${escapeHtml(row.registrar || "")}</td>
          <td>${escapeHtml(mailboxAlias(row.mailbox))}</td>
        </tr>`,
      )
      .join("");
    return;
  }

  tableBodyEl.innerHTML = rows
    .map(
      (domain) => `
        <tr class="${domain.recentlyRemoved ? "row-recent-removed" : ""}">
          <td class="domain-cell">
            <span class="domain-pill ${confirmationClass(domain)} ${toneClass(domain)}" title="${escapeHtml(domainTooltip(domain))}">${escapeHtml(domain.name || "Unknown")}${domainStarMarkup(domain)}${domain.recentlyRemoved ? " · removed" : ""}</span>
          </td>
          <td>${sourceCell(formatBoughtFor(domain), domain.name, "purchase", domain)}</td>
          <td>${sourceCell(formatRenewals(domain), domain.name, "renewal", domain)}</td>
          <td>${sourceCell(formatTotalSpent(domain), domain.name, "total", domain)}</td>
          <td>${sourceCell(displayDate(domain.expiry), domain.name, "expiry", domain)}</td>
          <td class="${daysRemainingClass(domain.expiry)}">${escapeHtml(daysRemainingValue(domain.expiry))}</td>
          <td>${escapeHtml(domain.currentRegistrar || domain.registrar || domain.source || "-")}</td>
          <td>${sourceCell(displayDate(domain.purchaseDate || domain.boughtOn), domain.name, "boughtOn", domain)}</td>
          <td>${escapeHtml(displayHolding(domain.holdingDays || domain.holding, domain.purchaseDate || domain.boughtOn))}</td>
        </tr>`,
    )
    .join("");
}

function renderTableHead() {
  const columns = columnsForView(state.view);
  tableHeadEl.innerHTML = `<tr>${columns
    .map(
      (col) =>
        `<th><button class="sort-trigger" type="button" data-sort="${escapeHtml(col.key)}">${escapeHtml(col.label)}</button></th>`,
    )
    .join("")}</tr>`;

  tableHeadEl.querySelectorAll("[data-sort]").forEach((button) => {
    const active = button.dataset.sort === state.sort.key;
    button.classList.toggle("is-sorted", active);
    button.setAttribute(
      "aria-sort",
      active ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none",
    );
    button.addEventListener("click", () => toggleSort(button.dataset.sort));
  });
}

const COLUMN_WIDTH_RULES = {
  name: { min: 260, max: 340, charWidth: 8.2, padding: 30 },
  vendor: { min: 160, max: 240, charWidth: 8.1, padding: 28 },
  purchase: { min: 84, max: 104, charWidth: 8.2, padding: 22 },
  renewalSpend: { min: 82, max: 104, charWidth: 8.2, padding: 22 },
  total: { min: 92, max: 112, charWidth: 8.2, padding: 22 },
  expiry: { min: 118, max: 132, charWidth: 7.9, padding: 24 },
  removedAt: { min: 118, max: 132, charWidth: 7.9, padding: 24 },
  saleDate: { min: 118, max: 132, charWidth: 7.9, padding: 24 },
  boughtOn: { min: 118, max: 132, charWidth: 7.9, padding: 24 },
  date: { min: 118, max: 132, charWidth: 7.9, padding: 24 },
  daysRemaining: { min: 72, max: 84, charWidth: 8.1, padding: 20 },
  holding: { min: 70, max: 88, charWidth: 8.1, padding: 20 },
  registrar: { min: 108, max: 132, charWidth: 8.0, padding: 24 },
  buyPlatform: { min: 108, max: 132, charWidth: 8.0, padding: 24 },
  sellPlatform: { min: 108, max: 132, charWidth: 8.0, padding: 24 },
  mailbox: { min: 104, max: 132, charWidth: 8.0, padding: 24 },
  amount: { min: 88, max: 108, charWidth: 8.2, padding: 22 },
  soldFor: { min: 88, max: 112, charWidth: 8.2, padding: 22 },
  soldNet: { min: 96, max: 116, charWidth: 8.2, padding: 22 },
  profit: { min: 88, max: 112, charWidth: 8.2, padding: 22 },
  subject: { min: 180, max: 280, charWidth: 8.0, padding: 28 },
};

function renderTableColumns() {
  if (!tableColsEl || !tableEl) return;
  const columns = columnsForView(state.view);
  const rows = rawRowsForView(state.view);
  const widths = columns.map((column, index) => {
    const width = estimateColumnWidth(column, rows, index === 0 ? "first" : "other");
    return { ...column, width };
  });
  const availableWidth = Math.floor(tableWrapEl?.clientWidth || 0);
  if (availableWidth > 0) {
    const totalWidth = widths.reduce((sum, column) => sum + column.width, 0);
    const extra = availableWidth - totalWidth;
    if (extra > 0 && widths.length > 1) {
      const flexWeights = widths.map((column, index) => (index === 0 ? 0 : growWeightForColumn(column.key)));
      const totalWeight = flexWeights.reduce((sum, value) => sum + value, 0) || 1;
      let remaining = extra;
      for (let index = 1; index < widths.length; index += 1) {
        const bonus = index === widths.length - 1
          ? remaining
          : Math.floor((extra * flexWeights[index]) / totalWeight);
        widths[index].width += bonus;
        remaining -= bonus;
      }
    }
  }
  tableColsEl.innerHTML = widths
    .map(
      (column, index) =>
        `<col class="${index === 0 ? "col-domain" : `col-${escapeHtml(column.key)}`}" style="width: ${column.width}px" />`,
    )
    .join("");
  const totalWidth = widths.reduce((sum, column) => sum + column.width, 0);
  tableEl.style.width = `${totalWidth}px`;
  tableEl.style.minWidth = `${totalWidth}px`;
  tableEl.style.setProperty("--table-first-col-width", `${widths[0]?.width || 0}px`);
}

function growWeightForColumn(key) {
  switch (key) {
    case "purchase":
    case "renewalSpend":
    case "total":
      return 1.25;
    case "expiry":
    case "removedAt":
    case "saleDate":
    case "boughtOn":
    case "date":
      return 1;
    case "registrar":
    case "buyPlatform":
    case "sellPlatform":
    case "subject":
      return 1.1;
    case "daysRemaining":
    case "holding":
    case "amount":
    case "soldFor":
    case "soldNet":
    case "profit":
    case "mailbox":
      return 0.9;
    default:
      return 1;
  }
}

function estimateColumnWidth(column, rows, role = "other") {
  const rule = COLUMN_WIDTH_RULES[column.key] || { min: 88, max: 200, charWidth: 8, padding: 22 };
  const samples = [column.label, ...rows.map((row) => sampleColumnText(column.key, row)).filter(Boolean)];
  let longest = 0;
  for (const sample of samples) {
    longest = Math.max(longest, String(sample).length);
  }
  const measured = Math.ceil(longest * rule.charWidth + rule.padding + (role === "first" ? 10 : 0));
  return Math.min(rule.max, Math.max(rule.min, measured));
}

function sampleColumnText(key, row) {
  switch (key) {
    case "name":
      return row.name || row.domain || row.vendor || "";
    case "vendor":
      return row.vendor || row.name || row.domain || "";
    case "purchase":
      return formatBoughtFor(row);
    case "renewalSpend":
      return formatRenewals(row);
    case "total":
      return formatTotalSpent(row);
    case "expiry":
      return displayDate(row.expiry);
    case "removedAt":
      return displayDate(row.removedAt);
    case "saleDate":
      return displayDate(row.saleDate);
    case "boughtOn":
      return displayDate(row.purchaseDate || row.boughtOn);
    case "date":
      return displayDate(row.date || row.purchaseDate || row.saleDate);
    case "daysRemaining":
      return daysRemainingValue(row.expiry);
    case "holding":
      return displayHolding(row.holdingDays || row.holding, row.purchaseDate || row.boughtOn);
    case "registrar":
      return row.currentRegistrar || row.registrar || row.source || "";
    case "buyPlatform":
      return row.buyPlatform || row.currentRegistrar || row.registrar || "";
    case "sellPlatform":
      return row.sellPlatform || "";
    case "mailbox":
      return mailboxAlias(row.mailbox);
    case "amount":
      return formatMoney(state.currency === "INR" ? row.amountInr : row.amountUsd);
    case "soldFor":
      return formatMoney(row.soldFor);
    case "soldNet":
      return formatMoney(row.soldNet);
    case "profit":
      return formatMoney(row.profit);
    case "subject":
      return row.subject || "Open email";
    default:
      return row[key] ?? "";
  }
}

function columnsForView(view) {
  if (view === "expenses") {
    return [
      { key: "vendor", label: "Vendor" },
      { key: "amount", label: "Amount" },
      { key: "date", label: "Date" },
      { key: "mailbox", label: "Mailbox" },
      { key: "subject", label: "Subject" },
    ];
  }
  if (view === "sold") {
    return [
      { key: "name", label: "Domain" },
      { key: "buyPlatform", label: "Bought at" },
      { key: "sellPlatform", label: "Sold at" },
      { key: "soldFor", label: "Sold for" },
      { key: "soldNet", label: "After commission" },
      { key: "purchase", label: "Bought for" },
      { key: "renewalSpend", label: "Renewals" },
      { key: "profit", label: "Profit" },
      { key: "saleDate", label: "Sold on" },
      { key: "holding", label: "Held for" },
      { key: "mailbox", label: "Mailbox" },
    ];
  }
  if (view === "expired") {
    return [
      { key: "name", label: "Domain" },
      { key: "purchase", label: "Bought for" },
      { key: "renewalSpend", label: "Renewals" },
      { key: "total", label: "Total spent" },
      { key: "expiry", label: "Expired / expiry" },
      { key: "removedAt", label: "Removed at" },
      { key: "holding", label: "Held for" },
      { key: "registrar", label: "Registrar" },
      { key: "mailbox", label: "Mailbox" },
    ];
  }
  return [
    { key: "name", label: "Domains" },
    { key: "purchase", label: "Bought for" },
    { key: "renewalSpend", label: "Renewals" },
    { key: "total", label: "Total spent" },
    { key: "expiry", label: "Expires on" },
    { key: "daysRemaining", label: "Days left" },
    { key: "registrar", label: "Registrar" },
    { key: "boughtOn", label: "Bought on" },
    { key: "holding", label: "Holding" },
  ];
}

function labelForView(view) {
  const shared = SHARED_VIEWS.find((item) => item.value === view);
  if (shared) return shared.label;
  const alias = mailboxAlias(view);
  return alias || "Portfolio";
}

function emptyMessageForView(view) {
  if (view === "sold") return "No sold domains yet across any Gmail account. Sync Gmail to pull marketplace / payout mail.";
  if (view === "expired") return "No expired domains in the ledger yet across any Gmail account.";
  if (view === "expenses") return "No other-expense receipts yet across any Gmail account (Hostinger, DotDB, NameBio…).";
  const mailbox = state.mailboxes.find((item) => item.email === view);
  if (mailbox && !mailbox.connected) {
    return `Sync Gmail, then refresh.`;
  }
  return "No domains yet. Click Sync Gmail.";
}

function getSortedRows(rows) {
  const list = [...rows];
  const { key, direction } = state.sort;
  const sortDirection = direction === "desc" ? -1 : 1;
  return list.sort((a, b) => {
    const left = getSortValue(a, key);
    const right = getSortValue(b, key);
    const leftBlank = isBlankValue(left);
    const rightBlank = isBlankValue(right);
    if (leftBlank && rightBlank) return 0;
    if (leftBlank) return 1;
    if (rightBlank) return -1;
    return compareSortValues(left, right, key) * sortDirection;
  });
}

function getSortValue(row, key) {
  switch (key) {
    case "name":
    case "vendor":
      return row.name || row.vendor || "";
    case "purchase":
      return parseMoneyValue(row.purchaseAmount ?? row.purchasePrice ?? "");
    case "renewalSpend": {
      const value = parseMoneyValue(row.renewalSpend ?? "");
      return value === "" ? 0 : value;
    }
    case "total":
      return getTotalSpentValue(row);
    case "soldFor":
    case "soldNet":
    case "profit":
    case "amount":
      return parseMoneyValue(row[key] ?? row.amountUsd ?? "");
    case "expiry":
    case "boughtOn":
    case "saleDate":
    case "removedAt":
    case "date":
      return row[key] || row.saleDate || row.date || row.purchaseDate || "";
    case "daysRemaining":
      return daysRemainingValue(row.expiry);
    case "holding":
      return heldForDaysValue(row);
    case "registrar":
    case "buyPlatform":
    case "sellPlatform":
    case "mailbox":
    case "subject":
      return row[key] || row.currentRegistrar || "";
    default:
      return row[key] ?? "";
  }
}

function compareSortValues(left, right, key) {
  if (
    ["purchase", "renewalSpend", "total", "daysRemaining", "holding", "soldFor", "soldNet", "profit", "amount"].includes(
      key,
    )
  ) {
    return Number(left) - Number(right);
  }
  if (["expiry", "boughtOn", "saleDate", "removedAt", "date"].includes(key)) {
    return Date.parse(left) - Date.parse(right);
  }
  return String(left).localeCompare(String(right), undefined, { sensitivity: "base" });
}

function toggleSort(key) {
  if (state.sort.key === key) {
    state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
  } else {
    state.sort.key = key;
    state.sort.direction = "desc";
  }
  render();
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

function confirmationClass(domain) {
  if (domain?.apiConfirmed) return "pill-api";
  return "pill-gmail";
}

function domainStarMarkup(domain) {
  if (!domain?.apiConfirmed) return "";
  return '<span class="api-star" aria-label="Confirmed" title="Confirmed present at registrar">★</span>';
}

const TONE_CLASSES = ["tone-sky", "tone-mint", "tone-sand", "tone-coral", "tone-lilac", "tone-teal", "tone-rose", "tone-slate"];

function toneClass(domain) {
  const registrar = String(domain?.registrar || domain?.source || domain?.buyPlatform || domain?.sellPlatform || "")
    .toLowerCase();
  if (registrar.includes("dynadot")) return "tone-sky";
  if (registrar.includes("namesilo")) return "tone-mint";
  if (registrar.includes("spaceship")) return "tone-teal";
  if (registrar.includes("unstoppable")) return "tone-lilac";
  if (registrar.includes("sav")) return "tone-sand";
  if (registrar.includes("name.com") || registrar.includes("namecom")) return "tone-coral";
  if (registrar.includes("godaddy")) return "tone-rose";
  if (registrar.includes("porkbun")) return "tone-slate";

  // Stable multi-color fallback from domain name
  const key = String(domain?.name || domain?.vendor || "");
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TONE_CLASSES[hash % TONE_CLASSES.length];
}

function domainTooltip(domain) {
  const name = domain?.name || "Unknown";
  const confirmation = domain?.apiConfirmed
    ? "★ confirmed at registrar API"
    : domain?.awaitingMailboxRegistrarApi || domain?.awaitingLetsLiterateDynadotApi
      ? "not API verified — registrar API for this mailbox is not connected yet"
      : "not API verified";
  const registrar = domain?.registrar || domain?.source || "";
  return `${name} · ${confirmation}${registrar ? ` · ${registrar}` : ""}`;
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

function getBoughtForValue(domain) {
  if (state.currency === "INR") {
    return parseMoneyValue(domain.purchaseAmountInr ?? domain.purchasePriceInr ?? "");
  }
  return parseMoneyValue(domain.purchaseAmountUsd ?? domain.purchaseAmount ?? domain.purchasePrice ?? "");
}

function getRenewalSpendValue(domain) {
  if (state.currency === "INR") {
    return parseMoneyValue(domain.renewalSpendInr ?? domain.renewalSpendPriceInr ?? "");
  }
  return parseMoneyValue(domain.renewalSpendUsd ?? domain.renewalSpend ?? domain.renewalSpendPrice ?? "");
}

function getTotalSpentValue(domain) {
  const boughtFor = getBoughtForValue(domain);
  const renewals = getRenewalSpendValue(domain);
  const hasBought = boughtFor !== "";
  const hasRenewals = renewals !== "";
  if (!hasBought && !hasRenewals) return "";
  return (Number.isFinite(boughtFor) ? boughtFor : 0) + (Number.isFinite(renewals) ? renewals : 0);
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return state.currency === "INR" ? `₹${text}` : `$${text}`;
  }
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return String(value);
  const text = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
  return state.currency === "INR" ? `₹${text}` : `$${text}`;
}

function formatBoughtFor(domain) {
  return formatMoney(getBoughtForValue(domain));
}

function formatRenewals(domain) {
  const value = getRenewalSpendValue(domain);
  const spend = formatMoney(value === "" ? 0 : value);
  const count = Number(domain.renewalCount || 0);
  return count > 1 ? `${spend} (${count})` : spend;
}

function formatTotalSpent(domain) {
  const total = getTotalSpentValue(domain);
  if (total === "" || total === null || total === undefined) return "";
  return formatMoney(total);
}

function daysBetween(startDate, endDate = "") {
  const start = Date.parse(String(startDate || ""));
  if (Number.isNaN(start)) return "";
  const endParsed = Date.parse(String(endDate || ""));
  const end = new Date(Number.isNaN(endParsed) ? Date.now() : endParsed);
  const purchase = new Date(start);
  purchase.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return String(Math.max(0, Math.round((end - purchase) / 86400000)));
}

function holdingEndDate(row) {
  if (!row) return "";
  if (state.view === "sold") return row.saleDate || row.removedAt || "";
  if (state.view === "expired") return row.removedAt || row.expiry || "";
  return "";
}

function heldForDaysValue(row) {
  const purchase = row?.purchaseDate || row?.boughtOn || "";
  if (!purchase) return row?.holdingDays || row?.holding || "";
  const end = holdingEndDate(row);
  if (end) return daysBetween(purchase, end);
  if (state.view === "sold" || state.view === "expired") return "";
  return row?.holdingDays || row?.holding || daysBetween(purchase);
}

function displayHeldFor(row) {
  const days = heldForDaysValue(row);
  if (days === "" || days == null) return "";
  const n = Number(days);
  if (!Number.isFinite(n)) return String(days);
  return String(n);
}

function displayHolding(value, purchaseDate) {
  if (value !== null && value !== undefined && value !== "") return String(value);
  if (!purchaseDate) return "";
  return daysBetween(purchaseDate);
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === "") return "";
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : "";
}

function isBlankValue(value) {
  return value === null || value === undefined || value === "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sourceCell(text, domain, column, row = {}) {
  const value = text == null ? "" : String(text);
  if (!value) return "";
  const eventId = row.id && (column === "expense" || state.view === "expenses") ? String(row.id) : "";
  const mailbox = row.mailbox || "";
  return `<button type="button" class="source-link" data-source-domain="${escapeHtml(domain || "")}" data-source-column="${escapeHtml(column || "")}" data-source-event="${escapeHtml(eventId)}" data-source-mailbox="${escapeHtml(mailbox)}">${escapeHtml(value)}</button>`;
}

function columnTitle(column) {
  const labels = {
    purchase: "Bought for",
    boughtOn: "Bought on",
    renewal: "Renewals",
    total: "Total spent",
    soldFor: "Sold for",
    soldNet: "After commission",
    profit: "Profit",
    saleDate: "Sold on",
    expiry: "Expiry",
    removedAt: "Removed at",
    expense: "Expense",
  };
  return labels[column] || "Emails";
}

function formatEventAmount(event) {
  const usd = Number(event?.amountUsd);
  const inr = Number(event?.amountInr);
  const gross = Number(event?.amountGross);
  if (state.currency === "INR" && Number.isFinite(inr)) return `₹${inr.toFixed(2)}`;
  if (Number.isFinite(usd)) return `$${usd.toFixed(2)}`;
  if (Number.isFinite(gross)) return `$${gross.toFixed(2)}`;
  return "";
}

function beginSourceDialogRequest() {
  sourceRequestSeq += 1;
  sourceEmailSeq += 1;
  sourceListAbort?.abort();
  sourceMailAbort?.abort();
  sourceListAbort = new AbortController();
  sourceMailAbort = null;
  sourceDialogEvents = [];
  return sourceRequestSeq;
}

function isCurrentSourceRequest(requestId) {
  return requestId === sourceRequestSeq;
}

function resetSourceDialogShell({ title, summary, loading = true } = {}) {
  if (sourceDialogTitle) sourceDialogTitle.textContent = title || "Emails";
  if (sourceDialogSummary) sourceDialogSummary.textContent = summary || "";
  if (sourceDialogList) {
    sourceDialogList.hidden = false;
    sourceDialogList.innerHTML = loading
      ? `<p class="manual-hint">Loading emails…</p>`
      : "";
  }
  if (sourceDialogMail) sourceDialogMail.hidden = true;
  if (sourceBackBtn) sourceBackBtn.hidden = true;
  if (sourceMailSubject) sourceMailSubject.textContent = "";
  if (sourceMailMeta) sourceMailMeta.textContent = "";
  if (sourceMailBody) sourceMailBody.textContent = "";
  if (sourceMailOpen) {
    sourceMailOpen.hidden = true;
    sourceMailOpen.removeAttribute("href");
  }
}

async function openSourceDialog({ domain, column, eventId, mailbox, label }) {
  if (!sourceDialog) return;
  const requestId = beginSourceDialogRequest();
  resetSourceDialogShell({
    title: columnTitle(column),
    summary: domain ? `${domain}${label ? ` · ${label}` : ""}` : "Loading emails…",
    loading: true,
  });
  if (!sourceDialog.open) sourceDialog.showModal();

  const params = new URLSearchParams();
  if (domain) params.set("domain", domain);
  if (column) params.set("column", column);
  if (eventId) params.set("eventId", eventId);
  if (mailbox) params.set("mailbox", mailbox);

  let data = {};
  try {
    const response = await fetch(`/api/events/sources?${params.toString()}`, {
      signal: sourceListAbort?.signal,
    });
    data = await response.json();
  } catch (error) {
    if (error?.name === "AbortError") return;
    throw error;
  }
  if (!isCurrentSourceRequest(requestId)) return;

  const events = Array.isArray(data.events) ? data.events : [];
  sourceDialogEvents = events;

  if (!events.length) {
    sourceDialogSummary.textContent = domain
      ? `No stored emails for ${columnTitle(column).toLowerCase()} on ${domain}.`
      : "No stored emails for this cell.";
    sourceDialogList.innerHTML = `<p class="manual-hint">Nothing to open. Sync Gmail if this amount should have a matching message.</p>`;
    return;
  }

  sourceDialogSummary.textContent = `${events.length} email${events.length === 1 ? "" : "s"} used for ${columnTitle(column).toLowerCase()}${domain ? ` · ${domain}` : ""}`;

  if (events.length === 1) {
    await showSourceEmail(events[0], { showBack: false, requestId });
    return;
  }

  renderSourceEmailList(events);
}

function renderSourceEmailList(events) {
  sourceDialogMail.hidden = true;
  sourceDialogList.hidden = false;
  sourceBackBtn.hidden = true;
  sourceDialogList.innerHTML = events
    .map((event, index) => {
      const amount = formatEventAmount(event);
      const meta = [
        displayDate(event.eventDate) || "",
        event.eventType || "",
        amount,
        event.from || "",
      ]
        .filter(Boolean)
        .join(" · ");
      return `<button type="button" class="source-mail-item" data-source-index="${index}">
        <span class="source-mail-item-subject">${escapeHtml(event.subject || "(no subject)")}</span>
        <span class="source-mail-item-meta">${escapeHtml(meta)}</span>
      </button>`;
    })
    .join("");
}

async function showSourceEmail(event, options = {}) {
  const requestId = options.requestId ?? sourceRequestSeq;
  if (!isCurrentSourceRequest(requestId)) return;

  sourceEmailSeq += 1;
  const emailId = sourceEmailSeq;
  sourceMailAbort?.abort();
  sourceMailAbort = new AbortController();

  const showBack = options.showBack !== false && sourceDialogEvents.length > 1;
  sourceDialogList.hidden = true;
  sourceDialogMail.hidden = false;
  sourceBackBtn.hidden = !showBack;
  sourceMailSubject.textContent = event.subject || "(no subject)";
  sourceMailMeta.textContent = "Opening email…";
  sourceMailBody.textContent = "";
  if (sourceMailOpen) {
    sourceMailOpen.hidden = !event.gmailUrl;
    sourceMailOpen.href = event.gmailUrl || "#";
  }

  const mailbox = event.mailbox || "";
  if (event.manual || String(event.messageId || "").startsWith("manual:")) {
    sourceMailMeta.textContent = [displayDate(event.eventDate), event.from, mailboxAlias(mailbox), "manual entry"]
      .filter(Boolean)
      .join(" · ");
    sourceMailBody.textContent = event.snippet || "This amount was entered manually, so there is no Gmail message to open.";
    return;
  }

  try {
    const params = new URLSearchParams({
      id: event.messageId || "",
      mailbox,
    });
    const response = await fetch(`/api/gmail/message?${params.toString()}`, {
      signal: sourceMailAbort.signal,
    });
    const mail = await response.json();
    if (!isCurrentSourceRequest(requestId) || emailId !== sourceEmailSeq) return;
    if (!response.ok || !mail?.ok) {
      throw new Error(mail?.error || "Could not open that email");
    }
    sourceMailSubject.textContent = mail.subject || event.subject || "(no subject)";
    sourceMailMeta.textContent = [mail.date || displayDate(event.eventDate), mail.from || event.from, mailboxAlias(mail.mailbox || mailbox)]
      .filter(Boolean)
      .join(" · ");
    sourceMailBody.textContent = mail.text || event.snippet || "Email opened, but the body was empty.";
    if (sourceMailOpen && mail.gmailUrl) {
      sourceMailOpen.hidden = false;
      sourceMailOpen.href = mail.gmailUrl;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (!isCurrentSourceRequest(requestId) || emailId !== sourceEmailSeq) return;
    sourceMailMeta.textContent = [displayDate(event.eventDate), event.from, mailboxAlias(mailbox), "stored copy"]
      .filter(Boolean)
      .join(" · ");
    sourceMailBody.textContent =
      event.snippet ||
      error.message ||
      "Could not load the live Gmail message. Use Open in Gmail if the link is available.";
  }
}

async function syncGmailLedger() {
  if (!gmailSyncBtn) return;
  gmailSyncBtn.disabled = true;
  refreshBtn.disabled = true;
  setStatusMessage("Syncing Gmail…");

  try {
    const response = await fetch("/api/sync/gmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incremental: true }),
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || "Gmail sync failed");
    }
    setStatusMessage(`Synced · ${data.inserted || 0} new, ${data.updated || 0} updated`);
    await loadDomains();
  } catch (error) {
    setStatusMessage(error.message || "Gmail sync failed", { error: true });
  } finally {
    gmailSyncBtn.disabled = false;
    refreshBtn.disabled = false;
  }
}

async function saveManualEntry(formData) {
  const payload = {
    domain: formData.get("domain"),
    eventType: formData.get("eventType"),
    eventDate: formData.get("eventDate"),
    mailbox: formData.get("mailbox"),
    amountUsd: formData.get("amountUsd") ? Number(formData.get("amountUsd")) : null,
    amountGross: formData.get("amountGross") ? Number(formData.get("amountGross")) : null,
    vendor: formData.get("vendor") || "",
    salePlatform: formData.get("vendor") || "",
    subject: formData.get("subject") || "Manual entry",
    statusHint: formData.get("eventType") === "sale" ? "sold" : "",
  };
  const response = await fetch("/api/events/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Save failed");
  return data;
}

refreshBtn.addEventListener("click", loadDomains);
gmailSyncBtn?.addEventListener("click", syncGmailLedger);
currencyUsdBtn?.addEventListener("click", () => setDisplayCurrency("USD"));
currencyInrBtn?.addEventListener("click", () => setDisplayCurrency("INR"));
viewSelect?.addEventListener("change", (event) => setView(event.target.value));
domainSearchEl?.addEventListener("input", (event) => applyDomainSearch(event.target.value));
domainSearchEl?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    applyDomainSearch("");
    domainSearchEl.blur();
  }
});
manualBtn?.addEventListener("click", () => manualDialog?.showModal());
manualForm?.addEventListener("submit", async (event) => {
  const submitter = event.submitter;
  if (submitter?.value === "cancel") return;
  event.preventDefault();
  try {
    await saveManualEntry(new FormData(manualForm));
    manualDialog.close();
    manualForm.reset();
    await loadDomains();
  } catch (error) {
    setStatusMessage(error.message || "Manual save failed", { error: true });
  }
});

tableBodyEl?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-source-column]");
  if (!button) return;
  openSourceDialog({
    domain: button.dataset.sourceDomain || "",
    column: button.dataset.sourceColumn || "",
    eventId: button.dataset.sourceEvent || "",
    mailbox: button.dataset.sourceMailbox || "",
    label: button.textContent || "",
  }).catch((error) => {
    setStatusMessage(error.message || "Could not open emails", { error: true });
  });
});

sourceDialogList?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-source-index]");
  if (!item) return;
  const index = Number(item.dataset.sourceIndex);
  const sourceEvent = sourceDialogEvents[index];
  if (!sourceEvent) return;
  showSourceEmail(sourceEvent, { showBack: true }).catch((error) => {
    sourceMailBody.textContent = error.message || "Could not open that email";
  });
});

sourceDialogClose?.addEventListener("click", () => sourceDialog?.close());
sourceDialog?.addEventListener("close", () => {
  beginSourceDialogRequest();
  resetSourceDialogShell({ title: "Emails", summary: "", loading: false });
});
sourceBackBtn?.addEventListener("click", () => {
  sourceMailAbort?.abort();
  sourceEmailSeq += 1;
  renderSourceEmailList(sourceDialogEvents);
});

remindersBannerEl?.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-reminder-domain]");
  if (!chip) return;
  const domain = chip.dataset.reminderDomain || "";
  if (domain) applyDomainSearch(domain);
});

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    renderTableColumns();
  }, 80);
});

setDisplayCurrency(state.currency);
loadMailboxes().then(() => loadDomains());
