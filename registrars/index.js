const dynadotBaseUrl = () => process.env.DYNADOT_BASE_URL || "https://api.dynadot.com";
const namesiloBaseUrl = () => process.env.NAMESILO_BASE_URL || "https://www.namesilo.com/api";
const savBaseUrl = () => process.env.SAV_BASE_URL || "https://api.sav.com";
const spaceshipBaseUrl = () => process.env.SPACESHIP_BASE_URL || "https://spaceship.dev/api";
const unstoppableBaseUrl = () => process.env.UD_API_BASE_URL || "https://api.unstoppabledomains.com";

export async function getRegistrarDomains() {
  const settled = await Promise.allSettled([
    fetchDynadotDomains(),
    fetchNameSiloDomains(),
    fetchSavDomains(),
    fetchSpaceshipDomains(),
    fetchUnstoppableDomains(),
  ]);

  const dynadotResult = settled[0];
  const namesiloResult = settled[1];
  const savResult = settled[2];
  const spaceshipResult = settled[3];
  const unstoppableResult = settled[4];

  const dynadotDomains = dynadotResult.status === "fulfilled" ? dynadotResult.value : [];
  const namesiloDomains = namesiloResult.status === "fulfilled" ? namesiloResult.value : [];
  const savDomains = savResult.status === "fulfilled" ? savResult.value : [];
  const spaceshipDomains = spaceshipResult.status === "fulfilled" ? spaceshipResult.value : [];
  const unstoppableDomains = unstoppableResult.status === "fulfilled" ? unstoppableResult.value : [];
  const domains = mergeDomains(
    dynadotDomains,
    namesiloDomains,
    savDomains,
    spaceshipDomains,
    unstoppableDomains,
  );
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

  return {
    domains,
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
