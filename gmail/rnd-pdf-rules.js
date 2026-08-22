/**
 * Complete RND PDF rule inventory — source of truth from "Prompts for RND.pdf".
 * Every explicit instruction in the PDF is listed with status.
 * Screenshots: all 93 real email images cataloged (PDF also embeds 93 blank placeholders).
 *
 * Status: implemented | partial | pending | idea
 */

export const RND_PDF_META = {
  source: "Prompts for RND.pdf",
  pages: 118,
  realEmailScreenshots: 93,
  blankPlaceholderImages: 93,
  catalogHitsFile: "data/rnd-screenshot-hits.json",
  ocrIndexFile: "data/rnd-ocr-index.json",
  noLlms: true,
};

/**
 * Ordered rule list mirroring PDF narrative.
 * `pdf` = short quote / paraphrase from the document.
 */
export const RND_PDF_RULES = [
  {
    id: "historic-and-future",
    pdf: "Tool for future domains; also historic data; domains added and removed over time.",
    status: "implemented",
    where: "data/known-domains.js, seed sync",
  },
  {
    id: "lifecycle-flow",
    pdf: "Buy (hand register / auction / aftermarket) → expire → renew / push / transfer; renew & transfer allowed in grace after expiry.",
    status: "implemented",
    where: "gmail/rules.js, gmail/expiry.js",
  },
  {
    id: "critical-reminders-idea",
    pdf: "Want reminders for critical info; maybe email when domain sold; improve labels/filters.",
    status: "implemented",
    where: "ledger/reminders.js, /api/reminders, UI banner + Gmail label filter ideas",
  },
  {
    id: "frontend-views",
    pdf: "Dropdowns: one per Gmail (Domains at …). Sold, expired, and other expenses are combined across all Gmail accounts (including a third account added later).",
    status: "implemented",
    where: "app.js, index.html, ledger/portfolio.js",
  },
  {
    id: "bulk-emails",
    pdf: "Single email can cover multiple domains — parse line items.",
    status: "implemented",
    where: "gmail/receipts/parse.js",
  },
  {
    id: "screenshots-then-search-gmail",
    pdf: "See screenshots, search same emails in Gmail, fetch information.",
    status: "implemented",
    where: "gmail/rnd-templates.js subject+body fingerprints + syncGmailPortfolioEvents",
  },
  {
    id: "no-llms",
    pdf: "No LLMs — simple programming / rule-based only.",
    status: "implemented",
    where: "all gmail/* classifiers",
  },
  {
    id: "ignore-afternic-fast-transfer-confirm",
    pdf: "Ignore Afternic fast-transfer confirmation emails from accounts@dynadot.com (domain+price visible but ignore).",
    status: "implemented",
    where: "RND_IGNORE, matchRndIgnore, NOISE_*",
  },
  {
    id: "bulk-registration-order-finished",
    pdf: "orders@dynadot.com Order Finished bulk registration; line like `domain - domain registration 1 year ($X)$X` Result: Registered.",
    status: "implemented",
    where: "receipts/parse.js, phrases, sync",
  },
  {
    id: "bulk-renewal-order",
    pdf: "Bulk renewals from Dynadot Orders; `domain - Domain Renewal 1 year ($X)$X`; extends expiry by a year.",
    status: "implemented",
    where: "receipts/parse.js, rules RENEWAL_SPEND",
  },
  {
    id: "expiry-reminder-for-date",
    pdf: "Renew/expiry reminder emails → use for expiration date only, not spend.",
    status: "implemented",
    where: "gmail/expiry.js, isExpiryReminderMail, sync expiry path",
  },
  {
    id: "ignore-insufficient-balance",
    pdf: "Ignore emails saying balance insufficient to renew.",
    status: "implemented",
    where: "RND_IGNORE, NOISE_*",
  },
  {
    id: "ignore-afternic-selling-link-expired",
    pdf: "Ignore Afternic selling-link expired emails.",
    status: "implemented",
    where: "RND_IGNORE, SALE_NOISE",
  },
  {
    id: "renewal-spend-line",
    pdf: "Paid Domain Renewal line = renewal spend amount.",
    status: "implemented",
    where: "receipts/parse.js",
  },
  {
    id: "purchase-total-charged",
    pdf: "Purchase receipts: prefer total charged / Final cost / Order Total.",
    status: "implemented",
    where: "receipts/parse.js, extractMoneyForDomain",
  },
  {
    id: "transfer-counts-as-renewal",
    pdf: "Domain transfer (incoming, paid) counted as renewal; price in body.",
    status: "implemented",
    where: "isIncomingTransferSpend → renewal",
  },
  {
    id: "sav-auto-renewal",
    pdf: "1 Year Auto Renewal of {domain} = renewal.",
    status: "implemented",
    where: "RENEWAL_SPEND, phrases",
  },
  {
    id: "per-domain-registration-line-price",
    pdf: "Bulk register: use individual line price when visible (e.g. createtwin.com $7.88).",
    status: "implemented",
    where: "receipts/parse.js allocate by line",
  },
  {
    id: "ignore-gmail-label-noise",
    pdf: "Ignore Gmail labels like DOMAIN SALE / Expired for classification (labels may change).",
    status: "implemented",
    where: "classifiers use subject/body/from only",
  },
  {
    id: "equal-split-when-no-line-prices",
    pdf: "Two domains purchased without individual prices → divide total (e.g. 22/2=11).",
    status: "implemented",
    where: "receipts/parse.js order-total-split",
  },
  {
    id: "removed-when-expired-or-sold",
    pdf: "Domain removed from account when expired or sold.",
    status: "implemented",
    where: "removal classification + sold/expired views + 30-day recently removed",
  },
  {
    id: "sale-gross-net-two-prices",
    pdf: "Sale emails: higher amount = sold for; lower = after commission (profit base).",
    status: "implemented",
    where: "gmail/sales.js extractSaleMoney",
  },
  {
    id: "sale-nearby-funds-email",
    pdf: "If net not in sale mail, check nearby emails for same domain — e.g. Your funds are on the way.",
    status: "implemented",
    where: "db applyEventToLedger merges sale events; funds mail → net",
  },
  {
    id: "counter-offer-accepted-is-sale",
    pdf: "Counter offer accepted = sale.",
    status: "implemented",
    where: "SALE_SUBJECT",
  },
  {
    id: "payment-sent-is-net",
    pdf: "We have just sent you a payment / funds on the way = amount after commission.",
    status: "implemented",
    where: "FUNDS_RECEIVED, extractSaleMoney",
  },
  {
    id: "templates-change-over-time",
    pdf: "Dynadot/Afternic templates change — act accordingly with flexible patterns.",
    status: "implemented",
    where: "broad regexes + screenshot catalog subjects/senders",
  },
  {
    id: "purchase-hand-auction-aftermarket-backorder",
    pdf: "Purchases include hand register, auction, aftermarket, backorder; Sav won; GoDaddy; NameSilo auction.",
    status: "implemented",
    where: "isAcquisitionCheckoutMail + coerceAcquisitionEventType (all registrars, all domains)",
  },
  {
    id: "auction-checkout-includes-first-year-renewal",
    pdf: "Auction payment is bid + first year; invoice may label the year Renewal — still Bought for.",
    status: "implemented",
    where: "gmail/rules.js coerceAcquisitionEventType, merged line items, first paid receipt",
  },
  {
    id: "porkbun-renewal-reminder",
    pdf: "Porkbun renewal reminder example for expiry dates.",
    status: "implemented",
    where: "expiry patterns + senders",
  },
  {
    id: "sold-view-fields",
    pdf: "Sold dropdown needs: buy platform, sell platform, sold price, after commission, before commission, buy price, profit.",
    status: "implemented",
    where: "ledger/portfolio.js sold fields + UI sold table",
  },
  {
    id: "transfer-cost-is-renewal",
    pdf: "Bought at one registrar, transferred to another — transfer cost counted in renewal.",
    status: "implemented",
    where: "isIncomingTransferSpend",
  },
  {
    id: "historic-seed-list",
    pdf: "Long list of historic domains not currently in account → seed / expired-or-sold discovery.",
    status: "implemented",
    where: "data/known-domains.js HISTORIC_SEED_DOMAINS",
  },
  {
    id: "letsliterate-mailbox-list",
    pdf: "Separate dropdown for letsliterate@gmail.com; Dynadot list provided.",
    status: "implemented",
    where: "data/mailboxes.js, LETSLITERATE_DOMAINS",
  },
  {
    id: "30-day-recently-removed",
    pdf: "Mailbox views also show domains removed in past 30 days; also appear under expired/sold.",
    status: "implemented",
    where: "ledger/portfolio.js RECENT_REMOVED_DAYS=30",
  },
  {
    id: "other-expenses-vendors",
    pdf: "Crunchbase, Twitter, Hostinger, LinkedIn, VPN, DotDB, NameBio, GoDaddy Premium, Gspace.",
    status: "implemented",
    where: "gmail/expenses.js senders + vendor patterns + syncExpenseReceipts",
  },
  {
    id: "find-all-receipts",
    pdf: "Find all receipts and domain info; total business spend.",
    status: "implemented",
    where: "Sync Gmail across mailboxes; seed lists + expense sync",
  },
  {
    id: "manual-edit-frontend",
    pdf: "Option to manually enter/edit entries from frontend.",
    status: "implemented",
    where: "app.js manual add/edit",
  },
  {
    id: "account-change-both-ends",
    pdf: "Push/account change between mailboxes — confirm both accounts (started in one, ended in other). Push is free, not renewal.",
    status: "implemented",
    where: "extractAccountChangeParties + push event meta notes",
  },
  {
    id: "sold-not-expired-when-profit",
    pdf: "Sold domains (even at profit) list under sold, not expired.",
    status: "implemented",
    where: "ledger sold vs expired views",
  },
  {
    id: "renew-after-expiration",
    pdf: "Can still renew after expiration / in grace.",
    status: "implemented",
    where: "lifecycle rules; not blocked by expiry_notice",
  },
  {
    id: "order-received-wait",
    pdf: "Order Received / Auto-Renew Order Submitted are not final — wait for Order Finished / paid receipt.",
    status: "implemented",
    where: "RND_IGNORE order-received-precomplete",
  },
];

export function rndPdfCoverageSummary() {
  const counts = { implemented: 0, partial: 0, pending: 0, idea: 0 };
  for (const rule of RND_PDF_RULES) {
    counts[rule.status] = (counts[rule.status] || 0) + 1;
  }
  return {
    total: RND_PDF_RULES.length,
    ...counts,
    screenshots: RND_PDF_META.realEmailScreenshots,
  };
}
