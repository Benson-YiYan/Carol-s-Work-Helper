const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {test}=require('node:test');
const c={};vm.runInNewContext(fs.readFileSync('settings-page.js','utf8'),c);
const keys=['red','orange','yellow','green','cyan','blue','purple','gradient'];
test('appearance renders rainbow presets in order in all three languages',()=>{
 const labels={zh:['红色','橙色','黄色','绿色','青色','蓝色','紫色','红绿渐变'],en:['Red','Orange','Yellow','Green','Cyan','Blue','Purple','Red-green gradient'],es:['Rojo','Naranja','Amarillo','Verde','Cian','Azul','Morado','Degradado rojo-verde']};
 for(const lang of Object.keys(labels)){
  const html=c.LCBPersonalization.panel({L:x=>x[lang],esc:x=>x,value:{},items:[]},'theme');
  const buttons=[...html.matchAll(/data-preset="([^"]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(buttons.map(x=>x[1]),keys);
  assert.deepEqual(buttons.map(x=>x[2]),labels[lang]);
 }
});
test('yellow and cyan save their RGB values through the actual click handler',async()=>{
 const source=fs.readFileSync('app.js','utf8');
 const start=source.indexOf("if(action==='theme-preset'){"),end=source.indexOf("if (action === 'force-update')",start);
 const body=source.slice(start,end);
 for(const [preset,rgb] of [['yellow',[250,204,21]],['cyan',[6,182,212]]]){
  let saved;
  await vm.runInNewContext('(async()=>{'+body+'})()',{
   action:'theme-preset',el:{getAttribute:()=>preset},
   saveAccountPreferences:async patch=>{saved=patch;}
  });
  assert.ok(saved,'preset must save a preference');
  assert.deepEqual([saved.theme.r,saved.theme.g,saved.theme.b],rgb);
  assert.equal(saved.theme.s,100);
  assert.deepEqual(Object.keys(saved),['theme'],'mode/sidebar preferences remain untouched');
 }
});
