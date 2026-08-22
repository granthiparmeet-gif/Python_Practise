/**
 * Load credentials from ./secrets (single folder).
 * This module is tracked in git; secret files themselves are not.
 *
 *   secrets/config.env              — all API keys (KEY=value)
 *   secrets/gmail/<email>.json      — per-mailbox Google OAuth
 *   secrets/gmail/_raw/             — original Google downloads
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

function secretsRoot() {
  return path.join(root, process.env.SECRETS_DIR || "secrets");
}

let loaded = false;

export function getSecretsDir() {
  return secretsRoot();
}

export function loadSecretsEnv() {
  if (loaded) return { ok: true, path: path.join(secretsRoot(), "config.env") };
  const dir = secretsRoot();
  const candidates = [path.join(dir, "config.env"), path.join(root, ".env")];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    applyEnvFile(filePath);
  }
  if (!process.env.SECRETS_DIR) process.env.SECRETS_DIR = "secrets";
  loaded = true;
  return { ok: candidates.some((p) => existsSync(p)), path: path.join(dir, "config.env") };
}

function applyEnvFile(filePath) {
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
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseGoogleClientJson(raw, email = "") {
  if (!raw || typeof raw !== "object") return null;
  const block = raw.installed || raw.web || raw;
  const clientId = String(block.client_id || raw.client_id || "").trim();
  const clientSecret = String(block.client_secret || raw.client_secret || "").trim();
  if (!clientId || !clientSecret) return null;

  const redirectFromFile = Array.isArray(block.redirect_uris) ? block.redirect_uris[0] : "";
  const redirectUri =
    String(raw.redirect_uri || block.redirect_uri || "").trim() ||
    String(process.env.GOOGLE_REDIRECT_URI || "").trim() ||
    "http://127.0.0.1:3001/auth/google/callback";

  return {
    email: normalizeEmail(raw.email || email),
    clientId,
    clientSecret,
    redirectUri,
    projectId: String(block.project_id || raw.project_id || ""),
    type: raw.installed ? "installed" : raw.type || (raw.web ? "web" : "json"),
    // Keep unused field for debugging without exposing secrets.
    hasLoopbackHint: Boolean(redirectFromFile),
  };
}

export function getGoogleOAuthConfig(account = "") {
  loadSecretsEnv();
  const email = normalizeEmail(account);
  const gmailDir = path.join(secretsRoot(), "gmail");

  const candidates = [];
  if (email) candidates.push(path.join(gmailDir, `${email}.json`));
  candidates.push(path.join(gmailDir, "default.json"));

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const parsed = parseGoogleClientJson(JSON.parse(readFileSync(filePath, "utf8")), email);
      if (parsed) {
        parsed.path = filePath;
        return parsed;
      }
    } catch {
      // try next
    }
  }

  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const redirectUri =
    String(process.env.GOOGLE_REDIRECT_URI || "").trim() || "http://127.0.0.1:3001/auth/google/callback";
  if (!clientId || !clientSecret) return null;
  return {
    email,
    clientId,
    clientSecret,
    redirectUri,
    projectId: "",
    type: "env",
    path: "env",
  };
}

export function listGmailOAuthConfigs() {
  loadSecretsEnv();
  const gmailDir = path.join(secretsRoot(), "gmail");
  if (!existsSync(gmailDir)) return [];
  const out = [];
  for (const name of readdirSync(gmailDir)) {
    if (!name.endsWith(".json") || name === "default.json" || name.startsWith("_")) continue;
    const email = normalizeEmail(name.replace(/\.json$/i, ""));
    const config = getGoogleOAuthConfig(email);
    if (config) out.push({ email, configured: true, path: config.path, type: config.type });
  }
  return out;
}

export function secretsHealth() {
  loadSecretsEnv();
  return {
    secretsDir: secretsRoot(),
    configEnv: existsSync(path.join(secretsRoot(), "config.env")),
    gmailClients: listGmailOAuthConfigs(),
    defaultOAuth: Boolean(getGoogleOAuthConfig("")),
  };
}
