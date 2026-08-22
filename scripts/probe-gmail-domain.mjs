/**
 * Probe Gmail receipts for specific domains using the same classifiers as Sync.
 * Usage: node scripts/probe-gmail-domain.mjs domain1.com domain2.com ...
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDomainGmailQuery,
  classifyDomainTransaction,
  extractMoneyForDomain,
  fetchGmailMessages,
  getValidGmailAccessToken,
  listGmailMessageIds,
  parseGmailMessage,
} from "../gmail/index.js";
import { classifyDomainLineType, extractDomainOrderMoney } from "../gmail/receipts/parse.js";
import { isIncomingTransferSpend } from "../gmail/rules.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadDotEnv(path.join(root, ".env"));

const domains = process.argv.slice(2);
if (!domains.length) {
  console.error("Usage: node scripts/probe-gmail-domain.mjs domain1.com [domain2.com ...]");
  process.exit(1);
}

const accessToken = await getValidGmailAccessToken();
if (!accessToken) {
  console.error("Gmail not connected. Run npm run gmail:setup");
  process.exit(1);
}

for (const domain of domains) {
  console.log(`\n========== ${domain} ==========`);
  const query = buildDomainGmailQuery(domain);
  console.log("query:", query);
  const ids = await listGmailMessageIds(accessToken, query, 30);
  console.log(`messages found: ${ids.length}`);
  if (!ids.length) continue;

  const messages = await fetchGmailMessages(accessToken, ids.slice(0, 12), new Map());
  messages.sort((a, b) => {
    const dateA = String(parseGmailMessage(a).date || "");
    const dateB = String(parseGmailMessage(b).date || "");
    return dateA.localeCompare(dateB);
  });

  let spendSeen = 0;
  for (const message of messages) {
    const parsed = parseGmailMessage(message);
    const type = classifyDomainTransaction(parsed.subject, parsed.text, domain, {
      isFirstReceipt: spendSeen === 0,
    });
    const money = extractMoneyForDomain(parsed.subject, parsed.text, domain, type || "purchase");
    const orderMoney = extractDomainOrderMoney(parsed.text, domain);
    const lineType = classifyDomainLineType(parsed.text, domain, parsed.subject);
    if (type === "purchase" || type === "renewal" || type === "transfer") spendSeen += 1;

    console.log("---");
    console.log("id:", message.id);
    console.log("date:", parsed.date);
    console.log("from:", parsed.from);
    console.log("subject:", parsed.subject);
    console.log("classify:", type);
    console.log("lineType:", lineType || "");
    console.log("money(domain):", money);
    console.log("money(orderAlloc):", orderMoney);
    if (type === "transfer") {
      console.log("incomingTransferSpend:", isIncomingTransferSpend(parsed.subject, parsed.text));
    }
    console.log("snippet:", (parsed.text || "").replace(/\s+/g, " ").slice(0, 280));
  }
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
