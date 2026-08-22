import { getPrimaryMailbox, mapRegistrarAccountToMailbox } from "../data/mailboxes.js";

const dynadotBaseUrl = () => process.env.DYNADOT_BASE_URL || "https://api.dynadot.com";
const namesiloBaseUrl = () => process.env.NAMESILO_BASE_URL || "https://www.namesilo.com/api";
const spaceshipBaseUrl = () => process.env.SPACESHIP_BASE_URL || "https://spaceship.dev/api";
const unstoppableBaseUrl = () => process.env.UD_API_BASE_URL || "https://api.unstoppabledomains.com";

/** Registrar APIs: presence confirmation + expiry dates (spend still comes from Gmail). */
export async function getRegistrarDomains() {
  const settled = await Promise.allSettled([
    fetchDynadotDomains(),
    fetchNameSiloDomains(),
    fetchSpaceshipDomains(),
    fetchUnstoppableDomains(),
  ]);

  const dynadotResult = settled[0];
  const namesiloResult = settled[1];
  const spaceshipResult = settled[2];
  const unstoppableResult = settled[3];

  const dynadotDomains = dynadotResult.status === "fulfilled" ? dynadotResult.value : [];
  const namesiloDomains = namesiloResult.status === "fulfilled" ? namesiloResult.value : [];
  const spaceshipDomains = spaceshipResult.status === "fulfilled" ? spaceshipResult.value : [];
  const unstoppableDomains = unstoppableResult.status === "fulfilled" ? unstoppableResult.value : [];
  const domains = mergeDomains(dynadotDomains, namesiloDomains, spaceshipDomains, unstoppableDomains);
  const providerErrors = [];

  if (dynadotResult.status === "rejected") {
    providerErrors.push({
      provider: "Dynadot",
      error: formatProviderError(dynadotResult.reason),
    });
  }
  if (namesiloResult.status === "rejected") {
    providerErrors.push({
      provider: "NameSilo",
      error: formatProviderError(namesiloResult.reason),
    });
  }
  if (spaceshipResult.status === "rejected") {
    providerErrors.push({
      provider: "Spaceship",
      error: formatProviderError(spaceshipResult.reason),
    });
  }
  if (unstoppableResult.status === "rejected") {
    providerErrors.push({
      provider: "Unstoppable",
      error: formatProviderError(unstoppableResult.reason),
    });
  }

  return {
    domains,
    providerDomains: {
      dynadot: dynadotDomains,
      namesilo: namesiloDomains,
      spaceship: spaceshipDomains,
      unstoppable: unstoppableDomains,
    },
    providerErrors,
    providers: {
      dynadot: {
        ok: dynadotResult.status === "fulfilled",
        count: dynadotDomains.length,
        accounts: listDynadotAccounts().map((account) => ({
          label: account.label,
          mailbox: account.mailboxHint || "",
        })),
        extraKeysConfigured: listDynadotAccounts().filter((account) => account.label !== "primary").length,
      },
      namesilo: { ok: namesiloResult.status === "fulfilled", count: namesiloDomains.length },
      spaceship: { ok: spaceshipResult.status === "fulfilled", count: spaceshipDomains.length },
      unstoppable: { ok: unstoppableResult.status === "fulfilled", count: unstoppableDomains.length },
    },
  };
}

async function fetchDynadotDomains() {
  const accounts = listDynadotAccounts();
  if (!accounts.length) return [];

  const settled = await Promise.allSettled(
    accounts.map((account) => fetchDynadotDomainsForKey(account)),
  );

  const merged = [];
  const errors = [];
  for (let i = 0; i < settled.length; i += 1) {
    const result = settled[i];
    const account = accounts[i];
    if (result.status === "fulfilled") {
      merged.push(...result.value);
      continue;
    }
    errors.push(
      `${account.label}: ${formatProviderError(result.reason)}`,
    );
  }
  if (errors.length && !merged.length) {
    throw new Error(errors.join(" | "));
  }
  // Partial success is OK (e.g. primary works, letsliterate key not added yet).
  return dedupeDomains(merged);
}

/**
 * Primary Dynadot key plus extras from env — never hardcoded to one Gmail.
 *
 *   DYNADOT_API_KEYS=letsliterate@gmail.com=KEY,third@gmail.com=KEY
 *   DYNADOT_API_KEY_LETSLITERATE=...   (legacy alias, still works)
 *   DYNADOT_API_KEY_<LABEL>=...        (LABEL maps via REGISTRAR_ACCOUNT_MAP)
 */
export function listDynadotAccounts() {
  const accounts = [];
  const seenKeys = new Set();
  const primary = String(process.env.DYNADOT_API_KEY || "").trim();
  if (primary) {
    accounts.push({
      label: "primary",
      apiKey: primary,
      mailboxHint: getPrimaryMailbox(),
    });
    seenKeys.add(primary);
  }

  for (const extra of extraDynadotAccounts()) {
    if (!extra.apiKey || seenKeys.has(extra.apiKey)) continue;
    seenKeys.add(extra.apiKey);
    accounts.push(extra);
  }
  return accounts;
}

function extraDynadotAccounts() {
  const extras = [];
  const blob = String(process.env.DYNADOT_API_KEYS || "").trim();
  if (blob) {
    for (const part of blob.split(/[\n,]+/)) {
      const text = part.trim();
      if (!text) continue;
      const eq = text.indexOf("=");
      const colon = text.indexOf(":");
      const sep = eq >= 0 ? eq : colon;
      if (sep <= 0) continue;
      const mailboxRaw = text.slice(0, sep).trim();
      const apiKey = text.slice(sep + 1).trim();
      if (!apiKey) continue;
      const mailboxHint = mapRegistrarAccountToMailbox(mailboxRaw) || normalizeMailbox(mailboxRaw);
      extras.push({
        label: localLabel(mailboxHint || mailboxRaw),
        apiKey,
        mailboxHint,
      });
    }
  }

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envKey.startsWith("DYNADOT_API_KEY_") || envKey === "DYNADOT_API_KEYS") continue;
    const apiKey = String(envValue || "").trim();
    if (!apiKey) continue;
    const label = envKey.replace(/^DYNADOT_API_KEY_/, "").toLowerCase();
    const mailboxHint = mapRegistrarAccountToMailbox(label);
    extras.push({
      label,
      apiKey,
      mailboxHint,
    });
  }

  const legacy = String(process.env.DYNADOT_LETSLITERATE_API_KEY || "").trim();
  if (legacy) {
    extras.push({
      label: "letsliterate",
      apiKey: legacy,
      mailboxHint: mapRegistrarAccountToMailbox("letsliterate"),
    });
  }
  return extras;
}

function normalizeMailbox(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function localLabel(value) {
  const key = normalizeMailbox(value);
  return key.includes("@") ? key.split("@")[0] : key || "extra";
}

export function dynadotApiConfiguredForMailbox(mailbox) {
  const email = normalizeMailbox(mailbox);
  if (!email) return false;
  return listDynadotAccounts().some((account) => normalizeMailbox(account.mailboxHint) === email);
}

/** @deprecated Use dynadotApiConfiguredForMailbox */
export function isLetsLiterateDynadotApiConfigured() {
  return dynadotApiConfiguredForMailbox(mapRegistrarAccountToMailbox("letsliterate"));
}

async function fetchDynadotDomainsForKey(account) {
  const response = await fetch(
    `${dynadotBaseUrl()}/api3.json?key=${encodeURIComponent(account.apiKey)}&command=list_domain&count_per_page=1000&page_index=1&sort=NameAsc`,
  );
  if (!response.ok) {
    throw new Error(`Dynadot list_domain (${account.label}) returned HTTP ${response.status}`);
  }
  return extractDynadotDomains(await response.json(), {
    mailboxHint: account.mailboxHint,
    dynadotAccount: account.label,
  });
}

async function fetchNameSiloDomains() {
  const apiKey = process.env.NAMESILO_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(
    `${namesiloBaseUrl()}/listDomains?version=1&type=json&key=${encodeURIComponent(apiKey)}`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
    },
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`NameSilo listDomains returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  return extractNameSiloDomains(parseJson(raw));
}

async function fetchSpaceshipDomains() {
  const apiKey = process.env.SPACESHIP_API_KEY;
  const apiSecret = process.env.SPACESHIP_API_SECRET;
  if (!apiKey || !apiSecret) return [];

  const response = await fetch(`${spaceshipBaseUrl()}/v1/domains?take=100&skip=0&orderBy=name`, {
    method: "GET",
    headers: {
      "X-API-Key": apiKey,
      "X-API-Secret": apiSecret,
      Accept: "application/json",
    },
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Spaceship get domain list returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  return extractSpaceshipDomains(parseJson(raw));
}

async function fetchUnstoppableDomains() {
  const apiKey = process.env.UD_MCP_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(`${unstoppableBaseUrl()}/mcp/v1/actions/ud_portfolio_list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({}),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Unstoppable portfolio_list returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  return dedupeDomains(extractUnstoppableDomains(parseJson(raw)));
}

function extractDynadotDomains(payload, options = {}) {
  const mainDomains =
    payload?.ListDomainInfoResponse?.MainDomains ||
    payload?.ListDomainInfoResponse?.ListDomainInfoContent?.DomainInfoList ||
    payload?.MainDomains ||
    payload?.DomainInfoList ||
    [];

  const list = Array.isArray(mainDomains)
    ? mainDomains
    : Array.isArray(mainDomains?.DomainInfo)
      ? mainDomains.DomainInfo
      : Array.isArray(mainDomains?.Domain)
        ? mainDomains.Domain
        : [];

  return list
    .map((item) => {
      const domain = item?.Domain || item || {};
      const name = domain.Name || domain.name || "";
      if (!name) return null;
      return {
        name,
        source: "Dynadot",
        registrar: "Dynadot",
        expiry: formatDynadotTimestamp(domain.Expiration),
        registration: formatDynadotTimestamp(domain.Registration),
        mailboxHint: options.mailboxHint || "",
        dynadotAccount: options.dynadotAccount || "",
      };
    })
    .filter(Boolean);
}

function extractUnstoppableDomains(payload) {
  const items =
    payload?.domains ||
    payload?.data?.domains ||
    payload?.result?.domains ||
    payload?.portfolio?.domains ||
    [];

  return (Array.isArray(items) ? items : [])
    .map((domain) => {
      const name = domain.name || domain.domain || "";
      if (!name) return null;
      return {
        name,
        source: "Unstoppable",
        registrar: "Unstoppable",
        expiry: normalizeDateValue(domain.expiresAt || domain.autoRenewal?.expiresAt),
        registration: normalizeDateValue(domain.purchasedAt),
      };
    })
    .filter(Boolean);
}

function extractNameSiloDomains(payload) {
  const reply = payload?.reply || payload?.namesilo?.reply || payload;
  const items =
    reply?.domains?.domain ||
    reply?.domains ||
    reply?.domain ||
    reply?.domainList ||
    reply?.list ||
    [];

  const list = Array.isArray(items) ? items : [items];
  return list
    .map((item) => {
      const name =
        item?.domain ||
        item?.name ||
        item?.domain_name ||
        item?.Domain ||
        item?.domainName ||
        item?.domainname;
      if (!name) return null;
      return {
        name,
        source: "NameSilo",
        registrar: "NameSilo",
        expiry: normalizeDateValue(item?.expires || item?.expiry || item?.expiration || item?.expiration_date),
        registration: normalizeDateValue(item?.created || item?.registration || item?.registration_date),
      };
    })
    .filter(Boolean);
}

function extractSpaceshipDomains(payload) {
  const items = payload?.items || payload?.data?.items || payload?.domains || [];
  const list = Array.isArray(items) ? items : [];

  return list
    .map((item) => {
      const name = item?.unicodeName || item?.name || "";
      if (!name) return null;

      return {
        name,
        source: "Spaceship",
        registrar: "Spaceship",
        expiry: normalizeDateValue(item?.expirationDate),
        registration: normalizeDateValue(item?.registrationDate),
      };
    })
    .filter(Boolean);
}

export function mergeDomains(...lists) {
  const merged = dedupeDomains(lists.flat());
  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

function dedupeDomains(list) {
  const map = new Map();
  for (const item of list) {
    if (!item?.name) continue;
    const key = item.name.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }
    map.set(key, {
      ...existing,
      ...item,
      // Prefer explicit mailbox hint (e.g. letsliterate Dynadot account).
      mailboxHint: item.mailboxHint || existing.mailboxHint || "",
      dynadotAccount: item.dynadotAccount || existing.dynadotAccount || "",
      expiry: item.expiry || existing.expiry || "",
      registration: item.registration || existing.registration || "",
      source: existing.source === item.source ? existing.source : `${existing.source}, ${item.source}`,
    });
  }
  return [...map.values()];
}

function formatDynadotTimestamp(value) {
  if (value === undefined || value === null || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return normalizeDateValue(value);
  const date = new Date(numeric);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normalizeDateValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return "";
}

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

/** Surface DNS/network causes — Node often only says "fetch failed". */
function formatProviderError(reason) {
  if (!(reason instanceof Error)) return String(reason);
  const cause = reason.cause;
  const code = cause?.code || "";
  const detail = cause?.message || "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return `DNS failed (${code}) — restart npm start in your own terminal (not Cursor sandbox)`;
  }
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ENETUNREACH") {
    return `network ${code}${detail ? `: ${detail}` : ""}`;
  }
  if (code || detail) {
    return `${reason.message}${code ? ` [${code}]` : ""}${detail && detail !== reason.message ? `: ${detail}` : ""}`;
  }
  return reason.message;
}
