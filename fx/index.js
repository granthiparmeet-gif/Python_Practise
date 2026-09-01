import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const fxRatesPath = path.join(process.cwd(), ".fx-rates.json");
const frankfurterBase = "https://api.frankfurter.dev/v1";

let memoryCache = null;
const inFlight = new Map();

export function normalizeCurrencyCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw || raw === "$" || raw === "USD" || raw === "US$" || raw === "US DOLLAR") return "USD";
  if (raw === "₹" || raw === "INR" || raw === "RS" || raw === "RS." || raw === "RUPEE" || raw === "RUPEES") {
    return "INR";
  }
  if (raw === "€" || raw === "EUR") return "EUR";
  if (raw === "£" || raw === "GBP") return "GBP";
  return raw;
}

export function formatMoneyAmount(amount, currency = "USD") {
  if (amount === null || amount === undefined || amount === "") return "";
  const numeric = typeof amount === "number" ? amount : Number(String(amount).replace(/,/g, ""));
  if (!Number.isFinite(numeric)) return "";
  const code = normalizeCurrencyCode(currency);
  const text = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
  if (code === "USD") return `$${text}`;
  if (code === "INR") return `₹${text}`;
  if (code === "EUR") return `€${text}`;
  if (code === "GBP") return `£${text}`;
  return `${code} ${text}`;
}

export function normalizeFxDate(value) {
  if (!value) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d+$/.test(text)) {
    const millis = Number(text);
    if (Number.isFinite(millis)) return new Date(millis).toISOString().slice(0, 10);
  }
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

export async function getUsdInrRate(dateValue) {
  const requestedDate = normalizeFxDate(dateValue) || new Date().toISOString().slice(0, 10);
  const cache = loadFxCache();
  if (cache.USD_INR?.[requestedDate]) {
    return cache.USD_INR[requestedDate];
  }

  if (inFlight.has(requestedDate)) {
    return inFlight.get(requestedDate);
  }

  const pending = fetchUsdInrRate(requestedDate)
    .then((entry) => {
      const next = loadFxCache();
      if (!next.USD_INR) next.USD_INR = {};
      next.USD_INR[requestedDate] = entry;
      // Also store under the provider's actual rate date for reuse.
      if (entry.rateDate && entry.rateDate !== requestedDate) {
        next.USD_INR[entry.rateDate] = entry;
      }
      next.updatedAt = new Date().toISOString();
      saveFxCache(next);
      return entry;
    })
    .finally(() => {
      inFlight.delete(requestedDate);
    });

  inFlight.set(requestedDate, pending);
  return pending;
}

export async function convertAmountToUsdInr({ amount, currency, date }) {
  const value = Number(String(amount ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(value)) {
    return {
      usd: null,
      inr: null,
      rate: null,
      rateDate: "",
      sourceCurrency: normalizeCurrencyCode(currency),
    };
  }

  const sourceCurrency = normalizeCurrencyCode(currency);
  const rateEntry = await getUsdInrRate(date);
  const rate = Number(rateEntry?.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Missing USD/INR rate for ${normalizeFxDate(date) || "today"}`);
  }

  if (sourceCurrency === "INR") {
    return {
      usd: Number((value / rate).toFixed(2)),
      inr: Number(value.toFixed(2)),
      rate,
      rateDate: rateEntry.rateDate || normalizeFxDate(date),
      sourceCurrency,
    };
  }

  // Default: treat as USD (and convert unknown currencies as USD best-effort).
  return {
    usd: Number(value.toFixed(2)),
    inr: Number((value * rate).toFixed(2)),
    rate,
    rateDate: rateEntry.rateDate || normalizeFxDate(date),
    sourceCurrency: sourceCurrency === "USD" ? "USD" : sourceCurrency,
  };
}

export function getFxCacheSummary() {
  const cache = loadFxCache();
  const dates = Object.keys(cache.USD_INR || {});
  return {
    path: ".fx-rates.json",
    count: dates.length,
    updatedAt: cache.updatedAt || "",
  };
}

async function fetchUsdInrRate(requestedDate) {
  const url = `${frankfurterBase}/${encodeURIComponent(requestedDate)}?base=USD&symbols=INR`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`FX lookup failed for ${requestedDate}: HTTP ${response.status} ${raw.slice(0, 200)}`);
  }

  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`FX lookup returned invalid JSON for ${requestedDate}`);
  }

  const rate = Number(data?.rates?.INR);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`FX lookup missing INR rate for ${requestedDate}`);
  }

  return {
    rate,
    rateDate: String(data.date || requestedDate).slice(0, 10),
    requestedDate,
    source: "frankfurter",
    fetchedAt: new Date().toISOString(),
  };
}

function loadFxCache() {
  if (memoryCache) return memoryCache;
  if (!existsSync(fxRatesPath)) {
    memoryCache = { USD_INR: {}, updatedAt: "" };
    return memoryCache;
  }
  try {
    const parsed = JSON.parse(readFileSync(fxRatesPath, "utf8"));
    memoryCache = {
      USD_INR: parsed?.USD_INR && typeof parsed.USD_INR === "object" ? parsed.USD_INR : {},
      updatedAt: typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    memoryCache = { USD_INR: {}, updatedAt: "" };
  }
  return memoryCache;
}

function saveFxCache(cache) {
  memoryCache = cache;
  writeFileSync(fxRatesPath, `${JSON.stringify(cache, null, 2)}\n`);
}
