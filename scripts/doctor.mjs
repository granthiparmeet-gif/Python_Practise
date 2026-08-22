#!/usr/bin/env node
/**
 * Print config health without dumping secret values.
 * Usage: npm run doctor
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSecretsEnv, secretsHealth, listGmailOAuthConfigs } from "../config/load-secrets.js";
import { listMailboxes, getPrimaryMailbox } from "../data/mailboxes.js";
import { listDynadotAccounts } from "../registrars/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadSecretsEnv();

const yes = (ok) => (ok ? "yes" : "NO");
const present = (filePath) => existsSync(filePath);

const health = secretsHealth();
const mailboxes = listMailboxes();
const oauth = listGmailOAuthConfigs();
const dynadot = listDynadotAccounts();
const tokensPath = path.join(root, ".gmail-tokens.json");
const dbPath = path.join(root, ".domain-ledger.db");
const bundleHint = path.join(root, "secrets-bundle");

console.log("Domain Ledger — config doctor\n");
console.log(`secrets dir:     ${health.secretsDir}`);
console.log(`config.env:      ${yes(health.configEnv)}  (${path.join(health.secretsDir, "config.env")})`);
console.log(`legacy .env:     ${yes(present(path.join(root, ".env")))}`);
console.log(`gmail tokens:    ${yes(present(tokensPath))}`);
console.log(`sqlite ledger:   ${yes(present(dbPath))}`);
console.log(`fx cache:        ${yes(present(path.join(root, ".fx-rates.json")))}`);
console.log("");
console.log("Keys set (values hidden):");
console.log(`  DYNADOT_API_KEY            ${yes(Boolean(process.env.DYNADOT_API_KEY))}`);
console.log(`  DYNADOT extra accounts     ${dynadot.filter((a) => a.label !== "primary").length}`);
console.log(`  NAMESILO_API_KEY           ${yes(Boolean(process.env.NAMESILO_API_KEY))}`);
console.log(`  SPACESHIP_API_KEY          ${yes(Boolean(process.env.SPACESHIP_API_KEY && process.env.SPACESHIP_API_SECRET))}`);
console.log(`  UD_MCP_API_KEY             ${yes(Boolean(process.env.UD_MCP_API_KEY))}`);
console.log(`  GOOGLE_CLIENT_* fallback   ${yes(Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET))}`);
console.log(`  GMAIL_MAILBOXES            ${yes(Boolean(String(process.env.GMAIL_MAILBOXES || "").trim()))}`);
console.log(`  REGISTRAR_ACCOUNT_MAP      ${yes(Boolean(String(process.env.REGISTRAR_ACCOUNT_MAP || "").trim()))}`);
console.log("");
console.log(`Primary mailbox: ${getPrimaryMailbox() || "(none)"}`);
console.log("Mailboxes:");
for (const box of mailboxes) {
  const oauthFile = oauth.find((item) => item.email === box.email);
  console.log(
    `  - ${box.alias} <${box.email}>${box.primary ? "  [primary]" : ""}${oauthFile ? "  oauth json" : "  missing secrets/gmail/<email>.json"}`,
  );
}
console.log("");
console.log("Dynadot API accounts:");
if (!dynadot.length) console.log("  (none)");
for (const account of dynadot) {
  console.log(`  - ${account.label} → ${account.mailboxHint || "(no mailbox hint)"}`);
}
console.log("");
console.log("Move to another PC:");
console.log("  npm run pack:secrets          # copies keys + oauth json + tokens");
console.log("  npm run pack:secrets -- --with-db   # also copies the SQLite ledger");
console.log(`  copy the folder ${bundleHint} onto the new machine, then:`);
console.log("    cp secrets-bundle/config.env secrets/config.env");
console.log("    cp secrets-bundle/gmail/*.json secrets/gmail/");
console.log("    cp secrets-bundle/.gmail-tokens.json .");
console.log("    npm start");
console.log("");
console.log("Add another Gmail:");
console.log("  1. Add email:Alias to GMAIL_MAILBOXES in secrets/config.env");
console.log("  2. Put OAuth client in secrets/gmail/you@gmail.com.json");
console.log("  3. npm run gmail:setup -- you@gmail.com");
console.log("  4. Optional Dynadot key: DYNADOT_API_KEYS=you@gmail.com=KEY");
console.log("  5. Optional registrar login map: REGISTRAR_ACCOUNT_MAP=acctname:you@gmail.com");
