const dynadotBaseUrl = () => process.env.DYNADOT_BASE_URL || "https://api.dynadot.com";
const namesiloBaseUrl = () => process.env.NAMESILO_BASE_URL || "https://www.namesilo.com/api";
const savBaseUrl = () => process.env.SAV_BASE_URL || "https://api.sav.com";
const spaceshipBaseUrl = () => process.env.SPACESHIP_BASE_URL || "https://spaceship.dev/api";
const unstoppableBaseUrl = () => process.env.UD_API_BASE_URL || "https://api.unstoppabledomains.com";
const unstoppableResellerBaseUrl = () => `${unstoppableBaseUrl()}/partner/v3`;

export async function getRegistrarDomains() {
  const settled = await Promise.allSettled([
    fetchDynadotDomains(),
    fetchNameSiloDomains(),
    fetchSavDomains(),
    fetchSpaceshipDomains(),
    fetchUnstoppableDomains(),
    fetchUnstoppableBillingTransactions(),
  ]);

  const dynadotResult = settled[0];
  const namesiloResult = settled[1];
  const savResult = settled[2];
  const spaceshipResult = settled[3];
  const unstoppableResult = settled[4];
  const unstoppableBillingResult = settled[5];

  const dynadotDomains = dynadotResult.status === "fulfilled" ? dynadotResult.value : [];
  const namesiloDomains = namesiloResult.status === "fulfilled" ? namesiloResult.value : [];
  const savDomains = savResult.status === "fulfilled" ? savResult.value : [];
  const spaceshipDomains = spaceshipResult.status === "fulfilled" ? spaceshipResult.value : [];
  const unstoppableDomains = unstoppableResult.status === "fulfilled" ? unstoppableResult.value : [];
  const unstoppableBillingTransactions =
    unstoppableBillingResult.status === "fulfilled" ? unstoppableBillingResult.value : [];
  const domains = mergeDomains(
    dynadotDomains,
    namesiloDomains,
    savDomains,
    spaceshipDomains,
    unstoppableDomains,
  );
  const mergedDomains = applyUnstoppableBillingPrices(domains, unstoppableBillingTransactions);
  const providerErrors = [];

  if (dynadotResult.status === "rejected") {
    providerErrors.push({
      provider: "Dynadot",
      error: dynadotResult.reason instanceof Error ? dynadotResult.reason.message : String(dynadotResult.reason),
    });
  }
  if (namesiloResult.status === "rejected") {
    providerErrors.push({
      provider: "NameSilo",
      error: namesiloResult.reason instanceof Error ? namesiloResult.reason.message : String(namesiloResult.reason),
    });
  }
  if (savResult.status === "rejected") {
    providerErrors.push({
      provider: "Sav",
      error: savResult.reason instanceof Error ? savResult.reason.message : String(savResult.reason),
    });
  }
  if (spaceshipResult.status === "rejected") {
    providerErrors.push({
      provider: "Spaceship",
      error: spaceshipResult.reason instanceof Error ? spaceshipResult.reason.message : String(spaceshipResult.reason),
    });
  }
  if (unstoppableResult.status === "rejected") {
    providerErrors.push({
      provider: "Unstoppable",
      error: unstoppableResult.reason instanceof Error ? unstoppableResult.reason.message : String(unstoppableResult.reason),
    });
  }
  if (unstoppableBillingResult.status === "rejected") {
    providerErrors.push({
      provider: "Unstoppable Billing",
      error: unstoppableBillingResult.reason instanceof Error ? unstoppableBillingResult.reason.message : String(unstoppableBillingResult.reason),
    });
  }

  return {
    domains: mergedDomains,
    providerDomains: {
      dynadot: dynadotDomains,
      namesilo: namesiloDomains,
      sav: savDomains,
      spaceship: spaceshipDomains,
      unstoppable: unstoppableDomains,
    },
    providerErrors,
    providers: {
      dynadot: { ok: dynadotResult.status === "fulfilled", count: dynadotDomains.length },
      namesilo: { ok: namesiloResult.status === "fulfilled", count: namesiloDomains.length },
      sav: { ok: savResult.status === "fulfilled", count: savDomains.length },
      spaceship: { ok: spaceshipResult.status === "fulfilled", count: spaceshipDomains.length },
      unstoppable: { ok: unstoppableResult.status === "fulfilled", count: unstoppableDomains.length },
    },
  };
}

async function fetchDynadotDomains() {
  const apiKey = process.env.DYNADOT_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(
    `${dynadotBaseUrl()}/api3.json?key=${encodeURIComponent(apiKey)}&command=list_domain&count_per_page=1000&page_index=1&sort=NameAsc`,
  );
  if (!response.ok) {
    throw new Error(`Dynadot list_domain returned HTTP ${response.status}`);
  }
  return extractDynadotDomains(await response.json());
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

async function fetchSavDomains() {
  const apiKey = process.env.SAV_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(`${savBaseUrl()}/domains_api_v1/get_active_domains_in_account`, {
    method: "GET",
    headers: {
      APIKEY: apiKey,
      Accept: "application/json",
    },
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Sav get_active_domains_in_account returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  return extractSavDomains(parseJson(raw));
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

async function fetchUnstoppableBillingTransactions() {
  const apiKey = process.env.UD_MCP_API_KEY;
  if (!apiKey) return [];

  const attempts = [
    {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    {
      "x-api-key": apiKey,
      Accept: "application/json",
    },
  ];

  for (const headers of attempts) {
    const response = await fetch(`${unstoppableResellerBaseUrl()}/account/billing/transactions`, {
      method: "GET",
      headers,
    });

    const raw = await response.text();
    if (response.ok) {
      return extractUnstoppableBillingTransactions(parseJson(raw));
    }
    if (response.status !== 401 && response.status !== 403) {
      throw new Error(`Unstoppable billing transactions returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    }
  }

  return [];
}

function extractDynadotDomains(payload) {
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
        status: domain.Status || "unknown",
        expiry: formatDynadotTimestamp(domain.Expiration),
        registration: formatDynadotTimestamp(domain.Registration),
        privacy: domain.Privacy || "-",
        renewOption: domain.RenewOption || "-",
        nameservers: domain.NameServerSettings?.Type || "-",
        folder: domain.Folder?.FolderName || "-",
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

      const autoRenewal = domain.autoRenewal || {};
      const listing = domain.listing || {};

      return {
        name,
        source: "Unstoppable",
        registrar: "Unstoppable",
        marketplacePrice: formatUnstoppablePrice(domain?.listing?.price),
        status:
          domain.transferStatus ||
          domain.registryType ||
          (domain.isExternallyOwned ? "externally-owned" : "owned"),
        expiry: domain.expiresAt || domain.lifecycle?.expiresAt || "-",
        registration: domain.purchasedAt || domain.lifecycle?.purchasedAt || "-",
        privacy: domain.flags?.DNS_WHOIS_PROXY?.status || "-",
        renewOption: autoRenewal.status || domain.lifecycle?.autoRenewal?.status || "-",
        transferStatus: domain.transferStatus || domain.lifecycle?.transferStatus || "-",
        registryType: domain.extension ? `.${domain.extension}` : "-",
        listingStatus: listing.status || "-",
      };
    })
    .filter(Boolean);
}

function extractUnstoppableBillingTransactions(payload) {
  const items =
    payload?.transactions ||
    payload?.data?.transactions ||
    payload?.data ||
    payload?.results ||
    payload?.items ||
    [];

  const list = Array.isArray(items) ? items : [items];
  return list
    .map((transaction) => {
      const text = [
        deepFindString(transaction, [
          /^domain$/i,
          /domain_name/i,
          /domainName/i,
          /description/i,
          /memo/i,
          /note/i,
          /title/i,
        ]),
        deepFindString(transaction, [/^name$/i, /itemName/i, /productName/i]),
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      const domainName = extractDomainNameFromText(text) || deepFindString(transaction, [/^domain$/i, /domain_name/i, /domainName/i]);
      if (!domainName) return null;

      const amount =
        deepFindValue(transaction, [
          /amountFormatted/i,
          /formattedAmount/i,
          /totalFormatted/i,
          /chargeFormatted/i,
          /priceFormatted/i,
        ]) ??
        deepFindValue(transaction, [
          /amount$/i,
          /^amount$/i,
          /total/i,
          /grossAmount/i,
          /netAmount/i,
          /price/i,
          /charge/i,
        ]);

      const formattedAmount = formatUnstoppableTransactionAmount(amount);
      if (!formattedAmount) return null;

      return {
        domainName,
        searchText: text,
        amountFormatted: formattedAmount,
        amountValue: parseUnstoppableTransactionAmountValue(amount),
        timestamp: normalizeDateValue(
          deepFindValue(transaction, [/createdAt/i, /processedAt/i, /transactionDate/i, /date/i, /timestamp/i]),
        ),
        type: deepFindString(transaction, [/^type$/i, /transactionType/i, /kind/i]) || "",
      };
    })
    .filter(Boolean);
}

function applyUnstoppableBillingPrices(domains, transactions) {
  if (!Array.isArray(domains) || !Array.isArray(transactions) || !transactions.length) return domains;

  const bestByDomain = new Map();
  for (const transaction of transactions) {
    const key = normalizeDomainKey(transaction.domainName);
    if (!key) continue;
    if (!isPurchaseLikeTransaction(transaction)) continue;

    const timestamp = Date.parse(transaction.timestamp || "");
    const existing = bestByDomain.get(key);
    if (!existing) {
      bestByDomain.set(key, transaction);
      continue;
    }

    const existingTime = Date.parse(existing.timestamp || "");
    if (Number.isFinite(timestamp) && Number.isFinite(existingTime) && timestamp < existingTime) {
      bestByDomain.set(key, transaction);
      continue;
    }

    if (!existing.amountFormatted && transaction.amountFormatted) {
      bestByDomain.set(key, transaction);
    }
  }

  return domains.map((domain) => {
    if (!isUnstoppableDomain(domain)) return domain;
    const transaction = bestByDomain.get(normalizeDomainKey(domain.name));
    if (!transaction) return domain;

    return {
      ...domain,
      purchasePrice: transaction.amountFormatted,
      purchaseAmount: transaction.amountValue ?? domain.purchaseAmount ?? "",
      purchaseSource: "unstoppable-billing",
    };
  });
}

function isUnstoppableDomain(domain) {
  return String(domain?.source || "").toLowerCase().includes("unstoppable");
}

function isPurchaseLikeTransaction(transaction) {
  const text = `${transaction?.type || ""} ${transaction?.searchText || ""} ${transaction?.domainName || ""}`.toLowerCase();
  return (
    /(purchase|registration|register|buy|checkout|order)/i.test(text) &&
    !/(renewal|renew|renewed)/i.test(text)
  );
}

function extractDomainNameFromText(text) {
  const match = String(text || "").match(/\b([a-z0-9-]+\.[a-z]{2,})\b/i);
  return match?.[1] || "";
}

function parseUnstoppableTransactionAmountValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return value > 100 ? value / 100 : value;
    }
    return value;
  }

  const normalized = String(value).replace(/,/g, "").trim();
  if (!normalized) return null;
  if (/^[\$\€\£\₹]/.test(normalized)) {
    const numeric = Number(normalized.replace(/[^\d.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (/^-?\d+\.\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (/^-?\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 100 ? numeric / 100 : numeric;
  }
  return null;
}

function formatUnstoppableTransactionAmount(value) {
  if (value === null || value === undefined || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    const dollars = Number.isInteger(value) && value > 100 ? value / 100 : value;
    return `$${Number(dollars).toFixed(2)}`;
  }

  const normalized = String(value).trim();
  if (!normalized) return "";
  if (/^[\$\€\£\₹]/.test(normalized)) return normalized;

  const numeric = Number(normalized.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return normalized;
  const dollars = /^\d+$/.test(normalized) && numeric > 100 ? numeric / 100 : numeric;
  return `$${Number(dollars).toFixed(2)}`;
}

function formatUnstoppablePrice(value) {
  if (value === null || value === undefined || value === "") return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    return `$${(value / 100).toFixed(2)}`;
  }

  const normalized = String(value).trim();
  if (!normalized) return "";
  if (/^[\$\€\£\₹]/.test(normalized)) return normalized;
  if (/^[A-Z]{3}\s+[0-9]/.test(normalized)) return normalized;

  const parsed = Number(normalized.replace(/,/g, ""));
  if (Number.isFinite(parsed)) {
    return `$${(parsed / 100).toFixed(2)}`;
  }

  return normalized;
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
        status: item?.status || reply?.status || "unknown",
        expiry: normalizeDateValue(item?.expires || item?.expiry || item?.expiration || item?.expiration_date),
        registration: normalizeDateValue(item?.created || item?.registration || item?.registration_date),
        privacy: item?.private || item?.privacy || "-",
        renewOption: item?.auto_renew || item?.renew || "-",
      };
    })
    .filter(Boolean);
}

function extractSavDomains(payload) {
  const reply = payload?.reply || payload?.data || payload?.response || payload;
  const items =
    reply?.domains ||
    reply?.domain ||
    reply?.active_domains ||
    reply?.activeDomains ||
    reply?.domains_list ||
    reply?.domain_list ||
    reply?.domainsList ||
    reply?.activeDomainList ||
    [];

  const list = Array.isArray(items) ? items : [items];
  return list
    .map((item) => {
      const name =
        deepFindString(item, [/^domain$/i, /domain_name/i, /domainname/i, /domain_label/i, /^name$/i, /^label$/i]) ||
        deepFindString(reply, [/^domain$/i, /domain_name/i, /domainname/i, /domain_label/i, /^name$/i, /^label$/i]);
      if (!name) return null;
      return {
        name,
        source: "Sav",
        registrar: "Sav",
        status:
          deepFindString(item, [/^status$/i, /domain_status/i, /domainStatus/i, /^state$/i, /domain_state/i]) ||
          deepFindString(reply, [/^status$/i, /response_status/i]) ||
          "unknown",
        expiry: normalizeDateValue(
          deepFindString(item, [
            /expiry/i,
            /expires_at/i,
            /expiration/i,
            /expiration_date/i,
            /expires_on/i,
            /renewal_date/i,
            /next_renewal_date/i,
          ]),
        ),
        registration: normalizeDateValue(
          deepFindString(item, [
            /purchase_date/i,
            /registration_date/i,
            /registered_at/i,
            /created_at/i,
            /date_created/i,
            /^created$/i,
            /^registration$/i,
          ]),
        ),
        privacy: deepFindString(item, [/privacy/i, /whois_privacy/i, /private/i, /is_private/i]) || "-",
        renewOption: deepFindString(item, [/auto_renew/i, /autoRenew/i, /auto_renewal/i, /renew$/i]) || "-",
        transferStatus: deepFindString(item, [/transfer_status/i, /transferStatus/i, /^transfer$/i]) || "-",
        registryType: deepFindString(item, [/registry_type/i, /registryType/i, /^tld$/i, /extension/i]) || "-",
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

      const nameservers = Array.isArray(item?.nameservers?.hosts)
        ? item.nameservers.hosts.join(", ")
        : item?.nameservers?.provider || "-";

      return {
        name,
        source: "Spaceship",
        registrar: "Spaceship",
        status: item?.lifecycleStatus || item?.verificationStatus || "unknown",
        expiry: normalizeDateValue(item?.expirationDate),
        registration: normalizeDateValue(item?.registrationDate),
        privacy:
          item?.privacyProtection?.level ||
          (item?.privacyProtection?.contactForm ? "contact-form" : "-"),
        renewOption: item?.autoRenew === true ? "enabled" : item?.autoRenew === false ? "disabled" : "-",
        transferStatus: (item?.eppStatuses || []).join(", ") || "-",
        registryType: item?.isPremium ? "premium" : item?.unicodeName ? "idn" : "-",
        nameservers,
      };
    })
    .filter(Boolean);
}

function mergeDomains(...lists) {
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
      source: existing.source === item.source ? existing.source : `${existing.source}, ${item.source}`,
    });
  }
  return [...map.values()];
}

function formatDynadotTimestamp(value) {
  if (value === undefined || value === null || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return String(value);
  const date = new Date(numeric);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function normalizeDateValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  return String(value);
}

function deepFindString(node, patterns) {
  const value = deepFindValue(node, patterns);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return "";
}

function deepFindValue(node, patterns) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindValue(item, patterns);
      if (found !== null && found !== undefined && found !== "") return found;
    }
    return null;
  }

  for (const [key, value] of Object.entries(node)) {
    if (patterns.some((pattern) => pattern.test(key))) {
      if (value !== null && value !== undefined && value !== "") return value;
    }
    const found = deepFindValue(value, patterns);
    if (found !== null && found !== undefined && found !== "") return found;
  }
  return null;
}

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
