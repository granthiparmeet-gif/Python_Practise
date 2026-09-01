import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getEventStats,
  listDomainNamesFromEvents,
  listEventsForDomains,
  listSourceEvents,
  upsertManualDomainEvent,
  upsertDomainMeta,
} from "./db/index.js";
import { buildGmailFirstPortfolio } from "./ledger/portfolio.js";
import { buildCriticalReminders } from "./ledger/reminders.js";
import { syncGmailPortfolioEvents } from "./gmail/sync.js";
import { rndPdfCoverageSummary } from "./gmail/rnd-pdf-rules.js";
import { getPrimaryMailbox, listMailboxes, resolveMailboxList } from "./data/mailboxes.js";
import { loadSecretsEnv, secretsHealth, listGmailOAuthConfigs } from "./config/load-secrets.js";
import {
  buildGoogleAuthUrl,
  buildGmailWebUrl,
  getGmailMessageForDisplay,
  getGmailStatus,
  handleGoogleCallback,
  listConnectedGmailAccounts,
} from "./gmail/index.js";
import { getRegistrarDomains, mergeDomains } from "./registrars/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const host = process.env.HOST || "127.0.0.1";
const ledgerStatePath = path.join(root, ".domain-ledger-state.json");

loadSecretsEnv();
loadDotEnv(path.join(root, ".env")); // optional override on top of secrets/config.env

const port = Number(process.env.PORT || 3001);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/domains") {
    const sampleLimit = Number(url.searchParams.get("gmailSample") || 0);
    const sampleDomains = String(url.searchParams.get("gmailDomains") || "")
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const forceGmailSync = url.searchParams.get("sync") === "1" || url.searchParams.get("gmailSync") === "1";
    handleDomainSync(res, {
      sampleLimit: Number.isFinite(sampleLimit) && sampleLimit > 0 ? sampleLimit : 0,
      sampleDomains,
      forceGmailSync,
    });
    return;
  }

  if (url.pathname === "/api/sync/gmail" && req.method === "POST") {
    collectBody(req)
      .then(async (body) => {
        const parsed = parseJson(body);
        const sampleLimit = Number(parsed?.sampleLimit || url.searchParams.get("sample") || 0);
        const sampleDomains = Array.isArray(parsed?.sampleDomains)
          ? parsed.sampleDomains
          : String(parsed?.sampleDomains || url.searchParams.get("domains") || "")
              .split(/[\n,]+/)
              .map((value) => value.trim())
              .filter(Boolean);
        const incremental = parsed?.incremental !== false && !sampleLimit && !sampleDomains.length;
        const registrarResult = await getRegistrarDomains();
        const registrarDomains = mergeDomains(
          registrarResult.providerDomains?.dynadot || [],
          registrarResult.providerDomains?.namesilo || [],
          registrarResult.providerDomains?.spaceship || [],
          registrarResult.providerDomains?.unstoppable || [],
        );
        const knownNames = [
          ...new Set([
            ...listDomainNamesFromEvents(),
            ...registrarDomains.map((domain) => domain?.name).filter(Boolean),
          ]),
        ].map((name) => ({ name }));
        const syncResult = await syncGmailPortfolioEvents(knownNames, {
          sampleLimit: Number.isFinite(sampleLimit) && sampleLimit > 0 ? sampleLimit : 0,
          sampleDomains,
          includeHistoricSeeds: Boolean(parsed?.includeHistoricSeeds),
          skipExpenses: Boolean(parsed?.skipExpenses),
          skipSales: Boolean(parsed?.skipSales),
          salesOnly: Boolean(parsed?.salesOnly),
          saleSampleLimit: Number(parsed?.saleSampleLimit || 0) || 0,
          saleSampleDomains: Array.isArray(parsed?.saleSampleDomains) ? parsed.saleSampleDomains : [],
          messageLimit: Number(parsed?.messageLimit || 0) || undefined,
          account: String(parsed?.account || "").trim(),
          incremental: Boolean(incremental) && !(sampleLimit > 0 || sampleDomains.length),
        });
        sendJson(res, syncResult.ok ? 200 : 400, syncResult);
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/reminders" && req.method === "GET") {
    getRegistrarDomains()
      .then((registrarResult) => {
        const registrarDomains = mergeDomains(
          registrarResult.providerDomains?.dynadot || [],
          registrarResult.providerDomains?.namesilo || [],
          registrarResult.providerDomains?.spaceship || [],
          registrarResult.providerDomains?.unstoppable || [],
        );
        const portfolio = buildGmailFirstPortfolio(registrarDomains);
        sendJson(res, 200, buildCriticalReminders(portfolio));
      })
      .catch((error) =>
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }),
      );
    return;
  }

  if (url.pathname === "/api/rnd/coverage" && req.method === "GET") {
    sendJson(res, 200, rndPdfCoverageSummary());
    return;
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    const domain = String(url.searchParams.get("domain") || "").trim();
    const events = listEventsForDomains(domain ? [domain] : []);
    sendJson(res, 200, { count: events.length, events, stats: getEventStats() });
    return;
  }

  if (url.pathname === "/api/events/sources" && req.method === "GET") {
    const domain = String(url.searchParams.get("domain") || "").trim();
    const column = String(url.searchParams.get("column") || "").trim();
    const eventId = String(url.searchParams.get("eventId") || "").trim();
    const events = listSourceEvents({ domain, column, eventId }).map((event) => ({
      ...event,
      gmailUrl: buildGmailWebUrl(event.messageId, event.mailbox),
    }));
    sendJson(res, 200, { ok: true, domain, column, count: events.length, events });
    return;
  }

  if (url.pathname === "/api/gmail/message" && req.method === "GET") {
    const id = String(url.searchParams.get("id") || "").trim();
    const mailbox = String(url.searchParams.get("mailbox") || "").trim();
    getGmailMessageForDisplay(id, mailbox)
      .then((result) => sendJson(res, result.ok ? 200 : 404, result))
      .catch((error) =>
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
    return;
  }

  if (url.pathname === "/api/events/manual" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const result = upsertManualDomainEvent({
          messageId: parsed?.messageId,
          domain: parsed?.domain,
          eventType: parsed?.eventType,
          eventDate: parsed?.eventDate || "",
          amountOriginal: parsed?.amountOriginal ?? parsed?.amountUsd ?? null,
          currencyOriginal: parsed?.currencyOriginal || "USD",
          amountUsd: parsed?.amountUsd ?? null,
          amountInr: parsed?.amountInr ?? null,
          amountGross: parsed?.amountGross ?? parsed?.soldFor ?? null,
          salePlatform: parsed?.salePlatform || "",
          vendor: parsed?.vendor || "",
          subject: parsed?.subject || "Manual entry",
          fromAddress: parsed?.fromAddress || "",
          registrarHint: parsed?.registrarHint || "Manual",
          snippet: parsed?.snippet || "",
          expiryDate: parsed?.expiryDate || "",
          mailbox: parsed?.mailbox || "",
        });
        if (parsed?.mailbox || parsed?.statusHint || parsed?.buyPlatform || parsed?.sellPlatform) {
          upsertDomainMeta({
            domain: parsed?.domain,
            mailbox: parsed?.mailbox,
            statusHint: parsed?.statusHint,
            buyPlatform: parsed?.buyPlatform,
            sellPlatform: parsed?.sellPlatform,
            notes: parsed?.notes || "",
          });
        }
        sendJson(res, result.inserted || result.updated ? 200 : 400, { ok: true, result });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/events/stats" && req.method === "GET") {
    sendJson(res, 200, getEventStats());
    return;
  }

  if (url.pathname === "/api/gmail/status" && req.method === "GET") {
    sendJson(res, 200, {
      ...getGmailStatus(),
      events: getEventStats(),
    });
    return;
  }

  if (url.pathname === "/api/mailboxes" && req.method === "GET") {
    const gmailStatus = getGmailStatus();
    const connected = listConnectedGmailAccounts();
    const oauthClients = listGmailOAuthConfigs();
    const configured = resolveMailboxList([
      ...listMailboxes().map((item) => item.email),
      ...connected.map((item) => item.email),
      ...oauthClients.map((item) => item.email),
    ]);
    sendJson(res, 200, {
      defaultAccount: gmailStatus.defaultAccount || getPrimaryMailbox(),
      secrets: secretsHealth(),
      mailboxes: configured.map((item) => {
        const live = connected.find((row) => row.email === item.email);
        const oauth = oauthClients.find((row) => row.email === item.email);
        return {
          ...item,
          connected: Boolean(live?.connected),
          oauthConfigured: Boolean(oauth?.configured) || Boolean(getGmailStatus(item.email).configured),
          lastSync: live?.lastSync || "",
          authUrl: `/auth/google/login?account=${encodeURIComponent(item.email)}`,
        };
      }),
      authUrlAdd: "/auth/google/login",
    });
    return;
  }

  if (url.pathname === "/auth/google/login" && req.method === "GET") {
    const account = String(url.searchParams.get("account") || url.searchParams.get("login_hint") || "").trim();
    const authUrl = buildGoogleAuthUrl({ account, loginHint: account });
    if (!authUrl) {
      sendText(res, 400, "Google OAuth is not configured.");
      return;
    }
    sendRedirect(res, 302, authUrl);
    return;
  }

  if (url.pathname === "/auth/google/callback" && req.method === "GET") {
    handleGoogleCallback(url, res);
    return;
  }

  if (url.pathname === "/api/settings/unstoppable" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) return sendJson(res, 400, { error: "apiKey is required" });
        upsertEnvValue(path.join(root, "secrets", "config.env"), "UD_MCP_API_KEY", apiKey);
        upsertEnvValue(path.join(root, ".env"), "UD_MCP_API_KEY", apiKey);
        process.env.UD_MCP_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/settings/namesilo" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) return sendJson(res, 400, { error: "apiKey is required" });
        upsertEnvValue(path.join(root, "secrets", "config.env"), "NAMESILO_API_KEY", apiKey);
        upsertEnvValue(path.join(root, ".env"), "NAMESILO_API_KEY", apiKey);
        process.env.NAMESILO_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/settings/spaceship" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        const apiSecret = String(parsed?.apiSecret || "").trim();
        if (!apiKey || !apiSecret) return sendJson(res, 400, { error: "apiKey and apiSecret are required" });
        upsertEnvValue(path.join(root, "secrets", "config.env"), "SPACESHIP_API_KEY", apiKey);
        upsertEnvValue(path.join(root, "secrets", "config.env"), "SPACESHIP_API_SECRET", apiSecret);
        upsertEnvValue(path.join(root, ".env"), "SPACESHIP_API_KEY", apiKey);
        upsertEnvValue(path.join(root, ".env"), "SPACESHIP_API_SECRET", apiSecret);
        process.env.SPACESHIP_API_KEY = apiKey;
        process.env.SPACESHIP_API_SECRET = apiSecret;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/health") {
    const gmailStatus = getGmailStatus();
    sendJson(res, 200, {
      ok: true,
      configured: gmailStatus.configured,
      connected: gmailStatus.connected,
      gmailAccount: gmailStatus.gmailAccount,
      lastSync: gmailStatus.lastSync,
      mailboxReadable: gmailStatus.mailboxReadable,
      env: {
        dynadotConfigured: Boolean(process.env.DYNADOT_API_KEY && process.env.DYNADOT_SECRET_KEY),
        dynadotExtraConfigured: Boolean(
          process.env.DYNADOT_API_KEYS ||
            process.env.DYNADOT_API_KEY_LETSLITERATE ||
            process.env.DYNADOT_LETSLITERATE_API_KEY,
        ),
        namesiloConfigured: Boolean(process.env.NAMESILO_API_KEY),
        spaceshipConfigured: Boolean(process.env.SPACESHIP_API_KEY && process.env.SPACESHIP_API_SECRET),
        unstoppableConfigured: Boolean(process.env.UD_MCP_API_KEY),
        gmailConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        gmailConnected: gmailStatus.connected,
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

server.listen(port, host, () => {
  console.log(`Domain Ledger running at http://${host}:${port}`);
});

async function handleDomainSync(res, gmailOptions = {}) {
  try {
    // 1) Registrar APIs confirm presence only (no table fields from APIs).
    const registrarResult = await getRegistrarDomains();
    const ledgerState = loadLedgerState();
    const dynadotCurrent = Array.isArray(registrarResult.providerDomains?.dynadot)
      ? registrarResult.providerDomains.dynadot
      : [];
    const dynadotPrevious = Array.isArray(ledgerState.previousProviderDomains?.dynadot)
      ? ledgerState.previousProviderDomains.dynadot
      : [];
    const dynadotFallbackUsed = dynadotCurrent.length === 0 && dynadotPrevious.length > 0;
    const displayProviderDomains = {
      ...registrarResult.providerDomains,
      dynadot: dynadotFallbackUsed ? dynadotPrevious : dynadotCurrent,
    };
    const registrarDomains = mergeDomains(
      displayProviderDomains.dynadot || [],
      displayProviderDomains.namesilo || [],
      displayProviderDomains.spaceship || [],
      displayProviderDomains.unstoppable || [],
    );
    const providerErrors = [...registrarResult.providerErrors];
    const removalResult = detectRemovedDomains({
      previousProviderDomains: ledgerState.previousProviderDomains,
      currentProviderDomains: displayProviderDomains,
      providerErrors,
      existingRemovedDomains: ledgerState.removedDomains,
    });

    saveLedgerState({
      previousProviderDomains: removalResult.nextPreviousProviderDomains,
      removedDomains: removalResult.removedDomains,
      lastSyncAt: new Date().toISOString(),
      lastDomainCount: registrarDomains.length,
    });

    // 2) Optional Gmail sync into the event ledger.
    const eventStats = getEventStats();
    const shouldSyncGmail =
      Boolean(gmailOptions.forceGmailSync) ||
      Boolean(gmailOptions.sampleLimit) ||
      Boolean(gmailOptions.sampleDomains?.length);

    let gmailSync = null;
    if (shouldSyncGmail) {
      const knownNames = [
        ...new Set([
          ...listDomainNamesFromEvents(),
          ...registrarDomains.map((domain) => domain?.name).filter(Boolean),
        ]),
      ].map((name) => ({ name }));
      gmailSync = await syncGmailPortfolioEvents(knownNames, {
        sampleLimit: gmailOptions.sampleLimit || 0,
        sampleDomains: gmailOptions.sampleDomains || [],
        incremental:
          Boolean(eventStats.lastGmailSyncAt) &&
          !gmailOptions.sampleLimit &&
          !gmailOptions.sampleDomains?.length,
      });
    }

    // 3) Gmail-first portfolio; APIs only confirm.
    const portfolio = buildGmailFirstPortfolio(registrarDomains);
    const reminders = buildCriticalReminders(portfolio);

    sendJson(res, 200, {
      source: ["gmail-events", "dynadot", "namesilo", "spaceship", "unstoppable"],
      mode: "gmail-first",
      count: portfolio.domains.length,
      domains: portfolio.domains,
      views: portfolio.views,
      mailboxes: portfolio.mailboxes,
      soldDomains: portfolio.soldDomains,
      expiredDomains: portfolio.expiredDomains,
      expenses: portfolio.expenses,
      removedDomains: portfolio.removedDomains,
      reminders,
      rndCoverage: rndPdfCoverageSummary(),
      providerErrors,
      portfolio: portfolio.summary,
      providers: {
        ...registrarResult.providers,
        dynadot: { ...registrarResult.providers.dynadot, cachedFallbackUsed: dynadotFallbackUsed },
        gmail: {
          ...getGmailStatus(),
          ok: true,
          mode: "gmail-first",
          role: "source-of-truth",
          syncedThisRequest: Boolean(gmailSync),
          sync: gmailSync,
          events: getEventStats(),
          mailboxes: portfolio.mailboxes || listMailboxes(),
          accounts: getGmailStatus().accounts || [],
        },
        registrars: {
          role: "confirmation",
          confirmed: portfolio.summary.confirmed,
          apiOnly: portfolio.summary.apiOnly,
        },
      },
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendRedirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
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

function loadLedgerState() {
  if (!existsSync(ledgerStatePath)) {
    return {
      previousProviderDomains: {},
      removedDomains: [],
      lastSyncAt: "",
      lastDomainCount: 0,
    };
  }

  try {
    const parsed = parseJson(readFileSync(ledgerStatePath, "utf8"));
    return {
      previousProviderDomains: isPlainObject(parsed?.previousProviderDomains) ? parsed.previousProviderDomains : {},
      removedDomains: Array.isArray(parsed?.removedDomains) ? parsed.removedDomains : [],
      lastSyncAt: typeof parsed?.lastSyncAt === "string" ? parsed.lastSyncAt : "",
      lastDomainCount: Number.isFinite(Number(parsed?.lastDomainCount)) ? Number(parsed.lastDomainCount) : 0,
    };
  } catch {
    return {
      previousProviderDomains: {},
      removedDomains: [],
      lastSyncAt: "",
      lastDomainCount: 0,
    };
  }
}

function saveLedgerState(state) {
  writeFileSync(ledgerStatePath, `${JSON.stringify(state, null, 2)}\n`);
}

function detectRemovedDomains({
  previousProviderDomains,
  currentProviderDomains,
  providerErrors,
  existingRemovedDomains,
}) {
  const now = new Date().toISOString();
  const nextPreviousProviderDomains = {};
  const removedDomains = Array.isArray(existingRemovedDomains) ? [...existingRemovedDomains] : [];
  const failedProviders = new Set((providerErrors || []).map((item) => normalizeProviderName(item?.provider)));
  const activeDomainKeys = new Set();

  for (const [providerKey, currentDomains] of Object.entries(currentProviderDomains || {})) {
    const normalizedProvider = normalizeProviderName(providerKey);
    const currentList = Array.isArray(currentDomains) ? currentDomains : [];
    const previousList = Array.isArray(previousProviderDomains?.[providerKey]) ? previousProviderDomains[providerKey] : [];

    for (const domain of currentList) {
      if (!domain?.name) continue;
      activeDomainKeys.add(`${normalizedProvider}|${normalizeDomainName(domain.name)}`);
    }

    if (failedProviders.has(normalizedProvider)) {
      nextPreviousProviderDomains[providerKey] = previousList;
      continue;
    }

    nextPreviousProviderDomains[providerKey] = currentList;

    const currentNames = new Map(
      currentList
        .filter((domain) => domain?.name)
        .map((domain) => [normalizeDomainName(domain.name), domain]),
    );

    for (const previousDomain of previousList) {
      const domainName = previousDomain?.name;
      if (!domainName) continue;

      if (!currentNames.has(normalizeDomainName(domainName))) {
        removedDomains.unshift({
          name: domainName,
          registrar: previousDomain.registrar || previousDomain.source || providerLabel(providerKey),
          source: previousDomain.source || providerLabel(providerKey),
          removedAt: now,
        });
      }
    }
  }

  const reconciledRemovedDomains = removedDomains.filter((event) => {
    const providerKey = normalizeProviderName(event?.registrar || event?.source);
    const domainKey = normalizeDomainName(event?.name);
    if (!providerKey || !domainKey) return true;
    return !activeDomainKeys.has(`${providerKey}|${domainKey}`);
  });

  const dedupedRemovedDomains = dedupeRemovalEvents(reconciledRemovedDomains).slice(0, 100);
  dedupedRemovedDomains.sort((a, b) => Date.parse(b.removedAt) - Date.parse(a.removedAt));

  return {
    nextPreviousProviderDomains,
    removedDomains: dedupedRemovedDomains,
  };
}

function dedupeRemovalEvents(events) {
  const seen = new Set();
  const deduped = [];

  for (const event of events) {
    const key = `${normalizeDomainName(event?.name)}|${normalizeProviderName(event?.registrar || event?.source)}|${event?.removedAt || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }

  return deduped;
}

function normalizeDomainName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProviderName(value) {
  return String(value || "").trim().toLowerCase();
}

function providerLabel(providerKey) {
  const normalized = normalizeProviderName(providerKey);
  if (normalized === "dynadot") return "Dynadot";
  if (normalized === "namesilo") return "NameSilo";
  if (normalized === "sav") return "Sav";
  if (normalized === "spaceship") return "Spaceship";
  if (normalized === "unstoppable") return "Unstoppable";
  return providerKey;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
