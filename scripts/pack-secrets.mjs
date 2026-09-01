#!/usr/bin/env node
/**
 * Copy portable secrets (no git) so you can move this tool to another PC.
 *
 *   npm run pack:secrets
 *   npm run pack:secrets -- --with-db
 *
 * Restore on the new machine: copy files back into secrets/ and the repo root.
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSecretsEnv, getSecretsDir } from "../config/load-secrets.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadSecretsEnv();

const withDb = process.argv.includes("--with-db");
const dest = path.join(root, "secrets-bundle");
const gmailDest = path.join(dest, "gmail");
const secretsDir = getSecretsDir();

mkdirSync(gmailDest, { recursive: true });

const copied = [];
const missing = [];

function copyIfPresent(from, to, label) {
  if (!existsSync(from)) {
    missing.push(label);
    return;
  }
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied.push(label);
}

copyIfPresent(path.join(secretsDir, "config.env"), path.join(dest, "config.env"), "secrets/config.env");
copyIfPresent(path.join(root, ".env"), path.join(dest, "dot-env"), "legacy .env");
copyIfPresent(path.join(root, ".gmail-tokens.json"), path.join(dest, ".gmail-tokens.json"), ".gmail-tokens.json");
copyIfPresent(path.join(root, ".fx-rates.json"), path.join(dest, ".fx-rates.json"), ".fx-rates.json");
if (withDb) {
  copyIfPresent(path.join(root, ".domain-ledger.db"), path.join(dest, ".domain-ledger.db"), ".domain-ledger.db");
}

const gmailDir = path.join(secretsDir, "gmail");
if (existsSync(gmailDir)) {
  for (const name of readdirSync(gmailDir)) {
    if (!name.endsWith(".json") || name.startsWith("_")) continue;
    copyIfPresent(path.join(gmailDir, name), path.join(gmailDest, name), `secrets/gmail/${name}`);
  }
}

const restore = `Restore on the new PC (from this secrets-bundle folder):

  mkdir -p secrets/gmail
  cp config.env secrets/config.env
  cp gmail/*.json secrets/gmail/   # if present
  cp .gmail-tokens.json .          # so you skip re-OAuth
  # optional:
  cp .domain-ledger.db .           # keep existing ledger
  cp .fx-rates.json .

  npm start
  npm run doctor

Add another Gmail later:
  GMAIL_MAILBOXES=... in secrets/config.env
  secrets/gmail/new@gmail.com.json
  npm run gmail:setup -- new@gmail.com
`;

writeFileSync(path.join(dest, "RESTORE.txt"), restore);

console.log(`Packed into ${dest}`);
console.log("Copied:");
for (const item of copied) console.log(`  - ${item}`);
if (missing.length) {
  console.log("Not found (skipped):");
  for (const item of missing) console.log(`  - ${item}`);
}
if (!withDb) console.log("\nLedger DB was not copied. Re-run with --with-db to include .domain-ledger.db");
console.log("\nThis folder is gitignored. Copy it privately (USB / encrypted drive). Do not commit it.");
