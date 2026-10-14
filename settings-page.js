(function(root){
  root.LCBPersonalization={
    normalize(value){
      const v=value&&typeof value==='object'&&!Array.isArray(value)?JSON.parse(JSON.stringify(value)):{};
      const number=(x,max,fallback)=>Number.isFinite(Number(x))?Math.max(0,Math.min(max,Math.round(Number(x)))):fallback;
      return {...v,hidden:Array.isArray(v.hidden)?v.hidden.filter(x=>typeof x==='string'&&x.startsWith('#/')&&x!=='#/settings'):[],
        theme:v.theme&&typeof v.theme==='object'?{r:number(v.theme.r,255,31),g:number(v.theme.g,255,94),b:number(v.theme.b,255,255),s:number(v.theme.s,100,100),preset:v.theme.preset==='gradient'?'gradient':'solid'}:null};
    },
    partition(items,hidden){
      return {main:items.filter(x=>x[0]==='#/settings'||!hidden.includes(x[0])),more:items.filter(x=>x[0]!=='#/settings'&&hidden.includes(x[0]))};
    },
    theme(value,family){
      if(!value)return {color:family?'#c9362b':'#1f5eff',gradient:family?'linear-gradient(135deg,#d92d20 0%,#027a48 100%)':'#1f5eff',soft:family?'#fff2ef':'#eef3ff',text:'#fff'};
      const v=this.normalize({theme:value}).theme,avg=(v.r+v.g+v.b)/3;
      const rgb=[v.r,v.g,v.b].map(x=>Math.round(avg+(x-avg)*v.s/100));
      const color='rgb('+rgb.join(', ')+')',soft='rgb('+rgb.map(x=>Math.round(x*.1+255*.9)).join(', ')+')';
      const gradient=v.preset==='gradient';
      return {color,soft,gradient:gradient?'linear-gradient(135deg,#d92d20 0%,#027a48 100%)':color,text:gradient||rgb[0]*.299+rgb[1]*.587+rgb[2]*.114<150?'#fff':'#16202b'};
    },
    panel(c,type){
      const L=c.L,esc=c.esc,v=this.normalize(c.value);
      const save=L({zh:'保存',en:'Save',es:'Guardar'}),reset=L({zh:'恢复默认',en:'Restore defaults',es:'Restaurar valores'});
      if(type==='sidebar')return '<form class="card card-pad" data-action="save-sidebar"><div class="hint">'+esc(L({zh:'未勾选的功能会放进“更多”；设置入口始终显示。',en:'Unchecked features move to More. Settings always remains visible.',es:'Las funciones desmarcadas pasan a Más. Configuración siempre permanece visible.'}))+'</div>'+c.items.filter(x=>x[0]!=='#/settings').map(x=>'<label class="member-item"><input type="checkbox" name="visible" value="'+esc(x[0])+'" '+(!v.hidden.includes(x[0])?'checked':'')+'>'+esc(x[2]||c.t(x[1]))+'</label>').join('')+'<button class="btn btn-primary" type="submit">'+esc(save)+'</button></form>';
      const theme=v.theme||{r:31,g:94,b:255,s:100};
      const names=[['r',255,L({zh:'红',en:'Red',es:'Rojo'})],['g',255,L({zh:'绿',en:'Green',es:'Verde'})],['b',255,L({zh:'蓝',en:'Blue',es:'Azul'})],['s',100,L({zh:'饱和度',en:'Saturation',es:'Saturación'})]];
      const presets=[['red',L({zh:'红色',en:'Red',es:'Rojo'})],['green',L({zh:'绿色',en:'Green',es:'Verde'})],['blue',L({zh:'蓝色',en:'Blue',es:'Azul'})],['purple',L({zh:'紫色',en:'Purple',es:'Morado'})],['orange',L({zh:'橙色',en:'Orange',es:'Naranja'})],['gradient',L({zh:'红绿渐变',en:'Red-green gradient',es:'Degradado rojo-verde'})]];
return '<form class="card card-pad" data-action="save-theme"><div class="theme-preview"></div>'+names.map(x=>'<label class="field">'+esc(x[2])+' <input type="number" name="'+x[0]+'" min="0" max="'+x[1]+'" value="'+theme[x[0]]+'" required></label>').join('')+'<div class="theme-presets">'+presets.map(x=>'<button class="btn" type="button" data-action="theme-preset" data-preset="'+x[0]+'">'+esc(x[1])+'</button>').join('')+'</div><button class="btn btn-primary" type="submit">'+esc(save)+'</button> <button class="btn" type="button" data-action="reset-theme">'+esc(reset)+'</button><div class="hint">'+esc(L({zh:'保存后同一账户的设备会同步主题色。',en:'Saved colors sync across devices on this account.',es:'Los colores guardados se sincronizan entre los dispositivos de esta cuenta.'}))+'</div></form>';
    }
  };
  root.LCBSettingsPage = function(c) {
    const L=c.L, esc=c.esc, t=c.t;
    if(c.latest&&c.latest<c.version)c.latest=c.version;
    const labels={
      home:L({zh:'设置',en:'Settings',es:'Configuración'}),
      personal:L({zh:'个性化',en:'Personalization',es:'Personalización'}),
      rules:L({zh:'信息与规则',en:'Information and rules',es:'Información y reglas'}),
      sidebar:L({zh:'侧边栏',en:'Sidebar',es:'Barra lateral'}),
      theme:L({zh:'主题色',en:'Theme color',es:'Color del tema'}),
      security:L({zh:'安全性',en:'Security',es:'Seguridad'}),
      repair:L({zh:'修复',en:'Repair',es:'Reparación'}),
      members:t('settings.members'), defaults:t('settings.defaultTeam'), devices:t('settings.sessions'),
      backup:L({zh:'安全备份',en:'Secure backup',es:'Copia de seguridad'}),
      records:L({zh:'安全记录',en:'Security records',es:'Registros de seguridad'}),
      integrity:L({zh:'数据完整性巡检',en:'Data integrity check',es:'Revisión de integridad'}),
      updates:L({zh:'检查更新',en:'Check for updates',es:'Buscar actualizaciones'})
    };
    const route=location.hash.split('/').slice(2).join('/')||'home';
    const parent={personal:'home',rules:'home',sidebar:'personal',theme:'personal',security:'home',repair:'home',members:'rules',defaults:'rules',devices:'security',backup:'security',records:'security',integrity:'repair',updates:'home'};
    const link=id=>'<a class="settings-entry card" href="#/settings/'+id+'"><span>'+esc(labels[id])+'</span><span aria-hidden="true">›</span></a>';
    const head='<div class="page-head"><div>'+(route!=='home'?'<a class="settings-back" href="#/settings/'+(parent[route]==='home'?'':parent[route])+'">‹ '+esc(L({zh:'返回',en:'Back',es:'Volver'}))+'</a>':'')+'<h1>'+esc(labels[route]||labels.home)+'</h1></div></div>';
    const doc=new DOMParser().parseFromString(c.legacy,'text/html');
    const cards=Array.from(doc.querySelectorAll('.card')).filter(x=>x.querySelector('.section-title'));
    const pick=title=>{const card=cards.find(x=>x.querySelector('.section-title').textContent.trim()===title);return card?card.outerHTML:'';};
    let body='';
    if(route==='home')body=link('rules')+link('personal')+link('security')+(c.admin?link('repair'):'')+link('updates');
    else if(route==='rules')body=link('members')+(c.team?link('defaults'):'');
    else if(route==='personal')body=link('sidebar')+link('theme');
    else if(route==='sidebar'||route==='theme')body=root.LCBPersonalization.panel({L,esc,t,items:c.navItems,value:c.preferences},route);
    else if(route==='security')body=link('devices')+(c.admin?link('backup')+link('records'):'');
    else if(route==='repair'&&c.admin)body=link('integrity');
    else if(route==='members')body=pick(t('settings.members'));
    else if(route==='devices')body=pick(t('settings.sessions'));
    else if(route==='defaults'&&c.team)body=c.defaults;
    else if(route==='backup'&&c.admin) {
      const card=cards.find(x=>x.querySelector('[data-action="export-encrypted-backup"]'));
      if(card){const records=card.querySelector('[data-action="view-security-events"]');if(records)records.remove();card.querySelector('.section-title').textContent=labels.backup;body=card.outerHTML;}
    } else if(route==='records'&&c.admin)body='<div class="card card-pad"><div class="section-title">'+esc(L({zh:'最近安全记录',en:'Recent security records',es:'Registros recientes de seguridad'}))+'</div>'+c.records+'<button class="btn" data-action="settings-load-records">'+esc(L({zh:'刷新',en:'Refresh',es:'Actualizar'}))+'</button></div>';
    else if(route==='integrity'&&c.admin)body=c.integrity;
    else if(route==='updates'){
      const stamp=c.lastCheck?new Date(c.lastCheck):null;
      const parts=stamp?[stamp.getMonth()+1,stamp.getDate(),stamp.getHours(),stamp.getMinutes()].map(x=>String(x).padStart(2,'0')):null;
      const fmt=parts?parts[0]+'/'+parts[1]+' '+parts[2]+':'+parts[3]:'—';
      body='<div class="card card-pad"><div class="section-title">'+esc(labels.updates)+'</div><div>'+esc(L({zh:'当前版本',en:'Current version',es:'Versión actual'}))+': '+esc(c.version)+'</div><div>'+esc(L({zh:'最新版本',en:'Latest version',es:'Última versión'}))+': '+esc(c.latest||'—')+'</div><button class="btn btn-primary" data-action="check-update">'+esc(labels.updates)+'</button><small class="settings-check-time">'+esc(L({zh:'上次检查',en:'Last checked',es:'Última comprobación'}))+': '+fmt+'</small></div>';
    }
    return head+'<div class="settings-pages">'+body+'</div>';
  };
})(globalThis);
