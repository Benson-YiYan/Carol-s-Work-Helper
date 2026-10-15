// Dark mode must never show a near-white surface ("flashbang") on any page.
// Scans every element plus generated ::before/::after content on each route.
const {chromium}=require('playwright'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const ROUTES=['#/','#/matters','#/calendar','#/team','#/inbox','#/chat','#/settings','#/trash'];
const audit=()=>{
 const luminance=color=>{const parts=color.match(/[\d.]+/g);if(!parts)return null;if(parts.length>3&&Number(parts[3])===0)return null;const[r,g,b]=parts.map(Number);return (0.2126*r+0.7152*g+0.0722*b)/255;};
 const found=[];
 const inspect=(el,where)=>{const style=getComputedStyle(el);const box=el.getBoundingClientRect();if(box.width<20||box.height<12)return;const l=luminance(style.backgroundColor);if(l===null||l<=0.55)return;found.push({where,route:location.hash,tag:el.tagName,cls:String(el.className).slice(0,44),background:style.backgroundColor,size:Math.round(box.width)+'x'+Math.round(box.height),text:(el.textContent||'').trim().slice(0,16)});};
 document.querySelectorAll('#app *').forEach(el=>{const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden')return;inspect(el,'element');if(getComputedStyle(el,'::before').content!=='none')inspect(el,'::before');if(getComputedStyle(el,'::after').content!=='none')inspect(el,'::after');});
 return found;
};
(async()=>{
 const dir=path.resolve(__dirname,'..'),family=dir.includes('Carol'),user=family?'benson':'carlos';
 const server=http.createServer((req,res)=>{
  const file=path.resolve(dir,'.'+(req.url.split('?')[0]==='/'?'/index.html':decodeURIComponent(req.url.split('?')[0])));
  if(!file.startsWith(dir+path.sep)){res.writeHead(403);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/json');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 }).listen(0,'127.0.0.1');
 await new Promise(r=>server.on('listening',r));
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
 try{
  const page=await browser.newPage({colorScheme:'dark',viewport:{width:1280,height:900}});
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark-mode')),true,'login follows system by default');
  await page.locator('[data-action="local-login"][data-user="'+user+'"]').click();
  const all=[];
  for(const route of ROUTES){
   await page.evaluate(r=>go(r),route);
   await page.waitForTimeout(200);
   all.push(...await page.evaluate(audit));
  }
  if(process.env.SCREENSHOT_DIR){await page.evaluate(()=>go('#/matters'));await page.waitForTimeout(250);await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,(family?'family':'team')+'-matters-filter-dark.png')});await page.evaluate(()=>go('#/calendar'));await page.waitForTimeout(250);await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,(family?'family':'team')+'-calendar-dark.png')});}
  assert.deepEqual(all,[],'dark mode must not paint near-white surfaces: '+JSON.stringify(all,null,1));
  await page.evaluate(()=>go('#/matters'));
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>!document.documentElement.classList.contains('dark-mode'));
  assert.equal(await page.locator('.toolbar input').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 255, 255)','light mode keeps the white filter input');
  await page.evaluate(()=>go('#/calendar'));
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.calendar-head').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(248, 250, 252)','light mode keeps a light calendar header');
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.classList.contains('dark-mode'));
  console.log('Dark surface audit: no near-white surfaces on '+ROUTES.length+' routes ('+(family?'family':'team')+').');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
