# v0.1.0

Initial source-only self-hosting release of Cocoa AI Threat Deck, under Apache-2.0. The public Git history starts with a reviewed snapshot. No production data, credentials, historical private commits, deployment targets, screenshots, reports or video artifacts are included.

Security changes include current allowlist checks across APIs/viewers, origin checks, authenticated one-use WebSocket tickets, private owner-scoped files, server-enforced capability flags, conservative atomic budgets, bounded parsers/fetches, draft approval for external publishing, and updated dependencies including the October 2026 Next.js security fixes. SheetJS uses the integrity-pinned official distribution.

Known limitations: single-tenant operation; no comprehensive retention scheduler; hosted/provider accounts must be configured separately; some collectors return labeled fallback data when feeds fail; predictions and AI findings require verification; Mapbox/GSAP and third-party data retain their own terms. Auth.js v5 remains a pinned beta. Optional live email/X/Gmail/media providers are tested with mocks, not with users' production accounts. Source publication does not deploy a hosted application.

Major dependency migrations unrelated to the security fixes (for example Three.js/Sigma rendering changes and the next TypeScript toolchain) are deferred pending dedicated compatibility work. The released lockfile has no npm-audit advisories at verification time; that is not a guarantee against future advisories. Dependabot and CI track subsequent changes.
