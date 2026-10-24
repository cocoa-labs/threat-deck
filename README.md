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

The local login bypass requires an explicit flag, development mode, and a loopback URL. Production always requires authentication. `npm run dev:full` includes WebSockets; `npm run dev` uses HTTP polling. The dashboard starts without AI, X, Gmail, media, or outbound-email credentials. Mapbox needs your own public token to show the basemap. Empty panels and configuration notices are expected before data is ingested. Collectors return unavailable data on upstream failure unless a real cached snapshot remains. Panel labels use source acquisition time, so polling does not make old data appear live. Synthetic samples require `ENABLE_DEMO_DATA=true`; demo mode labels those records and disables external publishing and autonomous jobs.

## Optional integrations

For a self-hosted custom server (`npm run dev:full` or `npm start`), explicitly set `ENABLE_AEGIS_INGEST=true` to populate the database-backed panels on startup and refresh hourly. This collects public cyber feeds without enabling autonomous AI, email, or publishing. The first NVD import covers the last day of modifications and can take several minutes with the public rate limit; subsequent runs fetch deltas. MITRE profiles do not include analyst-assigned scores, campaign history, or verified activity dates. Those fields remain empty until supported data is supplied. Plain `next dev` and serverless hosting need a separate ingestion runner.

Credentials alone never enable optional capabilities. Set the matching flag deliberately:

| Feature | Flag | Additional configuration |
| --- | --- | --- |
| AI analyst | `ENABLE_AI` | Anthropic key; optional operator-set spending cap |
| Email publishing | `ENABLE_OUTBOUND_EMAIL` | Verified sender, allowed recipients |
| X publishing | `ENABLE_X_PUBLISHING` | Your X handle, OAuth app, independent encryption key |
| Gmail access | `ENABLE_GMAIL_ACCESS` | Your delegated service account and selected mailbox |
| Images/video | `ENABLE_MEDIA_GENERATION` | Private Blob store, provider key; optional operator-set spending cap |
| Scheduled jobs | `ENABLE_AUTOMATION` | Scheduler, random `CRON_SECRET`, relevant feature flags |
| Demonstration samples | `ENABLE_DEMO_DATA` | Separate demonstration installation; disables email/X publishing, jobs and public feeds |
| Public Cyber Wire | `ENABLE_PUBLIC_FEED` | Explicit consent to expose the feed's selected database content |

Office/spreadsheet ingestion is disabled by default, including DOCX, XLS/XLSX, CSV and TSV. The existing subprocess has resource limits but is not an OS sandbox. Leave `ENABLE_OFFICE_INGESTION=false` until you supply filesystem/network isolation; the standard file picker accepts images, PDFs and plain text. The experimental server override is not a supported security boundary.

After a Max response, choose **Post to X**. The composer defaults to one post and attaches the response’s latest generated image. Check or edit the text and attachment, then click **Post to X** in the composer to publish. Success shows a link to the actual X post. **Create image** generates a private preview, and **Refine with Max** explicitly requests an AI rewrite. **Save for later** saves without sending. Earlier drafts remain under **Unsent**, labeled with their creation dates; they do not publish automatically. Agent-created drafts still require full review and explicit approval. The same server-side draft approval, ownership and duplicate-send checks apply to manual posting. If publication is uncertain or partial, check X before creating a replacement; the app does not automatically resend it. Legacy direct publication endpoints remain disabled.

Application spending caps are optional: leave `ANTHROPIC_DAILY_CAP_USD` and `OUTBOUND_VISUAL_DAILY_SPEND_USD_HARD` unset, blank, or `0` for no application cap. Set a positive USD value if you want a rolling 24-hour cap. Your provider's billing and account limits still apply. Upgrades preserve values already present in your own environment; see [the v0.1.2 upgrade instructions](DEPLOY.md#upgrading-to-v012).

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

The v0.1.x releases publish source for self-hosting. It does not include a hosted service, production data, credentials, or historical private repository commits. Please report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/cocoa-labs/threat-deck/security/advisories/new).
