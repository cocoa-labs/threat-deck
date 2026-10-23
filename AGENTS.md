# Repository guidance

Cocoa AI Threat Deck is a single-tenant Next.js application. Use Node 24 LTS and the pinned npm lockfile. Read README.md, DEPLOY.md and docs/SECURITY-ARCHITECTURE.md before changing security boundaries.

Before committing run TypeScript, Biome and ESLint with zero warnings, plus relevant tests. Never load personal environment files in tests. Use the disposable PostgreSQL/Redis stack in compose.test.yml. Preserve migration checksums; add forward-only migrations.

Keep optional features disabled by default and enforce flags at server execution boundaries. Recheck current allowlists, origins and private-file ownership. External publishing must use the draft approval queue. Both use-agent-stream.ts and use-companion-stream.ts must process the same marker types. Keep map layout changes instant; avoid transitions that invalidate canvas sizing. Do not add production URLs, credentials, account defaults or personal data to source, tests, docs or assets.
