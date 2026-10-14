const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),Completion=require('./matter-completion.js');
test('delete-all-completed never includes another owner, active matters or recycled items',()=>{
 assert.equal(typeof Completion.deletableCompleted,'function','owner-only completed batch selector must exist');
 const list=[{id:'own',owner:'carol',completedAt:1},{id:'other',owner:'benson',completedAt:1},{id:'active',owner:'carol'},{id:'trash',owner:'carol',completedAt:1,deletedAt:2},{id:'client',owner:'carol',completedAt:1,kind:'client'}];
 assert.deepEqual(Completion.deletableCompleted(list,{id:'carol',admin:true}).map(m=>m.id),['own']);
 assert.deepEqual(Completion.deletableCompleted(list,null),[]);
});
test('ASAP daily reminders remain notifications, not matter activity',()=>{
 const source=fs.readFileSync('app.js','utf8'),start=source.indexOf('function isActivityEntry(');
 assert.ok(start>=0,'activity classification must exist');
 const ctx={};vm.runInNewContext(source.slice(start,source.indexOf('\nfunction ',start+1)),ctx);
 assert.equal(ctx.isActivityEntry({key:'inbox.deadlineReminder',vars:{date:{__date:'ASAP'}}}),false);
 assert.equal(ctx.isActivityEntry({key:'inbox.deadlineReminder',vars:{date:{__date:'2026-10-14'}}}),true);
 assert.equal(ctx.isActivityEntry({key:'detail.entry.edited'}),true);
 assert.equal(ctx.isActivityEntry({notificationOnly:true}),false);
});
test('expanded completed rows keep the normal matter actions, not per-row folding',()=>{
 const source=fs.readFileSync('app.js','utf8'),m={id:'completed',owner:'carol',completedAt:1,no:'TEST',title:'Complete',status:'green',area:'other',next:'Done'};
 const ctx={LCBMatterCompletion:Completion,sorted:x=>x,filterMatters:()=>[m],state:{expandedCompleted:new Set(),bulkSelected:new Set()},currentUser:()=>({id:'carol'}),canDeleteMatter:()=>true,isAdmin:()=>true,USER:{carol:{name:'Carol'}},esc:x=>x||'',L:x=>x,t:x=>x,fmtStamp:x=>x,areaTag:x=>x,statusChip:x=>x,fmtDateShort:x=>x,dueText:x=>x,waitLabel:x=>x};
 vm.runInNewContext(source.slice(source.indexOf('function matterRowsHTML('),source.indexOf('function viewMatters()')),ctx);
 const html=ctx.matterRowsHTML(true);
 assert.ok(html.includes('data-action="choose-matter-action"'),'completed row should open the same edit/work chooser as active row');
 assert.ok(!html.includes('data-action="toggle-completed-matter"'),'no per-matter collapse');
});


test('daily reminder is emitted once, stays in the inbox and is excluded from activity',()=>{
 const source=fs.readFileSync('app.js','utf8'),ctx={logs:[],currentUser:()=>({id:'carol'}),iso:()=> '2026-10-14',today:()=>new Date(),reminderItems:()=>[{kind:'ASAP',matter:{id:'asap',title:'Urgent',due:'ASAP'}}],commit:()=>{},deliverSystemNotifications:()=>{},location:{hash:'#/matters'},render:()=>{}};
 vm.runInNewContext(source.slice(source.indexOf('function isActivityEntry('),source.indexOf('function deliverScheduleReminders()')),ctx);
 vm.runInNewContext(source.slice(source.indexOf('function notificationEntries('),source.indexOf('function inboxEntries(')),ctx);
 ctx.deliverDeadlineReminders();ctx.deliverDeadlineReminders();
 assert.equal(ctx.logs.length,1);
 assert.equal(ctx.logs[0].notificationOnly,true);
 assert.equal(ctx.notificationEntries({id:'carol'}).length,1);
 assert.equal(ctx.logs.filter(ctx.isActivityEntry).length,0);
});

