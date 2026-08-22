/**
 * Non-domain "other expenses" related to the domain business (no LLMs).
 * Crunchbase, Twitter/X, Hostinger, LinkedIn, VPN, DotDB, NameBio, GoDaddy Premium, Gspace, etc.
 * Only completed payments count — promotional offers / newsletters are ignored.
 */

import { isPaidPurchaseMail, isPromotionalOfferMail } from "./rules.js";

export const EXPENSE_SENDERS = [
  "noreply@crunchbase.com",
  "billing@crunchbase.com",
  "receipts@crunchbase.com",
  "hello@crunchbase.com",
  "receipts@hostinger.com",
  "noreply@hostinger.com",
  "billing@hostinger.com",
  "invoice@hostinger.com",
  "no-reply@razorpay.com",
  "noreply@linkedin.com",
  "receipts@linkedin.com",
  "billing@linkedin.com",
  "messages-noreply@linkedin.com",
  "no-reply@mail.twitter.com",
  "receipt@twitter.com",
  "billing@x.com",
  "noreply@x.com",
  "info@x.com",
  "noreply@dotdb.com",
  "support@dotdb.com",
  "billing@dotdb.com",
  "service@intl.paypal.com",
  "service@paypal.com",
  "noreply@namebio.com",
  "support@namebio.com",
  "billing@namebio.com",
  "invoice+statements@namebio.com",
  "noreply@gspace.com",
  "billing@gspace.online",
  "support@gspace.online",
  "noreply@nordvpn.com",
  "billing@nordvpn.com",
  "noreply@expressvpn.com",
  "no-reply@info.surfshark.com",
  "support@godaddy.com",
  "noreply@godaddy.com",
  "donotreply@godaddy.com",
  "receipts@godaddy.com",
];

export const EXPENSE_VENDOR_PATTERNS = [
  { vendor: "Crunchbase", pattern: /crunchbase/i },
  { vendor: "Hostinger", pattern: /hostinger/i },
  { vendor: "LinkedIn", pattern: /linkedin/i },
  { vendor: "Twitter/X", pattern: /\b(?:twitter|x\.com)\b|@(?:x|twitter)\.com/i },
  { vendor: "DotDB", pattern: /dotdb|域名科技/i },
  { vendor: "NameBio", pattern: /namebio/i },
  { vendor: "Gspace", pattern: /gspace/i },
  { vendor: "VPN", pattern: /\b(?:nordvpn|expressvpn|surfshark|proton\s*vpn|vpn)\b/i },
  {
    vendor: "GoDaddy Premium",
    pattern: /godaddy.*premium|discount domain club|domain club premium|premium\s+listing|afternic.*premium|cashparking/i,
  },
];

export const EXPENSE_RECEIPT_HINT =
  /receipt|invoice|payment (?:received|confirmation|successful|sent)|thank you for your (?:payment|purchase|order)|amount paid|order total|you've sent a payment|payment was successful/i;

const REGISTRAR_RECEIPT =
  /order finished|domain registration|domain renewal|sav\.com receipt|namesilo\.com receipt|unstoppable domains receipt|spaceship order|thank you for your order\s*#|(?:@|\b)(?:namesilo|dynadot|sav\.com|spaceship|cosmotown)\.com/i;

/**
 * @returns {{ vendor: string } | null}
 */
export function classifyExpenseMail(subject, text, fromAddress = "") {
  if (isPromotionalOfferMail(subject, text)) return null;
  if (!isPaidPurchaseMail(subject, text) && !EXPENSE_RECEIPT_HINT.test(`${subject || ""}\n${text || ""}`)) {
    return null;
  }
  if (!isPaidPurchaseMail(subject, text)) return null;

  const identity = `${fromAddress || ""}\n${subject || ""}`;
  const hay = `${subject || ""}\n${text || ""}\n${fromAddress || ""}`;

  // Domain registrar receipts belong in Bought for / Renewals, not Other expenses.
  if (REGISTRAR_RECEIPT.test(hay) && !/domain club premium|premium listing|cashparking/i.test(hay)) {
    return null;
  }

  for (const item of EXPENSE_VENDOR_PATTERNS) {
    if (item.pattern.test(identity)) return { vendor: item.vendor };
  }
  return null;
}

export function shouldKeepExpenseEvent(event) {
  return Boolean(
    classifyExpenseMail(event?.subject || "", event?.snippet || "", event?.from_address || event?.from || ""),
  );
}

export function extractExpenseMoney(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  const labeled =
    matchLabeled(hay, [
      "order total",
      "amount paid",
      "total",
      "charged",
      "payment",
      "invoice total",
      "price",
      "payment sent",
      "you've sent",
    ]) || null;
  if (labeled) return labeled;

  const all = [
    ...String(hay).matchAll(/(?:USD|US\$|\$|INR|Rs\.?|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi),
  ];
  if (!all.length) return { amount: "", currency: "" };
  const last = all[all.length - 1];
  return {
    amount: last[1],
    currency: /INR|Rs\.?|₹/i.test(last[0]) ? "INR" : "USD",
  };
}

export function buildExpenseGmailQuery() {
  const senders = EXPENSE_SENDERS.map((s) => `from:${s}`).join(" OR ");
  return `(${senders}) (receipt OR invoice OR "payment successful" OR "payment was successful" OR "you've sent a payment" OR "thank you for your" OR "amount paid" OR "payment received" OR "order total") newer_than:10y`;
}

function matchLabeled(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      `${label}\\s*[:\\-]?\\s*(?:USD|US\\$|\\$|INR|Rs\\.?|₹)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`,
      "i",
    );
    const match = String(text).match(pattern);
    if (match?.[1]) {
      return {
        amount: match[1],
        currency: /INR|Rs\.?|₹/i.test(match[0]) ? "INR" : "USD",
      };
    }
  }
  return null;
}
