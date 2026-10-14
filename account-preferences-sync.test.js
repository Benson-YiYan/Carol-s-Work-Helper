const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
(async()=>{
 const stored=new Map(),requests=[];
 let user='carol';
 const c={Map,Set,Date,JSON,Object,setInterval:()=>{},currentUser:()=>({id:user}),KEY:{lang:'site-test'},REMOTE_ENABLED:true,authSession:{},
 load:(k,d)=>stored.has(k)?stored.get(k):d,save:(k,v)=>stored.set(k,v),render:()=>{},toast:()=>{},L:v=>v.en,
 showSystemError:e=>{throw e;},userIsInteracting:()=>false,applyAccountTheme:()=>{},
 document:{documentElement:{style:{setProperty:()=>{}},classList:{toggle:()=>{}}}},
 sbFetch:async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});return {ok:true,json:async()=>({hidden:['#/matters'],theme:{r:255,g:0,b:0,s:100},future:{density:'compact'}})};}};
 vm.createContext(c);
 vm.runInContext(fs.readFileSync('settings-page.js','utf8'),c);
 const app=fs.readFileSync('app.js','utf8');
 vm.runInContext(app.slice(app.indexOf('const preferenceChecks='),app.indexOf('function navigationItems()')),c);
 await vm.runInContext("saveAccountPreferences({theme:{r:255,g:0,b:0,s:100}})",c);
 assert.equal(requests[0].path,'/rpc/carol_patch_user_preferences');
 assert.deepEqual(Object.keys(requests[0].body.payload),['theme'],'send changed field only');
 assert.equal(stored.get('site-test:preferences:carol').future.density,'compact','retain server future settings');
 requests.length=0;
 await vm.runInContext("saveAccountPreferences({colorMode:'dark'})",c);
 assert.deepEqual(Object.keys(requests[0].body.payload),['colorMode'],'appearance patch does not overwrite other settings');
 assert.equal(requests[0].body.payload.colorMode,'dark');
 requests.length=0;
 await vm.runInContext("saveAccountPreferences({colorMode:'system'})",c);
 assert.deepEqual(Object.keys(requests[0].body.payload),['colorMode']);
 assert.equal(requests[0].body.payload.colorMode,'system','system choice uses the same account-scoped patch');
 user='benson';
 assert.equal(vm.runInContext("accountPreferences().future",c),undefined,'local cache separated by account');
 requests.length=0;
 await vm.runInContext('refreshAccountPreferences()',c);
 assert.equal(requests[0].path,'/rpc/carol_get_user_preferences');
 console.log('account preference sync behavior tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
