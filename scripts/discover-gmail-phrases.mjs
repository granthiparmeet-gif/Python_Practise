/**
 * Discover purchase / renewal / transfer phrasing from registrar Gmail mail.
 *
 * Modes:
 *   sample   — fetch N full messages (default 5) and print classify + matched phrases
 *   counts   — Gmail resultSizeEstimate for candidate phrases (cheap, no body download)
 *   subjects — list subjects from registrar senders and tally phrase hits
 *
 * Usage:
 *   node scripts/discover-gmail-phrases.mjs sample [limit]
 *   node scripts/discover-gmail-phrases.mjs counts
 *   node scripts/discover-gmail-phrases.mjs subjects [limit]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyDomainTransaction,
  extractMoneyForDomain,
  getValidGmailAccessToken,
  listGmailMessageIds,
  fetchGmailMessages,
  parseGmailMessage,
} from "../gmail/index.js";
import { EVENT_PHRASES, ALL_DISCOVERY_PHRASES, matchPhraseHits } from "../gmail/phrases.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
loadDotEnv(path.join(root, ".env"));

const mode = process.argv[2] || "sample";
const limit = Math.max(1, Number(process.argv[3] || (mode === "sample" ? 5 : 200)) || 5);

const RECEIPT_SENDERS = [
  "orders@dynadot.com",
  "support@namesilo.com",
  "support@sav.com",
  "noreply@name.com",
  "support@name.com",
  "receipts@spaceship.com",
  "notifications@unstoppabledomains.com",
  "noreply@unstoppabledomains.com",
];

const senderClause = `(${RECEIPT_SENDERS.map((s) => `from:${s}`).join(" OR ")})`;

const accessToken = await getValidGmailAccessToken();
if (!accessToken) {
  console.error("Gmail not connected. Run npm run gmail:setup");
  process.exit(1);
}

if (mode === "sample") {
  await runSample(accessToken, limit);
} else if (mode === "counts") {
  await runCounts(accessToken);
} else if (mode === "subjects") {
  await runSubjects(accessToken, limit);
} else {
  console.error("Unknown mode. Use: sample | counts | subjects");
  process.exit(1);
}

async function runSample(token, n) {
  const query = `${senderClause} newer_than:10y`;
  console.log(`SAMPLE mode · limit=${n}`);
  console.log(`query: ${query}\n`);
  const ids = await listGmailMessageIds(token, query, n);
  const messages = await fetchGmailMessages(token, ids, new Map());
  for (const message of messages) {
    const parsed = parseGmailMessage(message);
    const type = classifyDomainTransaction(parsed.subject, parsed.text, "", {
      isFirstReceipt: false,
    });
    const hits = matchPhraseHits(`${parsed.subject}\n${parsed.text}`);
    const money = extractMoneyForDomain(parsed.subject, parsed.text, "", type || "purchase");
    console.log("---");
    console.log("date:", parsed.date);
    console.log("from:", parsed.from);
    console.log("subject:", parsed.subject);
    console.log("classify:", type);
    console.log("money:", money);
    console.log("phraseHits:", hits);
    console.log("snippet:", String(parsed.text || "").replace(/\s+/g, " ").slice(0, 320));
  }
}

async function runCounts(token) {
  console.log("COUNTS mode · resultSizeEstimate per phrase (registrar senders only)\n");
  const rows = [];
  for (const phrase of ALL_DISCOVERY_PHRASES) {
    const q = `${senderClause} ${phrase.q} newer_than:10y`;
    const estimate = await gmailEstimate(token, q);
    rows.push({ type: phrase.type, phrase: phrase.label, estimate, query: q });
    // gentle pacing
    await sleep(120);
  }
  rows.sort((a, b) => b.estimate - a.estimate || a.type.localeCompare(b.type));
  console.log(JSON.stringify({ byType: groupByType(rows), rows }, null, 2));
}

async function runSubjects(token, n) {
  console.log(`SUBJECTS mode · limit=${n}`);
  const query = `${senderClause} newer_than:10y`;
  const ids = await listGmailMessageIds(token, query, n);
  const messages = await fetchGmailMessages(token, ids, new Map());
  const tallies = {
    purchase: Object.create(null),
    renewal: Object.create(null),
    transfer: Object.create(null),
    removal: Object.create(null),
    unclassified: Object.create(null),
    subjects: [],
  };

  for (const message of messages) {
    const parsed = parseGmailMessage(message);
    const type =
      classifyDomainTransaction(parsed.subject, parsed.text, "", { isFirstReceipt: false }) || "unclassified";
    const hits = matchPhraseHits(`${parsed.subject}\n${parsed.text}`);
    for (const hit of hits) {
      tallies[type][hit] = (tallies[type][hit] || 0) + 1;
    }
    tallies.subjects.push({
      date: parsed.date,
      from: parsed.from,
      subject: parsed.subject,
      classify: type,
      hits,
    });
  }

  console.log(
    JSON.stringify(
      {
        scanned: messages.length,
        tallies: {
          purchase: sortCounts(tallies.purchase),
          renewal: sortCounts(tallies.renewal),
          transfer: sortCounts(tallies.transfer),
          removal: sortCounts(tallies.removal),
          unclassified: sortCounts(tallies.unclassified),
        },
        unclassifiedSubjects: tallies.subjects.filter((s) => s.classify === "unclassified").slice(0, 40),
        sampleSubjects: tallies.subjects.slice(0, 25),
      },
      null,
      2,
    ),
  );
}

async function gmailEstimate(token, query) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "1");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gmail list failed HTTP ${response.status}: ${raw.slice(0, 300)}`);
  }
  const data = JSON.parse(raw);
  return Number(data.resultSizeEstimate || 0);
}

function groupByType(rows) {
  const out = {};
  for (const row of rows) {
    if (!out[row.type]) out[row.type] = [];
    out[row.type].push({ phrase: row.phrase, estimate: row.estimate });
  }
  return out;
}

function sortCounts(map) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([phrase, count]) => ({ phrase, count }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
