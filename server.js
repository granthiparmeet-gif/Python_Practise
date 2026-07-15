import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRegistrarDomains } from "./registrars/index.js";
import {
  buildGoogleAuthUrl,
  fetchGmailDomainLedger,
  getGmailStatus,
  handleGoogleCallback,
} from "./gmail/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const host = process.env.HOST || "127.0.0.1";

loadDotEnv(path.join(root, ".env"));

const port = Number(process.env.PORT || 3001);

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/domains") {
    handleDomainSync(res);
    return;
  }

  if (url.pathname === "/api/gmail/status" && req.method === "GET") {
    sendJson(res, 200, getGmailStatus());
    return;
  }

  if (url.pathname === "/auth/google/login" && req.method === "GET") {
    const authUrl = buildGoogleAuthUrl();
    if (!authUrl) {
      sendText(res, 400, "Google OAuth is not configured.");
      return;
    }
    sendRedirect(res, 302, authUrl);
    return;
  }

  if (url.pathname === "/auth/google/callback" && req.method === "GET") {
    handleGoogleCallback(url, res);
    return;
  }

  if (url.pathname === "/api/settings/unstoppable" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) return sendJson(res, 400, { error: "apiKey is required" });
        upsertEnvValue(path.join(root, ".env"), "UD_MCP_API_KEY", apiKey);
        process.env.UD_MCP_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/settings/namesilo" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) return sendJson(res, 400, { error: "apiKey is required" });
        upsertEnvValue(path.join(root, ".env"), "NAMESILO_API_KEY", apiKey);
        process.env.NAMESILO_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/settings/sav" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        if (!apiKey) return sendJson(res, 400, { error: "apiKey is required" });
        upsertEnvValue(path.join(root, ".env"), "SAV_API_KEY", apiKey);
        process.env.SAV_API_KEY = apiKey;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/settings/spaceship" && req.method === "POST") {
    collectBody(req)
      .then((body) => {
        const parsed = parseJson(body);
        const apiKey = String(parsed?.apiKey || "").trim();
        const apiSecret = String(parsed?.apiSecret || "").trim();
        if (!apiKey || !apiSecret) return sendJson(res, 400, { error: "apiKey and apiSecret are required" });
        upsertEnvValue(path.join(root, ".env"), "SPACESHIP_API_KEY", apiKey);
        upsertEnvValue(path.join(root, ".env"), "SPACESHIP_API_SECRET", apiSecret);
        process.env.SPACESHIP_API_KEY = apiKey;
        process.env.SPACESHIP_API_SECRET = apiSecret;
        sendJson(res, 200, { ok: true });
      })
      .catch((error) => sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  if (url.pathname === "/api/health") {
    const gmailStatus = getGmailStatus();
    sendJson(res, 200, {
      ok: true,
      configured: gmailStatus.configured,
      connected: gmailStatus.connected,
      gmailAccount: gmailStatus.gmailAccount,
      lastSync: gmailStatus.lastSync,
      mailboxReadable: gmailStatus.mailboxReadable,
      env: {
        dynadotConfigured: Boolean(process.env.DYNADOT_API_KEY && process.env.DYNADOT_SECRET_KEY),
        namesiloConfigured: Boolean(process.env.NAMESILO_API_KEY),
        savConfigured: Boolean(process.env.SAV_API_KEY),
        spaceshipConfigured: Boolean(process.env.SPACESHIP_API_KEY && process.env.SPACESHIP_API_SECRET),
        unstoppableConfigured: Boolean(process.env.UD_MCP_API_KEY),
        gmailConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
        gmailConnected: gmailStatus.connected,
      },
    });
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.join(root, pathname);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : ext === ".md"
            ? "text/markdown; charset=utf-8"
            : "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Domain Ledger running at http://${host}:${port}`);
});

async function handleDomainSync(res) {
  try {
    const registrarResult = await getRegistrarDomains();
    let domains = registrarResult.domains;
    const providerErrors = [...registrarResult.providerErrors];

    const gmailResult = await fetchGmailDomainLedger(domains);
    domains = gmailResult.domains;

    sendJson(res, 200, {
      source: ["dynadot", "namesilo", "sav", "spaceship", "unstoppable", "gmail"],
      count: domains.length,
      domains,
      providerErrors,
      providers: {
        ...registrarResult.providers,
        gmail: gmailResult.summary,
      },
    });
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

function sendRedirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
}

function sendText(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
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

function upsertEnvValue(filePath, key, value) {
  const content = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const updated = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) updated.push(`${key}=${value}`);
  writeFileSync(filePath, updated.join("\n").replace(/\n+$/, "\n"));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseJson(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
