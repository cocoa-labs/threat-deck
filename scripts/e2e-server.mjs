import { spawn } from 'node:child_process';
const env={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'production',PORT:'3302',HOSTNAME:'127.0.0.1',NEXTAUTH_URL:'http://localhost:3302',NEXTAUTH_SECRET:'synthetic-browser-test-secret-not-for-production',ALLOWED_EMAILS:'operator@example.org',DATABASE_URL:process.env.TEST_DATABASE_URL||'postgresql://test:test-only-password@127.0.0.1:55436/threatdeck_test',REDIS_URL:process.env.TEST_REDIS_URL||'redis://127.0.0.1:56380',ENABLE_AI:'false',ENABLE_AUTOMATION:'false',ENABLE_PUBLIC_FEED:'false',ENABLE_OUTBOUND_EMAIL:'false',ENABLE_X_PUBLISHING:'false',ENABLE_GMAIL_ACCESS:'false',ENABLE_MEDIA_GENERATION:'false',NEXT_TELEMETRY_DISABLED:'1'};
const db=new URL(env.DATABASE_URL);if(db.pathname!=='/threatdeck_test'||!['127.0.0.1','localhost'].includes(db.hostname))throw new Error('Disposable test database required');
const child=spawn(process.execPath,['--import','tsx','server.ts'],{env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code??1));
