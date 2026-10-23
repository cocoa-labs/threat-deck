import { expect, test, type BrowserContext } from '@playwright/test';
import { encode } from '@auth/core/jwt';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import WebSocket from 'ws';
const secret='synthetic-browser-test-secret-not-for-production';
test('a real single-use magic-link callback creates a session without an email-provider call', async ({context})=>{
  const token=randomBytes(24).toString('hex');
  const client=new pg.Client({connectionString:process.env.TEST_DATABASE_URL || 'postgresql://test:test-only-password@127.0.0.1:55436/threatdeck_test'});
  await client.connect();
  try { await client.query('INSERT INTO aegis_verification_tokens(identifier,token,expires) VALUES($1,$2,now()+interval \'5 minutes\')',['operator@example.org',createHash('sha256').update(token+secret).digest('hex')]); } finally {await client.end();}
  const url='/api/auth/callback/email?email=operator%40example.org&token='+token+'&callbackUrl=http%3A%2F%2Flocalhost%3A3302';
  await context.request.get(url);
  const session=await context.request.get('/api/auth/session');
  expect((await session.json()).user.email).toBe('operator@example.org');
  const fresh=await context.browser()!.newContext({baseURL:'http://localhost:3302'});
  try {await fresh.request.get(url);expect((await (await fresh.request.get('/api/auth/session')).json())?.user).toBeUndefined();} finally {await fresh.close();}
});
async function operator(context:BrowserContext,email='operator@example.org') {
  const token=await encode({secret,salt:'authjs.session-token',token:{email,name:'Test Operator',sub:email},maxAge:600});
  await context.addCookies([{name:'authjs.session-token',value:token,url:'http://localhost:3302',httpOnly:true,sameSite:'Lax'}]);
}
test('login, API auth, revoked identities and default-disabled public feeds',async({page,context,request})=>{
  await page.goto('/');await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  for(const path of ['/api/data/cves','/api/aegis/cves/view?id=CVE-2024-3094','/api/agent/attachments/00000000-0000-4000-8000-000000000001/content']) expect((await request.get(path)).status()).toBe(401);
  expect((await request.get('/feed/cyber-wire.rss')).status()).toBe(404);
  await operator(context,'revoked@example.org');expect((await context.request.get('/api/data/cves')).status()).toBe(401);
});
test('dashboard panels and geographic, timeline and threat-network lenses',async({page,context})=>{
  await operator(context);await page.goto('/');
  await expect(page.getByText('AI assistance is not configured', {exact:false})).toBeVisible();
  await expect(page.getByRole('toolbar',{name:'Hero lens dock'})).toBeVisible();
  for(const [name,current] of [['CVE timeline tab','CVE'],['Threat network — hierarchical tree','GRAPH'],['Geo visualization tab','GEO']]){
    await page.getByRole('button',{name:/Open hero lens menu/}).click();
    await page.getByRole('button',{name,exact:true}).click();
    await expect(page.getByRole('button',{name:new RegExp('Current lens: '+current)})).toBeVisible();
  }
  expect((await context.request.post('/api/agent/stream',{headers:{origin:'http://localhost:3302'},data:{message:'Test'}})).status()).toBe(503);
  expect((await context.request.post('/api/agent/stream',{headers:{origin:'https://attacker.example'},data:{}})).status()).toBe(403);
});
test('agent streaming renders citations with mocked paid output',async({page,context})=>{
  await operator(context);
  await page.route('**/api/agent/stream',route=>route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'text',data:'Test intelligence. [Source](/api/aegis/cves/view?id=CVE-2024-3094)'})+'\n\ndata: [DONE]\n\n'}));
  await page.goto('/');
  await page.getByPlaceholder(/Ask .* anything/).fill('Summarize the synthetic test');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText('Test intelligence.',{exact:false}).first()).toBeVisible();
  await expect(page.locator('a[href="/api/aegis/cves/view?id=CVE-2024-3094"]').first()).toBeVisible();
});
test('private attachments, media and publishing cannot bypass authentication or capabilities',async({context})=>{
  await operator(context);
  expect((await context.request.get('/api/agent/attachments/00000000-0000-4000-8000-000000000001/content')).status()).toBe(404);
  expect((await context.request.get('/api/outbound/generated-media/999999999999999999/content')).status()).toBe(404);
  expect((await context.request.post('/api/outbound/x/review',{headers:{origin:'http://localhost:3302'},data:{text:'Test'}})).status()).toBe(503);
  expect((await context.request.post('/api/agent/approve',{headers:{origin:'http://localhost:3302'},data:{approvalId:'forged'}})).status()).toBe(410);
  expect((await context.request.post('/api/outbound/drafts/999999999/approve',{headers:{origin:'http://localhost:3302'},data:{publish:true}})).status()).toBe(404);
});
test('the integrated WebSocket server authenticates and rejects ticket replay', async ({context})=>{
  await operator(context);
  const response=await context.request.post('/api/ws/token',{headers:{origin:'http://localhost:3302'}});
  expect(response.status()).toBe(200);const {ticket}=await response.json();
  const connect=(value:string)=>new Promise<WebSocket>((resolve,reject)=>{
    const ws=new WebSocket('ws://localhost:3302/ws',['threatdeck','auth.'+value],{origin:'http://localhost:3302',handshakeTimeout:3000});
    ws.once('open',()=>resolve(ws));ws.once('error',reject);
  });
  const ws=await connect(ticket);ws.close();
  await expect(connect(ticket)).rejects.toThrow();
});

test('publication shows complete recipients and content before an explicit approval', async ({page,context})=>{
  await operator(context);
  const payload={to:['recipient@example.net'],cc:['reviewer@example.net'],bcc:['archive@example.net'],subject:'Synthetic review',bodyMarkdown:'Full message for review. No real email is sent.',mediaIds:[]};
  const draft={id:100000001,channel:'email',headline:'Synthetic review',previewText:'Short preview',status:'drafted',createdBy:'operator@example.org',createdAt:new Date().toISOString(),ageSeconds:1,aiRelevance:null,severity:'low',draftType:'breaking',agentMode:'anchor',sourceAlertId:null};
  let approved=false;
  await page.route('**/api/outbound/drafts?*',route=>route.fulfill({json:{ok:true,drafts:approved?[]:[draft]}}));
  await page.route('**/api/outbound/drafts/100000001',route=>route.fulfill({json:{ok:true,draft:{...draft,draftPayload:payload}}}));
  await page.route('**/api/outbound/drafts/100000001/approve',async route=>{
    expect(route.request().postDataJSON()).toEqual({publish:true,reviewedPayload:payload});
    approved=true;
    await route.fulfill({json:{ok:true,draftId:draft.id,status:'published',channel:'email'}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Toggle conversation'}).click();
  await page.getByRole('button',{name:'Review publication'}).click();
  const review=page.getByRole('region',{name:'Publication preview'});
  for(const address of ['recipient@example.net','reviewer@example.net','archive@example.net']) await expect(review.getByText(address,{exact:false})).toBeVisible();
  await expect(review.getByText(payload.bodyMarkdown,{exact:true})).toBeVisible();
  expect(approved).toBe(false);
  await review.getByRole('button',{name:'Approve and publish'}).click();
  await expect(page.getByText('Email sent to the reviewed recipients.')).toBeVisible();
  expect(approved).toBe(true);
});

test('production CSP uses fresh nonces and blocks injected inline scripts and event handlers',async({page,context})=>{
  await operator(context);
  const response=await page.goto('/');
  const policy=response!.headers()['content-security-policy']!;
  const script=policy.split(';').find(part=>part.trim().startsWith('script-src '))!;
  expect(script).not.toContain("'unsafe-inline'");expect(script).not.toContain("'unsafe-eval'");
  const nonce=script.match(/'nonce-([^']+)'/)![1];
  await expect(page.getByRole('button',{name:'Sign out & clear device'})).toBeVisible();
  const inline=await page.locator('script:not([src])').evaluateAll(elements=>elements.map(el=>(el as HTMLScriptElement).nonce));
  expect(inline.length).toBeGreaterThan(0);expect(inline.every(value=>value===nonce)).toBe(true);
  await page.evaluate(()=>{
    const script=document.createElement('script');script.textContent='document.body.dataset.injected="yes"';document.body.appendChild(script);
    const button=document.createElement('button');button.setAttribute('onclick','document.body.dataset.injected="yes"');document.body.appendChild(button);button.click();button.remove();
  });
  expect(await page.locator('body').getAttribute('data-injected')).toBeNull();
  const other=await context.request.get('/login',{headers:{'x-nonce':'attacker-controlled'}});
  expect(other.headers()['content-security-policy']).not.toContain(nonce);
  expect(other.headers()['content-security-policy']).not.toContain('attacker-controlled');
});
test('legacy local data is discarded and sign-out clears all tabs and the session',async({page,context})=>{
  await operator(context);
  await page.addInitScript(()=>{
    if (!sessionStorage.getItem('fixture-seeded')) {
      localStorage.setItem('threatdeck-agent',JSON.stringify({version:1,state:{messages:[{role:'assistant',content:'PRIVATE LEGACY TRANSCRIPT',timestamp:1}],recentBriefs:[{headline:'PRIVATE LEGACY BRIEF'}]}}));
      localStorage.setItem('klammer-agent','PRIVATE LEGACY COPY');sessionStorage.setItem('fixture-seeded','1');
    }
  });
  await page.goto('/');await expect(page.getByRole('button',{name:'Sign out & clear device'})).toBeVisible();
  await expect(page.getByText('PRIVATE LEGACY TRANSCRIPT',{exact:false})).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('PRIVATE LEGACY');
  const second=await context.newPage();await second.goto('/');await expect(second.getByRole('button',{name:'Sign out & clear device'})).toBeVisible();
  await page.getByRole('button',{name:'Sign out & clear device'}).click();
  await expect(page).toHaveURL(/\/login/);await expect(second).toHaveURL(/\/login/);
  expect((await context.request.get('/api/data/cves')).status()).toBe(401);
  expect(await page.evaluate(()=>localStorage.getItem('threatdeck-agent'))).toBeNull();
  await page.goBack();await expect(page.getByText('PRIVATE LEGACY TRANSCRIPT',{exact:false})).toHaveCount(0);
});
test('Office uploads are rejected before minting storage tokens and are absent from the picker',async({page,context})=>{
  await operator(context);await page.goto('/');
  await expect(page.getByRole('button',{name:'Sign out & clear device'})).toBeVisible();
  const accept=await page.locator('input[type=file]').first().getAttribute('accept');expect(accept).not.toContain('docx');expect(accept).not.toContain('spreadsheet');
  const id='c0de0000-0000-4000-8000-000000000001';
  const response=await context.request.post('/api/agent/attachments/upload',{headers:{origin:'http://localhost:3302'},data:{type:'blob.generate-client-token',payload:{pathname:`agent-attachments/uploads/${id}/sample.docx`,clientPayload:JSON.stringify({id,filename:'sample.docx',contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sizeBytes:10})}}});
  expect(response.status()).toBe(400);expect(await response.json()).toMatchObject({ok:false,error:'office_ingestion_disabled'});
});

test('AEGIS viewers keep their close control under the production CSP',async({page,context})=>{
  await operator(context);
  await page.addInitScript(()=>{window.close=()=>{document.documentElement.dataset.closeAttempt='yes';};});
  await page.goto('/api/aegis/cves/view?id=CVE-2024-3094');
  await page.getByRole('button',{name:'Close Tab',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-close-attempt','yes');
});
