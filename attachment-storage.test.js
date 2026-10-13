const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const names=['uploadEncryptedAttachment','downloadEncryptedAttachment','removeEncryptedAttachment'];
const functions=names.map(name=>{
  const start=source.indexOf('async function '+name+'(');
  assert.ok(start>=0);
  const tail=source.slice(start);
  const next=tail.slice(1).search(/\n(?:async )?function /);
  return next<0?tail:tail.slice(0,next+1);
}).join('\n');
const calls=[];
const matter={id:'123',owner:'carol',files:[]};
const context={
  ENCRYPTED_BUCKET:'isolated-test-bucket',
  matterById:()=>matter,currentUser:()=>({id:'carol',admin:true}),
  ensureMatterCurrent:async()=>true,canSee:()=>true,
  crypto:{randomUUID:()=> 'test-id'},
  LCBCrypto:{encryptFile:async()=>({ciphertext:'encrypted'}),decryptFile:async()=>new Uint8Array([1])},
  storageFetch:async(path,options)=>{calls.push({path,options});return {ok:true,text:async()=> '{"ciphertext":"encrypted"}'};},
  sbFetch:()=>{},addLogKey:()=>{},noticeVars:()=>({}),commit:()=>{},render:()=>{},toast:()=>{},t:x=>x,L:x=>x,
  authExpiredError:()=>false,showSystemError:e=>{throw e;},
  Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{}},
  document:{createElement:()=>({click(){}})},setTimeout:fn=>fn(),state:{modal:null}
};
vm.createContext(context);
vm.runInContext(functions,context);
(async()=>{
  await context.uploadEncryptedAttachment('123',{name:'test.txt',type:'text/plain',size:1,arrayBuffer:async()=>new ArrayBuffer(1)});
  assert.equal(calls[0].path,'/object/isolated-test-bucket/123/test-id.lcb');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(JSON.parse(calls[0].options.body).ciphertext,'encrypted');
  assert.equal(matter.files.length,1);
  await context.downloadEncryptedAttachment('123',0);
  assert.equal(calls[1].path,'/object/authenticated/isolated-test-bucket/123/test-id.lcb');
  await context.removeEncryptedAttachment('123',0);
  assert.equal(calls[2].path,'/object/isolated-test-bucket/123/test-id.lcb');
  assert.equal(calls[2].options.method,'DELETE');
  assert.equal(matter.files.length,0);
  console.log('attachment storage behavior tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
