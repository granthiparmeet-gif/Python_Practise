/**
 * Screenshot fingerprints from Prompts for RND.pdf.
 * Each template is a real email type: subject line + common body line + sender.
 * Classification matches these before generic phrasing.
 */

/** Common body lines copied from the PDF screenshots. */
export const RND_BODY_LINES = {
  dynadotRegistration: /-\s*domain registration|\bdomain registration\b[\s\S]{0,40}1\s*year\s*\(\$|result:\s*registered/i,
  dynadotRenewal: /-\s*domain renewal|\bdomain renewal\b[\s\S]{0,40}1\s*year\s*\(\$|1\s*year auto renewal of/i,
  dynadotTransfer: /\btransfer\b[\s\S]{0,40}1\s*year|\bdomain transfer\b/i,
  dynadotPush: /domain change account|owner changed/i,
  savWinningBid: /winning bid for|you have won the auction|high bid of/i,
  savPaidOn: /paid on\s+\d/i,
  savAutoRenewal: /1 year (?:auto[-\s]?)?renewal of|\b1[\s-]?year renewal of\b/i,
  namesiloTransferType: /\btype\b[\s\S]{0,40}\btransfer\b|transfer\s+\d+\s+\$/i,
  fundsOnTheWay: /your funds are on the way/i,
  paymentSent: /we have just sent you a payment/i,
  removedFromAccount: /removed from account|product'?s?\s+been removed/i,
  resultRegistered: /result:\s*registered/i,
};

/**
 * Ordered templates. More specific (from + subject + body) first.
 * action: purchase | renewal | transfer | push | removal | sale | ignore | expiry_notice
 */
export const RND_SCREENSHOT_TEMPLATES = [
  { action: "ignore", from: /unreportedsales/i, subject: /sold for/i },
  { action: "ignore", from: /sedo\.com/i, subject: /waiting to transfer|transfer of domain name sold/i },
  { action: "ignore", subject: /weekly unreported/i },
  { action: "ignore", from: /accounts@dynadot\.com/i, subject: /afternic confirmation needed/i, body: /fast transfer|enroll the domain/i },
  { action: "ignore", from: /service@afternic\.com/i },
  { action: "ignore", from: /afternic/i, subject: /^afternic\s*-\s*\d+/i },
  { action: "ignore", from: /ta@afternic\.com/i, subject: /follow up|\[ ref:_|the transfer for |your transfer of |message about .+ sale/i },
  { action: "ignore", body: /thank you for contacting afternic support|commission rate for your domain|if the domain(?: name)? sales? for/i },
  { action: "ignore", subject: /^order received\b/i },
  { action: "ignore", subject: /auto-renew order submitted/i },
  { action: "ignore", subject: /unable to submit auto-renew/i },
  { action: "ignore", subject: /auto renewal payment issue|attention required:\s*auto renewal/i },
  { action: "ignore", subject: /whois info for/i },
  { action: "ignore", subject: /activate afternic premium/i },
  { action: "ignore", subject: /available for purchase at snapnames/i },
  { action: "ignore", from: /namecheap\.com/i, subject: /you.?ve been outbid|pay now to receive|update your domain contact|domain contacts? update|fast transfer deactivation|domain move (?:invitation|completed)/i },
  { action: "ignore", from: /epik\.com/i, subject: /marketplace listing of|your domains have been updated|name ?liquidate/i },
  { action: "ignore", from: /afternic/i, subject: /opt-in to the afternic premium/i },
  { action: "ignore", subject: /failed to process payment/i },
  { action: "ignore", subject: /^re:\s*.*thank you for your order/i },
  { action: "ignore", from: /sedo\.com/i, subject: /verify your ownership|ownership confirmation|ownership unconfirmed/i },
  { action: "ignore", from: /networksolutions|namepal|web\.com/i, subject: /monthly account statement|confirmation of dns change|action required: notice regarding/i },
  { action: "ignore", from: /snapnames/i, subject: /order confirmation for|important information regarding/i },
  { action: "ignore", from: /hostinger/i, subject: /paying too much|need security updates/i },
  { action: "ignore", from: /google|payments-noreply@google/i, subject: /google workspace/i },
  { action: "ignore", from: /sav\.com/i, subject: /backorder confirmation|upcoming backorders/i },
  { action: "purchase", from: /dynadot/i, subject: /auction payment received/i },
  { action: "ignore", from: /dynadot/i, body: /insufficient (?:usd )?account credit|not sufficient to (?:complete )?the auto-renew/i },

  // Any registrar: auction/aftermarket checkout that also bills a “renewal” year.
  { action: "purchase", body: /auction and renewal|domainauction|winning bid for|you have won the auction|you won\b.{0,80}renew/i },

  // Push — Order Finished + $0 change-account body
  { action: "push", from: /orders@dynadot\.com/i, subject: /order finished/i, body: RND_BODY_LINES.dynadotPush, domainBody: true },

  // Dynadot Order Finished — body line decides type
  { action: "renewal", from: /orders@dynadot\.com/i, subject: /order finished/i, body: RND_BODY_LINES.dynadotRenewal, domainBody: true },
  { action: "transfer", from: /orders@dynadot\.com/i, subject: /order finished/i, body: RND_BODY_LINES.dynadotTransfer, domainBody: true },
  { action: "purchase", from: /orders@dynadot\.com/i, subject: /order finished/i, body: RND_BODY_LINES.dynadotRegistration, domainBody: true },
  { action: "purchase", from: /orders@dynadot\.com/i, subject: /order finished processing/i },

  // Sav
  { action: "purchase", from: /sav\.com/i, subject: /you won/i },
  { action: "purchase", from: /sav\.com/i, body: /backorder capture|backorder won|winning bid for/i },
  { action: "purchase", from: /sav\.com/i, subject: /sav\.com receipt|you won/i, body: RND_BODY_LINES.savWinningBid },
  { action: "renewal", from: /sav\.com/i, subject: /sav\.com receipt/i, body: RND_BODY_LINES.savAutoRenewal, domainBody: true },
  { action: "purchase", from: /sav\.com/i, subject: /sav\.com receipt/i, body: RND_BODY_LINES.savPaidOn },
  { action: "expiry_notice", from: /sav\.com/i, subject: /action required:\s*please renew domain/i },

  // Porkbun / DropCatch / GoDaddy / Namecheap / NameSilo / Spaceship / Name.com / Cosmotown / SnapNames
  { action: "purchase", from: /porkbun\.com/i, subject: /order\s*-\s*thank you/i },
  { action: "expiry_notice", from: /porkbun\.com/i, subject: /domain renewal notice|expired domains/i },
  { action: "purchase", from: /dropcatch\.com/i, subject: /order receipt/i },
  { action: "purchase", from: /godaddy\.com/i, subject: /thank(?:s| you) for your order/i },
  { action: "purchase", from: /namecheap\.com/i, subject: /order summary/i },
  { action: "purchase", from: /namesilo/i, subject: /thank you for your order/i, body: /auction and renewal|domainauction|aftermarket|registration/i },
  { action: "renewal", from: /namesilo/i, subject: /thank you for your order/i, body: /renewal/i, domainBody: true },
  { action: "transfer", from: /namesilo/i, subject: /thank you for your order/i, body: RND_BODY_LINES.namesiloTransferType, domainBody: true },
  { action: "purchase", from: /spaceship\.com/i, subject: /spaceship order/i },
  { action: "purchase", from: /name\.com/i, subject: /order confirmation/i },
  { action: "purchase", from: /cosmotown\.com/i, subject: /new cosmotown order receipt|order receipt/i },
  { action: "purchase", from: /snapnames/i, subject: /you have acquired/i },

  // Expiry reminders (date only)
  { action: "expiry_notice", from: /accounts@dynadot\.com/i, subject: /expires? in \d+\s*days?|expired today|domain expiration notice|submitting auto-renewal order/i },
  { action: "expiry_notice", from: /namesilo/i, subject: /upcoming domain expirations|domains just expired|expired domain notification/i },
  { action: "expiry_notice", from: /spaceship\.com/i, subject: /will expire in \d+\s*days?|your domains expired|\bexpired\b/i },
  { action: "expiry_notice", from: /namecheap\.com/i, subject: /will expire in \d+\s*days?|has expired - reactivate/i },
  { action: "expiry_notice", from: /godaddy\.com/i, subject: /your domain expires soon|time to renew/i },
  { action: "expiry_notice", from: /namebright\.com/i, subject: /expiring domains|expired domains/i },

  // Sales — screenshot senders + subjects
  { action: "sale", from: /accounts@dynadot\.com/i, subject: /\bSOLD\b|proceeds credited/i },
  { action: "sale", from: /ta@afternic\.com|mailmc\.afternic|noreply@afternic/i, subject: /has sold via fast transfer|has sold at afternic|funds are on the way|just sent you a payment/i },
  { action: "sale", from: /dan\.com/i, subject: /transaction closed|buy now|counter[- ]?offer accepted|payment received/i },
  { action: "sale", from: /epik\.com/i, subject: /sold at epik/i },
  { action: "sale", from: /masterbucks\.com/i, subject: /masterbucks payment/i },
  { action: "sale", from: /sedo\.com/i, subject: /congratulations on the sale/i },
  { action: "sale", from: /namecheap\.com/i, subject: /marketplace sale confirmation/i },
  { action: "sale", body: RND_BODY_LINES.paymentSent },

  // Removal
  { action: "removal", from: /accounts@dynadot\.com/i, subject: /removed from account/i, body: RND_BODY_LINES.removedFromAccount },
  { action: "removal", from: /godaddy\.com/i, subject: /product'?s?\s+been removed/i },
  { action: "removal", from: /cosmotown\.com/i, subject: /has expired/i },
];

function domainWindow(text, domainName) {
  const body = String(text || "");
  const name = String(domainName || "")
    .toLowerCase()
    .replace(/\.+$/, "")
    .trim();
  if (!name) return body;
  const lines = body.split("\n");
  const domainToken = new RegExp(`\\b${name.replace(/\./g, "\\.")}\\b`, "i");
  const otherDomain = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/i;
  for (let i = 0; i < lines.length; i += 1) {
    if (!domainToken.test(lines[i])) continue;
    const parts = [];
    if (i > 0 && !otherDomain.test(lines[i - 1])) parts.push(lines[i - 1]);
    parts.push(lines[i]);
    if (lines[i + 1] && !otherDomain.test(lines[i + 1])) parts.push(lines[i + 1]);
    return parts.join("\n");
  }
  const idx = body.toLowerCase().indexOf(name);
  if (idx < 0) return body;
  return body.slice(Math.max(0, idx - 80), idx + 160);
}

/**
 * @returns {string|null} event action from screenshot templates
 */
export function matchRndScreenshotTemplate(subject, text, fromAddress = "", domainName = "") {
  const subjectText = String(subject || "");
  const body = String(text || "");
  const from = String(fromAddress || "");
  const hay = `${subjectText}\n${body}\n${from}`;
  const windowText = domainWindow(body, domainName);

  for (const rule of RND_SCREENSHOT_TEMPLATES) {
    if (rule.from && !rule.from.test(from) && !rule.from.test(hay)) continue;
    if (rule.subject && !rule.subject.test(subjectText)) continue;
    if (rule.body) {
      const probe = rule.domainBody ? `${subjectText}\n${windowText}` : hay;
      if (!rule.body.test(probe)) continue;
    }
    return rule.action;
  }
  return null;
}
