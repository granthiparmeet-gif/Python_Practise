# Domain Ledger

Single-page MVP for tracking:

- domain inventory
- renewals and purchases
- registrar spending
- Gmail receipt parsing
- merged registrar sync from Dynadot, NameSilo, and Unstoppable Domains
- merged registrar sync from Dynadot, NameSilo, Sav, Spaceship, and Unstoppable Domains
- Gmail OAuth + acquisition cost extraction
- one-time backend Gmail setup via `npm run gmail:setup`

## Run

1. Copy `.env.example` to `.env`
2. Fill in your keys
3. Run `npm start`
4. Open `http://localhost:3001`
5. Run `npm run gmail:setup` once to authorize Gmail

## Current State

- localStorage-backed UI state
- merged domain list from five providers
- provider failures are isolated
- backend server that reads local `.env`
- Gmail tokens are stored locally in `.gmail-tokens.json`
- Gmail access is refreshed automatically using the stored refresh token

## Environment

Use these variables in `.env`:

- `DYNADOT_API_KEY`
- `DYNADOT_SECRET_KEY`
- `DYNADOT_BASE_URL`
- `NAMESILO_API_KEY`
- `NAMESILO_BASE_URL`
- `SAV_API_KEY`
- `SAV_BASE_URL`
- `SPACESHIP_API_KEY`
- `SPACESHIP_API_SECRET`
- `SPACESHIP_BASE_URL`
- `UD_MCP_API_KEY`
- `UD_API_BASE_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GMAIL_QUERY_FILTERS`
- `GMAIL_SCAN_LIMIT`
- `PORT`

## Official Docs

### Dynadot

- API page: https://www.dynadot.com/domain/api
- API settings page: https://www.dynadot.com/account/domain/setting/api.html
- API endpoint base used by the app: https://api.dynadot.com/api3.json

### NameSilo

- API reference: https://www.namesilo.com/api-reference
- API endpoint base used by the app: https://www.namesilo.com/api

### Sav

- Postman docs: https://documenter.getpostman.com/view/9688716/TzzANHFJ
- API docs: https://documenter.getpostman.com/view/9688716/TzzANHFJ
- API endpoint used by the app: https://api.sav.com/domains_api_v1/get_active_domains_in_account
- Auth header: `APIKEY: <your key>`

### Spaceship

- API docs: https://docs.spaceship.dev/
- API endpoint used by the app: https://spaceship.dev/api/v1/domains
- Auth headers: `X-API-Key` and `X-API-Secret`

### Unstoppable Domains

- User API overview: https://docs.unstoppabledomains.com/user-api/overview
- User API OpenAPI docs: https://docs.unstoppabledomains.com/apis/user-api/openapi
- Portfolio list reference: https://docs.unstoppabledomains.com/apis/user-api/openapi/portfolio/portfoliolist.md
- API endpoint base used by the app: https://api.unstoppabledomains.com/mcp/v1/actions/ud_portfolio_list

## API Operations Used

- Dynadot: `list_domain`
- NameSilo: `listDomains`
- Sav: `get_active_domains_in_account`
- Spaceship: `GET /v1/domains`
- Unstoppable: `ud_portfolio_list`

## Next Backend Step

When you want, I can wire in:

- persistent database storage
- automated receipt matching and review queue
- deeper per-domain detail fetches for each registrar
