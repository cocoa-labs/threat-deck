import { spawnSync } from 'node:child_process';
const env = {...process.env, TEST_INTEGRATION:'true', DATABASE_URL:process.env.TEST_DATABASE_URL || 'postgresql://test:test-only-password@127.0.0.1:55436/threatdeck_test', REDIS_URL:process.env.TEST_REDIS_URL || 'redis://127.0.0.1:56380'};
const database = new URL(env.DATABASE_URL);
if (database.pathname !== '/threatdeck_test' || !['127.0.0.1','localhost','postgres'].includes(database.hostname)) throw new Error('Disposable threatdeck_test database required');
for (const key of Object.keys(env)) if (/(API_KEY|ACCESS_TOKEN|BEARER_TOKEN|CLIENT_SECRET|BLOB_READ_WRITE_TOKEN)$/.test(key)) delete env[key];
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...process.argv.slice(2)],{stdio:'inherit',env});
process.exit(result.status ?? 1);
