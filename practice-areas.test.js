const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c={};if(fs.existsSync('practice-areas.js'))vm.runInNewContext(fs.readFileSync('practice-areas.js','utf8'),c);
const builtins=[{id:'a',name:{zh:'甲',en:'A',es:'A'},members:['carol']}];
test('registry deletion removes picker option but preserves historical label',()=>{
 assert.ok(c.LCBPracticeAreas,'practice area model must exist');
 const model=c.LCBPracticeAreas.merge(builtins,[{id:'a',name:{zh:'甲',en:'A',es:'A'},members:['carol'],deleted:true},{id:'custom_1',name:{zh:'乙',en:'B',es:'B'},members:['benson']}]);
 assert.deepEqual(JSON.parse(JSON.stringify(model.active.map(x=>x.id))),['custom_1']);
 assert.equal(model.all.a.name.zh,'甲');
 assert.deepEqual(JSON.parse(JSON.stringify(model.all.custom_1.members)),['benson']);
});
test('deletion blockers include completed and recycled matters, never unrelated entities',()=>{
 assert.ok(c.LCBPracticeAreas);
 const rows=[{id:'1',area:'a',title:'Open'},{id:'2',area:'a',completedAt:1,title:'Done'},{id:'3',area:'a',deletedAt:1,title:'Recycled'},{id:'4',area:'b'},{id:'5',area:'a',kind:'client'}];
 assert.deepEqual(JSON.parse(JSON.stringify(c.LCBPracticeAreas.blockers(rows,'a').map(x=>x.id))),['1','2','3']);
});
test('empty registry remains empty rather than silently restoring deleted builtins',()=>{
 assert.ok(c.LCBPracticeAreas);
 const model=c.LCBPracticeAreas.merge(builtins,[{id:'a',name:builtins[0].name,members:[],deleted:true}]);
 assert.equal(model.active.length,0);
});
test('default member patch keeps other areas and empty selection',()=>{
 assert.ok(c.LCBPracticeAreas);
 const model=c.LCBPracticeAreas.merge(builtins,[{id:'a',name:builtins[0].name,members:[],deleted:false}]);
 assert.equal(model.all.a.members.length,0);
});


test('practice area page escapes names and limits controls by role',()=>{
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const base={L:x=>x.zh,esc,users:[{id:'carol',name:'Carol'},{id:'benson',name:'Member'}],areas:[{id:'custom_x',name:{zh:'<img>'}}],members:()=>['carol']};
 const member=c.LCBPracticeAreas.panel({...base,admin:false});
 assert.ok(member.includes('data-action="new-practice-area"'));
 assert.ok(!member.includes('data-action="delete-practice-area"'));
 assert.ok(member.includes('&lt;img>'));
 const admin=c.LCBPracticeAreas.panel({...base,admin:true});
 assert.ok(admin.includes('data-action="delete-practice-area"'));
 assert.ok(!admin.includes('disabled'));
});
test('configured members and mutation endpoint stay site-local',async()=>{
 const s=fs.readFileSync('app.js','utf8'),calls=[],saved={};
 const context={LCBPracticeAreas:c.LCBPracticeAreas,BUILTIN_PRACTICE_AREAS:builtins,KEY:{lang:'isolated'},USER:{carol:{},benson:{}},USERS:[{id:'carol'},{id:'benson'}],REMOTE_ENABLED:true,
 load:(key,fallback)=>saved[key]||fallback,save:(key,value)=>saved[key]=value,L:x=>x.zh,
 sbFetch:async(path,options)=>{calls.push({path,payload:JSON.parse(options.body).payload});return {ok:true,json:async()=>({areas:[{id:'custom_rpc',name:{zh:'RPC'},members:['benson'],deleted:false}]})};}};
 vm.createContext(context);
 vm.runInContext(s.slice(s.indexOf('let PRACTICE_AREAS='),s.indexOf('function practiceAreaUsageNotice')),context);
 vm.runInContext(s.slice(s.indexOf('function defaultTeam(areaId)'),s.indexOf('function canSee')),context);
 await vm.runInContext("mutatePracticeArea({action:'create',id:'custom_rpc',name:{zh:'RPC'},members:['benson']})",context);
 assert.equal(calls[0].path,'/rpc/carol_mutate_practice_area');
 assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("defaultTeam('custom_rpc')",context))),['benson']);
 assert.ok(saved['isolated:practiceAreas']);
});

