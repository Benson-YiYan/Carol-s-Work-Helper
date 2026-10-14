const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
// Offline CSS fixtures: no app code, login credentials or production requests.
(async()=>{
 const css=fs.readFileSync(path.join(__dirname,'..','styles.css'),'utf8');
 const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage(),failures=[];
 try{
 await page.route('**/*',r=>r.abort());
 const fixtures=[
  ['button','<button id="target" class="btn">Button</button>'],
  ['ghost','<button id="target" class="btn btn-ghost">Ghost</button>'],
  ['sidebar toggle','<button id="target" class="mobile-nav-toggle">Menu</button>'],
  ['language','<div class="lang-switch"><button id="target">EN</button></div>'],
  ['navigation','<nav class="nav"><a id="target" href="#">Matters</a></nav>'],
  ['tutorial','<button id="target" class="nav-tutorial">Tutorial</button>'],
  ['drawer close','<div class="mobile-drawer-head"><button id="target">Close</button></div>'],
  ['sync success','<button id="target" class="sync-pill ok">Synced</button>'],
  ['sync error','<button id="target" class="sync-pill error">Error</button>'],
  ['notice close','<button id="target" class="web-notice-close">Close</button>'],
  ['member','<label id="target" class="member-item">Member</label>'],
  ['row','<div id="target" class="row">Matter</div>'],
  ['table row','<table class="grid"><tbody><tr id="target"><td>Matter</td></tr></tbody></table>'],
  ['search','<a id="target" class="search-result">Search</a>'],
  ['calendar','<div id="target" class="calendar-cell">Date</div>'],
  ['settings card','<a id="target" class="settings-entry card">Settings</a>'],
  ['chat close','<button id="target" class="chat-tool-close">Close</button>'],
  ['chat file','<div id="target" class="chat-reference-card chat-file-card">File</div>'],
  ['chat upload','<label class="chat-upload-button"><span id="target">Upload</span></label>'],
  ['chat open','<details class="chat-tool" open><summary id="target">Reference</summary></details>'],
 ];
 for(const custom of [false,true]){
  for(const [name,html] of fixtures){
   await page.setContent('<!doctype html><html class="dark-mode '+(custom?'custom-theme':'')+'" style="--brand-soft:#25364b"><head><style>'+css+'</style></head><body>'+html+'</body></html>');
   const target=page.locator('#target');
   await target.evaluate(el=>{Object.assign(el.style,{position:'static',display:'inline-flex',visibility:'visible',pointerEvents:'auto',opacity:'1',transform:'none',width:'200px',minHeight:'40px'});});
   await page.mouse.move(600,600);
   await target.hover();
   const samples=await target.evaluate(async el=>{
    const out=[];
    for(let i=0;i<22;i++){
     await new Promise(r=>requestAnimationFrame(r));
     const s=getComputedStyle(el);
     out.push({background:s.backgroundColor,image:s.backgroundImage,color:s.color});
    }
    return out;
   });
   await page.mouse.down();
   const active=await target.evaluate(el=>({background:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage}));
   await page.mouse.up();
   for(const sample of [...samples,active]){
    const values=(sample.background.match(/[\d.]+/g)||[]).map(Number);
    const brightness=values[0]*.2126+values[1]*.7152+values[2]*.0722;
    if(brightness>100&&(!values[3]||values[3]>.5)){failures.push(name+' custom='+custom+' bright background '+sample.background);break;}
    if(sample.image!=='none'&&/#fff|255, 242|236, 253/.test(sample.image)){failures.push(name+' pale gradient '+sample.image);break;}
   }
  }
 }
 // Light-mode controls must keep their existing light appearance.
 await page.setContent('<html><head><style>'+css+'</style></head><body><button id="light" class="mobile-nav-toggle">Menu</button></body></html>');
 await page.locator('#light').hover();
 await page.locator('#light').evaluate(async()=>{for(let i=0;i<20;i++)await new Promise(r=>requestAnimationFrame(r));});
 assert.equal(await page.locator('#light').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(240, 244, 249)');
 assert.deepEqual(failures,[],'dark hover/press transition must never flash a light surface');
 console.log((fixtures.length*2)+' dark interaction cases passed, including transition frames; light hover unchanged.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
