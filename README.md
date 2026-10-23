# Cocoa AI Threat Deck

A self-hosted cybersecurity intelligence dashboard with CVE and KEV tracking, threat-actor views, news panels, an optional AI analyst, and a review queue for outbound publishing.

**Single tenant:** all allowlisted operators share the dashboard, intelligence, conversations saved on the server, and publishing queue. Attachments and generated media additionally require their owner's session. Use separate installations for separate organizations.

## Quick start with Docker

Requirements: Docker Engine with Compose v2, at least 4 GB RAM (8 GB recommended for builds), and a sender configured with Resend for production magic-link login.

```sh
git clone https://github.com/cocoa-labs/threat-deck.git
cd threat-deck
cp .env.example .env
openssl rand -hex 32  # POSTGRES_PASSWORD
openssl rand -hex 32  # NEXTAUTH_SECRET — use a different value
```

Edit `.env`: set those secrets, `ALLOWED_EMAILS` to your own email, `NEXTAUTH_URL` and `NEXT_PUBLIC_SITE_URL` to your installation's URL, and `RESEND_API_KEY` / `RESEND_FROM_EMAIL` to your verified sender. Use a hex database password so it is safe in the connection URL. Other integrations are optional and default to disabled.

```sh
docker compose up --build -d
docker compose logs -f migrate app
```

Open http://localhost:3002. Compose runs PostgreSQL with pgvector, Redis, a one-shot migration job, and the application with its WebSocket server. Local ports bind to loopback. The application runs as a non-root user. Database and Redis volumes persist across restarts. `docker compose down` keeps data; `down -v` deletes it.

For a public domain, put an HTTPS reverse proxy in front of port 3002. Forward WebSocket upgrades and preserve `Origin`. Keep databases private. See [deployment](DEPLOY.md).

## Native development without paid services

Use **Node 24 LTS**, npm, and Docker. Copy `.env.example` to `.env` and set random `POSTGRES_PASSWORD` / `NEXTAUTH_SECRET`, then:

```sh
npm ci
docker compose up -d postgres redis
cp .env .env.local
# In .env.local, set DATABASE_URL to the local port/password from .env.
# Set AUTH_DEV_BYPASS=true, AUTH_DEV_EMAIL=operator@example.org,
# ALLOWED_EMAILS=operator@example.org, NEXTAUTH_URL=http://localhost:3002.
npm run db:migrate
npm run dev
```

The local login bypass requires an explicit flag, development mode, and a loopback URL. Production always requires authentication. `npm run dev:full` includes WebSockets; `npm run dev` uses HTTP polling. The dashboard starts without AI, X, Gmail, media, or outbound-email credentials. Mapbox needs your own public token to show the basemap. Empty panels and configuration notices are expected before data is ingested. Collectors may show labeled demonstration/fallback data on upstream failure; do not interpret it as live intelligence.

## Optional integrations

Credentials alone never enable optional capabilities. Set the matching flag deliberately:

| Feature | Flag | Additional configuration |
| --- | --- | --- |
| AI analyst | `ENABLE_AI` | Anthropic key; positive daily reservation budget |
| Email publishing | `ENABLE_OUTBOUND_EMAIL` | Verified sender, allowed recipients |
| X publishing | `ENABLE_X_PUBLISHING` | Your X handle, OAuth app, independent encryption key |
| Gmail access | `ENABLE_GMAIL_ACCESS` | Your delegated service account and selected mailbox |
| Images/video | `ENABLE_MEDIA_GENERATION` | Private Blob store, provider key, positive media budget |
| Scheduled jobs | `ENABLE_AUTOMATION` | Scheduler, random `CRON_SECRET`, relevant feature flags |
| Public Cyber Wire | `ENABLE_PUBLIC_FEED` | Explicit consent to expose the feed's selected database content |

The X composer and agent publishing tools create drafts. Inspect the text, recipients and attachments in the approval queue before approving publication. An edit after review requires another review. Failed or uncertain publication attempts stay claimed to avoid duplicates; review the provider's state before creating a replacement draft. Legacy direct X publication endpoints return HTTP 410.

See [privacy and costs](docs/PRIVACY.md), [security architecture](docs/SECURITY-ARCHITECTURE.md), and [third-party terms](THIRD_PARTY_NOTICES.md).

## Development checks

```sh
npm run typecheck
npm run check
npm run lint
npm run test:unit
docker compose -f compose.test.yml up -d --wait
npm run test:db:prepare
npm run test:integration
npm run build
npm run test:e2e
docker build -t threatdeck:smoke .
```

Tests do not load personal environment files. Integration and browser tests use a disposable `threatdeck_test` database, fake identities, and mocked paid providers. See [contributing](CONTRIBUTING.md).

## License and release scope

First-party source is licensed under [Apache-2.0](LICENSE); [NOTICE](NOTICE) and [third-party notices](THIRD_PARTY_NOTICES.md) apply. Cocoa AI branding is retained; the license does not grant trademark rights. Mapbox, GSAP, fonts, dependencies and external feeds retain their own terms.

The v0.1.0 release publishes source for self-hosting. It does not include a hosted service, production data, credentials, or historical private repository commits. Please report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/cocoa-labs/threat-deck/security/advisories/new).
