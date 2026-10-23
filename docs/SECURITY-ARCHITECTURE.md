# Security architecture

## Boundaries

All dashboard APIs and AEGIS viewers require an authenticated, currently allowlisted operator. Login/Auth.js callbacks, minimal health, signed Blob completion callbacks, independently authenticated service endpoints, and explicitly enabled public feeds are the narrow exceptions. Mutating browser requests require the configured origin. Service secrets are compared in constant time. API bodies, external reads, parser work and WebSocket messages are bounded.

Optional AI, email, X, Gmail, media, automation and feed capabilities are checked server-side. Model-generated tool inputs are schema-validated. Model content cannot choose an operator identity, enable a tool or bypass its approval requirement. X composition and AI-authored emails/replies stage drafts; an operator reviews the full message, recipients and attachments before approving. Approval atomically compares the reviewed payload with the stored draft; edits made after review prevent publication. Provider state can be ambiguous after a network failure, so publication claims prevent automatic duplicate sends.

WebSocket upgrades validate origin and a one-use session-issued ticket consumed atomically in Redis. Connections, subscriptions, message sizes, rates and output buffering are limited. Existing connections periodically recheck the allowlist and expire.

Private files are stored in a private Blob store and served through owner-scoped authenticated routes with no-store and nosniff headers. Office parsing runs in a bounded subprocess without provider secrets. It is a resource boundary, not an operating-system sandbox; keep the host isolated and dependencies patched. Private file contents can leave the system only through explicitly configured AI processing or approved sharing.

Untrusted external fetching rejects loopback, private, link-local, cloud-metadata and reserved addresses, checks redirects and revalidates DNS at connection time. Upstream bytes and time are bounded. HTML/Markdown links accept only web URLs and local paths; HTML viewers escape database content. SQL inputs use parameter binding or fixed allowlists.

## Limits and residual risks

This is a single-tenant application, not a multi-tenant security boundary. Allowlisted operators share intelligence and the publishing queue. AI and public-feed content require human verification; prompt injection remains possible even when tools cannot publish without approval. A permissive CSP is still needed by map/3D libraries and embedded media; the release does not claim a strict script nonce policy. Availability and costs also depend on upstream providers. Mapbox and GSAP have their own non-Apache terms. See THIRD_PARTY_NOTICES.md.

Security tests cover revoked sessions, origins, disabled tools, legacy approval bypasses, Redis failure, private file ownership, malicious URLs/redirects/DNS changes, WebSocket ticket replay and atomic concurrent budgets. Tests cannot prove absence of vulnerabilities. See SECURITY.md for responsible reporting.
