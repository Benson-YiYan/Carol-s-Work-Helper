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
  assert.deepEqual(errors,[]);
  console.log('Real app: system default, live OS changes, reload, manual override, account isolation and dark hover passed.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
