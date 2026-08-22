/**
 * Critical reminders + Gmail label ideas from RND PDF.
 * Rule-based only (no LLMs).
 */

import { listMailboxes } from "../data/mailboxes.js";

const CRITICAL_EXPIRY_DAYS = 30;

/**
 * @param {object} portfolio — buildGmailFirstPortfolio result
 */
export function buildCriticalReminders(portfolio = {}) {
  const items = [];
  const views = portfolio.views || {};
  const mailboxKeys = Object.keys(views).filter(
    (key) => !["sold", "expired", "expenses", "removed"].includes(key),
  );
  const removedSeen = new Set();

  for (const key of mailboxKeys) {
    const rows = Array.isArray(views[key]) ? views[key] : [];
    for (const row of rows) {
      const days = Number.isFinite(Number(row.daysRemaining))
        ? Number(row.daysRemaining)
        : daysUntil(row.expiry);
      if (Number.isFinite(days) && days >= 0 && days <= CRITICAL_EXPIRY_DAYS) {
        items.push({
          type: "expiry_soon",
          severity: days <= 7 ? "high" : "medium",
          domain: row.name,
          mailbox: row.mailbox || key,
          message: `${row.name} expires in ${days} day${days === 1 ? "" : "s"}`,
          expiry: row.expiry || "",
        });
      }
      if (row.recentlyRemoved) {
        pushRecentRemoval(items, removedSeen, {
          domain: row.name,
          mailbox: row.mailbox || key,
          removedAt: row.removedAt || row.saleDate || "",
          message: `${row.name} removed in the last 30 days`,
          source: "mailbox-view",
        });
      }
    }
  }

  for (const row of portfolio.removedDomains || views.removed || []) {
    pushRecentRemoval(items, removedSeen, {
      domain: row.name,
      mailbox: row.mailbox || "",
      removedAt: row.removedAt || "",
      message: `${row.name} removed in the last 30 days`,
      source: "removed-domains",
    });
  }

  for (const row of portfolio.expiredDomains || views.expired || []) {
    const removedAt = row.removedAt || "";
    const days = daysSince(removedAt);
    if (!Number.isFinite(days) || days > RECENT_REMOVED_DAYS) continue;
    pushRecentRemoval(items, removedSeen, {
      domain: row.name,
      mailbox: row.mailbox || "",
      removedAt,
      message: `${row.name} removed in the last 30 days`,
      source: "expired-domains",
    });
  }

  for (const row of portfolio.soldDomains || views.sold || []) {
    const saleTs = Date.parse(row.saleDate || "");
    if (Number.isFinite(saleTs) && Date.now() - saleTs < 14 * 86400000) {
      items.push({
        type: "recent_sale",
        severity: "low",
        domain: row.name,
        mailbox: row.mailbox || "",
        message: `${row.name} sold recently (${String(row.saleDate).slice(0, 10)})`,
      });
    }
  }

  items.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  return {
    generatedAt: new Date().toISOString(),
    count: items.length,
    items: items.slice(0, 50),
    labelIdeas: buildLabelFilterIdeas(),
    mailboxes: listMailboxes().map((item) => item.email),
  };
}

function pushRecentRemoval(items, seen, item) {
  const domain = String(item?.domain || "").trim().toLowerCase();
  const removedAt = String(item?.removedAt || "").trim();
  if (!domain) return;
  const key = `${domain}|${removedAt || item?.source || ""}`;
  if (seen.has(key)) return;
  const days = daysSince(removedAt);
  if (Number.isFinite(days) && (days < 0 || days > RECENT_REMOVED_DAYS)) return;
  seen.add(key);
  items.push({
    type: "recently_removed",
    severity: days <= 7 ? "high" : "medium",
    domain: item.domain,
    mailbox: item.mailbox || "",
    message: item.message || `${item.domain} removed in the last 30 days`,
    removedAt,
  });
}

export function buildLabelFilterIdeas() {
  return [
    {
      label: "DOMAIN SALE",
      query:
        '(subject:SOLD OR subject:"has sold" OR subject:"funds are on the way" OR subject:"Marketplace Sale" OR subject:"Counter offer accepted" OR subject:"Transaction closed" OR from:ta@afternic.com OR from:support@dan.com OR from:contact@sedo.com OR from:no-reply@masterbucks.com)',
      color: "green",
      note: "PDF: sale mail — prefer subject/from patterns over Gmail’s auto labels",
    },
    {
      label: "Expired",
      query:
        '(subject:expires OR subject:expired OR subject:"renewal notice" OR subject:"Action Required: Please Renew" OR subject:"Domains just expired" OR subject:"removed from account") -subject:"Order Finished" -subject:SOLD',
      color: "red",
      note: "PDF: expiry/removal reminders — do not treat as spend",
    },
    {
      label: "Domain Receipts",
      query:
        '(subject:"Order Finished" OR subject:"Thank you for your order" OR subject:"Sav.com Receipt" OR subject:"Order - Thank You" OR "Final cost" OR "Order Total")',
      color: "blue",
      note: "Paid purchase/renewal receipts only (skip Order Received)",
    },
    {
      label: "Ignore Afternic noise",
      query: '(subject:"Afternic Confirmation Needed" OR subject:"link for" subject:expired from:afternic OR subject:"Unable to submit auto-renew")',
      color: "gray",
      note: "PDF ignore list — archive/skip these",
    },
  ];
}

function severityRank(value) {
  if (value === "high") return 0;
  if (value === "medium") return 1;
  return 2;
}

function daysUntil(expiry) {
  const ts = Date.parse(expiry || "");
  if (!Number.isFinite(ts)) return NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  return Math.round((day - today) / 86400000);
}

function daysSince(value) {
  const ts = Date.parse(value || "");
  if (!Number.isFinite(ts)) return NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  return Math.round((today - day) / 86400000);
}
