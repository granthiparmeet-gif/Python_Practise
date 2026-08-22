import { isAuctionAcquisitionMail } from "../rules.js";

/** Registrar receipt parsers — prefer order total (post tax/discount), then allocate by line. */
export function normalizeDomainKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.+$/, "");
}

const RECEIPT_DOMAIN_NOISE =
  /^(?:www\.)?(?:gmail|google|googleapis|youtube|facebook|twitter|linkedin|instagram|godaddy|dynadot|namesilo|namsilo|namecheap|namepros|namelot|namepal|sav\.com|spaceship|unstoppable|afternic|hostinger|cloudflare|paypal|razorpay|amazon|adobe|apple|microsoft|porkbun|dropcatch|surveymonkey|trustpilot|techcrunch|weibo|play\.google|itunes\.apple|register\.com|hosting-service|domainjungle|gatekeeperdomains|flancrestdomains|snov\.io)\b/i;

export function cleanParsedDomain(value) {
  let name = normalizeDomainKey(value).replace(/^www\./, "");
  if (/domain$/i.test(name)) {
    const stem = name.replace(/domain$/i, "");
    if (stem.includes(".")) name = stem;
  }
  if (!name || !name.includes(".")) return "";
  if (/^\d+$/.test(name.split(".")[0] || "")) return "";
  if (name === "name.com") return "";
  if (name.includes("techcrunch.com")) return "";
  if (name === "completed.you") return "";
  if (name.split(".").length > 3) return "";
  if (RECEIPT_DOMAIN_NOISE.test(name)) return "";
  if (/\.(aspx|html|php|js|png|jpg)$/i.test(name)) return "";
  return name;
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeReceiptText(text) {
  return String(text || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * @returns {{ amount: string, currency: string, source: string, lineType: string }}
 */
export function extractDomainOrderMoney(text, domainName) {
  const body = normalizeReceiptText(text);
  const name = normalizeDomainKey(domainName);
  if (!body || !name) return emptyMoney();

  const orderTotal = extractOrderTotal(body);
  const lineItems = parseReceiptLineItems(body);
  const mine = lineItems.filter((item) => item.domain === name);
  const domains = uniqueDomains(lineItems);
  const lineType = mergedLineType(mine);

  const onlyThisDomain = domains.length === 0 || (domains.length === 1 && domains[0] === name);
  const loneInvoice = onlyThisDomain && domainAppears(body, name) && countOtherDomains(body, name) === 0;

  // Single-domain order → always use post-tax order total when present.
  if (orderTotal.amount && loneInvoice) {
    return {
      ...orderTotal,
      source: "order-total",
      lineType,
    };
  }

  // Multi-domain with priced lines → allocate order total by line share (includes tax/discount).
  if (orderTotal.amount && mine.length && lineItems.every((item) => item.amountValue !== null)) {
    const lineSum = lineItems.reduce((sum, item) => sum + item.amountValue, 0);
    const mySum = mine.reduce((sum, item) => sum + item.amountValue, 0);
    if (lineSum > 0 && mySum > 0) {
      const totalValue = parseAmount(orderTotal.amount);
      if (totalValue !== null) {
        return {
          amount: ((totalValue * mySum) / lineSum).toFixed(2),
          currency: orderTotal.currency,
          source: "order-total-allocated",
          lineType,
        };
      }
    }
  }

  // Multi-domain, no usable line prices → equal split of order total.
  if (orderTotal.amount && domains.includes(name) && domains.length > 1) {
    const totalValue = parseAmount(orderTotal.amount);
    if (totalValue !== null) {
      return {
        amount: (totalValue / domains.length).toFixed(2),
        currency: orderTotal.currency,
        source: "order-total-split",
        lineType,
      };
    }
  }

  // Fallback: sum this domain's line prices (auction + first-year renewal on one checkout).
  const mySum = mine.reduce((sum, item) => sum + (item.amountValue || 0), 0);
  if (mySum > 0) {
    return {
      amount: mySum.toFixed(2),
      currency: mine.find((item) => item.currency)?.currency || "USD",
      source: "line-item",
      lineType,
    };
  }

  // Never assign a multi-name invoice total to one domain.
  if (orderTotal.amount && domainAppears(body, name) && countOtherDomains(body, name) === 0) {
    return { ...orderTotal, source: "order-total", lineType: "" };
  }

  return emptyMoney();
}

/**
 * Classify this domain's line in the receipt (registration / renewal / transfer / auction).
 */
export function classifyDomainLineType(text, domainName, subject = "") {
  const body = normalizeReceiptText(text);
  const name = normalizeDomainKey(domainName);
  const items = parseReceiptLineItems(body);
  const mine = items.filter((item) => item.domain === name);
  if (mine.length) {
    const merged = mergedLineType(mine);
    if (merged) return merged;
  }

  const haystack = `${subject}\n${body}`.toLowerCase();
  const domainWindow = extractDomainWindow(body, name);

  if (isAuctionAcquisitionMail(subject, body, domainWindow)) {
    return "auction";
  }

  if (
    /domain won|auction won|won the auction|you(?:'ve| have) won|backorder won|premium auction|winning bid for|result:\s*registered/i.test(haystack) ||
    /domain won|auction won|won the auction|winning bid|result:\s*registered/i.test(domainWindow)
  ) {
    return "auction";
  }

  if (/\bregistration\b|\bregistered\b|dns domain|new registration|1\s*year(?:s)?\s+registration|\d+\s*year(?:s)?\s+registration/i.test(domainWindow)) {
    return "registration";
  }
  // "Auto-renew on" alone is a setting on a registration receipt — not a renewal event.
  if (/\brenewal\b|\brenewed\b/i.test(domainWindow) && !/auto-renew\s+on/i.test(domainWindow)) {
    return "renewal";
  }
  if (/auto[-\s]?renew/i.test(domainWindow) && !/\bregistration\b/i.test(domainWindow)) {
    return "renewal";
  }
  if (/\btransfer\b/i.test(domainWindow)) {
    return "transfer";
  }
  return "";
}

export function parseReceiptLineItems(text) {
  const body = normalizeReceiptText(text);
  if (!body) return [];

  const namesilo = parseNameSiloLineItems(body);
  if (namesilo.length) return namesilo;

  const spaceship = parseSpaceshipLineItems(body);
  if (spaceship.length) return spaceship;

  const namecom = parseNameComLineItems(body);
  if (namecom.length) return namecom;

  const sav = parseSavLineItems(body);
  if (sav.length) return sav;

  const namecheap = parseNamecheapLineItems(body);
  if (namecheap.length) return namecheap;

  const dynadot = parseDynadotStyleLineItems(body);
  if (dynadot.length) return dynadot;

  const unstoppable = parseUnstoppableStyleLineItems(body);
  if (unstoppable.length) return unstoppable;

  return parseGenericDomainLines(body);
}

export function extractReceiptDomainNames(subject, text) {
  const found = [];
  const seen = new Set();
  const add = (raw) => {
    const name = cleanParsedDomain(raw);
    if (!name || seen.has(name)) return;
    seen.add(name);
    found.push(name);
  };
  for (const item of parseReceiptLineItems(text)) add(item.domain);
  for (const match of String(subject || "").matchAll(/\b([a-z0-9][a-z0-9.-]*\.[a-z]{2,24})\b/gi)) {
    add(match[1]);
  }
  return found;
}

export function buildPaidReceiptGmailQuery() {
  return `newer_than:10y (
    subject:"Order Finished"
    OR subject:"you have acquired"
    OR subject:"Thank you for your order"
    OR subject:"Thank you for your purchase"
    OR subject:"Order Summary"
    OR subject:"Namecheap Order Summary"
    OR subject:"Sav.com Receipt"
    OR subject:"NameSilo.com Receipt"
    OR subject:"You Won"
    OR subject:"Winning Bid"
    OR subject:"Backorder Submission Results"
    OR subject:"Auction payment received"
    OR subject:"Spaceship order"
    OR subject:"porkbun.com | Order"
    OR subject:"DropCatch.com Order Receipt"
    OR subject:"Unstoppable Domains Receipt"
    OR subject:"New Cosmotown Order Receipt"
    OR subject:"Cosmotown Order"
  )`;
}

function parseNameSiloLineItems(body) {
  // NameSilo table often arrives as:
  // tigerinsure.com
  // Registration
  // 1
  // $8.85
  // $8.85
  // Auction checkouts add DomainAuction then Renewal under the same name — both are the buy.
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const items = [];
  const domainRe = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;
  const typeRe =
    /^(registration|renewal|transfer|whois|privacy|email|hosting)\b|domainauction|\bauction\b/i;

  for (let i = 0; i < lines.length; i += 1) {
    if (!domainRe.test(lines[i])) continue;
    if (/namesilo\.com|facebook\.com|twitter\.com/i.test(lines[i])) continue;

    const domain = normalizeDomainKey(lines[i]);
    const lookAhead = lines.slice(i + 1, i + 16);
    let currentType = "";
    let amounts = [];

    const flush = () => {
      if (!currentType) return;
      const picked = amounts.length >= 2 ? amounts[amounts.length - 1] : amounts[0];
      items.push({
        domain,
        lineType: normalizeLineType(currentType),
        amount: picked?.amount || "",
        currency: picked?.currency || "USD",
        amountValue: picked ? parseAmount(picked.amount) : null,
        registrar: "NameSilo",
      });
      amounts = [];
    };

    for (const line of lookAhead) {
      if (domainRe.test(line) && normalizeDomainKey(line) !== domain) break;
      if (/^(tax info|order total|billing details|payment method|subtotal|type|yrs\/qty|price)\b/i.test(line)) {
        break;
      }
      if (typeRe.test(line)) {
        flush();
        currentType = line;
        continue;
      }
      const money = matchMoneyToken(line);
      if (money) amounts.push(money);
    }
    flush();
  }

  return items;
}

function parseSpaceshipLineItems(body) {
  // twinguru.com <> regular $2.90 1 year registration, Auto-renew on
  if (!/spaceship|your items|final cost|auto-renew on/i.test(body)) return [];

  const items = [];
  const re =
    /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b\s*<>?\s*(?:regular|premium)?\s*((?:USD|US\$|\$|INR|Rs\.?|₹)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?)?\s*(\d+)\s*year(?:s)?\s+(registration|renewal)/gi;

  for (const match of body.matchAll(re)) {
    const domain = normalizeDomainKey(match[1]);
    if (/spaceship\.com|facebook|twitter|surveymonkey/i.test(domain)) continue;
    const money = matchMoneyToken(match[2] || "") || extractParenOrInlineMoney(match[0]);
    const lineType = normalizeLineType(match[4] || "registration");
    items.push({
      domain,
      lineType,
      amount: money.amount || "",
      currency: money.currency || "USD",
      amountValue: money.amount ? parseAmount(money.amount) : null,
      registrar: "Spaceship",
    });
  }

  // Compact fallback without <> marker.
  if (!items.length) {
    const loose =
      /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b[^.\n]{0,80}?(\d+)\s*year(?:s)?\s+(registration|renewal)/gi;
    for (const match of body.matchAll(loose)) {
      const domain = normalizeDomainKey(match[1]);
      if (/spaceship\.com|facebook|twitter/i.test(domain)) continue;
      const around = extractDomainWindow(body, domain);
      const money = extractParenOrInlineMoney(around);
      items.push({
        domain,
        lineType: normalizeLineType(match[3]),
        amount: money.amount || "",
        currency: money.currency || "USD",
        amountValue: money.amount ? parseAmount(money.amount) : null,
        registrar: "Spaceship",
      });
    }
  }

  return dedupeItems(items);
}

function parseNameComLineItems(body) {
  // towingdubai.com
  // Expiring Domain
  // 1 year(s)
  // ₹1,588.95
  // Order Total: ₹1,588.95
  if (!/name\.com/i.test(body) && !/expiring domain|order confirmation/i.test(body)) return [];

  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const items = [];
  const domainRe = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

  for (let i = 0; i < lines.length; i += 1) {
    if (!domainRe.test(lines[i])) continue;
    if (/name\.com|surveymonkey|titan|facebook|twitter/i.test(lines[i])) continue;

    const domain = normalizeDomainKey(lines[i]);
    const lookAhead = lines.slice(i + 1, i + 8);
    const typeLine = lookAhead.find((line) =>
      /^(expiring domain|registration|renewal|transfer|domain)\b/i.test(line),
    );
    const amounts = [];
    for (const line of lookAhead) {
      if (domainRe.test(line) && normalizeDomainKey(line) !== domain) break;
      if (/^(order total|order summary|payment method|ready to use|duration|price|status)\b/i.test(line)) {
        if (/^order total\b/i.test(line)) {
          const money = matchMoneyToken(line);
          if (money) amounts.push(money);
        }
        break;
      }
      const money = matchMoneyToken(line);
      if (money) amounts.push(money);
    }

    const picked = amounts[0];
    items.push({
      domain,
      lineType: normalizeLineType(typeLine || "registration"),
      amount: picked?.amount || "",
      currency: picked?.currency || "USD",
      amountValue: picked ? parseAmount(picked.amount) : null,
      registrar: "Name.com",
    });
  }

  return items;
}

function parseSavLineItems(body) {
  // Sav receipts: domain line + Registration/Renewal + amount; multi-domain orders share Paid total.
  if (!/sav\.com/i.test(body) && !/\bpaid on\b/i.test(body)) return [];

  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const items = [];
  const domainRe = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

  for (let i = 0; i < lines.length; i += 1) {
    if (!domainRe.test(lines[i])) continue;
    if (/sav\.com|facebook\.com|twitter\.com/i.test(lines[i])) continue;

    const domain = normalizeDomainKey(lines[i]);
    const lookAhead = lines.slice(i + 1, i + 8);
    const typeLine = lookAhead.find((line) =>
      /^(domain\s+)?(registration|renewal|transfer|auto[-\s]?renewal)\b|winning bid|domainauction|\bauction\b/i.test(line),
    );
    if (!typeLine && !lookAhead.some((line) => matchMoneyToken(line))) continue;

    const amounts = [];
    for (const line of lookAhead) {
      if (domainRe.test(line) && normalizeDomainKey(line) !== domain) break;
      if (/^(total|paid on|transaction id|payment method|order total|amount paid)\b/i.test(line)) {
        const money = matchMoneyToken(line);
        if (money) amounts.push(money);
        break;
      }
      const money = matchMoneyToken(line);
      if (money) amounts.push(money);
    }

    const picked = amounts[0];
    items.push({
      domain,
      lineType: normalizeLineType(typeLine || "registration"),
      amount: picked?.amount || "",
      currency: picked?.currency || "USD",
      amountValue: picked ? parseAmount(picked.amount) : null,
      registrar: "Sav",
    });
  }

  return dedupeItems(items);
}

function parseNamecheapLineItems(body) {
  if (!/namecheap|order summary|final cost|initial charge/i.test(body)) return [];
  const items = [];
  const re =
    /(?:premium\s+domain|domain\s+(?:registration|renewal|transfer)|registration|renewal)\s+((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\s*\[failed\])?[^$\n]{0,180}?\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/gi;
  for (const match of body.matchAll(re)) {
    const domain = cleanParsedDomain(match[1]);
    if (!domain) continue;
    if (/\[failed\]/i.test(match[0])) continue;
    items.push({
      domain,
      lineType: /renew/i.test(match[0]) ? "renewal" : "registration",
      amount: match[2],
      currency: "USD",
      amountValue: parseAmount(match[2]),
      registrar: "Namecheap",
    });
  }
  return dedupeItems(items);
}

export function hasOtherReceiptDomains(text, domainName) {
  return countOtherDomains(text, domainName) > 0;
}

function countOtherDomains(text, domainName) {
  const current = normalizeDomainKey(domainName);
  const found = new Set();
  for (const match of String(text || "").matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/gi)) {
    const name = cleanParsedDomain(match[1]);
    if (!name || name === current) continue;
    found.add(name);
    if (found.size >= 2) break;
  }
  return found.size;
}

function parseDynadotStyleLineItems(body) {
  // builddt.com - domain registration
  // 1 year ($7.88)$7.88
  // OR compact: builddt.com - Domain Renewal 1 year ($10.88)$10.88
  const items = [];
  const lines = body.split("\n");
  const domainLineRe =
    /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b\s*[-–]?\s*(domain\s+registration|domain\s+renewal|registration|renewal|transfer|dns\s+domain)?/i;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const match = line.match(domainLineRe);
    if (!match?.[1]) continue;
    if (/dynadot\.|ddot\.|facebook\.|twitter\./i.test(match[1])) continue;

    const domain = cleanParsedDomain(match[1]);
    if (!domain) continue;
    let lineType = normalizeLineType(match[2] || "");
    const chunk = [line, lines[i + 1] || "", lines[i + 2] || ""].join("\n");

    if (!lineType) {
      if (/registration|registered/i.test(chunk)) lineType = "registration";
      else if (/renewal|renewed|auto[-\s]?renew/i.test(chunk)) lineType = "renewal";
      else if (/transfer/i.test(chunk)) lineType = "transfer";
    }

    const money = extractParenOrInlineMoney(chunk);
    if (!lineType && !money.amount) continue;

    items.push({
      domain,
      lineType,
      amount: money.amount,
      currency: money.currency,
      amountValue: money.amount ? parseAmount(money.amount) : null,
      registrar: "Dynadot",
    });
  }

  return dedupeItems(items);
}

function parseUnstoppableStyleLineItems(body) {
  // DNS Domain: supaspy.com (1 year) — $10.67 $7.67
  const items = [];
  const re =
    /\b(dns\s+domain|domain\s+renewal|transfer|registration)\s*:\s*((?:[a-z0-9-]+\.)+[a-z]{2,})[^$\n]{0,80}?((?:USD|US\$|\$|INR|Rs\.?|₹)\s*[0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
  for (const match of body.matchAll(re)) {
    items.push({
      domain: normalizeDomainKey(match[2]),
      lineType: normalizeLineType(match[1]),
      amount: matchMoneyToken(match[3])?.amount || "",
      currency: matchMoneyToken(match[3])?.currency || "USD",
      amountValue: matchMoneyToken(match[3]) ? parseAmount(matchMoneyToken(match[3]).amount) : null,
      registrar: "Unstoppable",
    });
  }
  return dedupeItems(items);
}

function parseGenericDomainLines(body) {
  const items = [];
  const re = /\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b([^.\n]{0,100})/gi;
  for (const match of body.matchAll(re)) {
    const domain = cleanParsedDomain(match[1]);
    if (!domain) continue;
    const nearby = match[2] || "";
    const lineType = normalizeLineType(nearby);
    const money = extractParenOrInlineMoney(nearby);
    if (!lineType && !money.amount) continue;
    items.push({
      domain,
      lineType,
      amount: money.amount,
      currency: money.currency,
      amountValue: money.amount ? parseAmount(money.amount) : null,
      registrar: "",
    });
  }
  return dedupeItems(items);
}

export function extractOrderTotal(text) {
  const body = normalizeReceiptText(text);
  // Prefer post-tax/discount totals only — never SubTotal / Price.
  const labeled =
    matchLabeled(body, ["order total", "final cost", "total cost", "grand total", "payment amount", "amount paid"]) ||
    null;
  if (labeled) return labeled;

  // NameSilo / multiline: "Order Total" then next money line.
  const lines = body.split("\n").map((line) => line.trim());
  for (let i = 0; i < lines.length; i += 1) {
    if (/^(order total|final cost|total cost|grand total|payment amount|amount paid)\b/i.test(lines[i])) {
      for (let j = i; j < Math.min(lines.length, i + 4); j += 1) {
        const money = matchMoneyToken(lines[j]);
        if (money) return money;
      }
    }
  }
  return emptyMoney();
}

function extractParenOrInlineMoney(text) {
  const paren = String(text || "").match(
    /\((?:USD|US\$|\$|INR|Rs\.?|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:USD|US\$|\$|INR|Rs\.?|₹)?\)/i,
  );
  if (paren?.[1]) {
    const currency = /INR|Rs\.?|₹/i.test(paren[0]) ? "INR" : "USD";
    return { amount: paren[1], currency };
  }
  return matchMoneyToken(text) || emptyMoney();
}

function matchLabeled(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      `${escapeRegExp(label)}\\s*:?\\s*(?:(USD|US\\$|\\$)|(INR|Rs\\.?|₹))?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`,
      "i",
    );
    const match = String(text || "").match(pattern);
    if (match?.[3]) {
      return { amount: match[3].replace(/,/g, ""), currency: match[2] ? "INR" : "USD" };
    }
  }
  return null;
}

function matchMoneyToken(text) {
  const body = String(text || "");
  const patterns = [
    { currency: "INR", regex: /(?:INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i },
    { currency: "INR", regex: /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:INR|Rs\.?)/i },
    { currency: "USD", regex: /(?:USD|US\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i },
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern.regex);
    if (match?.[1]) return { amount: match[1].replace(/,/g, ""), currency: pattern.currency };
  }
  return null;
}

function normalizeLineType(value) {
  const text = String(value || "").toLowerCase();
  // Name.com "Expiring Domain" on an order confirmation = buying an expiring/closeout name (purchase).
  if (/expiring domain/.test(text)) return "auction";
  if (/auction|won/.test(text)) return "auction";
  if (/renew/.test(text)) return "renewal";
  if (/transfer/.test(text)) return "transfer";
  if (/registr|dns\s+domain/.test(text)) return "registration";
  return "";
}

function mergedLineType(items) {
  const types = (Array.isArray(items) ? items : []).map((item) => item?.lineType).filter(Boolean);
  if (types.includes("auction")) return "auction";
  if (types.includes("registration")) return "registration";
  if (types.includes("transfer")) return "transfer";
  if (types.includes("renewal")) return "renewal";
  return types[0] || "";
}

function uniqueDomains(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (!item?.domain || seen.has(item.domain)) continue;
    seen.add(item.domain);
    out.push(item.domain);
  }
  return out;
}

function dedupeItems(items) {
  const map = new Map();
  for (const item of items) {
    if (!item?.domain) continue;
    const prev = map.get(item.domain);
    if (!prev) {
      map.set(item.domain, { ...item });
      continue;
    }
    const mixedCheckout =
      prev.lineType &&
      item.lineType &&
      prev.lineType !== item.lineType &&
      (prev.lineType === "auction" ||
        prev.lineType === "registration" ||
        item.lineType === "auction" ||
        item.lineType === "registration");
    if (mixedCheckout) {
      const amountValue = Number(prev.amountValue || 0) + Number(item.amountValue || 0);
      map.set(item.domain, {
        ...prev,
        lineType: mergedLineType([prev, item]),
        amountValue: amountValue || prev.amountValue || item.amountValue,
        amount: amountValue > 0 ? amountValue.toFixed(2) : prev.amount || item.amount,
        currency: prev.currency || item.currency,
      });
      continue;
    }
    if ((!prev.amount && item.amount) || (!prev.lineType && item.lineType)) {
      map.set(item.domain, { ...item, lineType: mergedLineType([prev, item]) || item.lineType });
    }
  }
  return [...map.values()];
}

function extractDomainWindow(text, domainName) {
  const body = normalizeReceiptText(text);
  const name = normalizeDomainKey(domainName);
  const lines = body.split("\n");
  const pattern = new RegExp(`(^|[^a-z0-9-])${escapeRegExp(name)}(?=$|[^a-z0-9-])`, "i");
  for (let i = 0; i < lines.length; i += 1) {
    if (!pattern.test(lines[i])) continue;
    return lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 6)).join("\n");
  }
  return body;
}

function domainAppears(text, domainName) {
  const pattern = new RegExp(`(^|[^a-z0-9-])${escapeRegExp(domainName)}(?=$|[^a-z0-9-])`, "i");
  return pattern.test(text);
}

function parseAmount(value) {
  const numeric = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function emptyMoney() {
  return { amount: "", currency: "", source: "", lineType: "" };
}

export function eventTypeFromLineType(lineType) {
  if (lineType === "renewal") return "renewal";
  if (lineType === "transfer") return "transfer";
  if (lineType === "registration" || lineType === "auction") return "purchase";
  return "";
}
