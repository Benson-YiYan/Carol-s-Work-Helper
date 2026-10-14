const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');
const start=source.indexOf('const STR =');
const end=source.indexOf('\nlet lang',start);
const context={SITE_CONFIG:{branding:{title:'站点',titleEn:'Site',titleEs:'Sitio',team:'成员',teamEn:'Members',teamEs:'Miembros'}}};
const strings=vm.runInNewContext(source.slice(start,end)+';STR',context);
const slots=s=>[...String(s).matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(x=>x[1]).sort();
for(const [key,values] of Object.entries(strings)){
 assert.equal(values.length,3,key+' must provide three languages');
 for(let i=1;i<3;i++){
  assert.equal(typeof values[i],'string',key+' translation missing');
  assert.deepEqual(slots(values[i]),slots(values[0]),key+' interpolation values must match Chinese');
  const tags=s=>[...String(s).matchAll(/<\/?[a-z][^>]*>/gi)].map(x=>x[0].toLowerCase()).sort();
  assert.deepEqual(tags(values[i]),tags(values[0]),key+' formatting must match Chinese');
  assert.equal(values[i].includes('\uFFFD'),false,key+' contains corrupt text');
 }
}
const imports=vm.runInNewContext(source.slice(source.indexOf('const CLIENT_IMPORT_ALIASES ='),source.indexOf('function importSample('))+';({importedClientData})');
for(const header of ['Communication status','Estado de la comunicación','Communication progress','Progreso de comunicación']){
 assert.equal(imports.importedClientData({'Client name':'Test client',[header]:'Waiting for documents'}).communicationProgress,'Waiting for documents','translated client column must round-trip: '+header);
}
console.log('translation placeholders and import round-trip tests passed');
