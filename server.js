import http from "node:http";
import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;

loadDotEnv(path.join(root, ".env"));

const port = Number(process.env.PORT || 3001);
const dynadotBaseUrl = process.env.DYNADOT_BASE_URL || "https://api.dynadot.com";
const namesiloBaseUrl = process.env.NAMESILO_BASE_URL || "https://www.namesilo.com/api";
const savBaseUrl = process.env.SAV_BASE_URL || "https://api.sav.com";
const spaceshipBaseUrl = process.env.SPACESHIP_BASE_URL || "https://spaceship.dev/api";
const unstoppableBaseUrl = process.env.UD_API_BASE_URL || "https://api.unstoppabledomains.com";

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/domains") {
    handleDomainSync(res);
    return;
  }

  if (url.pathname === "/api/settings/unstoppable" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) {
          sendJson(res, 400, { error: "apiKey is required" });
          return;
        }
        upsertEnvValue(path.join(root, ".env"), "UD_MCP_API_KEY", apiKey);
        process.env.UD_MCP_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    return;
  }

  if (url.pathname === "/api/settings/namesilo" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) {
          sendJson(res, 400, { error: "apiKey is required" });
          return;
        }
        upsertEnvValue(path.join(root, ".env"), "NAMESILO_API_KEY", apiKey);
        process.env.NAMESILO_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    return;
  }

  if (url.pathname === "/api/settings/sav" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) {
          sendJson(res, 400, { error: "apiKey is required" });
          return;
        }
        upsertEnvValue(path.join(root, ".env"), "SAV_API_KEY", apiKey);
        process.env.SAV_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    return;
  }

  if (url.pathname === "/api/settings/spaceship" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        const apiSecret = String(parsed?.apiSecret || "").trim();
        if (!apiKey || !apiSecret) {
          sendJson(res, 400, { error: "apiKey and apiSecret are required" });
          return;
        }
        upsertEnvValue(path.join(root, ".env"), "SPACESHIP_API_KEY", apiKey);
        upsertEnvValue(path.join(root, ".env"), "SPACESHIP_API_SECRET", apiSecret);
        process.env.SPACESHIP_API_KEY = apiKey;
        process.env.SPACESHIP_API_SECRET = apiSecret;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      env: {
        dynadotConfigured: Boolean(process.env.DYNADOT_API_KEY && process.env.DYNADOT_SECRET_KEY),
        namesiloConfigured: Boolean(process.env.NAMESILO_API_KEY),
        savConfigured: Boolean(process.env.SAV_API_KEY),
        spaceshipConfigured: Boolean(process.env.SPACESHIP_API_KEY && process.env.SPACESHIP_API_SECRET),
        unstoppableConfigured: Boolean(process.env.UD_MCP_API_KEY),
        gmailConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      },
    });
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(root, pathname);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : ext === ".md"
            ? "text/markdown; charset=utf-8"
            : "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Domain Ledger running at http://localhost:${port}`);
});

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function handleDomainSync(res) {
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
  const domains = mergeDomains(dynadotDomains, namesiloDomains, savDomains, spaceshipDomains, unstoppableDomains);
  const providerErrors = [];

  if (dynadotResult.status === "rejected") {
    providerErrors.push({
      provider: "Dynadot",
      error: dynadotResult.reason instanceof Error ? dynadotResult.reason.message : String(dynadotResult.reason),
    });
  }

  if (unstoppableResult.status === "rejected") {
    providerErrors.push({
      provider: "Unstoppable",
      error:
        unstoppableResult.reason instanceof Error
          ? unstoppableResult.reason.message
          : String(unstoppableResult.reason),
    });
  }

  if (namesiloResult.status === "rejected") {
    providerErrors.push({
      provider: "NameSilo",
      error:
        namesiloResult.reason instanceof Error
          ? namesiloResult.reason.message
          : String(namesiloResult.reason),
    });
  }

  if (savResult.status === "rejected") {
    providerErrors.push({
      provider: "Sav",
      error:
        savResult.reason instanceof Error ? savResult.reason.message : String(savResult.reason),
    });
  }

  if (spaceshipResult.status === "rejected") {
    providerErrors.push({
      provider: "Spaceship",
      error:
        spaceshipResult.reason instanceof Error
          ? spaceshipResult.reason.message
          : String(spaceshipResult.reason),
    });
  }

  sendJson(res, 200, {
    source: ["dynadot", "namesilo", "sav", "spaceship", "unstoppable"],
    count: domains.length,
    domains,
    providerErrors,
    providers: {
      dynadot: {
        ok: dynadotResult.status === "fulfilled",
        count: dynadotDomains.length,
      },
      namesilo: {
        ok: namesiloResult.status === "fulfilled",
        count: namesiloDomains.length,
      },
      sav: {
        ok: savResult.status === "fulfilled",
        count: savDomains.length,
      },
      spaceship: {
        ok: spaceshipResult.status === "fulfilled",
        count: spaceshipDomains.length,
      },
      unstoppable: {
        ok: unstoppableResult.status === "fulfilled",
        count: unstoppableDomains.length,
      },
    },
  });
}

async function fetchDynadotDomains() {
  const apiKey = process.env.DYNADOT_API_KEY;
  if (!apiKey) return [];

  const listResponse = await fetch(
    `${dynadotBaseUrl}/api3.json?key=${encodeURIComponent(apiKey)}&command=list_domain&count_per_page=1000&page_index=1&sort=NameAsc`,
  );
  if (!listResponse.ok) {
    throw new Error(`Dynadot list_domain returned HTTP ${listResponse.status}`);
  }
  const listData = await listResponse.json();
  return extractDynadotDomains(listData);
}

async function fetchNameSiloDomains() {
  const apiKey = process.env.NAMESILO_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(
    `${namesiloBaseUrl}/listDomains?version=1&type=json&key=${encodeURIComponent(apiKey)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
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

  const response = await fetch(`${savBaseUrl}/domains_api_v1/get_active_domains_in_account`, {
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

  const response = await fetch(
    `${spaceshipBaseUrl}/v1/domains?take=100&skip=0&orderBy=name`,
    {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        "X-API-Secret": apiSecret,
        Accept: "application/json",
      },
    },
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Spaceship get domain list returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  return extractSpaceshipDomains(parseJson(raw));
}

async function fetchUnstoppableDomains() {
  const apiKey = process.env.UD_MCP_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(`${unstoppableBaseUrl}/mcp/v1/actions/ud_portfolio_list`, {
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

function firstString(source, ...keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  }
  return "";
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

function walk(node, visitor) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visitor);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    visitor(key, value);
    walk(value, visitor);
  }
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function upsertEnvValue(filePath, key, value) {
  const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) updated.push(`${key}=${value}`);
  writeFileSync(filePath, updated.join("\n").replace(/\n+$/, "\n"));
}
