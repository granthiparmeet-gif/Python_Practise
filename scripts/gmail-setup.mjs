import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

loadDotEnv(path.join(root, ".env"));

const port = Number(process.env.PORT || 3001);
const baseUrl = `http://127.0.0.1:${port}`;
const statusUrl = `${baseUrl}/api/gmail/status`;
const healthUrl = `${baseUrl}/api/health`;
const authUrl = `${baseUrl}/auth/google/login`;
const serverScript = path.join(root, "server.js");

let spawnedServer = null;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  cleanup(1);
});

async function main() {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
    throw new Error("GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI must be set in .env.");
  }

  await ensureBackendAvailable();

  console.log(`Opening Gmail authorization at ${authUrl}`);
  const opened = openInBrowser(authUrl);
  if (!opened) {
    console.log(`Open this URL in your browser: ${authUrl}`);
  }

  console.log("Waiting for Gmail authorization callback...");
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = await fetchJson(statusUrl);
    if (status?.connected && status?.mailboxReadable) {
      const health = await fetchJson(healthUrl);
      console.log("Gmail setup complete.");
      console.log(`Account: ${health.gmailAccount || status.gmailAccount || "unknown"}`);
      console.log(`Last sync: ${health.lastSync || status.lastSync || "unknown"}`);
      console.log(`Mailbox readable: ${Boolean(health.mailboxReadable)}`);
      cleanup(0);
      return;
    }
    await sleep(2000);
  }

  throw new Error("Timed out waiting for Gmail authorization. Authorize the app and run the setup command again.");
}

async function ensureBackendAvailable() {
  const reachable = await canFetchJson(healthUrl);
  if (reachable) return;

  spawnedServer = spawn(process.execPath, [serverScript], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await canFetchJson(healthUrl)) return;
    await sleep(1000);
  }

  throw new Error(`Unable to start the backend on ${baseUrl}. Stop any other process on port ${port} and try again.`);
}

function openInBrowser(targetUrl) {
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "darwin"
      ? [targetUrl]
      : platform === "win32"
        ? ["/c", "start", "", targetUrl]
        : [targetUrl];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request to ${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return parseJson(text);
}

async function canFetchJson(url) {
  try {
    await fetchJson(url);
    return true;
  } catch {
    return false;
  }
}

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function cleanup(code) {
  if (spawnedServer && !spawnedServer.killed) {
    spawnedServer.kill("SIGINT");
  }
  process.exit(code);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
