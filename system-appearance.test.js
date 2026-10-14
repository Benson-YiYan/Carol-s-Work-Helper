const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
function setup(value){
 const listeners=[],classes=new Set();
 const media={matches:true,addEventListener:(name,fn)=>{assert.equal(name,'change');listeners.push(fn);}};
 const style={setProperty:()=>{}};
 const c={Map,Set,Date,JSON,Object,setInterval:()=>{},currentUser:()=>({id:'test'}),
  KEY:{lang:'isolated'},load:()=>value,matchMedia:query=>{assert.equal(query,'(prefers-color-scheme: dark)');return media;},
  document:{documentElement:{style,classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)}}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('settings-page.js','utf8'),c);
 const app=fs.readFileSync('app.js','utf8');
 vm.runInContext(app.slice(app.indexOf('const preferenceChecks='),app.indexOf('function navigationItems()')),c);
 return {media,listeners,classes,style,apply:()=>vm.runInContext('applyAccountTheme()',c)};
}
test('system mode follows initial OS scheme and live OS changes',()=>{
 const h=setup({colorMode:'system'});h.apply();
 assert.equal(h.classes.has('dark-mode'),true);
 assert.equal(h.style.colorScheme,'dark');
 assert.equal(h.listeners.length,1,'one listener rather than one per render');
 h.apply();assert.equal(h.listeners.length,1);
 h.media.matches=false;h.listeners[0]();
 assert.equal(h.classes.has('dark-mode'),false);
 assert.equal(h.style.colorScheme,'light');
 h.media.matches=true;h.listeners[0]();
 assert.equal(h.classes.has('dark-mode'),true);
});
test('explicit light and dark choices override OS scheme',()=>{
 for(const mode of ['light','dark']){
  const h=setup({colorMode:mode});h.apply();
  assert.equal(h.classes.has('dark-mode'),mode==='dark');
  assert.equal(h.listeners.length,1);
  h.media.matches=false;h.listeners[0]();
  assert.equal(h.classes.has('dark-mode'),mode==='dark');
 }
});
test('system choice is displayed and selected in all languages',()=>{
 const c={};vm.runInNewContext(fs.readFileSync('settings-page.js','utf8'),c);
 for(const [lang,label] of [['zh','跟随系统'],['en','Follow system'],['es','Según el sistema']]){
  const html=c.LCBPersonalization.panel({L:x=>x[lang],esc:x=>x,value:{colorMode:'system'},items:[]},'theme');
  assert.match(html,/name="colorMode" value="system" checked/);
  assert.ok(html.includes(label));
 }
});
