# Contributing

Use Node 24 LTS and `npm ci`. Make a focused change with tests for changed behavior. Follow existing TypeScript strictness and keep both agent streaming hooks' marker handling equivalent. Use shared server services for internal data calls rather than HTTP calls back into authenticated routes.

Before submitting, run `npm run typecheck`, `npm run check`, `npm run lint`, `npm run test:unit`, integration tests, the production build, browser tests and the container smoke check. Both linters must report zero warnings. CI uses a disposable database and no production credentials.

```sh
docker compose -f compose.test.yml up -d --wait
npm run test:db:prepare
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
docker compose -f compose.test.yml down -v
```

Never add real credentials, private URLs, personal screenshots, customer records or production dumps. Use `example.org` identities and synthetic fixtures. Add forward-only migrations; do not modify existing migration files. Capability checks belong in server routes and execution paths. Preserve ownership checks and approval gates. Network responses, feeds, model output, URLs and attachments are untrusted data.

Contributions are accepted under Apache-2.0. By submitting a contribution, you confirm you have the rights to license it accordingly. Do not add third-party material without attribution and compatible redistribution terms. Security reports belong in the private reporting channel in SECURITY.md, not a public issue or pull request.

Static analysis uses a pinned Semgrep release and rule commit. `.github/security-baseline.json` records individually reviewed findings and parser limitations, tied to full-file SHA-256 hashes. Changes to those files require a fresh security review; do not automatically regenerate the baseline to make CI pass. CodeQL additionally runs on the public repository.
