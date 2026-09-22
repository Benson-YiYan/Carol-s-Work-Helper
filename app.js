/* 母子事务管理器
   数据通过母子版专用 Supabase 项目同步，不连接团队数据库。 */

/* ------------------------------ 常量 ------------------------------ */

const SITE_CONFIG = globalThis.LCBSiteConfig;
if (!SITE_CONFIG) throw new Error('Mother-son site configuration is missing.');
const KEY = SITE_CONFIG.storageKeys;

/* ------------------------------ 多设备同步（个人版专用 Supabase） ------------------------------
   publishable key 设计成可以公开，配合数据库里的权限规则使用。 */
const SUPABASE = SITE_CONFIG.supabase;
const SOLO_PREFIX = 'solo_';
const REMOTE_ENABLED = !!(SUPABASE.url && SUPABASE.key) && typeof fetch === 'function';
const SYNC_EVERY_MS = 15000;
const IDLE_LOGOUT_MS = 24 * 60 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_COOLDOWN_MS = 60 * 1000;
const ENCRYPTED_BUCKET = SITE_CONFIG.bucket;
const sync = {
  status: REMOTE_ENABLED ? 'loading' : 'off',  // loading | ok | error | off
  lastAt: 0,
  error: '',
  dirty: false,        // 本地有还没推上去的改动
  busy: false,
  retryCount: 0,
  retryTimer: null,
  syncedLogs: new Set(),
  purged: new Set(),   // 要彻底删掉的远端事项
};

/* ------------------------------ 界面语言 ------------------------------ */

const LANGS = [
  { id: 'zh', label: '中', name: '简体中文' },
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'es', label: 'ES', name: 'Español' },
];
const LANG_INDEX = { zh: 0, en: 1, es: 2 };

/* 每条： [简体中文, English, Español] */
const STR = {
  'app.title': [SITE_CONFIG.branding.title, SITE_CONFIG.branding.titleEn, SITE_CONFIG.branding.titleEs],
  'app.team': [SITE_CONFIG.branding.team, SITE_CONFIG.branding.teamEn, SITE_CONFIG.branding.teamEs],

  'login.email': ['邮箱', 'Email', 'Correo electrónico'],
  'login.password': ['密码', 'Password', 'Contraseña'],
  'login.signin': ['登录', 'Sign in', 'Iniciar sesión'],
  'login.noSms': ['这是 Carol 与 Benson 的母子事务管理器。',
    "This is Carol and Benson's task manager.",
    'Este es el gestor de asuntos de Carol y Benson.'],
  'login.demoTitle': ['演示账号', 'Demo accounts', 'Cuentas de demostración'],
  'login.hint': ['用不同账号登录，可以看到权限差异：Héctor 登录后看不到任何制裁／涉美事项。',
    'Sign in with different accounts to see permissions at work: Héctor cannot see any sanctions / US matters.',
    'Entra con distintas cuentas para ver los permisos: Héctor no ve ningún asunto de sanciones ni de EE. UU.'],
  'login.errNoUser': ['没有找到这个邮箱对应的成员。', 'No team member matches that email.', 'No hay ningún miembro con ese correo.'],
  'login.errBadPass': ['密码不对，请重新输入。', 'Wrong password, please try again.', 'Contraseña incorrecta, inténtalo de nuevo.'],
  'login.errExpired': ['登录已过期，请重新登录。', 'Your session expired. Please sign in again.', 'La sesión caducó. Vuelve a iniciar sesión.'],
  'login.errCooldown': ['密码连续输错，请等待 1 分钟再试。', 'Too many failed attempts. Try again in one minute.', 'Demasiados intentos fallidos. Inténtalo de nuevo en un minuto.'],
  'toast.welcome': ['欢迎回来，{name}', 'Welcome back, {name}', 'Bienvenido de nuevo, {name}'],
  'toast.onlyOwnerEdit': ['只有负责人 {name} 或 Carol 可以修改事项资料。', 'Only the owner, {name}, or Carol can edit the matter.', 'Solo el responsable, {name}, o Carol puede modificar el asunto.'],

  'nav.dashboard': ['工作台', 'Dashboard', 'Panel'],
  'nav.matters': ['事项', 'Matters', 'Asuntos'],
  'nav.weekly': ['每周视图', 'Weekly', 'Semanal'],
  'nav.calendar': ['日历', 'Calendar', 'Calendario'],
  'nav.inbox': ['通知', 'Notifications', 'Notificaciones'],
  'nav.settings': ['信息', 'Info', 'Información'],
  'nav.trash': ['回收站', 'Recycle bin', 'Papelera'],
  'topbar.signout': ['退出登录', 'Sign out', 'Cerrar sesión'],
  'topbar.switch': ['点一下切换到下一个账号（演示权限用）', 'Click to switch to the next account (to demo permissions)', 'Haz clic para cambiar a la siguiente cuenta (para probar permisos)'],
  'banner.noStorage': ['⚠️ 这个浏览器不允许网页在本机保存数据，所以你现在改的东西刷新后会丢。换成 GitHub Pages 网址打开，或者用 Chrome 打开这个文件就正常了。',
    '⚠️ This browser does not let the page save data locally, so your changes will be lost when you refresh. Open it from the GitHub Pages URL, or open the file in Chrome.',
    '⚠️ Este navegador no permite guardar datos localmente: los cambios se perderán al recargar. Ábrelo desde la URL de GitHub Pages o con Chrome.'],
  'sync.ok': ['已同步', 'Synced', 'Sincronizado'],
  'sync.loading': ['同步中…', 'Syncing…', 'Sincronizando…'],
  'sync.error': ['未同步', 'Not synced', 'Sin sincronizar'],
  'sync.failedClick': ['未同步，点这里！', 'Not synced — click here!', 'Sin sincronizar: ¡haz clic aquí!'],
  'sync.offline': ['离线：改动只留在这台设备', 'Offline: changes stay on this device', 'Sin conexión: los cambios quedan aquí'],
  'sync.tablesMissing': ['数据表还没建好，请在 Supabase 里执行建表脚本', 'The tables are missing — run the setup SQL in Supabase', 'Faltan las tablas: ejecuta el SQL de configuración en Supabase'],
  'sync.tipOk': ['手机和电脑共用同一份个人数据 · 最近同步 {time} · 点一下立刻刷新',
    'Your phone and computer share the same personal data · last synced {time} · click to refresh',
    'El móvil y el ordenador comparten los mismos datos personales · última sincronización {time} · haz clic para actualizar'],
  'sync.tipError': ['同步失败：{msg}。改动已存在本机，稍后会自动重试。',
    'Sync failed: {msg}. Your changes are saved locally and will retry.',
    'Error de sincronización: {msg}. Los cambios están guardados aquí y se reintentará.'],
  'sync.errorModalTitle': ['发生错误！', 'An error occurred!', '¡Se produjo un error!'],
  'sync.errorModalSend': ['请将上面的文字发送给 Benson（yanyi13411696203@163.com），谢谢',
    'Please send the text above to Benson (yanyi13411696203@163.com). Thank you.',
    'Envía el texto anterior a Benson (yanyi13411696203@163.com). Gracias.'],

  'dash.morning': ['早上好，{name}', 'Good morning, {name}', 'Buenos días, {name}'],
  'dash.afternoon': ['下午好，{name}', 'Good afternoon, {name}', 'Buenas tardes, {name}'],
  'dash.evening': ['晚上好，{name}', 'Good evening, {name}', 'Buenas noches, {name}'],
  'dash.desc': ['先看红色，再看今天要推进的。每件事都要有下一步和截止日期。',
    'Red first, then what needs attention today. Every matter needs a next step and due date.',
    'Primero lo rojo y luego lo que requiere atención hoy. Cada asunto necesita un próximo paso y fecha límite.'],
  'dash.new': ['＋ 新建事项', '＋ New matter', '＋ Nuevo asunto'],
  'dash.kpi.red': ['🔴 红色事项', '🔴 Red matters', '🔴 Asuntos rojos'],
  'dash.kpi.redFoot': ['需要立即处理', 'Needs immediate action', 'Requieren acción inmediata'],
  'dash.kpi.due': ['📅 本周到期', '📅 Due this week', '📅 Vencen esta semana'],
  'dash.kpi.dueFoot': ['7 天内截止', 'Due within 7 days', 'Vencen en 7 días'],
  'dash.kpi.mine': ['⏳ 等我推进', '⏳ Waiting on me', '⏳ Pendientes de mí'],
  'dash.kpi.mineFoot': ['我要做的事情', 'Things I need to do', 'Mis tareas'],
  'dash.kpi.visible': ['📚 全部事项', '📚 All matters', '📚 Todos los asuntos'],
  'dash.kpi.visibleAdmin': ['我的全部事项', 'All my matters', 'Todos mis asuntos'],
  'dash.kpi.visibleMember': ['仅我是项目成员的事项', 'Only matters I am assigned to', 'Solo asuntos en los que participo'],
  'dash.today': ['今天要处理的', 'To do today', 'Para hoy'],
  'dash.todayDesc': ['红色 + 黄色事项，按紧急程度排序。点任意一行可以打开详情。',
    'Red + yellow matters, most urgent first. Click any row to open it.',
    'Asuntos rojos y amarillos, los más urgentes primero. Haz clic en una fila para abrirla.'],
  'dash.empty': ['目前没有需要关注的事项 🎉', 'Nothing needs attention right now 🎉', 'Nada requiere atención por ahora 🎉'],
  'legend.green': ['🟢 正常推进', '🟢 On track', '🟢 En curso'],
  'legend.yellow': ['🟡 等待客户／第三方／有风险', '🟡 Waiting on client / third party / at risk', '🟡 Esperando al cliente o a terceros / en riesgo'],
  'legend.red': ['🔴 需要立即处理', '🔴 Act now', '🔴 Requiere acción inmediata'],

  'list.title': ['事项', 'Matters', 'Asuntos'],
  'list.desc': ['共 {n} 条', '{n} matters', '{n} asuntos'],
  'list.descAdmin': ['（管理员，全部事项）', '(admin, all matters)', '(administradora, todos los asuntos)'],
  'list.descMember': ['（只含你是项目成员的事项）', '(only matters you are assigned to)', '(solo asuntos en los que participas)'],
  'list.export': ['导出CSV表格', 'Export CSV spreadsheet', 'Exportar tabla CSV'],
  'list.import': ['Excel/CSV 导入', 'Import Excel/CSV', 'Importar Excel/CSV'],
  'list.bulkDelete': ['批量删除', 'Bulk delete', 'Eliminar en lote'],
  'modal.export.title': ['导出CSV表格', 'Export CSV spreadsheet', 'Exportar tabla CSV'],
  'modal.export.body': ['CSV 表格可用 Excel 打开。', 'CSV spreadsheets can be opened in Excel.', 'Las tablas CSV se pueden abrir con Excel.'],
  'modal.export.confirm': ['下载CSV表格', 'Download CSV', 'Descargar CSV'],
  'list.search': ['搜索客户、事项、这一步', 'Search client, matter, current step', 'Buscar cliente, asunto, paso actual'],
  'modal.import.title': ['Excel/CSV 导入', 'Import Excel/CSV', 'Importar Excel/CSV'],
  'modal.import.hint': ['根据表格内容自动创建事项。支持 .xlsx、.xls 和 .csv。所有读取到的事项都会导入；填写错误的事项会标红。', 'Create matters from a spreadsheet. Supports .xlsx, .xls and .csv. Every row is imported; invalid matters are highlighted in red.', 'Cree asuntos desde una hoja de cálculo. Admite .xlsx, .xls y .csv. Se importan todas las filas; los asuntos incorrectos se marcan en rojo.'],
  'modal.import.choose': ['选择文件', 'Choose file', 'Elegir archivo'],
  'modal.import.confirm': ['开始导入', 'Start import', 'Iniciar importación'],
  'modal.import.invalid': ['格式不对，是否查看示例文件？', 'Invalid format. Would you like to view the sample file?', 'El formato no es correcto. ¿Desea ver el archivo de ejemplo?'],
  'modal.import.yes': ['是，下载示例文件', 'Yes, download sample', 'Sí, descargar ejemplo'],
  'modal.import.no': ['否', 'No', 'No'],
  'modal.import.result': ['已导入 {ok} 条事项', 'Imported {ok} matters', 'Se importaron {ok} asuntos'],
  'modal.importError.title': ['导入完成，但部分内容填写错误', 'Import complete, but some entries are invalid', 'Importación completada, pero algunos datos son incorrectos'],
  'modal.importFieldInvalid': ['事项“{title}”的“{field}”填写错误，请修改！', 'The “{field}” of matter “{title}” is invalid. Please correct it.', 'El campo “{field}” del asunto «{title}» es incorrecto. Corríjalo.'],
  'list.importError': ['错误的事项，请点击修改', 'Invalid matter. Click to edit', 'Asunto incorrecto. Haga clic para modificarlo'],
  'list.allAreas': ['全部业务类型', 'All practice areas', 'Todas las áreas'],
  'list.allOwners': ['全部负责人', 'All owners', 'Todos los responsables'],
  'list.allStatus': ['全部状态', 'All statuses', 'Todos los estados'],
  'list.allWaiting': ['全部等待对象', 'Any waiting-on', 'Cualquier espera'],
  'list.clear': ['清除筛选', 'Clear filters', 'Limpiar filtros'],
  'list.empty': ['没有符合条件的事项。', 'No matters match these filters.', 'Ningún asunto coincide con los filtros.'],
  'th.no': ['编号', 'No.', 'Nº'],
  'th.client': ['客户', 'Client', 'Cliente'],
  'th.title': ['事项', 'Matter', 'Asunto'],
  'th.area': ['业务类型', 'Practice area', 'Área'],
  'th.owner': ['负责人', 'Owner', 'Responsable'],
  'th.status': ['状态', 'Status', 'Estado'],
  'th.next': ['当前步骤', 'Current step', 'Paso actual'],
  'th.due': ['截止', 'Due', 'Vence'],
  'th.waiting': ['等待谁', 'Waiting for', 'Esperando a'],
  'th.chat': ['聊天', 'Chat', 'Chat'],

  'inbox.title': ['通知', 'Notifications', 'Notificaciones'],
  'inbox.desc': ['事项成员的操作通知和聊天消息。每个账号的已读状态分别保存。',
    'Matter activity and chat messages for you. Read status is saved separately for each account.',
    'Actividad y mensajes de los asuntos para ti. El estado de lectura se guarda por separado para cada cuenta.'],
  'inbox.systemHint': ['开启后，新通知会同时弹出系统通知；需要保持网页打开，后台标签页也可以。',
    'Once enabled, new activity also appears as a system notification. Keep this site open; a background tab is fine.',
    'Al activarlas, la nueva actividad también aparecerá como notificación del sistema. Mantén el sitio abierto; puede estar en segundo plano.'],
  'inbox.systemEnable': ['开启系统通知', 'Enable system notifications', 'Activar notificaciones del sistema'],
  'inbox.systemRequesting': ['等待系统授权…', 'Waiting for permission…', 'Esperando autorización…'],
  'inbox.systemEnabled': ['系统通知已开启', 'System notifications enabled', 'Notificaciones del sistema activadas'],
  'inbox.systemDisable': ['关闭系统通知', 'Turn off system notifications', 'Desactivar notificaciones del sistema'],
  'inbox.systemUnsupported': ['此浏览器不支持系统通知', 'System notifications are not supported', 'Este navegador no admite notificaciones del sistema'],
  'system.title': ['LCB 新通知', 'New LCB notification', 'Nueva notificación de LCB'],
  'inbox.empty': ['还没有通知。', 'No notifications yet.', 'Todavía no hay notificaciones.'],
  'inbox.markRead': ['已读', 'Mark read', 'Marcar como leído'],
  'inbox.delete': ['删除消息', 'Delete message', 'Eliminar mensaje'],
  'inbox.read': ['已读', 'Read', 'Leído'],
  'inbox.unread': ['未读', 'Unread', 'No leído'],
  'inbox.new': ['{actor} 新建了事项“{title}”。当前步骤：“{next}”，由 {owner} 负责。当前事项状态：{status}。',
    '{actor} created “{title}”. Current step: “{next}”, assigned to {owner}. Current status: {status}.',
    '{actor} creó «{title}». Paso actual: «{next}», a cargo de {owner}. Estado actual: {status}.'],
  'inbox.edited': ['{actor} 修改了事项“{title}”。当前步骤：“{next}”，由 {owner} 负责。当前事项状态：{status}。',
    '{actor} updated “{title}”. Current step: “{next}”, assigned to {owner}. Current status: {status}.',
    '{actor} modificó «{title}». Paso actual: «{next}», a cargo de {owner}. Estado actual: {status}.'],
  'inbox.editUndo': ['{actor} 撤回了事项“{title}”的上次修改。当前步骤：“{next}”，由 {owner} 负责。当前事项状态：{status}。',
    '{actor} undid the last edit to “{title}”. Current step: “{next}”, assigned to {owner}. Current status: {status}.',
    '{actor} deshizo la última modificación de «{title}». Paso actual: «{next}», a cargo de {owner}. Estado actual: {status}.'],
  'inbox.deleted': ['{actor} 删除了事项“{title}”，事项已进入回收站。',
    '{actor} deleted “{title}”; it is now in the recycle bin.',
    '{actor} eliminó «{title}»; ahora está en la papelera.'],
  'inbox.restored': ['{actor} 从回收站恢复了事项“{title}”。',
    '{actor} restored “{title}” from the recycle bin.',
    '{actor} restauró «{title}» desde la papelera.'],
  'inbox.stepDone': ['{actor} 完成了事项“{title}”步骤“{step}”，下一步“{next}”由 {owner} 负责。当前事项状态：{status}。',
    '{actor} completed the “{step}” step in “{title}”. Next, “{next}” is assigned to {owner}. Current status: {status}.',
    '{actor} completó el paso «{step}» de «{title}». El siguiente paso, «{next}», está a cargo de {owner}. Estado actual: {status}.'],
  'inbox.stepUndo': ['{actor} 撤回了事项“{title}”的步骤完成记录，当前步骤回到“{step}”，由 {owner} 负责。',
    '{actor} undid a completed step in “{title}”. The current step is again “{step}”, assigned to {owner}.',
    '{actor} deshizo un paso completado de «{title}». El paso actual vuelve a ser «{step}», a cargo de {owner}.'],
  'inbox.fileAdd': ['{actor} 在事项“{title}”中添加了文件链接“{name}”。',
    '{actor} added the file link “{name}” to “{title}”.',
    '{actor} añadió el enlace «{name}» al asunto «{title}».'],
  'inbox.fileRemove': ['{actor} 从事项“{title}”中移除了文件链接“{name}”。',
    '{actor} removed the file link “{name}” from “{title}”.',
    '{actor} quitó el enlace «{name}» del asunto «{title}».'],
  'inbox.chat': ['{actor} 在事项“{title}”中发送消息：“{message}”',
    '{actor} sent a message in “{title}”: “{message}”',
    '{actor} envió un mensaje en «{title}»: «{message}»'],
  'inbox.scheduleReminder': ['日程提醒：{message}', 'Schedule reminder: {message}', 'Recordatorio: {message}'],
  'inbox.readReceipt': ['{reader} 已读您的通知【{preview}】',
    '{reader} read your notification [{preview}]',
    '{reader} leyó su notificación [{preview}]'],

  'status.green': ['绿 · 正常', 'Green · On track', 'Verde · En curso'],
  'status.green.short': ['正常', 'On track', 'En curso'],
  'status.yellow': ['黄 · 关注', 'Yellow · Watch', 'Amarillo · Atención'],
  'status.yellow.short': ['关注', 'Watch', 'Atención'],
  'status.red': ['红 · 紧急', 'Red · Urgent', 'Rojo · Urgente'],
  'status.red.short': ['紧急', 'Urgent', 'Urgente'],

  'wait.none': ['—', '—', '—'],
  'wait.client': ['客户', 'Client', 'Cliente'],
  'wait.counterparty': ['对方律师', 'Opposing counsel', 'Contraparte'],
  'wait.authority': ['政府部门', 'Government authority', 'Autoridad'],
  'wait.notary': ['墨西哥公证', 'Mexican notary', 'Notaría (México)'],
  'wait.bank': ['银行', 'Bank', 'Banco'],
  'wait.ofac': ['OFAC', 'OFAC', 'OFAC'],
  'wait.tax': ['税务顾问', 'Tax adviser', 'Asesor fiscal'],
  'wait.carol': ['Carol', 'Carol', 'Carol'],
  'wait.carlos': ['Carlos Dávila', 'Carlos Dávila', 'Carlos Dávila'],
  'wait.hector': ['Héctor Luján Medina', 'Héctor Luján Medina', 'Héctor Luján Medina'],
  'wait.other': ['其他', 'Other', 'Otro'],

  'stage.engagement': ['立项委托', 'Engagement', 'Encargo'],
  'stage.consultation': ['咨询', 'Consultation', 'Consulta'],
  'stage.dd': ['尽职调查', 'Due diligence', 'Due diligence'],
  'stage.research': ['法律研究', 'Legal research', 'Investigación legal'],
  'stage.drafting': ['文件起草', 'Drafting', 'Redacción'],
  'stage.filing': ['申报递交', 'Filing / submission', 'Presentación'],
  'stage.gov': ['政府审批', 'Government review', 'Revisión de la autoridad'],
  'stage.closing': ['交割结项', 'Closing', 'Cierre'],
  'stage.hold': ['暂停', 'On hold', 'En pausa'],

  'role.carol': ['中国律师 · 团队负责人', 'China-qualified lawyer · Team lead', 'Abogada en China · Líder del equipo'],
  'role.benson': ['协作者', 'Collaborator', 'Colaborador'],
  'role.carlos': ['墨西哥律师', 'Mexican lawyer', 'Abogado en México'],
  'role.hector': ['墨西哥 + 纽约双执业', 'México + New York qualified', 'Abogado en México y Nueva York'],

  'back.toList': ['← 返回事项列表', '← Back to matters', '← Volver a asuntos'],
  'back.toSettings': ['← 返回回收站', '← Back to recycle bin', '← Volver a la papelera'],
  'back.toDashboard': ['← 回到工作台', '← Back to dashboard', '← Volver al panel'],

  'detail.info': ['事项信息', 'Matter details', 'Datos del asunto'],
  'detail.client': ['客户', 'Client', 'Cliente'],
  'detail.title': ['事项名称', 'Matter name', 'Nombre del asunto'],
  'detail.area': ['业务类型', 'Practice area', 'Área'],
  'detail.areaHint': ['换业务类型会自动把项目成员改成该类事项的默认成员。', 'Changing the practice area resets the members to that area\'s default.', 'Al cambiar el área se restablecen los miembros predeterminados de esa área.'],
  'detail.stage': ['当前阶段', 'Current stage', 'Etapa actual'],
  'detail.owner': ['负责人（唯一）', 'Owner (one only)', 'Responsable (único)'],
  'detail.nextOwner': ['谁做这一步？', 'Who will do this step?', '¿Quién hará este paso?'],
  'detail.status': ['状态', 'Status', 'Estado'],
  'detail.due': ['截止日期', 'Due date', 'Fecha límite'],
  'detail.waiting': ['等待谁', 'Waiting for', 'Esperando a'],
  'detail.lastContact': ['最后联系客户', 'Last client contact', 'Último contacto con el cliente'],
  'detail.next': ['现在要做什么？', 'What needs to be done now?', '¿Qué hay que hacer ahora?'],
  'detail.reason': ['状态说明（黄／红必填）', 'Status note (required for yellow / red)', 'Nota de estado (obligatoria si es amarillo o rojo)'],
  'detail.reasonPh': ['例如：等墨方土地意见，客户在催', 'e.g. Waiting on the land opinion; client is chasing', 'p. ej. Esperando la opinión del terreno; el cliente insiste'],
  'form.reasonPh': ['为什么急', 'Why is it urgent?', '¿Por qué es urgente?'],
  'detail.notes': ['备注', 'Notes', 'Notas'],
  'detail.members': ['项目成员', 'Matter members', 'Miembros del asunto'],
  'detail.membersHint': ['只有勾进来的人能打开这条事项，没勾的人连列表里都看不到。Carol 是管理员，始终能看到全部。负责人是唯一对结果负责的人。',
    'Only the people ticked here can open this matter — others will not even see it in the list. Carol, as admin, can always see everything. The owner is the one person accountable for the outcome.',
    'Solo las personas marcadas aquí pueden abrir este asunto; las demás ni siquiera lo verán en la lista. Carol, como administradora, siempre ve todo. El responsable es quien rinde cuentas del resultado.'],
  'detail.save': ['保存修改', 'Save changes', 'Guardar cambios'],
  'detail.undoEdit': ['撤回上次修改', 'Undo last edit', 'Deshacer última modificación'],
  'detail.delete': ['删除这条事项', 'Delete this matter', 'Eliminar este asunto'],
  'detail.deleteHintOwner': ['删除后进入回收站，在设置页可以恢复。', 'It goes to the recycle bin and can be restored in Settings.', 'Va a la papelera y puede restaurarse en Ajustes.'],
  'detail.deleteHintOther': ['只有项目负责人 {name} 才能删除这条事项。', 'Only the matter owner, {name}, can delete it.', 'Solo el responsable del asunto, {name}, puede eliminarlo.'],
  'detail.deleteHintAdmin': ['你是管理员，可以删除任何事项；删除后进回收站，可在设置页恢复。',
    'As admin you can delete any matter; it goes to the recycle bin and can be restored in Settings.',
    'Como administradora puedes eliminar cualquier asunto; va a la papelera y puede restaurarse en Ajustes.'],
  'detail.notFound': ['找不到这个事项。', 'Matter not found.', 'No se encontró el asunto.'],
  'detail.noAccessTitle': ['无权查看', 'No access', 'Sin acceso'],
  'detail.noAccess1': ['「{no} {title}」的项目成员里没有你，所以打不开。', 'You are not a member of “{no} {title}”, so you cannot open it.', 'No eres miembro de «{no} {title}», así que no puedes abrirlo.'],
  'detail.noAccess2': ['需要参与的话，请项目负责人 {owner} 或 Carol 把你的名字勾进「项目成员」。',
    'To take part, ask the matter owner {owner} or Carol to add you under Matter members.',
    'Para participar, pide al responsable {owner} o a Carol que te añada en Miembros del asunto.'],
  'detail.trashTitle': ['这条事项在回收站里', 'This matter is in the recycle bin', 'Este asunto está en la papelera'],
  'detail.trashWhen': ['删除时间：{when}', 'Deleted: {when}', 'Eliminado: {when}'],
  'detail.trashRestore': ['恢复这条事项', 'Restore this matter', 'Restaurar este asunto'],
  'detail.trashAdminOnly': ['仅事项负责人 {name} 可操作', 'Only the matter owner, {name}, can act', 'Solo el responsable, {name}, puede realizar esta acción'],
  'detail.step.title': ['当前步骤', 'Current step', 'Paso actual'],
  'detail.step.button': ['完成当前步骤 →', 'Complete this step →', 'Completar este paso →'],
  'detail.step.hintOwner': ['完成时会让你填写下一步：阶段、状态、截止日期、在等谁、下一步做什么、下一步负责人。',
    'When you complete it you will fill in the next step: stage, status, due date, waiting on, what is next and who owns it.',
    'Al completarlo rellenarás el siguiente paso: etapa, estado, fecha límite, a quién esperas, qué sigue y quién lo hace.'],
  'detail.step.hintOther': ['只有当前步骤负责人 {name} 才能完成这一步。', 'Only the owner of the current step, {name}, can complete it.', 'Solo el responsable del paso actual, {name}, puede completarlo.'],
  'detail.step.hintAdmin': ['你是管理员，可以代为完成这一步（正常由 {name} 负责）。',
    'As admin you can complete this step on their behalf (normally {name}).',
    'Como administradora puedes completar este paso (normalmente lo hace {name}).'],
  'detail.undo.button': ['撤销到上一步【{text}】', 'Undo to previous step [{text}]', 'Deshacer al paso anterior [{text}]'],
  'detail.undo.hint': ['撤销会把事项退回上一步，并删掉那条完成记录。',
    'Undo sends the matter back one step and removes that completion record.',
    'Deshacer devuelve el asunto un paso atrás y borra ese registro.'],
  'detail.undo.hintDenied': ['只有管理员，或刚完成这一步的人，可以撤销。',
    'Only an admin, or the person who just completed the step, can undo.',
    'Solo la administradora o quien acaba de completar el paso puede deshacer.'],
  'detail.step.waiting': ['⏳ 在等：{w}', '⏳ Waiting on: {w}', '⏳ Esperando a: {w}'],
  'detail.history.title': ['已完成的步骤', 'Completed steps', 'Pasos completados'],
  'detail.history.count': ['{n} 步', '{n} steps', '{n} pasos'],
  'detail.history.empty': ['还没有完成过步骤。点上面的「完成当前步骤」推进第一条。', 'No steps completed yet. Use “Complete this step” above to move it forward.', 'Aún no hay pasos completados. Usa «Completar este paso» para avanzar.'],
  'detail.history.meta': ['{who} · 完成于 {when}（原定 {due}）', '{who} · completed {when} (was due {due})', '{who} · completado {when} (vencía {due})'],
  'detail.history.by': [' · 由 {name} 操作', ' · by {name}', ' · por {name}'],
  'detail.files.title': ['加密附件', 'Encrypted files', 'Archivos cifrados'],
  'detail.files.add': ['＋ 添加', '＋ Add', '＋ Añadir'],
  'detail.files.empty': ['还没有加密附件。', 'No encrypted files yet.', 'Aún no hay archivos cifrados.'],
  'detail.timeline.title': ['动态记录', 'Activity', 'Actividad'],
  'detail.timeline.empty': ['还没有记录。', 'No activity yet.', 'Todavía no hay actividad.'],
  'detail.entry.new': ['新建事项 {no}（{area}）', 'Created matter {no} ({area})', 'Asunto creado {no} ({area})'],
  'detail.entry.status': ['状态更新为 {status}', 'Status set to {status}', 'Estado cambiado a {status}'],
  'detail.entry.next': ['下一步更新为：{next}', 'Next step set to: {next}', 'Próximo paso: {next}'],
  'detail.entry.due': ['截止日期更新为 {date}（{rel}）', 'Due date set to {date} ({rel})', 'Fecha límite: {date} ({rel})'],
  'detail.entry.owner': ['负责人变更为 {name}', 'Owner changed to {name}', 'Responsable cambiado a {name}'],
  'detail.entry.waiting': ['等待谁更新为：{w}', 'Waiting for set to: {w}', 'Esperando a: {w}'],
  'detail.entry.edited': ['更新了事项信息', 'Matter details updated', 'Datos del asunto actualizados'],
  'detail.entry.editUndo': ['撤回了上次修改', 'Undid the last edit', 'Deshizo la última modificación'],
  'detail.entry.note': ['{text}', '{text}', '{text}'],
  'detail.entry.fileAdd': ['添加文件链接：{name}', 'File link added: {name}', 'Enlace añadido: {name}'],
  'detail.entry.fileRemove': ['移除文件链接：{name}', 'File link removed: {name}', 'Enlace eliminado: {name}'],
  'detail.entry.deleted': ['删除事项（已进入回收站）', 'Matter deleted (moved to recycle bin)', 'Asunto eliminado (a la papelera)'],
  'detail.entry.restored': ['从回收站恢复', 'Restored from recycle bin', 'Restaurado desde la papelera'],
  'detail.entry.stepUndo': ['撤销到上一步：{text}', 'Undone back to: {text}', 'Deshecho hasta: {text}'],
  'detail.entry.stepDone': ['完成步骤：{text}', 'Step completed: {text}', 'Paso completado: {text}'],
  'detail.entry.stageMove': ['阶段推进：{from} → {to}', 'Stage moved: {from} → {to}', 'Etapa: {from} → {to}'],
  'detail.entry.advanced': ['状态 {status}｜下一步：{next}（{due}）', 'Status {status} | next: {next} ({due})', 'Estado {status} | siguiente: {next} ({due})'],
  'detail.entry.chat': ['发送消息：{message}', 'Message sent: {message}', 'Mensaje enviado: {message}'],
  'detail.entry.readReceipt': ['{reader} 已读通知', '{reader} read the notification', '{reader} leyó la notificación'],

  'weekly.title': ['每周视图', 'Weekly view', 'Vista semanal'],
  'weekly.desc': ['每周花 30 分钟过一遍：现在到哪、下一步是什么、什么时候完成。',
    'Take 30 minutes each week to review where things stand, what is next, and when it is due.',
    'Dedica 30 minutos cada semana a revisar la situación, el próximo paso y la fecha límite.'],
  'weekly.print': ['打印／导出 PDF', 'Print / export PDF', 'Imprimir / exportar PDF'],
  'weekly.items': ['· {n} 项', '· {n} matters', '· {n} asuntos'],
  'weekly.stage': ['现状', 'Where we are', 'Situación'],
  'weekly.next': ['现在该做', 'Do now', 'Hacer ahora'],
  'weekly.who': ['谁做', 'Who', 'Quién'],
  'weekly.due': ['截止', 'Due', 'Vence'],
  'weekly.waiting': ['在等谁', 'Waiting on', 'Esperando a'],
  'weekly.empty': ['没有可显示的事项。', 'Nothing to show.', 'Nada que mostrar.'],

  'settings.title': ['信息', 'Info', 'Información'],
  'settings.desc': ['成员、可见范围和编号规则。',
    'Members, visibility, and numbering.',
    'Miembros, visibilidad y numeración.'],
  'settings.reset': ['重置演示数据', 'Reset demo data', 'Restablecer datos de demo'],
  'settings.notice': ['邮件提醒只是预览，不会真的发。接上服务器后，这件事就能变成真的',
    'Email reminders are only a preview and are not actually sent. Once connected to a server, this can become real.',
    'Los recordatorios por correo son solo una vista previa y no se envían realmente. Al conectar el servidor, esto podrá hacerse realidad.'],
  'settings.members': ['团队成员', 'Team members', 'Miembros del equipo'],
  'th.name': ['姓名', 'Name', 'Nombre'],
  'th.email': ['邮箱', 'Email', 'Correo'],
  'th.role': ['角色', 'Role', 'Rol'],
  'th.access': ['权限', 'Access', 'Acceso'],
  'settings.admin': ['管理员', 'Admin', 'Administradora'],
  'settings.member': ['成员', 'Member', 'Miembro'],
  'settings.loginHint': ['登录用邮箱 + 密码（或邮件一次性链接），不用短信验证码——这正是两位墨西哥同事加不进飞书的原因。',
    'Sign-in is email + password (or a one-time email link), with no SMS code — which is exactly why the two Mexican colleagues could not join Lark.',
    'El acceso es con correo y contraseña (o un enlace de un solo uso), sin código SMS: justo lo que impedía entrar a los dos colegas mexicanos en Lark.'],
  'settings.defaultTeam': ['新事项默认勾选谁', 'Default members for new matters', 'Miembros predeterminados'],
  'settings.defaultTeamHint': ['真正的门禁是事项里的「项目成员」：只有被勾选的人能打开它，别人连列表里都看不到。这张表只是新建时的默认值，每一条事项都可以单独调整。<br>Carol 是管理员，始终能看到全部事项。',
    'The real gate is “Matter members”: only ticked people can open a matter, and others do not even see it in the list. This table is just the default for new matters, and every matter can be adjusted on its own.<br>Carol, as admin, always sees every matter.',
    'El control real son los «Miembros del asunto»: solo quienes estén marcados pueden abrirlo y los demás ni lo ven en la lista. Esta tabla es solo el valor predeterminado y cada asunto puede ajustarse.<br>Carol, como administradora, siempre ve todo.'],
  'settings.trash': ['回收站', 'Recycle bin', 'Papelera'],
  'settings.trashCount': ['{n} 条', '{n} matters', '{n} asuntos'],
  'settings.trashEmpty': ['回收站是空的。删除的事项会先放到这里，可以恢复。', 'The recycle bin is empty. Deleted matters land here first and can be restored.', 'La papelera está vacía. Los asuntos eliminados llegan aquí y pueden restaurarse.'],
  'settings.trashMeta': ['{client} · 删除于 {when}', '{client} · deleted {when}', '{client} · eliminado {when}'],
  'settings.trashRestore': ['恢复', 'Restore', 'Restaurar'],
  'settings.trashPurge': ['彻底删除', 'Delete forever', 'Eliminar definitivamente'],
  'trash.selectAll': ['全选', 'Select all', 'Seleccionar todo'],
  'trash.bulkPurge': ['批量彻底删除', 'Delete forever in bulk', 'Eliminar definitivamente en lote'],
  'settings.trashAdminOnly': ['仅事项负责人{name}可操作', 'Only matter owner {name} can act', 'Solo el responsable {name} puede realizar esta acción'],
  'settings.trashHint': ['恢复或彻底删除事项，只能由该事项的<b>负责人</b>操作。',
    'Only the matter <b>owner</b> can restore or permanently delete it.',
    'Solo el <b>responsable</b> del asunto puede restaurarlo o eliminarlo definitivamente.'],
  'trash.desc': ['删除的事项会保留在这里，可以恢复或彻底删除。',
    'Deleted matters stay here and can be restored or permanently deleted.',
    'Los asuntos eliminados permanecen aquí y pueden restaurarse o eliminarse definitivamente.'],
  'settings.numbering': ['编号规则', 'Numbering', 'Numeración'],
  'settings.numberFormat': ['格式', 'Format', 'Formato'],
  'settings.numberFormatValue': ['年份 - 三位序号', 'Year + 3 digits', 'Año + 3 dígitos'],
  'settings.numberExample': ['示例', 'Example', 'Ejemplo'],
  'settings.numberNext': ['下一条编号', 'Next number', 'Próximo número'],
  'settings.securityTools': ['安全与备份', 'Security and backup', 'Seguridad y respaldo'],
  'settings.backupExport': ['下载加密备份', 'Download encrypted backup', 'Descargar respaldo cifrado'],
  'settings.backupRestore': ['恢复加密备份', 'Restore encrypted backup', 'Restaurar respaldo cifrado'],
  'settings.backupHint': ['备份仍是密文，恢复时需要原账号密码。请妥善保存。', 'The backup remains encrypted and requires the original account password. Store it safely.', 'El respaldo permanece cifrado y requiere la contraseña original. Guárdalo de forma segura.'],
  'settings.logoutAll': ['退出所有设备', 'Sign out all devices', 'Cerrar sesión en todos'],
  'settings.sessions': ['登录设备', 'Signed-in devices', 'Dispositivos conectados'],
  'settings.deviceCurrent': ['当前设备', 'Current device', 'Dispositivo actual'],
  'settings.deviceLastSeen': ['最近活动：{time}', 'Last active: {time}', 'Última actividad: {time}'],
  'settings.deviceLocation': ['位置：{place}', 'Location: {place}', 'Ubicación: {place}'],
  'settings.deviceLocationUnknown': ['位置未授权', 'Location not authorized', 'Ubicación no autorizada'],
  'settings.deviceIp': ['IP：{ip}', 'IP: {ip}', 'IP: {ip}'],
  'settings.deviceRevoke': ['退出此设备', 'Sign out device', 'Cerrar este dispositivo'],
  'settings.deviceEmpty': ['暂无已记录设备，重新登录后会显示。', 'No recorded devices yet. Sign in again to register this device.', 'Aún no hay dispositivos registrados. Vuelve a iniciar sesión.'],
  'modal.deviceRevoke.title': ['退出这台设备？', 'Sign out this device?', '¿Cerrar sesión en este dispositivo?'],
  'modal.deviceRevoke.body': ['这台设备将立即失去网站访问权限，需要重新输入密码。', 'This device will immediately lose access and must sign in again.', 'Este dispositivo perderá el acceso inmediatamente y deberá iniciar sesión de nuevo.'],
  'modal.deviceRevoke.confirm': ['确认退出', 'Sign out device', 'Cerrar sesión'],
  'settings.securityEvents': ['查看安全记录', 'View security events', 'Ver eventos de seguridad'],
  'modal.securityEvents.title': ['最近安全记录', 'Recent security events', 'Eventos de seguridad recientes'],
  'modal.securityEvents.empty': ['暂无异常记录。', 'No security events recorded.', 'No hay eventos de seguridad.'],
  'modal.logoutAll.title': ['退出所有设备？', 'Sign out all devices?', '¿Cerrar sesión en todos los dispositivos?'],
  'modal.logoutAll.body': ['所有设备上的登录都会失效，本机也要重新登录。', 'Every session will be revoked and this device must sign in again.', 'Se revocarán todas las sesiones y tendrás que iniciar sesión de nuevo.'],
  'modal.logoutAll.confirm': ['确认全部退出', 'Sign out everywhere', 'Cerrar todas las sesiones'],
  'modal.backupRestore.title': ['恢复加密备份？', 'Restore encrypted backup?', '¿Restaurar respaldo cifrado?'],
  'modal.backupRestore.body': ['备份中的密文数据会写回服务器。现有同编号数据将被覆盖。', 'Encrypted backup data will be written to the server. Existing matching records will be replaced.', 'Los datos cifrados se escribirán en el servidor y sustituirán los registros coincidentes.'],
  'modal.backupRestore.confirm': ['确认恢复', 'Restore backup', 'Restaurar respaldo'],
  'toast.backupDone': ['加密备份已下载', 'Encrypted backup downloaded', 'Respaldo cifrado descargado'],
  'toast.restoreDone': ['加密备份已恢复', 'Encrypted backup restored', 'Respaldo cifrado restaurado'],
  'modal.new.title': ['新建事项', 'New matter', 'Nuevo asunto'],
  'modal.new.submit': ['创建事项', 'Create matter', 'Crear asunto'],
  'calendar.schedule': ['日程', 'Schedule', 'Agenda'],
  'calendar.chooseTitle': ['{date} 日程', 'Schedule for {date}', 'Agenda del {date}'],
  'calendar.chooseHint': ['请选择要添加的内容。', 'Choose what to add.', 'Elige qué deseas agregar.'],
  'calendar.newMatter': ['新建事项', 'New matter', 'Nuevo asunto'],
  'calendar.dayReminder': ['当日提醒', 'Same-day reminder', 'Recordatorio del día'],
  'calendar.reminderTitle': ['新建当日提醒', 'New same-day reminder', 'Nuevo recordatorio del día'],
  'calendar.reminderEnable': ['启用提醒', 'Enable reminder', 'Activar recordatorio'],
  'calendar.reminderTime': ['提醒时间', 'Reminder time', 'Hora del recordatorio'],
  'calendar.reminderMessage': ['通知内容', 'Notification text', 'Texto de la notificación'],
  'calendar.reminderPlaceholder': ['例如：下午联系客户确认材料', 'For example: Contact the client about the documents', 'Por ejemplo: Contactar al cliente sobre los documentos'],
  'calendar.reminderSave': ['保存提醒', 'Save reminder', 'Guardar recordatorio'],
  'calendar.reminderSaved': ['提醒已保存', 'Reminder saved', 'Recordatorio guardado'],
  'calendar.reminderDelete': ['删除提醒', 'Delete reminder', 'Eliminar recordatorio'],
  'calendar.reminderDeleteTitle': ['删除这条提醒？', 'Delete this reminder?', '¿Eliminar este recordatorio?'],
  'calendar.reminderHint': ['到点时网页需保持打开；通知也会保存在“通知”标签页。', 'Keep the site open at the scheduled time; the alert is also saved under Notifications.', 'Mantén el sitio abierto a la hora indicada; el aviso también se guarda en Notificaciones.'],
  'calendar.previous': ['上个月', 'Previous', 'Anterior'],
  'calendar.today': ['今天', 'Today', 'Hoy'],
  'calendar.next': ['下个月', 'Next', 'Siguiente'],
  'modal.new.membersHint': ['默认只有创建者可见；勾选另一位成员后才会共享。Carol 作为管理员始终可见。',
    'Only the creator can see it by default. Tick the other member to share it. Carol can always see it as administrator.',
    'Por defecto solo lo ve quien lo crea. Marca al otro miembro para compartirlo. Carol siempre puede verlo como administradora.'],
  'modal.file.title': ['上传加密附件', 'Upload encrypted file', 'Subir archivo cifrado'],
  'modal.file.name': ['选择文件', 'Choose file', 'Elegir archivo'],
  'modal.file.hint': ['文件会先在本机加密，再上传到个人私有存储。最大 20 MB。', 'The file is encrypted on this device before upload to private storage. Maximum 20 MB.', 'El archivo se cifra en este dispositivo antes de subirlo al almacenamiento privado. Máximo 20 MB.'],
  'modal.file.submit': ['加密并上传', 'Encrypt and upload', 'Cifrar y subir'],
  'modal.chat.title': ['事项聊天', 'Matter chat', 'Chat del asunto'],
  'modal.chat.to': ['发送给事项成员', 'Send to matter members', 'Enviar a los miembros del asunto'],
  'modal.chat.noRecipients': ['这条事项没有其他可接收消息的成员。', 'This matter has no other members who can receive a message.', 'Este asunto no tiene otros miembros que puedan recibir el mensaje.'],
  'modal.chat.message': ['消息', 'Message', 'Mensaje'],
  'modal.chat.placeholder': ['输入要发给事项成员的消息…', 'Type a message for the matter members…', 'Escribe un mensaje para los miembros del asunto…'],
  'modal.chat.send': ['发送消息', 'Send message', 'Enviar mensaje'],
  'modal.complete.title': ['完成当前步骤', 'Complete the current step', 'Completar el paso actual'],
  'modal.complete.stage': ['下一步阶段', 'Next stage', 'Etapa siguiente'],
  'modal.complete.nextOwner': ['下一步负责人', 'Owner of the next step', 'Responsable del próximo paso'],
  'modal.complete.aboutTo': ['即将完成这一步', 'About to complete', 'A punto de completar'],
  'modal.complete.afterHint': ['填完了，这条事项就进入下一步。下面填的是<b>完成之后</b>的新状态。',
    'Once you save, the matter moves to the next step. Fill in the new state <b>after</b> completion.',
    'Al guardar, el asunto pasa al siguiente paso. Rellena el estado <b>posterior</b>.'],
  'modal.complete.submit': ['完成这一步', 'Complete step', 'Completar paso'],
  'form.next': ['下一步做什么', 'What is the next step', '¿Cuál es el próximo paso?'],
  'form.waiting': ['正在等待谁', 'Waiting on whom', '¿A quién esperamos?'],
  'form.nextPh': ['例如：把修改稿发给客户确认', 'e.g. Send the revised draft to the client', 'p. ej. Enviar el borrador revisado al cliente'],
  'form.stepMembers': ['当前步骤成员', 'Members for this step', 'Miembros de este paso'],
  'form.stepMembersHint': ['和详情页里的「项目成员」是同一份名单：勾谁，谁就能看到这条事项。',
    'This is the same list as “Matter members” on the detail page: whoever is ticked can see the matter.',
    'Es la misma lista que «Miembros del asunto»: quien esté marcado puede ver el asunto.'],
  'form.custom': ['自定义…', 'Custom…', 'Personalizado…'],
  'form.customAreaPh': ['输入业务类型', 'Type a practice area', 'Escribe un área de práctica'],
  'form.customStagePh': ['输入阶段名称', 'Type a stage name', 'Escribe una etapa'],
  'form.customWaitPh': ['输入在等谁', 'Type who you are waiting on', 'Escribe a quién esperas'],
  'toast.needCustom': ['选了「自定义」，请把内容填上', 'You picked “Custom” — please fill it in', 'Elegiste «Personalizado»: escribe el valor'],
  'modal.logout.title': ['退出登录？', 'Sign out?', '¿Cerrar sesión?'],
  'modal.logout.body': ['退出后需要重新输入邮箱和密码才能进来。已经记录的事项数据不会丢失。',
    'You will need your email and password to get back in. Saved matter data is not lost.',
    'Necesitarás tu correo y contraseña para volver. Los datos guardados no se pierden.'],
  'modal.logout.confirm': ['退出登录', 'Sign out', 'Cerrar sesión'],
  'modal.reset.title': ['重置为演示数据？', 'Reset to demo data?', '¿Restablecer los datos de demo?'],
  'modal.reset.body': ['你自己新增和修改的内容会被清掉，回到最初的演示数据。这一步不能撤销。',
    'Everything you added or changed will be cleared and the original demo data restored. This cannot be undone.',
    'Se borrará todo lo que añadiste o cambiaste y volverán los datos de demo. No se puede deshacer.'],
  'modal.reset.confirm': ['重置', 'Reset', 'Restablecer'],
  'modal.delete.title': ['删除这条事项？', 'Delete this matter?', '¿Eliminar este asunto?'],
  'modal.delete.body': ['确定删除「{no} {title}」吗？\n\n删除后它会进入回收站，需要时可以恢复。',
    'Delete “{no} {title}”?\n\nIt will go to the recycle bin and can be restored later.',
    '¿Eliminar «{no} {title}»?\n\nIrá a la papelera y podrás restaurarlo más tarde.'],
  'modal.delete.confirm': ['删除', 'Delete', 'Eliminar'],
  'modal.bulkDelete.title': ['批量删除事项？', 'Delete matters in bulk?', '¿Eliminar asuntos en lote?'],
  'modal.bulkDelete.body': ['确定删除选中的 {n} 条事项吗？\n\n删除后将进入回收站，需要时可以恢复。',
    'Delete the {n} selected matters?\n\nThey will be moved to the recycle bin and can be restored later.',
    '¿Eliminar los {n} asuntos seleccionados?\n\nSe moverán a la papelera y podrán restaurarse más adelante.'],
  'modal.bulkDelete.confirm': ['删除 {n} 条', 'Delete {n}', 'Eliminar {n}'],
  'modal.purge.title': ['彻底删除？', 'Delete forever?', '¿Eliminar definitivamente?'],
  'modal.purge.body': ['「{no} {title}」和它的全部动态记录会被永久删除，无法恢复。',
    '“{no} {title}” and all of its activity history will be permanently deleted. This cannot be undone.',
    '«{no} {title}» y todo su historial se eliminarán para siempre. No se puede deshacer.'],
  'modal.purge.confirm': ['彻底删除', 'Delete forever', 'Eliminar definitivamente'],
  'modal.bulkPurge.title': ['批量彻底删除？', 'Delete forever in bulk?', '¿Eliminar definitivamente en lote?'],
  'modal.bulkPurge.body': ['选中的 {n} 条事项及其全部动态记录会被永久删除，无法恢复。',
    'The {n} selected matters and all their activity history will be permanently deleted. This cannot be undone.',
    'Los {n} asuntos seleccionados y todo su historial se eliminarán para siempre. No se puede deshacer.'],
  'modal.bulkPurge.confirm': ['彻底删除 {n} 条', 'Delete {n} forever', 'Eliminar {n} definitivamente'],
  'modal.denyDelete.title': ['无法删除', 'Cannot delete', 'No se puede eliminar'],
  'modal.denyDelete.body': ['只有项目负责人 <b>{name}</b> 才能删除事项。', 'Only the matter owner, <b>{name}</b>, can delete it.', 'Solo el responsable del asunto, <b>{name}</b>, puede eliminarlo.'],
  'modal.denyStep.title': ['无法完成这一步', 'Cannot complete this step', 'No se puede completar este paso'],
  'modal.denyStep.body': ['只有当前步骤负责人 <b>{name}</b> 才能完成这一步。<br><br>当前步骤：{next}',
    'Only the owner of the current step, <b>{name}</b>, can complete it.<br><br>Current step: {next}',
    'Solo el responsable del paso actual, <b>{name}</b>, puede completarlo.<br><br>Paso actual: {next}'],
  'modal.undo.title': ['撤销到上一步？', 'Undo to the previous step?', '¿Deshacer al paso anterior?'],
  'modal.undo.body': ['「{text}」会重新变成当前待办步骤（截止 {due}），刚才那条完成记录会被删掉。\n\n这一步通常是用来修正误操作。',
    '“{text}” becomes the current pending step again (due {due}), and the completion record is removed.\n\nUse this to fix a mistake.',
    '«{text}» vuelve a ser el paso pendiente (vence {due}) y se borra el registro de finalización.\n\nSirve para corregir un error.'],
  'modal.undo.confirm': ['撤销', 'Undo', 'Deshacer'],
  'modal.undoEdit.title': ['撤回上次修改？', 'Undo the last edit?', '¿Deshacer la última modificación?'],
  'modal.undoEdit.body': ['将撤回 {name} 在 {when} 保存的那次事项修改。聊天、文件、步骤和删除记录不会受影响。',
    'This will undo the matter edit saved by {name} at {when}. Chat, files, steps and deletion history are not affected.',
    'Se deshará la modificación del asunto guardada por {name} a las {when}. El chat, los archivos, los pasos y el historial de eliminación no se verán afectados.'],
  'modal.undoEdit.confirm': ['撤回修改', 'Undo edit', 'Deshacer modificación'],
  'modal.denyUndoEdit.title': ['无法撤回修改', 'Cannot undo this edit', 'No se puede deshacer esta modificación'],
  'modal.denyUndoEdit.body': ['只有管理员，或上次修改事项的人 {name}，可以撤回这次修改。',
    'Only an admin or {name}, who made the last edit, can undo it.',
    'Solo una administradora o {name}, quien hizo la última modificación, puede deshacerla.'],
  'modal.disableSystem.title': ['关闭系统通知？', 'Turn off system notifications?', '¿Desactivar las notificaciones del sistema?'],
  'modal.disableSystem.body': ['注意，关闭系统通知后任何人执行操作时都不会向您发送响铃通知，团队协作时，强烈建议您开启！',
    'Please note: after turning off system notifications, you will not receive alert notifications when anyone performs an action. We strongly recommend keeping them enabled for team collaboration!',
    'Atención: al desactivar las notificaciones del sistema, no recibirá avisos sonoros cuando alguien realice una acción. Para la colaboración del equipo, recomendamos encarecidamente mantenerlas activadas.'],
  'modal.disableSystem.confirm': ['确认关闭', 'Turn off', 'Desactivar'],
  'modal.deleteNotification.title': ['删除这条消息？', 'Delete this message?', '¿Eliminar este mensaje?'],
  'modal.deleteNotification.body': ['删除后，这条消息将从您的通知中移除，但不会影响事项动态或其他成员收到的通知。',
    'This message will be removed from your notifications. Matter activity and other members’ copies will not be affected.',
    'Este mensaje se eliminará de sus notificaciones, sin afectar la actividad del asunto ni las copias de otros miembros.'],
  'modal.deleteNotification.confirm': ['删除消息', 'Delete message', 'Eliminar mensaje'],
  'modal.denyUndo.title': ['无法撤销', 'Cannot undo', 'No se puede deshacer'],
  'modal.denyUndo.body': ['只有管理员，或刚完成这一步的人，可以撤销。<br><br>最后完成这一步的是 {name}。',
    'Only an admin, or the person who completed the step, can undo.<br><br>The last completion was by {name}.',
    'Solo la administradora o quien completó el paso puede deshacer.<br><br>La última finalización fue de {name}.'],
  'modal.delete.adminNote': ['\n\n（管理员操作：这条事项的负责人是 {name}）', '\n\n(Admin action: the matter owner is {name})', '\n\n(Acción de administradora: el responsable es {name})'],
  'modal.complete.adminNote': ['管理员操作：这一步正常由 {name} 负责。', 'Admin action: this step is normally owned by {name}.', 'Acción de administradora: este paso lo lleva {name}.'],
  'toast.undoDone': ['已撤销，回到「{text}」', 'Undone — back to “{text}”', 'Deshecho: vuelta a «{text}»'],
  'toast.editUndoDone': ['已撤回上次修改', 'Last edit undone', 'Última modificación deshecha'],
  'toast.noEditToUndo': ['没有可撤回的事项修改', 'There is no matter edit to undo', 'No hay ninguna modificación que deshacer'],
  'toast.noSteps': ['这条事项还没有完成过步骤，不能撤销。', 'No completed steps to undo yet.', 'Todavía no hay pasos completados que deshacer.'],
  'modal.cancel': ['取消', 'Cancel', 'Cancelar'],
  'common.ok': ['知道了', 'Got it', 'Entendido'],
  'common.remove': ['移除', 'Remove', 'Quitar'],
  'common.saveChanges': ['保存修改', 'Save changes', 'Guardar cambios'],

  'toast.saved': ['已保存', 'Saved', 'Guardado'],
  'toast.created': ['已创建 {no}', 'Created {no}', 'Creado {no}'],
  'toast.deleted': ['已删除 {no}，可在设置里恢复', 'Deleted {no}, restorable in Settings', 'Eliminado {no}, restaurable en Ajustes'],
  'toast.bulkDeleted': ['已删除 {n} 条事项，可在回收站恢复', '{n} matters deleted; you can restore them from the recycle bin', 'Se eliminaron {n} asuntos; puede restaurarlos desde la papelera'],
  'toast.restored': ['已恢复 {no}', 'Restored {no}', 'Restaurado {no}'],
  'toast.purged': ['已彻底删除', 'Permanently deleted', 'Eliminado definitivamente'],
  'toast.bulkPurged': ['已彻底删除 {n} 条事项', '{n} matters permanently deleted', 'Se eliminaron definitivamente {n} asuntos'],
  'toast.stepDone': ['已完成这一步，事项进入下一步', 'Step completed — the matter moved on', 'Paso completado: el asunto ha avanzado'],
  'toast.fileAdded': ['加密附件已上传', 'Encrypted file uploaded', 'Archivo cifrado subido'],
  'toast.fileDownloaded': ['附件已安全解密', 'File decrypted securely', 'Archivo descifrado de forma segura'],
  'toast.fileFailed': ['附件操作失败，请重试', 'File operation failed. Try again.', 'Error con el archivo. Inténtalo de nuevo.'],
  'toast.fileTooLarge': ['文件不能超过 20 MB', 'File must be 20 MB or smaller', 'El archivo no puede superar 20 MB'],
  'toast.chatSent': ['消息已发送', 'Message sent', 'Mensaje enviado'],
  'toast.needMessage': ['请输入消息', 'Please enter a message', 'Escribe un mensaje'],
  'toast.needChatRecipient': ['请至少勾选一位事项成员', 'Select at least one matter member', 'Selecciona al menos un miembro del asunto'],
  'toast.markedRead': ['已标为已读', 'Marked as read', 'Marcado como leído'],
  'toast.systemEnabled': ['✅已开启系统通知', '✅ System notifications enabled', '✅ Notificaciones del sistema activadas'],
  'toast.systemDisabled': ['❎已关闭系统通知', '❎ System notifications turned off', '❎ Notificaciones del sistema desactivadas'],
  'toast.notificationDeleted': ['已删除消息', 'Message deleted', 'Mensaje eliminado'],
  'toast.systemDenied': ['系统通知已被浏览器阻止', 'System notifications have been blocked by the browser', 'El navegador ha bloqueado las notificaciones del sistema'],
  'toast.loggedOut': ['已退出登录', 'Signed out', 'Sesión cerrada'],
  'toast.switched': ['已切换到 {name}', 'Switched to {name}', 'Cambiado a {name}'],
  'toast.reset': ['已重置为演示数据', 'Demo data restored', 'Datos de demo restablecidos'],
  'toast.areaDefault': ['已按业务类型默认勾选项目成员', 'Members reset to this area\'s defaults', 'Miembros restablecidos para esta área'],
  'toast.needClient': ['客户、事项名称、下一步、截止日期都必须填写', 'Client, matter name, next step and due date are required', 'Cliente, nombre, próximo paso y fecha límite son obligatorios'],
  'toast.needReason': ['选了黄色或红色，请写一句原因', 'Yellow or red needs a short reason', 'Amarillo o rojo requiere un motivo'],
  'toast.needNext': ['请填写下一步做什么', 'Please fill in the next step', 'Indica el próximo paso'],
  'toast.needDue': ['请填写截止日期', 'Please set a due date', 'Indica la fecha límite'],
  'toast.needStatus': ['请选择状态', 'Please choose a status', 'Elige un estado'],
  'toast.needFileName': ['请选择文件', 'Please choose a file', 'Elige un archivo'],
  'toast.onlyOwnerDelete': ['只有项目负责人 {name} 才能删除事项', 'Only the matter owner, {name}, can delete it', 'Solo el responsable, {name}, puede eliminarlo'],
  'toast.onlyStepOwner': ['只有当前步骤负责人 {name} 才能完成这一步', 'Only the current step owner, {name}, can complete it', 'Solo el responsable del paso, {name}, puede completarlo'],
  'toast.adminRestore': ['仅事项负责人 {name} 可以恢复事项', 'Only matter owner {name} can restore it', 'Solo el responsable {name} puede restaurarlo'],
  'toast.adminPurge': ['仅事项负责人 {name} 可以彻底删除事项', 'Only matter owner {name} can delete it permanently', 'Solo el responsable {name} puede eliminarlo definitivamente'],
  'toast.exported': ['已导出 CSV', 'CSV exported', 'CSV exportado'],

  'csv.filename': ['Matter总表.csv', 'Matter-board.csv', 'Tablero-de-asuntos.csv'],
  'csv.no': ['编号', 'No.', 'Nº'],
  'csv.client': ['客户', 'Client', 'Cliente'],
  'csv.title': ['事项', 'Matter', 'Asunto'],
  'csv.area': ['业务类型', 'Practice area', 'Área'],
  'csv.owner': ['负责人', 'Owner', 'Responsable'],
  'csv.status': ['状态', 'Status', 'Estado'],
  'csv.stage': ['当前阶段', 'Stage', 'Etapa'],
  'csv.next': ['下一步', 'Next step', 'Próximo paso'],
  'csv.nextOwner': ['下一步负责人', 'Next-step owner', 'Responsable del paso'],
  'csv.due': ['截止日期', 'Due date', 'Fecha límite'],
  'csv.waiting': ['等待谁', 'Waiting for', 'Esperando a'],
  'csv.lastContact': ['最后联系客户', 'Last client contact', 'Último contacto'],
  'csv.notes': ['备注', 'Notes', 'Notas'],
  'csv.reason': ['状态说明', 'Status note', 'Nota de estado'],

  'fmt.notSet': ['未设定', 'Not set', 'Sin fecha'],
  'fmt.overdue': ['逾期 {n} 天', '{n} days overdue', 'Vencido hace {n} días'],
  'fmt.today': ['今天到期', 'Due today', 'Vence hoy'],
  'fmt.tomorrow': ['明天到期', 'Due tomorrow', 'Vence mañana'],
  'fmt.inDays': ['还有 {n} 天', 'In {n} days', 'En {n} días'],
  'fmt.pick': ['请选择日期', 'Pick a date', 'Elige una fecha'],
};

let lang = 'zh';
try {
  const savedLang = load(KEY.lang, null);
  if (savedLang && LANG_INDEX[savedLang] !== undefined) lang = savedLang;
} catch (e) { /* 用默认中文 */ }

function t(key, vars) {
  const e = STR[key];
  let s = e ? (e[LANG_INDEX[lang]] !== undefined ? e[LANG_INDEX[lang]] : e[0]) : key;
  if (vars) {
    Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
  }
  return s;
}
/* 数据里的文案支持三种语言：{zh,en,es}；用户自己输入的普通字符串原样返回 */
function L(v) {
  if (v == null) return '';
  if (typeof v === 'object' && !Array.isArray(v)) return v[lang] !== undefined ? v[lang] : (v.zh || v.en || '');
  return v;
}
function waitLabel(w) {
  return STR['wait.' + w] ? t('wait.' + w) : (w || t('wait.none'));
}
function stageLabel(s) {
  return STAGE_KEY[s] ? t(STAGE_KEY[s]) : (s || '');
}
/* 下拉 + 自定义：选「自定义…」时露出一个输入框。
   attr 形如 data-field="stage" 或 name="stage"，自定义输入框会自动带上 Custom 后缀。 */
function selectWithCustom(attr, value, options, placeholder) {
  const known = options.some(o => o.v === value);
  const isCustom = !!value && !known;
  const customAttr = attr.replace(/(data-field|name)="([^"]+)"/, '$1="$2Custom"').replace(/\s+data-area-picker\b/, '');
  return `
    <select ${attr} data-custom-select>
      ${options.map(o => `<option value="${esc(o.v)}" ${o.v === value ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}
      <option value="__custom__" ${isCustom ? 'selected' : ''}>${esc(t('form.custom'))}</option>
    </select>
    <input class="custom-input" ${customAttr} value="${isCustom ? esc(value) : ''}"
      placeholder="${esc(placeholder)}" autocomplete="off"${isCustom ? '' : ' style="display:none"'}>`;
}
function resolveCustom(value, customValue) {
  if (value !== '__custom__') return value;
  const v = String(customValue || '').trim();
  return v || null;
}
function stageOptions() { return STAGES.map(s => ({ v: s, t: stageLabel(s) })); }
function waitingOptions() { return WAITING.map(w => ({ v: w, t: waitLabel(w) })); }
function practiceAreaOptions() { return PRACTICE_AREAS.map(a => ({ v: a.id, t: areaName(a.id) })); }
function statusName(k) { return t('status.' + k); }
function statusShort(k) { return t('status.' + k + '.short'); }

const PRACTICE_AREAS = [
  { id: 'mx_invest', name: { zh: '墨西哥公司／投资', en: 'Mexico Corporate / Investment', es: 'Corporativo / Inversión en México' }, restricted: false },
  { id: 'mx_reg', name: { zh: '墨西哥监管', en: 'Mexico Regulatory', es: 'Regulación en México' }, restricted: false },
  { id: 'sanctions', name: { zh: '制裁／涉美', en: 'Sanctions / U.S.', es: 'Sanciones / EE. UU.' }, restricted: false },
  { id: 'aml', name: { zh: '反洗钱／跨境支付', en: 'AML / Cross-border Payments', es: 'Prevención de lavado / Pagos transfronterizos' }, restricted: false },
  { id: 'dispute', name: { zh: '争议解决', en: 'Dispute Resolution', es: 'Resolución de disputas' }, restricted: false },
  { id: 'internal', name: { zh: '内部项目', en: 'Internal Project', es: 'Proyecto interno' }, restricted: false },
  { id: 'other', name: { zh: '其他', en: 'Other', es: 'Otro' }, restricted: false },
];
const AREA = Object.fromEntries(PRACTICE_AREAS.map(a => [a.id, a]));
function areaName(id) { return AREA[id] ? L(AREA[id].name) : (id || ''); }

const USERS = SITE_CONFIG.users;
const USER = Object.fromEntries(USERS.map(u => [u.id, u]));

const STAGES = ['Engagement', 'Consultation', 'Due Diligence', 'Legal Research', 'Drafting', 'Filing / Submission', 'Government Review', 'Closing', 'On Hold'];
// 阶段在数据里统一存英文原值，界面上按语言显示
const STAGE_KEY = {
  'Engagement': 'stage.engagement',
  'Consultation': 'stage.consultation',
  'Due Diligence': 'stage.dd',
  'Legal Research': 'stage.research',
  'Drafting': 'stage.drafting',
  'Filing / Submission': 'stage.filing',
  'Government Review': 'stage.gov',
  'Closing': 'stage.closing',
  'On Hold': 'stage.hold',
};
const WAITING = ['none', 'client', 'counterparty', 'authority', 'notary', 'bank', 'ofac', 'tax', 'other'];

const STATUS = {
  green: { dot: '🟢', cls: 's-green' },
  yellow: { dot: '🟡', cls: 's-yellow' },
  red: { dot: '🔴', cls: 's-red' },
};
const STATUS_ORDER = { red: 0, yellow: 1, green: 2 };

const APP_TITLE_KEY = 'app.title';
const TEAM_NAME_KEY = 'app.team';

/* ------------------------------ 存储 ------------------------------ */

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 忽略隐私模式下的写入失败 */ }
}
function loadSessionValue(key, fallback) {
  try { const raw = sessionStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); }
  catch (e) { return fallback; }
}
function saveSessionValue(key, value) {
  try { if (value == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { /* ignore */ }
}

// 有些浏览器不允许 file:// 页面保存数据（Safari 常见），这时给出提示
const CAN_PERSIST = (() => {
  try {
    localStorage.setItem('__lcb_probe__', '1');
    localStorage.removeItem('__lcb_probe__');
    return true;
  } catch (e) {
    return false;
  }
})();

/* ------------------------------ 时间工具 ------------------------------ */

function iso(d) {
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function addDays(n) { const d = today(); d.setDate(d.getDate() + n); return d; }
function parseISO(s) { const [y, m, dd] = String(s).split('-').map(Number); return new Date(y, m - 1, dd); }
function daysFromToday(s) {
  if (!s) return null;
  return Math.round((parseISO(s) - today()) / 86400000);
}
const MONTHS = {
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};
function fmtDate(s) {
  if (!s) return t('fmt.notSet');
  const d = parseISO(s);
  if (lang === 'zh') return `${d.getMonth() + 1}月${d.getDate()}日`;
  if (lang === 'es') return `${d.getDate()} ${MONTHS.es[d.getMonth()]}`;
  return `${MONTHS.en[d.getMonth()]} ${d.getDate()}`;
}
function fmtDateShort(s) {
  if (!s) return '—';
  const d = parseISO(s);
  if (lang === 'es') return `${d.getDate()}/${d.getMonth() + 1}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtStamp(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dueClass(s) {
  const n = daysFromToday(s);
  if (n === null) return '';
  if (n < 0) return 'over';
  if (n <= 3) return 'soon';
  return '';
}
function dueText(s) {
  const n = daysFromToday(s);
  if (n === null) return t('fmt.notSet');
  if (n < 0) return t('fmt.overdue', { n: -n });
  if (n === 0) return t('fmt.today');
  if (n === 1) return t('fmt.tomorrow');
  return t('fmt.inDays', { n });
}
function normalizeImportedDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return iso(value);
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + serial * 86400000));
  }
  const m = raw.match(/^(\d{4})\s*[年\/-](\d{1,2})\s*[月\/-](\d{1,2})日?$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = new Date(raw.replace(/[年\/]/g, '-').replace(/月/g, '-').replace(/日/g, ''));
  return Number.isNaN(d.getTime()) ? '' : iso(d);
}
function normalizeImportedStatus(value) {
  const raw = String(value == null ? '' : value).toLowerCase()
    .replace(/[🟢🟡🔴]/g, ' ').replace(/[·•]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const has = values => values.some(value => raw.includes(value));
  if (has(['紧急', 'urgent', 'urgente', '需要立即处理', 'act now', 'requiere acción inmediata']) || ['red', 'rojo'].includes(raw)) return 'red';
  if (has(['关注', 'watch', 'attention', 'atención', '等待客户', 'waiting on client', 'at risk', 'en riesgo']) || ['yellow', 'amarillo'].includes(raw)) return 'yellow';
  if (has(['正常', 'normal', 'on track', 'en curso']) || ['green', 'verde'].includes(raw)) return 'green';
  return '';
}
function isThisWeek(s) {
  const n = daysFromToday(s);
  return n !== null && n >= 0 && n <= 7;
}

/* ------------------------------ 示例数据 ------------------------------ */

function seedMatters() {
  const all = ['carol', 'carlos', 'hector'];
  const cc = ['carol', 'carlos'];
  return [
    {
      id: 35, no: '2026-035', client: 'ABC Ltd',
      title: { zh: '墨西哥设厂项目', en: 'Mexico plant setup', es: 'Proyecto de planta en México' },
      area: 'mx_invest', owner: 'carol', team: all, stage: 'Due Diligence',
      status: 'yellow',
      reason: { zh: '等墨方土地权属意见，客户在催', en: 'Waiting on the land-title opinion; client is chasing', es: 'Esperando la opinión de títulos; el cliente insiste' },
      next: { zh: '墨方核实土地权属并出具摘要', en: 'Verify land title in Mexico and issue a memo', es: 'Verificar títulos de propiedad y emitir un memo' },
      nextOwner: 'carlos',
      due: iso(addDays(6)), waiting: 'notary',
      files: [{ name: { zh: '土地权属摘要_v01.pdf（Google Drive）', en: 'Land-title-memo_v01.pdf (Google Drive)', es: 'Memo-titulos_v01.pdf (Google Drive)' }, url: 'https://drive.google.com/' }],
      lastContact: iso(addDays(-2)),
      notes: { zh: '客户希望 9 月底前完成尽调。', en: 'Client wants the diligence done by end of September.', es: 'El cliente quiere el due diligence a fin de mes.' },
      steps: [
        { text: { zh: '签署委托协议与收费确认', en: 'Engagement letter signed and fees confirmed', es: 'Carta de encargo firmada y honorarios confirmados' },
          owner: 'carol', due: iso(addDays(-30)), at: Date.now() - 30 * 86400000, by: 'carol',
          note: { zh: '客户当天回签', en: 'Client signed the same day', es: 'El cliente firmó el mismo día' } },
        { text: { zh: '收集公司基础文件（章程、股东名册）', en: 'Collected corporate documents (charter, cap table)', es: 'Documentos corporativos recopilados (estatutos, accionistas)' },
          owner: 'carol', due: iso(addDays(-12)), at: Date.now() - 12 * 86400000, by: 'carol',
          prev: { stage: 'Engagement', status: 'green', reason: '', team: all } },
      ],
    },
    {
      id: 36, no: '2026-036',
      client: { zh: 'XYZ 集团', en: 'XYZ Group', es: 'Grupo XYZ' },
      title: { zh: '银行 OFAC 冻结款项', en: 'OFAC-frozen bank payment', es: 'Pago bloqueado por OFAC' },
      area: 'sanctions', owner: 'carol', team: cc, stage: 'Filing / Submission',
      status: 'red',
      reason: { zh: '银行 9/15 前必须回函，材料还差一份', en: 'The bank needs a reply by Sep 15; one document is missing', es: 'El banco exige respuesta antes del 15/9; falta un documento' },
      next: { zh: '补交 MT103 与贸易合同，完成许可申请递交', en: 'File MT103 and the trade contract, submit the licence application', es: 'Presentar MT103 y el contrato, y la solicitud de licencia' },
      nextOwner: 'carol',
      due: iso(addDays(3)), waiting: 'bank',
      files: [], lastContact: iso(addDays(-1)),
      notes: { zh: '涉美事项，Hector 不参与。', en: 'US-related matter; Hector is not involved.', es: 'Asunto vinculado a EE. UU.; Héctor no participa.' },
      steps: [
        { text: { zh: '确认银行冻结依据与适用的制裁清单', en: 'Confirmed the bank\'s blocking basis and the applicable list', es: 'Confirmada la base del bloqueo y la lista aplicable' },
          owner: 'carol', due: iso(addDays(-9)), at: Date.now() - 9 * 86400000, by: 'carol',
          prev: { stage: 'Due Diligence', status: 'green', reason: '', team: cc },
          note: { zh: '银行援引 OFAC 二级制裁', en: 'The bank cited OFAC secondary sanctions', es: 'El banco citó sanciones secundarias de OFAC' } },
      ],
    },
    {
      id: 33, no: '2026-033',
      client: { zh: '深圳 B 科技', en: 'Shenzhen B Tech', es: 'Shenzhen B Tech' },
      title: { zh: '员工派驻签证', en: 'Expat work visas', es: 'Visas de trabajo para expatriados' },
      area: 'mx_reg', owner: 'hector', team: all, stage: 'Government Review',
      status: 'red',
      reason: { zh: '客户资料逾期两周，签证预约快到了', en: 'Client documents are two weeks late and the visa appointment is close', es: 'Documentos con dos semanas de retraso y la cita de visa se acerca' },
      next: { zh: '催客户补齐无犯罪记录双认证', en: 'Chase the client for apostilled police records', es: 'Reclamar al cliente los antecedentes penales apostillados' },
      nextOwner: 'hector',
      due: iso(addDays(2)), waiting: 'client',
      files: [], lastContact: iso(addDays(-9)), notes: '',
    },
    {
      id: 31, no: '2026-031', client: 'Grupo A',
      title: { zh: 'IMMEX 续期', en: 'IMMEX renewal', es: 'Renovación IMMEX' },
      area: 'mx_reg', owner: 'carlos', team: all, stage: 'Government Review',
      status: 'yellow',
      reason: { zh: '等待经济部回执，已过三周', en: 'Waiting on the Ministry\'s reply for three weeks', es: 'Esperando respuesta de la Secretaría desde hace tres semanas' },
      next: { zh: '跟进经济部回执，必要时预约面谈', en: 'Follow up with the Ministry, book a meeting if needed', es: 'Dar seguimiento a la Secretaría y agendar reunión si hace falta' },
      nextOwner: 'carlos',
      due: iso(addDays(13)), waiting: 'authority',
      files: [], lastContact: iso(addDays(-5)), notes: '',
    },
    {
      id: 40, no: '2026-040',
      client: { zh: 'LCB 内部', en: 'LCB internal', es: 'LCB interno' },
      title: { zh: '深圳办公室启动', en: 'Shenzhen office launch', es: 'Apertura de la oficina de Shenzhen' },
      area: 'internal', owner: 'carol', team: all, stage: 'Engagement',
      status: 'yellow',
      reason: { zh: '申报口径要先确认，避免对外造成已设立印象', en: 'Settle the filing approach first so it does not look already established', es: 'Definir primero el enfoque del registro para no parecer ya constituida' },
      next: { zh: '确认深圳市司法局最新申报要求与材料清单', en: 'Confirm the latest Shenzhen filing requirements and checklist', es: 'Confirmar los requisitos y la lista de documentos de Shenzhen' },
      nextOwner: 'carol',
      due: iso(addDays(18)), waiting: 'authority',
      files: [], lastContact: iso(addDays(-3)),
      notes: { zh: '内部战略项目，不混入客户 Matter。', en: 'Internal strategic project, kept out of client matters.', es: 'Proyecto interno, fuera de los asuntos de clientes.' },
    },
    {
      id: 37, no: '2026-037', client: 'ABC Ltd',
      title: { zh: '合资公司 SHA 起草', en: 'JV shareholders\' agreement', es: 'Acuerdo de socios (JV)' },
      area: 'mx_invest', owner: 'carlos', team: all, stage: 'Drafting',
      status: 'green', reason: '',
      next: { zh: '完成 SHA 第二稿并交 Carol 复核', en: 'Finish draft 2 of the SHA for Carol to review', es: 'Terminar el segundo borrador del acuerdo para revisión de Carol' },
      nextOwner: 'carlos',
      due: iso(addDays(7)), waiting: 'none',
      files: [], lastContact: iso(addDays(-4)), notes: '',
    },
    {
      id: 29, no: '2026-029',
      client: { zh: '广州 C 贸易', en: 'Guangzhou C Trading', es: 'Guangzhou C Trading' },
      title: { zh: '跨境支付合规意见', en: 'Cross-border payment compliance', es: 'Cumplimiento en pagos transfronterizos' },
      area: 'aml', owner: 'carol', team: cc, stage: 'Drafting',
      status: 'green', reason: '',
      next: { zh: '出具合规意见并电话与客户确认执行方案', en: 'Issue the compliance opinion and confirm the plan with the client', es: 'Emitir la opinión y confirmar el plan con el cliente' },
      nextOwner: 'carol',
      due: iso(addDays(11)), waiting: 'none',
      files: [], lastContact: iso(addDays(-6)), notes: '',
    },
    {
      id: 28, no: '2026-028', client: 'Italian NPE',
      title: { zh: '意大利标的尽职调查', en: 'Italian target due diligence', es: 'Due diligence del objetivo italiano' },
      area: 'dispute', owner: 'hector', team: all, stage: 'Legal Research',
      status: 'green', reason: '',
      next: { zh: '整理尽调清单初稿，交 Carlos 补充墨方口径', en: 'Prepare the diligence checklist draft for Carlos to add Mexico points', es: 'Preparar el borrador de la lista para que Carlos añada México' },
      nextOwner: 'hector',
      due: iso(addDays(24)), waiting: 'none',
      files: [], lastContact: iso(addDays(-8)), notes: '',
    },
  ];
}

function seedLogs() {
  const now = Date.now();
  const h = 3600000;
  return [
    { id: 'l1', matterId: 36, at: now - 26 * h, by: 'carol', key: 'detail.entry.status', vars: { status: { __t: 'status.red', prefix: '🔴 ' } } },
    { id: 'l2', matterId: 36, at: now - 25 * h, by: 'carol', key: 'detail.entry.next', vars: { next: { zh: '补交 MT103 与贸易合同，完成许可申请递交', en: 'File MT103 and the trade contract, submit the licence application', es: 'Presentar MT103 y el contrato, y la solicitud de licencia' } } },
    { id: 'l3', matterId: 35, at: now - 50 * h, by: 'carol', key: 'detail.entry.note', vars: { text: { zh: '结构由 SA 改为 SAPI（Carlos 确认）', en: 'Structure changed from SA to SAPI (confirmed by Carlos)', es: 'Estructura cambiada de SA a SAPI (confirmado por Carlos)' } } },
    { id: 'l4', matterId: 35, at: now - 49 * h, by: 'carlos', key: 'detail.entry.fileAdd', vars: { name: { zh: '土地权属摘要_v01.pdf', en: 'Land-title-memo_v01.pdf', es: 'Memo-titulos_v01.pdf' } } },
    { id: 'l5', matterId: 33, at: now - 72 * h, by: 'hector', key: 'detail.entry.waiting', vars: { w: { __t: 'wait.client' } } },
    { id: 'l6', matterId: 40, at: now - 74 * h, by: 'carol', key: 'detail.entry.new', vars: { no: '2026-040', area: 'Internal Project' } },
  ];
}

/* ------------------------------ 运行时状态 ------------------------------ */

let matters = load(KEY.matters, null) || [];
let logs = load(KEY.logs, null) || [];
let seq = load(KEY.seq, 0);
saveSessionValue(KEY.auth, null);
let authSession = null;
let loginFailures = 0;
let loginBlockedUntil = 0;
let session = null;    // Supabase 验证成功后才建立页面会话
const state = {
  filters: { q: '', area: '', owner: '', status: '', waiting: '' },
  bulkSelected: new Set(),
  trashSelected: new Set(),
  loginError: '',
  calendarOffset: 0,
  modal: null,
  devices: [],
};
let lastSystemError = { message:'', at:0 };
function showSystemError(error) {
  const message = String((error && (error.message || error.reason)) || error || 'Unknown error');
  if (message === 'bad-credentials') return;
  const now = Date.now();
  if (lastSystemError.message === message && now - lastSystemError.at < 2000) return;
  lastSystemError = { message, at:now };
  state.modal = {
    type:'notice', titleKey:'sync.errorModalTitle',
    body:`<div style="padding:10px 12px;border:1px solid var(--line);background:var(--bg);word-break:break-word">${esc(message)}</div><div style="margin-top:14px">${esc(t('sync.errorModalSend'))}</div>`,
  };
  render();
}
const savedSystemSeen = load(KEY.systemSeen, null);
const systemNotice = {
  seen: new Set(Array.isArray(savedSystemSeen) ? savedSystemSeen : []),
  requesting: false,
  enabled: load(KEY.systemEnabled, null) !== false,
};
// 第一次启用时不把历史通知一口气全弹出来，只推送之后新同步到的通知。
if (!Array.isArray(savedSystemSeen)) {
  logs.forEach(l => (l.notifyTo || []).forEach(userId => systemNotice.seen.add(userId + ':' + l.id)));
  save(KEY.systemSeen, [...systemNotice.seen]);
}

function commit() {
  if (!REMOTE_ENABLED) {
    save(KEY.matters, matters);
    save(KEY.logs, logs);
    save(KEY.seq, seq);
  }
  schedulePush();
}

/* ------------------------------ 与服务器同步 ------------------------------ */

let consecutiveAuthFailures = 0;
function trackAuthResponse(response) {
  if (response.status === 401) {
    consecutiveAuthFailures += 1;
    if (consecutiveAuthFailures >= 3 && authSession) expireAuthSession();
  } else if (response.ok) consecutiveAuthFailures = 0;
  return response;
}
function expireAuthSession() {
  recordSecurityEvent('session_expired', { reason:'repeated_401' });
  finishLogout();
  state.loginError = t('login.errExpired');
  render();
}
function authExpiredError(error) {
  return !authSession && /(?:HTTP|http-)[-_]?401/i.test(String((error && error.message) || error));
}

function sbFetch(path, opts) {
  const token = authSession && authSession.access_token;
  const headers = Object.assign({
    apikey: SUPABASE.key,
    Authorization: 'Bearer ' + (token || SUPABASE.key),
    'Content-Type': 'application/json',
  }, (opts && opts.headers) || {});
  return fetch(SUPABASE.url + '/rest/v1' + path, Object.assign({}, opts || {}, { headers })).then(trackAuthResponse);
}

function storageFetch(path, opts) {
  const token=authSession && authSession.access_token;
  const headers=Object.assign({ apikey:SUPABASE.key, Authorization:'Bearer '+(token || SUPABASE.key) },(opts&&opts.headers)||{});
  return fetch(SUPABASE.url+'/storage/v1'+path,Object.assign({},opts||{},{headers})).then(trackAuthResponse);
}
function recordSecurityEvent(eventType, details) {
  if (!authSession) return Promise.resolve();
  return sbFetch('/rpc/lcb_record_security_event', {
    method:'POST', body:JSON.stringify({ event_type:eventType, details:details || {} }),
  }).catch(() => {});
}

async function deleteEncryptedFiles(matter) {
  const paths = (matter && matter.files || []).map(f => f.storagePath).filter(Boolean);
  for (const path of paths) {
    const res = await storageFetch('/object/carol-encrypted-files/' + path, { method:'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('file-delete-http-' + res.status);
  }
}

async function signIn(email, password, userId) {
  const res = await fetch(SUPABASE.url + '/auth/v1/token?grant_type=password', {
    method:'POST', headers:{ apikey:SUPABASE.key, 'Content-Type':'application/json' },
    body:JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error('bad-credentials');
  const data = await res.json();
  authSession = {
    access_token:data.access_token, refresh_token:data.refresh_token,
    expires_at:Math.floor(Date.now()/1000)+Number(data.expires_in || 3600),
    email:data.user && data.user.email,
  };
  saveSessionValue(KEY.auth, authSession);
  consecutiveAuthFailures = 0;
  await LCBCrypto.initialize(userId, password, sbFetch);
}

async function refreshAuth() {
  if (!authSession || !authSession.refresh_token) return false;
  if (authSession.expires_at > Math.floor(Date.now()/1000)+60) return true;
  const res = await fetch(SUPABASE.url + '/auth/v1/token?grant_type=refresh_token', {
    method:'POST', headers:{ apikey:SUPABASE.key, 'Content-Type':'application/json' },
    body:JSON.stringify({ refresh_token:authSession.refresh_token }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  authSession = { access_token:data.access_token, refresh_token:data.refresh_token,
    expires_at:Math.floor(Date.now()/1000)+Number(data.expires_in || 3600), email:authSession.email };
  saveSessionValue(KEY.auth, authSession);
  return true;
}

function clearPrivateCache() {
  [KEY.matters, KEY.logs, KEY.seq, KEY.session].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  matters=[]; logs=[]; seq=0;
}

function finishLogout() {
  session=null; authSession=null;
  if (globalThis.LCBCrypto) LCBCrypto.lock();
  saveSessionValue(KEY.auth, null);
  clearPrivateCache();
  state.bulkSelected.clear(); state.trashSelected.clear(); state.modal=null; state.loginError='';
  go('#/'); render();
}

let lastUserActivityAt = Date.now();
async function idleLogout() {
  if (!authSession || Date.now() - lastUserActivityAt < IDLE_LOGOUT_MS) return;
  if (sync.dirty) await pushRemote();
  finishLogout();
  toast(t('toast.loggedOut'));
}

async function signOutEverywhere() {
  const res = await fetch(SUPABASE.url + '/auth/v1/logout?scope=global', {
    method:'POST', headers:{ apikey:SUPABASE.key, Authorization:'Bearer '+authSession.access_token },
  });
  if (!res.ok) throw new Error('logout-http-'+res.status);
  finishLogout();
}
function deviceDescription() {
  const ua=navigator.userAgent || ''; let browser='Browser';
  if (/Edg\//.test(ua)) browser='Edge'; else if (/Chrome\//.test(ua)) browser='Chrome'; else if (/Firefox\//.test(ua)) browser='Firefox'; else if (/Safari\//.test(ua)) browser='Safari';
  let system=navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || 'Unknown system';
  if (/iPhone|iPad|iPod/.test(ua)) system='iPhone/iPad'; else if (/Android/.test(ua)) system='Android';
  return browser+' · '+system;
}
function stableDeviceId() {
  let id=load(KEY.deviceId,null);
  if(!id) { id=crypto.randomUUID(); save(KEY.deviceId,id); }
  return id;
}
const DEVICE_CITIES = [
  [23.1291,113.2644,['广州','Guangzhou','Guangzhou']], [22.5431,114.0579,['深圳','Shenzhen','Shenzhen']],
  [39.9042,116.4074,['北京','Beijing','Pekín']], [31.2304,121.4737,['上海','Shanghai','Shanghái']],
  [19.4326,-99.1332,['墨西哥城','Mexico City','Ciudad de México']], [25.6866,-100.3161,['蒙特雷','Monterrey','Monterrey']],
  [20.6597,-103.3496,['瓜达拉哈拉','Guadalajara','Guadalajara']], [28.6320,-106.0691,['奇瓦瓦','Chihuahua','Chihuahua']],
  [32.5149,-117.0382,['蒂华纳','Tijuana','Tijuana']], [20.5888,-100.3899,['克雷塔罗','Queretaro','Querétaro']],
  [21.1619,-86.8515,['坎昆','Cancun','Cancún']], [40.4168,-3.7038,['马德里','Madrid','Madrid']]
];
function deviceCoordinates() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      p => resolve({latitude:p.coords.latitude, longitude:p.coords.longitude}),
      () => resolve(null), {enableHighAccuracy:true,timeout:10000,maximumAge:300000}
    );
  });
}
function devicePlace(d) {
  const lat=Number(d.latitude), lon=Number(d.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return t('settings.deviceLocationUnknown');
  let nearest=null, best=Infinity;
  for (const city of DEVICE_CITIES) {
    const dy=(lat-city[0])*111, dx=(lon-city[1])*111*Math.cos(lat*Math.PI/180), distance=Math.hypot(dx,dy);
    if (distance<best) { best=distance; nearest=city; }
  }
  const coordinates=lat.toFixed(3)+', '+lon.toFixed(3);
  return best<=150 ? nearest[2][LANG_INDEX[lang] || 0]+' · '+coordinates : coordinates;
}
async function loadDevices(register) {
  if(!authSession) return;
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  if(register) {
    const position=await deviceCoordinates();
    const saved=await sbFetch('/rpc/lcb_register_device',{method:'POST',body:JSON.stringify({p_device_id:stableDeviceId(),p_device_name:deviceDescription(),p_timezone:timezone,p_latitude:position&&position.latitude,p_longitude:position&&position.longitude})});
    if(!saved.ok) throw new Error('device-register-http-'+saved.status+': '+await saved.text());
  }
  const res=await sbFetch('/rpc/lcb_list_devices',{method:'POST',body:'{}'});
  if(!res.ok) throw new Error('device-list-http-'+res.status);
  state.devices=await res.json();
}
async function revokeDevice(sessionId) {
  const current=(state.devices||[]).find(x=>x.session_id===sessionId && x.is_current);
  const res=await sbFetch('/rpc/lcb_revoke_device',{method:'POST',body:JSON.stringify({target_session:sessionId})});
  if(!res.ok) throw new Error('device-revoke-http-'+res.status);
  if(current) finishLogout(); else { await loadDevices(false); render(); }
}

function soloRemoteId(id) { return SOLO_PREFIX + String(id); }

const UPSERT = { Prefer: 'resolution=merge-duplicates,return=minimal' };
const SYNC_RETRY_LIMIT = 3;
const SYNC_RETRY_DELAY_MS = 800;

function resetSyncRetries() {
  sync.retryCount = 0;
  if (sync.retryTimer) clearTimeout(sync.retryTimer);
  sync.retryTimer = null;
}
function queueSyncRetry(kind) {
  sync.retryCount += 1;
  if (sync.retryCount >= SYNC_RETRY_LIMIT) {
    sync.status = 'error';
    sync.retryTimer = null;
    return false;
  }
  sync.status = 'loading';
  if (sync.retryTimer) clearTimeout(sync.retryTimer);
  sync.retryTimer = setTimeout(() => {
    sync.retryTimer = null;
    if (kind === 'push') pushRemote(); else pullRemote();
  }, SYNC_RETRY_DELAY_MS);
  return true;
}

// 后台同步不能打断用户：正在填表、操作弹窗或选中文字时先不刷新。
function userIsInteracting() {
  if (state.modal) return true;
  const active = document.activeElement;
  if (active && (active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || ''))) return true;
  try {
    const selection = window.getSelection && window.getSelection();
    if (selection && !selection.isCollapsed && String(selection).trim()) return true;
  } catch (e) { /* 某些浏览器不允许读取选区 */ }
  return false;
}

// 把远端的事整份拉下来（正常情况下每 15 秒一次）
async function pullRemote(opts) {
  const background = !!(opts && opts.background);
  const initial = !!(opts && opts.initial);
  let shouldEncryptPlaintext = false;
  if (background && userIsInteracting()) return;
  if (!REMOTE_ENABLED || sync.busy || !authSession) return;
  if (sync.dirty) return;              // 本地还有没推上去的改动，先别覆盖
  sync.busy = true;
  try {
    const [mRes, lRes, metaRes] = await Promise.all([
      sbFetch('/matters?select=id,data&id=like.' + encodeURIComponent(SOLO_PREFIX + '*')),
      sbFetch('/logs?select=id,data&id=like.' + encodeURIComponent(SOLO_PREFIX + '*')),
      sbFetch('/meta?select=key,value&key=eq.solo_seq'),
    ]);
    if (mRes.status === 404) throw new Error('tables-missing');
    if (!mRes.ok) throw new Error('HTTP ' + mRes.status);
    const mRows = await mRes.json();
    const lRows = lRes.ok ? await lRes.json() : [];
    const metaRows = metaRes.ok ? await metaRes.json() : [];

    const nextMatters = LCBCrypto.state.ready
      ? await Promise.all(mRows.map(r => LCBCrypto.openMatter(r.data, sbFetch))) : mRows.map(r => r.data);
    const nextLogs = LCBCrypto.state.ready
      ? await Promise.all(lRows.map(r => LCBCrypto.openLog(r.data, sbFetch))) : lRows.map(r => r.data);
    const seqRow = metaRows.filter(r => r.key === 'solo_seq')[0];
    const nextSeq = seqRow && typeof seqRow.value === 'number' ? seqRow.value : seq;
    // 第一次启用云同步时，云端还是空的就把这台设备已有的个人数据上传，避免覆盖丢失。
    if (initial && !nextMatters.length && matters.length) {
      syncReady = true;
      sync.busy = false;
      sync.status = 'loading';
      sync.dirty = true;
      pushRemote();
      return;
    }
    const changed = JSON.stringify(nextMatters) !== JSON.stringify(matters) ||
      JSON.stringify(nextLogs) !== JSON.stringify(logs) || nextSeq !== seq;
    // 请求发出后用户可能刚开始输入；这次结果留到下一轮再取。
    if (background && userIsInteracting()) { sync.busy = false; return; }
    matters = nextMatters;
    shouldEncryptPlaintext = LCBCrypto.state.ready && (
      mRows.some(r => !r.data || r.data.encrypted !== 'lcb-e2ee-v1') ||
      lRows.some(r => !r.data || r.data.encrypted !== 'lcb-e2ee-v1')
    );
    deliverSystemNotifications(nextLogs);
    logs = nextLogs;
    seq = nextSeq;
    sync.syncedLogs = new Set(logs.map(l => l.id));
    sync.status = 'ok';
    resetSyncRetries();
    sync.lastAt = Date.now();
    sync.error = '';
    if (background && !changed) {
      syncReady = true; sync.busy = false;
      if (shouldEncryptPlaintext) commit();
      deliverScheduleReminders();
      return;
    }
  } catch (e) {
    sync.error = String((e && e.message) || e);
    recordSecurityEvent('sync_failed', { direction:'pull', error:sync.error.slice(0,160) });
    sync.busy = false;
    syncReady = true;
    queueSyncRetry('pull');
    render();
    return;
  }
  syncReady = true;
  sync.busy = false;
  if (shouldEncryptPlaintext) commit();
  deliverScheduleReminders();
  if (background && userIsInteracting()) return;
  render();
}

async function pushRemote() {
  if (!REMOTE_ENABLED || !authSession) return;
  if (sync.busy) return;
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  sync.busy = true;
  try {
    if (matters.length) {
      const encrypted = await Promise.all(matters.map(m => LCBCrypto.prepareMatter(m, sbFetch)));
      const shells = matters.map(m => ({ id:soloRemoteId(m.id), data:{ id:m.id, owner:m.owner, team:m.team || [], encrypted:'lcb-e2ee-pending' }, updated_at:new Date().toISOString() }));
      // 先同步负责人/成员名单，后端才会允许为新成员保存对应的加密钥匙。
      const shellResult = await sbFetch('/matters', { method:'POST', headers:UPSERT, body:JSON.stringify(shells) });
      if (!shellResult.ok) throw new Error('matter-shell-http-'+shellResult.status);
      await LCBCrypto.flushMatterKeys(sbFetch);
      const rows = encrypted.map((m,i) => ({ id:soloRemoteId(matters[i].id), data:m, updated_at:new Date().toISOString() }));
      const r = await sbFetch('/matters', { method: 'POST', headers: UPSERT, body: JSON.stringify(rows) });
      if (r.status === 404) throw new Error('tables-missing');
      if (!r.ok) throw new Error('HTTP ' + r.status);
    }
    // 已读状态会修改旧日志，所以每次都 upsert 全部日志，确保其他设备同步。
    if (logs.length) {
      const encrypted = await Promise.all(logs.map(l => LCBCrypto.prepareLog(l, sbFetch)));
      const rows = encrypted.map((l,i) => ({ id:soloRemoteId(logs[i].id), matter_id:soloRemoteId(logs[i].matterId), data:l }));
      const r = await sbFetch('/logs', { method: 'POST', headers: UPSERT, body: JSON.stringify(rows) });
      if (r.ok) logs.forEach(l => sync.syncedLogs.add(l.id));
    }
    await sbFetch('/meta', { method: 'POST', headers: UPSERT, body: JSON.stringify([{ key: 'solo_seq', value: seq }]) });
    for (const id of [...sync.purged]) {
      await sbFetch('/logs?matter_id=eq.' + encodeURIComponent(soloRemoteId(id)), { method: 'DELETE' });
      await sbFetch('/lcb_matter_keys?matter_id=eq.' + encodeURIComponent(String(id)), { method:'DELETE' });
      await sbFetch('/matters?id=eq.' + encodeURIComponent(soloRemoteId(id)), { method: 'DELETE' });
      sync.purged.delete(id);
    }
    sync.status = 'ok';
    resetSyncRetries();
    sync.lastAt = Date.now();
    sync.error = '';
    sync.dirty = false;
    [KEY.matters,KEY.logs,KEY.seq,KEY.session].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
  } catch (e) {
    // 推失败：把改动留在本机，标成"未同步"，下次同步时再试
    sync.error = String((e && e.message) || e);
    recordSecurityEvent('sync_failed', { direction:'push', error:sync.error.slice(0,160) });
    sync.dirty = true;
    sync.busy = false;
    queueSyncRetry('push');
    render();
    return;
  }
  sync.busy = false;
  render();
}

let pushTimer = null;
let syncReady = !REMOTE_ENABLED;   // 首次拉取完成后才允许往服务器写，避免用本机数据覆盖别人的
function schedulePush() {
  if (!REMOTE_ENABLED) return;
  sync.dirty = true;
  if (sync.status === 'error') resetSyncRetries();
  if (!syncReady) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushRemote(); }, 500);
}
function currentUser() { return session ? USER[session.userId] : null; }

// 门禁规则：只有负责人和被勾进「项目成员」的人能打开；Carol 是管理员，始终可见。
// 业务类型不决定可见范围，只决定新建时默认勾谁。
function defaultTeam(areaId) {
  const u = currentUser();
  return u ? [u.id] : [];
}
function canSee(user, m) {
  return !!(user && m && (user.admin || m.owner === user.id || (m.team || []).includes(user.id)));
}
function visibleMatters(user) {
  return matters.filter(m => m.kind !== 'schedule' && !m.deletedAt && canSee(user, m));
}
function trashedMatters(user) {
  const u = user || currentUser();
  return matters.filter(m => m.kind !== 'schedule' && m.deletedAt && canSee(u, m)).sort((a, b) => b.deletedAt - a.deletedAt);
}
function scheduleItems(user, date) {
  if (!user) return [];
  return matters.filter(m => m.kind === 'schedule' && !m.deletedAt && m.owner === user.id && (!date || m.due === date))
    .sort((a,b) => String(a.reminderTime||'').localeCompare(String(b.reminderTime||'')));
}
function isAdmin() {
  const u = currentUser();
  return !!(u && u.admin);
}
// 当前步骤 = 这条事项正在推进的那一步，它的负责人就是「下一步负责人」
function isStepOwner(user, m) {
  return !!(user && m && (user.admin || m.nextOwner === user.id));
}
function stepsOf(m) {
  return (m.steps || []).slice().sort((a, b) => b.at - a.at);
}
function lastStep(m) {
  const list = stepsOf(m);
  return list.length ? list[0] : null;
}
const MATTER_EDIT_FIELDS = ['client', 'title', 'area', 'stage', 'owner', 'nextOwner', 'status', 'due', 'waiting', 'lastContact', 'next', 'reason', 'notes', 'team'];
function cloneData(value) { return JSON.parse(JSON.stringify(value)); }
function matterEditSnapshot(m) {
  const snapshot = {};
  MATTER_EDIT_FIELDS.forEach(k => { snapshot[k] = cloneData(m[k] === undefined ? null : m[k]); });
  return snapshot;
}
function lastMatterEditLog(m) {
  return logs.filter(l => String(l.matterId) === String(m.id) && l.key === 'detail.entry.edited' &&
    l.undo && l.undo.kind === 'matter-edit' && !l.undoneAt).sort((a, b) => b.at - a.at)[0] || null;
}
function canUndoMatterEdit(user, log) {
  return !!(user && log && (user.admin || user.id === log.by));
}
// 管理员可以代为完成步骤；撤销只给管理员和「刚完成这一步的人」
function canUndoStep(user, m) {
  const step = m && lastStep(m);
  return !!(user && step && (user.admin || step.by === user.id));
}
function addLog(matterId, by, text) {
  logs.push({ id: 'l' + Math.random().toString(36).slice(2, 9), matterId, at: Date.now(), by, text });
  if (!REMOTE_ENABLED) save(KEY.logs, logs);
}
function noticeRecipients(m, actor, explicit) {
  const ids = explicit || [...(m && m.team || []), m && m.owner];
  return [...new Set(ids.filter(Boolean))].filter(id => id !== actor && USER[id]);
}
function noticeVars(m, actor, extra) {
  return Object.assign({
    actor: (USER[actor] || {}).name || actor,
    title: m ? m.title : '',
  }, extra || {});
}
function addLogKey(matterId, by, key, vars, notice) {
  const m = matterById(matterId);
  const entry = { id: 'l' + Math.random().toString(36).slice(2, 9), matterId, at: Date.now(), by, key, vars };
  if (notice && notice.key) {
    entry.notice = { key: notice.key, vars: notice.vars || {} };
    entry.notifyTo = noticeRecipients(m, by, notice.to);
    entry.readBy = [by];
    entry.matterTitle = m ? m.title : notice.title || '';
    entry.matterNo = m ? m.no : notice.no || '';
  }
  logs.push(entry);
  if (!REMOTE_ENABLED) save(KEY.logs, logs);
  return entry;
}
function resolveVar(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (v.__noticePreview) {
      const previewVars = {};
      Object.keys(v.__noticePreview.vars || {}).forEach(k => { previewVars[k] = resolveVar(v.__noticePreview.vars[k]); });
      return truncateNoticeText(t(v.__noticePreview.key, previewVars), v.max || 15);
    }
    if (v.__t) return (v.prefix || '') + t(v.__t, v.vars);
    if (v.__date !== undefined) return fmtDate(v.__date);
    if (v.__rel !== undefined) return dueText(v.__rel);
    if (v.__stage !== undefined) return stageLabel(v.__stage);
    return L(v);
  }
  return v;
}
function logText(l) {
  if (!l.key) return l.text || '';
  const vars = {};
  Object.keys(l.vars || {}).forEach(k => { vars[k] = resolveVar(l.vars[k]); });
  return t(l.key, vars);
}
function inboxEntries(user) {
  if (!user) return [];
  return logs.filter(l => l.notice && (l.notifyTo || []).includes(user.id) && !(l.deletedBy || []).includes(user.id))
    .sort((a, b) => b.at - a.at);
}
function unreadNotifications(user) {
  return inboxEntries(user).filter(l => !(l.readBy || []).includes(user.id));
}
function inboxText(l) {
  if (!l || !l.notice) return '';
  const vars = {};
  Object.keys(l.notice.vars || {}).forEach(k => { vars[k] = resolveVar(l.notice.vars[k]); });
  return t(l.notice.key, vars);
}
function truncateNoticeText(text, max) {
  const chars = [...String(text || '')];
  return chars.length > max ? chars.slice(0, max).join('') + '…' : chars.join('');
}
function systemNotificationState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted' && !systemNotice.enabled) return 'disabled';
  return Notification.permission || 'default';
}
function saveSystemSeen() {
  const ids = [...systemNotice.seen];
  save(KEY.systemSeen, ids.slice(Math.max(0, ids.length - 2000)));
}
function baselineSystemNotifications(user) {
  if (!user) return;
  inboxEntries(user).forEach(l => systemNotice.seen.add(user.id + ':' + l.id));
  saveSystemSeen();
}
function enableSystemNotifications() {
  if (typeof Notification === 'undefined') { toast(t('inbox.systemUnsupported')); return; }
  if (Notification.permission === 'denied') { toast(t('toast.systemDenied')); return; }
  baselineSystemNotifications(currentUser());
  if (Notification.permission === 'granted') {
    systemNotice.enabled = true;
    save(KEY.systemEnabled, true);
    toast(t('toast.systemEnabled'));
    render();
    return;
  }
  systemNotice.requesting = true;
  render();
  let finished = false;
  const finish = permission => {
    if (finished) return;
    finished = true;
    systemNotice.requesting = false;
    if (permission === 'granted') {
      systemNotice.enabled = true;
      save(KEY.systemEnabled, true);
    }
    toast(t(permission === 'granted' ? 'toast.systemEnabled' : 'toast.systemDenied'));
    render();
  };
  try {
    // Chrome 返回 Promise；部分 Safari 版本只调用回调且返回 undefined，两种都兼容。
    const result = Notification.requestPermission(finish);
    if (result && typeof result.then === 'function') result.then(finish).catch(() => finish(Notification.permission));
    else {
      const watchPermission = () => {
        if (finished) return;
        if (Notification.permission !== 'default') finish(Notification.permission);
        else setTimeout(watchPermission, 500);
      };
      setTimeout(watchPermission, 500);
    }
  } catch (e) {
    finish(Notification.permission);
  }
}
function deliverSystemNotifications(nextLogs) {
  const u = currentUser();
  if (!u) return;
  let changed = false;
  nextLogs.filter(l => l.notice && (l.notifyTo || []).includes(u.id) && !(l.readBy || []).includes(u.id)).forEach(l => {
    const seenKey = u.id + ':' + l.id;
    if (systemNotice.seen.has(seenKey)) return;
    systemNotice.seen.add(seenKey);
    changed = true;
    if (systemNotice.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const notice = new Notification(t('system.title'), { body: inboxText(l), tag: 'lcb-' + l.id });
      notice.onclick = () => {
        if (window.focus) window.focus();
        location.hash = '#/inbox';
        render();
        if (notice.close) notice.close();
      };
    }
  });
  if (changed) saveSystemSeen();
}
function deliverScheduleReminders() {
  const u=currentUser();
  if(!u) return;
  const now=new Date(), day=iso(now), time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  let changed=false;
  scheduleItems(u).forEach(item=>{
    if(!item.reminderEnabled || item.reminderSentAt || item.due>day || (item.due===day && item.reminderTime>time)) return;
    item.reminderSentAt=Date.now();
    logs.push({id:'l'+Math.random().toString(36).slice(2,9),matterId:item.id,at:Date.now(),by:u.id,
      key:'calendar.dayReminder',vars:{message:item.reminderText},
      notice:{key:'inbox.scheduleReminder',vars:{message:item.reminderText}},notifyTo:[u.id],readBy:[],matterTitle:item.reminderText,matterNo:''});
    changed=true;
  });
  if(!changed) return;
  commit(); deliverSystemNotifications(logs);
  if(location.hash.startsWith('#/calendar') || location.hash.startsWith('#/inbox')) render();
}
function markNotificationRead(id, userId) {
  const l = logs.find(x => x.id === id);
  if (!l || !(l.notifyTo || []).includes(userId)) return false;
  if ((l.readBy || []).includes(userId)) return false;
  l.readBy = [...new Set([...(l.readBy || []), userId])];
  if (l.by !== userId && USER[l.by] && l.notice && l.notice.key !== 'inbox.readReceipt') {
    const reader = (USER[userId] || {}).name || userId;
    addLogKey(l.matterId, userId, 'detail.entry.readReceipt', { reader }, {
      key: 'inbox.readReceipt',
      vars: { reader, preview: { __noticePreview: l.notice, max: 15 } },
      to: [l.by], title: l.matterTitle, no: l.matterNo,
    });
  }
  commit();
  return true;
}
function deleteNotificationForUser(id, userId) {
  const l = logs.find(x => x.id === id);
  if (!l || !(l.notifyTo || []).includes(userId)) return false;
  l.deletedBy = [...new Set([...(l.deletedBy || []), userId])];
  commit();
  return true;
}
function undoMatterEdit(id) {
  const m = matterById(id);
  const u = currentUser();
  if (!m || !u) return false;
  const edit = lastMatterEditLog(m);
  if (!edit) { toast(t('toast.noEditToUndo')); return false; }
  if (!canUndoMatterEdit(u, edit)) return false;
  MATTER_EDIT_FIELDS.forEach(k => { m[k] = cloneData(edit.undo.before[k]); });
  edit.undoneAt = Date.now();
  edit.undoneBy = u.id;
  addLogKey(id, u.id, 'detail.entry.editUndo', {}, {
    key: 'inbox.editUndo',
    vars: noticeVars(m, u.id, {
      next: m.next,
      owner: (USER[m.nextOwner] || {}).name || m.nextOwner,
      status: { __t: 'status.' + m.status + '.short', prefix: STATUS[m.status].dot + ' ' },
    }),
  });
  commit();
  toast(t('toast.editUndoDone'));
  return true;
}
function setLang(id) {
  if (LANG_INDEX[id] === undefined) return;
  lang = id;
  save(KEY.lang, id);
  render();
}
function matterById(id) { return matters.find(m => String(m.id) === String(id)); }
function sorted(list) {
  return [...list].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return (a.due || '9999').localeCompare(b.due || '9999');
  });
}

/* ------------------------------ 小工具 ------------------------------ */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function statusChip(s) {
  const st = STATUS[s] || STATUS.green;
  return `<span class="chip ${st.cls}">${st.dot} ${esc(statusShort(s))}</span>`;
}
function areaTag(id) {
  return `<span class="tag tag-area">${esc(areaName(id))}</span>`;
}
function teamTags(ids) {
  return (ids || []).map(id => `<span class="tag">${esc((USER[id] || {}).name || id)}</span>`).join('');
}
function toast(msg) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 4700);
  setTimeout(() => el.remove(), 5000);
}
function go(hash) { location.hash = hash; }

/* ------------------------------ 视图：登录 ------------------------------ */

function viewLogin() {
  const err = state.loginError;
  return `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <div class="brand-mark">C</div>
        <div>
          <h1>${esc(t(APP_TITLE_KEY))}</h1>
          <div class="sub">${esc(t(TEAM_NAME_KEY))}</div>
        </div>
        <div style="margin-left:auto">${langSwitcher()}</div>
      </div>
      <form data-action="login">
        <div class="field">
          <label>${esc(t('login.email'))}</label>
          <input type="email" name="email" placeholder="you@lcb.com" autocomplete="username" required>
        </div>
        <div class="field">
          <label>${esc(t('login.password'))}</label>
          <input type="password" name="password" placeholder="••••••••" autocomplete="current-password" required>
        </div>
        <button class="btn btn-primary btn-block" type="submit">${esc(t('login.signin'))}</button>
        <div class="err">${esc(err)}</div>
      </form>
      <div class="hint" style="margin-top:6px">${esc(t('login.noSms'))}</div>
    </div>
  </div>`;
}

function langSwitcher(variant) {
  return `<div class="lang-switch${variant ? ' ' + variant : ''}">${LANGS.map(l =>
    `<button type="button" class="${l.id === lang ? 'on' : ''}" data-action="set-lang" data-lang="${l.id}" title="${esc(l.name)}">${l.label}</button>`
  ).join('')}</div>`;
}

/* 顶栏的同步状态：让人一眼看出数据是不是几台设备共用的 */
function syncBadge() {
  if (!REMOTE_ENABLED) return '';
  const st = sync.status;
  if (st === 'loading') {
    return `<span class="sync-pill loading">☁ ${esc(t('sync.loading'))}</span>`;
  }
  if (st === 'error') {
    const msg = sync.error === 'tables-missing' ? t('sync.tablesMissing') : sync.error;
    return `<button class="sync-pill error" type="button" data-action="sync-now"
      title="${esc(t('sync.tipError', { msg }))}">⚠ ${esc(t('sync.failedClick'))}</button>`;
  }
  const time = sync.lastAt ? fmtStamp(sync.lastAt).slice(11) : '—';
  return `<button class="sync-pill ok" type="button" data-action="sync-now"
    title="${esc(t('sync.tipOk', { time }))}">☁ ${esc(t('sync.ok'))}</button>`;
}

/* ------------------------------ 视图：外壳 ------------------------------ */

function navFor(route) {
  const items = [
    ['#/', 'nav.dashboard'],
    ['#/matters', 'nav.matters'],
    ['#/weekly', 'nav.weekly'],
    ['#/calendar', 'nav.calendar'],
    ['#/inbox', 'nav.inbox'],
    ['#/settings', 'nav.settings'],
    ['#/trash', 'nav.trash'],
  ];
  return items.map(([href, key]) => {
    const active = (href === '#/' && (route === '/' || route === '')) || (href !== '#/' && route.startsWith(href.slice(1)));
    let badge = '';
    if (key === 'nav.matters') badge = `<span class="nav-count">${visibleMatters(currentUser()).length}</span>`;
    if (key === 'nav.inbox') {
      const unread=unreadNotifications(currentUser()).length;
      if(unread) badge=`<span class="nav-count">${unread}</span>`;
    }
    return `<a href="${href}" class="${active ? 'active' : ''}"><span class="nav-label">${esc(t(key))}${badge}</span></a>`;
  }).join('');
}

function shell(route, content) {
  const u = currentUser();
  return `
  <div class="topbar">
    <div class="topbar-inner">
      <div class="logo"><div class="brand-mark">CB</div><span>${esc(t(APP_TITLE_KEY))}</span></div>
      <div class="nav-shell">
        <button class="nav-scroll-btn" type="button" data-action="nav-scroll-left" aria-label="${esc(L({zh:'向左滚动导航',en:'Scroll navigation left',es:'Desplazar navegación a la izquierda'}))}" title="${esc(L({zh:'向左滚动',en:'Scroll left',es:'Desplazar a la izquierda'}))}">‹</button>
        <nav class="nav">${navFor(route)}${langSwitcher('in-nav')}</nav>
        <button class="nav-scroll-btn" type="button" data-action="nav-scroll-right" aria-label="${esc(L({zh:'向右滚动导航',en:'Scroll navigation right',es:'Desplazar navegación a la derecha'}))}" title="${esc(L({zh:'向右滚动',en:'Scroll right',es:'Desplazar a la derecha'}))}">›</button>
      </div>
      <div class="topbar-right">
        ${syncBadge()}
        <button class="btn btn-sm btn-ghost" type="button" data-action="logout">${esc(t('topbar.signout'))}</button>
      </div>
    </div>
  </div>
  <div class="page">
    ${CAN_PERSIST ? '' : `<div class="warn">${esc(t('banner.noStorage'))}</div>`}
    ${content}
  </div>`;
}

function updateNavScrollControls() {
  const nav=document.querySelector('.nav'); const shell=nav && nav.closest('.nav-shell');
  if(!nav || !shell) return;
  const buttons=shell.querySelectorAll('.nav-scroll-btn'); const overflow=nav.scrollWidth>nav.clientWidth+2;
  buttons.forEach(button=>{ button.hidden=!overflow; });
  if(overflow) { buttons[0].disabled=nav.scrollLeft<=1; buttons[1].disabled=nav.scrollLeft+nav.clientWidth>=nav.scrollWidth-1; }
}

/* ------------------------------ 视图：工作台 ------------------------------ */

function viewDashboard() {
  const u = currentUser();
  const list = visibleMatters(u);
  const red = list.filter(m => m.status === 'red');
  const dueWeek = list.filter(m => isThisWeek(m.due));
  const waitingMe = list.filter(m => m.status !== 'green');
  const hot = sorted(list.filter(m => m.status === 'red' || m.status === 'yellow'));
  const hour = new Date().getHours();
  const greetKey = hour < 11 ? 'dash.morning' : hour < 18 ? 'dash.afternoon' : 'dash.evening';
  const greet = t(greetKey, { name: u.name.split(' ')[0] });

  const kpis = `
    <div class="kpis">
      <div class="kpi hot"><div class="k">${esc(t('dash.kpi.red'))}</div><div class="v">${red.length}</div><div class="foot">${esc(t('dash.kpi.redFoot'))}</div></div>
      <div class="kpi warm"><div class="k">${esc(t('dash.kpi.due'))}</div><div class="v">${dueWeek.length}</div><div class="foot">${esc(t('dash.kpi.dueFoot'))}</div></div>
      <div class="kpi cool"><div class="k">${esc(t('dash.kpi.mine'))}</div><div class="v">${waitingMe.length}</div><div class="foot">${esc(t('dash.kpi.mineFoot'))}</div></div>
      <div class="kpi good"><div class="k">${esc(t('dash.kpi.visible'))}</div><div class="v">${list.length}</div><div class="foot">${esc(t(u.admin ? 'dash.kpi.visibleAdmin' : 'dash.kpi.visibleMember'))}</div></div>
    </div>`;

  const rows = hot.length ? hot.map(m => `
    <div class="row" data-action="open-matter" data-id="${m.id}">
      <div class="no">${esc(m.no)}</div>
      <div class="cell-main">
        <div class="t">${esc(L(m.title))}</div>
        <div class="meta">${esc(L(m.client))}${m.reason ? ' · ' + esc(L(m.reason)) : ''}</div>
      </div>
      <div class="cell-next next">${esc(L(m.next))}</div>
      <div class="cell-status">${statusChip(m.status)}</div>
      <div class="cell-due due ${dueClass(m.due)}">${fmtDateShort(m.due)}<div class="small muted">${dueText(m.due)}</div></div>
    </div>`).join('') : `<div class="empty">${esc(t('dash.empty'))}</div>`;

  return `
    <div class="page-head">
      <div>
        <h1>${esc(greet)}</h1>
        <div class="desc">${esc(t('dash.desc'))}</div>
      </div>
      <div class="right">
        <button class="btn btn-primary" type="button" data-action="new-matter">${esc(t('dash.new'))}</button>
      </div>
    </div>
    ${kpis}
    <div class="card">
      <div style="padding:16px 18px 4px">
        <div class="section-title" style="margin-bottom:2px">${esc(t('dash.today'))}</div>
        <div class="small muted" style="margin-bottom:8px">${esc(t('dash.todayDesc'))}</div>
      </div>
      <div class="rows">${rows}</div>
    </div>
    <div class="legend">
      <span>${esc(t('legend.green'))}</span><span>${esc(t('legend.yellow'))}</span><span>${esc(t('legend.red'))}</span>
    </div>`;
}

/* ------------------------------ 视图：事项列表 ------------------------------ */

function filterMatters() {
  const u = currentUser();
  const f = state.filters;
  return visibleMatters(u).filter(m => {
    if (f.area && m.area !== f.area) return false;
    if (f.owner && m.owner !== f.owner) return false;
    if (f.status && m.status !== f.status) return false;
    if (f.waiting && m.waiting !== f.waiting) return false;
    if (f.q) {
      const hay = [m.no, L(m.client), L(m.title), L(m.next), L(m.notes)].join(' ').toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });
}

function matterRowsHTML() {
  const list = sorted(filterMatters());
  if (!list.length) return '';
  const u = currentUser();
  return list.map(m => {
    const canDelete = u.admin || m.owner === u.id;
    return `
    <tr class="${m.importError ? 'import-error' : ''}" data-action="open-matter" data-id="${m.id}">
      <td class="bulk-cell">${canDelete ? `<input class="bulk-check" type="checkbox" data-action="toggle-bulk-matter" data-id="${m.id}" ${state.bulkSelected.has(String(m.id)) ? 'checked' : ''} aria-label="${esc(t('list.bulkDelete'))}: ${esc(m.no)}">` : ''}</td>
      <td class="nw">${m.importError ? `<div class="import-error-label">${esc(t('list.importError'))}</div>` : ''}${esc(m.no)}</td>
      <td>${esc(L(m.client))}</td>
      <td><b>${esc(L(m.title))}</b>${m.notes ? `<div class="small muted">${esc(L(m.notes))}</div>` : ''}</td>
      <td>${areaTag(m.area)}</td>
      <td class="nw">${statusChip(m.status)}</td>
      <td>${esc(L(m.next))}</td>
      <td class="nw">${fmtDateShort(m.due)}<div class="small muted">${dueText(m.due)}</div></td>
      <td class="nw">${esc(waitLabel(m.waiting))}</td>
    </tr>`;
  }).join('');
}

function viewMatters() {
  const f = state.filters;
  const opts = (arr, val, all) => [`<option value="" ${val === '' ? 'selected' : ''}>${all}</option>`]
    .concat(arr.map(o => `<option value="${esc(o.v)}" ${val === o.v ? 'selected' : ''}>${esc(o.t)}</option>`)).join('');
  // 筛选只列出这个账号真的看得见的内容，避免出现永远是空的筛选项
  const seen = visibleMatters(currentUser());
  const areaOpts = [...new Set([...seen.map(m => m.area).filter(Boolean), 'other'])]
    .map(area => ({ v: area, t: areaName(area) }))
    .sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const statusOpts = ['red', 'yellow', 'green'].map(k => ({ v: k, t: STATUS[k].dot + ' ' + statusShort(k) }));
  // 等待谁的筛选项按实际用到的值生成，自定义填的也会出现在这里
  const waitingOpts = [...new Set([...seen.map(m => m.waiting).filter(w => w && w !== 'none'), 'other'])]
    .map(w => ({ v: w, t: waitLabel(w) }))
    .sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const n = sorted(filterMatters()).length;
  const bulkCount = [...state.bulkSelected].filter(id => {
    const m = matterById(id);
    return m && !m.deletedAt && (currentUser().admin || m.owner === currentUser().id);
  }).length;
  const selectable = sorted(filterMatters()).filter(m => currentUser().admin || m.owner === currentUser().id);
  const allSelected = selectable.length > 0 && selectable.every(m => state.bulkSelected.has(String(m.id)));

  return `
    <div class="page-head">
      <div>
        <h1>${esc(t('list.title'))}</h1>
        <div class="desc">${esc(t('list.desc', { n }))}</div>
      </div>
      <div class="right">
        <button class="btn" type="button" data-action="import-matters">${esc(t('list.import'))}</button>
        <button class="btn btn-danger" type="button" data-action="bulk-delete-matters" ${bulkCount ? '' : 'disabled'}>${esc(t('list.bulkDelete'))}${bulkCount ? ` (${bulkCount})` : ''}</button>
        <button class="btn" type="button" data-action="export-csv">${esc(t('list.export'))}</button>
        <button class="btn btn-primary" type="button" data-action="new-matter">${esc(t('dash.new'))}</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="search" data-filter="q" value="${esc(f.q)}" placeholder="${esc(t('list.search'))}">
      <select data-filter="area">${opts(areaOpts, f.area, t('list.allAreas'))}</select>
      <select data-filter="status">${opts(statusOpts, f.status, t('list.allStatus'))}</select>
      <select data-filter="waiting">${opts(waitingOpts, f.waiting, t('list.allWaiting'))}</select>
      <button class="btn btn-sm btn-ghost" type="button" data-action="clear-filters">${esc(t('list.clear'))}</button>
    </div>
    <div class="card table-wrap">
      <table class="grid">
        <thead><tr>
          <th class="bulk-cell"><input class="bulk-check" type="checkbox" data-action="toggle-all-bulk-matters" ${allSelected ? 'checked' : ''} ${selectable.length ? '' : 'disabled'} aria-label="${esc(t('list.bulkDelete'))}"></th>
          <th>${esc(t('th.no'))}</th><th>${esc(t('th.client'))}</th><th>${esc(t('th.title'))}</th>
          <th>${esc(t('th.area'))}</th><th>${esc(t('th.status'))}</th>
          <th>${esc(t('th.next'))}</th><th>${esc(t('th.due'))}</th><th>${esc(t('th.waiting'))}</th>
        </tr></thead>
        <tbody id="matter-rows">${matterRowsHTML() || ''}</tbody>
      </table>
      <div class="empty" id="matter-empty" style="${sorted(filterMatters()).length ? 'display:none' : ''}">${esc(t('list.empty'))}</div>
    </div>
    <div class="legend">
      <span>${esc(t('legend.green'))}</span><span>${esc(t('legend.yellow'))}</span><span>${esc(t('legend.red'))}</span>
    </div>`;
}

/* ------------------------------ 视图：日历 ------------------------------ */

function viewCalendar() {
  const base=today(); base.setDate(1); base.setMonth(base.getMonth()+state.calendarOffset);
  const year=base.getFullYear(), month=base.getMonth(), first=new Date(year,month,1), start=new Date(first);
  start.setDate(first.getDate()-first.getDay());
  const names=lang==='zh'?['日','一','二','三','四','五','六']:(lang==='es'?['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']:['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
  const list=visibleMatters(currentUser()), cells=[];
  for(let i=0;i<42;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const key=iso(d), items=list.filter(m=>m.due===key), schedules=scheduleItems(currentUser(),key);
    cells.push(`<div class="calendar-cell ${d.getMonth()!==month?'outside':''} ${key===iso(today())?'is-today':''}" data-action="calendar-date" data-date="${key}">
      <div class="calendar-date">${d.getDate()}</div>
      ${items.slice(0,4).map(m=>`<button type="button" class="calendar-item status-${esc(m.status)}" data-action="open-matter" data-id="${m.id}">${esc(L(m.title))}</button>`).join('')}
      ${items.length>4?`<div class="small muted">+${items.length-4}</div>`:''}
      ${schedules.map(s=>`<button type="button" class="calendar-item schedule-item" data-action="open-schedule" data-id="${esc(s.id)}">${esc(s.reminderTime)} · ${esc(s.reminderText)}</button>`).join('')}
    </div>`);
  }
  return `<div class="page-head"><div><h1>${esc(t('nav.calendar'))}</h1><div class="desc">${year}-${String(month+1).padStart(2,'0')}</div></div>
    <div class="right"><button class="btn" data-action="calendar-prev">‹ ${esc(t('calendar.previous'))}</button><button class="btn" data-action="calendar-today">${esc(t('calendar.today'))}</button><button class="btn" data-action="calendar-next">${esc(t('calendar.next'))} ›</button></div></div>
    <div class="calendar-wrap"><div class="calendar-grid calendar-head">${names.map(n=>`<div>${esc(n)}</div>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div></div>`;
}

/* ------------------------------ 视图：收件箱 ------------------------------ */

function viewInbox() {
  const u = currentUser();
  const entries = inboxEntries(u);
  const systemState = systemNotificationState();
  let systemControl;
  if (systemNotice.requesting) {
    systemControl = `<span class="system-notice-state requesting">${esc(t('inbox.systemRequesting'))}</span>`;
  } else if (systemState === 'default' || systemState === 'disabled' || systemState === 'denied') {
    systemControl = `<button class="btn" type="button" data-action="enable-system-notifications">${esc(t('inbox.systemEnable'))}</button>`;
  } else if (systemState === 'granted') {
    systemControl = `<span class="system-notice-controls"><span class="system-notice-state granted">${esc(t('inbox.systemEnabled'))}</span>
      <button class="btn" type="button" data-action="disable-system-notifications">${esc(t('inbox.systemDisable'))}</button></span>`;
  } else {
    systemControl = `<span class="system-notice-state ${systemState}">${esc(t('inbox.systemUnsupported'))}</span>`;
  }
  const rows = entries.length ? entries.map(l => {
    const read = (l.readBy || []).includes(u.id);
    const actor = (USER[l.by] || {}).name || l.by;
    return `<div class="inbox-item ${read ? 'is-read' : 'is-unread'}">
      <div class="inbox-avatar">${esc((USER[l.by] || {}).short || String(actor).slice(0, 1))}</div>
      <div class="inbox-main">
        <div class="inbox-message">${esc(inboxText(l))}</div>
        <div class="inbox-meta">${esc(actor)} · ${esc(fmtStamp(l.at))} · ${esc(l.matterNo || '')}</div>
      </div>
      <div class="inbox-action">${read
        ? `<span class="read-state">✓ ${esc(t('inbox.read'))}</span>`
        : `<button class="btn btn-sm btn-primary" type="button" data-action="mark-read" data-id="${esc(l.id)}">${esc(t('inbox.markRead'))}</button>`}
        <button class="btn btn-sm btn-danger" type="button" data-action="delete-notification" data-id="${esc(l.id)}">${esc(t('inbox.delete'))}</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty">${esc(t('inbox.empty'))}</div>`;
  return `<div class="page-head"><div><h1>${esc(t('inbox.title'))}</h1><div class="desc">${esc(t('inbox.desc'))}</div>
      <div class="desc">${esc(t('inbox.systemHint'))}</div></div><div class="right">${systemControl}</div></div>
    <div class="card inbox-list">${rows}</div>`;
}

/* ------------------------------ 视图：事项详情 ------------------------------ */

function viewMatter(id) {
  const m = matterById(id);
  const u = currentUser();
  if (!m) return `<div class="card card-pad">${esc(t('detail.notFound'))}<a href="#/matters">${esc(t('back.toList'))}</a></div>`;
  // 先查权限：删掉的事项也不能让项目外的人看见
  if (!canSee(u, m)) {
    return `
      <div class="page-head"><div><h1>${esc(t('detail.noAccessTitle'))}</h1>
      <div class="desc">${esc(t('detail.noAccess1', { no: m.no, title: L(m.title) }))}</div>
      <div class="desc">${esc(t('detail.noAccess2', { owner: (USER[m.owner] || {}).name || m.owner }))}</div></div></div>
      <div class="card card-pad"><a href="#/">${esc(t('back.toDashboard'))}</a></div>`;
  }
  if (m.deletedAt) {
    return `
      <a class="back" href="#/trash">${esc(t('back.toSettings'))}</a>
      <div class="page-head"><div>
        <h1>${esc(t('detail.trashTitle'))}</h1>
        <div class="desc">${esc(m.no)} · ${esc(L(m.client))} · ${esc(L(m.title))}</div>
        <div class="desc">${esc(t('detail.trashWhen', { when: fmtStamp(m.deletedAt) }))}</div>
      </div></div>
      <div class="card card-pad">
        <button class="btn btn-primary" type="button" data-action="restore-matter" data-id="${m.id}">${esc(t('detail.trashRestore'))}</button>
      </div>`;
  }

  const myLogs = logs.filter(l => String(l.matterId) === String(m.id)).sort((a, b) => b.at - a.at);
  const canEdit = u.admin || m.owner === u.id;
  const steps = stepsOf(m);
  const last = lastStep(m);
  const lastEdit = lastMatterEditLog(m);
  const areaField = selectWithCustom('data-field="area" data-area-picker', m.area, practiceAreaOptions(), t('form.customAreaPh'));
  const stageField = selectWithCustom('data-field="stage"', m.stage, stageOptions(), t('form.customStagePh'));
  const waitField = selectWithCustom('data-field="waiting"', m.waiting, waitingOptions(), t('form.customWaitPh'));
  const statusOpts = Object.keys(STATUS).map(k => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${STATUS[k].dot} ${esc(statusName(k))}</option>`).join('');
  const ownerOpts = (u.admin ? USERS : USERS.filter(x=>x.id===m.owner)).map(x => `<option value="${x.id}" ${m.owner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const nextOwnerOpts = USERS.map(x => `<option value="${x.id}" ${m.nextOwner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

  return `
    <a class="back" href="#/matters">${esc(t('back.toList'))}</a>
    <div class="page-head">
      <div>
        <h1>${esc(L(m.title))}</h1>
        <div class="desc">${esc(m.no)} · ${esc(L(m.client))}</div>
      </div>
      <div class="right">
        <button class="btn" type="button" data-action="export-csv" data-id="${m.id}">${esc(t('list.export'))}</button>
        ${lastEdit ? `<button class="btn" type="button" data-action="undo-matter-edit" data-id="${m.id}">${esc(t('detail.undoEdit'))}</button>` : ''}
        ${canEdit ? `<button class="btn btn-primary" type="button" data-action="save-matter" data-id="${m.id}">${esc(t('detail.save'))}</button>` : ''}
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card card-pad" data-matter="${m.id}">
          <fieldset class="matter-edit-fields" ${canEdit ? '' : 'disabled'}>
          <div class="section-title">${esc(t('detail.info'))}</div>
          <div class="grid-2">
            <div class="field"><label>${esc(t('detail.client'))}</label><input data-field="client" value="${esc(L(m.client))}"></div>
            <div class="field"><label>${esc(t('detail.title'))}</label><input data-field="title" value="${esc(L(m.title))}"></div>
            <div class="field"><label>${esc(t('detail.area'))}</label>${areaField}</div>
            <div class="field"><label>${esc(t('detail.stage'))}</label>${stageField}</div>
            <div class="field"><label>${esc(t('detail.status'))}</label><select data-field="status">${statusOpts}</select></div>
            <div class="field"><label>${esc(t('detail.owner'))}</label><select data-field="owner">${ownerOpts}</select></div>
            <div class="field"><label>${esc(t('detail.nextOwner'))}</label><select data-field="nextOwner">${nextOwnerOpts}</select></div>
            <div class="field"><label>${esc(t('detail.due'))}</label><input type="date" data-field="due" value="${esc(m.due || '')}"></div>
            <div class="field"><label>${esc(t('detail.waiting'))}</label>${waitField}</div>
            <div class="field"><label>${esc(t('detail.lastContact'))}</label><input type="date" data-field="lastContact" value="${esc(m.lastContact || '')}"></div>
          </div>
          <div class="field"><label>${esc(t('detail.next'))}</label><input data-field="next" value="${esc(L(m.next))}"></div>
          <div class="field"><label>${esc(t('detail.reason'))}</label><input data-field="reason" value="${esc(L(m.reason))}" placeholder="${esc(t('detail.reasonPh'))}"></div>
          <div class="field"><label>${esc(t('detail.notes'))}</label><textarea data-field="notes" rows="3">${esc(L(m.notes))}</textarea></div>
          <div class="field"><label>${esc(t('detail.members'))}</label><div class="member-list">${USERS.map(x => `<label class="member-item"><input type="checkbox" data-field="team" value="${x.id}" ${(m.team||[]).includes(x.id)?'checked':''}><span class="nm">${esc(x.name)}</span><span class="rl">${esc(t(x.roleKey))}</span></label>`).join('')}</div><div class="hint">${esc(t('detail.membersHint'))}</div></div>
          </fieldset>
          <div class="danger-zone">
            ${canEdit ? `<button class="btn btn-danger btn-sm" type="button" data-action="delete-matter" data-id="${m.id}">${esc(t('detail.delete'))}</button>` : ''}
          </div>
        </div>
      </div>
      <div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">${esc(t('detail.step.title'))}</div>
          <div class="step-now">${esc(L(m.next))}</div>
          <div class="step-meta">
            <span class="${dueClass(m.due)}">📅 ${fmtDate(m.due)} · ${dueText(m.due)}</span>
            <span>${esc(t('detail.step.waiting', { w: waitLabel(m.waiting) }))}</span>
          </div>
          <button class="btn btn-primary btn-block" type="button" data-action="complete-step" data-id="${m.id}">${esc(t('detail.step.button'))}</button>
          ${last
            ? `<button class="btn btn-block btn-wrap" style="margin-top:8px" type="button" data-action="undo-step" data-id="${m.id}">${esc(t('detail.undo.button', { text: L(last.text) }))}</button>
               <div class="hint" style="margin-top:6px">${esc(t('detail.undo.hint'))}</div>`
            : ''}
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">${esc(t('detail.files.title'))}
            <button class="btn btn-sm" style="margin-left:auto" type="button" data-action="add-file" data-id="${m.id}">${esc(t('detail.files.add'))}</button>
          </div>
          <div class="files">
            ${(m.files || []).length ? m.files.map((f, i) => `
              <div class="file-item">
                <span>📎</span>
                ${f.encrypted ? `<button class="btn btn-ghost nm" type="button" data-action="download-encrypted-file" data-id="${m.id}" data-idx="${i}">${esc(L(f.name))}</button>` : `<a class="nm" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(L(f.name))}</a>`}
                <button class="btn btn-sm btn-ghost" type="button" data-action="remove-file" data-id="${m.id}" data-idx="${i}">${esc(t('common.remove'))}</button>
              </div>`).join('') : `<div class="small muted">${esc(t('detail.files.empty'))}</div>`}
          </div>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">${esc(t('detail.history.title'))}
            <span class="small muted" style="margin-left:auto;font-weight:400">${esc(t('detail.history.count', { n: steps.length }))}</span>
          </div>
          ${steps.length ? steps.map(s => `
            <div class="step-done">
              <div class="sd-text">✓ ${esc(L(s.text))}</div>
              <div class="small muted">${esc(fmtStamp(s.at))} · ${esc(fmtDate(s.due))}</div>
              ${s.note ? `<div class="small">${esc(L(s.note))}</div>` : ''}
            </div>`).join('')
            : `<div class="small muted">${esc(t('detail.history.empty'))}</div>`}
        </div>
        <div class="card card-pad">
          <div class="section-title">${esc(t('detail.timeline.title'))}</div>
          <div class="timeline">
            ${myLogs.length ? myLogs.slice(0, 40).map(l => `
              <div class="tl-item ${l.at > Date.now() - 86400000 ? 'hot' : ''}">
                <div class="when">${fmtStamp(l.at)}</div>
                <div class="what">${esc(logText(l))}</div>
              </div>`).join('') : `<div class="small muted">${esc(t('detail.timeline.empty'))}</div>`}
          </div>
        </div>
      </div>
    </div>`;
}

/* ------------------------------ 视图：每周视图 ------------------------------ */

function viewWeekly() {
  const list = sorted(visibleMatters(currentUser()));
  const u = currentUser();
  const cols = `
    <div class="weekly-col">
      <h3><span class="avatar" style="background:#dcfce7">${esc(u.short)}</span>${esc(u.name)}
        <span class="muted small">${esc(t('weekly.items', { n: list.length }))}</span></h3>
      ${list.map(m => `
        <div class="wcard" data-action="open-matter" data-id="${m.id}" style="cursor:pointer">
          <div class="h">${statusChip(m.status)}<span class="nm">${esc(L(m.title))}</span></div>
          <dl>
            <dt>${esc(t('weekly.stage'))}</dt><dd>${esc(stageLabel(m.stage))}（${esc(L(m.client))}）</dd>
            <dt>${esc(t('weekly.next'))}</dt><dd>${esc(L(m.next))}</dd>
            <dt>${esc(t('weekly.due'))}</dt><dd class="${dueClass(m.due)}">${fmtDate(m.due)} · ${dueText(m.due)}</dd>
            <dt>${esc(t('weekly.waiting'))}</dt><dd>${esc(waitLabel(m.waiting))}</dd>
          </dl>
        </div>`).join('')}
    </div>`;

  return `
    <div class="page-head">
      <div>
        <h1>${esc(t('weekly.title'))}</h1>
        <div class="desc">${esc(t('weekly.desc'))}</div>
      </div>
      <div class="right">
        <button class="btn" type="button" data-action="print">${esc(t('weekly.print'))}</button>
      </div>
    </div>
    <div class="weekly-grid">${list.length ? cols : `<div class="empty">${esc(t('weekly.empty'))}</div>`}</div>`;
}

/* ------------------------------ 视图：设置 ------------------------------ */

function viewSettings() {
  return `
    <div class="page-head">
      <div>
        <h1>${esc(L({zh:'信息',en:'Info',es:'Información'}))}</h1>
        <div class="desc">${esc(t(APP_TITLE_KEY))} · ${esc(t(TEAM_NAME_KEY))}</div>
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card card-pad">
          <div class="section-title">${esc(L({zh:'数据保存',en:'Data storage',es:'Almacenamiento de datos'}))}</div>
          <p>${esc(L({zh:'这是母子版，使用独立云数据库。Benson 只能看到自己负责或被加入成员列表的事项；Carol 作为管理员可查看全部事项。',en:'This mother-son edition uses a separate cloud database. Benson sees only matters he owns or has been added to; Carol can see all matters as administrator.',es:'Esta edición para madre e hijo usa una base de datos separada. Benson solo ve los asuntos que dirige o a los que fue añadido; Carol puede verlos todos como administradora.'}))}</p>
          <div class="hint">${esc(L({zh:'建议定期使用“导出CSV表格”备份事项。',en:'Use Export CSV regularly to back up your matters.',es:'Usa Exportar CSV periódicamente para respaldar tus asuntos.'}))}</div>
        </div>
      </div>
      <div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">${esc(t('settings.numbering'))}</div>
          <div class="kv"><span class="k">${esc(t('settings.numberFormat'))}</span><span class="v">${esc(t('settings.numberFormatValue'))}</span></div>
          <div class="kv"><span class="k">${esc(t('settings.numberExample'))}</span><span class="v">2026-041</span></div>
          <div class="kv"><span class="k">${esc(t('settings.numberNext'))}</span><span class="v">2026-${String(seq + 1).padStart(3, '0')}</span></div>
        </div>
        <div class="card card-pad">
          <div class="section-title">${esc(t('settings.securityTools'))}</div>
          <div class="hint" style="margin-bottom:12px">${esc(t('settings.backupHint'))}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" type="button" data-action="export-encrypted-backup">${esc(t('settings.backupExport'))}</button>
            <button class="btn" type="button" data-action="restore-encrypted-backup">${esc(t('settings.backupRestore'))}</button>
            <button class="btn" type="button" data-action="view-security-events">${esc(t('settings.securityEvents'))}</button>
            <button class="btn btn-danger" type="button" data-action="logout-all-devices">${esc(t('settings.logoutAll'))}</button>
          </div>
          <div class="section-title" style="margin-top:18px">${esc(t('settings.sessions'))}</div>
          ${(state.devices||[]).length ? state.devices.map(d=>`<div class="file-item" style="align-items:center;margin-bottom:8px"><span>▣</span><span class="nm"><b>${esc(d.device_name)}</b>${d.is_current?` · ${esc(t('settings.deviceCurrent'))}`:''}<br><span class="small muted">${esc(t('settings.deviceLocation',{place:devicePlace(d)}))} · ${esc(t('settings.deviceIp',{ip:d.ip_address||'—'}))} · ${esc(t('settings.deviceLastSeen',{time:fmtStamp(d.last_seen)}))}</span></span><button class="btn btn-sm btn-ghost" type="button" data-action="revoke-device" data-session-id="${esc(d.session_id)}">${esc(t('settings.deviceRevoke'))}</button></div>`).join(''):`<div class="hint">${esc(t('settings.deviceEmpty'))}</div>`}
        </div>
      </div>
    </div>`;
}

function viewTrash() {
  const trashed = trashedMatters();
  const u = currentUser();
  const selectedCount = trashed.filter(m => state.trashSelected.has(String(m.id))).length;
  const allSelected = trashed.length > 0 && trashed.every(m => state.trashSelected.has(String(m.id)));
  return `
    <div class="page-head">
      <div>
        <h1>${esc(t('settings.trash'))}</h1>
        <div class="desc">${esc(t('trash.desc'))}</div>
      </div>
      <div class="right"><button class="btn btn-danger" type="button" data-action="bulk-purge-trash" ${selectedCount ? '' : 'disabled'}>${esc(t('trash.bulkPurge'))}${selectedCount ? ` (${selectedCount})` : ''}</button></div>
    </div>
    <div class="card card-pad">
      <div class="section-title">${esc(t('settings.trash'))}
        <label class="trash-select-all"><input class="bulk-check" type="checkbox" data-action="toggle-all-trash" ${allSelected ? 'checked' : ''} ${trashed.length ? '' : 'disabled'}> ${esc(t('trash.selectAll'))}</label>
        <span class="small muted" style="margin-left:auto;font-weight:400">${esc(t('settings.trashCount', { n: trashed.length }))}</span>
      </div>
      ${trashed.length ? trashed.map(m => `
        <div class="trash-row">
          <input class="bulk-check" type="checkbox" data-action="toggle-trash-matter" data-id="${m.id}" ${state.trashSelected.has(String(m.id)) ? 'checked' : ''} aria-label="${esc(t('trash.bulkPurge'))}: ${esc(m.no)}">
          <span class="nm"><b>${esc(m.no)} ${esc(L(m.title))}</b>
            <span class="meta">${esc(t('settings.trashMeta', { client: L(m.client), when: fmtStamp(m.deletedAt) }))}</span></span>
          <button class="btn btn-sm" type="button" data-action="restore-matter" data-id="${m.id}">${esc(t('settings.trashRestore'))}</button>
          <button class="btn btn-sm btn-danger" type="button" data-action="purge-matter" data-id="${m.id}">${esc(t('settings.trashPurge'))}</button>
        </div>`).join('')
        : `<div class="small muted">${esc(t('settings.trashEmpty'))}</div>`}
    </div>`;
}

/* ------------------------------ 弹窗：新建事项 ------------------------------ */

function modalFrame(title, body, footer) {
  return `
  <div class="modal-mask" data-mask="1">
    <div class="modal">
      <div class="modal-head"><h2>${esc(title)}</h2></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${footer}</div>
    </div>
  </div>`;
}

function modalConfirm(mo) {
  return modalFrame(
    t(mo.titleKey),
    `<div style="font-size:14px;color:var(--ink-2);line-height:1.75;white-space:pre-line">${esc(mo.body || '')}</div>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn ${mo.danger ? 'btn-danger-solid' : 'btn-primary'}" type="button"
       data-action="${mo.action}"${mo.id ? ` data-id="${mo.id}"` : ''}>${esc(mo.confirmText || t(mo.confirmKey))}</button>`
  );
}

function modalNotice(mo) {
  return modalFrame(
    t(mo.titleKey),
    `<div style="font-size:14.5px;color:var(--ink-2);line-height:1.75">${mo.body || ''}</div>`,
    `<button class="btn btn-primary" type="button" data-action="close-modal">${esc(t('common.ok'))}</button>`
  );
}

function importErrorModal(errors) {
  if (!errors.length) return null;
  return {
    type: 'notice', titleKey: 'modal.importError.title',
    body: errors.map(error => `<div>${esc(t('modal.importFieldInvalid', {
      title: error.title, field: t(error.fieldKey),
    }))}</div>`).join(''),
  };
}

function modalImport() {
  return modalFrame(t('modal.import.title'),
    `<div class="hint" style="margin-bottom:14px">${esc(t('modal.import.hint'))}</div>
     <form id="import-form" data-action="import-file"><div class="field"><label class="req">${esc(t('modal.import.choose'))}</label>
       <input type="file" name="importFile" accept=".csv,.xlsx,.xls" required></div></form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn btn-primary" type="submit" form="import-form">${esc(t('modal.import.confirm'))}</button>`);
}

function modalImportInvalid() {
  return modalFrame(t('modal.import.title'),
    `<div style="font-size:14.5px;color:var(--ink-2);line-height:1.75">${esc(t('modal.import.invalid'))}</div>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.import.no'))}</button>
     <button class="btn btn-primary" type="button" data-action="download-import-sample">${esc(t('modal.import.yes'))}</button>`);
}

function modalCompleteStep(mo) {
  const m = matterById(mo.matterId);
  if (!m) return '';
  const stageField = selectWithCustom('name="stage"', m.stage, stageOptions(), t('form.customStagePh'));
  const statusOpts = Object.keys(STATUS).map(k =>
    `<option value="${k}" ${m.status === k ? 'selected' : ''}>${STATUS[k].dot} ${esc(statusName(k))}</option>`).join('');
  const waitField = selectWithCustom('name="waiting"', m.waiting, waitingOptions(), t('form.customWaitPh'));
  const ownerOpts = USERS.map(x => `<option value="${x.id}" ${m.nextOwner===x.id?'selected':''}>${esc(x.name)}</option>`).join('');

  return modalFrame(
    t('modal.complete.title'),
    `<div class="step-box">
       <div class="small muted">${esc(t('modal.complete.aboutTo'))}</div>
       <div class="sd-text">✓ ${esc(L(m.next))}</div>
       <div class="small muted">${fmtDate(m.due)}（${dueText(m.due)}）</div>
     </div>
     <div class="hint" style="margin-bottom:14px">${t('modal.complete.afterHint')}</div>
     <form id="complete-form" data-action="confirm-complete-step" data-id="${m.id}">
       <div class="grid-2">
         <div class="field"><label class="req">${esc(t('modal.complete.stage'))}</label>${stageField}</div>
         <div class="field"><label class="req">${esc(t('detail.status'))}</label><select name="status">${statusOpts}</select></div>
         <div class="field"><label class="req">${esc(t('detail.due'))}</label><input type="date" name="due" value="${esc(m.due || '')}"></div>
         <div class="field"><label>${esc(t('form.waiting'))}</label>${waitField}</div>
       </div>
       <div class="field"><label class="req">${esc(t('form.next'))}</label>
         <input name="next" autocomplete="off" placeholder="${esc(t('form.nextPh'))}"></div>
       <div class="field"><label class="req">${esc(t('detail.nextOwner'))}</label><select name="nextOwner">${ownerOpts}</select></div>
       <div class="field"><label>${esc(t('detail.reason'))}</label>
         <input name="reason" autocomplete="off" value="" placeholder="${esc(t('form.reasonPh'))}"></div>
     </form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn btn-primary" type="submit" form="complete-form">${esc(t('modal.complete.submit'))}</button>`
  );
}

function modalFile(mo) {
  const m = matterById(mo.matterId);
  if (!m) return '';
  return modalFrame(
    t('modal.file.title'),
    `<form id="file-form" data-action="confirm-add-file" data-id="${m.id}">
       <div class="field"><label class="req">${esc(t('modal.file.name'))}</label>
         <input type="file" name="fileBlob" required></div>
       <div class="hint">${esc(t('modal.file.hint'))}</div>
     </form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn btn-primary" type="submit" form="file-form">${esc(t('modal.file.submit'))}</button>`
  );
}

function modalChat(mo) {
  const m = matterById(mo.matterId);
  if (!m || !canSee(currentUser(), m)) return '';
  const recipients = [...new Set([...(m.team || []), m.owner])]
    .filter(id => id !== currentUser().id && USER[id]);
  return modalFrame(
    t('modal.chat.title') + ' · ' + L(m.title),
    `<form id="chat-form" data-action="send-chat" data-id="${m.id}">
       <div class="field"><label>${esc(t('modal.chat.to'))}</label>
         <div class="member-list chat-recipients">${recipients.length ? recipients.map(id => `<label class="member-item">
           <input type="checkbox" name="chatTo" value="${esc(id)}" checked>
           <span class="nm">${esc(USER[id].name)}</span>
         </label>`).join('') : `<div class="hint">${esc(t('modal.chat.noRecipients'))}</div>`}</div></div>
       <div class="field"><label class="req">${esc(t('modal.chat.message'))}</label>
         <textarea name="message" rows="5" placeholder="${esc(t('modal.chat.placeholder'))}" autocomplete="off"></textarea></div>
     </form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn btn-primary" type="submit" form="chat-form">${esc(t('modal.chat.send'))}</button>`
  );
}

function renderModal() {
  const mo = state.modal;
  if (!mo) return '';
  if (mo.type === 'new-matter') return modalNewMatter();
  if (mo.type === 'calendar-choice') return modalCalendarChoice(mo);
  if (mo.type === 'schedule-reminder') return modalScheduleReminder(mo);
  if (mo.type === 'schedule-details') return modalScheduleDetails(mo);
  if (mo.type === 'file') return modalFile(mo);
  if (mo.type === 'chat') return modalChat(mo);
  if (mo.type === 'complete-step') return modalCompleteStep(mo);
  if (mo.type === 'confirm') return modalConfirm(mo);
  if (mo.type === 'notice') return modalNotice(mo);
  if (mo.type === 'import') return modalImport();
  if (mo.type === 'import-invalid') return modalImportInvalid();
  return '';
}

function modalCalendarChoice(mo) {
  return modalFrame(t('calendar.chooseTitle',{date:fmtDate(mo.date)}),`<div class="hint">${esc(t('calendar.chooseHint'))}</div>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button><button class="btn" type="button" data-action="calendar-new-matter" data-date="${esc(mo.date)}">${esc(t('calendar.newMatter'))}</button><button class="btn btn-primary" type="button" data-action="calendar-new-reminder" data-date="${esc(mo.date)}">${esc(t('calendar.dayReminder'))}</button>`);
}
function modalScheduleReminder(mo) {
  return modalFrame(t('calendar.reminderTitle'),`<form id="schedule-form" data-action="create-schedule"><input type="hidden" name="date" value="${esc(mo.date)}"><div class="field"><label>${esc(t('detail.due'))}</label><input type="date" value="${esc(mo.date)}" disabled></div><div class="field"><label class="req">${esc(t('calendar.reminderTime'))}</label><input type="time" name="time" value="09:00" required></div><div class="field"><label class="req">${esc(t('calendar.reminderMessage'))}</label><textarea name="message" rows="4" required placeholder="${esc(t('calendar.reminderPlaceholder'))}"></textarea></div><label class="member-item"><input type="checkbox" name="enabled" value="1" checked><span class="nm">${esc(t('calendar.reminderEnable'))}</span></label><div class="hint" style="margin-top:10px">${esc(t('calendar.reminderHint'))}</div></form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button><button class="btn btn-primary" type="submit" form="schedule-form">${esc(t('calendar.reminderSave'))}</button>`);
}
function modalScheduleDetails(mo) {
  const item=matterById(mo.id);
  if(!item || item.kind!=='schedule') return '';
  return modalFrame(t('calendar.dayReminder'),`<div class="kv"><span class="k">${esc(t('detail.due'))}</span><span class="v">${esc(fmtDate(item.due))}</span></div><div class="kv"><span class="k">${esc(t('calendar.reminderTime'))}</span><span class="v">${esc(item.reminderTime)}</span></div><div class="kv"><span class="k">${esc(t('calendar.reminderMessage'))}</span><span class="v">${esc(item.reminderText)}</span></div>`,
    `<button class="btn btn-danger" type="button" data-action="delete-schedule" data-id="${esc(item.id)}">${esc(t('calendar.reminderDelete'))}</button><button class="btn btn-primary" type="button" data-action="close-modal">${esc(t('common.ok'))}</button>`);
}

function modalNewMatter() {
  if (!state.modal || state.modal.type !== 'new-matter') return '';
  const u = currentUser();
  const areaField = selectWithCustom('name="area" data-area-picker', PRACTICE_AREAS[0].id, practiceAreaOptions(), t('form.customAreaPh'));
  const stageField = selectWithCustom('name="stage"', STAGES[0], stageOptions(), t('form.customStagePh'));
  const waitField = selectWithCustom('name="waiting"', 'none', waitingOptions(), t('form.customWaitPh'));
  const statusOpts = Object.keys(STATUS).map(k => `<option value="${k}" ${k === 'green' ? 'selected' : ''}>${STATUS[k].dot} ${esc(statusName(k))}</option>`).join('');
  const ownerOpts = (u.admin ? USERS : [u]).map(x => `<option value="${x.id}" ${x.id===u.id?'selected':''}>${esc(x.name)}</option>`).join('');
  const nextOwnerOpts = USERS.map(x => `<option value="${x.id}" ${x.id===u.id?'selected':''}>${esc(x.name)}</option>`).join('');
  return `
  <div class="modal-mask" data-mask="1">
    <div class="modal" data-stop="1">
      <form data-action="create-matter">
        <div class="modal-head"><h2>${esc(t('modal.new.title'))}</h2></div>
        <div class="modal-body">
          <div class="grid-2">
            <div class="field"><label class="req">${esc(t('detail.client'))}</label><input name="client" required></div>
            <div class="field"><label class="req">${esc(t('detail.title'))}</label><input name="title" required></div>
            <div class="field"><label class="req">${esc(t('detail.area'))}</label>${areaField}</div>
            <div class="field"><label class="req">${esc(t('detail.stage'))}</label>${stageField}</div>
            <div class="field"><label class="req">${esc(t('detail.status'))}</label><select name="status">${statusOpts}</select></div>
            <div class="field"><label class="req">${esc(t('detail.owner'))}</label><select name="owner">${ownerOpts}</select></div>
            <div class="field"><label>${esc(t('detail.nextOwner'))}</label><select name="nextOwner">${nextOwnerOpts}</select></div>
            <div class="field"><label class="req">${esc(t('detail.due'))}</label><input type="date" name="due" value="${esc(state.modal.due||'')}" required></div>
            <div class="field"><label>${esc(t('detail.waiting'))}</label>${waitField}</div>
          </div>
          <div class="field"><label class="req">${esc(t('detail.next'))}</label><input name="next" required></div>
          <div class="field"><label>${esc(t('detail.reason'))}</label>
            <input name="reason" autocomplete="off" value="" placeholder="${esc(t('form.reasonPh'))}"></div>
          <div class="field"><label>${esc(t('detail.members'))}</label><div class="member-list">${USERS.map(x => `<label class="member-item"><input type="checkbox" name="team" value="${x.id}" ${x.id===u.id?'checked':''}><span class="nm">${esc(x.name)}</span><span class="rl">${esc(t(x.roleKey))}</span></label>`).join('')}</div><div class="hint">${esc(t('modal.new.membersHint'))}</div></div>
        </div>
        <div class="modal-foot">
          <button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
          <button class="btn btn-primary" type="submit">${esc(t('modal.new.submit'))}</button>
        </div>
      </form>
    </div>
  </div>`;
}

/* ------------------------------ 渲染 ------------------------------ */

function render() {
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const route = (location.hash || '#/').slice(1);
  const u = currentUser();

  if (!u) {
    app.innerHTML = viewLogin();
    modalRoot.innerHTML = '';
    return;
  }

  let content;
  if (route === '' || route === '/') content = viewDashboard();
  else if (route.startsWith('/matters/')) content = viewMatter(route.split('/')[2]);
  else if (route.startsWith('/matters')) content = viewMatters();
  else if (route.startsWith('/weekly')) content = viewWeekly();
  else if (route.startsWith('/calendar')) content = viewCalendar();
  else if (route.startsWith('/inbox')) content = viewInbox();
  else if (route.startsWith('/settings')) content = viewSettings();
  else if (route.startsWith('/trash')) content = viewTrash();
  else content = viewDashboard();

  app.innerHTML = shell(route, content);
  requestAnimationFrame(updateNavScrollControls);
  modalRoot.innerHTML = renderModal();
  if (state.modal && state.modal.type === 'file') {
    const first = document.getElementById('file-form');
    if (first && first.fileBlob) first.fileBlob.focus();
  }
}

/* ------------------------------ 事件 ------------------------------ */

function readForm(form) {
  const data = {};
  new FormData(form).forEach((v, k) => {
    if (k === 'team') { (data.team = data.team || []).push(v); }
    else data[k] = v;
  });
  return data;
}

/* 完成当前步骤：把这一步记进历史，然后把事项推进到下一步。
   data 里是「完成之后」的新状态，字段与需求单一致。 */
function completeStep(id, data) {
  const m = matterById(id);
  const u = currentUser();
  if (!m || !u) return false;
  if (!String(data.next || '').trim()) { toast(t('toast.needNext')); return false; }
  if (!data.due) { toast(t('toast.needDue')); return false; }
  if (!data.status || !STATUS[data.status]) { toast(t('toast.needStatus')); return false; }
  if ((data.status === 'red' || data.status === 'yellow') && !String(data.reason || '').trim()) {
    toast(t('toast.needReason')); return false;
  }

  const done = {
    text: m.next,
    owner: m.nextOwner,
    due: m.due,
    waiting: m.waiting,
    at: Date.now(),
    by: u.id,
    // 记下完成前的状态，撤销时才能原样退回去
    prev: { stage: m.stage, status: m.status, reason: m.reason, team: (m.team || []).slice() },
  };
  if (data.stepNote && String(data.stepNote).trim()) done.note = String(data.stepNote).trim();
  m.steps = m.steps || [];
  m.steps.push(done);

  const beforeStage = m.stage;
  const stage = resolveCustom(data.stage, data.stageCustom);
  const waiting = resolveCustom(data.waiting, data.waitingCustom);
  if (stage === null || waiting === null) { toast(t('toast.needCustom')); return false; }
  m.stage = stage || m.stage;
  m.status = data.status;
  m.due = data.due;
  m.waiting = waiting || 'none';
  m.next = String(data.next).trim();
  m.nextOwner = USER[data.nextOwner] ? data.nextOwner : m.owner;
  if (String(data.reason || '') !== L(m.reason)) m.reason = data.reason || '';

  addLogKey(id, u.id, 'detail.entry.stepDone', { text: done.text, owner: (USER[done.owner] || {}).name || done.owner });
  if (beforeStage !== m.stage) addLogKey(id, u.id, 'detail.entry.stageMove', { from: { __stage: beforeStage }, to: { __stage: m.stage } });
  addLogKey(id, u.id, 'detail.entry.advanced', {
    status: { __t: 'status.' + m.status, prefix: STATUS[m.status].dot + ' ' },
    next: m.next,
    owner: (USER[m.nextOwner] || {}).name || m.nextOwner,
    due: { __date: m.due },
  });
  commit();
  toast(t('toast.stepDone'));
  return true;
}

/* 撤销到上一步：删掉最近一条完成记录，把事项退回那一步 */
function undoStep(id) {
  const m = matterById(id);
  const u = currentUser();
  if (!m || !u) return false;
  const s = lastStep(m);
  if (!s) { toast(t('toast.noSteps')); return false; }
  if (!canUndoStep(u, m)) return false;

  m.next = s.text;
  m.nextOwner = s.owner;
  m.due = s.due;
  m.waiting = s.waiting || 'none';
  if (s.prev) {
    if (s.prev.stage) m.stage = s.prev.stage;
    if (s.prev.status) m.status = s.prev.status;
    m.reason = s.prev.reason === undefined ? m.reason : s.prev.reason;
    if (s.prev.team) m.team = s.prev.team.slice();
  }
  m.steps = (m.steps || []).filter(x => x !== s);
  addLogKey(id, u.id, 'detail.entry.stepUndo', { text: s.text });
  commit();
  toast(t('toast.undoDone', { text: L(s.text) }));
  return true;
}

function createMatter(data) {
  if (!data.allowImportErrors && (!data.client || !data.title || !data.next || !data.due)) { toast(t('toast.needClient')); return false; }
  if (!data.allowImportErrors && (data.status === 'red' || data.status === 'yellow') && !String(data.reason || '').trim()) { toast(t('toast.needReason')); return false; }
  const stage = resolveCustom(data.stage, data.stageCustom);
  const waiting = resolveCustom(data.waiting, data.waitingCustom);
  const area = resolveCustom(data.area, data.areaCustom);
  if (area === null || stage === null || waiting === null) { toast(t('toast.needCustom')); return false; }
  seq += 1;
  const id = seq;
  const creator = currentUser();
  const owner = USER[data.owner] ? data.owner : creator.id;
  const team = Array.isArray(data.team) ? data.team.filter(id => USER[id]) : [creator.id];
  if (!team.includes(owner)) team.push(owner);
  const m = {
    id, no: `2026-${String(id).padStart(3, '0')}`,
    client: data.client, title: data.title, area,
    owner, team,
    stage: stage || STAGES[0], status: data.status, reason: data.reason || '',
    next: data.next, nextOwner: USER[data.nextOwner] ? data.nextOwner : owner,
    due: data.due, waiting: waiting || 'none',
    importError: !!data.importError,
    files: [], lastContact: iso(today()), notes: '',
  };
  if (!m.team.includes(m.owner)) m.team.push(m.owner);
  matters.push(m);
  addLogKey(id, currentUser().id, 'detail.entry.new', { no: m.no, area: areaName(m.area) });
  commit();
  toast(t('toast.created', { no: m.no }));
  return m;
}

function saveMatterFromDom(id) {
  const box = document.querySelector(`[data-matter="${id}"]`);
  const m = matterById(id);
  if (!box || !m) return;
  if (!currentUser().admin && currentUser().id !== m.owner) { toast(t('toast.onlyOwnerEdit', { name:(USER[m.owner]||{}).name||m.owner })); return; }
  const get = f => { const el = box.querySelector(`[data-field="${f}"]`); return el ? el.value : undefined; };
  const changes = [];
  const before = { ...m };
  const beforeSnapshot = matterEditSnapshot(m);
  // 表单里显示的是当前语言的文字；如果用户没改，就保留原来的多语言数据
  const shown = {
    client: L(m.client), title: L(m.title), next: L(m.next), reason: L(m.reason), notes: L(m.notes),
    area: m.area, stage: m.stage, owner: m.owner, nextOwner: m.nextOwner, status: m.status,
    due: m.due, waiting: m.waiting, lastContact: m.lastContact,
  };

  // 选了「自定义…」就必须填内容，先校验再改数据
  if ((get('area') === '__custom__' && !String(get('areaCustom') || '').trim()) ||
      (get('stage') === '__custom__' && !String(get('stageCustom') || '').trim()) ||
      (get('waiting') === '__custom__' && !String(get('waitingCustom') || '').trim())) {
    toast(t('toast.needCustom')); return;
  }
  ['client', 'title', 'area', 'stage', 'owner', 'nextOwner', 'status', 'due', 'waiting', 'lastContact', 'next', 'reason', 'notes'].forEach(f => {
    let v;
    if (f === 'area' || f === 'stage' || f === 'waiting') {
      v = resolveCustom(get(f), get(f + 'Custom'));
      if (v === null) return;
    } else {
      v = get(f);
    }
    if (v === undefined || v === shown[f]) return;
    if (v !== m[f]) { m[f] = v; changes.push(f); }
  });
  const team = [...box.querySelectorAll('[data-field="team"]:checked')].map(x => x.value).filter(id => USER[id]);
  if (!team.includes(m.owner)) team.push(m.owner);
  if (team.slice().sort().join() !== (m.team || []).slice().sort().join()) { m.team = team; changes.push('team'); }

  if (!m.client || !m.title || !m.next || !m.due) { toast(t('toast.needClient')); return; }
  if ((m.status === 'red' || m.status === 'yellow') && !String(L(m.reason) || '').trim()) { toast(t('toast.needReason')); return; }
  if (m.importError) { m.importError = false; changes.push('importError'); }

  if (before.status !== m.status) addLogKey(id, currentUser().id, 'detail.entry.status', { status: { __t: 'status.' + m.status, prefix: STATUS[m.status].dot + ' ' } });
  if (before.next !== m.next) addLogKey(id, currentUser().id, 'detail.entry.next', { next: L(m.next) });
  if (before.due !== m.due) addLogKey(id, currentUser().id, 'detail.entry.due', { date: { __date: m.due }, rel: { __rel: m.due } });
  if (before.owner !== m.owner) addLogKey(id, currentUser().id, 'detail.entry.owner', { name: USER[m.owner].name });
  if (before.waiting !== m.waiting) addLogKey(id, currentUser().id, 'detail.entry.waiting', { w: { __t: 'wait.' + m.waiting } });
  if (changes.length) {
    const editLog = addLogKey(id, currentUser().id, 'detail.entry.edited', {});
    editLog.undo = { kind: 'matter-edit', before: beforeSnapshot };
  }
  commit();
  toast(t('toast.saved'));
  render();
}

function exportCSV(onlyId) {
  const u = currentUser();
  const list = onlyId ? [matterById(onlyId)].filter(Boolean) : sorted(filterMatters());
  const head = ['csv.no', 'csv.client', 'csv.title', 'csv.area', 'csv.owner', 'csv.status', 'csv.stage',
    'csv.next', 'csv.nextOwner', 'csv.due', 'csv.waiting', 'csv.lastContact', 'csv.notes'].map(k => t(k));
  const rows = list.map(m => [
    m.no, L(m.client), L(m.title), areaName(m.area), USER[m.owner].name,
    statusName(m.status), stageLabel(m.stage), L(m.next), USER[m.nextOwner] ? USER[m.nextOwner].name : m.nextOwner,
    m.due, waitLabel(m.waiting), m.lastContact, L(m.notes),
  ]);
  if (onlyId) { head.push(t('csv.reason')); rows[0].push(L(matterById(onlyId).reason)); }
  const csv = '\ufeff' + [head, ...rows]
    .map(r => r.map(x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = onlyId ? `${matterById(onlyId).no}.csv` : t('csv.filename');
  a.click();
  URL.revokeObjectURL(a.href);
  toast(t('toast.exported'));
}

async function fetchBackupRows(table) {
  const res = await sbFetch('/' + table + '?select=*');
  if (!res.ok) throw new Error('backup-' + table + '-http-' + res.status);
  return res.json();
}
async function exportEncryptedBackup() {
  const names = ['matters','logs','meta','lcb_public_keys','lcb_private_keys','lcb_matter_keys'];
  const values = await Promise.all(names.map(fetchBackupRows));
  const tables = Object.fromEntries(names.map((name, i) => [name, values[i]]));
  const files = [];
  for (const matter of matters) for (const file of (matter.files || [])) {
    if (!file.storagePath || files.some(x => x.path === file.storagePath)) continue;
    const res = await storageFetch('/object/authenticated/' + ENCRYPTED_BUCKET + '/' + file.storagePath);
    if (!res.ok) throw new Error('backup-file-http-' + res.status);
    files.push({ path:file.storagePath, sealed:await res.json() });
  }
  const payload = { format:'lcb-encrypted-backup-v1', site:'personal', createdAt:new Date().toISOString(), tables, files };
  const blob = new Blob([JSON.stringify(payload)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'carol-encrypted-backup-' + new Date().toISOString().slice(0,10) + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  recordSecurityEvent('backup_exported', { files:files.length });
  toast(t('toast.backupDone'));
}
async function upsertBackupRows(table, rows) {
  if (!rows || !rows.length) return;
  const res = await sbFetch('/' + table, { method:'POST', headers:UPSERT, body:JSON.stringify(rows) });
  if (!res.ok) throw new Error('restore-' + table + '-http-' + res.status);
}
async function restoreEncryptedBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data || data.format !== 'lcb-encrypted-backup-v1' || data.site !== 'personal' || !data.tables) throw new Error('invalid-backup');
  await upsertBackupRows('lcb_public_keys', data.tables.lcb_public_keys);
  await upsertBackupRows('lcb_private_keys', data.tables.lcb_private_keys);
  await upsertBackupRows('matters', data.tables.matters);
  await upsertBackupRows('logs', data.tables.logs);
  await upsertBackupRows('meta', data.tables.meta);
  if ((data.tables.lcb_matter_keys || []).length) {
    const res = await sbFetch('/rpc/lcb_store_wrapped_keys', { method:'POST', body:JSON.stringify({ payload:data.tables.lcb_matter_keys }) });
    if (!res.ok) throw new Error('restore-keys-http-' + res.status);
  }
  for (const item of (data.files || [])) {
    const res = await storageFetch('/object/' + ENCRYPTED_BUCKET + '/' + item.path, {
      method:'POST', headers:{ 'Content-Type':'application/json', 'x-upsert':'true' }, body:JSON.stringify(item.sealed),
    });
    if (!res.ok) throw new Error('restore-file-http-' + res.status);
  }
  await pullRemote({ initial:true });
  sync.dirty=true; await pushRemote();
  recordSecurityEvent('backup_restored', { files:(data.files || []).length });
  toast(t('toast.restoreDone'));
}
async function showSecurityEvents() {
  const res=await sbFetch('/security_events?select=user_id,event_type,happened_at&order=happened_at.desc&limit=20');
  if(!res.ok) throw new Error('security-events-http-'+res.status);
  const rows=await res.json();
  state.modal={type:'notice',titleKey:'modal.securityEvents.title',body:rows.length?rows.map(x=>`<div style="padding:8px 0;border-bottom:1px solid var(--line)"><b>${esc(x.event_type)}</b><br><span class="small muted">${esc(x.user_id)} · ${esc(fmtStamp(x.happened_at))}</span></div>`).join(''):esc(t('modal.securityEvents.empty'))};
  render();
}

document.addEventListener('click', async ev => {
  // 点遮罩空白处关闭弹窗
  const mask = ev.target.closest('[data-mask]');
  if (mask && ev.target === mask) {
    state.modal = null; render(); return;
  }
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const action = el.getAttribute('data-action');

  switch (action) {
    case 'nav-scroll-left':
    case 'nav-scroll-right': {
      const nav=el.closest('.nav-shell').querySelector('.nav');
      nav.scrollBy({left:action.endsWith('right')?280:-280,behavior:'smooth'}); setTimeout(updateNavScrollControls,250); break;
    }
    case 'logout':
      state.modal = {
        type: 'confirm',
        titleKey: 'modal.logout.title',
        body: t('modal.logout.body'),
        confirmKey: 'modal.logout.confirm',
        action: 'confirm-logout',
      };
      render();
      break;
    case 'confirm-logout':
      finishLogout();
      toast(t('toast.loggedOut'));
      break;
    case 'logout-all-devices':
      state.modal={type:'confirm',titleKey:'modal.logoutAll.title',body:t('modal.logoutAll.body'),confirmKey:'modal.logoutAll.confirm',action:'confirm-logout-all-devices',danger:true}; render();
      break;
    case 'revoke-device':
      state.modal={type:'confirm',titleKey:'modal.deviceRevoke.title',body:t('modal.deviceRevoke.body'),confirmKey:'modal.deviceRevoke.confirm',action:'confirm-revoke-device',sessionId:el.getAttribute('data-session-id'),danger:true}; render();
      break;
    case 'confirm-revoke-device': {
      const id=state.modal && state.modal.sessionId; state.modal=null;
      try { if(id) await revokeDevice(id); } catch(e) { showSystemError(e); }
      break;
    }
    case 'confirm-logout-all-devices':
      try { await signOutEverywhere(); toast(t('toast.loggedOut')); } catch (e) { showSystemError(e); }
      break;
    case 'export-encrypted-backup':
      try { await exportEncryptedBackup(); } catch (e) { showSystemError(e); }
      break;
    case 'view-security-events':
      try { await showSecurityEvents(); } catch(e) { showSystemError(e); }
      break;
    case 'restore-encrypted-backup': {
      const input = document.createElement('input'); input.type='file'; input.accept='.json,application/json';
      input.onchange = () => { if (input.files[0]) { state.modal={type:'confirm',titleKey:'modal.backupRestore.title',body:t('modal.backupRestore.body'),confirmKey:'modal.backupRestore.confirm',action:'confirm-restore-encrypted-backup',backupFile:input.files[0],danger:true}; render(); } };
      input.click();
      break;
    }
    case 'confirm-restore-encrypted-backup': {
      const file=state.modal && state.modal.backupFile; state.modal=null;
      try { if (file) await restoreEncryptedBackup(file); } catch (e) { showSystemError(e); }
      break;
    }
    case 'set-lang':
      setLang(el.getAttribute('data-lang'));
      break;
    case 'sync-now':
      resetSyncRetries();
      sync.status = 'loading';
      render();
      if (sync.dirty) { pushRemote(); toast(t('sync.loading')); }
      else { toast(t('sync.loading')); pullRemote(); }
      break;
    case 'switch-prompt': {
      const u = currentUser();
      const idx = USERS.findIndex(x => x.id === u.id);
      const next = USERS[(idx + 1) % USERS.length];
      session = { userId: next.id }; save(KEY.session, session);
      toast(t('toast.switched', { name: next.name }));
      if (location.hash.startsWith('#/matters/')) go('#/'); else render();
      render();
      break;
    }
    case 'new-matter':
      state.modal = { type: 'new-matter' }; render(); break;
    case 'calendar-prev': state.calendarOffset-=1; render(); break;
    case 'calendar-next': state.calendarOffset+=1; render(); break;
    case 'calendar-today': state.calendarOffset=0; render(); break;
    case 'calendar-date': state.modal={type:'calendar-choice',date:el.getAttribute('data-date')}; render(); break;
    case 'calendar-new-matter': state.modal={type:'new-matter',due:el.getAttribute('data-date')}; render(); break;
    case 'calendar-new-reminder': state.modal={type:'schedule-reminder',date:el.getAttribute('data-date')}; render(); break;
    case 'open-schedule': state.modal={type:'schedule-details',id:el.getAttribute('data-id')}; render(); break;
    case 'delete-schedule': state.modal={type:'confirm',titleKey:'calendar.reminderDeleteTitle',body:t('calendar.reminderMessage'),confirmKey:'calendar.reminderDelete',action:'confirm-delete-schedule',id:el.getAttribute('data-id'),danger:true}; render(); break;
    case 'confirm-delete-schedule': {
      const id=el.getAttribute('data-id'), item=matterById(id);
      if(item && item.kind==='schedule'){
        matters=matters.filter(m=>String(m.id)!==String(id)); logs=logs.filter(l=>String(l.matterId)!==String(id));
        sync.purged.add(String(id)); commit();
      }
      state.modal=null; render(); break;
    }
    case 'import-matters':
      state.modal = { type: 'import' }; render(); break;
    case 'download-import-sample': {
      const heads = ['客户','事项名称','业务类型','当前阶段','状态','截止日期','等待谁','现在要做什么'];
      const csv = '\ufeff' + heads.map(x => `"${x}"`).join(',') + '\n';
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '个人事项导入示例.csv'; a.click(); URL.revokeObjectURL(a.href);
      state.modal = null; render();
      break;
    }
    case 'close-modal':
      state.modal = null; render(); break;
    case 'open-matter':
      go(`#/matters/${el.getAttribute('data-id')}`); break;
    case 'chat-matter': {
      const m = matterById(el.getAttribute('data-id'));
      if (m && canSee(currentUser(), m)) { state.modal = { type: 'chat', matterId: m.id }; render(); }
      break;
    }
    case 'mark-read':
      if (markNotificationRead(el.getAttribute('data-id'), currentUser().id)) {
        render();
        toast(t('toast.markedRead'));
        // 已读回执要尽快到达发送者；不要依赖浏览器稍后执行的后台计时器。
        pushRemote();
      }
      break;
    case 'delete-notification':
      state.modal = {
        type: 'confirm', titleKey: 'modal.deleteNotification.title', body: t('modal.deleteNotification.body'),
        confirmKey: 'modal.deleteNotification.confirm', action: 'confirm-delete-notification', id: el.getAttribute('data-id'),
        danger: true,
      };
      render();
      break;
    case 'confirm-delete-notification':
      if (deleteNotificationForUser(el.getAttribute('data-id'), currentUser().id)) {
        state.modal = null;
        render();
        toast(t('toast.notificationDeleted'));
      }
      break;
    case 'enable-system-notifications':
      enableSystemNotifications();
      break;
    case 'disable-system-notifications':
      state.modal = {
        type: 'confirm', titleKey: 'modal.disableSystem.title', body: t('modal.disableSystem.body'),
        confirmKey: 'modal.disableSystem.confirm', action: 'confirm-disable-system-notifications',
      };
      render();
      break;
    case 'confirm-disable-system-notifications':
      systemNotice.enabled = false;
      save(KEY.systemEnabled, false);
      state.modal = null;
      render();
      toast(t('toast.systemDisabled'));
      break;
    case 'save-matter':
      saveMatterFromDom(el.getAttribute('data-id')); break;
    case 'undo-matter-edit': {
      const m = matterById(el.getAttribute('data-id'));
      const edit = m && lastMatterEditLog(m);
      if (!m || !edit) { toast(t('toast.noEditToUndo')); break; }
      if (!canUndoMatterEdit(currentUser(), edit)) {
        state.modal = {
          type: 'notice', titleKey: 'modal.denyUndoEdit.title',
          body: esc(t('modal.denyUndoEdit.body', { name: (USER[edit.by] || {}).name || edit.by })),
        };
      } else {
        state.modal = {
          type: 'confirm', titleKey: 'modal.undoEdit.title',
          body: t('modal.undoEdit.body', { name: (USER[edit.by] || {}).name || edit.by, when: fmtStamp(edit.at) }),
          confirmKey: 'modal.undoEdit.confirm', action: 'confirm-undo-matter-edit', id: m.id,
        };
      }
      render();
      break;
    }
    case 'confirm-undo-matter-edit':
      if (undoMatterEdit(el.getAttribute('data-id'))) { state.modal = null; render(); }
      break;
    case 'add-file': {
      state.modal = { type: 'file', matterId: el.getAttribute('data-id') };
      render();
      break;
    }
    case 'download-encrypted-file': {
      const m = matterById(el.getAttribute('data-id'));
      const f = m && (m.files || [])[Number(el.getAttribute('data-idx'))];
      if (!m || !f || !f.storagePath) break;
      try {
        const res = await storageFetch('/object/authenticated/carol-encrypted-files/' + f.storagePath);
        if (!res.ok) throw new Error('download-http-' + res.status);
        const clear = await LCBCrypto.decryptFile(m.id, JSON.parse(await res.text()), sbFetch);
        const blob = new Blob([clear], { type:f.type || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = f.name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast(t('toast.fileDownloaded'));
      } catch (e) { if (!authExpiredError(e)) showSystemError(e); }
      break;
    }
    case 'remove-file': {
      const id = el.getAttribute('data-id'); const i = Number(el.getAttribute('data-idx'));
      const m = matterById(id);
      const f = m.files[i];
      if (f && f.storagePath) {
        const removed = await storageFetch('/object/carol-encrypted-files/' + f.storagePath, { method:'DELETE' });
        if (!removed.ok) { showSystemError(new Error('file-delete-http-' + removed.status)); break; }
      }
      m.files.splice(i, 1);
      addLogKey(id, currentUser().id, 'detail.entry.fileRemove', { name: f.name }, {
        key: 'inbox.fileRemove', vars: noticeVars(m, currentUser().id, { name: f.name }),
      });
      commit(); render();
      break;
    }
    case 'clear-filters':
      state.filters = { q: '', area: '', owner: '', status: '', waiting: '' }; render(); break;
    case 'export-csv':
      state.modal = {
        type: 'confirm',
        titleKey: 'modal.export.title',
        body: t('modal.export.body'),
        confirmKey: 'modal.export.confirm',
        action: 'confirm-export',
        id: el.getAttribute('data-id'),
      };
      render();
      break;
    case 'confirm-export': {
      const id = el.getAttribute('data-id');
      state.modal = null;
      render();
      exportCSV(id);
      break;
    }
    case 'print':
      window.print(); break;
    case 'toggle-bulk-matter': {
      const id = String(el.getAttribute('data-id'));
      const m = matterById(id);
      if (!m || !canSee(currentUser(), m)) break;
      if (el.checked) state.bulkSelected.add(id); else state.bulkSelected.delete(id);
      render();
      break;
    }
    case 'toggle-all-bulk-matters': {
      const selectable = sorted(filterMatters());
      const selectAll = selectable.length > 0 && !selectable.every(m => state.bulkSelected.has(String(m.id)));
      selectable.forEach(m => selectAll ? state.bulkSelected.add(String(m.id)) : state.bulkSelected.delete(String(m.id)));
      render();
      break;
    }
    case 'bulk-delete-matters': {
      const ids = [...state.bulkSelected].filter(id => {
        const m = matterById(id);
        return m && !m.deletedAt && canSee(currentUser(), m);
      });
      if (!ids.length) break;
      state.modal = {
        type: 'confirm', titleKey: 'modal.bulkDelete.title', body: t('modal.bulkDelete.body', { n: ids.length }),
        confirmText: t('modal.bulkDelete.confirm', { n: ids.length }), action: 'confirm-bulk-delete-matters', ids, danger: true,
      };
      render();
      break;
    }
    case 'confirm-bulk-delete-matters': {
      const ids = (state.modal && state.modal.ids || []).filter(id => {
        const m = matterById(id);
        return m && !m.deletedAt && (currentUser().admin || m.owner === currentUser().id);
      });
      ids.forEach(id => {
        const m = matterById(id);
        m.deletedAt = Date.now();
        addLogKey(id, currentUser().id, 'detail.entry.deleted', {}, {
          key: 'inbox.deleted', vars: noticeVars(m, currentUser().id),
        });
        state.bulkSelected.delete(String(id));
      });
      if (ids.length) commit();
      state.modal = null;
      render();
      if (ids.length) toast(t('toast.bulkDeleted', { n: ids.length }));
      break;
    }
    case 'delete-matter': {
      const id = el.getAttribute('data-id');
      const m = matterById(id);
      if (!m) break;
      if (!canSee(currentUser(), m)) break;
      if (currentUser().id !== m.owner && !isAdmin()) {
        state.modal = {
          type: 'notice',
          titleKey: 'modal.denyDelete.title',
          body: t('modal.denyDelete.body', { name: esc((USER[m.owner] || {}).name || m.owner) }),
        };
        render();
        break;
      }
      const adminNote = (isAdmin() && currentUser().id !== m.owner)
        ? t('modal.delete.adminNote', { name: (USER[m.owner] || {}).name || m.owner }) : '';
      state.modal = {
        type: 'confirm',
        titleKey: 'modal.delete.title',
        body: t('modal.delete.body', { no: m.no, title: L(m.title) }) + adminNote,
        confirmKey: 'modal.delete.confirm',
        danger: true,
        action: 'confirm-delete-matter',
        id: m.id,
      };
      render();
      break;
    }
    case 'confirm-delete-matter': {
      const id = el.getAttribute('data-id');
      const m = matterById(id);
      if (!m) break;
      if (currentUser().id !== m.owner && !isAdmin()) { toast(t('toast.onlyOwnerDelete', { name: (USER[m.owner] || {}).name || m.owner })); break; }
      m.deletedAt = Date.now();
      addLogKey(id, currentUser().id, 'detail.entry.deleted', {}, {
        key: 'inbox.deleted', vars: noticeVars(m, currentUser().id),
      });
      commit();
      state.modal = null;
      go('#/matters');
      render();
      toast(t('toast.deleted', { no: m.no }));
      break;
    }
    case 'complete-step': {
      const id = el.getAttribute('data-id');
      const m = matterById(id);
      if (!m) break;
      if (!canSee(currentUser(), m)) break;
      if (!isStepOwner(currentUser(), m) && !isAdmin()) {
        state.modal = {
          type: 'notice',
          titleKey: 'modal.denyStep.title',
          body: t('modal.denyStep.body', {
            name: esc((USER[m.nextOwner] || {}).name || m.nextOwner),
            next: esc(L(m.next)),
          }),
        };
        render();
        break;
      }
      state.modal = { type: 'complete-step', matterId: m.id };
      render();
      break;
    }
    case 'undo-step': {
      const id = el.getAttribute('data-id');
      const m = matterById(id);
      if (!m || !canSee(currentUser(), m)) break;
      const s = lastStep(m);
      if (!s) { toast(t('toast.noSteps')); break; }
      if (!canUndoStep(currentUser(), m)) {
        state.modal = {
          type: 'notice',
          titleKey: 'modal.denyUndo.title',
          body: t('modal.denyUndo.body', { name: esc((USER[s.by] || {}).name || s.by) }),
        };
        render();
        break;
      }
      state.modal = {
        type: 'confirm',
        titleKey: 'modal.undo.title',
        body: t('modal.undo.body', {
          text: L(s.text),
          owner: (USER[s.owner] || {}).name || s.owner,
          due: fmtDate(s.due),
        }),
        confirmKey: 'modal.undo.confirm',
        action: 'confirm-undo-step',
        id: m.id,
      };
      render();
      break;
    }
    case 'confirm-undo-step': {
      if (undoStep(el.getAttribute('data-id'))) { state.modal = null; render(); }
      break;
    }
    case 'restore-matter': {
      const id = el.getAttribute('data-id');
      const m = matterById(id);
      if (!m) break;
      if (currentUser().id !== m.owner) { toast(t('toast.adminRestore', { name: (USER[m.owner] || {}).name || m.owner })); break; }
      m.deletedAt = null;
      state.trashSelected.delete(String(id));
      addLogKey(id, currentUser().id, 'detail.entry.restored', {}, {
        key: 'inbox.restored', vars: noticeVars(m, currentUser().id),
      });
      commit();
      go(`#/matters/${m.id}`);
      render();
      toast(t('toast.restored', { no: m.no }));
      break;
    }
    case 'purge-matter': {
      const id = el.getAttribute('data-id');
      const m = matterById(id);
      if (!m) break;
      if (currentUser().id !== m.owner) { toast(t('toast.adminPurge', { name: (USER[m.owner] || {}).name || m.owner })); break; }
      state.modal = {
        type: 'confirm',
        titleKey: 'modal.purge.title',
        body: t('modal.purge.body', { no: m.no, title: L(m.title) }),
        confirmKey: 'modal.purge.confirm',
        danger: true,
        action: 'confirm-purge-matter',
        id: m.id,
      };
      render();
      break;
    }
    case 'toggle-trash-matter': {
      const id = String(el.getAttribute('data-id'));
      const m = matterById(id);
      if (!m || !m.deletedAt) break;
      if (el.checked) state.trashSelected.add(id); else state.trashSelected.delete(id);
      render();
      break;
    }
    case 'toggle-all-trash': {
      const selectable = trashedMatters();
      const selectAll = selectable.length > 0 && !selectable.every(m => state.trashSelected.has(String(m.id)));
      selectable.forEach(m => selectAll ? state.trashSelected.add(String(m.id)) : state.trashSelected.delete(String(m.id)));
      render();
      break;
    }
    case 'bulk-purge-trash': {
      const ids = [...state.trashSelected].filter(id => {
        const m = matterById(id);
        return m && m.deletedAt;
      });
      if (!ids.length) break;
      state.modal = {
        type: 'confirm', titleKey: 'modal.bulkPurge.title', body: t('modal.bulkPurge.body', { n: ids.length }),
        confirmText: t('modal.bulkPurge.confirm', { n: ids.length }), action: 'confirm-bulk-purge-trash', ids, danger: true,
      };
      render();
      break;
    }
    case 'confirm-bulk-purge-trash': {
      const ids = (state.modal && state.modal.ids || []).filter(id => {
        const m = matterById(id);
        return m && m.deletedAt;
      });
      try { await Promise.all(ids.map(id => deleteEncryptedFiles(matterById(id)))); }
      catch (e) { showSystemError(e); break; }
      ids.forEach(id => { sync.purged.add(String(id)); state.trashSelected.delete(String(id)); });
      if (ids.length) {
        const idSet = new Set(ids.map(String));
        matters = matters.filter(m => !idSet.has(String(m.id)));
        logs = logs.filter(l => !idSet.has(String(l.matterId)));
        commit();
      }
      state.modal = null;
      render();
      if (ids.length) toast(t('toast.bulkPurged', { n: ids.length }));
      break;
    }
    case 'confirm-purge-matter': {
      const id = el.getAttribute('data-id');
      const m = matterById(id);
      if (!m) break;
      if (currentUser().id !== m.owner) { toast(t('toast.adminPurge', { name: (USER[m.owner] || {}).name || m.owner })); break; }
      try { await deleteEncryptedFiles(m); } catch (e) { showSystemError(e); break; }
      sync.purged.add(String(id));
      state.trashSelected.delete(String(id));
      matters = matters.filter(x => String(x.id) !== String(id));
      logs = logs.filter(l => String(l.matterId) !== String(id));
      commit();
      state.modal = null;
      render();
      toast(t('toast.purged'));
      break;
    }
  }
});

document.addEventListener('change', ev => {
  // 业务类型 / 阶段 / 等待谁 选了「自定义…」就露出输入框
  const custom = ev.target.closest('[data-custom-select]');
  if (custom) {
    const box = custom.parentElement;
    const input = box ? box.querySelector('.custom-input') : null;
    if (input) {
      const on = custom.value === '__custom__';
      input.style.display = on ? '' : 'none';
      if (on) input.focus();
    }
    if (!ev.target.closest('[data-area-picker]')) return;
  }
  const el = ev.target.closest('[data-filter]');
  if (!el) return;
  state.filters[el.getAttribute('data-filter')] = el.value;
  const tbody = document.getElementById('matter-rows');
  const empty = document.getElementById('matter-empty');
  if (tbody) {
    tbody.innerHTML = matterRowsHTML();
    if (empty) empty.style.display = filterMatters().length ? 'none' : '';
  }
});

document.addEventListener('input', ev => {
  const el = ev.target.closest('[data-filter="q"]');
  if (!el) return;
  state.filters.q = el.value;
  const tbody = document.getElementById('matter-rows');
  const empty = document.getElementById('matter-empty');
  if (tbody) {
    tbody.innerHTML = matterRowsHTML();
    if (empty) empty.style.display = filterMatters().length ? 'none' : '';
  }
});

document.addEventListener('submit', async ev => {
  const form = ev.target.closest('form[data-action]');
  if (!form) return;
  ev.preventDefault();
  const action = form.getAttribute('data-action');
  if (action === 'login') {
    const email = (form.email.value || '').trim().toLowerCase();
    const pass = form.password.value || '';
    const user = USERS.find(u => u.email.toLowerCase() === email);
    if (!user) { state.loginError=t('login.errNoUser'); render(); return; }
    if (Date.now() < loginBlockedUntil) { state.loginError=t('login.errCooldown'); render(); return; }
    try { await signIn(email, pass, user.id); loginFailures=0; loginBlockedUntil=0; }
    catch (e) {
      loginFailures += 1;
      if (loginFailures >= LOGIN_FAILURE_LIMIT) { loginBlockedUntil=Date.now()+LOGIN_COOLDOWN_MS; state.loginError=t('login.errCooldown'); }
      else state.loginError=t('login.errBadPass');
      render(); return;
    }
    state.loginError = '';
    clearPrivateCache();
    recordSecurityEvent('login_success', { client:'web' });
    session = { userId:user.id }; lastUserActivityAt = Date.now(); state.bulkSelected.clear(); state.trashSelected.clear();
    await loadDevices(true);
    go('#/'); render();
    await pullRemote({ initial:true });
    toast(t('toast.welcome', { name: user.name.split(' ')[0] }));
    return;
  }
  if (action === 'import-file') {
    const file = form.importFile && form.importFile.files && form.importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let rows;
        if (/\.xlsx?$/i.test(file.name)) {
          if (!globalThis.XLSX) throw new Error('Excel parser unavailable');
          const wb = XLSX.read(reader.result, { type: 'array' });
          rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        } else {
          const lines = String(reader.result).split(/\r?\n/).filter(Boolean);
          const parse = line => line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/)
            .map(x => x.replace(/^\"|\"$/g, '').replace(/\"\"/g, '\"').trim());
          const heads = parse(lines.shift() || '');
          rows = lines.map(line => Object.fromEntries(parse(line).map((v, i) => [heads[i], v])));
        }
        const aliases = {
          client:['客户','client'], title:['事项名称','事项','matter name','title'], area:['业务类型','practice area','area'],
          stage:['当前阶段','stage'], status:['状态','status'], due:['截止日期','截止','due date','due'],
          waiting:['等待谁','waiting for','waiting'], next:['现在要做什么','当前步骤','下一步','next step','next'],
        };
        const val = (row, keys) => { const key = Object.keys(row).find(k => keys.some(a => k.trim().toLowerCase() === a.toLowerCase())); return key ? row[key] : ''; };
        const headersPresent = Object.keys(rows[0] || {}).map(k => k.trim().toLowerCase());
        const required = ['client','title','next','due'];
        const validFormat = rows.length > 0 && required.every(name => aliases[name].some(alias => headersPresent.includes(alias.toLowerCase())));
        if (!validFormat) { state.modal = { type: 'import-invalid' }; render(); return; }
        let ok = 0;
        const importErrors = [];
        rows.forEach(row => {
          const d = {};
          Object.keys(aliases).forEach(k => d[k] = String(val(row, aliases[k]) ?? '').trim());
          const displayTitle = d.title || d.client || '—';
          const rawDue = String(val(row, aliases.due) ?? '').trim();
          d.due = normalizeImportedDate(rawDue);
          const importedStatus = normalizeImportedStatus(val(row, aliases.status));
          if (!d.client) importErrors.push({ title: displayTitle, fieldKey: 'detail.client' });
          if (!d.title) importErrors.push({ title: displayTitle, fieldKey: 'detail.title' });
          if (!d.next) importErrors.push({ title: displayTitle, fieldKey: 'detail.next' });
          if (!d.due) importErrors.push({ title: displayTitle, fieldKey: 'detail.due' });
          if (!importedStatus) importErrors.push({ title: displayTitle, fieldKey: 'detail.status' });
          d.importError = !d.client || !d.title || !d.next || !d.due || !importedStatus;
          d.status = importedStatus || 'green';
          d.area = d.area || 'other'; d.stage = d.stage || STAGES[0]; d.waiting = d.waiting || 'none';
          d.client = d.client || '—'; d.title = d.title || '—'; d.next = d.next || '—'; d.due = d.due || rawDue || '—';
          d.allowImportErrors = true;
          if (createMatter(d)) ok++;
        });
        state.modal = importErrorModal(importErrors);
        render();
        toast(t('modal.import.result', { ok }));
      } catch (e) {
        state.modal = { type: 'notice', titleKey: 'modal.import.title', body: esc(String(e.message || e)) };
        render();
      }
    };
    if (/\.xlsx?$/i.test(file.name)) reader.readAsArrayBuffer(file); else reader.readAsText(file);
    return;
  }
  if (action === 'create-matter') {
    const data = readForm(form);
    const m = createMatter(data);
    if (m) { state.modal = null; go(`#/matters/${m.id}`); render(); }
  }
  if (action === 'create-schedule') {
    const data=readForm(form),u=currentUser(),message=String(data.message||'').trim();
    if(!u || !data.date || !data.time || !message) return;
    matters.push({id:'schedule_'+crypto.randomUUID(),kind:'schedule',no:'',client:'',title:message,owner:u.id,team:[u.id],due:data.date,reminderTime:data.time,reminderText:message,reminderEnabled:data.enabled==='1',reminderSentAt:null,status:'green',deletedAt:null});
    commit(); state.modal=null; render(); toast(t('calendar.reminderSaved'));
  }
  if (action === 'confirm-add-file') {
    const id = form.getAttribute('data-id');
    const file = form.fileBlob && form.fileBlob.files && form.fileBlob.files[0];
    if (!file) { toast(t('toast.needFileName')); return; }
    if (file.size > 20 * 1024 * 1024) { toast(t('toast.fileTooLarge')); return; }
    const m = matterById(id);
    if (!m) return;
    try {
      const sealed = await LCBCrypto.encryptFile(id, await file.arrayBuffer(), sbFetch);
      const storagePath = encodeURIComponent(String(id)) + '/' + crypto.randomUUID() + '.lcb';
      const uploaded = await storageFetch('/object/carol-encrypted-files/' + storagePath, {
        method:'POST', headers:{ 'Content-Type':'application/json', 'x-upsert':'false' }, body:JSON.stringify(sealed),
      });
      if (!uploaded.ok) throw new Error('upload-http-' + uploaded.status);
      m.files = m.files || [];
      m.files.push({ name:file.name, type:file.type, size:file.size, storagePath, encrypted:'lcb-e2ee-v1' });
      addLogKey(id, currentUser().id, 'detail.entry.fileAdd', { name:file.name }, {
        key:'inbox.fileAdd', vars:noticeVars(m, currentUser().id, { name:file.name }),
      });
      commit(); state.modal = null; render(); toast(t('toast.fileAdded'));
    } catch (e) { if (!authExpiredError(e)) showSystemError(e); }
  }
  if (action === 'confirm-complete-step') {
    const ok = completeStep(form.getAttribute('data-id'), readForm(form));
    if (ok) { state.modal = null; render(); }
  }
  if (action === 'send-chat') {
    const id = form.getAttribute('data-id');
    const m = matterById(id);
    const message = String((form.message && form.message.value) || '').trim();
    const recipients = [...form.querySelectorAll('input[name="chatTo"]:checked')].map(x => x.value);
    if (!m || !canSee(currentUser(), m)) return;
    if (!message) { toast(t('toast.needMessage')); return; }
    if (!recipients.length) { toast(t('toast.needChatRecipient')); return; }
    addLogKey(id, currentUser().id, 'detail.entry.chat', { message }, {
      key: 'inbox.chat', vars: noticeVars(m, currentUser().id, { message }), to: recipients,
    });
    commit();
    state.modal = null;
    render();
    toast(t('toast.chatSent'));
  }
});

window.addEventListener('hashchange', render);
window.addEventListener('resize', updateNavScrollControls);
document.addEventListener('scroll', event => { if(event.target && event.target.matches && event.target.matches('.nav')) updateNavScrollControls(); }, true);
document.addEventListener('wheel', event => {
  const nav=event.target.closest && event.target.closest('.nav');
  if(!nav || nav.scrollWidth<=nav.clientWidth || Math.abs(event.deltaX)>Math.abs(event.deltaY)) return;
  event.preventDefault(); nav.scrollLeft+=event.deltaY; updateNavScrollControls();
}, {passive:false});
window.addEventListener('error', event => showSystemError(event.error || event.message));
window.addEventListener('unhandledrejection', event => { event.preventDefault(); showSystemError(event.reason); });

// 按 Esc 关掉弹窗
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && state.modal) { state.modal = null; render(); }
});

/* ------------------------------ 启动 ------------------------------ */

// 本地还没有缓存时，从空列表开始；联网后会拉取团队数据。
if (!REMOTE_ENABLED && !load(KEY.matters, null)) {
  save(KEY.matters, matters);
  save(KEY.logs, logs);
  save(KEY.seq, seq);
}
render();

if (REMOTE_ENABLED) {
  clearPrivateCache();
  setInterval(() => {
    if (authSession && !sync.dirty && sync.status !== 'error') pullRemote({ background: true });
  }, SYNC_EVERY_MS);
  setInterval(idleLogout, 60000);
  setInterval(deliverScheduleReminders, 30000);
  setInterval(async () => {
    if (!authSession) return;
    try { await loadDevices(true); if (location.hash.startsWith('#/settings')) render(); } catch (e) { /* next sync will retry */ }
  }, 5 * 60 * 1000);
  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll', 'input'].forEach(type => {
    document.addEventListener(type, () => { lastUserActivityAt = Date.now(); }, { passive:true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lastUserActivityAt = Date.now();
    if (!document.hidden && !sync.dirty) pullRemote({ background: true });
  });
  window.addEventListener('online', () => {
    resetSyncRetries();
    if (sync.dirty) pushRemote(); else pullRemote({ background: true });
  });
}
