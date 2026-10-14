(function(root){
  root.LCBPracticeAreas={
    merge(builtins,rows){
      const all=Object.fromEntries(builtins.map(a=>[a.id,{...a}]));
      for(const row of rows||[])all[row.id]={...(all[row.id]||{}),...row};
      return {all,active:Object.values(all).filter(a=>!a.deleted)};
    },
    blockers(matters,id){return matters.filter(m=>!['schedule','client','chat-channel'].includes(m.kind)&&m.area===id);},
    panel(c){
      const {esc,L,users,areas,admin}=c;
      const hint=L({zh:'默认成员仅用于新建事项，不会改变已有事项。删除前必须先修改所有正在使用该类型的事项（包括已完成和回收站中的事项）。',en:'Default members apply only to new matters. Before deleting a practice area, change any matters that use it, including completed matters and matters in the recycle bin.',es:'Los miembros predeterminados solo se aplican a asuntos nuevos. Antes de eliminar un área de práctica, cambia los asuntos que la usan, incluidos los completados y los de la papelera.'});
      return '<div class="card card-pad"><div class="section-title">'+esc(L({zh:'业务类型',en:'Practice areas',es:'Áreas de práctica'}))+' <button class="btn btn-primary" data-action="new-practice-area" aria-label="'+esc(L({zh:'新建业务类型',en:'Add practice area',es:'Añadir área de práctica'}))+'">+</button></div><div class="hint">'+esc(hint)+'</div>'+(!areas.length?'<p>'+esc(L({zh:'暂无业务类型，点击“+”新建。',en:'No practice areas yet. Click + to add one.',es:'No hay áreas de práctica. Pulsa + para añadir una.'}))+'</p>':'<div style="overflow-x:auto"><table class="matrix"><thead><tr><th>'+esc(L({zh:'业务类型',en:'Practice area',es:'Área de práctica'}))+'</th>'+users.map(u=>'<th>'+esc(u.name)+'</th>').join('')+'<th></th></tr></thead><tbody>'+areas.map(a=>'<tr><td>'+esc(L(a.name))+'</td>'+users.map(u=>'<td><input type="checkbox" data-action="set-default-team" data-area="'+esc(a.id)+'" data-user="'+esc(u.id)+'" '+(c.members(a.id).includes(u.id)?'checked':'')+' '+(admin?'':'disabled')+' aria-label="'+esc(L(a.name)+' '+u.name)+'"></td>').join('')+'<td>'+(admin?'<button class="btn" data-action="delete-practice-area" data-id="'+esc(a.id)+'">'+esc(L({zh:'删除',en:'Delete',es:'Eliminar'}))+'</button>':'')+'</td></tr>').join('')+'</tbody></table></div>')+'</div>';
    },
    form(c){
      const {L,esc,users}=c;
      return '<form id="practice-area-form" data-action="create-practice-area"><div class="field"><label>'+esc(L({zh:'业务类型名称',en:'Practice area name',es:'Nombre del área de práctica'}))+'</label><input name="name" maxlength="100" required autocomplete="off"></div><div class="grid-2"><div class="field"><label>'+esc(L({zh:'英文名称（可选）',en:'English name (optional)',es:'Nombre en inglés (opcional)'}))+'</label><input name="en" maxlength="100"></div><div class="field"><label>'+esc(L({zh:'西语名称（可选）',en:'Spanish name (optional)',es:'Nombre en español (opcional)'}))+'</label><input name="es" maxlength="100"></div></div><div class="section-title">'+esc(L({zh:'使用此业务类型时默认勾选谁',en:'Default members for this practice area',es:'Miembros predeterminados para esta área de práctica'}))+'</div>'+users.map(u=>'<label class="member-item"><input type="checkbox" name="members" value="'+esc(u.id)+'" checked>'+esc(u.name)+'</label>').join('')+'</form>';
    }
  };
})(globalThis);

