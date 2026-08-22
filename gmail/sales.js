/**
 * Domain sale / marketplace receipt rules (no LLMs).
 * Screenshots in Prompts for RND.pdf: Dynadot SOLD, Afternic Fast Transfer + funds,
 * Dan.com counter/buy-now/closed, Epik sold, Namecheap Marketplace, Sedo congratulations,
 * Masterbucks payout. Gross (sold for) = higher; net = after commission / funds received.
 */

export const SALE_SUBJECT =
  /(?:^|\s)[a-z0-9.-]+\.[a-z]{2,}\s+SOLD\b|has sold via fast transfer|has sold at afternic|congratulations on the sale|sold at epik|marketplace sale confirmation|masterbucks payment|your funds are on the way|we have just sent you a payment|counter[- ]?offer (?:was )?accepted|transaction closed|^buy now\s*-/i;

export const SALE_SENDERS =
  /dynadot\.com|afternic\.com|dan\.com|sedo\.com|epik\.com|masterbucks\.com|namecheap\.com|godaddy\.com/i;

export const SALE_NOISE =
  /fast transfer listing|approve domain listing|selling link|afternic confirmation needed|activate afternic premium|whois info for|your link for .+ has expired|listing (?:has )?expired|opt[- ]?in|premium promotion|available for purchase at snapnames|unreported(?:sales)?|weekly unreported|waiting to transfer|transfer of domain name sold|auth(?:orization)? code ready|thank you for contacting afternic support|commission rate for your domain|^afternic\s*-\s*\d+/i;

export const FUNDS_RECEIVED =
  /funds are on the way|we have just sent you a payment|payment (?:has been )?sent|transaction closed|masterbucks payment|amount (?:has been )?deposited|payout of|scheduled your payout|you(?:'ve| have) (?:been )?paid|net proceeds|amount received|your proceeds|earned amount|your earned amount|proceeds credited|will be credited|has been credited to your dynadot/i;

const SALE_DOMAIN_NOISE =
  /^(?:gmail|google|googleapis|afternic|godaddy|dynadot|namesilo|namecheap|sedo|epik|masterbucks|dan\.com|unreportedsales|mailmc|example|domain)\b/i;

export function isFundsReceivedMail(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  return FUNDS_RECEIVED.test(hay);
}

export function buildSaleGmailQuery() {
  return `newer_than:10y (
    (from:dynadot.com (subject:SOLD OR subject:"Proceeds Credited"))
    OR (from:afternic.com (subject:"has sold" OR subject:"funds are on the way" OR subject:"just sent you a payment"))
    OR (from:godaddy.com (subject:"has sold" OR subject:"sold at Afternic"))
    OR (from:epik.com subject:"sold at Epik")
    OR (from:masterbucks.com subject:"Masterbucks payment")
    OR (from:namecheap.com subject:"Marketplace Sale Confirmation")
    OR (from:sedo.com subject:"Congratulations on the sale")
    OR (from:dan.com (subject:"Transaction closed" OR subject:"Counter offer accepted" OR subject:"Buy now" OR subject:"Payment received" OR subject:"just sent you a payment"))
  )`;
}

/**
 * @returns {'sale'|null}
 */
export function classifySaleMail(subject, text, fromAddress = "") {
  const subjectText = String(subject || "");
  const hay = `${subjectText}\n${text || ""}`;
  const from = String(fromAddress || "");
  if (SALE_NOISE.test(subjectText) || SALE_NOISE.test(hay)) return null;
  if (/service@afternic\.com/i.test(from)) return null;
  if (!SALE_SENDERS.test(from)) return null;
  if (SALE_SUBJECT.test(subjectText)) return "sale";
  if (/proceeds credited/i.test(subjectText) && /dynadot/i.test(from)) return "sale";
  if (FUNDS_RECEIVED.test(subjectText)) return "sale";
  if (/dan\.com/i.test(from) && /transaction closed|buy now|counter[- ]?offer accepted|payment received/i.test(subjectText)) {
    return "sale";
  }
  return null;
}

export function extractSaleDomainNames(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  const found = [];
  const seen = new Set();
  const patterns = [
    /(?:^|\s)([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s+SOLD\b/gi,
    /congrats,\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s+has sold/gi,
    /([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s+has sold at afternic/gi,
    /congratulations!\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\s+sold at/gi,
    /domain name\s*[:=]\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /(?:transaction closed|buy now|payment received|counter[- ]?offer accepted)\s*[-–:]\s*([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /funds are on the way(?:\s+for)?\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /congratulations on (?:the sale of )?your domain\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /your domain,?\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /(?:the )?sale of\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /has just been sold[^.]*\b([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /payout of[^.]*\b([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
    /domain name\s+([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of hay.matchAll(pattern)) {
      if (match?.[1]) addSaleDomain(found, seen, match[1]);
    }
  }
  const subjectHits = String(subject || "").match(/\b([a-z0-9][a-z0-9.-]*\.[a-z]{2,})\b/gi) || [];
  for (const name of subjectHits) addSaleDomain(found, seen, name);
  if (!found.length) {
    const bodyHits = String(text || "")
      .slice(0, 2500)
      .match(/\b([a-z0-9][a-z0-9-]{1,61}\.[a-z]{2,24})\b/gi) || [];
    for (const name of bodyHits) {
      addSaleDomain(found, seen, name);
      if (found.length >= 3) break;
    }
  }
  return found;
}

function addSaleDomain(found, seen, raw) {
  const key = String(raw || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.+$/, "")
    .trim();
  if (!key || seen.has(key)) return;
  if (SALE_DOMAIN_NOISE.test(key)) return;
  if (key.split(".").length > 3) return;
  seen.add(key);
  found.push(key);
}

/**
 * Extract gross (list/sold-for) and net (after commission) from sale mail.
 * PDF: higher amount = sold for; lower / funds / earned = after commission.
 */
export function extractSaleMoney(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;

  const masterbucks = extractMasterbucksMoney(hay);
  if (masterbucks) return masterbucks;

  const dynadotCredit = extractDynadotSaleCredit(subject, text);
  if (dynadotCredit != null) {
    return {
      gross: inferDynadotMarketplaceGross(dynadotCredit),
      net: dynadotCredit,
      currency: "USD",
      fundsMail: true,
    };
  }

  const fundsMail = isFundsReceivedMail(subject, text);

  const labeledGross =
    matchLabeled(hay, [
      "sold for",
      "at the price of",
      "a price of",
      "price of",
      "fixed price of",
      "counter offer of",
      "sale price",
      "purchase price",
      "buyer paid",
      "listing price",
      "selling price",
      "gross",
      "external domain purchase",
    ]) || matchSoldForAmount(hay);
  const labeledNet = matchLabeled(hay, [
    "earned amount",
    "your earned amount",
    "you have earned",
    "you earned",
    "payout of",
    "scheduled your payout",
    "you will receive",
    "you received",
    "net proceeds",
    "amount received",
    "your proceeds",
    "after commission",
    "payment amount",
    "payment sent",
    "credited",
    "will be credited",
  ]);

  if (fundsMail && labeledNet && !labeledGross) {
    return {
      gross: null,
      net: Number(labeledNet.value.toFixed(2)),
      currency: labeledNet.currency || "USD",
      fundsMail: true,
    };
  }

  const amounts = collectMoneyAmounts(hay);
  let gross = labeledGross ? labeledGross.value : null;
  let net = labeledNet ? labeledNet.value : null;
  const currency = labeledNet?.currency || labeledGross?.currency || amounts[0]?.currency || "USD";

  if (gross === null && net === null && amounts.length >= 2) {
    const values = amounts.map((a) => a.value).sort((a, b) => b - a);
    gross = values[0];
    net = values[values.length - 1];
  } else if (gross === null && net === null && amounts.length === 1) {
    if (fundsMail) net = amounts[0].value;
    else gross = amounts[0].value;
  } else {
    if (gross === null && amounts.length) gross = Math.max(...amounts.map((a) => a.value));
    if (net === null && amounts.length) {
      const candidates = amounts.map((a) => a.value).filter((v) => gross === null || v < gross);
      net = candidates.length ? Math.min(...candidates) : null;
    }
  }

  if (gross != null && net != null && net > gross) {
    const tmp = gross;
    gross = net;
    net = tmp;
  }

  return {
    gross: gross != null ? Number(gross.toFixed(2)) : null,
    net: net != null ? Number(net.toFixed(2)) : null,
    currency,
    fundsMail,
  };
}

export function extractDynadotSaleCredit(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  if (!/(?:\bSOLD\b\s*\(account|proceeds credited|credited to your dynadot|will be credited)/i.test(hay)) {
    return null;
  }
  const match =
    hay.match(/will be credited\s+\$?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i) ||
    hay.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)\s*USD has been credited/i) ||
    hay.match(/has been credited\s+\$?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i);
  if (!match?.[1]) return null;
  const net = Number(String(match[1]).replace(/,/g, ""));
  return Number.isFinite(net) && net > 0 ? net : null;
}

/** Dynadot marketplace seller fee is 5% or 10%; credited amount is net. Prefer a round-dollar BIN. */
export function inferDynadotMarketplaceGross(net) {
  const value = Number(net);
  if (!Number.isFinite(value) || value <= 0) return null;
  for (const fee of [0.05, 0.1, 0.15]) {
    const gross = value / (1 - fee);
    const nearestDollar = Math.round(gross);
    if (Math.abs(gross - nearestDollar) <= 0.03) return nearestDollar;
    const nearest99 = Math.round(gross) - 0.01;
    if (nearest99 > 0 && Math.abs(gross - nearest99) <= 0.03) return Number(nearest99.toFixed(2));
  }
  return Number((value / 0.95).toFixed(2));
}

export function isPlausibleSaleGross(gross, net) {
  const g = Number(gross);
  const n = Number(net);
  if (!Number.isFinite(g) || !Number.isFinite(n) || g <= 0 || n <= 0) return false;
  if (g + 0.009 < n) return false;
  if (Math.abs(g - n) < 0.02) return false;
  const fee = (g - n) / g;
  return fee >= 0.02 && fee <= 0.4;
}

export function extractSellingPrice(text) {
  const match = String(text || "").match(
    /selling price\s*:\s*\$?\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/i,
  );
  if (!match?.[1]) return null;
  const value = Number(String(match[1]).replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function matchSoldForAmount(hay) {
  const match = String(hay || "").match(
    /sold(?:\s+via[\s\S]{0,80})?\s+for\s*(?:USD|US\$|\$)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  if (!match?.[1]) return null;
  const value = Number(String(match[1]).replace(/,/g, ""));
  return Number.isFinite(value) ? { value, currency: "USD" } : null;
}

function extractMasterbucksMoney(hay) {
  if (!/masterbucks/i.test(hay)) return null;
  const purchase = hay.match(
    /(?:external domain purchase|purchase|sale(?:\s+price)?)\s*[:=]?\s*(?:USD|US\$|\$)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  const commission = hay.match(/commission\s*[:=]?\s*(?:USD|US\$|\$)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
  const credit = hay.match(
    /(?:credited|credit|net|balance|you (?:will )?receive)\s*[:=]?\s*(?:USD|US\$|\$)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i,
  );
  const gross = purchase ? Number(String(purchase[1]).replace(/,/g, "")) : null;
  let net = credit ? Number(String(credit[1]).replace(/,/g, "")) : null;
  if (gross != null && commission && net == null) {
    const fee = Number(String(commission[1]).replace(/,/g, ""));
    if (Number.isFinite(fee)) net = Number((gross - fee).toFixed(2));
  }
  if (gross == null && net == null) return null;
  return {
    gross: Number.isFinite(gross) ? gross : null,
    net: Number.isFinite(net) ? net : null,
    currency: "USD",
    fundsMail: true,
  };
}

export function guessSalePlatform(subject, text, fromAddress = "") {
  const hay = `${subject || ""}\n${text || ""}\n${fromAddress || ""}`.toLowerCase();
  if (hay.includes("afternic")) return "Afternic";
  if (hay.includes("sedo")) return "Sedo";
  if (hay.includes("dan.com") || hay.includes("@dan.com")) return "Dan.com";
  if (hay.includes("epik")) return "Epik";
  if (hay.includes("masterbucks")) return "Masterbucks";
  if (hay.includes("namecheap")) return "Namecheap";
  if (hay.includes("dynadot")) return "Dynadot";
  if (hay.includes("namesilo")) return "NameSilo";
  if (hay.includes("godaddy") || hay.includes("auctions.godaddy")) return "GoDaddy";
  if (hay.includes("sav.com")) return "Sav";
  if (hay.includes("spaceship")) return "Spaceship";
  if (hay.includes("dropcatch")) return "DropCatch";
  return "";
}

function collectMoneyAmounts(text) {
  const out = [];
  const re =
    /(?:USD|US\$|\$|INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:USD|US\$)/gi;
  for (const match of String(text || "").matchAll(re)) {
    const raw = match[1] || match[2];
    const value = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) continue;
    const currency = /INR|Rs\.?|₹/i.test(match[0]) ? "INR" : "USD";
    out.push({ value, currency, raw });
  }
  return out;
}

function matchLabeled(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      `${escapeRegExp(label)}\\s*[:\\-]?\\s*(?:(?:USD|US\\$|\\$|INR|Rs\\.?|₹)\\s*)?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)(?:\\s*(?:USD|US\\$|dollars?))?`,
      "i",
    );
    const match = String(text).match(pattern);
    if (match?.[1]) {
      const value = Number(String(match[1]).replace(/,/g, ""));
      if (!Number.isFinite(value)) continue;
      const currency = /INR|Rs\.?|₹/i.test(match[0]) ? "INR" : "USD";
      return { value, currency };
    }
  }
  return null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
