import { convertAmountToUsdInr } from "../fx/index.js";
import {
  getEventStats,
  insertDomainEvent,
  deleteDomainEvent,
  setSyncMeta,
  getSyncMeta,
  deleteNoiseDomainEvents,
  purgeFalseSaleEvents,
  purgeAfternicSupportEvents,
  purgeTransferStatusEvents,
  countDomainSpendEvents,
  hasDomainPurchaseEvent,
  seedDomainMetaFromKnownLists,
  upsertDomainMeta,
  listExpenseEvents,
  deleteDomainEventsByIds,
} from "../db/index.js";
import {
  getPrimaryMailbox,
  listMailboxEmails,
  SEED_DOMAINS_BY_MAILBOX,
  seedEntriesForMeta,
  defaultMailboxForDomain,
  LETSLITERATE_DOMAINS,
  HISTORIC_SEED_DOMAINS,
} from "../data/known-domains.js";
import {
  classifyDomainTransaction,
  domainAppearsInText,
  extractMoneyForDomain,
  extractSavPurchaseDate,
  fetchGmailMessages,
  getGmailStatus,
  getValidGmailAccessToken,
  listConnectedGmailAccounts,
  isSavReceipt,
  listGmailMessageIds,
  normalizeDomainKey,
  parseGmailMessage,
  buildDomainGmailQueries,
  buildDomainWideGmailQuery,
} from "./index.js";
import { extractExpiryFromGmailText } from "./expiry.js";
import { isExpiryReminderMail, isNoiseMail, extractAccountChangeParties } from "./rules.js";
import { extractReceiptDomainNames, buildPaidReceiptGmailQuery } from "./receipts/parse.js";
import {
  buildExpenseGmailQuery,
  classifyExpenseMail,
  extractExpenseMoney,
  shouldKeepExpenseEvent,
} from "./expenses.js";
import {
  classifySaleMail,
  extractSaleMoney,
  guessSalePlatform,
  isFundsReceivedMail,
  buildSaleGmailQuery,
  extractSaleDomainNames,
  extractSellingPrice,
  isPlausibleSaleGross,
} from "./sales.js";

const defaultDomainMessageLimit = Number(process.env.GMAIL_DOMAIN_MESSAGE_LIMIT || 25);
const defaultConcurrency = Number(process.env.GMAIL_DOMAIN_CONCURRENCY || 4);

export async function syncGmailPortfolioEvents(domains, options = {}) {
  const status = getGmailStatus();
  if (!status.configured || !status.connected) {
    return {
      ok: false,
      error: "Gmail is not connected. Run npm run gmail:setup.",
      ...emptySyncResult(),
    };
  }

  const seeded = seedDomainMetaFromKnownLists({
    seedEntriesForMeta,
    LETSLITERATE_DOMAINS,
    HISTORIC_SEED_DOMAINS,
    SEED_DOMAINS_BY_MAILBOX,
    MAILBOX_PRIMARY: getPrimaryMailbox(),
  });

  const connected = listConnectedGmailAccounts();
  const onlyAccount = String(options.account || "").trim().toLowerCase();
  const accounts = onlyAccount
    ? connected.filter((item) => item.email === onlyAccount)
    : connected;

  if (!accounts.length) {
    return {
      ok: false,
      error: "No connected Gmail mailboxes. Run npm run gmail:setup for each inbox.",
      ...emptySyncResult(),
    };
  }

  let domainList = options.salesOnly ? [] : selectTargets(domains, options);
  const summary = {
    ok: true,
    targetDomains: domainList.length,
    discoveredDomains: 0,
    scannedMessages: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    duplicates: 0,
    skipped: 0,
    seededMeta: seeded,
    noiseRemoved: deleteNoiseDomainEvents(domainList),
    promoRemoved: purgeFalseSaleEvents() + purgeTransferStatusEvents() + purgeAfternicSupportEvents(),
    byType: {
      purchase: 0,
      renewal: 0,
      transfer: 0,
      removal: 0,
      sale: 0,
      push: 0,
      expiry_notice: 0,
      expense: 0,
    },
    sampleMode: Boolean(
      options.sampleLimit || options.sampleDomains?.length || options.saleSampleDomains?.length,
    ),
    mode: options.incremental ? "incremental" : "full",
    salesOnly: Boolean(options.salesOnly),
    mailboxesSynced: [],
    mailbox: accounts.map((item) => item.email).join(", "),
  };

  const afterDate = options.incremental ? getIncrementalAfterDate() : "";
  const mailboxCaches = new Map();
  const shouldDiscover =
    !options.salesOnly &&
    !options.skipDiscovery &&
    !(Array.isArray(options.sampleDomains) && options.sampleDomains.length);

  if (shouldDiscover) {
    const known = new Set(domainList.map((item) => normalizeDomainKey(item.name || item)));
    const extra = [];
    for (const account of accounts) {
      let accessToken = "";
      try {
        accessToken = await getValidGmailAccessToken(account.email);
      } catch {
        continue;
      }
      if (!accessToken) continue;
      const cache = new Map();
      mailboxCaches.set(account.email, cache);
      const names = await discoverSpendDomainNames(accessToken, cache);
      for (const name of names) {
        if (known.has(name)) continue;
        known.add(name);
        extra.push({ name, mailbox: defaultMailboxForDomain(name) });
      }
    }
    if (extra.length) {
      domainList = [...domainList, ...extra];
      summary.discoveredDomains = extra.length;
      summary.targetDomains = domainList.length;
    }
  }

  for (const account of accounts) {
    let accessToken = "";
    try {
      accessToken = await getValidGmailAccessToken(account.email);
    } catch (error) {
      summary.ok = false;
      summary.error = error instanceof Error ? error.message : String(error);
      continue;
    }
    if (!accessToken) continue;

    const messageCache = mailboxCaches.get(account.email) || new Map();
    // Every connected Gmail is searched for the same names — buy/renewal
    // receipts often live in an older inbox after a push or transfer.
    const accountSummary = await syncDomainsForMailbox({
      accessToken,
      mailbox: account.email,
      domainList,
      afterDate,
      messageCache,
      skipExpenses: options.salesOnly ? options.skipExpenses !== false : Boolean(options.skipExpenses),
      skipSales: options.salesOnly ? false : Boolean(options.skipSales),
      saleSampleLimit: Number(options.saleSampleLimit || 0),
      saleSampleDomains: Array.isArray(options.saleSampleDomains) ? options.saleSampleDomains : [],
      messageLimit: Number(options.messageLimit || defaultDomainMessageLimit),
    });

    summary.scannedMessages += accountSummary.scannedMessages;
    summary.inserted += accountSummary.inserted;
    summary.updated += accountSummary.updated;
    summary.deleted += accountSummary.deleted;
    summary.duplicates += accountSummary.duplicates;
    summary.skipped += accountSummary.skipped;
    for (const [type, count] of Object.entries(accountSummary.byType || {})) {
      if (summary.byType[type] !== undefined) summary.byType[type] += count;
    }
    summary.mailboxesSynced.push(account.email);
  }

  summary.promoRemoved = purgeUnpaidExpenseEvents();
  summary.deleted += summary.promoRemoved;

  setSyncMeta("gmail_last_sync_at", new Date().toISOString());
  setSyncMeta("gmail_last_sync_mode", summary.mode);
  if (!summary.sampleMode && !options.salesOnly) {
    setSyncMeta("gmail_last_full_sync_at", new Date().toISOString());
  }

  return {
    ...summary,
    stats: getEventStats(),
  };
}

async function syncDomainsForMailbox({
  accessToken,
  mailbox,
  domainList,
  afterDate,
  messageCache,
  skipExpenses,
  skipSales,
  saleSampleLimit,
  saleSampleDomains,
  messageLimit,
}) {
  const summary = {
    scannedMessages: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    duplicates: 0,
    skipped: 0,
    byType: {
      purchase: 0,
      renewal: 0,
      transfer: 0,
      removal: 0,
      sale: 0,
      push: 0,
      expiry_notice: 0,
      expense: 0,
    },
  };

  await mapWithConcurrency(domainList, defaultConcurrency, async (domain) => {
    const domainName = domain?.name || domain;
    if (!domainName) return;

    const idSet = new Set();
    const specs = [...buildDomainGmailQueries(domainName)];
    if (!hasDomainPurchaseEvent(domainName)) {
      specs.push({
        query: buildDomainWideGmailQuery(domainName),
        incremental: false,
        messageLimit: Number(process.env.GMAIL_WIDE_MESSAGE_LIMIT || 200),
      });
    }
    for (const spec of specs) {
      const baseQuery = typeof spec === "string" ? spec : spec.query;
      const allowIncremental = typeof spec === "string" ? true : spec.incremental !== false;
      const query = afterDate && allowIncremental ? `${baseQuery} after:${afterDate}` : baseQuery;
      const cap = Number(spec.messageLimit || messageLimit || defaultDomainMessageLimit);
      const ids = await listGmailMessageIds(accessToken, query, cap);
      for (const id of ids) idSet.add(id);
    }
    const messages = await fetchGmailMessages(accessToken, [...idSet], messageCache);
    summary.scannedMessages += messages.length;

    messages.sort((a, b) => {
      const dateA = String(parseGmailMessage(a).date || "");
      const dateB = String(parseGmailMessage(b).date || "");
      return dateA.localeCompare(dateB);
    });

    const fallbackMailbox = domain.mailbox || defaultMailboxForDomain(domainName);

    for (const message of messages) {
      try {
        const parsed = parseGmailMessage(message);
        const haystack = `${parsed.subject || ""}\n${parsed.text || ""}`;
        if (!domainAppearsInText(haystack, domainName)) {
          summary.skipped += 1;
          continue;
        }
        if (subjectBelongsToOtherDomain(parsed.subject, domainName)) {
          const removed = deleteDomainEvent(message?.id || "", domainName);
          if (removed) summary.deleted += removed;
          else summary.skipped += 1;
          continue;
        }

        const receiptDate = isSavReceipt(parsed.subject, parsed.text)
          ? extractSavPurchaseDate(parsed.text) || parsed.date
          : parsed.date;

        const priorSpendEvents = countDomainSpendEvents(domainName, {
          excludeMessageId: message?.id || "",
        });
        const eventType = classifyDomainTransaction(parsed.subject, parsed.text, domainName, {
          isFirstReceipt: priorSpendEvents === 0,
          fromAddress: parsed.from || "",
        });

        if (!eventType) {
          const expiryDate = extractExpiryFromGmailText(haystack, domainName, receiptDate || "");
          if (
            expiryDate &&
            (isExpiryReminderMail(parsed.subject, parsed.text) || isNoiseMail(parsed.subject, parsed.text))
          ) {
            const result = insertDomainEvent({
              messageId: message?.id || "",
              domain: normalizeDomainKey(domainName),
              eventType: "expiry_notice",
              eventDate: receiptDate || "",
              subject: parsed.subject || "",
              fromAddress: parsed.from || "",
              registrarHint: guessRegistrar(parsed.from),
              snippet: String(parsed.text || "").replace(/\s+/g, " ").slice(0, 240),
              expiryDate,
              mailbox,
            });
            tallyResult(summary, result, "expiry_notice");
          } else {
            const removed = deleteDomainEvent(message?.id || "", domainName);
            if (removed) summary.deleted += removed;
            else summary.skipped += 1;
          }
          continue;
        }

        let amountOriginal = null;
        let currencyOriginal = "";
        let amountUsd = null;
        let amountInr = null;
        let amountGross = null;
        let fxRate = null;
        let fxRateDate = "";
        let salePlatform = "";

        if (eventType === "sale") {
          const saleFields = await saleAmountsFromParsed(parsed, receiptDate);
          amountOriginal = saleFields.amountOriginal;
          currencyOriginal = saleFields.currencyOriginal;
          amountUsd = saleFields.amountUsd;
          amountInr = saleFields.amountInr;
          amountGross = saleFields.amountGross;
          fxRate = saleFields.fxRate;
          fxRateDate = saleFields.fxRateDate;
          salePlatform = saleFields.salePlatform;
          upsertDomainMeta({
            domain: domainName,
            mailbox,
            statusHint: "sold",
            sellPlatform: salePlatform,
          });
        } else if (eventType === "purchase" || eventType === "renewal" || eventType === "transfer") {
          const money = extractMoneyForDomain(parsed.subject, parsed.text, domainName, eventType);
          if (money.amount) {
            try {
              const converted = await convertAmountToUsdInr({
                amount: money.amount,
                currency: money.currency,
                date: receiptDate,
              });
              amountOriginal = Number(String(money.amount).replace(/,/g, ""));
              currencyOriginal = money.currency || converted.sourceCurrency || "";
              amountUsd = converted.usd;
              amountInr = converted.inr;
              fxRate = converted.rate;
              fxRateDate = converted.rateDate;
            } catch {
              amountOriginal = Number(String(money.amount).replace(/,/g, ""));
              currencyOriginal = money.currency || "";
            }
            if (
              (eventType === "purchase" || eventType === "renewal") &&
              !(Number(amountUsd) > 0 || Number(amountInr) > 0 || Number(amountOriginal) > 0)
            ) {
              summary.skipped += 1;
              continue;
            }
          } else if (eventType !== "transfer") {
            summary.skipped += 1;
            continue;
          }
          if (eventType === "purchase") {
            upsertDomainMeta({
              domain: domainName,
              buyPlatform: guessRegistrar(parsed.from) || "",
              statusHint: "active",
            });
          }
        } else if (eventType === "push") {
          const parties = extractAccountChangeParties(parsed.subject, parsed.text, mailbox);
          const destMailbox = parties.toAccount.includes("@") ? parties.toAccount : mailbox || fallbackMailbox;
          upsertDomainMeta({
            domain: domainName,
            mailbox: destMailbox || mailbox || fallbackMailbox,
            statusHint: "active",
            notes: parties.note,
          });
        } else if (eventType === "removal") {
          upsertDomainMeta({
            domain: domainName,
            mailbox: mailbox || fallbackMailbox,
            statusHint: "expired",
            notes: "removed from account",
          });
        }

        const expiryDate = extractExpiryFromGmailText(haystack, domainName, receiptDate || "");

        const result = insertDomainEvent({
          messageId: message?.id || "",
          domain: normalizeDomainKey(domainName),
          eventType,
          eventDate: receiptDate || "",
          amountOriginal,
          currencyOriginal,
          amountUsd,
          amountInr,
          amountGross,
          fxRate,
          fxRateDate,
          subject: parsed.subject || "",
          fromAddress: parsed.from || "",
          registrarHint: guessRegistrar(parsed.from),
          snippet: String(parsed.text || "").replace(/\s+/g, " ").slice(0, 240),
          expiryDate,
          mailbox,
          salePlatform,
        });

        tallyResult(summary, result, eventType);
      } catch {
        summary.skipped += 1;
      }
    }
  });

  if (!skipSales) {
    const saleStats = await syncSaleReceipts(accessToken, messageCache, mailbox, {
      saleSampleLimit,
      saleSampleDomains,
    });
    summary.scannedMessages += saleStats.scannedMessages;
    summary.inserted += saleStats.inserted;
    summary.updated += saleStats.updated;
    summary.skipped += saleStats.skipped;
    summary.deleted += saleStats.deleted;
    summary.byType.sale += saleStats.byTypeSale;
  }

  if (!skipExpenses) {
    const expenseStats = await syncExpenseReceipts(accessToken, messageCache, afterDate, mailbox);
    summary.scannedMessages += expenseStats.scannedMessages;
    summary.inserted += expenseStats.inserted;
    summary.updated += expenseStats.updated;
    summary.skipped += expenseStats.skipped;
    summary.byType.expense += expenseStats.inserted + expenseStats.updated;
  }

  return summary;
}

async function saleAmountsFromParsed(parsed, receiptDate) {
  const saleMoney = extractSaleMoney(parsed.subject, parsed.text);
  const salePlatform = guessSalePlatform(parsed.subject, parsed.text, parsed.from);
  const fundsMail = saleMoney.fundsMail || isFundsReceivedMail(parsed.subject, parsed.text);
  const storeGross = saleMoney.gross;
  const storeNet =
    saleMoney.net ?? (fundsMail && saleMoney.gross != null && saleMoney.net == null ? saleMoney.gross : null);
  const amountForFx = storeNet ?? storeGross;
  const fields = {
    amountOriginal: null,
    currencyOriginal: "",
    amountUsd: null,
    amountInr: null,
    amountGross: null,
    fxRate: null,
    fxRateDate: "",
    salePlatform,
  };
  if (amountForFx != null) {
    try {
      const converted = await convertAmountToUsdInr({
        amount: amountForFx,
        currency: saleMoney.currency || "USD",
        date: receiptDate,
      });
      fields.amountOriginal = amountForFx;
      fields.currencyOriginal = saleMoney.currency || converted.sourceCurrency || "USD";
      fields.amountUsd = converted.usd;
      fields.amountInr = converted.inr;
      fields.fxRate = converted.rate;
      fields.fxRateDate = converted.rateDate;
    } catch {
      fields.amountOriginal = amountForFx;
      fields.currencyOriginal = saleMoney.currency || "USD";
      fields.amountUsd = saleMoney.currency === "INR" ? null : amountForFx;
      fields.amountInr = saleMoney.currency === "INR" ? amountForFx : null;
    }
  }
  if (storeGross != null) {
    try {
      const convertedGross = await convertAmountToUsdInr({
        amount: storeGross,
        currency: saleMoney.currency || "USD",
        date: receiptDate,
      });
      fields.amountGross = convertedGross.usd ?? storeGross;
    } catch {
      fields.amountGross = storeGross;
    }
  } else if (!fundsMail && fields.amountUsd != null && storeNet == null) {
    fields.amountGross = fields.amountUsd;
  }
  return fields;
}

async function syncSaleReceipts(accessToken, messageCache, mailbox, options = {}) {
  const stats = {
    scannedMessages: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    deleted: 0,
    byTypeSale: 0,
  };
  const sampleDomains = (Array.isArray(options.saleSampleDomains) ? options.saleSampleDomains : [])
    .map((name) => normalizeDomainKey(name))
    .filter(Boolean);
  const sampleSet = sampleDomains.length ? new Set(sampleDomains) : null;
  const saleSampleLimit = Number(options.saleSampleLimit || 0);
  let query = buildSaleGmailQuery();
  if (sampleSet) {
    const domainClause = [...sampleSet].map((name) => `"${name}"`).join(" OR ");
    query = `${query} (${domainClause})`;
  }
  const ids = await listGmailMessageIds(accessToken, query, sampleSet ? 50 : 400);
  const messages = await fetchGmailMessages(accessToken, ids, messageCache);
  stats.scannedMessages = messages.length;

  const needsNearbyGross = new Map();
  for (const message of messages) {
    try {
      const parsed = parseGmailMessage(message);
      if (!classifySaleMail(parsed.subject, parsed.text, parsed.from)) {
        stats.skipped += 1;
        continue;
      }
      const names = extractSaleDomainNames(parsed.subject, parsed.text);
      if (!names.length) {
        stats.skipped += 1;
        continue;
      }
      const saleFields = await saleAmountsFromParsed(parsed, parsed.date);
      for (const domainName of names) {
        if (sampleSet && !sampleSet.has(domainName)) continue;
        upsertDomainMeta({
          domain: domainName,
          mailbox,
          statusHint: "sold",
          sellPlatform: saleFields.salePlatform,
        });
        const payload = {
          messageId: message?.id || "",
          domain: domainName,
          eventType: "sale",
          eventDate: parsed.date || "",
          amountOriginal: saleFields.amountOriginal,
          currencyOriginal: saleFields.currencyOriginal,
          amountUsd: saleFields.amountUsd,
          amountInr: saleFields.amountInr,
          amountGross: saleFields.amountGross,
          fxRate: saleFields.fxRate,
          fxRateDate: saleFields.fxRateDate,
          subject: parsed.subject || "",
          fromAddress: parsed.from || "",
          registrarHint: guessRegistrar(parsed.from),
          snippet: String(parsed.text || "").replace(/\s+/g, " ").slice(0, 240),
          mailbox,
          salePlatform: saleFields.salePlatform,
        };
        const result = insertDomainEvent(payload);
        if (
          saleFields.amountUsd != null &&
          (saleFields.amountGross == null ||
            Math.abs(Number(saleFields.amountGross) - Number(saleFields.amountUsd)) < 0.02)
        ) {
          needsNearbyGross.set(domainName, {
            net: saleFields.amountUsd,
            date: parsed.date || "",
            payload,
          });
        }
        if (result.inserted) {
          stats.inserted += 1;
          stats.byTypeSale += 1;
        } else if (result.updated) stats.updated += 1;
        else stats.skipped += 1;
      }
      if (saleSampleLimit > 0 && stats.inserted + stats.updated >= saleSampleLimit) break;
    } catch {
      stats.skipped += 1;
    }
  }

  for (const [domainName, info] of needsNearbyGross) {
    try {
      const nearbyGross = await findNearbySaleGross(
        accessToken,
        messageCache,
        domainName,
        info.date,
        info.net,
      );
      if (nearbyGross == null) continue;
      const converted = await convertAmountToUsdInr({
        amount: nearbyGross,
        currency: "USD",
        date: info.date,
      }).catch(() => ({ usd: nearbyGross }));
      insertDomainEvent({
        ...info.payload,
        amountGross: converted.usd ?? nearbyGross,
      });
      stats.updated += 1;
    } catch {
      // keep credited/net amount if nearby mail cannot be read
    }
  }
  return stats;
}

async function findNearbySaleGross(accessToken, messageCache, domainName, saleDate, net) {
  const query = `"${domainName}" (subject:"has sold" OR subject:"sold for" OR subject:"Selling Price" OR subject:"funds are on the way" OR subject:SOLD) newer_than:10y`;
  const ids = await listGmailMessageIds(accessToken, query, 20);
  const nearbyMessages = await fetchGmailMessages(accessToken, ids, messageCache);
  const saleTs = Date.parse(saleDate || "") || 0;
  const candidates = [];
  for (const message of nearbyMessages) {
    const parsed = parseGmailMessage(message);
    const mailTs = Date.parse(parsed.date || "") || 0;
    if (saleTs && mailTs && Math.abs(mailTs - saleTs) > 90 * 86400000) continue;
    const listing = /marketplace listing/i.test(parsed.subject || "");
    const money = extractSaleMoney(parsed.subject, parsed.text);
    const selling = extractSellingPrice(parsed.text);
    const actualSale = /has sold|sold for|\bSOLD\b/i.test(parsed.subject || "") && !listing;
    const gross = actualSale ? money.gross : selling || money.gross;
    if (gross == null || !isPlausibleSaleGross(gross, net)) continue;
    candidates.push({
      gross,
      weight: actualSale ? 2 : listing ? 0 : 1,
      delta: saleTs && mailTs ? Math.abs(mailTs - saleTs) : Number.MAX_SAFE_INTEGER,
    });
  }
  candidates.sort((a, b) => b.weight - a.weight || a.delta - b.delta);
  return candidates[0]?.gross ?? null;
}

async function discoverSpendDomainNames(accessToken, messageCache) {
  const limit = Number(process.env.GMAIL_DISCOVERY_MESSAGE_LIMIT || 1500);
  const ids = await listGmailMessageIds(
    accessToken,
    buildPaidReceiptGmailQuery(),
    Number.isFinite(limit) && limit > 0 ? limit : 1500,
  );
  const messages = await fetchGmailMessages(accessToken, ids, messageCache);
  const found = [];
  const seen = new Set();
  for (const message of messages) {
    const parsed = parseGmailMessage(message);
    for (const name of extractReceiptDomainNames(parsed.subject, parsed.text)) {
      if (seen.has(name)) continue;
      seen.add(name);
      found.push(name);
    }
  }
  return found;
}

async function syncExpenseReceipts(accessToken, messageCache, afterDate, mailbox) {
  const stats = { scannedMessages: 0, inserted: 0, updated: 0, skipped: 0 };
  let query = buildExpenseGmailQuery();
  if (afterDate) query = `${query} after:${afterDate}`;
  const ids = await listGmailMessageIds(accessToken, query, 200);
  const messages = await fetchGmailMessages(accessToken, ids, messageCache);
  stats.scannedMessages = messages.length;

  for (const message of messages) {
    try {
      const parsed = parseGmailMessage(message);
      const classified = classifyExpenseMail(parsed.subject, parsed.text, parsed.from);
      if (!classified) {
        stats.skipped += 1;
        continue;
      }
      const money = extractExpenseMoney(parsed.subject, parsed.text);
      if (!money.amount) {
        stats.skipped += 1;
        continue;
      }
      let amountUsd = null;
      let amountInr = null;
      let fxRate = null;
      let fxRateDate = "";
      const amountOriginal = Number(String(money.amount).replace(/,/g, ""));
      try {
        const converted = await convertAmountToUsdInr({
          amount: money.amount,
          currency: money.currency || "USD",
          date: parsed.date,
        });
        amountUsd = converted.usd;
        amountInr = converted.inr;
        fxRate = converted.rate;
        fxRateDate = converted.rateDate;
      } catch {
        amountUsd = money.currency === "INR" ? null : amountOriginal;
        amountInr = money.currency === "INR" ? amountOriginal : null;
      }

      const vendorKey = normalizeDomainKey(classified.vendor.replace(/\s+/g, "").toLowerCase()) || "expense";
      const result = insertDomainEvent({
        messageId: message?.id || "",
        domain: `expense:${vendorKey}`,
        eventType: "expense",
        eventDate: parsed.date || "",
        amountOriginal,
        currencyOriginal: money.currency || "USD",
        amountUsd,
        amountInr,
        fxRate,
        fxRateDate,
        subject: parsed.subject || "",
        fromAddress: parsed.from || "",
        registrarHint: classified.vendor,
        vendor: classified.vendor,
        snippet: String(parsed.text || "").replace(/\s+/g, " ").slice(0, 240),
        mailbox: mailbox || "",
      });
      if (result.inserted) stats.inserted += 1;
      else if (result.updated) stats.updated += 1;
      else stats.skipped += 1;
    } catch {
      stats.skipped += 1;
    }
  }
  return stats;
}

function tallyResult(summary, result, eventType) {
  if (result.inserted) {
    summary.inserted += 1;
    if (summary.byType[eventType] !== undefined) summary.byType[eventType] += 1;
  } else if (result.updated) {
    summary.updated += 1;
  } else {
    summary.duplicates += 1;
  }
}

function selectTargets(domains, options = {}) {
  const list = (Array.isArray(domains) ? domains : [])
    .map((domain) => (typeof domain === "string" ? { name: domain } : domain))
    .filter((domain) => domain?.name);

  const sampleDomains = Array.isArray(options.sampleDomains)
    ? options.sampleDomains.map((name) => normalizeDomainKey(name)).filter(Boolean)
    : String(process.env.GMAIL_SAMPLE_DOMAINS || "")
        .split(/[\n,]+/)
        .map((value) => normalizeDomainKey(value))
        .filter(Boolean);
  const sampleLimit = Number(options.sampleLimit || process.env.GMAIL_SAMPLE_LIMIT || 0);

  if (sampleDomains.length) {
    return sampleDomains.map((name) => ({ name, mailbox: defaultMailboxForDomain(name) }));
  }

  const seedNames = [];
  for (const [mailbox, domains] of Object.entries(SEED_DOMAINS_BY_MAILBOX || {})) {
    for (const name of domains || []) {
      seedNames.push({ name, mailbox });
    }
  }
  if (options.includeHistoricSeeds || process.env.GMAIL_SYNC_HISTORIC === "1") {
    for (const name of HISTORIC_SEED_DOMAINS) {
      seedNames.push({ name, mailbox: defaultMailboxForDomain(name) });
    }
  }
  const byName = new Map();
  for (const domain of [...list, ...seedNames]) {
    const key = normalizeDomainKey(domain.name);
    if (!key || byName.has(key)) continue;
    byName.set(key, {
      name: key,
      mailbox: domain.mailbox || defaultMailboxForDomain(key),
    });
  }

  let targets = [...byName.values()];
  if (Number.isFinite(sampleLimit) && sampleLimit > 0) {
    targets = targets.slice(0, sampleLimit);
  }
  return targets;
}

function purgeUnpaidExpenseEvents() {
  const rows = listExpenseEvents(5000);
  const ids = rows.filter((row) => !shouldKeepExpenseEvent(row)).map((row) => row.id);
  return deleteDomainEventsByIds(ids);
}

function getIncrementalAfterDate() {
  const last = getSyncMeta("gmail_last_full_sync_at", "") || getSyncMeta("gmail_last_sync_at", "");
  if (!last) return "";
  const parsed = Date.parse(last);
  if (Number.isNaN(parsed)) return "";
  const date = new Date(parsed - 2 * 86400000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function subjectBelongsToOtherDomain(subject, domainName) {
  const current = normalizeDomainKey(domainName);
  const match = String(subject || "").match(
    /^([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s+(?:transfer initiated|transfer complete|expires?|expired|removed from account)/i,
  );
  if (!match?.[1] || !current) return false;
  return normalizeDomainKey(match[1]) !== current;
}

function guessRegistrar(fromAddress) {
  const value = String(fromAddress || "").toLowerCase();
  if (value.includes("dynadot")) return "Dynadot";
  if (value.includes("namesilo")) return "NameSilo";
  if (value.includes("sav.com")) return "Sav";
  if (value.includes("name.com")) return "Name.com";
  if (value.includes("spaceship")) return "Spaceship";
  if (value.includes("unstoppable")) return "Unstoppable";
  if (value.includes("godaddy")) return "GoDaddy";
  if (value.includes("porkbun")) return "Porkbun";
  if (value.includes("snapnames")) return "SnapNames";
  if (value.includes("networksolutions") || value.includes("namepal")) return "Network Solutions";
  if (value.includes("dropcatch")) return "DropCatch";
  if (value.includes("namecheap")) return "Namecheap";
  if (value.includes("cosmotown")) return "Cosmotown";
  if (value.includes("namebright")) return "NameBright";
  if (value.includes("afternic")) return "Afternic";
  return "";
}

function emptySyncResult() {
  return {
    targetDomains: 0,
    discoveredDomains: 0,
    scannedMessages: 0,
    inserted: 0,
    updated: 0,
    deleted: 0,
    duplicates: 0,
    skipped: 0,
    byType: {
      purchase: 0,
      renewal: 0,
      transfer: 0,
      removal: 0,
      sale: 0,
      push: 0,
      expiry_notice: 0,
      expense: 0,
    },
    stats: getEventStats(),
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Math.min(concurrency || 1, list.length || 1));
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (nextIndex < list.length) {
        const current = nextIndex;
        nextIndex += 1;
        await worker(list[current], current);
      }
    }),
  );
}
