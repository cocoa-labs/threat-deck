import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const name=`threatdeck-smoke-${randomBytes(5).toString('hex')}`;
const image=process.env.SMOKE_IMAGE || 'threatdeck:smoke';
const network='threatdeck-release-test_default';
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout.trim();}
try {
  docker(['run','-d','--name',name,'--network',network,'-p','127.0.0.1::3002','-e','DATABASE_URL=postgresql://test:test-only-password@postgres:5432/threatdeck_test','-e','REDIS_URL=redis://redis:6379','-e','NEXTAUTH_URL=http://localhost:3002','-e',`NEXTAUTH_SECRET=${randomBytes(32).toString('hex')}`,'-e','ALLOWED_EMAILS=operator@example.org',image]);
  const port=docker(['port',name,'3002/tcp']).split(':').pop();
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw new Error('Container failed liveness check');
  if(docker(['exec',name,'id','-u'])==='0')throw new Error('Container must not run as root');
  const csrf=await fetch(base+'/api/auth/csrf');
  if(!csrf.ok || typeof (await csrf.json()).csrfToken!=='string')throw new Error('Production login configuration failed');
  if((await fetch(base+'/api/data/cves')).status!==401)throw new Error('Private API accessible');
  if((await fetch(base+'/feed/cyber-wire.rss')).status!==404)throw new Error('Public feed enabled by default');
  console.log('Container smoke passed: non-root, healthy, login configured, APIs closed, public feeds disabled.');
}finally{spawnSync('docker',['rm','-f',name],{stdio:'ignore'});}
