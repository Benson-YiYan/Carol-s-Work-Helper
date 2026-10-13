(function(root){
  root.LCBSettingsPage = function(c) {
    const L=c.L, esc=c.esc, t=c.t;
    if(c.latest&&c.latest<c.version)c.latest=c.version;
    const labels={
      home:L({zh:'设置',en:'Settings',es:'Configuración'}),
      personal:L({zh:'个性化使用',en:'Personalization',es:'Personalización'}),
      security:L({zh:'安全性',en:'Security',es:'Seguridad'}),
      repair:L({zh:'修复',en:'Repair',es:'Reparación'}),
      members:t('settings.members'), defaults:t('settings.defaultTeam'), devices:t('settings.sessions'),
      backup:L({zh:'安全备份',en:'Secure backup',es:'Copia de seguridad'}),
      records:L({zh:'安全记录',en:'Security records',es:'Registros de seguridad'}),
      integrity:L({zh:'数据完整性巡检',en:'Data integrity check',es:'Revisión de integridad'}),
      updates:L({zh:'检查更新',en:'Check for updates',es:'Buscar actualizaciones'})
    };
    const route=location.hash.split('/').slice(2).join('/')||'home';
    const parent={personal:'home',security:'home',repair:'home',members:'home',defaults:'personal',devices:'security',backup:'security',records:'security',integrity:'repair',updates:'home'};
    const link=id=>'<a class="settings-entry card" href="#/settings/'+id+'"><span>'+esc(labels[id])+'</span><span aria-hidden="true">›</span></a>';
    const head='<div class="page-head"><div>'+(route!=='home'?'<a class="settings-back" href="#/settings/'+(parent[route]==='home'?'':parent[route])+'">‹ '+esc(L({zh:'返回',en:'Back',es:'Volver'}))+'</a>':'')+'<h1>'+esc(labels[route]||labels.home)+'</h1></div></div>';
    const doc=new DOMParser().parseFromString(c.legacy,'text/html');
    const cards=Array.from(doc.querySelectorAll('.card')).filter(x=>x.querySelector('.section-title'));
    const pick=title=>{const card=cards.find(x=>x.querySelector('.section-title').textContent.trim()===title);return card?card.outerHTML:'';};
    let body='';
    if(route==='home')body=(c.team?link('personal'):'')+link('security')+(c.admin?link('repair'):'')+link('updates')+link('members');
    else if(route==='personal'&&c.team)body=link('defaults');
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
