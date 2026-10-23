# Database migrations

Run `npm run db:migrate` before starting a new app version. Compose runs the same runner in its one-shot migrate service. The runner applies numbered SQL files in order, in transactions, and records SHA-256 checksums. Applied SQL files must never be edited. Create a forward-only migration with `npm run db:migrate:make -- descriptive_name`. Check state with `npm run db:migrate:status`.

Fresh installations skip demo seed migrations 003 and 007 unless `INSTALL_DEMO_DATA=true` is set before first migration. Their unchanged checksums are recorded so subsequent upgrades remain compatible. Existing installations keep their data. Back up before upgrades; test restoration and the migration on a disposable copy. Never use production data in public test fixtures.

The snapshots in src/lib/db are reference/demo resources; changing them does not upgrade a database. The migration files are the operational source of truth. There is no automatic rollback; do not run destructive volume resets against operational data.
