export function buildUnstoppableGmailQuery(rawFilters = "") {
  const value = String(rawFilters || "").trim();
  const unstoppableSender = "from:notifications@unstoppabledomains.com";

  if (!value) {
    return [
      unstoppableSender,
      "(",
      '"Unstoppable Domains Receipt"',
      'OR "Thank you for your purchase"',
      'OR "Products Purchased"',
      'OR "DNS Domain"',
      'OR receipt',
      ")",
      "newer_than:10y",
    ].join(" ");
  }

  if (looksLikeRawGmailQuery(value)) {
    return value;
  }

  const senders = value
    .split(/[\n,]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (/@/.test(x) ? `from:${x}` : `from:${x}`));

  if (!senders.some((sender) => /unstoppabledomains\.com/i.test(sender))) {
    senders.unshift(unstoppableSender);
  }

  return [
    "(",
    '"Unstoppable Domains Receipt"',
    'OR "Thank you for your purchase"',
    'OR "Products Purchased"',
    'OR "DNS Domain"',
    ")",
    `(${senders.join(" OR ")})`,
    "newer_than:10y",
  ]
    .filter(Boolean)
    .join(" ");
}

export function extractUnstoppableMoney(text) {
  const body = normalizeBody(text);
  if (!body) {
    return { amount: "", currency: "" };
  }

  const total = matchAmountByLabel(body, ["total"]);
  if (total) return total;

  const orderAmount = matchAmountByLabel(body, ["order amount", "purchase amount"]);
  if (orderAmount) return orderAmount;

  const productBlock = extractProductBlock(body);
  const productPrice = extractProductPrice(productBlock || body);
  if (productPrice) return productPrice;

  const lastCurrency = extractLastCurrencyValue(body);
  if (lastCurrency) return lastCurrency;

  return { amount: "", currency: "" };
}

function looksLikeRawGmailQuery(value) {
  return /from:|subject:|label:|category:|after:|before:|newer_than:|older_than:|\(|\)|"/i.test(value);
}

function normalizeBody(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractProductBlock(body) {
  const lines = body.split("\n");
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

function extractProductPrice(text) {
  const lines = String(text || "").split("\n");
  const candidateLines = lines.filter((line) => /dns\s+domain|products\s+purchased|domain\s+renewal|transfer|registration/i.test(line));
  const searchSpace = candidateLines.length ? candidateLines.join("\n") : String(text || "");

  const lineAmounts = [...searchSpace.matchAll(/(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]{2})?)/gi)];
  if (!lineAmounts.length) return null;

  return {
    amount: lineAmounts[lineAmounts.length - 1][1],
    currency: "$",
  };
}

function matchAmountByLabel(text, labels) {
  for (const label of labels) {
    const regex = new RegExp(
      String.raw`${escapeRegExp(label)}\s*:?\s*(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]{2})?)`,
      "i",
    );
    const match = text.match(regex);
    if (match?.[1]) {
      return { amount: match[1], currency: "$" };
    }
  }
  return null;
}

function extractLastCurrencyValue(text) {
  const matches = [...String(text || "").matchAll(/(?:USD|US\$|\$)\s*([0-9]+(?:\.[0-9]{2})?)/gi)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  return { amount: last[1], currency: "$" };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
