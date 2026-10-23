# Privacy, retention and provider costs

Threat Deck is self-hosted. The maintainers do not operate a telemetry receiver or require access to an installation. Your hosting provider, reverse proxy, network, database and enabled integrations may still process data. Mapbox, video embeds and external links contact third parties from the browser.

## Data boundaries

- **Local browser:** layout preferences and recent agent messages/briefs persist in localStorage. Clear site storage when leaving a shared device. Logout does not erase browser history, downloaded files or all localStorage.
- **PostgreSQL:** intelligence, saved briefs/conversations, drafts, audit events, attachments metadata, parsed file content, generated-media metadata, OAuth tokens (encrypted), jobs and budget reservations persist. Operators in one installation share most dashboard data. Attachments and private media content routes also enforce owner checks.
- **Redis:** caches, rate windows, session-issued WebSocket ticket IDs and feed state persist according to TTLs. Compose enables persistence for operational Redis.
- **Private Blob:** original uploads, optimized model inputs and unpublished generated media remain in your private store. Possession of a URL is not authorization. Explicit approved publication may copy bytes to X or email recipients; those external copies follow the recipient/provider's retention rules.
- **AI:** enabled requests can send conversation text, selected feed/source content, tool results, and selected attachment content to Anthropic. Image generation sends prompts/context to OpenAI; video generation sends prompts/context to the configured video provider. Provider retention/training policies depend on your account and contract.
- **Email/Gmail:** Resend handles login email and, when enabled, outbound messages. Gmail access uses your delegated account and mailbox; read content can enter AI context. Use a dedicated mailbox and minimum scopes.
- **X:** enabling OAuth permits posting with the account/scopes shown at consent. Public posting requires review. Feed reads may consume paid API credits.

## Retention

There is no comprehensive automatic retention policy in v0.1.0. Some caches and temporary jobs expire, but saved database rows, audit logs, private objects and backups may persist indefinitely. Deleting an attachment through the application is best-effort across database and object storage. Set your own database/object lifecycle and backup retention policies, verify deletion, and clear browser storage separately. Disconnecting an integration does not delete copies already held by its provider.

## Costs and limits

AI and media are opt-in. Budgets are reserved atomically in PostgreSQL before provider attempts, with a four-call concurrency limit and a rolling 24-hour reservation window. Failure to enforce a budget or rate limit denies the operation. Failed attempts still consume reserved allowance. Reservations are deliberately conservative and are **not a billing ledger**: model/provider pricing, retries, video duration and external account activity can change actual invoices. Configure provider-side hard limits too. `IMAGE_RESERVATION_USD` and `VIDEO_RESERVATION_USD` must cover the selected provider configuration; remote video setups reserve on both the caller and worker. External collectors, Mapbox, storage, hosting, email and X can incur separate costs outside AI/media budgets.

## Public feeds

`ENABLE_PUBLIC_FEED` is off by default. Enabling it publishes the Cyber Wire pages/RSS from selected database intelligence. Review feed contents and upstream redistribution rights first. Do not place private incident, organization, customer or employee details in feed-visible records. This source release does not enable or host a public feed for you.
