# Domain Ledger

Gmail-first portfolio tracker for domain purchases, renewals, transfers, and removals.

**Gmail** is the source of truth for which domains you own and for all table fields (bought for, renewals, total spent, bought on, holding, registrar hint).

**Registrar APIs** only confirm whether a domain is still present at Dynadot, NameSilo, Spaceship, or Unstoppable. Domains confirmed by API show a **★** next to the name. There is no Sav API integration (Sav spend still comes from Gmail receipts).

## How it works

1. Sync Gmail once (or periodically) to parse registrar emails into a local event ledger (SQLite).
2. Refresh the UI: active rows are built from Gmail events.
3. Registrar APIs are queried only to mark presence (`apiConfirmed` → ★).
4. If Gmail suggests a domain was removed but an API still lists it, the domain stays active (guards against mistaken registrar drops).
5. Domains that exist only at a registrar with no Gmail history are **not** added to the main table.

## Run

1. Copy `.env.example` (or `secrets/config.env.example`) to `secrets/config.env` and fill in keys.
2. `npm start`
3. Open `http://127.0.0.1:3001`
4. One-time Gmail auth: `npm run gmail:setup` (or `npm run gmail:setup -- other@gmail.com`)
5. In the UI, click **Sync Gmail**, then refresh.
6. `npm run doctor` — confirms keys and mailboxes without printing secrets.

### Move to another PC

Secrets are meant to travel as one private folder, not as git:

```bash
npm run pack:secrets -- --with-db
```

Copy `secrets-bundle/` privately to the new machine (USB / encrypted drive). Restore:

```bash
mkdir -p secrets/gmail
cp secrets-bundle/config.env secrets/config.env
cp secrets-bundle/gmail/*.json secrets/gmail/
cp secrets-bundle/.gmail-tokens.json .
cp secrets-bundle/.domain-ledger.db .   # optional, keeps history
npm start
npm run doctor
```

Do not commit `secrets/config.env`, `secrets/gmail/*.json`, `.gmail-tokens.json`, or `.domain-ledger.db`.

## Receipt wording (purchase / renewal / transfer)

## Receipt wording (purchase / renewal / transfer)

Phrase templates live in `gmail/phrases.js`. Classification is **subject-first**, ignores reminders/listings/3DS noise, and treats paid receipts with renewal-only line items as renewals.

- **Purchase cues:** Order Finished, Thank you for your purchase/order, Products Purchased, domain registration / Registration, domain won / auction won, receipts, order summary / 1 year registration, etc.
- **Renewal cues:** Auto Renewal, 1 Year Auto Renewal, domain renewal, successfully renewed (line-item type beats footer “renewals” copy).
- **Transfer cues:** Transfer Away, domain transfer, incoming/outgoing transfer.
- **Ignored noise:** WHOIS reminders, grace-period / expire reminders, Afternic listing, nameserver updates, 3DS verification, Order Received / Auto-Renew Order Submitted (wait for Order Finished).

**Money:** always prefer **Order Total / Final cost** (post tax & discount). For multi-domain receipts, allocate that total by each domain’s line share (or split evenly if line prices are missing). Auction wins count as Bought for. First paid receipt for a new domain is treated as registration unless the line clearly says renewal/transfer. **Incoming transfer fees count as renewals** (same spend/year extension as a renewal); transfer-away / authorize mail does not.

These rules live in `gmail/rules.js` and apply to **every domain and registrar** (sync, ledger, probe scripts) — not one-off product logic.

INR amounts are converted to USD with the **historical** USD/INR rate for the receipt date (Frankfurter → `.fx-rates.json`).

Discover / retune phrases against live mail:

```bash
npm run gmail:phrases:sample      # 5 full messages
npm run gmail:phrases:subjects    # tally phrases across ~200 registrar emails
node scripts/discover-gmail-phrases.mjs counts
```

## UI notes

Use the **View** dropdown (one entry per Gmail mailbox, plus sold / expired / expenses):

1. Domains at each connected/configured mailbox (add more anytime in `data/mailboxes.js` or `GMAIL_MAILBOXES`)
2. **Domains sold** — bought-at / sold-at, sold-for (gross), after commission (net), cost, renewals, profit
3. **Domains expired** — historic seed + Gmail removals/expiries (not sold)
4. **Other expenses** — Hostinger, DotDB, NameBio, Crunchbase, LinkedIn, VPN, etc.

Connect another inbox (same flow for a 3rd or 4th Gmail):

```bash
# secrets/config.env
# GMAIL_MAILBOXES=parmeetsgranthi@gmail.com:Parmeet,letsliterate@gmail.com:Nainjeet,third@gmail.com:Third
# REGISTRAR_ACCOUNT_MAP=parmeet5:parmeetsgranthi@gmail.com,dynadotlogin:third@gmail.com
# DYNADOT_API_KEYS=letsliterate@gmail.com=KEY,third@gmail.com=KEY

npm run gmail:setup -- third@gmail.com
```

Put the Google OAuth client in `secrets/gmail/third@gmail.com.json`. New domains do **not** need to be added to a hardcoded list — Gmail discovery + registrar APIs pick them up. Classification (buy / renew / transfer / sale / ignore) lives in `gmail/rules.js` and applies to every name.

**Secrets live in one folder** (`secrets/`):

| Path | Purpose |
|------|---------|
| `secrets/config.env` | All API keys (Dynadot, NameSilo, Spaceship, …) |
| `secrets/gmail/<email>.json` | Per-mailbox Google OAuth client id/secret |
| `secrets/gmail/_raw/` | Original Google `client_secret_*.json` downloads |

Tokens are stored **per mailbox** in `.gmail-tokens.json`. Sync Gmail runs across every connected inbox.

- **★ filled pill** = confirmed by a registrar API (multi-color by registrar).
- **Outline / frosted pill** = Gmail-only / no API confirmation (same tone family, different treatment).
- Domains removed in the last **30 days** still appear under their mailbox view.
- **Add / edit entry** writes a manual ledger row when Gmail missed something.
- **Expires:** ★ domains use registrar API expiry (Gmail as fallback). No-star domains use Gmail only (parsed from receipts/reminders, or estimated from purchase/renewal dates).
- USD / INR toggle uses historical FX rates (Frankfurter), cached in `.fx-rates.json`.

### Reminder idea (next step)

Critical notices (expiry ≤30 days, sale payout, insufficient-balance renewals) can later email a digest to you via Gmail API send, or a webhook (Telegram/Slack). Needs your preferred channel + optional SMTP/API key — not wired yet.

## Environment

Registrar presence APIs:

- `DYNADOT_API_KEY`, `DYNADOT_SECRET_KEY`, `DYNADOT_BASE_URL`
- Extra Dynadot accounts: `DYNADOT_API_KEYS=mailbox@gmail.com=KEY,...` (legacy `DYNADOT_API_KEY_LETSLITERATE` still works). Gold ★ only when that mailbox’s API lists the name.
- `REGISTRAR_ACCOUNT_MAP=registrarlogin:mailbox@gmail.com` maps Dynadot `(account …)` receipts to Gmail.
- `NAMESILO_API_KEY`, `NAMESILO_BASE_URL`
- `SPACESHIP_API_KEY`, `SPACESHIP_API_SECRET`, `SPACESHIP_BASE_URL`
- `UD_MCP_API_KEY`, `UD_API_BASE_URL`

Gmail:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `GMAIL_QUERY_FILTERS`, `GMAIL_SCAN_LIMIT`, and related scan knobs in `.env.example`

App:

- `PORT` (default `3001`)

## Local files (gitignored)

| File | Purpose |
|------|---------|
| `secrets/config.env` | API keys (preferred) |
| `secrets/gmail/<email>.json` | Per-mailbox Google OAuth |
| `.env` | Optional override |
| `.gmail-tokens.json` | OAuth tokens |
| `.domain-ledger.db` | Gmail event ledger (SQLite) |
| `.fx-rates.json` | USD/INR rate cache |
| `.domain-ledger-state.json` | Prior registrar snapshots (presence / removals) |

## API operations used (presence only)

- Dynadot: `list_domain`
- NameSilo: `listDomains`
- Spaceship: `GET /v1/domains`
- Unstoppable: portfolio list

Sav domains appear via Gmail receipts only (`support@sav.com`), not via API.
