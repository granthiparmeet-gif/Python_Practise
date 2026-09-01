import {
  isNoiseMail,
  looksLikeRegistrationPurchase,
  looksLikeRenewalSpend,
  PAID_RECEIPT_HINT,
} from "./rules.js";

/**
 * Shared phrase templates for Gmail receipt discovery + classification.
 * Keep labels aligned with real registrar wording; discovery script scores these.
 */

export const EVENT_PHRASES = {
  purchase: [
    { label: "order finished", q: '"Order Finished"', pattern: /order finished/i },
    { label: "domain registration", q: '"domain registration"', pattern: /domain registration/i },
    { label: "domain registered", q: '"domain registered"', pattern: /domain registered/i },
    { label: "thank you for your order", q: '"Thank you for your order"', pattern: /thank you for your order/i },
    { label: "thank you for your purchase", q: '"Thank you for your purchase"', pattern: /thank you for your purchase/i },
    { label: "products purchased", q: '"Products Purchased"', pattern: /products purchased/i },
    { label: "product purchased", q: '"product purchased"', pattern: /product(?:s)? purchased/i },
    { label: "domain purchased", q: '"domain purchased"', pattern: /domain purchased/i },
    { label: "domain bought", q: '"domain bought"', pattern: /domain bought/i },
    { label: "domain won", q: '"domain won"', pattern: /domain won|you(?:'ve| have) won/i },
    { label: "you won", q: '"You Won"', pattern: /\byou won\b/i },
    { label: "backorder capture", q: '"Backorder Capture"', pattern: /backorder capture|backorder won/i },
    { label: "auction won", q: '"auction won"', pattern: /auction won|won the auction|congratulations.*won/i },
    { label: "order confirmation", q: '"order confirmation"', pattern: /order confirmation/i },
    { label: "order summary", q: '"Order summary"', pattern: /order summary/i },
    { label: "namecheap order summary", q: '"Namecheap Order Summary"', pattern: /namecheap order summary/i },
    { label: "summary of your order", q: '"summary of your order"', pattern: /summary of your order/i },
    { label: "1 year registration", q: '"1 year registration"', pattern: /\b1[\s-]?year(?:s)?\s+registration\b/i },
    { label: "year registration", q: '"year registration"', pattern: /\b\d+\s*[-]?\s*year(?:s)?\s+registration\b/i },
    { label: "namesilo receipt", q: '"NameSilo.com Receipt"', pattern: /namesilo\.com receipt/i },
    { label: "sav receipt", q: '"Sav.com Receipt"', pattern: /sav\.com receipt/i },
    { label: "unstoppable receipt", q: '"Unstoppable Domains Receipt"', pattern: /unstoppable domains receipt/i },
    { label: "spaceship order summary", q: '"Spaceship order summary"', pattern: /spaceship order summary/i },
    { label: "auto-renew on", q: '"Auto-renew on"', pattern: /auto-renew on/i },
    { label: "final cost", q: '"Final cost"', pattern: /final cost/i },
    { label: "order total", q: '"Order Total"', pattern: /order total/i },
    { label: "dns domain", q: '"DNS Domain"', pattern: /dns domain/i },
    { label: "new registration", q: '"new registration"', pattern: /new registration/i },
    { label: "registration successful", q: '"registration successful"', pattern: /registration successful/i },
    { label: "successfully registered", q: '"successfully registered"', pattern: /successfully registered/i },
    { label: "payment received", q: '"payment received"', pattern: /payment received/i },
    { label: "paid on", q: '"Paid on"', pattern: /paid on/i },
    { label: "invoice", q: "invoice", pattern: /\binvoice\b/i },
    { label: "receipt", q: "receipt", pattern: /\breceipt\b/i },
  ],
  renewal: [
    { label: "auto renewal", q: '"Auto Renewal"', pattern: /auto[-\s]?renewal/i },
    { label: "domain renewal", q: '"domain renewal"', pattern: /domain renewal/i },
    { label: "1 year auto renewal", q: '"1 Year Auto Renewal"', pattern: /\b\d+\s*year\s+auto[-\s]?renewal\b/i },
    { label: "renewed", q: "renewed", pattern: /\brenewed\b/i },
    { label: "renewal", q: "renewal", pattern: /\brenewal\b/i },
    { label: "auto renew", q: '"auto renew"', pattern: /auto[-\s]?renew\b/i },
    { label: "subscription renewed", q: '"subscription renewed"', pattern: /subscription renewed/i },
    { label: "renew your", q: '"renew your"', pattern: /renew your/i },
    { label: "successfully renewed", q: '"successfully renewed"', pattern: /successfully renewed/i },
    { label: "renewal confirmation", q: '"renewal confirmation"', pattern: /renewal confirmation/i },
    { label: "has been renewed", q: '"has been renewed"', pattern: /has been renewed/i },
  ],
  transfer: [
    { label: "domain transfer", q: '"domain transfer"', pattern: /domain transfer/i },
    { label: "transfer away", q: '"Transfer Away"', pattern: /transfer away/i },
    { label: "transfer completed", q: '"transfer completed"', pattern: /transfer completed/i },
    { label: "transfer successful", q: '"transfer successful"', pattern: /transfer successful/i },
    { label: "incoming transfer", q: '"incoming transfer"', pattern: /incoming transfer/i },
    { label: "outgoing transfer", q: '"outgoing transfer"', pattern: /outgoing transfer/i },
    { label: "transfer in", q: '"transfer in"', pattern: /transfer[\s-]?in\b/i },
    { label: "transfer out", q: '"transfer out"', pattern: /transfer[\s-]?out\b/i },
    { label: "transferred", q: "transferred", pattern: /\btransferred\b/i },
    { label: "auth code", q: '"auth code"', pattern: /auth(?:orization)?\s*code|epp code/i },
  ],
  removal: [
    { label: "domain deleted", q: '"domain deleted"', pattern: /domain deleted|domain has been deleted/i },
    { label: "removed from account", q: '"removed from account"', pattern: /removed from account/i },
    { label: "has been removed", q: '"has been removed"', pattern: /has been removed from|was removed from|were removed from|product'?s?\s+been removed/i },
    { label: "domain cancelled", q: '"domain cancelled"', pattern: /domain cancel(?:led|lation)/i },
    { label: "expired and deleted", q: '"expired and deleted"', pattern: /expired and (was )?deleted|deleted from (?:the )?system/i },
    { label: "no longer in your account", q: '"no longer in your account"', pattern: /no longer in your account/i },
    { label: "domain drop", q: '"domain drop"', pattern: /\bdomain drop\b|dropped from your/i },
  ],
};

/** Flat list for Gmail estimate scans. */
export const ALL_DISCOVERY_PHRASES = Object.entries(EVENT_PHRASES).flatMap(([type, list]) =>
  list.map((item) => ({ ...item, type })),
);

/** Default Gmail search phrases (presence filters). Prefer high-signal paid-receipt wording. */
export const DEFAULT_GMAIL_SEARCH_PHRASES = [
  '"Order Finished"',
  '"domain registration"',
  '"domain registered"',
  '"Thank you for your order"',
  '"Thank you for your purchase"',
  '"Products Purchased"',
  '"product purchased"',
  '"domain purchased"',
  '"domain won"',
  '"auction won"',
  '"order confirmation"',
  '"Order summary"',
  '"summary of your order"',
  '"NameSilo.com Receipt"',
  '"Sav.com Receipt"',
  '"Name.com"',
  '"Order Confirmation"',
  '"Spaceship order summary"',
  '"Final cost"',
  '"Order Total"',
  '"Unstoppable Domains Receipt"',
  '"DNS Domain"',
  '"Auto Renewal"',
  '"1 Year Auto Renewal"',
  '"domain renewal"',
  '"successfully renewed"',
  '"renewal confirmation"',
  '"domain transfer"',
  '"Transfer Away"',
  '"transfer completed"',
  '"incoming transfer"',
  '"outgoing transfer"',
  '"Paid on"',
  "receipt",
  "invoice",
];

const SUBJECT_PURCHASE =
  /order finished|thank you for your purchase|thank you for your order|thanks for your order|products purchased|unstoppable domains receipt|sav\.com receipt|you won\b|namesilo\.com receipt|name\.com - order confirmation|order confirmation|order summary|summary of your order|spaceship order|dropcatch\.com order receipt|new cosmotown order receipt|you have acquired|order\s*-\s*thank you|porkbun\.com \| order/i;

const SUBJECT_RENEWAL =
  /auto renewal|domain renewal|successfully renewed|renewal confirmation|has been renewed|1 year auto renewal/i;

const SUBJECT_TRANSFER =
  /transfer away|domain transfer|incoming transfer|outgoing transfer|transfer completed|transfer successful|transfer initiated|transfer complete \(order|completed domain transfers|approved domain transfers/i;

const SUBJECT_REMOVAL =
  /domain deleted|has been removed|removed from account|product'?s?\s+been removed|no longer in your account|expired and deleted|deleted from (?:the )?system|domain cancel/i;

/**
 * Classification — subject-first, ignore reminder/noise mail, then body cues.
 * Rules are global across Dynadot / NameSilo / Sav / Spaceship / Unstoppable / Name.com.
 */
export function classifyByPhrases(subject, text) {
  const subjectText = String(subject || "");
  const body = String(text || "");
  const haystack = `${subjectText}\n${body}`;

  if (isNoiseMail(subjectText, body)) return null;

  if (SUBJECT_REMOVAL.test(subjectText)) return "removal";
  if (SUBJECT_TRANSFER.test(subjectText) && !/afternic|listing/i.test(haystack)) return "transfer";
  if (/domain push|account change|successfully pushed/i.test(subjectText)) return "push";
  if (SUBJECT_RENEWAL.test(subjectText) && !looksLikeRegistrationPurchase(subjectText, body)) {
    return "renewal";
  }
  if (SUBJECT_PURCHASE.test(subjectText)) {
    if (looksLikeRegistrationPurchase(subjectText, body)) return "purchase";
    if (looksLikeRenewalSpend(subjectText, body)) return "renewal";
    return "purchase";
  }

  if (
    /has been removed from|was removed from|were removed from|domain (has been )?deleted|expired and (was )?deleted|no longer in your account|released back to|\bdomain drop\b/i.test(
      haystack,
    )
  ) {
    return "removal";
  }

  if (PAID_RECEIPT_HINT.test(haystack) && looksLikeRenewalSpend(subjectText, body)) {
    return "renewal";
  }

  if (
    /(?:domain\s+)?transfer(?:red|s)?|incoming transfer|outgoing transfer|transfer completed|transfer successful|transfer away|transfer[\s-]?(?:in|out)\b/i.test(
      haystack,
    ) &&
    !looksLikeRegistrationPurchase(subjectText, body) &&
    !/afternic|fast transfer listing|approve domain listing|domain listing|nameserver/i.test(haystack)
  ) {
    return "transfer";
  }

  if (PAID_RECEIPT_HINT.test(haystack) || looksLikeRegistrationPurchase(subjectText, body)) {
    if (looksLikeRenewalSpend(subjectText, body)) return "renewal";
    return "purchase";
  }

  return null;
}

export function matchPhraseHits(text) {
  const haystack = String(text || "");
  const hits = [];
  for (const item of ALL_DISCOVERY_PHRASES) {
    if (item.pattern.test(haystack)) hits.push(`${item.type}:${item.label}`);
  }
  return hits;
}
