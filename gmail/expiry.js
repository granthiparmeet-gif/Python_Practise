/**
 * Extract domain expiry dates from registrar receipt / notice email bodies.
 */

export function extractExpiryFromGmailText(text, domainName = "", emailDate = "") {
  const body = String(text || "");
  if (!body) return "";

  const name = String(domainName || "").toLowerCase();
  const window = name ? extractDomainWindow(body, name) : body;

  const patterns = [
    /domain\s+expiration\s*:?\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i,
    /expir(?:y|ation|es)\s*(?:date)?\s*:?\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i,
    /expir(?:y|ation|es)\s*(?:date)?\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    /(?:valid(?:ity)?\s+until|expires?\s+on)\s*:?\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/i,
    /(?:valid(?:ity)?\s+until|expires?\s+on)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = window.match(pattern) || body.match(pattern);
    const normalized = normalizeExpiryDate(match?.[1]);
    if (normalized) return normalized;
  }

  // NameSilo-style: "set to expire in 30 days" / "expire in 7 days"
  const relative = window.match(/expir(?:e|es|ing)\s+in\s+(\d+)\s+days?/i) ||
    body.match(/set to expire in\s+(\d+)\s+days?/i);
  if (relative?.[1] && emailDate) {
    const base = Date.parse(emailDate);
    if (!Number.isNaN(base)) {
      const days = Number(relative[1]);
      if (Number.isFinite(days) && days >= 0) {
        return new Date(base + days * 86400000).toISOString().slice(0, 10);
      }
    }
  }

  return "";
}

/**
 * Estimate expiry from purchase date + renewal years when no explicit date exists.
 * Assumes 1-year terms (common for these registrars).
 */
export function estimateExpiryFromLedger({ purchaseDate, renewalCount = 0, lastRenewalDate = "" } = {}) {
  const lastRenewal = normalizeExpiryDate(lastRenewalDate);
  if (lastRenewal) {
    const date = new Date(`${lastRenewal}T00:00:00Z`);
    if (!Number.isNaN(date.getTime())) {
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      return date.toISOString().slice(0, 10);
    }
  }

  const purchase = normalizeExpiryDate(purchaseDate);
  if (!purchase) return "";
  const renewals = Math.max(0, Number(renewalCount) || 0);
  const date = new Date(`${purchase}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  // Purchase covers year 1; each renewal/transfer-in adds another year.
  date.setUTCFullYear(date.getUTCFullYear() + 1 + renewals);
  return date.toISOString().slice(0, 10);
}

export function normalizeExpiryDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(text)) {
    const [y, m, d] = text.split(/[\/\s]/).map(Number);
    if (y && m && d) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return "";
}

function extractDomainWindow(text, domainName) {
  const body = String(text || "");
  const idx = body.toLowerCase().indexOf(String(domainName || "").toLowerCase());
  if (idx < 0) return body;
  return body.slice(Math.max(0, idx - 40), Math.min(body.length, idx + 280));
}
