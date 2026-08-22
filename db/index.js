import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import {
  isIncomingTransferSpend,
  isOutgoingTransferMail,
  isTransferStatusMail,
  isDomainPush,
  isDuplicateInitialPurchase,
  extractRegistrarOrderId,
  extractDynadotAccountMailbox,
} from "../gmail/rules.js";

const dbPath = path.join(process.cwd(), ".domain-ledger.db");
let dbInstance = null;

export function getDb() {
  if (dbInstance) return dbInstance;
  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS domain_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT,
      amount_original REAL,
      currency_original TEXT,
      amount_usd REAL,
      amount_inr REAL,
      fx_rate REAL,
      fx_rate_date TEXT,
      subject TEXT,
      from_address TEXT,
      registrar_hint TEXT,
      snippet TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, domain, event_type)
    );
    CREATE INDEX IF NOT EXISTS idx_domain_events_domain ON domain_events(domain);
    CREATE INDEX IF NOT EXISTS idx_domain_events_type ON domain_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_domain_events_date ON domain_events(event_date);
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  ensureColumn(dbInstance, "domain_events", "expiry_date", "TEXT");
  ensureColumn(dbInstance, "domain_events", "mailbox", "TEXT");
  ensureColumn(dbInstance, "domain_events", "amount_gross", "REAL");
  ensureColumn(dbInstance, "domain_events", "sale_platform", "TEXT");
  ensureColumn(dbInstance, "domain_events", "vendor", "TEXT");
  ensureColumn(dbInstance, "domain_events", "manual", "INTEGER");
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS domain_meta (
      domain TEXT PRIMARY KEY,
      mailbox TEXT,
      status_hint TEXT,
      notes TEXT,
      buy_platform TEXT,
      sell_platform TEXT,
      manual_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_domain_meta_mailbox ON domain_meta(mailbox);
  `);
  return dbInstance;
}

function ensureColumn(db, table, column, typeSql) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  if (rows.some((row) => String(row.name) === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
}

export function getSyncMeta(key, fallback = "") {
  const row = getDb().prepare("SELECT value FROM sync_meta WHERE key = ?").get(key);
  return row?.value ?? fallback;
}

export function setSyncMeta(key, value) {
  getDb()
    .prepare(
      `INSERT INTO sync_meta(key, value) VALUES(?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, String(value ?? ""));
}

export function hasMessageEvent(messageId, domain, eventType) {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM domain_events
       WHERE message_id = ? AND domain = ? AND event_type = ?
       LIMIT 1`,
    )
    .get(messageId, normalizeDomain(domain), eventType);
  return Boolean(row?.ok);
}

export function hasDomainPurchaseEvent(domain) {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM domain_events
       WHERE domain = ?
         AND event_type = 'purchase'
         AND (amount_usd > 0 OR amount_inr > 0 OR amount_original > 0)
       LIMIT 1`,
    )
    .get(normalizeDomain(domain));
  return Boolean(row?.ok);
}

export function countDomainSpendEvents(domain, options = {}) {
  const excludeMessageId = String(options.excludeMessageId || "").trim();
  const row = excludeMessageId
    ? getDb()
        .prepare(
          `SELECT COUNT(*) AS count FROM domain_events
           WHERE domain = ? AND event_type IN ('purchase', 'renewal', 'transfer')
             AND message_id != ?`,
        )
        .get(normalizeDomain(domain), excludeMessageId)
    : getDb()
        .prepare(
          `SELECT COUNT(*) AS count FROM domain_events
           WHERE domain = ? AND event_type IN ('purchase', 'renewal', 'transfer')`,
        )
        .get(normalizeDomain(domain));
  return Number(row?.count) || 0;
}

export function insertDomainEvent(event) {
  const domain = normalizeDomain(event.domain);
  const messageId = String(event.messageId || "").trim();
  const eventType = String(event.eventType || "").trim();
  if (!domain || !messageId || !eventType) {
    return { inserted: false, updated: false, reason: "missing-fields" };
  }

  const existing = getDb()
    .prepare(`SELECT id, event_type FROM domain_events WHERE message_id = ? AND domain = ? LIMIT 1`)
    .get(messageId, domain);
  const existed = Boolean(existing);

  // One receipt message → one event per domain (type/amount can be corrected on re-sync).
  getDb().prepare(`DELETE FROM domain_events WHERE message_id = ? AND domain = ?`).run(messageId, domain);

  getDb()
    .prepare(
      `INSERT INTO domain_events (
        message_id, domain, event_type, event_date,
        amount_original, currency_original, amount_usd, amount_inr,
        fx_rate, fx_rate_date, subject, from_address, registrar_hint, snippet, expiry_date,
        mailbox, amount_gross, sale_platform, vendor, manual, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      messageId,
      domain,
      eventType,
      event.eventDate || "",
      event.amountOriginal ?? null,
      event.currencyOriginal || "",
      event.amountUsd ?? null,
      event.amountInr ?? null,
      event.fxRate ?? null,
      event.fxRateDate || "",
      event.subject || "",
      event.fromAddress || "",
      event.registrarHint || "",
      event.snippet || "",
      event.expiryDate || "",
      event.mailbox || "",
      event.amountGross ?? null,
      event.salePlatform || "",
      event.vendor || "",
      event.manual ? 1 : 0,
      new Date().toISOString(),
    );

  if (existed) {
    return { inserted: false, updated: true, reason: "updated" };
  }
  return { inserted: true, updated: false, reason: "inserted" };
}

/** Remove a stored event when re-classify says the message is noise / not spend. */
export function deleteDomainEvent(messageId, domain) {
  const key = normalizeDomain(domain);
  const id = String(messageId || "").trim();
  if (!key || !id) return 0;
  const result = getDb()
    .prepare(`DELETE FROM domain_events WHERE message_id = ? AND domain = ?`)
    .run(id, key);
  return Number(result.changes) || 0;
}

/** Drop reminder / pre-completion mail that should never count as spend. */
export function deleteNoiseDomainEvents(domains = []) {
  const names = (Array.isArray(domains) ? domains : [])
    .map((value) => normalizeDomain(typeof value === "string" ? value : value?.name))
    .filter(Boolean);

  const noiseSubjectSql = `(
    lower(subject) LIKE 'order received%'
    OR lower(subject) LIKE '3ds verification%'
    OR lower(subject) LIKE 'auto-renew order submitted%'
    OR lower(subject) LIKE 'whois data reminder%'
    OR lower(subject) LIKE '%grace period%'
    OR lower(subject) LIKE 'last reminder of expired%'
    OR lower(subject) LIKE 'domains just expired%'
    OR lower(subject) LIKE 'action required: please renew%'
    OR lower(subject) LIKE 'automatic domain renewal action needed%'
    OR lower(subject) LIKE '%auto renewal payment issue%'
    OR lower(subject) LIKE 'attention required: auto renewal%'
    OR lower(subject) LIKE '%approve domain listing%'
    OR lower(subject) LIKE 'nameserver update%'
    OR lower(subject) LIKE 'new offer received%'
    OR lower(subject) LIKE '%whois info for%'
    OR lower(subject) LIKE 'activate afternic%'
    OR lower(subject) LIKE '%available for purchase at snapnames%'
    OR lower(subject) LIKE 'domain expiration notice%'
    OR lower(subject) LIKE 'submitting auto-renewal order%'
    OR lower(subject) LIKE 'backorder confirmation%'
    OR lower(subject) LIKE 'upcoming backorders%'
    OR lower(subject) LIKE '%fast transfer deactivation%'
    OR lower(subject) LIKE 'reminder: update your domain contact%'
    OR lower(subject) LIKE '%opt-in to the afternic premium%'
    OR lower(subject) LIKE 'confirmation for epik marketplace listing%'
    OR lower(subject) LIKE '%failed to process payment%'
    OR lower(subject) LIKE 're:%thank you for your order%'
    OR lower(subject) GLOB 'afternic - [0-9]*'
    OR lower(from_address) LIKE '%service@afternic.com%'
  )`;

  // Empty list = no-op (avoid wiping the whole ledger by accident).
  if (!names.length) return 0;

  const placeholders = names.map(() => "?").join(", ");
  const result = getDb()
    .prepare(`DELETE FROM domain_events WHERE domain IN (${placeholders}) AND ${noiseSubjectSql}`)
    .run(...names);
  return Number(result.changes) || 0;
}

/** Drop Afternic support tickets whose hypothetical $ examples were stored as spend/sales. */
export function purgeAfternicSupportEvents() {
  const result = getDb()
    .prepare(
      `DELETE FROM domain_events
       WHERE lower(from_address) LIKE '%service@afternic.com%'
         AND event_type IN ('purchase', 'renewal', 'transfer', 'sale')`,
    )
    .run();
  const tickets = getDb()
    .prepare(
      `DELETE FROM domain_events
       WHERE event_type IN ('purchase', 'renewal', 'transfer', 'sale')
         AND (
           lower(subject) GLOB 'afternic - [0-9]*'
           OR lower(snippet) LIKE '%thank you for contacting afternic support%'
           OR lower(snippet) LIKE '%if the domain name sales for%'
           OR lower(snippet) LIKE '%if the domain name sells for%'
         )`,
    )
    .run();
  const taOps = getDb()
    .prepare(
      `DELETE FROM domain_events
       WHERE lower(from_address) LIKE '%ta@afternic.com%'
         AND event_type IN ('purchase', 'renewal', 'transfer')
         AND amount_usd IS NOT NULL
         AND amount_usd > 0`,
    )
    .run();
  return Number(result.changes || 0) + Number(tickets.changes || 0) + Number(taOps.changes || 0);
}

/** Drop WHOIS / Afternic-activate / SnapNames-inventory mail that was stored as a sale. */
export function purgeFalseSaleEvents() {
  const result = getDb()
    .prepare(
      `DELETE FROM domain_events
       WHERE event_type = 'sale'
         AND (
           lower(subject) LIKE '%whois info for%'
           OR lower(subject) LIKE 'activate afternic%'
           OR lower(subject) LIKE '%available for purchase at snapnames%'
           OR lower(subject) LIKE '%thank you for your order%'
           OR lower(subject) LIKE '%unreported%'
           OR lower(subject) LIKE '%waiting to transfer%'
           OR lower(subject) LIKE '%transfer of domain name sold%'
           OR lower(from_address) LIKE '%unreportedsales%'
         )`,
    )
    .run();
  return Number(result.changes) || 0;
}

export function purgeTransferStatusEvents() {
  const result = getDb()
    .prepare(
      `DELETE FROM domain_events
       WHERE event_type IN ('transfer', 'push')
         AND lower(subject) NOT LIKE 'order finished%'
         AND (
           lower(subject) LIKE '%transfer initiated%'
           OR lower(subject) LIKE '%transfer complete%'
           OR lower(subject) LIKE '%authorization code%'
           OR lower(subject) LIKE '%important information regarding%'
           OR lower(subject) LIKE '%domain name transfer request%'
           OR lower(subject) LIKE '%registrar transfer request%'
           OR lower(subject) LIKE '%domain transfer is complete%'
           OR lower(subject) LIKE '%contact record change%'
           OR lower(subject) LIKE 'order confirmation for%'
         )`,
    )
    .run();
  return Number(result.changes) || 0;
}

export function listEventsForDomains(domains = []) {
  const names = (Array.isArray(domains) ? domains : [])
    .map((value) => normalizeDomain(typeof value === "string" ? value : value?.name))
    .filter(Boolean);
  if (!names.length) {
    return getDb()
      .prepare(`SELECT * FROM domain_events ORDER BY event_date ASC, id ASC`)
      .all();
  }

  const placeholders = names.map(() => "?").join(", ");
  return getDb()
    .prepare(
      `SELECT * FROM domain_events
       WHERE domain IN (${placeholders})
       ORDER BY event_date ASC, id ASC`,
    )
    .all(...names);
}

export function listRemovalEvents(limit = 100) {
  return getDb()
    .prepare(
      `SELECT * FROM domain_events
       WHERE event_type = 'removal'
       ORDER BY event_date DESC, id DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function listDomainNamesFromEvents() {
  return getDb()
    .prepare(
      `SELECT DISTINCT domain AS name
       FROM domain_events
       ORDER BY domain ASC`,
    )
    .all()
    .map((row) => normalizeDomain(row.name))
    .filter(Boolean);
}

export function getEventStats() {
  const totals = getDb()
    .prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM domain_events
       GROUP BY event_type`,
    )
    .all();
  const domains = getDb().prepare(`SELECT COUNT(DISTINCT domain) AS count FROM domain_events`).get();
  return {
    byType: Object.fromEntries(totals.map((row) => [row.event_type, Number(row.count) || 0])),
    uniqueDomains: Number(domains?.count) || 0,
    lastGmailSyncAt: getSyncMeta("gmail_last_sync_at", ""),
    lastGmailSyncMode: getSyncMeta("gmail_last_sync_mode", ""),
    dbPath: ".domain-ledger.db",
  };
}

export function buildLedgerFromEvents(domainNames = []) {
  const events = listEventsForDomains(domainNames);
  const ledger = new Map();

  for (const event of events) {
    const key = normalizeDomain(event.domain);
    if (!key) continue;
    if (!ledger.has(key)) {
      ledger.set(key, createEmptyLedger());
    }
    const record = ledger.get(key);
    applyEventToLedger(record, event);
  }

  return ledger;
}

function createEmptyLedger() {
  return {
    purchaseUsd: null,
    purchaseInr: null,
    purchaseDate: "",
    purchaseTimestamp: 0,
    purchaseFxRate: null,
    purchaseFxRateDate: "",
    renewalCount: 0,
    renewalTotalUsd: 0,
    renewalTotalInr: 0,
    renewalDate: "",
    renewalAmountUsd: null,
    renewalAmountInr: null,
    transferCount: 0,
    transferDate: "",
    transferUsd: null,
    transferInr: null,
    removalDate: "",
    removalCount: 0,
    saleCount: 0,
    saleDate: "",
    saleGrossUsd: null,
    saleNetUsd: null,
    saleGrossInr: null,
    saleNetInr: null,
    salePlatform: "",
    lastEventDate: "",
    eventCount: 0,
    expiryDate: "",
    expirySource: "",
    mailbox: "",
    dynadotAccountMailbox: "",
    purchasePlatform: "",
    sources: [],
    spendKeys: new Set(),
  };
}

function addRenewalSpend(record, event, usd, inr) {
  if (!record.spendKeys) record.spendKeys = new Set();
  const orderId = extractRegistrarOrderId(event.subject || "", event.snippet || "");
  const amountKey = `${event.event_date || ""}|${usd ?? ""}|${inr ?? ""}`;
  const key = orderId ? `order:${orderId}` : `spend:${amountKey}`;
  if (record.spendKeys.has(key)) return false;
  record.spendKeys.add(key);
  record.renewalCount += 1;
  record.renewalTotalUsd = Number(((record.renewalTotalUsd || 0) + (usd || 0)).toFixed(2));
  record.renewalTotalInr = Number(((record.renewalTotalInr || 0) + (inr || 0)).toFixed(2));
  if (!record.renewalDate || event.event_date >= record.renewalDate) {
    record.renewalDate = event.event_date || record.renewalDate;
    record.renewalAmountUsd = usd;
    record.renewalAmountInr = inr;
  }
  return true;
}

function finiteMoney(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function applyEventToLedger(record, event) {
  const type = String(event.event_type || "");
  const timestamp = Date.parse(event.event_date || "") || 0;
  const usd = finiteMoney(event.amount_usd);
  const inr = finiteMoney(event.amount_inr);
  record.eventCount += 1;
  if (event.event_date && (!record.lastEventDate || event.event_date > record.lastEventDate)) {
    record.lastEventDate = event.event_date;
  }
  const source = [event.subject, event.from_address].filter(Boolean).join(" | ");
  if (source && !record.sources.includes(source)) record.sources.push(source);

  const expiry = String(event.expiry_date || "").trim();
  if (expiry && /^\d{4}-\d{2}-\d{2}/.test(expiry)) {
    if (!record.expiryDate || expiry >= record.expiryDate) {
      record.expiryDate = expiry.slice(0, 10);
      record.expirySource = "gmail";
    }
  }
  if (event.mailbox && (type === "push" || type === "removal" || type === "expiry_notice")) {
    record.mailbox = event.mailbox;
  }
  const dynadotMailbox = extractDynadotAccountMailbox(event.subject, event.snippet);
  if (dynadotMailbox) record.dynadotAccountMailbox = dynadotMailbox;

  if (type === "purchase") {
    const paid = usd != null || inr != null;
    const existingPaid = record.purchaseUsd != null || record.purchaseInr != null;
    const earlier = !record.purchaseTimestamp || (timestamp && timestamp <= record.purchaseTimestamp);
    if (earlier || (paid && !existingPaid)) {
      record.purchaseUsd = usd;
      record.purchaseInr = inr;
      record.purchaseDate = event.event_date || record.purchaseDate;
      record.purchaseTimestamp = timestamp || record.purchaseTimestamp || Date.now();
      record.purchaseFxRate = Number(event.fx_rate) || record.purchaseFxRate;
      record.purchaseFxRateDate = event.fx_rate_date || record.purchaseFxRateDate;
      record.purchasePlatform =
        event.registrar_hint || guessRegistrar(event.from_address) || record.purchasePlatform || "";
    } else if (
      isDuplicateInitialPurchase(record.purchaseDate, record.purchaseUsd, event.event_date, usd)
    ) {
      // Auction win + paid receipt (or two copies of the same bid) stay as Bought for.
      return;
    } else if (usd !== null || inr !== null) {
      addRenewalSpend(record, event, usd, inr);
    }
    return;
  }

  if (type === "renewal") {
    addRenewalSpend(record, event, usd, inr);
    return;
  }

  if (type === "push") {
    if (event.mailbox) record.mailbox = event.mailbox;
    return;
  }

  if (type === "transfer") {
    // Incoming paid transfer = one renewal year. Push is free. Outgoing/status mail is not spend.
    record.transferCount += 1;
    const subject = event.subject || "";
    const snippet = event.snippet || "";
    if (isDomainPush(subject, snippet) || isOutgoingTransferMail(subject, snippet)) {
      if (!record.transferDate || event.event_date <= record.transferDate) {
        record.transferDate = event.event_date || record.transferDate;
      }
      return;
    }
    if (!record.transferDate || event.event_date <= record.transferDate) {
      record.transferDate = event.event_date || record.transferDate;
    }
    if (usd != null && (record.transferUsd == null || Number(usd) > 0)) {
      record.transferUsd = usd;
    }
    if (inr != null && (record.transferInr == null || Number(inr) > 0)) {
      record.transferInr = inr;
    }
    if (isTransferStatusMail(subject, snippet)) return;
    if (!isIncomingTransferSpend(subject, snippet)) return;
    if (usd !== null || inr !== null) {
      addRenewalSpend(record, event, usd, inr);
    }
    return;
  }

  if (type === "removal") {
    record.removalCount += 1;
    if (!record.removalDate || event.event_date >= record.removalDate) {
      record.removalDate = event.event_date || record.removalDate;
    }
    return;
  }

  if (type === "sale") {
    record.saleCount += 1;
    const gross = finiteMoney(event.amount_gross);
    const subject = String(event.subject || "");
    const isFunds =
      /funds are on the way|we have just sent you a payment|masterbucks payment|proceeds credited|will be credited/i.test(subject);

    if (!record.saleDate || event.event_date >= record.saleDate) {
      record.saleDate = event.event_date || record.saleDate;
    }
    if (event.sale_platform) record.salePlatform = event.sale_platform;

    // PDF: higher = sold for (gross); lower / funds mail = after commission (net).
    // Nearby sale emails for the same domain are merged across events.
    if (gross != null && gross > 0) {
      record.saleGrossUsd =
        record.saleGrossUsd == null ? gross : Math.max(Number(record.saleGrossUsd), gross);
    }
    if (usd != null && usd > 0) {
      if (isFunds) {
        record.saleNetUsd = usd;
      } else if (gross != null && usd < gross - 0.009) {
        record.saleNetUsd = usd;
        record.saleGrossUsd =
          record.saleGrossUsd == null ? gross : Math.max(Number(record.saleGrossUsd), gross);
      } else if (gross != null) {
        record.saleGrossUsd =
          record.saleGrossUsd == null ? gross : Math.max(Number(record.saleGrossUsd), gross);
        if (record.saleNetUsd == null && usd !== gross) record.saleNetUsd = usd;
      } else if (record.saleGrossUsd == null && record.saleNetUsd == null) {
        record.saleGrossUsd = usd;
      } else if (record.saleGrossUsd != null && usd < Number(record.saleGrossUsd) - 0.009) {
        record.saleNetUsd = usd;
      } else if (record.saleNetUsd == null) {
        record.saleNetUsd = usd;
      }
    }
    if (inr != null) {
      if (isFunds || (record.saleNetInr == null && record.saleGrossInr != null && inr < record.saleGrossInr)) {
        record.saleNetInr = inr;
      } else if (record.saleGrossInr == null) {
        record.saleGrossInr = inr;
      }
    }

    if (
      record.saleGrossUsd != null &&
      record.saleNetUsd != null &&
      Number(record.saleNetUsd) > Number(record.saleGrossUsd)
    ) {
      const high = Math.max(Number(record.saleGrossUsd), Number(record.saleNetUsd));
      const low = Math.min(Number(record.saleGrossUsd), Number(record.saleNetUsd));
      record.saleGrossUsd = high;
      record.saleNetUsd = low;
    }

    record.removalCount += 1;
    if (!record.removalDate || event.event_date >= record.removalDate) {
      record.removalDate = event.event_date || record.removalDate;
    }
    return;
  }

  if (type === "expiry_notice") {
    // Date-only; already applied via expiry_date above.
    return;
  }

  if (type === "push" || type === "account_change") {
    // Free push between own accounts — track mailbox, never renewal spend.
    if (event.mailbox) record.mailbox = event.mailbox;
    return;
  }

  if (type === "expense") {
    // Expenses are listed separately; do not fold into domain spend.
    return;
  }
}

export function enrichDomainsWithEventLedger(domains) {
  const list = Array.isArray(domains) ? domains : [];
  const ledger = buildLedgerFromEvents(list.map((domain) => domain?.name).filter(Boolean));

  return list.map((domain) => {
    const key = normalizeDomain(domain?.name);
    const record = ledger.get(key);
    if (!record) return domain;

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
      ...domain,
      purchaseAmount: purchaseUsd ?? domain.purchaseAmount ?? "",
      purchasePrice: purchaseUsd != null ? `$${Number(purchaseUsd).toFixed(2)}` : domain.purchasePrice || "",
      purchaseAmountUsd: purchaseUsd ?? "",
      purchaseAmountInr: purchaseInr ?? "",
      purchasePriceUsd: purchaseUsd != null ? `$${Number(purchaseUsd).toFixed(2)}` : "",
      purchasePriceInr: purchaseInr != null ? `₹${Number(purchaseInr).toFixed(2)}` : "",
      purchaseDate: record.purchaseDate || domain.purchaseDate || "",
      boughtOn: record.purchaseDate || domain.boughtOn || "",
      holdingDays: record.purchaseDate ? holdingDays(record.purchaseDate) : domain.holdingDays || "",
      holding: record.purchaseDate ? holdingDays(record.purchaseDate) : domain.holding || "",
      renewalCount: record.renewalCount || 0,
      renewalSpend: renewalUsd ?? "",
      renewalSpendUsd: renewalUsd ?? "",
      renewalSpendInr: renewalInr ?? "",
      renewalSpendPrice: renewalUsd != null ? `$${Number(renewalUsd).toFixed(2)}` : "",
      renewalSpendPriceUsd: renewalUsd != null ? `$${Number(renewalUsd).toFixed(2)}` : "",
      renewalSpendPriceInr: renewalInr != null ? `₹${Number(renewalInr).toFixed(2)}` : "",
      renewalDate: record.renewalDate || "",
      transferDate: record.transferDate || domain.transferDate || "",
      transferAmount: record.transferUsd ?? domain.transferAmount ?? "",
      removalDate: record.removalDate || "",
      totalAmount: totalUsd ?? "",
      totalPrice: totalUsd != null ? `$${Number(totalUsd).toFixed(2)}` : "",
      totalAmountUsd: totalUsd ?? "",
      totalAmountInr: totalInr ?? "",
      totalPriceUsd: totalUsd != null ? `$${Number(totalUsd).toFixed(2)}` : "",
      totalPriceInr: totalInr != null ? `₹${Number(totalInr).toFixed(2)}` : "",
      fxRate: record.purchaseFxRate || "",
      fxRateDate: record.purchaseFxRateDate || "",
      eventCount: record.eventCount,
      ledgerSource: "gmail-events",
    };
  });
}

export function removedDomainsFromEvents(activeDomainNames = [], limit = 100) {
  const active = new Set((activeDomainNames || []).map((name) => normalizeDomain(name)).filter(Boolean));
  const removals = listRemovalEvents(limit * 2);
  const out = [];
  const seen = new Set();

  for (const event of removals) {
    const key = normalizeDomain(event.domain);
    if (!key || active.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: key,
      registrar: event.registrar_hint || guessRegistrar(event.from_address) || "Gmail",
      source: "Gmail",
      removedAt: event.event_date || event.created_at,
      subject: event.subject || "",
    });
    if (out.length >= limit) break;
  }
  return out;
}

function holdingDays(purchaseDate) {
  const parsed = Date.parse(purchaseDate);
  if (Number.isNaN(parsed)) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const purchase = new Date(parsed);
  purchase.setHours(0, 0, 0, 0);
  return String(Math.max(0, Math.round((today - purchase) / 86400000)));
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
  if (value.includes("dropcatch")) return "DropCatch";
  if (value.includes("namecheap")) return "Namecheap";
  if (value.includes("cosmotown")) return "Cosmotown";
  if (value.includes("namebright")) return "NameBright";
  if (value.includes("afternic")) return "Afternic";
  return "";
}

function normalizeDomain(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "")
    .trim();
}

export function upsertDomainMeta(meta = {}) {
  const domain = normalizeDomain(meta.domain);
  if (!domain) return false;
  getDb()
    .prepare(
      `INSERT INTO domain_meta(domain, mailbox, status_hint, notes, buy_platform, sell_platform, manual_json, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET
         mailbox = COALESCE(NULLIF(excluded.mailbox, ''), domain_meta.mailbox),
         status_hint = COALESCE(NULLIF(excluded.status_hint, ''), domain_meta.status_hint),
         notes = COALESCE(excluded.notes, domain_meta.notes),
         buy_platform = CASE
           WHEN COALESCE(domain_meta.buy_platform, '') != '' THEN domain_meta.buy_platform
           ELSE excluded.buy_platform
         END,
         sell_platform = COALESCE(NULLIF(excluded.sell_platform, ''), domain_meta.sell_platform),
         manual_json = COALESCE(excluded.manual_json, domain_meta.manual_json),
         updated_at = excluded.updated_at`,
    )
    .run(
      domain,
      meta.mailbox || "",
      meta.statusHint || "",
      meta.notes || "",
      meta.buyPlatform || "",
      meta.sellPlatform || "",
      meta.manualJson || "",
      new Date().toISOString(),
    );
  return true;
}

export function getDomainMetaMap() {
  const rows = getDb().prepare(`SELECT * FROM domain_meta`).all();
  return new Map(rows.map((row) => [normalizeDomain(row.domain), row]));
}

export function seedDomainMetaFromKnownLists(known) {
  const entries =
    typeof known?.seedEntriesForMeta === "function"
      ? known.seedEntriesForMeta()
      : Array.isArray(known?.entries)
        ? known.entries
        : [];

  // Back-compat with older callers that passed LETSLITERATE / HISTORIC lists.
  if (!entries.length) {
    const {
      LETSLITERATE_DOMAINS = [],
      HISTORIC_SEED_DOMAINS = [],
      MAILBOX_PRIMARY = "",
      MAILBOX_SECONDARY = "",
      SEED_DOMAINS_BY_MAILBOX = {},
    } = known || {};
    for (const [mailbox, domains] of Object.entries(SEED_DOMAINS_BY_MAILBOX)) {
      for (const name of domains || []) {
        entries.push({ domain: name, mailbox, statusHint: "active" });
      }
    }
    if (!Object.keys(SEED_DOMAINS_BY_MAILBOX).length && MAILBOX_SECONDARY) {
      for (const name of LETSLITERATE_DOMAINS) {
        entries.push({ domain: name, mailbox: MAILBOX_SECONDARY, statusHint: "active" });
      }
    }
    for (const name of HISTORIC_SEED_DOMAINS) {
      entries.push({ domain: name, mailbox: MAILBOX_PRIMARY, statusHint: "historic" });
    }
  }

  let count = 0;
  for (const entry of entries) {
    if (upsertDomainMeta(entry)) count += 1;
  }
  return count;
}

export function deleteDomainEventsByIds(ids = []) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!list.length) return 0;
  const placeholders = list.map(() => "?").join(", ");
  const result = getDb()
    .prepare(`DELETE FROM domain_events WHERE id IN (${placeholders})`)
    .run(...list);
  return Number(result.changes) || 0;
}

export function listExpenseEvents(limit = 500) {
  return getDb()
    .prepare(
      `SELECT * FROM domain_events
       WHERE event_type = 'expense'
       ORDER BY event_date DESC, id DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function listSaleEvents(limit = 500) {
  return getDb()
    .prepare(
      `SELECT * FROM domain_events
       WHERE event_type = 'sale'
       ORDER BY event_date DESC, id DESC
       LIMIT ?`,
    )
    .all(limit);
}

export function upsertManualDomainEvent(event) {
  const domain = normalizeDomain(event.domain);
  const eventType = String(event.eventType || "").trim();
  if (!domain || !eventType) return { ok: false, error: "domain and eventType required" };
  const messageId = String(event.messageId || `manual:${domain}:${eventType}:${event.eventDate || "na"}`).trim();
  return insertDomainEvent({
    ...event,
    messageId,
    domain,
    eventType,
    manual: true,
    registrarHint: event.registrarHint || "Manual",
  });
}

export function getDomainEventById(id) {
  const num = Number(id);
  if (!Number.isFinite(num) || num <= 0) return null;
  return getDb().prepare(`SELECT * FROM domain_events WHERE id = ?`).get(num) || null;
}

/**
 * Gmail messages that produced a table cell (purchase, renewal sum, sale, expense…).
 * These are whatever mail was classified — a receipt, payout notice, or a simple email.
 */
export function listSourceEvents({ domain = "", column = "", eventId = "" } = {}) {
  if (eventId) {
    const row = getDomainEventById(eventId);
    return row ? [serializeSourceEvent(row)] : [];
  }
  const key = normalizeDomain(domain);
  if (!key) return [];
  return filterEventsForColumn(listEventsForDomains([key]), column).map(serializeSourceEvent);
}

function serializeSourceEvent(event) {
  const messageId = String(event.message_id || "").trim();
  return {
    id: event.id,
    messageId,
    domain: event.domain || "",
    eventType: event.event_type || "",
    eventDate: event.event_date || "",
    amountUsd: event.amount_usd ?? null,
    amountInr: event.amount_inr ?? null,
    amountGross: event.amount_gross ?? null,
    subject: event.subject || "",
    from: event.from_address || "",
    mailbox: event.mailbox || "",
    vendor: event.vendor || "",
    registrarHint: event.registrar_hint || "",
    snippet: event.snippet || "",
    manual: Boolean(event.manual) || messageId.startsWith("manual:"),
  };
}

function filterEventsForColumn(events, column) {
  const key = String(column || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const list = Array.isArray(events) ? events : [];
  const byDate = (a, b) => String(a.event_date || "").localeCompare(String(b.event_date || ""));

  if (key === "expense" || key === "amount") {
    return list.filter((event) => event.event_type === "expense").sort(byDate);
  }
  if (key === "sale" || key === "soldfor" || key === "soldnet" || key === "saledate") {
    return list.filter((event) => event.event_type === "sale").sort(byDate);
  }
  if (key === "expiry" || key === "expireson" || key === "expiredexpiry") {
    return list
      .filter((event) => event.event_type === "expiry_notice" || event.event_type === "removal")
      .sort(byDate);
  }
  if (key === "removedat") {
    return list.filter((event) => event.event_type === "removal").sort(byDate);
  }

  const { purchase, renewals } = splitPurchaseAndRenewalEvents(list);
  if (key === "purchase" || key === "boughton" || key === "boughtfor") {
    return purchase ? [purchase] : [];
  }
  if (key === "renewal" || key === "renewalspend" || key === "renewals") {
    return renewals;
  }
  if (key === "total" || key === "totalspent" || key === "profit") {
    return [...(purchase ? [purchase] : []), ...renewals, ...list.filter((event) => event.event_type === "sale")].sort(
      byDate,
    );
  }
  return list.slice().sort(byDate);
}

function splitPurchaseAndRenewalEvents(events) {
  const purchases = (Array.isArray(events) ? events : [])
    .filter((event) => event.event_type === "purchase")
    .sort((a, b) => (Date.parse(a.event_date || "") || 0) - (Date.parse(b.event_date || "") || 0));
  const purchase = purchases[0] || null;
  const laterPurchases = purchases.slice(1).filter(
    (event) =>
      !isDuplicateInitialPurchase(purchase?.event_date, purchase?.amount_usd, event.event_date, event.amount_usd),
  );
  const renewals = (Array.isArray(events) ? events : []).filter((event) => event.event_type === "renewal");
  const seenOrders = new Set();
  const transfers = (Array.isArray(events) ? events : []).filter((event) => {
    if (event.event_type !== "transfer") return false;
    const subject = event.subject || "";
    const snippet = event.snippet || "";
    if (isDomainPush(subject, snippet) || isOutgoingTransferMail(subject, snippet)) return false;
    if (isTransferStatusMail(subject, snippet)) return false;
    if (!isIncomingTransferSpend(subject, snippet)) return false;
    const usd = Number(event.amount_usd);
    if (!Number.isFinite(usd) || usd <= 0) return false;
    const orderId = extractRegistrarOrderId(subject, snippet);
    if (orderId) {
      if (seenOrders.has(orderId)) return false;
      seenOrders.add(orderId);
    }
    return true;
  });
  const renewalEvents = [...laterPurchases, ...renewals, ...transfers].sort((a, b) =>
    String(a.event_date || "").localeCompare(String(b.event_date || "")),
  );
  return { purchase, renewals: renewalEvents };
}

// Ensure data directory exists when using nested paths in future.
if (!existsSync(process.cwd())) {
  mkdirSync(process.cwd(), { recursive: true });
}
