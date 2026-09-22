(function (root, factory) {
  const config = factory();
  if (typeof module === 'object' && module.exports) module.exports = config;
  root.LCBSiteConfig = config;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return Object.freeze({
    supabase: Object.freeze({
      url: 'https://fnkgulfdcljwjkcqibxi.supabase.co',
      key: 'sb_publishable_q1rkOmyUCFJ0AXRiT38rOg_9M6eMRT_',
    }),
    bucket: 'carol-encrypted-files',
    storageKeys: Object.freeze({
      matters: 'carol_solo_matters_v1',
      logs: 'carol_solo_logs_v1',
      session: 'carol_solo_session_v1',
      auth: 'carol_solo_supabase_auth_v1',
      seq: 'carol_solo_seq_v1',
      lang: 'carol_solo_lang_v1',
      systemSeen: 'carol_solo_notice_seen_v1',
      systemEnabled: 'carol_solo_notice_enabled_v1',
      securityNoticeUntil: 'carol_solo_security_notice_until_v3',
      tutorialCompleted: 'carol_solo_tutorial_completed_v1',
      deviceId: 'carol_solo_device_id_v1',
    }),
    users: Object.freeze([
      Object.freeze({ id: 'carol', name: 'Carol', short: 'C', email: '13726111370@163.com', roleKey: 'role.carol', admin: true }),
      Object.freeze({ id: 'benson', name: 'Benson', short: 'B', email: 'yanyi13411696203@163.com', roleKey: 'role.benson', admin: false }),
    ]),
    turnstileSiteKey: '0x4AAAAAAE9qa19vTf_RD4DG',
    branding: Object.freeze({
      title: '母子事务管理器',
      titleEn: 'Mother-Son Task Manager',
      titleEs: 'Gestor de asuntos de madre e hijo',
      team: 'Carol 与 Benson',
      teamEn: 'Carol and Benson',
      teamEs: 'Carol y Benson',
    }),
  });
});
