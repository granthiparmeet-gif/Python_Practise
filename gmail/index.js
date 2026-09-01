import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractUnstoppableMoney } from "./filters/unstoppable.js";
import {
  convertAmountToUsdInr,
  formatMoneyAmount,
  getFxCacheSummary,
  normalizeCurrencyCode,
} from "../fx/index.js";
import { classifyByPhrases, DEFAULT_GMAIL_SEARCH_PHRASES } from "./phrases.js";
import {
  classifyDomainLineType,
  eventTypeFromLineType,
  extractDomainOrderMoney,
  hasOtherReceiptDomains,
} from "./receipts/parse.js";
import {
  isIncomingTransferSpend,
  isTransferStatusMail,
  isNoiseMail,
  isPromotionalOfferMail,
  isDomainPush,
  isDomainRemovalMail,
  looksLikeRegistrationPurchase,
  looksLikeRenewalSpend,
  coerceAcquisitionEventType,
  isAcquisitionCheckoutMail,
  PAYMENT_FAILED,
} from "./rules.js";
import { classifySaleMail, extractSaleMoney, guessSalePlatform } from "./sales.js";
import { matchRndIgnore, RND_RECEIPT_SENDERS, RND_RECEIPT_SENDER_DOMAINS } from "./rnd-catalog.js";
import { matchRndScreenshotTemplate } from "./rnd-templates.js";
import { getPrimaryMailbox, listMailboxEmails, resolveMailboxList } from "../data/mailboxes.js";
import { getGoogleOAuthConfig, loadSecretsEnv } from "../config/load-secrets.js";

loadSecretsEnv();

const gmailTokensPath = path.join(process.cwd(), ".gmail-tokens.json");
const gmailAuthBaseUrl = "https://accounts.google.com/o/oauth2/v2/auth";
const gmailTokenUrl = "https://oauth2.googleapis.com/token";
const gmailApiBaseUrl = "https://gmail.googleapis.com/gmail/v1";
const gmailScopes = ["https://www.googleapis.com/auth/gmail.readonly"];
const gmailScanLimit = Number(process.env.GMAIL_SCAN_LIMIT || 150);
const gmailMessageConcurrency = Number(process.env.GMAIL_MESSAGE_CONCURRENCY || 8);
const gmailDomainMessageLimit = Number(process.env.GMAIL_DOMAIN_MESSAGE_LIMIT || 25);
const gmailDomainConcurrency = Number(process.env.GMAIL_DOMAIN_CONCURRENCY || 4);
const defaultReceiptSenders = [
  ...new Set([
    ...RND_RECEIPT_SENDERS,
    "support@cosmotown.com",
    "snapnames-automail@snapnames.com",
  ]),
];

function oauthConfigured(account = "") {
  return Boolean(getGoogleOAuthConfig(account));
}

function sendRedirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function normalizeMailboxKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export function getGmailStatus(account = "") {
  const store = readTokenStore();
  const accounts = listConnectedAccountStatuses(store);
  const selectedKey = normalizeMailboxKey(account) || store.defaultAccount || getPrimaryMailbox();
  const state = selectedKey ? store.accounts[selectedKey] || null : null;
  const anyConnected = accounts.some((item) => item.connected);
  const oauth = getGoogleOAuthConfig(selectedKey);

  return {
    configured: Boolean(oauth),
    connected: anyConnected,
    gmailAccount: state?.gmailAccount || selectedKey || accounts[0]?.email || "",
    lastSync: state?.lastSync || accounts.find((item) => item.lastSync)?.lastSync || "",
    mailboxReadable: Boolean(state?.refresh_token) && state?.mailboxReadable !== false,
    authUrl: oauth ? `/auth/google/login?account=${encodeURIComponent(selectedKey || "")}` : "",
    accounts,
    defaultAccount: store.defaultAccount || getPrimaryMailbox(),
    connectedCount: accounts.filter((item) => item.connected).length,
    oauthSource: oauth?.path || "",
  };
}

/**
 * @param {{ loginHint?: string, account?: string }} [options]
 */
export function buildGoogleAuthUrl(options = {}) {
  const loginHint = normalizeMailboxKey(options.loginHint || options.account || "");
  const oauth = getGoogleOAuthConfig(loginHint);
  if (!oauth) return "";

  const url = new URL(gmailAuthBaseUrl);
  url.searchParams.set("client_id", oauth.clientId);
  url.searchParams.set("redirect_uri", oauth.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", gmailScopes.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  if (loginHint) {
    url.searchParams.set("login_hint", loginHint);
  }
  url.searchParams.set(
    "state",
    Buffer.from(JSON.stringify({ account: loginHint || "" }), "utf8").toString("base64url"),
  );
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

  let stateAccount = "";
  try {
    const stateRaw = url.searchParams.get("state") || "";
    if (stateRaw) {
      const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
      stateAccount = normalizeMailboxKey(parsed?.account || "");
    }
  } catch {
    stateAccount = "";
  }

  try {
    const tokens = await exchangeGoogleCodeForTokens(code, stateAccount);
    const profile = await fetchGmailProfile(tokens.access_token);
    const email = normalizeMailboxKey(profile.emailAddress || stateAccount || "");
    if (!email) {
      sendText(res, 500, "Google OAuth succeeded but no mailbox email was returned.");
      return;
    }
    saveGmailState(
      {
        ...tokens,
        gmailAccount: email,
        mailboxReadable: true,
        lastSync: new Date().toISOString(),
      },
      email,
    );
    setDefaultGmailAccount(email);
    sendRedirect(res, 302, `/?gmail=connected&account=${encodeURIComponent(email)}`);
  } catch (exchangeError) {
    sendText(
      res,
      500,
      `Google OAuth callback failed: ${exchangeError instanceof Error ? exchangeError.message : String(exchangeError)}`,
    );
  }
}

export async function fetchGmailDomainLedger(domains, options = {}) {
  const tokens = readGmailState();
  if (!tokens || !getGoogleOAuthConfig(tokens?.gmailAccount || "")) {
    return {
      domains,
      summary: {
        configured: oauthConfigured(""),
        connected: Boolean(tokens),
        ok: false,
        matchedDomains: 0,
        scannedMessages: 0,
        mode: "per-domain",
      },
    };
  }

  let accessToken = "";
  try {
    accessToken = await getValidGmailAccessToken();
  } catch (error) {
    saveGmailState(
      {
        mailboxReadable: false,
        lastSync: tokens?.lastSync || "",
      },
      tokens?.gmailAccount || "",
    );
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
        mode: "per-domain",
      },
    };
  }

  const domainList = Array.isArray(domains) ? domains : [];
  const targets = selectGmailTargetDomains(domainList, options);
  const targetKeys = new Set(targets.map((domain) => normalizeDomainKey(domain.name)));
  let profile = null;
  const ledger = buildEmptyGmailLedger(domainList);
  const messageCache = new Map();
  let scannedMessages = 0;

  try {
    try {
      profile = await fetchGmailProfile(accessToken);
    } catch {
      profile = null;
    }

    await mapWithConcurrency(targets, gmailDomainConcurrency, async (domain) => {
      const result = await fetchReceiptsForDomain(accessToken, domain.name, messageCache);
      scannedMessages += result.scannedMessages;
      for (const match of result.matches) {
        applyGmailMatch(ledger, domain.name, match);
      }
    });
  } catch (error) {
    if (isGmailAuthError(error)) {
      saveGmailState(
        {
          ...(readGmailState(tokens?.gmailAccount) || {}),
          mailboxReadable: false,
          lastSync: tokens.lastSync || "",
        },
        tokens?.gmailAccount || "",
      );
      throw new Error("Gmail authorization expired or was revoked. Run npm run gmail:setup again.");
    }
    throw error;
  }

  const enrichedDomains = [];
  for (const domain of domainList) {
    const key = normalizeDomainKey(domain.name);
    if (!targetKeys.has(key)) {
      enrichedDomains.push(await ensureDualCurrencyFields(domain));
      continue;
    }
    const record = ledger.get(key);
    if (!record) {
      enrichedDomains.push(await ensureDualCurrencyFields(domain));
      continue;
    }
    enrichedDomains.push(await ensureDualCurrencyFields(enrichDomainWithGmailRecord(domain, record)));
  }
  const matchedDomains = countMatchedDomains(enrichedDomains);

  saveGmailState(
    {
      ...(readGmailState(tokens?.gmailAccount) || {}),
      gmailAccount: profile?.emailAddress || tokens.gmailAccount || "",
      mailboxReadable: true,
      lastSync: new Date().toISOString(),
    },
    tokens?.gmailAccount || profile?.emailAddress || "",
  );

  return {
    domains: enrichedDomains,
    summary: {
      configured: true,
      connected: true,
      ok: true,
      matchedDomains,
      scannedMessages,
      mode: "per-domain",
      targetDomains: targets.length,
      sampleMode: Boolean(options.sampleLimit || options.sampleDomains?.length),
      fx: getFxCacheSummary(),
    },
  };
}

export async function fetchGmailLedgerForDomain(domainName) {
  const result = await fetchGmailDomainLedger([{ name: domainName }], {
    sampleDomains: [domainName],
  });
  return result.domains[0] || null;
}

function selectGmailTargetDomains(domainList, options = {}) {
  const sampleDomains = Array.isArray(options.sampleDomains)
    ? options.sampleDomains.map((name) => normalizeDomainKey(name)).filter(Boolean)
    : String(process.env.GMAIL_SAMPLE_DOMAINS || "")
        .split(/[\n,]+/)
        .map((value) => normalizeDomainKey(value))
        .filter(Boolean);
  const sampleLimit = Number(options.sampleLimit || process.env.GMAIL_SAMPLE_LIMIT || 0);

  let targets = domainList.filter((domain) => domain?.name);
  if (sampleDomains.length) {
    const wanted = new Set(sampleDomains);
    targets = targets.filter((domain) => wanted.has(normalizeDomainKey(domain.name)));
  } else if (Number.isFinite(sampleLimit) && sampleLimit > 0) {
    targets = targets.slice(0, sampleLimit);
  }
  return targets;
}

async function ensureDualCurrencyFields(domain) {
  if (!domain || typeof domain !== "object") return domain;

  let purchaseUsd = parseLooseMoney(domain.purchaseAmountUsd ?? domain.purchaseAmount ?? domain.purchasePrice);
  let purchaseInr = parseLooseMoney(domain.purchaseAmountInr);
  let renewalUsd = parseLooseMoney(domain.renewalSpendUsd ?? domain.renewalSpend);
  let renewalInr = parseLooseMoney(domain.renewalSpendInr);
  let fxRate = parseLooseMoney(domain.fxRate);
  let fxRateDate = domain.fxRateDate || "";

  const dateHint = domain.purchaseDate || domain.boughtOn || domain.registration || domain.expiry || "";

  if (purchaseUsd !== null && purchaseInr === null) {
    try {
      const converted = await convertAmountToUsdInr({ amount: purchaseUsd, currency: "USD", date: dateHint });
      purchaseInr = converted.inr;
      fxRate = converted.rate;
      fxRateDate = converted.rateDate;
    } catch {
      // keep USD-only when FX is unavailable
    }
  } else if (purchaseInr !== null && purchaseUsd === null) {
    try {
      const converted = await convertAmountToUsdInr({ amount: purchaseInr, currency: "INR", date: dateHint });
      purchaseUsd = converted.usd;
      fxRate = converted.rate;
      fxRateDate = converted.rateDate;
    } catch {
      // keep INR-only when FX is unavailable
    }
  }

  if (renewalUsd !== null && renewalInr === null) {
    try {
      const converted = await convertAmountToUsdInr({
        amount: renewalUsd,
        currency: "USD",
        date: domain.renewalDate || dateHint,
      });
      renewalInr = converted.inr;
      fxRate = fxRate || converted.rate;
      fxRateDate = fxRateDate || converted.rateDate;
    } catch {
      // ignore
    }
  } else if (renewalInr !== null && renewalUsd === null) {
    try {
      const converted = await convertAmountToUsdInr({
        amount: renewalInr,
        currency: "INR",
        date: domain.renewalDate || dateHint,
      });
      renewalUsd = converted.usd;
      fxRate = fxRate || converted.rate;
      fxRateDate = fxRateDate || converted.rateDate;
    } catch {
      // ignore
    }
  }

  const hasPurchase = purchaseUsd !== null || purchaseInr !== null;
  const hasRenewals = renewalUsd !== null || renewalInr !== null || Number(domain.renewalCount) > 0;
  const totalUsd =
    hasPurchase || hasRenewals ? Number(((purchaseUsd || 0) + (renewalUsd || 0)).toFixed(2)) : null;
  const totalInr =
    hasPurchase || hasRenewals ? Number(((purchaseInr || 0) + (renewalInr || 0)).toFixed(2)) : null;

  return {
    ...domain,
    purchaseAmount: purchaseUsd ?? domain.purchaseAmount ?? "",
    purchasePrice: purchaseUsd !== null ? formatMoneyAmount(purchaseUsd, "USD") : domain.purchasePrice || "",
    purchaseAmountUsd: purchaseUsd ?? "",
    purchaseAmountInr: purchaseInr ?? "",
    purchasePriceUsd: purchaseUsd !== null ? formatMoneyAmount(purchaseUsd, "USD") : "",
    purchasePriceInr: purchaseInr !== null ? formatMoneyAmount(purchaseInr, "INR") : "",
    renewalSpend: renewalUsd ?? domain.renewalSpend ?? "",
    renewalSpendUsd: renewalUsd ?? "",
    renewalSpendInr: renewalInr ?? "",
    renewalSpendPrice: renewalUsd !== null ? formatMoneyAmount(renewalUsd, "USD") : domain.renewalSpendPrice || "",
    renewalSpendPriceUsd: renewalUsd !== null ? formatMoneyAmount(renewalUsd, "USD") : "",
    renewalSpendPriceInr: renewalInr !== null ? formatMoneyAmount(renewalInr, "INR") : "",
    totalAmount: totalUsd ?? domain.totalAmount ?? "",
    totalPrice: totalUsd !== null ? formatMoneyAmount(totalUsd, "USD") : domain.totalPrice || "",
    totalAmountUsd: totalUsd ?? "",
    totalAmountInr: totalInr ?? "",
    totalPriceUsd: totalUsd !== null ? formatMoneyAmount(totalUsd, "USD") : "",
    totalPriceInr: totalInr !== null ? formatMoneyAmount(totalInr, "INR") : "",
    fxRate: fxRate ?? "",
    fxRateDate: fxRateDate || "",
  };
}

function parseLooseMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function enrichDomainWithGmailRecord(domain, record) {
  const purchaseUsd = Number.isFinite(record.purchaseUsd) ? record.purchaseUsd : null;
  const purchaseInr = Number.isFinite(record.purchaseInr) ? record.purchaseInr : null;
  const renewalUsd = Number(record.renewalTotalUsd) || 0;
  const renewalInr = Number(record.renewalTotalInr) || 0;
  const hasPurchase = purchaseUsd !== null || purchaseInr !== null;
  const hasRenewals = record.renewalCount > 0 || renewalUsd > 0 || renewalInr > 0;
  const hasCost = hasPurchase || hasRenewals;

  const totalUsd = hasCost ? Number(((purchaseUsd || 0) + renewalUsd).toFixed(2)) : null;
  const totalInr = hasCost ? Number(((purchaseInr || 0) + renewalInr).toFixed(2)) : null;

  return {
    ...domain,
    purchaseAmount: purchaseUsd ?? domain.purchaseAmount ?? "",
    purchasePrice: purchaseUsd !== null ? formatMoneyAmount(purchaseUsd, "USD") : domain.purchasePrice || "",
    purchaseAmountUsd: purchaseUsd ?? "",
    purchaseAmountInr: purchaseInr ?? "",
    purchasePriceUsd: purchaseUsd !== null ? formatMoneyAmount(purchaseUsd, "USD") : "",
    purchasePriceInr: purchaseInr !== null ? formatMoneyAmount(purchaseInr, "INR") : "",
    purchaseDate: record.purchaseDate || "",
    boughtOn: record.purchaseDate || "",
    holding: record.holdingDays ?? "",
    holdingDays: record.holdingDays ?? "",
    transferPrice: record.transferAmountFormatted || "",
    transferAmount: record.transferAmountValue ?? "",
    transferDate: record.transferDate || "",
    renewalAmount: record.renewalAmountUsd ?? "",
    renewalPrice: record.renewalAmountUsd != null ? formatMoneyAmount(record.renewalAmountUsd, "USD") : "",
    renewalDate: record.renewalDate || "",
    renewalSpend: hasRenewals ? renewalUsd : "",
    renewalSpendPrice: hasRenewals ? formatMoneyAmount(renewalUsd, "USD") : "",
    renewalSpendUsd: hasRenewals ? renewalUsd : "",
    renewalSpendInr: hasRenewals ? renewalInr : "",
    renewalSpendPriceUsd: hasRenewals ? formatMoneyAmount(renewalUsd, "USD") : "",
    renewalSpendPriceInr: hasRenewals ? formatMoneyAmount(renewalInr, "INR") : "",
    renewalCount: record.renewalCount || 0,
    totalAmount: totalUsd ?? "",
    totalPrice: totalUsd !== null ? formatMoneyAmount(totalUsd, "USD") : "",
    totalAmountUsd: totalUsd ?? "",
    totalAmountInr: totalInr ?? "",
    totalPriceUsd: totalUsd !== null ? formatMoneyAmount(totalUsd, "USD") : "",
    totalPriceInr: totalInr !== null ? formatMoneyAmount(totalInr, "INR") : "",
    fxRate: record.purchaseFxRate || record.latestFxRate || "",
    fxRateDate: record.purchaseFxRateDate || record.latestFxRateDate || "",
    gmail: record,
  };
}

function createGmailRecord() {
  return {
    purchaseUsd: null,
    purchaseInr: null,
    purchaseAmountValue: null,
    purchaseAmountFormatted: "",
    purchaseDate: "",
    purchaseTimestamp: 0,
    purchaseFxRate: null,
    purchaseFxRateDate: "",
    purchaseSourceCurrency: "",
    transferAmountValue: null,
    transferAmountFormatted: "",
    transferDate: "",
    transferTimestamp: 0,
    transferTotalCents: 0,
    renewalAmountUsd: null,
    renewalAmountInr: null,
    renewalAmountValue: null,
    renewalAmountFormatted: "",
    renewalDate: "",
    renewalTimestamp: 0,
    renewalCount: 0,
    renewalTotalUsd: 0,
    renewalTotalInr: 0,
    renewalTotalCents: 0,
    renewalTotalFormatted: "",
    totalAmountCents: 0,
    totalAmountFormatted: "",
    totalCurrency: "USD",
    latestFxRate: null,
    latestFxRateDate: "",
    holdingDays: "",
    matchedCount: 0,
    sources: [],
    seenMessageIds: [],
  };
}

function applyGmailMatch(ledger, domainName, match) {
  const key = normalizeDomainKey(domainName);
  if (!ledger.has(key)) {
    ledger.set(key, createGmailRecord());
  }
  const record = ledger.get(key);
  const messageId = String(match.messageId || "").trim();
  if (messageId && record.seenMessageIds.includes(messageId)) {
    return;
  }

  const timestamp = parseGmailTimestamp(match.date);
  const usd = Number(match.usd);
  const inr = Number(match.inr);
  if (!Number.isFinite(usd) || !Number.isFinite(inr)) return;

  const sourceCurrency = normalizeCurrencyCode(match.sourceCurrency || match.currency || "USD");
  const amountFormatted = formatMoneyAmount(
    sourceCurrency === "INR" ? inr : usd,
    sourceCurrency,
  );
  const sourceLabel = [match.subject, match.from].filter(Boolean).join(" | ");

  record.latestFxRate = Number(match.fxRate) || record.latestFxRate;
  record.latestFxRateDate = match.fxRateDate || record.latestFxRateDate;
  record.totalCurrency = "USD";

  if (match.transactionType === "renewal") {
    record.renewalCount += 1;
    record.renewalTotalUsd = Number((record.renewalTotalUsd + usd).toFixed(2));
    record.renewalTotalInr = Number((record.renewalTotalInr + inr).toFixed(2));
    record.renewalTotalCents = Math.round(record.renewalTotalUsd * 100);
    record.renewalTotalFormatted = formatMoneyAmount(record.renewalTotalUsd, "USD");
    if (!record.renewalTimestamp || timestamp >= record.renewalTimestamp) {
      record.renewalAmountUsd = usd;
      record.renewalAmountInr = inr;
      record.renewalAmountValue = usd;
      record.renewalAmountFormatted = amountFormatted;
      record.renewalDate = match.date || record.renewalDate;
      record.renewalTimestamp = timestamp || record.renewalTimestamp;
    }
  } else if (match.transactionType === "transfer") {
    // Transfer-in fees include ~1 year — count like a renewal. Transfer-away is not spend.
    record.transferTotalCents += Math.round(usd * 100);
    const incoming = isIncomingTransferSpend(match.subject || "", "");
    if (!record.transferTimestamp || timestamp <= record.transferTimestamp) {
      record.transferAmountValue = usd;
      record.transferAmountFormatted = amountFormatted;
      record.transferDate = match.date || record.transferDate;
      record.transferTimestamp = timestamp || record.transferTimestamp;
    }
    if (incoming && (Number.isFinite(usd) || Number.isFinite(inr))) {
      record.renewalCount += 1;
      record.renewalTotalUsd = Number((record.renewalTotalUsd + (usd || 0)).toFixed(2));
      record.renewalTotalInr = Number((record.renewalTotalInr + (inr || 0)).toFixed(2));
      record.renewalTotalCents = Math.round(record.renewalTotalUsd * 100);
      record.renewalTotalFormatted = formatMoneyAmount(record.renewalTotalUsd, "USD");
      if (!record.renewalTimestamp || timestamp >= record.renewalTimestamp) {
        record.renewalAmountUsd = usd;
        record.renewalAmountInr = inr;
        record.renewalAmountValue = usd;
        record.renewalAmountFormatted = amountFormatted;
        record.renewalDate = match.date || record.renewalDate;
        record.renewalTimestamp = timestamp || record.renewalTimestamp;
      }
    }
  } else if (match.transactionType === "purchase") {
    const isEarlierOrFirstPurchase =
      !record.purchaseTimestamp || (timestamp > 0 && timestamp <= record.purchaseTimestamp);
    if (isEarlierOrFirstPurchase) {
      record.purchaseUsd = usd;
      record.purchaseInr = inr;
      record.purchaseAmountValue = usd;
      record.purchaseAmountFormatted = formatMoneyAmount(usd, "USD");
      record.purchaseDate = match.date || record.purchaseDate;
      record.purchaseTimestamp = timestamp || record.purchaseTimestamp || Date.now();
      record.purchaseFxRate = Number(match.fxRate) || record.purchaseFxRate;
      record.purchaseFxRateDate = match.fxRateDate || record.purchaseFxRateDate;
      record.purchaseSourceCurrency = sourceCurrency;
    } else {
      record.renewalCount += 1;
      record.renewalTotalUsd = Number((record.renewalTotalUsd + usd).toFixed(2));
      record.renewalTotalInr = Number((record.renewalTotalInr + inr).toFixed(2));
      record.renewalTotalCents = Math.round(record.renewalTotalUsd * 100);
      record.renewalTotalFormatted = formatMoneyAmount(record.renewalTotalUsd, "USD");
      if (!record.renewalTimestamp || timestamp >= record.renewalTimestamp) {
        record.renewalAmountUsd = usd;
        record.renewalAmountInr = inr;
        record.renewalAmountValue = usd;
        record.renewalAmountFormatted = amountFormatted;
        record.renewalDate = match.date || record.renewalDate;
        record.renewalTimestamp = timestamp || record.renewalTimestamp;
      }
    }
  }

  const purchaseUsd = Number.isFinite(record.purchaseUsd) ? record.purchaseUsd : 0;
  record.totalAmountCents = Math.round((purchaseUsd + (Number(record.renewalTotalUsd) || 0)) * 100);
  record.totalAmountFormatted = formatMoneyAmount(record.totalAmountCents / 100, "USD");

  if (record.purchaseDate) {
    record.holdingDays = calculateHoldingDays(record.purchaseDate);
  }

  if (messageId) record.seenMessageIds.push(messageId);
  record.matchedCount += 1;
  if (sourceLabel && !record.sources.includes(sourceLabel)) {
    record.sources.push(sourceLabel);
  }
}

async function fetchReceiptsForDomain(accessToken, domainName, messageCache) {
  const query = buildDomainGmailQuery(domainName);
  const messageIds = await listGmailMessageIds(accessToken, query, gmailDomainMessageLimit);
  const messages = await fetchGmailMessages(accessToken, messageIds, messageCache);
  // Oldest → newest so first paid receipt becomes Bought on for every domain.
  messages.sort((a, b) => {
    const dateA = String(parseGmailMessage(a).date || "");
    const dateB = String(parseGmailMessage(b).date || "");
    return dateA.localeCompare(dateB);
  });
  const matches = [];
  let spendSeen = 0;

  for (const message of messages) {
    try {
      const parsed = parseGmailMessage(message);
      if (!parsed.text && !parsed.subject) {
        debugGmailSkip("no parsed text", { messageId: message?.id, domain: domainName });
        continue;
      }

      const haystack = `${parsed.subject || ""}\n${parsed.text || ""}`;
      if (!domainAppearsInText(haystack, domainName)) {
        debugGmailSkip("domain not in message", {
          messageId: message?.id,
          domain: domainName,
          subject: parsed.subject,
        });
        continue;
      }

      const transactionType = classifyDomainTransaction(parsed.subject, parsed.text, domainName, {
        isFirstReceipt: spendSeen === 0,
        fromAddress: parsed.from || "",
      });
      if (!transactionType) {
        debugGmailSkip("no transaction type", {
          messageId: message?.id,
          domain: domainName,
          subject: parsed.subject,
          from: parsed.from,
        });
        continue;
      }

      const money = extractMoneyForDomain(parsed.subject, parsed.text, domainName, transactionType);
      if (!money.amount) {
        debugGmailSkip("no money found", {
          messageId: message?.id,
          domain: domainName,
          subject: parsed.subject,
          from: parsed.from,
        });
        continue;
      }

      const receiptDate = isSavReceipt(parsed.subject, parsed.text)
        ? extractSavPurchaseDate(parsed.text) || parsed.date
        : parsed.date;

      let converted;
      try {
        converted = await convertAmountToUsdInr({
          amount: money.amount,
          currency: money.currency,
          date: receiptDate,
        });
      } catch (fxError) {
        debugGmailSkip("fx conversion failed", {
          messageId: message?.id,
          domain: domainName,
          date: receiptDate,
          error: fxError instanceof Error ? fxError.message : String(fxError),
        });
        continue;
      }

      spendSeen += 1;
      matches.push({
        messageId: message?.id || "",
        transactionType,
        amount: money.amount,
        currency: money.currency,
        usd: converted.usd,
        inr: converted.inr,
        fxRate: converted.rate,
        fxRateDate: converted.rateDate,
        sourceCurrency: converted.sourceCurrency,
        date: receiptDate,
        subject: parsed.subject,
        from: parsed.from,
      });
    } catch (messageError) {
      debugGmailSkip("message parse failed", {
        messageId: message?.id,
        domain: domainName,
        error: messageError instanceof Error ? messageError.message : String(messageError),
      });
    }
  }

  return { scannedMessages: messages.length, matches };
}

function receiptSenderClause() {
  const domainClause = RND_RECEIPT_SENDER_DOMAINS.map((domain) => `from:${domain}`).join(" OR ");
  const extraAddresses = ["contact@sedo.com", "noreply@name.com", "support@name.com"];
  const addressClause = extraAddresses.map((sender) => `from:${sender}`).join(" OR ");
  return `((${domainClause}) OR (${addressClause})) -from:service@afternic.com`;
}

function buildDomainGmailQuery(domainName) {
  const domain = normalizeDomainKey(domainName);
  return widenGmailSearch(`(${receiptSenderClause()}) ("${domain}" OR ${domain}) newer_than:10y`);
}

/** Paid receipts + expiry/removal — pulls older buy/drop mail that bulk notices would otherwise bury. */
function buildDomainSpendGmailQuery(domainName) {
  const domain = normalizeDomainKey(domainName);
  const phrases = [
    'subject:"Order Finished"',
    'subject:"Order Summary"',
    'subject:"Namecheap Order Summary"',
    "subject:Receipt",
    'subject:"Sav.com Receipt"',
    'subject:"You Won"',
    "subject:won",
    'subject:"you have acquired"',
    'subject:"Order confirmation"',
    'subject:"Thank you for your order"',
    'subject:"Thank you for your purchase"',
    "subject:invoice",
    'subject:"order confirmation"',
    'subject:"Domain won"',
    'subject:"DropCatch.com Order Receipt"',
    "subject:Backorder",
    "subject:SOLD",
    'subject:"removed from account"',
    'subject:"Domain Expiration Notice"',
    'subject:"expired today"',
    'subject:"Domains just expired"',
    'subject:"Your domains expired"',
    'subject:"expired and deleted"',
    'subject:"has expired"',
  ].join(" OR ");
  return widenGmailSearch(`(${receiptSenderClause()}) ("${domain}" OR ${domain}) (${phrases}) newer_than:10y`);
}

function buildDomainGmailQueries(domainName) {
  const domain = normalizeDomainKey(domainName);
  return [
    { query: buildDomainGmailQuery(domainName), incremental: true },
    { query: buildDomainSpendGmailQuery(domainName), incremental: false },
    {
      query: widenGmailSearch(
        `(from:snapnames.com OR from:networksolutions.com OR from:namepal.com) ("${domain}" OR ${domain}) newer_than:10y`,
      ),
      incremental: false,
    },
  ];
}

/** Same as typing the domain into Gmail search — used when Bought for is still missing. */
function buildDomainWideGmailQuery(domainName) {
  const domain = normalizeDomainKey(domainName);
  return widenGmailSearch(`("${domain}" OR ${domain}) newer_than:12y`);
}

function domainAppearsInText(text, domainName) {
  const name = normalizeDomainKey(domainName);
  if (!name) return false;
  const haystack = normalizeSearchText(text);
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(name)}(?=$|[^a-z0-9])`, "i");
  if (pattern.test(haystack)) return true;
  const sld = name.split(".")[0];
  if (sld.length >= 8) {
    const sldPattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(sld)}(?=$|[^a-z0-9])`, "i");
    if (sldPattern.test(haystack)) return true;
  }
  return false;
}

function extractMoneyForDomain(subject, text, domainName, transactionType) {
  const cleaned = stripHypotheticalPriceExamples(text);
  const allocated = extractDomainOrderMoney(cleaned, domainName);
  if (allocated.amount) {
    return { amount: allocated.amount, currency: allocated.currency || "USD" };
  }

  if (hasOtherReceiptDomains(cleaned, domainName)) {
    return { amount: "", currency: "" };
  }

  const money = extractGmailMoney(subject, cleaned);
  return normalizeBulkUnstoppablePurchaseAmount({
    subject,
    text,
    transactionType,
    money,
  });
}

function classifyDomainTransaction(subject, text, domainName, options = {}) {
  const subjectText = String(subject || "");
  const body = String(text || "");
  const haystack = `${subjectText}\n${body}`;
  const fromAddress = String(options.fromAddress || "");
  const windowText = extractDomainWindowFallback(text, domainName);

  // RND screenshot ignore list (Afternic confirm, insufficient balance, link expired, Order Received).
  if (matchRndIgnore(subjectText, body, fromAddress)) return null;
  if (/service@afternic\.com/i.test(fromAddress)) return null;
  if (PAYMENT_FAILED.test(`${subjectText}\n${body}`)) return null;
  if (/^re:\s*.*thank you for your order/i.test(subjectText.trim())) return null;

  if (isPromotionalOfferMail(subjectText, body)) return null;

  const screenshotAction = matchRndScreenshotTemplate(subjectText, body, fromAddress, domainName);
  if (screenshotAction === "ignore" || screenshotAction === "expiry_notice") return null;

  // Afternic Transaction Assurance: sale/funds mail only. Follow-ups quote list prices.
  if (/ta@afternic\.com/i.test(fromAddress)) {
    if (screenshotAction === "sale" || classifySaleMail(subjectText, body, fromAddress)) return "sale";
    return null;
  }

  if (isTransferStatusMail(subjectText, body)) return null;

  if (isNoiseMail(subjectText, body)) return null;

  if (screenshotAction === "purchase" || screenshotAction === "renewal" || screenshotAction === "transfer") {
    return coerceAcquisitionEventType(screenshotAction, subjectText, body, windowText, options);
  }

  if (screenshotAction === "push" || screenshotAction === "removal" || screenshotAction === "sale") {
    return screenshotAction;
  }

  // Free push / account change — only if this domain's lines say so (bulk Order Finished can mix types).
  // Never treat an auction/acquire receipt as a push, even if the body says the name "moved".
  if (isDomainPush(subjectText, windowText)) return "push";

  // Removed from account / deleted — expired path, not sale.
  if (isDomainRemovalMail(subjectText, body)) return "removal";

  const saleType = classifySaleMail(subjectText, body, fromAddress);
  if (saleType) return "sale";

  const lineType = classifyDomainLineType(text, domainName, subject);
  const fromLine = eventTypeFromLineType(lineType);
  if (fromLine) return coerceAcquisitionEventType(fromLine, subjectText, body, windowText, options);

  // Auction / domain-won is always Bought for (all registrars, all names).
  if (
    /domain won|auction won|won the auction|you(?:'ve| have) won|you have acquired|successfully acquired|backorder won|winning bid for/i.test(
      haystack,
    ) ||
    isAcquisitionCheckoutMail(subjectText, body, windowText)
  ) {
    return "purchase";
  }

  let eventType = classifyByPhrases(subject, text);
  if (!eventType) return null;

  if (looksLikeRegistrationPurchase(subject, text, windowText) && eventType === "renewal") {
    return "purchase";
  }

  return coerceAcquisitionEventType(eventType, subjectText, body, windowText, options);
}

function extractDomainWindowFallback(text, domainName) {
  const body = String(text || "");
  const name = normalizeDomainKey(domainName);
  const idx = body.toLowerCase().indexOf(name);
  if (idx < 0) return body;
  return body.slice(Math.max(0, idx - 80), idx + 240);
}

function extractDomainLineItemMoney(text, domainName) {
  const body = normalizeGmailText(text);
  const name = normalizeDomainKey(domainName);
  if (!body || !name) return { amount: "", currency: "" };

  const lines = body.split("\n");
  const domainPattern = new RegExp(`(^|[^a-z0-9-])${escapeRegExp(name)}(?=$|[^a-z0-9-])`, "i");

  for (let index = 0; index < lines.length; index += 1) {
    if (!domainPattern.test(lines[index])) continue;

    const chunkLines = [];
    for (let j = index; j < Math.min(lines.length, index + 5); j += 1) {
      const line = lines[j];
      if (j > index && isOrderTotalLine(line)) break;
      if (j > index && isDomainItemLine(line) && !domainPattern.test(line)) break;
      chunkLines.push(line);
    }

    const chunk = chunkLines.join("\n");
    const unit = extractUnitPriceNearDomain(chunk, name);
    if (unit.amount) return unit;
  }

  // Compact single-line receipts: "... builddt.com - domain registration 1 year ($7.88)$7.88 ..."
  const compact = body.replace(/\s+/g, " ");
  const compactMatch = compact.match(
    new RegExp(
      `${escapeRegExp(name)}[^$₹]{0,120}?\\((?:USD|US\\$|\\$|INR|Rs\\.?|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:USD|US\\$|\\$|INR|Rs\\.?|₹)?\\)`,
      "i",
    ),
  );
  if (compactMatch?.[1]) {
    const currency = /\((?:INR|Rs\.?|₹)/i.test(compactMatch[0]) || /(?:INR|Rs\.?|₹)\s*\)/i.test(compactMatch[0])
      ? "INR"
      : "USD";
    return { amount: compactMatch[1], currency };
  }

  return { amount: "", currency: "" };
}

function extractUnitPriceNearDomain(chunk, domainName) {
  const text = String(chunk || "");
  if (!text) return { amount: "", currency: "" };

  // Prefer parenthetical unit prices: ($7.88) or (Rs.981)
  const parenMatches = [
    ...text.matchAll(/\((?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*\)/gi),
    ...text.matchAll(/\((?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*\)/gi),
    ...text.matchAll(/\(\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:USD|US\$|\$|INR|Rs\.?|₹)\s*\)/gi),
    ...text.matchAll(/\(\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*\)/gi),
  ];
  if (parenMatches.length) {
    const hit = parenMatches[0];
    const raw = hit[0];
    const currency = /INR|Rs\.?|₹/i.test(raw) ? "INR" : "USD";
    return { amount: hit[1], currency };
  }

  // Same-line / nearby amount after the domain name, ignoring order totals.
  const withoutTotals = text
    .split("\n")
    .filter((line) => !isOrderTotalLine(line))
    .join("\n");
  const afterDomain = withoutTotals.split(new RegExp(escapeRegExp(domainName), "i")).slice(1).join(" ");
  const searchSpace = afterDomain || withoutTotals;
  const nearby = extractFirstCurrencyAmount(searchSpace);
  if (nearby.amount) return nearby;

  return { amount: "", currency: "" };
}

function extractFirstCurrencyAmount(text) {
  const body = String(text || "");
  if (!body) return { amount: "", currency: "" };
  const patterns = [
    { currency: "INR", regex: /(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i },
    { currency: "INR", regex: /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:INR|Rs\.?)/i },
    { currency: "USD", regex: /(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i },
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern.regex);
    if (match?.[1]) return { amount: match[1], currency: pattern.currency };
  }
  return { amount: "", currency: "" };
}

function isOrderTotalLine(line) {
  return /^(final cost|total cost|order total|grand total|payment amount|amount paid|amount due)\b/i.test(
    String(line || "").trim(),
  );
}

function isDomainItemLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;
  return /(?:^|\s)(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\s|$)/i.test(text) &&
    /(domain registration|domain renewal|dns domain|transfer|registration|renewal)/i.test(text);
}

/**
 * When individual line prices are missing, divide Final/Order total by domains listed in the receipt.
 */
function splitBulkOrderTotal(text, domainName) {
  const name = normalizeDomainKey(domainName);
  const domains = listDomainsInOrderReceipt(text);
  if (!name || domains.length <= 1) return { amount: "", currency: "" };
  if (!domains.includes(name)) return { amount: "", currency: "" };

  const total = extractOrderTotalMoney(text);
  if (!total.amount) return { amount: "", currency: "" };

  const value = parseGmailMoneyValue(total.amount);
  if (value === null || value <= 0) return { amount: "", currency: "" };

  return {
    amount: (value / domains.length).toFixed(2),
    currency: total.currency || "USD",
  };
}

function extractOrderTotalMoney(text) {
  const body = normalizeGmailText(text);
  if (!body) return { amount: "", currency: "" };
  return (
    matchAmountByLabel(body, ["final cost", "total cost", "order total", "grand total", "payment amount", "amount paid"]) ||
    matchAmountByLabel(body, ["total"]) ||
    { amount: "", currency: "" }
  );
}

function listDomainsInOrderReceipt(text) {
  const body = normalizeGmailText(text);
  if (!body) return [];

  const found = [];
  const seen = new Set();
  const lines = body.split("\n");

  // Prefer ITEMS / Products Purchased blocks when present.
  let inItems = false;
  for (const line of lines) {
    if (/^(items|products purchased|your items|order information)\b/i.test(line.trim())) {
      inItems = true;
      continue;
    }
    if (inItems && isOrderTotalLine(line)) break;
    if (inItems && /^(payment|status|billing|thanks|thank you|sign in)\b/i.test(line.trim())) break;

    const candidates = inItems ? [line] : [];
    if (!inItems && isDomainItemLine(line)) candidates.push(line);

    for (const candidate of candidates) {
      const matches = candidate.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) || [];
      for (const match of matches) {
        const key = normalizeDomainKey(match);
        if (!key || seen.has(key)) continue;
        if (/dynadot\.|namesilo\.|sav\.com|spaceship\.|unstoppabledomains\.|afternic\./i.test(key)) continue;
        seen.add(key);
        found.push(key);
      }
    }
  }

  if (found.length) return found;

  // Fallback: "The domain(s) a.com, b.com has been registered"
  const summary = body.match(/domain\(s\)\s+([^.]+?)\s+has been registered/i);
  if (summary?.[1]) {
    for (const match of summary[1].match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi) || []) {
      const key = normalizeDomainKey(match);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      found.push(key);
    }
  }

  return found;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(concurrency || 1, list.length || 1));
  let nextIndex = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (nextIndex < list.length) {
      const current = nextIndex;
      nextIndex += 1;
      await worker(list[current], current);
    }
  });
  await Promise.all(runners);
}

async function exchangeGoogleCodeForTokens(code, account = "") {
  const oauth = getGoogleOAuthConfig(account);
  if (!oauth) {
    throw new Error(`No Google OAuth client configured for ${account || "default"}. Add secrets/gmail/<email>.json`);
  }
  const form = new URLSearchParams();
  form.set("code", code);
  form.set("client_id", oauth.clientId);
  form.set("client_secret", oauth.clientSecret);
  form.set("redirect_uri", oauth.redirectUri);
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
  const existing = account ? readGmailState(account) : null;
  const expiresIn = Number(data.expires_in || 0);
  return {
    access_token: data.access_token || existing?.access_token || "",
    refresh_token: data.refresh_token || existing?.refresh_token || "",
    scope: data.scope || existing?.scope || gmailScopes.join(" "),
    token_type: data.token_type || "Bearer",
    expires_at: expiresIn > 0 ? Date.now() + expiresIn * 1000 - 60_000 : existing?.expires_at || 0,
    saved_at: new Date().toISOString(),
    oauth_client_id: oauth.clientId,
  };
}

async function refreshGoogleAccessToken(refreshToken, account = "") {
  const oauth = getGoogleOAuthConfig(account);
  if (!oauth) {
    throw new Error(`No Google OAuth client configured for ${account || "default"}.`);
  }
  const form = new URLSearchParams();
  form.set("refresh_token", refreshToken);
  form.set("client_id", oauth.clientId);
  form.set("client_secret", oauth.clientSecret);
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
  const existing = readGmailState(account) || {};
  const expiresIn = Number(data.expires_in || 0);
  return {
    ...existing,
    access_token: data.access_token || "",
    scope: data.scope || existing?.scope || gmailScopes.join(" "),
    token_type: data.token_type || "Bearer",
    expires_at: expiresIn > 0 ? Date.now() + expiresIn * 1000 - 60_000 : Date.now() + 50 * 60 * 1000,
    saved_at: new Date().toISOString(),
    oauth_client_id: oauth.clientId,
  };
}

export async function getValidGmailAccessToken(account = "") {
  const key = normalizeMailboxKey(account) || readTokenStore().defaultAccount || getPrimaryMailbox();
  const tokens = readGmailState(key);
  if (!tokens) return "";

  const tokenValid = tokens.access_token && tokens.expires_at && Number(tokens.expires_at) > Date.now() + 30_000;
  if (tokenValid) return tokens.access_token;

  if (!tokens.refresh_token) return tokens.access_token || "";

  const refreshed = await refreshGoogleAccessToken(tokens.refresh_token, key);
  saveGmailState(refreshed, key);
  return refreshed.access_token || "";
}

export function listConnectedGmailAccounts() {
  return listConnectedAccountStatuses(readTokenStore()).filter((item) => item.connected);
}

export function setDefaultGmailAccount(account) {
  const key = normalizeMailboxKey(account);
  if (!key) return;
  const store = readTokenStore();
  store.defaultAccount = key;
  writeTokenStore(store);
}

function listConnectedAccountStatuses(store) {
  const emails = new Set([
    ...listMailboxEmails(),
    ...Object.keys(store.accounts || {}),
    store.defaultAccount,
  ]);
  return [...emails]
    .map((email) => normalizeMailboxKey(email))
    .filter(Boolean)
    .map((email) => {
      const tokens = store.accounts?.[email] || null;
      return {
        email,
        connected: Boolean(tokens?.refresh_token),
        mailboxReadable: Boolean(tokens?.refresh_token) && tokens?.mailboxReadable !== false,
        lastSync: tokens?.lastSync || "",
        gmailAccount: tokens?.gmailAccount || email,
        authUrl: `/auth/google/login?account=${encodeURIComponent(email)}`,
      };
    });
}

function readTokenStore() {
  const empty = { version: 2, defaultAccount: getPrimaryMailbox(), accounts: {} };
  if (!existsSync(gmailTokensPath)) return empty;
  try {
    const data = parseJson(readFileSync(gmailTokensPath, "utf8"));
    if (!data || typeof data !== "object") return empty;

    // Legacy single-account file → migrate in memory (and persist on next save).
    if (!data.accounts && (data.refresh_token || data.access_token)) {
      const email = normalizeMailboxKey(data.gmailAccount || getPrimaryMailbox());
      const migrated = {
        version: 2,
        defaultAccount: email,
        accounts: email
          ? {
              [email]: {
                access_token: data.access_token || "",
                refresh_token: data.refresh_token || "",
                scope: data.scope || gmailScopes.join(" "),
                token_type: data.token_type || "Bearer",
                expires_at: data.expires_at || 0,
                gmailAccount: email,
                mailboxReadable: data.mailboxReadable !== false,
                lastSync: data.lastSync || "",
                saved_at: data.saved_at || new Date().toISOString(),
              },
            }
          : {},
      };
      try {
        writeTokenStore(migrated);
      } catch {
        // Keep in-memory migration if write fails.
      }
      return migrated;
    }

    return {
      version: 2,
      defaultAccount: normalizeMailboxKey(data.defaultAccount || getPrimaryMailbox()),
      accounts: data.accounts && typeof data.accounts === "object" ? data.accounts : {},
    };
  } catch {
    return empty;
  }
}

function writeTokenStore(store) {
  const payload = {
    version: 2,
    defaultAccount: normalizeMailboxKey(store.defaultAccount || getPrimaryMailbox()),
    accounts: store.accounts || {},
  };
  writeFileSync(gmailTokensPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readGmailState(account = "") {
  const store = readTokenStore();
  const key = normalizeMailboxKey(account) || store.defaultAccount || getPrimaryMailbox();
  if (!key) return null;
  const tokens = store.accounts?.[key];
  if (!tokens || (!tokens.access_token && !tokens.refresh_token)) return null;
  return tokens;
}

function saveGmailState(tokens, account = "") {
  const store = readTokenStore();
  const key =
    normalizeMailboxKey(account) ||
    normalizeMailboxKey(tokens?.gmailAccount) ||
    store.defaultAccount ||
    getPrimaryMailbox();
  if (!key) return;
  const existing = store.accounts[key] || {};
  store.accounts[key] = {
    ...existing,
    ...tokens,
    gmailAccount: key,
  };
  if (!store.defaultAccount) store.defaultAccount = key;
  writeTokenStore(store);
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
  const defaultSenders = [
    "from:orders@dynadot.com",
    "from:support@namesilo.com",
    "from:support@sav.com",
    "from:noreply@name.com",
    "from:support@name.com",
    "from:receipts@spaceship.com",
    "from:notifications@unstoppabledomains.com",
    "from:snapnames-automail@snapnames.com",
  ];
  const defaultPhrases = DEFAULT_GMAIL_SEARCH_PHRASES;
  const defaultClause = buildReceiptClause(defaultSenders, defaultPhrases);

  if (!rawFilters) {
    return widenGmailSearch(defaultClause);
  }

  if (looksLikeRawGmailQuery(rawFilters)) {
    if (
      /dynadot\.com/i.test(rawFilters) &&
      /namesilo\.com/i.test(rawFilters) &&
      /sav\.com/i.test(rawFilters) &&
      /name\.com/i.test(rawFilters) &&
      /spaceship\.com/i.test(rawFilters) &&
      /unstoppabledomains\.com/i.test(rawFilters)
    ) {
      return widenGmailSearch(rawFilters);
    }
    return widenGmailSearch(`(${rawFilters}) OR (${defaultClause})`);
  }

  const senders = rawFilters
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (/@/.test(value) ? `from:${value}` : `from:${value}`));

  if (!senders.some((sender) => /dynadot\.com/i.test(sender))) {
    senders.unshift("from:orders@dynadot.com");
  }
  if (!senders.some((sender) => /namesilo\.com/i.test(sender))) {
    senders.unshift("from:support@namesilo.com");
  }
  if (!senders.some((sender) => /sav\.com/i.test(sender))) {
    senders.unshift("from:support@sav.com");
  }
  if (!senders.some((sender) => /name\.com/i.test(sender))) {
    senders.unshift("from:noreply@name.com");
  }
  if (!senders.some((sender) => /spaceship\.com/i.test(sender))) {
    senders.unshift("from:receipts@spaceship.com");
  }
  if (!senders.some((sender) => /unstoppabledomains\.com/i.test(sender))) {
    senders.unshift("from:notifications@unstoppabledomains.com");
  }

  return widenGmailSearch(
    [
    buildReceiptClause(senders, defaultPhrases),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function buildReceiptClause(senders, phrases) {
  return [
    "(",
    (Array.isArray(senders) ? senders : []).join(" OR "),
    ")",
    "(",
    (Array.isArray(phrases) ? phrases : []).join(" OR "),
    ")",
    "newer_than:10y",
  ].join(" ");
}

function widenGmailSearch(query) {
  const text = String(query || "").trim();
  if (!text) return "in:anywhere";
  if (/\bin:anywhere\b/i.test(text) || /\bin:(?:spam|trash|inbox|sent|draft|archive)\b/i.test(text)) {
    return text;
  }
  return `in:anywhere ${text}`;
}

async function listGmailMessageIds(accessToken, query, limit = gmailScanLimit, options = {}) {
  const ids = [];
  const maxIds = Math.max(1, Number(limit) || gmailScanLimit);
  let pageToken = "";
  const includeSpamTrash = options.includeSpamTrash !== false;
  const searchQuery = widenGmailSearch(query);

  while (ids.length < maxIds) {
    const url = new URL(`${gmailApiBaseUrl}/users/me/messages`);
    url.searchParams.set("maxResults", String(Math.min(100, maxIds - ids.length)));
    url.searchParams.set("fields", "messages/id,nextPageToken");
    if (includeSpamTrash) url.searchParams.set("includeSpamTrash", "true");
    if (searchQuery) url.searchParams.set("q", searchQuery);
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
      if (ids.length >= maxIds) break;
    }

    pageToken = data.nextPageToken || "";
    if (!pageToken || ids.length >= maxIds) break;
  }

  return ids;
}

async function fetchGmailMessages(accessToken, ids, messageCache = null) {
  const limitedIds = Array.isArray(ids) ? ids : [];
  const messages = [];
  const missingIds = [];

  for (const id of limitedIds) {
    if (!id) continue;
    if (messageCache?.has(id)) {
      messages.push(messageCache.get(id));
    } else {
      missingIds.push(id);
    }
  }

  let nextIndex = 0;
  const fetched = [];
  const workers = Array.from({ length: Math.min(gmailMessageConcurrency, missingIds.length || 1) }, async () => {
    while (nextIndex < missingIds.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const id = missingIds[currentIndex];
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
        const message = parseJson(raw);
        fetched.push(message);
        if (messageCache) messageCache.set(id, message);
      } catch (error) {
        debugGmailSkip("message decode failed", {
          messageId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });

  if (missingIds.length) await Promise.all(workers);
  return [...messages, ...fetched];
}

export function buildGmailWebUrl(messageId, mailbox = "") {
  const id = String(messageId || "").trim();
  if (!id || id.startsWith("manual:")) return "";
  const account = String(mailbox || "").trim();
  const query = account ? `?authuser=${encodeURIComponent(account)}` : "";
  return `https://mail.google.com/mail/${query}#all/${encodeURIComponent(id)}`;
}

export async function getGmailMessageForDisplay(messageId, mailbox = "") {
  const id = String(messageId || "").trim();
  if (!id) return { ok: false, error: "messageId is required" };
  if (id.startsWith("manual:")) {
    return { ok: false, error: "Manual entry has no Gmail message.", manual: true };
  }
  const accessToken = await getValidGmailAccessToken(mailbox);
  if (!accessToken) {
    return { ok: false, error: "Gmail is not connected for this mailbox." };
  }
  const messages = await fetchGmailMessages(accessToken, [id]);
  const message = messages[0];
  if (!message) {
    return { ok: false, error: "Could not load that Gmail message. It may have been deleted." };
  }
  const parsed = parseGmailMessage(message);
  return {
    ok: true,
    id: message.id || id,
    threadId: message.threadId || "",
    subject: parsed.subject || "",
    from: parsed.from || "",
    date: parsed.date || "",
    text: parsed.text || String(message.snippet || ""),
    snippet: message.snippet || "",
    mailbox: String(mailbox || "").trim(),
    gmailUrl: buildGmailWebUrl(message.id || id, mailbox),
  };
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

  // Namecheap (and others) put domain line items only in HTML; plain says "details only in HTML".
  return joinGmailTextPieces([...plain, ...html, ...other]);
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
  return classifyByPhrases(subject, text);
}

function stripHypotheticalPriceExamples(text) {
  return String(text || "")
    .replace(/if the domain(?: name)?\s+(?:sales?|sells?)\s+for\s*\$?\s*[\d,]+(?:\.\d{1,2})?/gi, " ")
    .replace(/the commission will be\s*\$?\s*[\d,]+(?:\.\d{1,2})?\s+from the sale/gi, " ");
}

function extractGmailMoney(subject, text) {
  const haystack = stripHypotheticalPriceExamples(`${subject || ""}\n${text || ""}`);

  if (/unstoppable domains/i.test(haystack) || /notifications@unstoppabledomains\.com/i.test(haystack)) {
    const unstoppableMatch = extractUnstoppableMoney(haystack);
    if (unstoppableMatch.amount) return unstoppableMatch;
  }

  if (/dynadot/i.test(haystack) || /orders@dynadot\.com/i.test(haystack)) {
    const dynadotMatch = extractDynadotMoney(haystack);
    if (dynadotMatch.amount) return dynadotMatch;
  }

  if (/namesilo\.com receipt|support@namesilo\.com|thank you for your order/i.test(haystack)) {
    const namesiloMatch = extractNameSiloMoney(haystack);
    if (namesiloMatch.amount) return namesiloMatch;
  }

  if (/spaceship|order summary|final cost|initial charge|receipts@spaceship\.com/i.test(haystack)) {
    const spaceshipMatch = extractSpaceshipMoney(haystack);
    if (spaceshipMatch.amount) return spaceshipMatch;
  }

  if (/sav\.com receipt|support@sav\.com|paid on/i.test(haystack)) {
    const savMatch = extractSavMoney(haystack);
    if (savMatch.amount) return savMatch;
  }

  const labeledAmount =
    matchLabeledMoney(haystack, ["total", "order amount", "purchase amount", "amount paid", "amount due"]) ||
    matchLabeledMoney(haystack, ["purchase price", "price", "subtotal", "grand total", "charge", "payment", "paid"]);

  if (labeledAmount) return labeledAmount;

  return extractAnyCurrencyAmount(haystack);
}

function extractDynadotMoney(text) {
  const body = normalizeGmailText(text);
  if (!body) {
    return { amount: "", currency: "" };
  }

  const total =
    matchAmountByLabel(body, ["total", "order total", "purchase amount", "amount paid", "amount due"]) ||
    matchAmountByLabel(body, ["price", "subtotal", "grand total", "charge", "payment"]);
  if (total) return total;

  const candidateLines = body
    .split("\n")
    .filter((line) => /domain\s+registration|domain\s+renewal|order\s+finished|invoice|receipt|renewal|transfer/i.test(line));
  const searchSpace = candidateLines.length ? candidateLines.join("\n") : body;
  const primary = extractAnyCurrencyAmount(searchSpace);
  if (primary.amount) return primary;
  return extractAnyCurrencyAmount(body);
}

function extractNameSiloMoney(text) {
  const body = normalizeGmailText(text);
  if (!body) {
    return { amount: "", currency: "" };
  }

  const orderTotal =
    matchAmountByLabel(body, ["order total", "total", "amount due", "grand total", "amount paid"]) ||
    matchAmountByLabel(body, ["sub total", "subtotal"]);
  if (orderTotal) return orderTotal;

  const candidateLines = body
    .split("\n")
    .filter((line) => /namesilo|order total|tax info|registration|thank you for your order|receipt/i.test(line));
  const searchSpace = candidateLines.length ? candidateLines.join("\n") : body;
  return extractAnyCurrencyAmount(searchSpace);
}

function extractSpaceshipMoney(text) {
  const body = normalizeGmailText(text);
  if (!body) {
    return { amount: "", currency: "" };
  }

  const total =
    matchAmountByLabel(body, ["final cost", "total", "order total", "amount due", "amount paid"]) ||
    matchAmountByLabel(body, ["initial charge", "price", "charge"]);
  if (total) return total;

  const candidateLines = body
    .split("\n")
    .filter((line) => /spaceship|order summary|payment details|final cost|initial charge|your items/i.test(line));
  const searchSpace = candidateLines.length ? candidateLines.join("\n") : body;
  return extractAnyCurrencyAmount(searchSpace);
}

function extractSavMoney(text) {
  const body = normalizeGmailText(text);
  if (!body) {
    return { amount: "", currency: "" };
  }

  const total =
    matchAmountByLabel(body, ["total", "amount", "paid", "purchase amount", "amount paid", "amount due"]) ||
    matchAmountByLabel(body, ["item", "charge", "price"]);
  if (total) return total;

  const candidateLines = body
    .split("\n")
    .filter((line) => /sav\.com|receipt|auto renewal|renewal|paid on|transaction id/i.test(line));
  const searchSpace = candidateLines.length ? candidateLines.join("\n") : body;
  return extractAnyCurrencyAmount(searchSpace);
}

function extractSavPurchaseDate(text) {
  const body = normalizeGmailText(text);
  if (!body) return "";

  const paidOnMatch = body.match(/Paid on\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+\d{1,2}:\d{2}\s*(?:am|pm))?/i);
  if (paidOnMatch?.[1]) {
    return normalizeDateValue(paidOnMatch[1]);
  }

  const dateMatch = body.match(/Paid on\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i);
  if (dateMatch?.[1]) {
    return normalizeDateValue(dateMatch[1]);
  }

  return "";
}

function normalizeBulkUnstoppablePurchaseAmount({ subject, text, transactionType, money }) {
  if (transactionType !== "purchase") return money;
  if (!isUnstoppableReceipt(subject, text)) return money;
  const itemCount = countUnstoppablePurchasedItems(text);
  if (!Number.isInteger(itemCount) || itemCount <= 1) return money;

  const amountValue = parseGmailMoneyValue(money?.amount);
  if (amountValue === null) return money;

  const perDomainAmount = amountValue / itemCount;
  if (!Number.isFinite(perDomainAmount) || perDomainAmount <= 0) return money;

  return {
    amount: perDomainAmount.toFixed(2),
    currency: money?.currency || "$",
  };
}

function isUnstoppableReceipt(subject, text) {
  const haystack = `${subject || ""}\n${text || ""}`;
  return /unstoppable domains/i.test(haystack) || /notifications@unstoppabledomains\.com/i.test(haystack);
}

function isSavReceipt(subject, text) {
  const haystack = `${subject || ""}\n${text || ""}`;
  return /sav\.com receipt|support@sav\.com|paid on|transaction id/i.test(haystack);
}

function countUnstoppablePurchasedItems(text) {
  const body = String(text || "");
  const productBlock = extractUnstoppableProductBlock(body);
  const searchSpace = productBlock || body;
  const lines = searchSpace.split("\n").map((line) => normalizeGmailText(line));
  const itemLines = lines.filter((line) =>
    /(?:^|\b)(?:dns\s+domain|domain\s+renewal|transfer|registration)\s*:/i.test(line) &&
    /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i.test(line) &&
    !/^(products\s+purchased|order id|payment method|order amount|sales tax|credits\/discounts|total|thanks|thank you|billing details|payment processing fee)/i.test(line),
  );

  if (itemLines.length) return itemLines.length;

  const compact = searchSpace.replace(/\s+/g, " ").replace(/[•*•]/g, " ").trim();
  const compactMatches = compact.match(/\b(?:dns\s+domain|domain\s+renewal|transfer|registration)\s*:\s*(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi);
  return Array.isArray(compactMatches) ? compactMatches.length : 0;
}

function extractUnstoppableProductBlock(body) {
  const lines = String(body || "").split("\n");
  const startIndex = lines.findIndex((line) => /products\s+purchased/i.test(line));
  if (startIndex === -1) return "";

  const collected = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (!collected.length && /products\s+purchased/i.test(line)) {
      collected.push(line);
      continue;
    }

    if (/^(dns contact verification|order id|payment method|order amount|sales tax|credits\/discounts|total|thanks|thank you|billing details|payment processing fee)/i.test(line)) {
      break;
    }

    collected.push(line);
  }
  return collected.join("\n").trim();
}

function parseGmailMoneyValue(value) {
  const normalized = String(value || "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatGmailMoney(amount, currency) {
  return formatMoneyAmount(amount, currency);
}

function extractAnyCurrencyAmount(text) {
  const body = String(text || "");
  if (!body) return { amount: "", currency: "" };

  const patterns = [
    { currency: "INR", regex: /(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi },
    { currency: "INR", regex: /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:INR|Rs\.?)/gi },
    { currency: "USD", regex: /(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/gi },
  ];

  let lastHit = null;
  for (const pattern of patterns) {
    const matches = [...body.matchAll(pattern.regex)];
    if (matches.length) {
      lastHit = { amount: matches[matches.length - 1][1], currency: pattern.currency };
    }
  }
  return lastHit || { amount: "", currency: "" };
}

function matchLabeledMoney(text, labels) {
  return matchAmountByLabel(text, labels);
}

function matchAmountByLabel(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      String.raw`${escapeRegExp(label)}\s*:?\s*(?:(USD|US\$|\$)|(INR|Rs\.?|₹))\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)`,
      "i",
    );
    const match = String(text || "").match(pattern);
    if (match?.[3]) {
      const currency = match[2] ? "INR" : "USD";
      return { amount: match[3], currency };
    }

    const trailingCurrency = new RegExp(
      String.raw`${escapeRegExp(label)}\s*:?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(USD|US\$|\$|INR|Rs\.?|₹)`,
      "i",
    );
    const trailing = String(text || "").match(trailingCurrency);
    if (trailing?.[1]) {
      const currency = /inr|rs\.?|₹/i.test(trailing[2] || "") ? "INR" : "USD";
      return { amount: trailing[1], currency };
    }
  }
  return null;
}

function looksLikeRawGmailQuery(value) {
  return /from:|subject:|label:|category:|after:|before:|newer_than:|older_than:|\(|\)|"/i.test(value);
}

function isGmailAuthError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP 401|HTTP 403|HTTP 400|Unauthorized|Forbidden|invalid_grant|invalid_token/i.test(message);
}

function countMatchedDomains(domains) {
  return domains.reduce((count, domain) => {
    const matched =
      Boolean(domain?.purchaseAmount !== "" && domain?.purchaseAmount !== null && domain?.purchaseAmount !== undefined) ||
      Boolean(domain?.transferAmount !== "" && domain?.transferAmount !== null && domain?.transferAmount !== undefined) ||
      Boolean(domain?.renewalAmount !== "" && domain?.renewalAmount !== null && domain?.renewalAmount !== undefined) ||
      Boolean(domain?.renewalSpend !== "" && domain?.renewalSpend !== null && domain?.renewalSpend !== undefined) ||
      Boolean(domain?.totalAmount !== "" && domain?.totalAmount !== null && domain?.totalAmount !== undefined) ||
      Boolean(domain?.purchaseDate) ||
      Boolean(domain?.transferDate) ||
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

// Test helpers + sync primitives
export const __test = {
  applyGmailMatch,
  createGmailRecord,
  classifyGmailTransaction,
  enrichDomainWithGmailRecord,
  buildDomainGmailQuery,
  buildDomainSpendGmailQuery,
  buildDomainGmailQueries,
  extractDomainLineItemMoney,
};

export {
  classifyGmailTransaction,
  classifyDomainTransaction,
  buildDomainGmailQuery,
  buildDomainSpendGmailQuery,
  buildDomainWideGmailQuery,
  buildDomainGmailQueries,
  domainAppearsInText,
  extractMoneyForDomain,
  findMatchingDomains,
  listGmailMessageIds,
  fetchGmailMessages,
  parseGmailMessage,
  isSavReceipt,
  extractSavPurchaseDate,
  normalizeDomainKey,
  extractSaleMoney,
  guessSalePlatform,
};

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
