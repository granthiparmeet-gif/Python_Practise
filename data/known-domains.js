import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getPrimaryMailbox, listMailboxEmails } from "./mailboxes.js";

export { getPrimaryMailbox, listMailboxEmails, listMailboxes, resolveMailboxList } from "./mailboxes.js";

const localInventoryUrl = new URL("./private-known-domains.js", import.meta.url);
const localInventory = existsSync(fileURLToPath(localInventoryUrl))
  ? await import(localInventoryUrl.href)
  : {};

export const MAILBOX_PRIMARY = getPrimaryMailbox();
export const MAILBOX_SECONDARY =
  listMailboxEmails().find((email) => email !== MAILBOX_PRIMARY) || "";
export const SECONDARY_MAILBOX_SEED_DOMAINS =
  localInventory.SECONDARY_MAILBOX_SEED_DOMAINS ?? [];
export const HISTORIC_SEED_DOMAINS = localInventory.HISTORIC_SEED_DOMAINS ?? [];
export const SEED_DOMAINS_BY_MAILBOX = localInventory.SEED_DOMAINS_BY_MAILBOX ?? {};
export const CANCELLED_HIDE_DOMAINS = localInventory.CANCELLED_HIDE_DOMAINS ?? [];

export function defaultMailboxForDomain(domain) {
  return localInventory.defaultMailboxForDomain?.(domain) ?? MAILBOX_PRIMARY;
}

export function allSeedDomains() {
  if (localInventory.allSeedDomains) return localInventory.allSeedDomains();
  const seeded = Object.values(SEED_DOMAINS_BY_MAILBOX).flat();
  return [...new Set([...seeded, ...HISTORIC_SEED_DOMAINS])];
}

export function seedEntriesForMeta() {
  if (localInventory.seedEntriesForMeta) return localInventory.seedEntriesForMeta();
  const entries = [];
  for (const [mailbox, domains] of Object.entries(SEED_DOMAINS_BY_MAILBOX)) {
    for (const domain of domains) entries.push({ domain, mailbox, statusHint: "active" });
  }
  for (const domain of HISTORIC_SEED_DOMAINS) {
    entries.push({ domain, mailbox: MAILBOX_PRIMARY, statusHint: "historic" });
  }
  return entries;
}
