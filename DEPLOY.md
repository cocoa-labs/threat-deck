# Deployment

## Supported baseline

Use the supplied Docker Compose stack or Node 24 LTS with PostgreSQL 16 + pgvector and Redis 7. `npm run build` creates the production build; `npm start` runs Next.js and authenticated WebSockets together on port 3002. Start with `.env.example`; supply your own accounts and credentials. No Cocoa deployment target or billing workspace is required.

Keep HTTPS at the reverse proxy. Set `NEXTAUTH_URL` to the exact browser origin (scheme, host, port). Forward `Origin`, WebSocket upgrades and secure cookies; do not cache private API responses. `TRUST_PROXY=true` is appropriate only behind a proxy that discards attacker-supplied forwarding headers. With the default false, anonymous authentication rate limits share the proxy's address bucket.

## Authentication

Set a random secret with at least 32 characters and an explicit `ALLOWED_EMAILS` list. Exact email addresses are recommended. `@example.org` permits every address at that domain. Removing an address invalidates application access even with an existing session; restart all instances after changing environment configuration. Login email needs Resend but does not enable outbound publishing. Development login bypass is rejected in production.

## Database installation and upgrades

`npm run db:migrate` applies numbered migrations transactionally and records SHA-256 checksums. Run it before starting the new app version. Never edit an already applied SQL migration. Back up the database before an upgrade and test restoration. There is no automatic downgrade path.

Fresh installations skip demonstration migrations 003 and 007 by default while recording their original checksums. `INSTALL_DEMO_DATA=true` together with `ENABLE_DEMO_DATA=true` includes them only on a fresh database; do not enable it for operational data. Existing migration checksums remain unchanged. Tests load public example intelligence into a separate disposable database.

Private media introduced by this release is owner-scoped. Old media with no owner remains inaccessible through content routes. Migrating a private installation with old public Blob objects requires moving or deleting those objects at the storage provider: an application upgrade cannot revoke an old public URL. Review old jobs and drafts before enabling automation after an upgrade.

## WebSockets

The integrated server is the simplest deployment. For a separate relay, run the same application image with shared Redis, database, allowlist, `NEXTAUTH_URL` and a random `WS_AUTH_SECRET`; set `NEXT_PUBLIC_WS_URL` at build time to its `wss://` endpoint. Sessions issue one-use, 60-second tickets tied to the browser origin. Tickets are consumed in Redis; outages deny new connections. Connections expire and recheck allowlist membership. Never expose a relay that bypasses this authentication.

## Optional scheduled jobs

No production scheduler is bundled. With `ENABLE_AUTOMATION=true`, configure your scheduler to call only the desired `/api/cron/*` endpoints using `Authorization: Bearer <CRON_SECRET>`. Use an independent random secret, never a session token. Email/X/media jobs additionally require their capability flags. Automation can consume provider budgets and produce drafts. Review queue approval is still required for AI-authored external posts and replies.

## Files and media

Use a **private** Vercel Blob store with a dedicated token. Attachment tokens allow bounded MIME types and file sizes. Content routes require authentication and ownership. Files sent to an AI provider leave your infrastructure; see PRIVACY.md. Video support requires separately installing and authenticating the supported vendor CLI or configuring a protected remote worker. The release does not provision a vendor account or billing workspace. Remote workers also require database and Redis for budget and rate enforcement. Each worker reserves a media budget; account for both caller and worker reservations when sizing a remote setup.

## Operations

Persist and back up PostgreSQL and private object storage. Redis is required for rate limits and WebSocket tickets; expensive mutations fail closed when enforcement is unavailable. `/api/health` is a minimal liveness endpoint and does not disclose integration status. Monitor private logs for database/collector failures. Apply provider-side quotas as well as the application's conservative reservation caps. Rotate secrets on suspected exposure. Never publish `.env`, backups, logs, uploads, browser profiles or screenshots containing operational information.

## Upgrading to v0.1.1

Run `npm run db:migrate` before starting v0.1.1. Forward migrations 028 and 029 introduce durable attachment cleanup and upload-expiry protection; migrations 001–027 retain their original checksums. The cache namespace changes, so source caches warm up again. Legacy local chat/attachment storage is deliberately discarded; review anything you need to retain before upgrading.

Keep `ENABLE_OFFICE_INGESTION=false`. The bounded Office subprocess is not an OS sandbox. Use a separate demonstration database for `ENABLE_DEMO_DATA=true`; that mode blocks external publication and autonomous jobs. Existing databases may contain samples ingested by older versions: inspect those records before enabling publishing. The upgrade does not guess which historical rows should be deleted.

Do not cache HTML containing CSP nonces. The integrated application sets private/no-store responses. A separately hosted relay must appear in `NEXT_PUBLIC_WS_URL` or `CSP_CONNECT_ORIGINS`. Custom HLS streams may require exact additional HTTPS origins for both playlists and segments; avoid scheme-wide or wildcard allowances. AI provider requests run on the server and do not need browser CSP access.

The integrated server retries private attachment deletion automatically. For serverless or plain `next dev`, run `npm run files:cleanup` with the installation’s credentials every minute using your scheduler. It processes ten due jobs per run; failed jobs back off and remain in the database. Deletions can wait for issued upload grants to expire. See [privacy and retention](docs/PRIVACY.md) for backup and legacy-object limits.
