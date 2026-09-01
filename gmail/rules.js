/**
 * Global product rules shared by sync, UI helpers, and probe scripts.
 * Apply across ALL registrars — never one-off domain logic.
 */

import { mapRegistrarAccountToMailbox, registrarAccountTokens } from "../data/mailboxes.js";

export const NOISE_SUBJECT =
  /^(order received\b|3ds verification\b|auto-renew order submitted\b)|^afternic\s*-\s*\d+|sedo opt in|afternic premium promotion|afternic confirmation needed|activate afternic premium|removed from afternic|whois privacy has expired|whois info for|get started with|new offer received|approve domain listing|nameserver update|whois data reminder|action required:\s*please renew|attention required:\s*auto renewal|auto renewal payment issue|automatic domain renewal action needed|last reminder of expired|domains just expired|entered grace period|unable to submit auto-renew|your link for .+ has expired|available for purchase at snapnames|you.?ve been outbid|pay now to receive|^backorder confirmation\b|upcoming backorders|update your domain contact|domain contacts? update|opt-in to the afternic premium|confirmation for epik marketplace listing|fast transfer deactivation|uniregistry market/i;

export const NOISE_BODY =
  /whois data reminder|keep the contact data associated|entered grace period|grace period|action needed:|automatic domain renewal action needed|not sufficient|insufficient (?:funds|balance|usd|credit)|please add (?:funds|account credit)|last reminder of expired|reminder of expired domain|domains just expired|approve domain listing|afternic confirmation|afternic pending|fast transfer listing|enroll the domain name\(s\) below for sale|checkout link|create a new link|nameserver update|nameservers for the following|dns update|contact verification reminder|3ds verification|3d secure|thank you for contacting afternic support|commission rate for your domain|if the domain(?: name)? sales? for/i;

/** Free account push between own mailboxes at the SAME registrar — not a renewal. */
export const DOMAIN_PUSH =
  /domain push|pushed (?:the )?domain|domain change account|owner changed|successfully pushed|push (?:has been )?completed|domain (?:was )?pushed/i;

/** Dynadot / registrar removal from account (expired or deleted — not a sale). */
export const DOMAIN_REMOVAL =
  /removed from account|product'?s?\s+been removed|has been removed from your|expired and deleted|no longer in your account|deleted from (?:the )?system|domain (?:has been )?deleted/i;

/** Expiry / renewal reminder mail — use for dates only, never as spend. */
export const EXPIRY_REMINDER =
  /(?:domain )?(?:is )?expiring|expiration (?:notice|date|reminder)|renewal reminder|expires? on|will expire|expiring soon|about to expire|expiration approaching|please renew|action required:\s*please renew domain|last reminder of expired|upcoming domain expirations|domains just expired|expired domain notification|expired today|your domain expires soon|expiring domains|has expired - reactivate|your domains expired|domain renewal notice/i;

export function isDomainPush(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  if (
    /you have acquired|successfully acquired|debited your account|you(?:'ve| have) won|winning bid|backorder capture|domain transfer extend|transfer\s+fee|transfer\s+price|amount\s+charged/i.test(
      hay,
    )
  ) {
    return false;
  }
  return DOMAIN_PUSH.test(hay);
}

export function isDomainRemovalMail(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  if (/\bSOLD\b|has sold|marketplace sale|funds are on the way/i.test(hay)) return false;
  if (/afternic/i.test(hay) && /removed from afternic|removed from (?:the )?(?:premium )?network/i.test(hay)) {
    return false;
  }
  return DOMAIN_REMOVAL.test(hay);
}

/**
 * Parse push / account-change parties for both-end confirmation.
 */
export function extractAccountChangeParties(subject, text, mailbox = "") {
  const hay = `${subject || ""}\n${text || ""}`;
  const mailboxNow = String(mailbox || "").toLowerCase();

  let toAccount = "";
  let fromAccount = "";

  const toMatch =
    hay.match(/push(?:ed)?\s+to\s+([a-z0-9_@.\-]+)/i) ||
    hay.match(/change account[^\n]{0,40}?to\s+([a-z0-9_@.\-]+)/i) ||
    hay.match(/moved to (?:your )?account\s*[:\-]?\s*([a-z0-9_@.\-]+)/i);
  if (toMatch?.[1]) toAccount = toMatch[1].toLowerCase();

  const accountTokenPattern = registrarAccountTokens()
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const fromMatch =
    hay.match(/from (?:account\s+)?([a-z0-9_@.\-]+)\s+to/i) ||
    hay.match(/\(account\s+([a-z0-9_@.\-]+)\)/i) ||
    (accountTokenPattern
      ? hay.match(new RegExp(`account\\s+(${accountTokenPattern})`, "i"))
      : null);
  if (fromMatch?.[1]) fromAccount = fromMatch[1].toLowerCase();

  if (!fromAccount && mailboxNow) fromAccount = mailboxNow.includes("@") ? mailboxNow : mailboxNow;

  const mappedTo = mapRegistrarAccountToMailbox(toAccount);
  const mappedFrom = mapRegistrarAccountToMailbox(fromAccount);

  const confirmedBoth = Boolean(
    (mappedFrom || fromAccount) &&
      (mappedTo || toAccount) &&
      String(mappedFrom || fromAccount) !== String(mappedTo || toAccount),
  );

  return {
    fromAccount: mappedFrom || fromAccount,
    toAccount: mappedTo || toAccount,
    confirmedBoth,
    note: confirmedBoth
      ? `push confirmed ${mappedFrom || fromAccount} → ${mappedTo || toAccount}`
      : `push seen${toAccount ? ` → ${toAccount}` : ""}${fromAccount ? ` (from ${fromAccount})` : ""}`,
  };
}

/** Dynadot Order Finished "(account …)" → mailbox via REGISTRAR_ACCOUNT_MAP / mailbox local parts. */
export function extractDynadotAccountMailbox(subject, text = "") {
  const hay = `${subject || ""}\n${text || ""}`;
  const match = hay.match(/\(account\s+([a-z0-9_@.\-]+)\)/i);
  if (!match?.[1]) return "";
  return mapRegistrarAccountToMailbox(match[1]);
}

export function isExpiryReminderMail(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  if (PAID_RECEIPT_HINT.test(hay) && /order total|final cost|amount paid|thank you for your/i.test(hay)) {
    return false;
  }
  return EXPIRY_REMINDER.test(hay) || NOISE_SUBJECT.test(String(subject || "").trim());
}

export const PAID_RECEIPT_HINT =
  /order finished|thank you for your purchase|thank you for your order|products purchased|sav\.com receipt|namesilo\.com receipt|unstoppable domains receipt|spaceship order summary|namecheap order summary|order summary|paid on|order total|final cost|payment received|backorder capture|\d+\s*year(?:s)?\s+registration/i;

/** Completed payment / purchase — not a deal, newsletter, or “renew for $x” promo. */
export const PAID_PURCHASE_PROOF =
  /payment (?:was )?successful|payment successful|you've sent a payment|you have sent a payment|payment confirmation|thank you for your (?:payment|purchase|order)|amount paid|order total|order finished|payment received|your receipt|receipt from|invoice (?:#|for|total)|successfully (?:paid|charged|purchased)|we (?:have )?charged|charged your|order #\d+|paid on|subscription (?:renewed|receipt)|billing receipt/i;

export const PAYMENT_FAILED =
  /payment failed|failed to process payment|payment declined|payment issue|could not (?:be )?charged|was not successful|payment unsuccessful|auto renewal payment issue/i;

export const PROMOTIONAL_OFFER =
  /we have a deal|deal for you|take the deal|special (?:comeback )?deal|limited[- ]time(?: deal| offer)?|black friday|cyber monday|%\s*(?:off|discount)|discount expires|the offer is still on|maybe it's time to renew|restart .{0,80} for only|save \s?\$\d+|your (?:apollo )?discount|weekly digest|product highlights|year in review|newsletter|livestream friday|yapping is a sport|get tracking-free|get your online privacy back|comeback deal|exclusive offer|don't miss|last chance|free trial|start summer|upgrade now|domain superpowers|reply rates under|ai assistant can help|full apollo platform|product hunt|the deep view|techcrunch daily|photography day|transfer prices increased|billing information was received/i;

export function isPaidPurchaseMail(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  if (PAYMENT_FAILED.test(hay)) return false;
  return PAID_PURCHASE_PROOF.test(hay) || PAID_RECEIPT_HINT.test(hay);
}

export function isPromotionalOfferMail(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  if (isPaidPurchaseMail(subject, text)) return false;
  return PROMOTIONAL_OFFER.test(hay);
}

/** Auction / closeout / aftermarket checkout — same on every registrar and every domain. */
export const AUCTION_ACQUISITION =
  /domainauction|domain auction|auction and renewal|aftermarket|winning bid|you(?:'ve| have) won|you won\b|auction won|high bid of|backorder (?:won|capture)|closeout|expired auction|expiring domain|premium auction/i;

export function isAuctionAcquisitionMail(subject, text, domainWindow = "") {
  const scoped = `${subject || ""}\n${domainWindow || ""}`;
  if (AUCTION_ACQUISITION.test(scoped)) return true;
  // Order-level wording applies to every name on that invoice (not a per-domain hack).
  return /auction and renewal|domainauction/i.test(String(text || ""));
}

/**
 * Bid + first-year “renewal” on one paid invoice = Bought for.
 * Sav, Namecheap, NameSilo, SnapNames, GoDaddy, DropCatch — any domain.
 */
export function isAcquisitionCheckoutMail(subject, text, domainWindow = "") {
  if (isAuctionAcquisitionMail(subject, text, domainWindow)) return true;
  const hay = `${subject || ""}\n${text || ""}\n${domainWindow || ""}`;
  return /(?:auction|winning bid|you won|aftermarket|closeout|backorder).{0,120}renew(?:al|ed)|renew(?:al|ed).{0,120}(?:auction|winning bid|aftermarket)/is.test(
    hay,
  );
}

/**
 * Global coerce: never leave an acquisition checkout as a renewal.
 * First paid receipt for a name is Bought for even when a line says Renewal
 * (auction platforms bill the first year that way).
 */
export function coerceAcquisitionEventType(eventType, subject, text, domainWindow = "", options = {}) {
  if (eventType !== "renewal" && eventType !== "purchase") return eventType;
  if (isAcquisitionCheckoutMail(subject, text, domainWindow)) return "purchase";
  if (options.isFirstReceipt && eventType === "renewal" && isPaidPurchaseMail(subject, text)) {
    return "purchase";
  }
  return eventType;
}

export const REGISTRATION_PURCHASE =
  /\bregistration\b|domain registered|dns domain|domain won|auction won|you(?:'ve| have) won|\d+\s*year(?:s)?\s+registration|new registration|successfully registered/i;

/** True renewal spend cues (not "Auto-renew on" settings). */
export const RENEWAL_SPEND =
  /\b(?:\d+\s*year\s+)?auto[-\s]?renewal(?:\s+of)?\b|\bdomain renewal\b|\brenewal of\b|\bhas been renewed\b|\bsuccessfully renewed\b|\brenewed\b/i;

export function isNoiseMail(subject, text) {
  const subjectText = String(subject || "");
  const haystack = `${subjectText}\n${text || ""}`;
  if (NOISE_SUBJECT.test(subjectText.trim())) return true;
  if (isPromotionalOfferMail(subjectText, text)) return true;
  if (NOISE_BODY.test(haystack) && !PAID_RECEIPT_HINT.test(haystack)) return true;
  return false;
}

/**
 * Transfer-in fees include ~1 year extension → count as renewal spend.
 * Transfer-away / authorize / outgoing → not spend (unless a separate paid invoice).
 * Push between own accounts at the same registrar is free.
 * Moving a name to a different registrar (Dynadot/NameSilo/GoDaddy transfer-in) is chargeable.
 */
export function isOutgoingTransferMail(subject, text) {
  const hay = `${subject || ""}\n${text || ""}`;
  return /transfer away|outgoing transfer|transfer[\s-]?out\b|transfer out started|authorize or cancel|cancel the domain transfer|you'd like to transfer .+ to another/i.test(
    hay,
  );
}

/** Status / ICANN mail around a transfer — not the paid invoice. */
export function isTransferStatusMail(subject, text) {
  const subjectText = String(subject || "");
  if (/fast transfer deactivation|domain move (?:invitation|completed)|update your domain contact/i.test(subjectText)) {
    return true;
  }
  if (isPaidPurchaseMail(subject, text)) return false;
  const hay = `${subject || ""}\n${text || ""}`;
  return /transfer (?:initiated|complete|status update|notification)|approved domain transfers|completed domain transfers|transfer confirmation|authorization code|auth(?:orization)? code|fast transfer deactivation|whois info for |initiated ownership transfer|processing your payment shortly|important information regarding|domain name transfer request|registrar transfer request|domain transfer is complete|your domain transfer authorization|contact record change/i.test(
    hay,
  );
}

export function extractRegistrarOrderId(subject, text = "") {
  const hay = `${subject || ""}\n${text || ""}`;
  const match = hay.match(/order(?:\s+finished)?(?:\s*\(order)?\s*#?\s*(\d{5,})/i);
  return match?.[1] || "";
}

export function isIncomingTransferSpend(subject, text) {
  if (isOutgoingTransferMail(subject, text)) return false;
  if (isDomainPush(subject, text)) return false;
  if (isTransferStatusMail(subject, text)) return false;
  const hay = `${subject || ""}\n${text || ""}`.toLowerCase();
  // NameSilo/Dynadot paid invoice for the gaining registrar (often "Thank you for your order"
  // / "Order Finished") — body may say Transfer after the snippet is truncated.
  if (isPaidPurchaseMail(subject, text)) return true;
  if (
    /transfer complete|incoming transfer|transfer[\s-]?in\b|transferred to your account|has been transferred to (?:you|your)|transfer into/i.test(
      hay,
    )
  ) {
    return true;
  }
  return /transfer/i.test(hay) && !/transfer away|outgoing/i.test(hay);
}

/** Auction win + receipt for the same bid are one purchase, not a renewal. */
export function isDuplicateInitialPurchase(firstDate, firstUsd, nextDate, nextUsd) {
  const firstTs = Date.parse(firstDate || "") || 0;
  const nextTs = Date.parse(nextDate || "") || 0;
  if (!firstTs || !nextTs) return false;
  const days = Math.abs(nextTs - firstTs) / 86400000;
  if (days > 21) return false;
  const a = Number(firstUsd);
  const b = Number(nextUsd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) < 0.02;
}

export function looksLikeRegistrationPurchase(subject, text, domainWindow = "") {
  const hay = `${subject || ""}\n${text || ""}\n${domainWindow || ""}`;
  return REGISTRATION_PURCHASE.test(hay);
}

export function looksLikeRenewalSpend(subject, text, domainWindow = "") {
  const hay = `${subject || ""}\n${text || ""}\n${domainWindow || ""}`;
  if (isAcquisitionCheckoutMail(subject, text, domainWindow)) return false;
  if (looksLikeRegistrationPurchase(subject, text, domainWindow)) return false;
  if (/auto-renew on/i.test(hay) && /\d+\s*year(?:s)?\s+registration/i.test(hay)) return false;
  return RENEWAL_SPEND.test(hay);
}
