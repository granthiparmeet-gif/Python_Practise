/**
 * Flexible mailbox registry — add more Gmail accounts anytime.
 * Domains can move between any of these inboxes (push / account change).
 *
 * Per-inbox views: one "Domains at {alias}" row per mailbox.
 * Shared views (sold / expired / expenses): always the union of every mailbox,
 * including a third (or fourth) account added later.
 *
 * Add a new inbox:
 *   1. GMAIL_MAILBOXES=... in secrets/config.env
 *   2. secrets/gmail/<email>.json
 *   3. npm run gmail:setup -- <email>
 *
 * Also:
 *   GMAIL_MAILBOX_ALIASES=a@gmail.com=Parmeet,b@gmail.com=Nainjeet
 *   GMAIL_DEFAULT_MAILBOX=a@gmail.com
 *   REGISTRAR_ACCOUNT_MAP=parmeet5:a@gmail.com,otheracct:c@gmail.com
 */

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadSecretsEnv } from "../config/load-secrets.js";

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function localPart(email) {
  const key = normalizeEmail(email);
  return key.split("@")[0] || key;
}

/** Built-in known accounts (edit this list as you add inboxes). */
const BUILTIN_MAILBOXES = [
  {
    email: "parmeetsgranthi@gmail.com",
    alias: "Parmeet",
    primary: true,
  },
  {
    email: "letsliterate@gmail.com",
    alias: "Nainjeet",
    primary: false,
  },
];

function splitMailboxToken(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const sepIndex = Math.max(text.indexOf("="), text.includes(":") ? text.indexOf(":") : -1);
  if (sepIndex > 0) {
    return {
      email: normalizeEmail(text.slice(0, sepIndex)),
      alias: text.slice(sepIndex + 1).trim(),
    };
  }
  return { email: normalizeEmail(text), alias: "" };
}

function aliasOverrides() {
  const map = new Map();
  for (const item of BUILTIN_MAILBOXES) {
    const email = normalizeEmail(item.email);
    const alias = String(item.alias || item.label || "").trim();
    if (email && alias) map.set(email, alias);
  }
  const raw = String(process.env.GMAIL_MAILBOX_ALIASES || "").trim();
  if (!raw) return map;
  for (const part of raw.split(/[\n,]+/)) {
    const parsed = splitMailboxToken(part);
    if (parsed?.email && parsed.alias) map.set(parsed.email, parsed.alias);
  }
  return map;
}

function resolveAlias(email, explicit = "") {
  const key = normalizeEmail(email);
  const aliases = aliasOverrides();
  return String(explicit || aliases.get(key) || localPart(key) || key).trim();
}

function toMailboxRecord(item, index = 0) {
  const email = normalizeEmail(item?.email);
  const alias = resolveAlias(email, item?.alias || item?.label || "");
  return {
    email,
    alias,
    label: alias,
    primary: Boolean(item?.primary),
  };
}

function mailboxesFromEnv() {
  const raw = String(process.env.GMAIL_MAILBOXES || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\n,]+/)
    .map((value) => splitMailboxToken(value))
    .filter((item) => item?.email)
    .map((item, index) => toMailboxRecord(item, index));
}

function mailboxesFromOAuthFiles() {
  const dir = path.join(process.cwd(), process.env.SECRETS_DIR || "secrets", "gmail");
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name === "default.json" || name.startsWith("_")) continue;
    const email = normalizeEmail(name.replace(/\.json$/i, ""));
    if (!email.includes("@")) continue;
    out.push(toMailboxRecord({ email, alias: resolveAlias(email), primary: false }));
  }
  return out;
}

/**
 * @returns {{ email: string, alias: string, label: string, primary: boolean }[]}
 */
export function listMailboxes() {
  loadSecretsEnv();
  const fromEnv = mailboxesFromEnv();
  const fromFiles = mailboxesFromOAuthFiles();
  const builtin = BUILTIN_MAILBOXES.map((item, index) => toMailboxRecord(item, index));
  const base = fromEnv.length ? fromEnv : builtin;
  const byEmail = new Map();
  for (const item of [...base, ...fromFiles]) {
    const email = normalizeEmail(item.email);
    if (!email) continue;
    if (!byEmail.has(email)) byEmail.set(email, toMailboxRecord(item));
  }

  // Ensure exactly one primary.
  const list = [...byEmail.values()];
  if (!list.some((item) => item.primary) && list.length) {
    list[0].primary = true;
  }
  for (const item of list) {
    if (item.primary) {
      for (const other of list) {
        if (other.email !== item.email) other.primary = false;
      }
      break;
    }
  }
  return list;
}

export function listMailboxEmails() {
  return listMailboxes().map((item) => item.email);
}

export function getPrimaryMailbox() {
  const envDefault = normalizeEmail(process.env.GMAIL_DEFAULT_MAILBOX || "");
  if (envDefault) return envDefault;
  const list = listMailboxes();
  return list.find((item) => item.primary)?.email || list[0]?.email || "";
}

export function isKnownMailbox(email) {
  const key = normalizeEmail(email);
  return listMailboxEmails().includes(key);
}

function registrarAccountMapFromEnv() {
  const map = new Map();
  const raw = String(process.env.REGISTRAR_ACCOUNT_MAP || "").trim();
  if (!raw) return map;
  for (const part of raw.split(/[\n,]+/)) {
    const text = part.trim();
    if (!text) continue;
    const sep = Math.max(text.indexOf("="), text.includes(":") ? text.indexOf(":") : -1);
    if (sep <= 0) continue;
    const account = text.slice(0, sep).trim().toLowerCase();
    const mailbox = normalizeEmail(text.slice(sep + 1));
    if (account && mailbox) map.set(account, mailbox);
  }
  return map;
}

/**
 * Registrar login / Dynadot "(account foo)" → Gmail mailbox.
 * Built from configured mailboxes plus optional REGISTRAR_ACCOUNT_MAP.
 * No per-domain branches.
 */
export function mapRegistrarAccountToMailbox(value) {
  const key = String(value || "")
    .trim()
    .toLowerCase();
  if (!key) return "";
  if (key.includes("@") && isKnownMailbox(key)) return key;
  if (key.includes("@")) return key;

  const extras = registrarAccountMapFromEnv();
  if (extras.has(key)) return extras.get(key);

  for (const box of listMailboxes()) {
    const local = localPart(box.email);
    const alias = String(box.alias || "").toLowerCase();
    if (key === local || key === alias) return box.email;
    if (local && key.includes(local) && local.length >= 5) return box.email;
    if (local && local.includes(key) && key.length >= 6) return box.email;
  }

  const stripped = key.replace(/\d+$/, "");
  if (stripped.length >= 5) {
    const prefixHits = listMailboxes().filter((box) => localPart(box.email).startsWith(stripped));
    if (prefixHits.length === 1) return prefixHits[0].email;
  }

  for (const [account, mailbox] of extras) {
    if (key.includes(account) || account.includes(key)) return mailbox;
  }
  return "";
}

/** Local-part tokens used to parse "account X" wording in receipts. */
export function registrarAccountTokens() {
  const tokens = new Set();
  for (const box of listMailboxes()) {
    const local = localPart(box.email);
    if (local) tokens.add(local);
    if (box.alias) tokens.add(String(box.alias).toLowerCase());
  }
  for (const account of registrarAccountMapFromEnv().keys()) tokens.add(account);
  return [...tokens].filter(Boolean);
}

/** Short name shown in the UI — never the full email. */
export function mailboxAlias(email) {
  const key = normalizeEmail(email);
  if (!key) return "";
  const known = listMailboxes().find((item) => item.email === key);
  if (known) return known.alias || known.label || localPart(key);
  return resolveAlias(key);
}

/** Register an extra mailbox discovered at OAuth time (persists only in tokens; list via merge). */
export function mailboxViewLabel(email) {
  const alias = mailboxAlias(email);
  return alias ? `Domains at ${alias}` : "Domains";
}

/** Sold / expired / expenses are never per-inbox — they collect every Gmail. */
export const SHARED_PORTFOLIO_VIEW_IDS = ["sold", "expired", "expenses"];

export function isSharedPortfolioView(view) {
  return SHARED_PORTFOLIO_VIEW_IDS.includes(String(view || "").toLowerCase());
}

export function sharedPortfolioViewLabel(view) {
  const key = String(view || "").toLowerCase();
  if (key === "sold") return "Domains sold (all Gmail accounts)";
  if (key === "expired") return "Domains expired (all Gmail accounts)";
  if (key === "expenses") return "Other expenses (all Gmail accounts)";
  return "";
}

/**
 * Merge configured mailboxes with any emails already seen in DB / OAuth.
 * @param {string[]} extraEmails
 */
export function resolveMailboxList(extraEmails = []) {
  const byEmail = new Map(listMailboxes().map((item) => [item.email, item]));
  for (const raw of extraEmails || []) {
    const email = normalizeEmail(raw);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, toMailboxRecord({ email, alias: resolveAlias(email), primary: false }));
  }
  const list = [...byEmail.values()];
  const primary = getPrimaryMailbox();
  for (const item of list) {
    item.primary = item.email === primary;
  }
  if (!list.some((item) => item.primary) && list.length) list[0].primary = true;
  return list;
}

// Back-compat aliases used by older modules.
export const MAILBOX_PRIMARY = getPrimaryMailbox();
export const MAILBOX_SECONDARY = listMailboxEmails().find((email) => email !== MAILBOX_PRIMARY) || "";
