import {
  buildLedgerFromEvents,
  listDomainNamesFromEvents,
  listRemovalEvents,
  listExpenseEvents,
  listSaleEvents,
  getDomainMetaMap,
  seedDomainMetaFromKnownLists,
} from "../db/index.js";
import { estimateExpiryFromLedger } from "../gmail/expiry.js";
import {
  getPrimaryMailbox,
  resolveMailboxList,
  mailboxViewLabel,
  listMailboxEmails,
  isKnownMailbox,
  mapRegistrarAccountToMailbox,
  SHARED_PORTFOLIO_VIEW_IDS,
  sharedPortfolioViewLabel,
} from "../data/mailboxes.js";
import {
  HISTORIC_SEED_DOMAINS,
  SEED_DOMAINS_BY_MAILBOX,
  seedEntriesForMeta,
  defaultMailboxForDomain,
} from "../data/known-domains.js";
import { dynadotApiConfiguredForMailbox } from "../registrars/index.js";

const RECENT_REMOVED_DAYS = 30;

const HISTORIC_SEED = new Set(
  HISTORIC_SEED_DOMAINS.map((name) =>
    String(name || "")
      .toLowerCase()
      .replace(/\.+$/, "")
      .trim(),
  ),
);

/**
 * Gmail is the source of truth for portfolio rows and spend.
 * Views are dynamic: one per configured/connected mailbox, plus sold / expired / expenses.
 * Add more Gmail accounts in data/mailboxes.js (or GMAIL_MAILBOXES env) anytime.
 */
export function buildGmailFirstPortfolio(registrarDomains = []) {
  seedDomainMetaFromKnownLists({
    seedEntriesForMeta,
    HISTORIC_SEED_DOMAINS,
    SEED_DOMAINS_BY_MAILBOX,
    MAILBOX_PRIMARY: getPrimaryMailbox(),
  });

  const presentAtRegistrar = new Set();
  const registrarNameByDomain = new Map();
  const apiExpiryByDomain = new Map();
  const apiRegistrationByDomain = new Map();
  const mailboxHintByDomain = new Map();
  const registrarAccountByDomain = new Map();

  for (const domain of Array.isArray(registrarDomains) ? registrarDomains : []) {
    const key = normalizeDomain(domain?.name);
    if (!key) continue;
    presentAtRegistrar.add(key);
    const label = domain.registrar || domain.source || "";
    if (label) registrarNameByDomain.set(key, label);
    if (domain.expiry) apiExpiryByDomain.set(key, String(domain.expiry).slice(0, 10));
    if (domain.registration) apiRegistrationByDomain.set(key, String(domain.registration).slice(0, 10));
    if (domain.mailboxHint) mailboxHintByDomain.set(key, String(domain.mailboxHint).toLowerCase());
    if (domain.dynadotAccount) registrarAccountByDomain.set(key, String(domain.dynadotAccount).toLowerCase());
  }

  const metaMap = getDomainMetaMap();
  const gmailNames = listDomainNamesFromEvents().filter((name) => !String(name).startsWith("expense:"));
  const seededNames = Object.values(SEED_DOMAINS_BY_MAILBOX || {}).flat();
  const allNames = [
    ...new Set([...gmailNames, ...seededNames, ...HISTORIC_SEED_DOMAINS, ...[...presentAtRegistrar]]),
  ];
  const ledger = buildLedgerFromEvents(gmailNames);
  const active = [];
  const sold = [];
  const expired = [];
  const removed = [];
  const seen = new Set();
  const mailboxesSeen = new Set(listMailboxEmails());

  for (const name of allNames) {
    const key = normalizeDomain(name);
    if (!key || seen.has(key) || key.startsWith("expense:")) continue;
    seen.add(key);

    const record = ledger.get(key) || null;
    const meta = metaMap.get(key) || null;
    const gmailRemoved = isRemovedByGmail(record);
    const ownership = resolveDomainOwnership(key, record, meta, {
      presentAtRegistrar,
      mailboxHintByDomain,
      registrarAccountByDomain,
    });
    const mailbox = ownership.mailbox;
    if (mailbox) mailboxesSeen.add(mailbox);

    const liveAtMatchingApi = ownership.apiConfirmed;
    const awaitingMailboxRegistrarApi = ownership.awaitingMailboxRegistrarApi;
    const apiConfirmed = liveAtMatchingApi;
    const isSold =
      !apiConfirmed &&
      (Boolean(record?.saleCount) || String(meta?.status_hint || "") === "sold");

    const base = recordToDomain(key, record);
    const expiryInfo = resolveExpiry({
      apiConfirmed: liveAtMatchingApi,
      apiExpiry: apiExpiryByDomain.get(key) || "",
      gmailExpiry: record?.expiryDate || "",
      purchaseDate: record?.purchaseDate || "",
      renewalCount: record?.renewalCount || 0,
      lastRenewalDate: record?.renewalDate || "",
    });

    const registrar =
      (liveAtMatchingApi && registrarNameByDomain.get(key)) ||
      base.registrar ||
      pickRegistrarHint(record) ||
      "Gmail";
    const currentRegistrar = liveAtMatchingApi
      ? registrarNameByDomain.get(key) || base.registrar || "Dynadot"
      : isKnownMailbox(mailbox)
        ? "Dynadot"
        : base.registrar || pickRegistrarHint(record) || "Gmail";

    const row = {
      ...base,
      apiConfirmed,
      currentRegistrar,
      seedDynadotConfirmed: false,
      awaitingLetsLiterateDynadotApi: awaitingMailboxRegistrarApi,
      awaitingMailboxRegistrarApi,
      gmailConfirmed: Boolean(record?.eventCount),
      confirmation: liveAtMatchingApi ? "confirmed" : "gmail-only",
      noApiStar: !apiConfirmed,
      expiry: expiryInfo.expiry,
      expirySource: expiryInfo.source,
      daysRemaining: daysRemaining(expiryInfo.expiry),
      registration: apiRegistrationByDomain.get(key) || base.registration || "",
      registrar,
      source: registrar,
      mailbox,
      buyPlatform: record?.purchasePlatform || meta?.buy_platform || pickRegistrarHint(record) || registrar || "",
      sellPlatform: record?.salePlatform || meta?.sell_platform || "",
      soldFor: record?.saleGrossUsd ?? "",
      soldBeforeCommission: record?.saleGrossUsd ?? "",
      soldNet: record?.saleNetUsd ?? "",
      soldAfterCommission: record?.saleNetUsd ?? "",
      profit: computeSaleProfit(record, base),
      saleDate: record?.saleDate || "",
      statusHint: meta?.status_hint || "",
      pushNote: String(meta?.notes || "").startsWith("push") ? meta.notes : "",
    };

    if (isSold) {
      const saleDate = record?.saleDate || record?.removalDate || row.saleDate || "";
      const held = holdingDays(row.purchaseDate || row.boughtOn, saleDate);
      sold.push({
        ...row,
        removedAt: saleDate,
        saleDate,
        confirmation: "sold",
        holdingDays: held,
        holding: held,
      });
      continue;
    }

    const pastExpiry = Boolean(expiryInfo.expiry) && daysRemaining(expiryInfo.expiry) < 0;

    // Gmail removal evidence should move a row out of the active table even
    // when the registrar API for this mailbox is not connected yet.
    if (gmailRemoved) {
      const expiredRow = {
        ...row,
        removedAt: record?.removalDate || record?.lastEventDate || "",
        confirmation: "expired-or-removed",
      };
      const heldUntil = expiredRow.removedAt || expiryInfo.expiry || "";
      const held = holdingDays(row.purchaseDate || row.boughtOn, heldUntil);
      expiredRow.holdingDays = held;
      expiredRow.holding = held;
      const daysSince = daysSinceDate(expiredRow.removedAt);
      if (daysSince !== null && daysSince <= RECENT_REMOVED_DAYS) {
        active.push({ ...expiredRow, recentlyRemoved: true });
      }
      if (isLikelyExpired(expiredRow)) expired.push(expiredRow);
      else removed.push(expiredRow);
      continue;
    }

    // Historic names and lapsed names belong in Expired with Gmail spend/dates filled.
    if (HISTORIC_SEED.has(key) || pastExpiry) {
      const removedAt = record?.removalDate || (pastExpiry ? expiryInfo.expiry : "") || "";
      const held = holdingDays(row.purchaseDate || row.boughtOn, removedAt || expiryInfo.expiry);
      expired.push({
        ...row,
        removedAt,
        confirmation: HISTORIC_SEED.has(key) && !record?.eventCount ? "historic-seed" : "expired",
        holdingDays: held,
        holding: held,
      });
      continue;
    }

    active.push(row);
  }

  active.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  sold.sort((a, b) => String(b.saleDate || "").localeCompare(String(a.saleDate || "")));
  expired.sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const expenses = listExpenseEvents(500).map((event) => ({
    id: event.id,
    domain: event.domain || "",
    vendor: event.vendor || event.registrar_hint || event.domain,
    subject: event.subject || "",
    date: event.event_date || "",
    amountUsd: event.amount_usd,
    amountInr: event.amount_inr,
    currency: event.currency_original || "USD",
    mailbox: event.mailbox || "",
    from: event.from_address || "",
    messageId: event.message_id || "",
  }));

  for (const event of expenses) {
    if (event.mailbox) mailboxesSeen.add(event.mailbox);
  }

  const mailboxList = resolveMailboxList([...mailboxesSeen]);
  const views = {};
  for (const item of mailboxList) {
    views[item.email] = active.filter((d) => d.mailbox === item.email);
  }

  const gmailRemovalRows = listRemovalEvents(100).map((event) => ({
    name: normalizeDomain(event.domain),
    registrar: event.registrar_hint || guessRegistrar(event.from_address) || "Gmail",
    source: "Gmail",
    removedAt: event.event_date || event.created_at,
    confirmation: "gmail-removed",
    subject: event.subject || "",
    mailbox: event.mailbox || defaultMailboxForDomain(event.domain),
  }));

  const removedMerged = mergeRemoved(removed, gmailRemovalRows).filter(
    (event) => !presentAtRegistrar.has(normalizeDomain(event.name)),
  );
  views.removed = removedMerged;

  for (const event of listSaleEvents(2000)) {
    const key = normalizeDomain(event.domain);
    if (!key || sold.some((row) => row.name === key)) continue;
    sold.push({
      name: key,
      soldFor: event.amount_gross ?? "",
      soldBeforeCommission: event.amount_gross ?? "",
      soldNet: event.amount_usd ?? "",
      soldAfterCommission: event.amount_usd ?? "",
      saleDate: event.event_date || "",
      sellPlatform: event.sale_platform || "",
      buyPlatform: "",
      purchaseAmount: "",
      renewalSpend: "",
      profit: "",
      mailbox: event.mailbox || defaultMailboxForDomain(key),
      registrar: event.registrar_hint || "Gmail",
      confirmation: "sold",
      holdingDays: "",
      holding: "",
    });
  }

  sold.sort((a, b) => String(b.saleDate || "").localeCompare(String(a.saleDate || "")));

  // Shared across every Gmail now and any mailbox added later — never split per inbox.
  views.sold = sold;
  views.expired = expired;
  views.expenses = expenses;

  const byMailboxCounts = Object.fromEntries(
    mailboxList.map((item) => [item.email, (views[item.email] || []).length]),
  );

  return {
    domains: active,
    views,
    removedDomains: removedMerged,
    soldDomains: sold,
    expiredDomains: expired,
    expenses,
    mailboxes: mailboxList,
    mailboxLabels: Object.fromEntries([
      ...mailboxList.map((item) => [item.email, mailboxViewLabel(item.email)]),
      ...SHARED_PORTFOLIO_VIEW_IDS.map((id) => [id, sharedPortfolioViewLabel(id)]),
    ]),
    sharedViews: SHARED_PORTFOLIO_VIEW_IDS,
    summary: {
      mode: "gmail-first",
      active: active.length,
      byMailbox: byMailboxCounts,
      sold: sold.length,
      expired: expired.length,
      expenses: expenses.length,
      removed: removedMerged.length,
      confirmed: active.filter((d) => d.apiConfirmed).length,
      gmailOnly: active.filter((d) => !d.apiConfirmed).length,
      apiOnly: 0,
      expiryFromApi: active.filter((d) => d.expirySource === "api").length,
      expiryFromGmail: active.filter(
        (d) => d.expirySource === "gmail" || d.expirySource === "gmail-estimate",
      ).length,
    },
  };
}

function pickMailbox(key, record, meta) {
  if (meta?.mailbox) return meta.mailbox;
  if (record?.mailbox) return record.mailbox;
  return defaultMailboxForDomain(key);
}

/**
 * Current owner of the name — not "which inbox happened to contain an old receipt".
 * Live registrar API + mailboxHint wins. Gold ★ only when that matching API listed the name.
 * Extra mailboxes stay ☆ until their Dynadot (or other) API key is set.
 */
function resolveDomainOwnership(key, record, meta, {
  presentAtRegistrar,
  mailboxHintByDomain,
  registrarAccountByDomain,
}) {
  const primary = getPrimaryMailbox();
  const apiHint = String(mailboxHintByDomain.get(key) || "").toLowerCase();
  const listed = presentAtRegistrar.has(key);

  if (listed) {
    const mappedAccount = mapRegistrarAccountToMailbox(registrarAccountByDomain.get(key) || "");
    const mailbox =
      (isKnownMailbox(apiHint) ? apiHint : "") ||
      (isKnownMailbox(mappedAccount) ? mappedAccount : "") ||
      primary;
    return {
      mailbox,
      apiConfirmed: true,
      awaitingMailboxRegistrarApi: false,
    };
  }

  const dynadotMailbox = String(record?.dynadotAccountMailbox || "").toLowerCase();
  if (isKnownMailbox(dynadotMailbox)) {
    const hasApi = dynadotApiConfiguredForMailbox(dynadotMailbox);
    return {
      mailbox: dynadotMailbox,
      apiConfirmed: false,
      awaitingMailboxRegistrarApi: !hasApi && dynadotMailbox !== primary,
    };
  }

  const mailbox =
    (dynadotMailbox.includes("@") ? dynadotMailbox : "") ||
    pickMailbox(key, record, meta) ||
    defaultMailboxForDomain(key) ||
    primary;

  const awaiting =
    isKnownMailbox(mailbox) &&
    mailbox !== primary &&
    !dynadotApiConfiguredForMailbox(mailbox);

  return {
    mailbox,
    apiConfirmed: false,
    awaitingMailboxRegistrarApi: awaiting,
  };
}

function isLikelyExpired(row) {
  if (daysRemaining(row.expiry) < 0) return true;
  if (/expir/i.test(row.confirmation || "")) return true;
  return !row.saleDate;
}

function daysRemaining(expiry) {
  if (!expiry) return 0;
  const parsed = Date.parse(expiry);
  if (Number.isNaN(parsed)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(parsed);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

function daysSinceDate(value) {
  const parsed = Date.parse(value || "");
  if (Number.isNaN(parsed)) return null;
  return Math.round((Date.now() - parsed) / 86400000);
}

function resolveExpiry({
  apiConfirmed,
  apiExpiry,
  gmailExpiry,
  purchaseDate,
  renewalCount,
  lastRenewalDate,
}) {
  if (apiConfirmed && apiExpiry) {
    return { expiry: apiExpiry, source: "api" };
  }

  const estimated = estimateExpiryFromLedger({
    purchaseDate,
    renewalCount,
    lastRenewalDate,
  });
  // Expiry notices can be stale after a later paid renewal. Keep the later date.
  if (gmailExpiry && estimated) {
    if (estimated > gmailExpiry) {
      return { expiry: estimated, source: "gmail-estimate" };
    }
    return { expiry: gmailExpiry, source: "gmail" };
  }
  if (gmailExpiry) {
    return { expiry: gmailExpiry, source: "gmail" };
  }
  if (estimated) {
    return { expiry: estimated, source: "gmail-estimate" };
  }

  return { expiry: "", source: "" };
}

function recordToDomain(name, record) {
  if (!record) {
    return {
      name,
      source: "Gmail",
      registrar: "Gmail",
      status: "active",
      eventCount: 0,
      ledgerSource: "gmail-events",
      expiry: "",
      registration: "",
      nameservers: "",
      purchaseAmount: "",
      renewalSpend: "",
      totalAmount: "",
      purchaseDate: "",
      holdingDays: "",
    };
  }

  const purchaseUsd = record.purchaseUsd;
  const purchaseInr = record.purchaseInr;
  const renewalUsd = record.renewalCount ? record.renewalTotalUsd : null;
  const renewalInr = record.renewalCount ? record.renewalTotalInr : null;
  const hasPurchase = purchaseUsd !== null || purchaseInr !== null;
  const hasRenewals = record.renewalCount > 0;
  const totalUsd =
    hasPurchase || hasRenewals ? Number(((purchaseUsd || 0) + (renewalUsd || 0)).toFixed(2)) : null;
  const totalInr =
    hasPurchase || hasRenewals ? Number(((purchaseInr || 0) + (renewalInr || 0)).toFixed(2)) : null;

  return {
    name,
    source: "Gmail",
    registrar: pickRegistrarHint(record) || "Gmail",
    status: "active",
    expiry: record.expiryDate || "",
    registration: "",
    nameservers: "",
    purchaseAmount: purchaseUsd ?? "",
    purchasePrice: purchaseUsd != null ? `$${Number(purchaseUsd).toFixed(2)}` : "",
    purchaseAmountUsd: purchaseUsd ?? "",
    purchaseAmountInr: purchaseInr ?? "",
    purchasePriceUsd: purchaseUsd != null ? `$${Number(purchaseUsd).toFixed(2)}` : "",
    purchasePriceInr: purchaseInr != null ? `₹${Number(purchaseInr).toFixed(2)}` : "",
    purchaseDate: record.purchaseDate || "",
    boughtOn: record.purchaseDate || "",
    holdingDays: record.purchaseDate ? holdingDays(record.purchaseDate) : "",
    holding: record.purchaseDate ? holdingDays(record.purchaseDate) : "",
    renewalCount: record.renewalCount || 0,
    renewalSpend: renewalUsd ?? "",
    renewalSpendUsd: renewalUsd ?? "",
    renewalSpendInr: renewalInr ?? "",
    renewalSpendPrice: renewalUsd != null ? `$${Number(renewalUsd).toFixed(2)}` : "",
    renewalSpendPriceUsd: renewalUsd != null ? `$${Number(renewalUsd).toFixed(2)}` : "",
    renewalSpendPriceInr: renewalInr != null ? `₹${Number(renewalInr).toFixed(2)}` : "",
    renewalDate: record.renewalDate || "",
    transferDate: record.transferDate || "",
    transferAmount: record.transferUsd ?? "",
    removalDate: record.removalDate || "",
    totalAmount: totalUsd ?? "",
    totalPrice: totalUsd != null ? `$${Number(totalUsd).toFixed(2)}` : "",
    totalAmountUsd: totalUsd ?? "",
    totalAmountInr: totalInr ?? "",
    totalPriceUsd: totalUsd != null ? `$${Number(totalUsd).toFixed(2)}` : "",
    totalPriceInr: totalInr != null ? `₹${Number(totalInr).toFixed(2)}` : "",
    fxRate: record.purchaseFxRate || "",
    fxRateDate: record.purchaseFxRateDate || "",
    eventCount: record.eventCount || 0,
    ledgerSource: "gmail-events",
    saleGrossUsd: record.saleGrossUsd ?? "",
    saleNetUsd: record.saleNetUsd ?? "",
    salePlatform: record.salePlatform || "",
    saleDate: record.saleDate || "",
    mailbox: record.mailbox || "",
  };
}

function isRemovedByGmail(record) {
  if (!record?.removalCount) return false;
  if (record.saleCount) return true;
  const removalTs = Date.parse(record.removalDate || "") || 0;
  const lastKeepTs = Math.max(
    record.purchaseTimestamp || 0,
    Date.parse(record.renewalDate || "") || 0,
    Date.parse(record.transferDate || "") || 0,
  );
  if (!removalTs) return record.removalCount > 0;
  return removalTs >= lastKeepTs;
}

function pickRegistrarHint(record) {
  for (const source of record?.sources || []) {
    const guessed = guessRegistrar(source);
    if (guessed) return guessed;
  }
  return "";
}

function mergeRemoved(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const event of list || []) {
      const key = `${normalizeDomain(event?.name)}|${event?.removedAt || ""}`;
      if (!event?.name || seen.has(key)) continue;
      seen.add(key);
      out.push(event);
    }
  }
  out.sort((a, b) => Date.parse(b.removedAt || "") - Date.parse(a.removedAt || ""));
  return out.slice(0, 200);
}

function holdingDays(purchaseDate, endDate = "") {
  const start = Date.parse(purchaseDate);
  if (Number.isNaN(start)) return "";
  const endParsed = Date.parse(endDate || "");
  const end = new Date(Number.isNaN(endParsed) ? Date.now() : endParsed);
  const purchase = new Date(start);
  purchase.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return String(Math.max(0, Math.round((end - purchase) / 86400000)));
}

function guessRegistrar(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("dynadot")) return "Dynadot";
  if (text.includes("namesilo")) return "NameSilo";
  if (text.includes("sav.com") || text.includes("sav ")) return "Sav";
  if (text.includes("name.com")) return "Name.com";
  if (text.includes("spaceship")) return "Spaceship";
  if (text.includes("unstoppable")) return "Unstoppable";
  if (text.includes("godaddy")) return "GoDaddy";
  if (text.includes("porkbun")) return "Porkbun";
  if (text.includes("snapnames")) return "SnapNames";
  if (text.includes("dropcatch")) return "DropCatch";
  if (text.includes("namecheap")) return "Namecheap";
  if (text.includes("cosmotown")) return "Cosmotown";
  if (text.includes("namebright")) return "NameBright";
  if (text.includes("afternic")) return "Afternic";
  return "";
}

/** PDF: profit = after-commission (or sold-for if net missing) − buy − renewals. */
function computeSaleProfit(record, base) {
  const net = record?.saleNetUsd;
  const gross = record?.saleGrossUsd;
  const proceeds = net != null ? Number(net) : gross != null ? Number(gross) : null;
  if (proceeds == null || !Number.isFinite(proceeds)) return "";
  const buy = Number(base?.purchaseAmount || 0) || 0;
  const renew = Number(base?.renewalSpend || 0) || 0;
  return Number((proceeds - buy - renew).toFixed(2));
}

function normalizeDomain(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "")
    .trim();
}
