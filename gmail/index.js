import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildUnstoppableGmailQuery, extractUnstoppableMoney } from "./filters/unstoppable.js";

const gmailTokensPath = path.join(process.cwd(), ".gmail-tokens.json");
const gmailAuthBaseUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const gmailTokenUrl = "https://oauth2.googleapis.com/token";
const gmailApiBaseUrl = "https://gmail.googleapis.com/gmail/v1";
const gmailScopes = ["https://www.googleapis.com/auth/gmail.readonly"];
const gmailScanLimit = Number(process.env.GMAIL_SCAN_LIMIT || 150);
const gmailMessageConcurrency = Number(process.env.GMAIL_MESSAGE_CONCURRENCY || 8);

function sendRedirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

export function getGmailStatus() {
  const configured = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REDIRECT_URI,
  );
  const state = readGmailState();
  return {
    configured,
    connected: Boolean(state?.refresh_token),
    gmailAccount: state?.gmailAccount || "",
    lastSync: state?.lastSync || "",
    mailboxReadable: state?.mailboxReadable !== false && Boolean(state?.refresh_token),
    authUrl: configured ? "/auth/google/login" : "",
  };
}

export function buildGoogleAuthUrl() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    return "";
  }

  const url = new URL(gmailAuthBaseUrl);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", gmailScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export async function handleGoogleCallback(url, res) {
  const error = url.searchParams.get("error");
  if (error) {
    sendText(res, 400, `Google OAuth failed: ${error}`);
    return;
  }

  const code = url.searchParams.get("code");
  if (!code) {
    sendText(res, 400, "Google OAuth callback is missing the authorization code.");
    return;
  }

  try {
    const tokens = await exchangeGoogleCodeForTokens(code);
    const profile = await fetchGmailProfile(tokens.access_token);
    saveGmailState({
      ...tokens,
      gmailAccount: profile.emailAddress || "",
      mailboxReadable: true,
      lastSync: new Date().toISOString(),
    });
    sendRedirect(res, 302, "/?gmail=connected");
  } catch (exchangeError) {
    sendText(
      res,
      500,
      `Google OAuth callback failed: ${exchangeError instanceof Error ? exchangeError.message : String(exchangeError)}`,
    );
  }
}

export async function fetchGmailDomainLedger(domains) {
  const tokens = readGmailState();
  if (!tokens || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return {
      domains,
      summary: {
        configured: Boolean(
          process.env.GOOGLE_CLIENT_ID &&
            process.env.GOOGLE_CLIENT_SECRET &&
            process.env.GOOGLE_REDIRECT_URI,
        ),
        connected: Boolean(tokens),
        ok: false,
        matchedDomains: 0,
        scannedMessages: 0,
      },
    };
  }

  let accessToken = "";
  try {
    accessToken = await getValidGmailAccessToken();
  } catch (error) {
    saveGmailState({
      mailboxReadable: false,
      lastSync: tokens?.lastSync || "",
    });
    throw error;
  }

  if (!accessToken) {
    return {
      domains,
      summary: {
        configured: true,
        connected: Boolean(tokens),
        ok: false,
        matchedDomains: 0,
        scannedMessages: 0,
      },
    };
  }

  const domainList = Array.isArray(domains) ? domains : [];
  let profile = null;
  let messageIds = [];
  let messages = [];
  const ledger = buildEmptyGmailLedger(domainList);

  try {
    try {
      profile = await fetchGmailProfile(accessToken);
    } catch {
      profile = null;
    }

    messageIds = await listGmailMessageIds(accessToken, buildGmailQuery());
    messages = await fetchGmailMessages(accessToken, messageIds);

    for (const message of messages) {
      try {
        const parsed = parseGmailMessage(message);
        if (!parsed.text) {
          debugGmailSkip("no parsed text", { messageId: message?.id, subject: parsed.subject, from: parsed.from });
          continue;
        }

        const candidateDomains = findMatchingDomains(parsed.text, domainList);
        if (!candidateDomains.length) {
          debugGmailSkip("no matching domain", { messageId: message?.id, subject: parsed.subject, from: parsed.from });
          continue;
        }

        const transactionType = classifyGmailTransaction(parsed.subject, parsed.text);
        if (!transactionType) {
          debugGmailSkip("no transaction type", {
            messageId: message?.id,
            subject: parsed.subject,
            from: parsed.from,
            candidates: candidateDomains,
          });
          continue;
        }

        const money = extractGmailMoney(parsed.subject, parsed.text);
        if (!money.amount) {
          debugGmailSkip("no money found", {
            messageId: message?.id,
            subject: parsed.subject,
            from: parsed.from,
            candidates: candidateDomains,
          });
          continue;
        }

        for (const domainName of candidateDomains) {
          applyGmailMatch(ledger, domainName, {
            transactionType,
            amount: money.amount,
            currency: money.currency,
            date: parsed.date,
            subject: parsed.subject,
            from: parsed.from,
          });
        }
      } catch (messageError) {
        debugGmailSkip("message parse failed", {
          messageId: message?.id,
          error: messageError instanceof Error ? messageError.message : String(messageError),
        });
      }
    }
  } catch (error) {
    if (isGmailAuthError(error)) {
      saveGmailState({
        ...(readGmailState() || {}),
        mailboxReadable: false,
        lastSync: tokens.lastSync || "",
      });
      throw new Error("Gmail authorization expired or was revoked. Run npm run gmail:setup again.");
    }
    throw error;
  }

  const enrichedDomains = domainList.map((domain) => {
    const record = ledger.get(normalizeDomainKey(domain.name));
    if (!record) return domain;
    return {
      ...domain,
      purchasePrice: record.purchaseAmountFormatted || "",
      purchaseAmount: record.purchaseAmountValue ?? "",
      purchaseDate: record.purchaseDate || "",
      boughtOn: record.purchaseDate || "",
      holding: record.holdingDays ?? "",
      holdingDays: record.holdingDays ?? "",
      renewalPrice: record.renewalAmountFormatted || "",
      renewalAmount: record.renewalAmountValue ?? "",
      renewalDate: record.renewalDate || "",
      gmail: record,
    };
  });
  const matchedDomains = countMatchedDomains(enrichedDomains);

  saveGmailState({
    ...(readGmailState() || {}),
    gmailAccount: profile?.emailAddress || tokens.gmailAccount || "",
    mailboxReadable: true,
    lastSync: new Date().toISOString(),
  });

  return {
    domains: enrichedDomains,
    summary: {
      configured: true,
      connected: true,
      ok: true,
      matchedDomains,
      scannedMessages: messages.length,
    },
  };
}

async function exchangeGoogleCodeForTokens(code) {
  const form = new URLSearchParams();
  form.set("code", code);
  form.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
  form.set("client_secret", process.env.GOOGLE_CLIENT_SECRET || "");
  form.set("redirect_uri", process.env.GOOGLE_REDIRECT_URI || "");
  form.set("grant_type", "authorization_code");

  const response = await fetch(gmailTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Google token exchange returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  const data = parseJson(raw);
  const existing = readGmailState();
  const expiresIn = Number(data.expires_in || 0);
  return {
    access_token: data.access_token || existing?.access_token || "",
    refresh_token: data.refresh_token || existing?.refresh_token || "",
    scope: data.scope || existing?.scope || gmailScopes.join(" "),
    token_type: data.token_type || "Bearer",
    expires_at: expiresIn > 0 ? Date.now() + expiresIn * 1000 - 60_000 : existing?.expires_at || 0,
    saved_at: new Date().toISOString(),
  };
}

async function refreshGoogleAccessToken(refreshToken) {
  const form = new URLSearchParams();
  form.set("refresh_token", refreshToken);
  form.set("client_id", process.env.GOOGLE_CLIENT_ID || "");
  form.set("client_secret", process.env.GOOGLE_CLIENT_SECRET || "");
  form.set("grant_type", "refresh_token");

  const response = await fetch(gmailTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Google token refresh returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }

  const data = parseJson(raw);
  const existing = readGmailState();
  const expiresIn = Number(data.expires_in || 0);
  return {
    ...existing,
    access_token: data.access_token || "",
    scope: data.scope || existing?.scope || gmailScopes.join(" "),
    token_type: data.token_type || "Bearer",
    expires_at: expiresIn > 0 ? Date.now() + expiresIn * 1000 - 60_000 : Date.now() + 50 * 60 * 1000,
    saved_at: new Date().toISOString(),
  };
}

async function getValidGmailAccessToken() {
  const tokens = readGmailState();
  if (!tokens) return "";

  const tokenValid = tokens.access_token && tokens.expires_at && Number(tokens.expires_at) > Date.now() + 30_000;
  if (tokenValid) return tokens.access_token;

  if (!tokens.refresh_token) return tokens.access_token || "";

  const refreshed = await refreshGoogleAccessToken(tokens.refresh_token);
  saveGmailState(refreshed);
  return refreshed.access_token || "";
}

async function fetchGmailProfile(accessToken) {
  const response = await fetch(`${gmailApiBaseUrl}/users/me/profile`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gmail profile returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  return parseJson(raw);
}

function buildGmailQuery() {
  const rawFilters = String(process.env.GMAIL_QUERY_FILTERS || "").trim();
  return buildUnstoppableGmailQuery(rawFilters);
}

async function listGmailMessageIds(accessToken, query) {
  const ids = [];
  let pageToken = "";

  while (ids.length < gmailScanLimit) {
    const url = new URL(`${gmailApiBaseUrl}/users/me/messages`);
    url.searchParams.set("maxResults", "100");
    url.searchParams.set("fields", "messages/id,nextPageToken");
    if (query) url.searchParams.set("q", query);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Gmail messages.list returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
    }

    const data = parseJson(raw);
    const pageMessages = Array.isArray(data.messages) ? data.messages : [];
    for (const item of pageMessages) {
      if (item?.id) ids.push(item.id);
      if (ids.length >= gmailScanLimit) break;
    }

    pageToken = data.nextPageToken || "";
    if (!pageToken || ids.length >= gmailScanLimit) break;
  }

  return ids;
}

async function fetchGmailMessages(accessToken, ids) {
  const limitedIds = Array.isArray(ids) ? ids.slice(0, gmailScanLimit) : [];
  const messages = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(gmailMessageConcurrency, limitedIds.length) }, async () => {
    while (nextIndex < limitedIds.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const id = limitedIds[currentIndex];
      if (!id) continue;

      const url = new URL(`${gmailApiBaseUrl}/users/me/messages/${encodeURIComponent(id)}`);
      url.searchParams.set("format", "full");
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });
      const raw = await response.text();
      if (!response.ok) {
        debugGmailSkip("message fetch failed", {
          messageId: id,
          error: `HTTP ${response.status}: ${raw.slice(0, 200)}`,
        });
        continue;
      }
      try {
        messages.push(parseJson(raw));
      } catch (error) {
        debugGmailSkip("message decode failed", {
          messageId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  await Promise.all(workers);
  return messages;
}

function parseGmailMessage(message) {
  const payload = message?.payload || {};
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const subject = getHeaderValue(headers, "Subject");
  const from = getHeaderValue(headers, "From");
  const dateText = getHeaderValue(headers, "Date");
  const date = normalizeDateValue(message?.internalDate || dateText);
  const text = collectGmailText(payload).trim();
  return { subject, from, date, text };
}

function collectGmailText(part, seen = new Set()) {
  if (!part || typeof part !== "object") return "";

  const partId = String(part.partId || "");
  if (partId && seen.has(partId)) return "";
  if (partId) seen.add(partId);

  const mimeType = String(part.mimeType || "").toLowerCase();
  const bodyData = part?.body?.data;
  const children = Array.isArray(part.parts) ? part.parts : [];

  if (mimeType === "multipart/alternative") {
    const preferred = collectPreferredMultipartText(children, seen);
    if (preferred) return preferred;
  }

  if (isTextMime(mimeType) && typeof bodyData === "string" && bodyData) {
    const decoded = decodeGmailBody(bodyData, mimeType);
    if (decoded) return decoded;
  }

  const pieces = [];
  if (children.length) {
    for (const child of children) {
      const childText = collectGmailText(child, seen);
      if (childText) pieces.push(childText);
    }
  } else if (typeof bodyData === "string" && bodyData) {
    const decoded = decodeGmailBody(bodyData, mimeType);
    if (decoded) pieces.push(decoded);
  }

  return joinGmailTextPieces(pieces);
}

function collectPreferredMultipartText(children, seen) {
  const plain = [];
  const html = [];
  const other = [];

  for (const child of children) {
    const mimeType = String(child?.mimeType || "").toLowerCase();
    const text = collectGmailText(child, seen);
    if (!text) continue;
    if (mimeType === "text/plain") {
      plain.push(text);
    } else if (mimeType === "text/html") {
      html.push(text);
    } else {
      other.push(text);
    }
  }

  return joinGmailTextPieces(plain.length ? plain : html.length ? html : other);
}

function isTextMime(mimeType) {
  return /^text\/(plain|html)$/i.test(String(mimeType || ""));
}

function decodeGmailBody(data, mimeType) {
  try {
    const normalized = String(data).replace(/-/g, "+").replace(/_/g, "/");
    let text = Buffer.from(normalized, "base64").toString("utf8");
    if (String(mimeType).includes("html")) {
      text = stripHtml(text);
    }
    return normalizeGmailText(text);
  } catch {
    return "";
  }
}

function stripHtml(html) {
  const normalized = String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(tr|table|thead|tbody|tfoot|ul|ol|li|p|div|section|article|header|footer|h[1-6])\s*>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, "\t")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, " ");

  return normalizeGmailText(decodeHtmlEntities(normalized))
    .replace(/\t+/g, "\t")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const numeric = Number(code);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const numeric = Number.parseInt(code, 16);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : _;
    });
}

function normalizeGmailText(value) {
  return String(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function joinGmailTextPieces(pieces) {
  return pieces
    .map((piece) => normalizeGmailText(piece))
    .filter(Boolean)
    .join("\n");
}

function getHeaderValue(headers, name) {
  const target = String(name).toLowerCase();
  for (const header of headers) {
    if (String(header?.name || "").toLowerCase() === target) {
      return String(header?.value || "").trim();
    }
  }
  return "";
}

function buildEmptyGmailLedger(domains) {
  const ledger = new Map();
  for (const domain of domains) {
    if (!domain?.name) continue;
    ledger.set(normalizeDomainKey(domain.name), createGmailRecord());
  }
  return ledger;
}

function createGmailRecord() {
  return {
    purchaseAmountValue: null,
    purchaseAmountFormatted: "",
    purchaseDate: "",
    purchaseTimestamp: 0,
    renewalAmountValue: null,
    renewalAmountFormatted: "",
    renewalDate: "",
    renewalTimestamp: 0,
    holdingDays: "",
    matchedCount: 0,
    sources: [],
  };
}

function applyGmailMatch(ledger, domainName, match) {
  const key = normalizeDomainKey(domainName);
  if (!ledger.has(key)) {
    ledger.set(key, createGmailRecord());
  }
  const record = ledger.get(key);
  const timestamp = parseGmailTimestamp(match.date);
  const amountValue = parseGmailMoneyValue(match.amount);
  const amountFormatted = formatGmailMoney(match.amount, match.currency);
  const sourceLabel = [match.subject, match.from].filter(Boolean).join(" | ");

  if (match.transactionType === "renewal") {
    if (!record.renewalTimestamp || timestamp >= record.renewalTimestamp) {
      record.renewalAmountValue = amountValue;
      record.renewalAmountFormatted = amountFormatted;
      record.renewalDate = match.date || record.renewalDate;
      record.renewalTimestamp = timestamp || record.renewalTimestamp;
    }
  } else {
    if (!record.purchaseTimestamp || timestamp <= record.purchaseTimestamp) {
      record.purchaseAmountValue = amountValue;
      record.purchaseAmountFormatted = amountFormatted;
      record.purchaseDate = match.date || record.purchaseDate;
      record.purchaseTimestamp = timestamp || record.purchaseTimestamp;
    }
  }

  if (timestamp && record.purchaseDate) {
    record.holdingDays = calculateHoldingDays(record.purchaseDate);
  }

  record.matchedCount += 1;
  if (sourceLabel && !record.sources.includes(sourceLabel)) {
    record.sources.push(sourceLabel);
  }
}

function parseGmailTimestamp(value) {
  if (!value) return 0;
  const normalized = normalizeDateValue(value);
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function calculateHoldingDays(purchaseDate) {
  const parsed = Date.parse(purchaseDate);
  if (Number.isNaN(parsed)) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const purchase = new Date(parsed);
  purchase.setHours(0, 0, 0, 0);
  return String(Math.max(0, Math.round((today - purchase) / 86400000)));
}

function normalizeDomainKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "")
    .trim();
}

function findMatchingDomains(text, domains) {
  const haystack = normalizeSearchText(text);
  const matches = [];
  for (const domain of domains) {
    const name = normalizeDomainKey(domain?.name);
    if (!name) continue;
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}(?=$|[^a-z0-9])`, "i");
    if (pattern.test(haystack)) {
      matches.push(domain.name);
    }
  }
  return [...new Set(matches)];
}

function normalizeSearchText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\u00a0/g, " ");
}

function classifyGmailTransaction(subject, text) {
  const haystack = `${subject || ""} ${text || ""}`.toLowerCase();
  if (/(renewed|renewal|auto-?renew|subscription renewed|renew your|domain renewal|order finished)/i.test(haystack)) {
    return "renewal";
  }
  if (/(invoice|receipt|order|purchase|payment|paid|thank you for your purchase|thank you for your order|order received|order confirmation|your order|domain registration|domain transfer)/i.test(haystack)) {
    return "purchase";
  }
  return null;
}

function extractGmailMoney(subject, text) {
  const haystack = `${subject || ""}\n${text || ""}`;

  if (/unstoppable domains/i.test(haystack) || /notifications@unstoppabledomains\.com/i.test(haystack)) {
    const unstoppableMatch = extractUnstoppableMoney(haystack);
    if (unstoppableMatch.amount) return unstoppableMatch;
  }

  const labeledAmount =
    matchLabeledMoney(haystack, ["total", "order amount", "purchase amount", "amount paid", "amount due"]) ||
    matchLabeledMoney(haystack, ["purchase price", "price", "subtotal", "grand total", "charge", "payment", "paid"]);

  if (labeledAmount) return labeledAmount;

  const allCurrencyValues = [...haystack.matchAll(/(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/gi)];
  if (allCurrencyValues.length) {
    return { amount: allCurrencyValues[allCurrencyValues.length - 1][1], currency: "$" };
  }

  return { amount: "", currency: "" };
}

function parseGmailMoneyValue(value) {
  const normalized = String(value || "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatGmailMoney(amount, currency) {
  const normalizedAmount = String(amount || "").trim();
  if (!normalizedAmount) return "";
  const normalizedCurrency = String(currency || "").trim();
  if (!normalizedCurrency || normalizedCurrency === "$") {
    return `$${normalizedAmount}`;
  }
  if (normalizedCurrency === "€") {
    return `€${normalizedAmount}`;
  }
  if (normalizedCurrency === "£") {
    return `£${normalizedAmount}`;
  }
  if (normalizedCurrency === "₹") {
    return `₹${normalizedAmount}`;
  }
  return `${normalizedCurrency} ${normalizedAmount}`.trim();
}

function matchLabeledMoney(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      String.raw`${escapeRegExp(label)}\s*:?\s*(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)`,
      "i",
    );
    const match = String(text || "").match(pattern);
    if (match?.[1]) {
      return { amount: match[1], currency: "$" };
    }
  }
  return null;
}

function isGmailAuthError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 401|HTTP 403|HTTP 400|Unauthorized|Forbidden|invalid_grant|invalid_token/i.test(message);
}

function readGmailState() {
  if (!existsSync(gmailTokensPath)) return null;
  try {
    const data = parseJson(readFileSync(gmailTokensPath, "utf8"));
    if (!data || typeof data !== "object") return null;
    if (!data.access_token && !data.refresh_token) return null;
    return data;
  } catch {
    return null;
  }
}

function saveGmailState(tokens) {
  const existing = readGmailState() || {};
  const payload = {
    ...existing,
    ...tokens,
  };
  writeFileSync(gmailTokensPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function countMatchedDomains(domains) {
  return domains.reduce((count, domain) => {
    const matched =
      Boolean(domain?.purchaseAmount !== "" && domain?.purchaseAmount !== null && domain?.purchaseAmount !== undefined) ||
      Boolean(domain?.renewalAmount !== "" && domain?.renewalAmount !== null && domain?.renewalAmount !== undefined) ||
      Boolean(domain?.purchaseDate) ||
      Boolean(domain?.renewalDate);
    return matched ? count + 1 : count;
  }, 0);
}

function debugGmailSkip(reason, details = {}) {
  const enabled = process.env.GMAIL_DEBUG !== "0" && process.env.NODE_ENV !== "production";
  if (!enabled) return;
  const payload = {
    reason,
    ...details,
  };
  console.warn("[gmail]", JSON.stringify(payload));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
