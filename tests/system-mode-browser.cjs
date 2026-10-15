const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const dir=path.resolve(__dirname,'..'),family=dir.includes('Carol'),user=family?'benson':'carlos';
 const server=http.createServer((req,res)=>{
  const f=path.resolve(dir,'.'+(req.url.split('?')[0]==='/'?'/index.html':decodeURIComponent(req.url.split('?')[0])));
  if(!f.startsWith(dir+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(f));}catch{res.writeHead(404);res.end();}
 }).listen(0,'127.0.0.1');
 await new Promise(r=>server.on('listening',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
 try{
  const page=await browser.newPage({colorScheme:'dark'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark-mode')),true,'login follows system by default');
  await page.locator('[data-action="local-login"][data-user="'+user+'"]').click();
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});
   await page.locator('.mobile-nav-toggle').click();
   const identity=page.locator('.mobile-drawer-account');
   await identity.waitFor({state:'visible'});
   assert.equal(await identity.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(24, 34, 47)','whole identity card must be dark, not only Sign out');
   assert.equal(await identity.locator('b').evaluate(el=>getComputedStyle(el).color),'rgb(231, 237, 245)','name remains readable');
   assert.equal(await identity.locator('.avatar').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(36, 49, 68)');
   await identity.hover();
   assert.equal(await identity.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(24, 34, 47)');
   if(process.env.SCREENSHOT_DIR&&width===1280)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,(family?'family':'team')+'-identity-dark.png')});
   await page.locator('.mobile-drawer-head button').click();
  }
  await page.setViewportSize({width:1280,height:900});
  await page.goto(base+'/#/settings/theme');
  assert.equal(await page.locator('[name="colorMode"][value="system"]').isChecked(),true);
  await page.locator('[name="colorMode"][value="light"]').check();
  await page.locator('[data-action="save-theme"] [type="submit"]').click();
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark-mode')),false,'explicit light overrides OS dark');
  await page.locator('[name="colorMode"][value="system"]').check();
  await page.locator('[data-action="save-theme"] [type="submit"]').click();
  await page.reload();
  assert.equal(await page.evaluate(()=>accountPreferences().colorMode),'system','choice survives reload');
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>!document.documentElement.classList.contains('dark-mode'));
  assert.equal(await page.locator('.mobile-drawer-account').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(250, 251, 252)','system light restores original identity background');
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.classList.contains('dark-mode'));
  await page.locator('.mobile-nav-toggle').hover();
  await page.locator('.mobile-nav-toggle').evaluate(async()=>{for(let i=0;i<20;i++)await new Promise(r=>requestAnimationFrame(r));});
  assert.equal(await page.locator('.mobile-nav-toggle').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(48, 61, 79)','actual app menu hover stays dark');
  await page.locator('[name="colorMode"][value="dark"]').check();
  await page.locator('[data-action="save-theme"] [type="submit"]').click();
  await page.emulateMedia({colorScheme:'light'});
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark-mode')),true,'explicit dark overrides OS light');
  await page.evaluate(()=>{session.userId='carol';applyAccountTheme();});
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark-mode')),false,'other account uses own mode');
  assert.equal(await page.evaluate(()=>accountPreferences().colorMode),'system');
  await page.evaluate(()=>{
   const owner=currentUser().id;
   matters=[{id:'layout-test',no:'TEST',client:'Temporary client',title:'Temporary layout',area:PRACTICE_AREAS[0].id,owner,team:[owner],stage:STAGES[0],status:'green',next:'Temporary step',nextOwner:owner,due:'2026-10-30',waiting:'none',files:[],steps:[],notes:'Temporary notes'}];
   logs=[];go('#/matters');state.modal={type:'new-matter'};render();
  });
  const fieldOrder=locator=>locator.evaluateAll(fields=>fields.map(el=>{const input=el.querySelector('input[name],select[name],textarea[name],input[data-field],select[data-field],textarea[data-field]');return input&&(input.name||input.getAttribute('data-field'));}).filter(Boolean));
  const newOrder=await fieldOrder(page.locator('[data-action="create-matter"] .field'));
  assert.equal(newOrder[newOrder.indexOf('next')+1],'nextOwner','step assignee immediately follows next step');
  await page.locator('[data-action="create-matter"]').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));});
  const nextBox=await page.locator('[name="next"]').boundingBox(),ownerBox=await page.locator('[name="nextOwner"]').boundingBox();
  assert.ok(Math.abs(nextBox.y-ownerBox.y)<3&&ownerBox.x>nextBox.x,'next step and assignee share a row');
  assert.equal(await page.locator('[name="owner"]').locator('..').locator('label').innerText(),'事项总负责人');
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,(family?'family':'team')+'-new-matter-layout.png')});
  await page.locator('[data-action="close-modal"]').click();
  await page.evaluate(()=>go('#/matters/layout-test/edit'));
  const editOrder=await fieldOrder(page.locator('.matter-edit-pane fieldset .field'));
  assert.deepEqual(editOrder,newOrder,'edit and new matter have identical field ordering');
  assert.equal(await page.locator('[data-field="title"]').inputValue(),'Temporary layout','existing values survive layout change');
  const editNext=await page.locator('[data-field="next"]').boundingBox(),editOwner=await page.locator('[data-field="nextOwner"]').boundingBox();
  assert.ok(Math.abs(editNext.y-editOwner.y)<3&&editOwner.x>editNext.x,'edit step and assignee share a row');
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,(family?'family':'team')+'-edit-matter-layout.png')});
  for(const [language,label] of [['en','Matter owner'],['es','Responsable general del asunto'],['zh','事项总负责人']]){
   await page.locator('[data-action="set-lang"][data-lang="'+language+'"]').click();
   assert.equal(await page.locator('[data-field="owner"]').locator('..').locator('label').innerText(),label);
  }
  assert.deepEqual(errors,[]);
  console.log('Real app: system default, live OS changes, reload, manual override, account isolation and dark hover passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
