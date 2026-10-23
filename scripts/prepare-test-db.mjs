import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const connectionString=process.env.TEST_DATABASE_URL || 'postgresql://test:test-only-password@127.0.0.1:55436/threatdeck_test';
const url=new URL(connectionString);
if(url.pathname!=='/threatdeck_test'||!['localhost','127.0.0.1','postgres'].includes(url.hostname)) throw new Error('Disposable database required');
const result=spawnSync(process.execPath,['--import','tsx','src/lib/db/migrate.ts'],{stdio:'inherit',env:{...process.env,DATABASE_URL:connectionString,TEST_INTEGRATION:'true',INSTALL_DEMO_DATA:'false'}});
if(result.status!==0)process.exit(result.status??1);
const client=new pg.Client({connectionString});await client.connect();
try {await client.query(readFileSync('src/lib/db/aegis-seed.sql','utf8'));}finally{await client.end();}
