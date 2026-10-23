/** Never load developer environment files into a test process. */
if (process.env.TEST_INTEGRATION !== 'true') {
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:1/threatdeck_test';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
}
for (const key of Object.keys(process.env)) {
  if (/(API_KEY|ACCESS_TOKEN|BEARER_TOKEN|CLIENT_SECRET|BLOB_READ_WRITE_TOKEN)$/.test(key))
    delete process.env[key];
}

if (process.env.TEST_INTEGRATION === 'true') {
  const database = new URL(process.env.DATABASE_URL || 'http://invalid');
  if (
    !['127.0.0.1', 'localhost', 'postgres'].includes(database.hostname) ||
    database.pathname !== '/threatdeck_test'
  )
    throw new Error('Integration tests require a disposable threatdeck_test database');
}
