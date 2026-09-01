/**
 * Master RND rules catalog — every PDF line/screenshot maps here.
 * Classification uses these globally (no LLMs).
 *
 * Full PDF rule inventory: ./rnd-pdf-rules.js
 * Screenshot hits: data/rnd-screenshot-hits.json (all 93 real email shots)
 * OCR index: data/rnd-ocr-index.json
 * PDF text: data/rnd-pdf-full.txt
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export { RND_PDF_RULES, RND_PDF_META, rndPdfCoverageSummary } from "./rnd-pdf-rules.js";

const catalogDir = path.dirname(fileURLToPath(import.meta.url));
const hitsPath = path.join(catalogDir, "..", "data", "rnd-screenshot-hits.json");

export const RND_VIEWS = ["mailbox", "sold", "expired", "expenses"];

/** Explicit ignore — never spend / never sale. */
export const RND_IGNORE = [
  {
    id: "afternic-support-ticket",
    status: "implemented",
    from: /service@afternic\.com/i,
    note: "Afternic support replies (ticket subjects like Afternic - 05661540) — hypothetical $ examples are not payments",
  },
  {
    id: "afternic-ta-followup",
    status: "implemented",
    from: /ta@afternic\.com/i,
    subject: /follow up|\[ ref:_|the transfer for |your transfer of |message about .+ sale/i,
    note: "Afternic TA ops / Salesforce tickets — not a paid transfer or purchase",
  },
  {
    id: "afternic-fast-transfer-confirm",
    status: "implemented",
    from: /accounts@dynadot\.com/i,
    subject: /afternic confirmation needed/i,
    body: /enroll the domain name|afternic marketplace|afternic pending|fast transfer/i,
    note: "Afternic listing confirmation from accounts@dynadot — ignore price",
  },
  {
    id: "afternic-checkout-link-expired",
    status: "implemented",
    from: /afternic|mailmc\.afternic/i,
    subject: /link for .+ has expired|checkout link/i,
    body: /create a new link|links automatically expire/i,
    note: "Afternic selling link expired — ignore",
  },
  {
    id: "auto-renewal-payment-issue",
    status: "implemented",
    subject: /auto renewal payment issue|payment issue|attention required:\s*auto renewal/i,
    note: "Failed auto-renew charge — no payment was made",
  },
  {
    id: "order-received-precomplete",
    status: "implemented",
    subject: /^order received\b|auto-renew order submitted/i,
    note: "Wait for Order Finished / paid receipt",
  },
  {
    id: "3ds-verification",
    status: "implemented",
    subject: /3ds verification|3d secure/i,
  },
  {
    id: "namecheap-unpaid-auction",
    status: "implemented",
    from: /namecheap\.com/i,
    subject: /you.?ve been outbid|pay now to receive/i,
    note: "Namecheap auction outbid / unpaid win — wait for Order Summary",
  },
  {
    id: "namecheap-contact-or-move",
    status: "implemented",
    from: /namecheap\.com/i,
    subject: /update your domain contact|domain contacts? update|fast transfer deactivation|domain move (?:invitation|completed)/i,
    note: "Namecheap contact / move / Fast Transfer mail — not a payment",
  },
  {
    id: "epik-listing-updates",
    status: "implemented",
    from: /epik\.com/i,
    subject: /marketplace listing of|your domains have been updated|name ?liquidate/i,
    note: "Epik listing prices are not Bought for",
  },
  {
    id: "afternic-opt-in",
    status: "implemented",
    from: /afternic/i,
    subject: /opt-in to the afternic premium/i,
    note: "Afternic opt-in asking prices are not payments",
  },
  {
    id: "sav-backorder-confirmation",
    status: "implemented",
    from: /sav\.com/i,
    subject: /backorder confirmation|upcoming backorders/i,
    note: "Sav backorder placed — Current Price is not a payment; wait for Backorder Capture / Sav.com Receipt",
  },
  {
    id: "unreported-sales-newsletter",
    status: "implemented",
    from: /unreportedsales/i,
    subject: /sold for|weekly unreported/i,
    note: "Marketplace newsletters — not our sales",
  },
  {
    id: "sedo-transfer-ticket",
    status: "implemented",
    from: /sedo\.com/i,
    subject: /waiting to transfer|transfer of domain name sold/i,
    note: "Sedo transfer paperwork — sale amount comes from Congratulations on the sale",
  },
  {
    id: "sedo-owner-verification",
    status: "implemented",
    from: /sedo\.com/i,
    subject: /verify your ownership|ownership confirmation|ownership unconfirmed/i,
    note: "Sedo listing verification — not spend",
  },
];

export const RND_EXPIRY_NOTICE = [
  {
    id: "dynadot-expires-in-n-days",
    status: "implemented",
    from: /accounts@dynadot\.com/i,
    subject: /expires? in \d+\s*days?|expired today/i,
  },
  {
    id: "porkbun-renewal-notice",
    status: "implemented",
    from: /porkbun\.com/i,
    subject: /domain renewal notice|expired domains/i,
  },
  {
    id: "spaceship-expire",
    status: "implemented",
    from: /spaceship\.com/i,
    subject: /will expire in \d+\s*days?/i,
  },
  {
    id: "namecheap-expire",
    status: "implemented",
    from: /namecheap\.com/i,
    subject: /will expire in \d+\s*days?|renew now/i,
  },
  {
    id: "godaddy-expire",
    status: "implemented",
    from: /godaddy\.com/i,
    subject: /domain expires soon|time to renew/i,
  },
  {
    id: "namebright-expire",
    status: "implemented",
    from: /namebright\.com/i,
    subject: /expiring domains/i,
  },
  {
    id: "generic-expiry-reminder",
    status: "implemented",
    subject: /expir(?:e|es|ing|ation)|renewal reminder|please renew|action required:\s*please renew/i,
  },
];

export const RND_PURCHASE = [
  {
    id: "dynadot-order-finished-bulk",
    status: "implemented",
    from: /orders@dynadot\.com/i,
    subject: /order finished/i,
  },
  {
    id: "porkbun-order-thank-you",
    status: "implemented",
    from: /porkbun\.com/i,
    subject: /order\s*-\s*thank you|order confirmation/i,
  },
  {
    id: "dropcatch-receipt",
    status: "implemented",
    from: /dropcatch\.com/i,
    subject: /order receipt/i,
    body: /backorder|discountclub/i,
  },
  {
    id: "godaddy-order",
    status: "implemented",
    from: /godaddy\.com/i,
    subject: /thank you for your order|thanks for your order/i,
  },
  {
    id: "namecheap-order-summary",
    status: "implemented",
    from: /namecheap\.com/i,
    subject: /order summary|marketplace/i,
  },
  {
    id: "namesilo-aftermarket-auction",
    status: "implemented",
    from: /namesilo/i,
    body: /aftermarket|domainauction|thank you for your order/i,
  },
  {
    id: "sav-receipt",
    status: "implemented",
    from: /sav\.com/i,
    subject: /sav\.com receipt/i,
  },
  {
    id: "auction-won",
    status: "implemented",
    body: /domain won|auction won|you(?:'ve| have) won|backorder won|winning bid/i,
  },
];

export const RND_RENEWAL = [
  {
    id: "dynadot-bulk-renewal-line",
    status: "implemented",
    from: /orders@dynadot\.com/i,
    subject: /order finished/i,
  },
  {
    id: "sav-auto-renewal",
    status: "implemented",
    body: /1 year auto renewal|auto[-\s]?renewal of/i,
  },
  {
    id: "transfer-counts-as-renewal",
    status: "implemented",
    note: "Incoming paid transfer = renewal year; transfer-away ignore for spend",
  },
  {
    id: "push-is-free",
    status: "implemented",
    note: "Same-registrar push / account change between own mailboxes is free. Transfer to a different registrar is chargeable (counts as renewal).",
  },
];

export const RND_SALE = [
  {
    id: "dynadot-sold-subject",
    status: "implemented",
    from: /accounts@dynadot\.com/i,
    subject: /\bSOLD\b/i,
  },
  {
    id: "afternic-fast-transfer-sold",
    status: "implemented",
    from: /afternic\.com|ta@afternic/i,
    subject: /has sold via fast transfer|has sold at afternic|funds are on the way/i,
  },
  {
    id: "dan-marketplace",
    status: "implemented",
    from: /dan\.com/i,
    subject: /buy now|counter offer accepted|payment received|transaction closed/i,
  },
  {
    id: "sedo-sale",
    status: "implemented",
    from: /sedo\.com/i,
    subject: /congratulations on the sale|sold/i,
  },
  {
    id: "epik-sale",
    status: "implemented",
    from: /epik\.com/i,
    subject: /sold at epik/i,
  },
  {
    id: "namecheap-marketplace-sale",
    status: "implemented",
    from: /namecheap\.com/i,
    subject: /marketplace sale confirmation/i,
  },
  {
    id: "masterbucks-payout",
    status: "implemented",
    from: /masterbucks\.com/i,
    subject: /masterbucks payment/i,
    note: "gross / commission / net wallet credit",
  },
  {
    id: "funds-on-the-way",
    status: "implemented",
    subject: /funds are on the way|we have just sent you a payment|transaction closed/i,
    note: "Net payout; pair with earlier sold-for mail by domain",
  },
  {
    id: "sale-two-prices",
    status: "implemented",
    note: "Higher = sold for; lower = after commission",
  },
];

export const RND_EXPENSES = [
  { id: "crunchbase", status: "partial", vendor: "Crunchbase" },
  { id: "hostinger", status: "implemented", vendor: "Hostinger", note: "Razorpay payment success" },
  { id: "linkedin", status: "partial", vendor: "LinkedIn" },
  { id: "twitter-x", status: "partial", vendor: "Twitter/X" },
  { id: "vpn", status: "implemented", vendor: "VPN", note: "Surfshark receipt" },
  { id: "dotdb", status: "implemented", vendor: "DotDB", note: "PayPal to DotDB yearly" },
  { id: "namebio", status: "implemented", vendor: "NameBio", note: "invoice+statements@namebio.com" },
  { id: "godaddy-premium", status: "implemented", vendor: "GoDaddy Premium", note: "Discount Domain Club" },
  { id: "gspace", status: "partial", vendor: "Gspace" },
];

/** Senders discovered from screenshot catalog — used by Gmail queries. */
export const RND_RECEIPT_SENDERS = [
  "orders@dynadot.com",
  "accounts@dynadot.com",
  "support@namesilo.com",
  "support@sav.com",
  "noreply@name.com",
  "support@name.com",
  "receipts@spaceship.com",
  "alert@spaceship.com",
  "notifications@unstoppabledomains.com",
  "noreply@unstoppabledomains.com",
  "mc@mailmc.afternic.com",
  "noreply@afternic.com",
  "ta@afternic.com",
  "support@godaddy.com",
  "noreply@godaddy.com",
  "donotreply@godaddy.com",
  "receipts@godaddy.com",
  "auctions@godaddy.com",
  "renewals@godaddy.com",
  "noreply@porkbun.com",
  "support@porkbun.com",
  "support@dan.com",
  "contact@sedo.com",
  "sales@epik.com",
  "no-reply@masterbucks.com",
  "support@namecheap.com",
  "renewals@namecheap.com",
  "billing@namecheap.com",
  "invoice@namecheap.com",
  "no-reply@namecheap.com",
  "noreply@namecheap.com",
  "support@dropcatch.com",
  "support@namebright.com",
  "support@cosmotown.com",
  "snapnames-automail@snapnames.com",
];

/** Gmail from:domain catches billing@ / invoice@ / marketplace@ that exact mailboxes miss. */
export const RND_RECEIPT_SENDER_DOMAINS = [
  "dynadot.com",
  "namesilo.com",
  "sav.com",
  "namecheap.com",
  "godaddy.com",
  "porkbun.com",
  "spaceship.com",
  "unstoppabledomains.com",
  "afternic.com",
  "dropcatch.com",
  "namebright.com",
  "cosmotown.com",
  "snapnames.com",
  "networksolutions.com",
  "namepal.com",
  "epik.com",
  "masterbucks.com",
  "sedo.com",
  "dan.com",
];

let cachedHits = null;

export function loadRndScreenshotHits() {
  if (cachedHits) return cachedHits;
  try {
    cachedHits = JSON.parse(readFileSync(hitsPath, "utf8"));
  } catch {
    cachedHits = [];
  }
  return cachedHits;
}

export const RND_SCREENSHOT_HITS = loadRndScreenshotHits();

/**
 * @returns {object|null} matching ignore rule
 */
export function matchRndIgnore(subject, text, fromAddress = "") {
  const subjectText = String(subject || "");
  const hay = `${subjectText}\n${text || ""}\n${fromAddress || ""}`;
  const from = String(fromAddress || "");

  for (const rule of RND_IGNORE) {
    if (rule.from) {
      const fromOk = rule.from.test(from) || ((rule.subject || rule.body) && rule.from.test(hay));
      if (!fromOk) continue;
    }
    if (rule.subject && !rule.subject.test(subjectText)) continue;
    if (rule.body && !rule.body.test(hay)) continue;
    if (rule.from && !rule.subject && !rule.body) return rule;
    if (rule.subject || rule.body) return rule;
  }

  // Broader sweeps from verified screenshots
  if (/accounts@dynadot\.com/i.test(from) && /afternic confirmation|afternic pending|fast transfer listing/i.test(hay)) {
    return RND_IGNORE.find((rule) => rule.id === "afternic-fast-transfer-confirm") || RND_IGNORE[0];
  }
  if (/afternic|mailmc\.afternic/i.test(from) && /link .+ has expired|checkout link/i.test(hay)) {
    return RND_IGNORE.find((rule) => rule.id === "afternic-checkout-link-expired") || RND_IGNORE[1];
  }
  if (/auto renewal payment issue|attention required:\s*auto renewal/i.test(subjectText)) {
    return RND_IGNORE.find((rule) => rule.id === "auto-renewal-payment-issue");
  }
  if (/unable to submit auto-renew|insufficient (?:usd )?account credit/i.test(hay)) {
    return RND_IGNORE.find((rule) => rule.id === "insufficient-balance-autorenew");
  }
  if (/^order received\b/i.test(subjectText.trim()) || /auto-renew order submitted/i.test(subjectText)) {
    return RND_IGNORE.find((rule) => rule.id === "order-received-precomplete");
  }
  return null;
}
