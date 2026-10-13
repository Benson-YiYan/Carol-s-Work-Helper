(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LCBLogSync=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function stateFingerprint(log){
    const normalized=value=>[...new Set((value||[]).map(String))].sort();
    return JSON.stringify({readBy:normalized(log&&log.readBy),deletedBy:normalized(log&&(log.deletedBy||log.deletedFor)),recalledAt:Number(log&&log.recalledAt)||0,recalledBy:String(log&&log.recalledBy||'')});
  }
  function partition(logs,syncedIds,baseline){
    const newLogs=[],stateUpdates=[];
    (logs||[]).forEach(log=>{
      if(!syncedIds.has(log.id)){newLogs.push(log);return;}
      if(baseline.get(log.id)!==stateFingerprint(log))stateUpdates.push(log);
    });
    return {newLogs,stateUpdates};
  }
  function hasPendingChanges(startRevision,currentRevision){
    return Number(startRevision)!==Number(currentRevision);
  }
  return {stateFingerprint,partition,hasPendingChanges};
});
