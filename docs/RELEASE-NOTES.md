# v0.1.1

Security and privacy maintenance release. Source only; no hosted production deployment changes.

- Synthetic collector fallback is disabled by default. Explicit demo mode labels samples, blocks external publishing and autonomous jobs, and excludes samples from operational ingestion. Cache reads retain source acquisition time; panels and agent context carry provenance rather than treating a fresh poll as fresh evidence.
- Chat, command, brief and attachment state no longer persists in browser localStorage. Legacy records are discarded before the dashboard mounts. Sign-out verifies session removal and clears other tabs. Private files have an owner-scoped management view, immediate access revocation, extracted-content scrubbing, and durable provider cleanup with retries and visible pending status.
- Production CSP uses request nonces and blocks arbitrary inline scripts, inline event handlers and JavaScript eval. Mapbox workers/WebAssembly, local viewer scripts, OAuth completion and named media origins remain supported. HTML is dynamic and must not be CDN-cached.
- Office/spreadsheet ingestion is disabled by default before upload-token issuance, processing and agent use. DOCX, XLS/XLSX, CSV and TSV remain outside the standard picker until parser isolation is provided. The experimental server override is not an OS sandbox.

Upgrade: apply forward migrations 028 and 029 before starting the new version. The original migration checksums remain unchanged. Source caches warm up again. Local chat history is intentionally not migrated. The integrated server retries file cleanup; other deployments must schedule `npm run files:cleanup` or use the Private files retry control. Outstanding upload grants can delay final storage deletion for at least 16 minutes.

Remaining limitations: single tenancy; no comprehensive retention scheduler for all database content/generated media/backups; no automatic recovery of old untracked orphan files or erasure of already-published/provider copies; historical data from older demo-enabled installations needs review. Provider integrations are tested with mocks, and AI/predictions still require human verification. Auth.js remains a pinned beta. Mapbox, GSAP and upstream data retain separate terms. See DEPLOY.md, docs/PRIVACY.md and THIRD_PARTY_NOTICES.md.

# v0.1.0

Initial source-only self-hosting release of Cocoa AI Threat Deck, under Apache-2.0. The public Git history starts with a reviewed snapshot. No production data, credentials, historical private commits, deployment targets, screenshots, reports or video artifacts are included.

Security changes include current allowlist checks across APIs/viewers, origin checks, authenticated one-use WebSocket tickets, private owner-scoped files, server-enforced capability flags, conservative atomic budgets, bounded parsers/fetches, draft approval for external publishing, validated iframe message origins and video IDs, parsed vendor hostnames, bounded CLI ingestion, and updated dependencies including the October 2026 Next.js security fixes. SheetJS uses the integrity-pinned official distribution.

Known limitations: single-tenant operation; no comprehensive retention scheduler; hosted/provider accounts must be configured separately; some collectors return labeled fallback data when feeds fail; predictions and AI findings require verification; Mapbox/GSAP and third-party data retain their own terms. Auth.js v5 remains a pinned beta. Optional live email/X/Gmail/media providers are tested with mocks, not with users' production accounts. Source publication does not deploy a hosted application.

Major dependency migrations unrelated to the security fixes (for example Three.js/Sigma rendering changes and the next TypeScript toolchain) are deferred pending dedicated compatibility work. The released lockfile has no npm-audit advisories at verification time; that is not a guarantee against future advisories. Dependabot and CI track subsequent changes.
