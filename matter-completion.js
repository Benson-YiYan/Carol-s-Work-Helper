(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.LCBMatterCompletion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function isCompleted(matter) { return !!(matter && matter.completedAt); }
  function completedLast(list) {
    return [...(list || [])].sort((a, b) => Number(isCompleted(a)) - Number(isCompleted(b)) || Number(a.completedAt || 0) - Number(b.completedAt || 0));
  }
  function canComplete(user, matter) {
    return !!(user && matter && !isCompleted(matter) && user.id === matter.nextOwner);
  }
  function canDeleteCompleted(user, matter) {
    return !!(user && matter && isCompleted(matter) && user.id === matter.owner);
  }
  function completeMatter(matter, user, at) {
    if (!canComplete(user, matter)) return false;
    matter.completedAt = Number(at || Date.now());
    matter.completedBy = user.id;
    matter.finalStepOwner = matter.nextOwner;
    matter.handoff = null;
    return true;
  }
  function deletableCompleted(list,user){
    return (list||[]).filter(m=>!m.deletedAt&&!['schedule','client','chat-channel'].includes(m.kind)&&canDeleteCompleted(user,m));
  }
  return { isCompleted, completedLast, canComplete, canDeleteCompleted, completeMatter, deletableCompleted };
});
