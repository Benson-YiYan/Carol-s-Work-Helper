/* =========================================================================
   LCB Work Hub · 原型 v1
   -------------------------------------------------------------------------
   需求来源：《LCB 中墨法律协作团队 · Work Hub（网页版）需求单 v1》
   数据保存在浏览器本地（localStorage），因此可以离线试用、随点随存。
   将来接后端时，只需把 storage 层的读写换成接口调用，界面不用改。
   ========================================================================= */

/* ------------------------------ 常量 ------------------------------ */

const SITE_CONFIG = globalThis.LCBSiteConfig;
if (!SITE_CONFIG) throw new Error('Mother-son site configuration is missing.');
const KEY = SITE_CONFIG.storageKeys;

/* ------------------------------ 共享数据（Supabase） ------------------------------
   页面是纯静态的，所以要三个人共用一份数据，必须有个服务器那一侧。
   publishable key 设计成可以公开，配合数据库里的权限规则使用。 */
const SUPABASE = SITE_CONFIG.supabase;
const LOCAL_TEST_MODE = !!(globalThis.LCBRuntimeMode && LCBRuntimeMode.isLocalTestHost(location.hostname));
const REMOTE_ENABLED = !LOCAL_TEST_MODE && !!(SUPABASE.url && SUPABASE.key) && typeof fetch === 'function';
const SYNC_EVERY_MS = 10000;
const IDLE_LOGOUT_MS = 24 * 60 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_COOLDOWN_MS = 5 * 60 * 1000;
const ENCRYPTED_BUCKET = SITE_CONFIG.bucket;
const IMPORT_FILE_LIMIT = 20 * 1024 * 1024;
const IMPORT_ROW_LIMIT = 5000;
const matterServerUpdatedAt = new Map();
const matterPlainBaseline = new Map();
const sync = {
  status: REMOTE_ENABLED ? 'loading' : 'off',  // loading | ok | error | off
  lastAt: 0,
  error: '',
  dirty: false,        // 本地有还没推上去的改动
  busy: false,
  retryCount: 0,
  retryTimer: null,
  syncedLogs: new Set(),
  logStateBaseline: new Map(),
  purged: new Set(),   // 要彻底删掉的远端事项
};

/* ------------------------------ 界面语言 ------------------------------ */

const LANGS = [
  { id: 'zh', label: '中', name: '简体中文' },
  { id: 'en', label: 'EN', name: 'English' },
  { id: 'es', label: 'ES', name: 'Español' },
];
const LANG_INDEX = { zh: 0, en: 1, es: 2 };

const SECURITY_NOTICE = {
  zh: {
    title: '这个网站如何保护案件资料？',
    intro: '网站采用五道安全保护。下面不需要懂技术也能看明白：',
    hide: '3 天内不再显示', close: '关闭',
    sections: [
      ['一、资料先加密，再上传', [
        '事项、客户档案、聊天、日程和文件在离开你的电脑或手机前，就会先变成无法直接阅读的加密内容。',
        'Supabase 云端主要保存加密后的内容，而不是可以直接打开阅读的客户资料。',
      ]],
      ['二、具体使用什么加密方法', [
        'AES-256-GCM：用来加密事项正文、聊天记录和文件。这是成熟的高强度加密方法，每个事项都有一把不同的随机钥匙。',
        'RSA-OAEP 2048：把事项钥匙分别锁给获准成员。只有对应成员自己的解密钥匙才能打开。',
        'PBKDF2-SHA-256（31 万次运算）：用登录密码保护个人解密钥匙，并故意增加猜密码所需的时间。',
      ]],
      ['三、只有获准人员才能访问', [
        '网站不允许陌生人自行注册，也不允许匿名进入；没有正常登录，服务器就不会提供资料。',
        '普通成员只能查看自己负责或被加入成员列表的事项；Carol 可以查看全部事项。',
        '普通成员不能冒充负责人，也不能跳过权限限制修改成员名单。',
      ]],
      ['四、登录设备和操作受到控制', [
        '可以查看哪些设备登录过，并让某一台或全部设备退出；被移除的设备会失去访问权限。',
        '连续空闲 24 小时后自动退出，重要安全操作会留下记录。',
      ]],
      ['五、网站和服务器持续防护', [
        '服务器会再次检查每个人的权限，文件也不是公开存放，防止有人绕过网页直接读取或修改。',
        '网站只运行自己保存的程序，并会自动检查未登录访问是否仍然被封锁。',
        '没有任何网站能保证绝对不会被攻破。请使用强且不重复的密码，不要分享密码，并锁好自己的设备。',
      ]],
    ],
  },
  en: {
    title: 'How does this website protect matter data?',
    intro: 'The website uses five safeguards, explained in plain language:',
    hide: 'Do not show again for 3 days', close: 'Close',
    sections: [
      ['1. Data is encrypted before upload', [
        'Before matter details, client records, chats, schedules, or files leave your computer or phone, they are converted into encrypted data that cannot be read directly.',
        'Supabase stores the encrypted data, not readable client information.',
      ]],
      ['2. The encryption methods we use', [
        'AES-256-GCM encrypts matter details, chats, and files. It is a mature, strong encryption method, and every matter receives a different random key.',
        'RSA-OAEP 2048 locks each matter key separately for approved members. Only the matching personal decryption key can unlock it.',
        'PBKDF2-SHA-256 (310,000 rounds) uses the login password to protect the personal decryption key and deliberately makes password guessing slower.',
      ]],
      ['3. Access is limited to approved people', [
        'Strangers cannot create their own accounts or enter anonymously. Without a valid sign-in, the server does not provide the data.',
        'Ordinary members can only view matters they own or participate in. Carol can view all matters.',
        'Ordinary members cannot impersonate the owner or bypass access rules to change the member list.',
      ]],
      ['4. Devices and activity are controlled', [
        'You can review devices that have signed in and remove one device or every device. A removed device loses access.',
        'Sessions end after 24 hours of inactivity, and important security actions are recorded.',
      ]],
      ['5. The website and server are continuously protected', [
        'The server checks each person’s permissions again, and files are not stored publicly. This helps stop anyone from bypassing the website to read or change data.',
        'The website runs only code bundled with the site, and automated checks verify that access without signing in remains blocked.',
        'No website can promise to be completely unbreakable. Use a strong, unique password, never share it, and keep your device locked.',
      ]],
    ],
  },
  es: {
    title: '¿Cómo protege este sitio los datos de los asuntos?',
    intro: 'El sitio utiliza cinco medidas de protección, explicadas sin tecnicismos:',
    hide: 'No volver a mostrar durante 3 días', close: 'Cerrar',
    sections: [
      ['1. Los datos se cifran antes de subirlos', [
        'Antes de que los datos de los asuntos, expedientes de clientes, chats, agendas o archivos salgan de tu ordenador o teléfono, se convierten en datos cifrados que no pueden leerse directamente.',
        'Supabase guarda los datos cifrados, no la información legible de los clientes.',
      ]],
      ['2. Los métodos de cifrado utilizados', [
        'AES-256-GCM cifra los datos de los asuntos, chats y archivos. Es un método sólido y maduro, y cada asunto recibe una clave aleatoria diferente.',
        'RSA-OAEP 2048 cifra por separado la clave de cada asunto para cada miembro autorizado. Solo la clave privada correspondiente puede descifrarla.',
        'PBKDF2-SHA-256 (310.000 iteraciones) utiliza la contraseña de acceso para proteger la clave privada y dificulta los intentos de adivinar la contraseña.',
      ]],
      ['3. El acceso se limita a personas autorizadas', [
        'Los desconocidos no pueden crear sus propias cuentas ni entrar de forma anónima. Sin un inicio de sesión válido, el servidor no entrega los datos.',
        'Los miembros normales solo pueden ver los asuntos que dirigen o en los que participan. Carol puede verlos todos.',
        'Los miembros normales no pueden hacerse pasar por el responsable ni saltarse las reglas para cambiar la lista de miembros.',
      ]],
      ['4. Se controlan los dispositivos y la actividad', [
        'Puedes revisar los dispositivos que han iniciado sesión y cerrar la sesión de uno o de todos. Un dispositivo desconectado pierde el acceso.',
        'La sesión termina tras 24 horas de inactividad y las acciones de seguridad importantes quedan registradas.',
      ]],
      ['5. El sitio y el servidor mantienen protección continua', [
        'El servidor vuelve a comprobar los permisos de cada persona y los archivos no se guardan públicamente. Esto ayuda a impedir que alguien evite la página para leer o cambiar datos.',
        'El sitio solo ejecuta código incluido en el propio sitio, y las comprobaciones automáticas confirman que el acceso sin iniciar sesión siga bloqueado.',
        'Ningún sitio puede prometer ser completamente invulnerable. Utiliza una contraseña fuerte y exclusiva, no la compartas y mantén bloqueado tu dispositivo.',
      ]],
    ],
  },
};

const BEGINNER_TUTORIAL = {
  zh: {
    title: '新手教程', choose: '选择要学习使用的功能……', catalog: '返回目录', finish: '完成', skip: '关闭',
    steps: [
      ['首页', '首页集中显示紧急事项、本周到期、等待你推进的事项、可见事项总数和自动提醒。点击事项后，可选择“编辑事项”或“在事项中工作”。'],
      ['事项', '这里可新建、搜索和筛选事项，也能批量删除、导入 Excel/CSV、导出 CSV 或打开聊天。编辑事项时可填写客户、负责人、成员、状态、阶段、下一步、截止日期、等待对象和重复规则。工作页面则用于完成步骤、上传加密文件和查看动态。'],
      ['日历', '日历按截止日期显示事项。点击某一天，可新建截止日期已自动填写的事项，或创建当天指定时间的自定义提醒；提醒会同时进入“通知”。'],
      ['客户档案', '这里记录客户名称、联系人、电话、邮箱、沟通进度、最后联系时间和备注。支持新建、修改、批量删除及多文件 Excel/CSV 导入；档案中的客户会自动出现在新建事项的客户列表中。'],
      ['客户跟进', '这里汇总久未联系、等待客户或需要继续推进的客户。点击“更新为刚刚已联系”会记录当前时间，并同步更新客户档案和通知。右上角数字表示待跟进数量。'],
      ['团队负荷', '团队负荷按成员统计正在进行、紧急、逾期和等待本人推进的事项，帮助负责人了解分工是否均衡，以及谁需要优先支援。'],
      ['通知', '事项修改、聊天、文件、客户操作和日程提醒会进入通知页。可标记已读或删除；允许系统通知后，电脑也会弹出提醒。侧边栏红色数字表示未读数量。'],
      ['信息', '信息页展示成员和可见范围，并可查看登录设备的名称、位置、IP 和最后活动时间。可以退出单台或全部设备、查看安全记录，以及导出或恢复加密备份。'],
      ['回收站', '删除的事项和客户档案会先进入回收站。拥有权限的人可以恢复、单独永久删除或批量永久删除；永久删除后无法恢复，请确认后再操作。'],
    ],
  },
  en: {
    title: 'Quick tour', choose: 'Choose a feature to learn about…', catalog: 'Back to topics', finish: 'Done', skip: 'Close',
    steps: [
      ['Home', 'Home summarizes urgent matters, items due this week, matters waiting for you, all visible matters, and automatic reminders. Select a matter to edit it or work on it, or use the “+” button for quick creation.'],
      ['Matters', 'Create, search, and filter matters; bulk-delete them; import Excel/CSV files; export CSV data; or open a chat. Editing covers the client, owner, members, status, stage, next action, due date, waiting party, and recurrence. The work view handles completed steps, encrypted files, and activity.'],
      ['Calendar', 'The calendar places matters on their due dates. Select a date to create a matter with the date already filled in or schedule a custom reminder for a specific time. Reminders are also saved under Notifications.'],
      ['Client records', 'Store the client name, contact person, phone, email, communication progress, latest contact time, and notes. You can create, edit, bulk-delete, or import multiple Excel/CSV files. Saved clients appear in the New matter client list.'],
      ['Client follow-up', 'This page gathers clients who have not been contacted recently, are being waited on, or need further action. “Mark as contacted now” records the current time and updates both the client record and notifications. The badge shows the number due for follow-up.'],
      ['Team workload', 'Team workload shows each member’s open, urgent, overdue, and waiting matters. It helps the team lead see whether work is balanced and who may need support first.'],
      ['Notifications', 'Matter edits, chats, file activity, client actions, and reminders appear here. Notifications can be marked as read or deleted. When system notifications are enabled, alerts can also appear on the computer. The red badge shows the unread count.'],
      ['Information', 'Information shows members and visibility rules, plus each signed-in device’s name, location, IP address, and last active time. You can sign out one or all devices, review security events, and export or restore an encrypted backup.'],
      ['Recycle bin', 'Deleted matters and client records are moved here first. Authorized users can restore them, permanently remove one item, or permanently remove selected items in bulk. Permanent deletion cannot be undone.'],
    ],
  },
  es: {
    title: 'Guía rápida', choose: 'Elige una función para aprender a usarla…', catalog: 'Volver al índice', finish: 'Terminar', skip: 'Cerrar',
    steps: [
      ['Inicio', 'Inicio resume los asuntos urgentes, los que vencen esta semana, los que esperan tu intervención, todos los asuntos visibles y los recordatorios automáticos. Pulsa un asunto para editarlo o trabajar en él, o usa “+” para crearlo rápidamente.'],
      ['Asuntos', 'Crea, busca y filtra asuntos; elimínalos en lote; importa archivos Excel/CSV; exporta datos CSV o abre un chat. La edición incluye cliente, responsable, miembros, estado, etapa, próxima acción, fecha límite, parte pendiente y repetición. La vista de trabajo gestiona pasos, archivos cifrados y actividad.'],
      ['Calendario', 'El calendario muestra los asuntos en su fecha límite. Pulsa una fecha para crear un asunto con esa fecha ya rellenada o programar un recordatorio personalizado a una hora concreta. También se guarda en Notificaciones.'],
      ['Expedientes de clientes', 'Guarda nombre, persona de contacto, teléfono, correo, avance de la comunicación, último contacto y notas. Permite crear, editar, eliminar en lote e importar varios Excel/CSV. Los clientes guardados aparecen al crear un asunto.'],
      ['Seguimiento de clientes', 'Reúne clientes sin contacto reciente, pendientes de respuesta o que requieren otra acción. “Marcar como contactado ahora” registra la hora actual y actualiza el expediente y las notificaciones. El indicador muestra cuántos requieren seguimiento.'],
      ['Carga del equipo', 'Muestra por miembro los asuntos abiertos, urgentes, vencidos y pendientes de su intervención. Ayuda a comprobar si el reparto es equilibrado y quién necesita apoyo primero.'],
      ['Notificaciones', 'Aquí aparecen cambios de asuntos, chats, archivos, acciones sobre clientes y recordatorios. Se pueden marcar como leídas o eliminar. Si activas las notificaciones del sistema, los avisos también aparecen en el ordenador.'],
      ['Información', 'Muestra miembros y reglas de visibilidad, además del nombre, ubicación, IP y última actividad de cada dispositivo conectado. Permite cerrar una sesión o todas, revisar eventos de seguridad y exportar o restaurar una copia cifrada.'],
      ['Papelera', 'Los asuntos y expedientes eliminados se trasladan primero aquí. Los usuarios autorizados pueden restaurarlos, borrar uno definitivamente o borrar varios en lote. La eliminación definitiva no se puede deshacer.'],
    ],
  },
};

const TUTORIAL_DETAILS = {
  zh: [
    ['登录页：邮箱和密码用于登录；“小眼睛”显示/隐藏密码；“登录”提交，处理中会变成不可重复点击的“登录中”；中 / EN / ES 切换语言；连续输错会暂时限制再次尝试。','左上角“☰”打开/收起侧边栏，右上角红色数字就是未读通知数。侧边栏各按钮进入对应页面，“新手教程”可随时重看。','顶部云朵按钮显示同步状态；点击可立即同步并刷新登录设备。侧边栏右下角“退出登录”会先确认；空闲 24 小时也会自动退出。','“＋ 新建事项”打开完整的新建事项表单。','首页四项数字显示紧急、本周到期、等待本人推进和可见事项。点击“今天要处理的”或“自动提醒”中的事项，会选择“编辑事项”或“在事项中工作”。'],
    ['搜索框按编号、客户、标题和这一步搜索；业务领域、负责人、状态、等待对象可组合筛选；“清除筛选”恢复全部。','每行复选框选择一项，表头复选框全选本人可操作项；“批量删除”确认后移入回收站。','“导入 Excel/CSV”可一次选择多个文件并校验字段；格式不对时可下载示例。“导出 CSV 表格”导出当前结果。','“新建事项”打开完整表单；点击事项行先选择“编辑事项”或“在事项中工作”。','填写客户、对方当事人和关联方后，创建事项会自动比对现有资料；发现相似名称时必须确认。“检查利益冲突”可随时重新检查。','新建/修改事项可设置客户、标题、业务领域、负责人、成员、状态、阶段、下一步、下一步负责人、截止日期、等待对象、最后联系、备注和重复规则；“保存”同步修改，“删除事项”移入回收站。','客户、业务领域、阶段和等待对象支持“自定义……”。不存在的自定义客户会自动建立只含客户名称的客户档案。','修改下一步负责人会发起交接；接收人点“确认接收”完成交接。“撤销上次编辑”恢复最近一次可撤销修改。','“在事项中工作”页面的“完成步骤”可记录完成内容并设置新的阶段、状态、截止日期、等待对象、下一步和负责人；“确认完成”保存，“取消”放弃。','“撤销已完成步骤”恢复最近完成步骤；“已完成的步骤”查看历史；“导出 CSV 表格”导出当前事项；“动态记录”查看创建、修改、步骤、文件和已读回执。','“添加文件”支持同时选择多个文件；单个文件超过 20MB 会再次询问是否继续。同名文件再次上传会成为新的 v2、v3 版本，旧版本仍可下载。','文件会先在设备上加密再上传。点击文件名会先问“要下载吗？”，确认后解密下载；“移除”会先问“要移除吗？”，只有 Carol 或上传者可以移除。','保存事项前会检查服务器版本；如果别人已经修改，网站会停止覆盖并要求重新载入最新内容。','事项和文件都按成员权限隔离；没有权限的事项不会显示，也不能通过直接输入网址打开。'],
    ['“‹ 上个月”“下个月 ›”切换月份，“今天”返回当前月份。','彩色事项显示在截止日期上，点击后选择编辑或工作。','点击日期空白处：“新建事项”自动填入该日为截止日期；“当日提醒”设置日期、时间和自定义文字；“取消”关闭。','提醒表单“保存”后同时进入日历和通知；“取消”放弃。点击蓝色提醒查看详情，“删除提醒”确认删除，“确定”关闭。','提醒到点时会进入通知；开启系统通知后也会弹到电脑通知中心。'],
    ['“新建客户”填写名称、联系人、电话、邮箱、最后联系、沟通进度和备注；“保存”创建，“取消”放弃。','每行“编辑”修改；“删除”确认后进入回收站。行复选框、表头全选和“批量删除”可处理多个有权限的客户。','“导入 Excel/CSV”支持多选文件并批量建立档案；错误会指出文件或字段。','客户会进入新建事项的客户列表；事项中的不存在自定义客户也会自动建立档案。','创建、修改、删除和导入客户会写入通知，开启系统通知后也会弹窗。'],
    ['页面自动汇总久未联系、等待客户或下一步需要本人处理的客户；侧边栏数字为待跟进数，0 时隐藏。','点击客户区域打开对应事项。','“更新为刚刚已联系”记录当前日期和时间，并同步同名客户档案。','成功后弹出“已更新状态”，同时写入通知；开启系统通知后也会弹到电脑。'],
    ['每张卡显示成员的总工作量、进行中、紧急、逾期和等待本人推进数量。','页面只用于查看，没有修改按钮；数据随事项同步更新。','Carol 可查看全部事项；其他成员的统计不会泄露无权事项内容。'],
    ['建议点击“启用系统通知”，这样即使没有停留在通知页，也能及时收到事项、文件、客户和日程提醒。浏览器会先询问是否允许。','所有新通知也会在网页右下角显示通知卡；可以手动关闭，未关闭时会在 5 秒后自动消失。','“全部已读”一次处理所有未读通知，并正常同步已读回执。勾选通知后可使用“批量删除”，全选框可以一次选择当前全部通知。','“关闭系统通知”只停止电脑弹窗，不会删除通知页中的记录或网页右下角通知。','未读项的“标记已读”会减少侧边栏红色数字，并同步已读回执；已读项显示已读状态。','“删除”会先确认，只删除这条通知，不删除关联事项、文件或客户。','通知来源包括事项创建/修改/删除、步骤完成、文件上传/移除、客户创建/修改/删除/联系更新、日程及截止提醒。','侧边栏和菜单按钮的红色数字都是未读数量；关联事项只有有权限的人才能打开。'],
    ['成员与可见范围用于说明角色和权限，不可在网页内自行提升权限。','登录设备显示设备名、最多城市级的大致位置、IP、最后活动和“当前设备”；点击同步也会刷新列表。网站不会请求、保存或显示精确经纬度。','每台设备的“退出此设备”确认后撤销单个会话；该设备会立即清除页面资料并回到登录页。','“退出所有设备”确认后让全部设备（含当前设备）退出。','“导出加密备份”下载加密数据和文件；“恢复加密备份”选择文件并再次确认；“查看安全记录”查看近期安全操作。这三项仅限 Carol 使用。'],
    ['回收站显示已删除事项和客户档案；普通成员只能处理自己拥有/创建的内容。','“恢复”把内容放回原页面并同步。','“永久删除”会二次确认并删除相关记录及文件；不可恢复。','行复选框和表头全选用于选择；“批量永久删除”显示数量并再次确认；“取消”不会删除。'],
  ],
  en: [
    ['Login uses email and password; the eye shows/hides the password; Sign in becomes disabled “Signing in” while processing; 中 / EN / ES changes language; repeated failures cause a cooldown.','The top-left menu opens the sidebar and its red badge is the unread count. Sidebar buttons open each page; Quick tour reopens this guide.','The cloud button shows sync status and refreshes data/devices when selected. Sign out at the bottom-right of the sidebar asks for confirmation; 24 hours of inactivity also signs out.','New matter opens the full matter form. Dashboard matter rows open the Edit / Work chooser.'],
    ['Search by matter number, client, title, or current step; practice area, owner, status, and waiting party combine as filters; Clear filters resets them. Checkboxes plus Bulk delete move authorized items to the recycle bin.','Import Excel/CSV accepts multiple files and validates fields; a sample is available after invalid input. Export CSV exports current results. New matter opens the form.','Client, opposing parties, and related parties are checked against visible existing records before creation; Check conflicts runs the check again at any time.','Selecting a row offers Edit matter or Work on matter. Editing covers client, title, area, owner, members, status, stage, next action/owner, due date, waiting party, contact, notes, and recurrence. Save syncs; Delete moves to trash.','Custom client/area/stage/waiting values are supported; a missing custom client creates a name-only client record. Changing next owner creates a handoff; Accept handoff completes it; Undo last edit restores an eligible edit.','Work on matter: Complete step records the result and all next-step fields; Cancel discards.','Undo completed step reverses the latest completion; Completed steps and Activity show history; Export CSV exports this matter.','Add files accepts multiple files; files over 20 MB require confirmation. Uploading the same filename creates v2/v3 while preserving older downloadable versions.','Files are encrypted before upload. Selecting a filename confirms and decrypts download; Remove confirms and is limited to authorized users.','Before saving, the website checks the server version and stops if another person has already changed the matter.','Member permissions isolate matters and files; unauthorized content cannot be opened by direct URL.'],
    ['Previous/Next month changes months; Today returns to the current month. Colored matters open Edit / Work.','Select a date background for New matter (date prefilled), Same-day reminder, or Cancel.','Save stores reminder date/time/text in Calendar and Notifications; Cancel discards. Select a blue reminder for details; Delete confirms; OK closes. Enabled system notifications also alert at the due time.'],
    ['New client includes name, contact, phone, email, last contact, progress, and notes; Save creates and Cancel discards.','Edit changes; Delete confirms and moves to trash. Row/header checkboxes plus Bulk delete process several records.','Import Excel/CSV accepts multiple files and reports errors. Saved/custom clients feed New matter. Client operations create in-app and enabled system notifications.'],
    ['Shows clients with stale contact, waiting status, or your next action; the badge is the count and hides at zero.','Select the client to open its matter. Mark as contacted now records the exact time, updates the client record, shows confirmation, and creates notifications.'],
    ['Each member card shows total, open, urgent, overdue, and waiting workload. It is read-only and syncs automatically.','Carol can view all matters; other users do not gain access to hidden matter content.'],
    ['We recommend enabling system notifications so matter, file, client, and schedule alerts can reach you outside this page; the browser asks permission first.','Every new notification also appears in a card at the bottom-right of the website. You can close it, or it disappears automatically after five seconds.','Mark all as read processes every unread notification and syncs normal read receipts. Select notification checkboxes to use Delete selected; the header checkbox selects the current list.','Turning off system notifications only stops computer alerts; it does not remove in-app records or website notification cards. Mark as read reduces the badge and syncs a receipt.','Delete confirms and removes only that notification. Sources include matter changes, steps, files, client actions/contact, schedules, and deadlines. Related content still requires permission.'],
    ['Members and visibility explains access. Devices shows the name, at most a city-level estimate, IP, last activity, and current device; sync refreshes it. The site never requests, stores, or displays precise coordinates.','Sign out this device confirms and revokes one session; that device clears visible data and returns to login. Sign out all revokes all sessions.','Export encrypted backup downloads encrypted data/files; Restore selects and confirms a backup; View security events shows recent actions. These controls are available only to Carol.'],
    ['Contains deleted matters and clients, subject to owner/creator permissions. Restore returns an item.','Permanently delete confirms and removes related records/files irreversibly. Checkboxes plus Bulk permanently delete handle several items; Cancel keeps them.'],
  ],
  es: [
    ['El acceso usa correo y contraseña; el ojo muestra/oculta la contraseña; Iniciar sesión se bloquea como “Iniciando sesión”; 中 / EN / ES cambia idioma; varios errores causan una espera.','El menú abre la barra lateral y su indicador rojo cuenta notificaciones. Los botones abren cada página; Guía rápida reabre esta ayuda.','La nube muestra y fuerza sincronización, incluida la lista de dispositivos. Cerrar sesión, en la esquina inferior derecha de la barra lateral, pide confirmación; 24 horas sin actividad también cierran la sesión.','Nuevo asunto abre el formulario completo. Las filas del inicio ofrecen Editar / Trabajar.'],
    ['Busca por número de asunto, cliente, título o paso actual; área, responsable, estado y parte pendiente se combinan como filtros; Limpiar filtros los restablece. Casillas y Eliminar en lote envían elementos permitidos a la papelera.','Importar Excel/CSV admite varios archivos y valida; puede descargar muestra. Exportar CSV usa resultados actuales. Nuevo asunto abre el formulario.','Cliente, contrapartes y partes relacionadas se comparan con los registros visibles antes de crear; Comprobar conflictos repite la revisión.','Una fila ofrece Editar o Trabajar. Edición incluye cliente, título, área, responsable, miembros, estado, etapa, próxima acción/responsable, fecha, parte pendiente, contacto, notas y repetición. Guardar sincroniza; Eliminar envía a papelera.','Admite valores personalizados y crea clientes inexistentes con su nombre. Cambiar próximo responsable crea traspaso; Aceptar lo completa; Deshacer edición restaura un cambio válido.','Trabajar: Completar paso registra resultado y campos siguientes; Cancelar descarta.','Deshacer paso revierte; Pasos completados y Actividad muestran historial; Exportar CSV usa este asunto.','Añadir archivos admite varios; más de 20 MB pide confirmación. Subir el mismo nombre crea v2/v3 y conserva versiones anteriores descargables.','Los archivos se cifran antes de subir. Pulsar nombre confirma/descifra descarga; Eliminar confirma y exige permiso.','Antes de guardar, el sitio compara la versión del servidor y se detiene si otra persona ya modificó el asunto.','Permisos aíslan asuntos y archivos; una URL directa no evita las reglas.'],
    ['Mes anterior/siguiente cambia; Hoy vuelve al actual. Los asuntos de colores abren Editar/Trabajar.','Pulsa fecha para Nuevo asunto (fecha rellenada), Recordatorio del día o Cancelar.','Guardar añade fecha/hora/texto a Calendario y Notificaciones; Cancelar descarta. Pulsa recordatorio azul para detalles; Eliminar confirma; Aceptar cierra. Los avisos del sistema alertan al vencer.'],
    ['Nuevo cliente incluye nombre, contacto, teléfono, correo, último contacto, avance y notas; Guardar crea, Cancelar descarta.','Editar modifica; Eliminar confirma y envía a papelera. Casillas y Eliminar en lote procesan varios.','Importar Excel/CSV admite varios y muestra errores. Clientes guardados/personalizados alimentan Nuevo asunto. Las operaciones generan avisos internos y del sistema.'],
    ['Muestra clientes sin contacto, pendientes o con tu próxima acción; el indicador cuenta y desaparece en cero.','Pulsa cliente para abrir asunto. Marcar como contactado ahora registra hora exacta, actualiza expediente, confirma y genera notificaciones.'],
    ['Cada tarjeta muestra total, abiertos, urgentes, vencidos y pendientes. Es de consulta y sincroniza.','Carol puede ver todos los asuntos; los demás usuarios no obtienen contenido de asuntos ocultos.'],
    ['Recomendamos activar las notificaciones del sistema para recibir avisos de asuntos, archivos, clientes y agenda fuera de esta página; el navegador pide permiso.','Cada notificación nueva también aparece en una tarjeta en la esquina inferior derecha del sitio. Puedes cerrarla o esperar a que desaparezca automáticamente después de cinco segundos.','Marcar todo como leído procesa todas las notificaciones pendientes y sincroniza los acuses de lectura. Marca las casillas para usar Eliminar seleccionadas; la casilla superior selecciona toda la lista actual.','Desactivar las notificaciones del sistema solo detiene los avisos del ordenador; no elimina los registros internos ni las tarjetas del sitio. Marcar como leída reduce el indicador y sincroniza el acuse.','Eliminar confirma y borra solo el aviso. Incluye cambios, pasos, archivos, clientes/contacto, agenda y fechas. El contenido exige permiso.'],
    ['Miembros y visibilidad explica el acceso. Dispositivos muestra nombre, como máximo una estimación de ciudad, IP, actividad y dispositivo actual; sincronizar actualiza. El sitio nunca solicita, guarda ni muestra coordenadas precisas.','Cerrar este dispositivo confirma y revoca una sesión; allí borra datos visibles y vuelve al acceso. Cerrar todos revoca todos.','Exportar copia cifrada descarga datos/archivos; Restaurar elige y confirma; Ver eventos muestra acciones. Son controles administrativos.'],
    ['Contiene asuntos y clientes eliminados según permisos. Restaurar devuelve.','Eliminar definitivamente confirma y borra registros/archivos sin vuelta atrás. Casillas y eliminación en lote procesan varios; Cancelar conserva.'],
  ],
};

TUTORIAL_DETAILS.zh[1][5] = '新建和修改事项可填写背景、优先级、开始日期、费用、收款、余额、联系人、联系邮箱、备注及原有工作流和权限字段；保存会加密同步，删除会移入回收站。';
TUTORIAL_DETAILS.en[1][3] = 'Editing includes background, priority, start date, fees, payments, balance, contacts, notes, and the existing workflow and permission fields. Save syncs; Delete moves to trash.';
TUTORIAL_DETAILS.es[1][3] = 'La edición incluye antecedentes, prioridad, fecha inicial, honorarios, pagos, saldo, contactos, notas y los campos existentes de flujo y permisos. Guardar sincroniza; Eliminar envía a la papelera.';
TUTORIAL_DETAILS.zh[1][5] += ' 截止日期可留空，也可选择 ASAP；ASAP 事项每天提醒一次。';
TUTORIAL_DETAILS.en[1][3] += ' The due date is optional and can be set to ASAP; ASAP matters generate one reminder each day.';
TUTORIAL_DETAILS.es[1][3] += ' La fecha límite es opcional y puede marcarse como ASAP; los asuntos ASAP generan un aviso diario.';

BEGINNER_TUTORIAL.zh.steps.splice(1,0,['全文搜索','搜索事项、客户、聊天、动态和文件名；结果严格按当前账号权限显示。']);
BEGINNER_TUTORIAL.en.steps.splice(1,0,['Full search','Search matters, clients, chats, activity, and filenames; results follow the current account permissions.']);
BEGINNER_TUTORIAL.es.steps.splice(1,0,['Búsqueda completa','Busca asuntos, clientes, chats, actividad y archivos; los resultados respetan los permisos actuales.']);
BEGINNER_TUTORIAL.zh.steps.splice(7,0,['期限计算','按自然日或工作日计算截止日期，并可一键创建提前 7、3、1 天提醒。'],['工作报告','按时间、客户、负责人和业务类型汇总事项，可导出 Excel/CSV 或打印为 PDF。']);
BEGINNER_TUTORIAL.en.steps.splice(7,0,['Deadline calculator','Calculate calendar or business-day deadlines and create reminders 7, 3, and 1 days in advance.'],['Work reports','Summarize matters by date, client, owner, and area; export Excel/CSV or print to PDF.']);
BEGINNER_TUTORIAL.es.steps.splice(7,0,['Calculadora de plazos','Calcula plazos naturales o hábiles y crea avisos 7, 3 y 1 días antes.'],['Informes de trabajo','Resume asuntos por fecha, cliente, responsable y área; exporta Excel/CSV o imprime en PDF.']);
BEGINNER_TUTORIAL.zh.steps.splice(10,0,['聊天','独立团队聊天支持 @ 多选成员，可引用事项、客户档案、步骤或事项文件，也可上传加密文件随消息发送。发送者可长期屏蔽成员。']);
BEGINNER_TUTORIAL.en.steps.splice(10,0,['Chat','Team chat supports multi-select @ mentions, references to matters, clients, steps or matter files, and encrypted file uploads sent with a message. Senders can persistently block members.']);
BEGINNER_TUTORIAL.es.steps.splice(10,0,['Chat','El chat admite menciones @ múltiples, referencias a asuntos, clientes, pasos o archivos y el envío de archivos cifrados. El remitente puede bloquear miembros de forma persistente.']);
TUTORIAL_DETAILS.zh.splice(1,0,['输入至少两个字符后点击“搜索”；结果包括事项、客户、聊天、动态和文件名。','点击结果打开相关事项或客户档案；没有权限的数据不会出现。']);
TUTORIAL_DETAILS.en.splice(1,0,['Enter at least two characters and select Search; results include matters, clients, chats, activity, and filenames.','Select a result to open it. Content outside your permissions never appears.']);
TUTORIAL_DETAILS.es.splice(1,0,['Introduce al menos dos caracteres y pulsa Buscar; incluye asuntos, clientes, chats, actividad y archivos.','Pulsa un resultado para abrirlo. Nunca aparece contenido sin permiso.']);
TUTORIAL_DETAILS.zh.splice(7,0,['填写起始日期、天数和计算方式；工作日模式会排除周末及手工填写的节假日。','“计算截止日”显示结果；“创建 7／3／1 天前提醒”会把三次提醒加入日历和通知。','计算结果仅供工作管理，法定期限应由律师复核。'],['选择日期范围、客户、负责人和业务类型后点击“生成报告”。','“导出 Excel/CSV”下载表格；“打印／导出 PDF”打开浏览器打印窗口。','报告只统计当前账号有权查看的事项。']);
TUTORIAL_DETAILS.en.splice(7,0,['Set the start date, number of days, and method. Business-day mode excludes weekends and entered holidays.','Calculate shows the date; Create reminders adds alerts 7, 3, and 1 days beforehand.','The result supports workflow planning and must be legally verified.'],['Choose the date range, client, owner, and area, then Generate.','Export Excel/CSV downloads a table; Print / export PDF opens the print dialog.','Reports include only matters this account may view.']);
TUTORIAL_DETAILS.es.splice(7,0,['Indica fecha inicial, días y método. El modo hábil excluye fines de semana y festivos indicados.','Calcular muestra la fecha; Crear avisos añade recordatorios 7, 3 y 1 días antes.','El resultado sirve para gestión y debe verificarse jurídicamente.'],['Elige fechas, cliente, responsable y área, y pulsa Generar.','Exportar Excel/CSV descarga una tabla; Imprimir / exportar PDF abre la impresión.','El informe solo incluye asuntos permitidos.']);
TUTORIAL_DETAILS.zh.splice(10,0,['在消息框输入文字；“@ 成员”可同时勾选多人。','“引用”可选择事项、客户档案、已完成步骤或事项中的文件；文件卡片可按原事项权限安全下载。','“上传文件并发送”会先在本机加密，再把文件和消息一起发出；可一次选择多个文件。','“屏蔽”会保存选择；被屏蔽者看不到你之后发送的文字、引用卡片和文件，其他成员不受影响。','你发送的消息下方会用红字显示“已屏蔽 xxx”，只有你本人看得到。','收到或发出消息后聊天会自动滚到底部；同步不会清空正在输入的草稿。']);
TUTORIAL_DETAILS.en.splice(10,0,['Write a message and select one or more people under @ Members.','Reference a matter, client record, completed step, or matter file. File cards download securely under the source matter permissions.','Upload files and send encrypts them on this device first and sends one or more files with the message.','Blocked members cannot see later text, cards, or files from you; other members are unaffected.','Only you see the red “Blocked for …” label under your own message.','Chat follows received and sent messages to the bottom, while sync preserves the draft being typed.']);
TUTORIAL_DETAILS.es.splice(10,0,['Escribe un mensaje y elige una o varias personas en @ Miembros.','Referencia un asunto, cliente, paso completado o archivo del asunto. Las tarjetas descargan con los permisos del asunto original.','Subir archivos y enviar los cifra primero en este dispositivo y permite adjuntar varios al mensaje.','Los miembros bloqueados no verán tus textos, tarjetas ni archivos posteriores; los demás no se ven afectados.','Solo tú ves la etiqueta roja “Bloqueado para…” bajo tu mensaje.','El chat baja al final al recibir o enviar mensajes y la sincronización conserva el borrador.']);
BEGINNER_TUTORIAL.zh.steps[2][1] = '这里可新建、搜索和筛选事项，也能批量删除、导入 Excel/CSV 或导出 CSV。点击事项后选择编辑或工作；团队消息统一在独立“聊天”页发送。';
BEGINNER_TUTORIAL.en.steps[2][1] = 'Create, search, filter, bulk-delete, import Excel/CSV, or export CSV. Select a matter to edit or work on it; team messages are sent from the separate Chat page.';
BEGINNER_TUTORIAL.es.steps[2][1] = 'Crea, busca, filtra, elimina en lote, importa Excel/CSV o exporta CSV. Pulsa un asunto para editar o trabajar; los mensajes se envían desde Chat.';
BEGINNER_TUTORIAL.zh.steps[9][1] = '事项、文件、客户操作和日程提醒进入通知页，可标记已读或删除。聊天消息只在独立聊天页显示，但仍可触发系统通知。';
BEGINNER_TUTORIAL.en.steps[9][1] = 'Matter, file, client, and schedule activity appears under Notifications. Chat stays on its own page but can still trigger system alerts.';
BEGINNER_TUTORIAL.es.steps[9][1] = 'Los avisos de asuntos, archivos, clientes y agenda aparecen en Notificaciones. Los chats permanecen en su página, pero pueden generar alertas.';
TUTORIAL_DETAILS.zh[2][3] = '“新建事项”打开完整表单；点击事项行选择“编辑事项”或“在事项中工作”。团队消息统一从侧边栏“聊天”进入。';
TUTORIAL_DETAILS.en[2][1] = 'Import Excel/CSV validates multiple files and offers a sample when needed. Export CSV uses current results. New matter opens the full form; team messages are sent from Chat.';
TUTORIAL_DETAILS.es[2][1] = 'Importar Excel/CSV valida varios archivos y ofrece una muestra. Exportar CSV usa los resultados. Nuevo asunto abre el formulario; los mensajes se envían desde Chat.';
TUTORIAL_DETAILS.zh[9][6] = '通知来源包括事项创建/修改/删除、步骤完成、文件上传/移除、客户操作、日程及截止提醒；聊天消息不进入通知列表。';
TUTORIAL_DETAILS.en[9][4] = 'Delete removes only that notification. Sources include matter changes, steps, files, client actions, schedules, and deadlines; chat messages stay out of this list.';
TUTORIAL_DETAILS.es[9][4] = 'Eliminar borra solo ese aviso. Incluye cambios, pasos, archivos, clientes, agenda y fechas; los chats no aparecen en esta lista.';
TUTORIAL_DETAILS.zh[5].push('客户档案支持多个联系人和多条关联关系；每行按界面提示用“|”分隔姓名、职务、电话、邮箱或关系说明。');
TUTORIAL_DETAILS.en[5].push('Client records support multiple contacts and relationships; enter one per line using the “|” format shown in the form.');
TUTORIAL_DETAILS.es[5].push('Los clientes admiten varios contactos y relaciones; escribe uno por línea con el formato “|” del formulario.');
TUTORIAL_DETAILS.zh[11].push('Carol 可在“数据完整性巡检”点击“开始巡检”，检查加密标记、孤立动态、文件路径、权限关系和密钥状态。');
TUTORIAL_DETAILS.en[11].push('Carol can select Run integrity check to inspect encryption markers, orphaned activity, file paths, permissions, and key state.');
TUTORIAL_DETAILS.es[11].push('Carol puede ejecutar la revisión de integridad para comprobar cifrado, actividad huérfana, archivos, permisos y claves.');

const GUIDE_ROUTES = ['#/','#/search','#/matters','#/calendar','#/clients','#/followups','#/team','#/deadline','#/reports','#/inbox','#/chat','#/settings','#/trash'];
const GUIDE_UI = {
  zh:{back:'上一步',next:'下一步',done:'完成教学',exit:'退出教学',tryIt:'你可以自由操作当前页面，教学进度不会丢失'},
  en:{back:'Back',next:'Next',done:'Finish tour',exit:'Exit tour',tryIt:'You can explore this page freely without losing your place in the tour'},
  es:{back:'Anterior',next:'Siguiente',done:'Terminar guía',exit:'Salir de la guía',tryIt:'Puedes explorar esta página libremente sin perder tu progreso en la guía'},
};

const FEATURE_COPY = {
  zh: {
    calendar:'日历', followups:'客户跟进', team:'团队负荷', reminders:'自动提醒', remindersEmpty:'目前没有临期或逾期提醒。',
    overdue:'已逾期', dueSoon:'即将到期', staleClient:'客户久未联系', waitingClient:'等待客户', days:'天', today:'今天',
    quick:'快速新建', quickSubmit:'立即创建', handoff:'工作交接', handoffPending:'等待 {name} 接收', handoffAccept:'确认接收', handoffAccepted:'已接收',
    workloadOpen:'进行中', workloadRed:'紧急', workloadOverdue:'逾期', workloadWaiting:'待本人推进',
    previous:'上个月', nextMonth:'下个月', noCalendar:'本月没有截止事项',
    recurrence:'重复事项', recurrenceNone:'不重复', recurrenceWeekly:'每周', recurrenceMonthly:'每月', recurrenceUntil:'重复至（可不填）',
    followupEmpty:'目前没有需要跟进的客户。', lastContact:'最后联系时间', contactNow:'更新为刚刚已联系',
  },
  en: {
    calendar:'Calendar', followups:'Client follow-up', team:'Team workload', reminders:'Automatic reminders', remindersEmpty:'No upcoming or overdue reminders.',
    overdue:'Overdue', dueSoon:'Due soon', staleClient:'No recent client contact', waitingClient:'Waiting on client', days:'days', today:'Today',
    quick:'Quick add', quickSubmit:'Create now', handoff:'Handoff', handoffPending:'Waiting for {name} to accept the handoff', handoffAccept:'Accept handoff', handoffAccepted:'Handoff accepted',
    workloadOpen:'Open', workloadRed:'Urgent', workloadOverdue:'Overdue', workloadWaiting:'Waiting on member',
    previous:'Previous month', nextMonth:'Next month', noCalendar:'No matters due this month',
    recurrence:'Repeat', recurrenceNone:'Does not repeat', recurrenceWeekly:'Weekly', recurrenceMonthly:'Monthly', recurrenceUntil:'Repeat until (optional)',
    followupEmpty:'No clients need follow-up right now.', lastContact:'Last contacted', contactNow:'Mark as contacted now',
  },
  es: {
    calendar:'Calendario', followups:'Seguimiento', team:'Carga del equipo', reminders:'Recordatorios automáticos', remindersEmpty:'No hay recordatorios próximos ni vencidos.',
    overdue:'Vencido', dueSoon:'Vence pronto', staleClient:'Sin contacto reciente', waitingClient:'Esperando al cliente', days:'días', today:'Hoy',
    quick:'Creación rápida', quickSubmit:'Crear ahora', handoff:'Traspaso', handoffPending:'Esperando que {name} acepte el traspaso', handoffAccept:'Aceptar traspaso', handoffAccepted:'Traspaso aceptado',
    workloadOpen:'Abiertos', workloadRed:'Urgentes', workloadOverdue:'Vencidos', workloadWaiting:'Pendientes del miembro',
    previous:'Mes anterior', nextMonth:'Mes siguiente', noCalendar:'No hay asuntos con vencimiento este mes',
    recurrence:'Repetición', recurrenceNone:'No se repite', recurrenceWeekly:'Semanal', recurrenceMonthly:'Mensual', recurrenceUntil:'Repetir hasta (opcional)',
    followupEmpty:'No hay clientes pendientes de seguimiento.', lastContact:'Último contacto', contactNow:'Marcar como contactado ahora',
  },
};
function ft(key, vars) {
  let out = ((FEATURE_COPY[lang] || FEATURE_COPY.zh)[key] || key);
  Object.entries(vars || {}).forEach(([k,v]) => { out = out.replaceAll('{' + k + '}', v); });
  return out;
}

/* 每条： [简体中文, English, Español] */
const STR = {
  'app.title': [SITE_CONFIG.branding.title, SITE_CONFIG.branding.titleEn, SITE_CONFIG.branding.titleEs],
  'app.team': [SITE_CONFIG.branding.team, SITE_CONFIG.branding.teamEn, SITE_CONFIG.branding.teamEs],

  'login.email': ['邮箱', 'Email', 'Correo electrónico'],
  'login.password': ['密码', 'Password', 'Contraseña'],
  'login.signin': ['登录', 'Sign in', 'Iniciar sesión'],
  'login.signingIn': ['登录中…', 'Signing in…', 'Iniciando sesión…'],
  'login.captchaRequired': ['请先完成人机验证。', 'Complete the security check first.', 'Completa primero la verificación de seguridad.'],
  'login.demoTitle': ['演示账号', 'Demo accounts', 'Cuentas de demostración'],
  'login.localMode': ['本地安全测试模式：仅使用本机演示数据，不连接正式 Supabase。', 'Safe local test mode: demo data only; production Supabase is disconnected.', 'Modo local seguro: solo datos de demostración; Supabase de producción está desconectado.'],
  'login.localEnter': ['以 {name} 身份进入演示', 'Enter demo as {name}', 'Entrar en demo como {name}'],
  'login.hint': ['用不同账号登录，可以看到负责人、成员和管理员之间的权限差异。',
    'Sign in with different accounts to see the permission differences between owners, members, and the administrator.',
    'Entra con distintas cuentas para ver las diferencias de permisos entre responsables, miembros y administración.'],
  'login.errNoUser': ['没有找到这个邮箱对应的成员。', 'No team member matches that email.', 'No hay ningún miembro con ese correo.'],
  'login.errBadPass': ['密码错误，还剩 {n} 次机会！', 'Incorrect password. {n} attempts remaining!', 'Contraseña incorrecta. ¡Quedan {n} intentos!'],
  'login.errExpired': ['登录已过期，请重新登录。', 'Your session expired. Please sign in again.', 'Tu sesión ha caducado. Inicia sesión de nuevo.'],
  'login.errCooldown': ['密码连续输错，请 {n} 秒后再试。', 'Too many failed attempts. Try again in {n} seconds.', 'Demasiados intentos fallidos. Inténtalo de nuevo en {n} segundos.'],
  'toast.welcome': ['欢迎回来，{name}', 'Welcome back, {name}', 'Bienvenido de nuevo, {name}'],

  'nav.dashboard': ['首页', 'Home', 'Inicio'],
  'nav.matters': ['事项', 'Matters', 'Asuntos'],
  'nav.inbox': ['通知', 'Notifications', 'Notificaciones'],
  'nav.chat': ['聊天', 'Chat', 'Chat'],
  'chat.desc': ['团队全局聊天。可 @ 成员，引用事项、客户档案、步骤或文件，也可上传加密文件发送。', 'Team-wide chat. Mention members, reference matters, clients, steps or files, and send encrypted uploads.', 'Chat global del equipo. Menciona miembros, referencia asuntos, clientes, pasos o archivos y envía archivos cifrados.'],
  'chat.mentions': ['@ 成员（可多选）', '@ Members (select multiple)', '@ Miembros (selección múltiple)'],
  'chat.reference': ['+ 引用只读卡片', '+ Attach a read-only card', '+ Adjuntar tarjeta de solo lectura'],
  'chat.noReference': ['不引用', 'No attachment', 'Sin adjunto'],
  'chat.blocked': ['长期屏蔽成员', 'Members blocked from future messages', 'Miembros bloqueados para mensajes futuros'],
  'chat.block': ['屏蔽', 'Block', 'Bloquear'],
  'chat.memberPopup': ['@成员', '@ Members', '@ Miembros'],
  'chat.referencePopup': ['引用', 'Reference', 'Referencia'],
  'chat.blockedHint': ['被勾选成员看不到你之后发送的消息和引用卡片；该设置只影响你自己发送的内容。', 'Selected members cannot see messages or attached cards you send from now on. This setting affects only your own messages.', 'Los miembros seleccionados no verán los mensajes ni tarjetas que envíes desde ahora. Solo afecta a tus envíos.'],
  'chat.blockedByMe': ['已屏蔽 {names}', 'Blocked for {names}', 'Bloqueado para {names}'],
  'chat.messagePlaceholder': ['输入团队消息…', 'Write a team message…', 'Escribe un mensaje al equipo…'],
  'chat.send': ['发送', 'Send', 'Enviar'],
  'chat.matter': ['事项', 'Matter', 'Asunto'],
  'chat.client': ['客户档案', 'Client record', 'Expediente de cliente'],
  'chat.step': ['步骤', 'Step', 'Paso'],
  'chat.file': ['文件', 'File', 'Archivo'],
  'chat.uploadFiles': ['上传文件并发送', 'Upload files and send', 'Subir archivos y enviar'],
  'chat.selectedFiles': ['已选择：{names}', 'Selected: {names}', 'Seleccionados: {names}'],
  'nav.clients': ['客户档案', 'Clients', 'Clientes'],
  'nav.settings': ['信息', 'Info', 'Información'],
  'nav.trash': ['回收站', 'Recycle bin', 'Papelera'],
  'topbar.signout': ['退出登录', 'Sign out', 'Cerrar sesión'],
  'banner.noStorage': ['⚠️ 这个浏览器不允许网页在本机保存数据，所以你现在改的东西刷新后会丢。换成 GitHub Pages 网址打开，或者用 Chrome 打开这个文件就正常了。',
    '⚠️ This browser does not let the page save data locally, so your changes will be lost when you refresh. Open it from the GitHub Pages URL, or open the file in Chrome.',
    '⚠️ Este navegador no permite guardar datos localmente: los cambios se perderán al recargar. Ábrelo desde la URL de GitHub Pages o con Chrome.'],
  'sync.ok': ['已同步', 'Synced', 'Sincronizado'],
  'sync.loading': ['同步中…', 'Syncing…', 'Sincronizando…'],
  'sync.error': ['未同步', 'Not synced', 'Sin sincronizar'],
  'sync.failedClick': ['未同步，点这里！', 'Not synced — click here!', 'Sin sincronizar: ¡haz clic aquí!'],
  'sync.errorModalTitle': ['发生错误！', 'An error occurred!', '¡Se produjo un error!'],
  'sync.errorModalSend': ['请将上面的文字发送给 Benson（yanyi13411696203@163.com），谢谢', 'Please send the text above to Benson (yanyi13411696203@163.com). Thank you.', 'Envía el texto anterior a Benson (yanyi13411696203@163.com). Gracias.'],
  'sync.offline': ['离线：改动只留在这台设备', 'Offline: changes stay on this device', 'Sin conexión: los cambios quedan aquí'],
  'sync.tablesMissing': ['数据表还没建好，请在 Supabase 里执行建表脚本', 'The tables are missing — run the setup SQL in Supabase', 'Faltan las tablas: ejecuta el SQL de configuración en Supabase'],
  'sync.tipOk': ['三台设备共用同一份数据 · 最近同步 {time} · 点一下立刻刷新',
    'All devices share one dataset · last synced {time} · click to refresh now',
    'Todos los dispositivos comparten los datos · última sincronización {time} · haz clic para refrescar'],
  'sync.tipError': ['同步失败：{msg}。改动已存在本机，稍后会自动重试。',
    'Sync failed: {msg}. Your changes are saved locally, and the app will try again automatically.',
    'Error de sincronización: {msg}. Tus cambios están guardados en este dispositivo y la aplicación volverá a intentarlo automáticamente.'],

  'dash.morning': ['早上好，{name}', 'Good morning, {name}', 'Buenos días, {name}'],
  'dash.afternoon': ['下午好，{name}', 'Good afternoon, {name}', 'Buenas tardes, {name}'],
  'dash.evening': ['晚上好，{name}', 'Good evening, {name}', 'Buenas noches, {name}'],
  'dash.desc': ['先看红色，再看今天要推进的。每件事都必须有人负责、有下一步、有截止日。',
    'Start with urgent matters, then review what needs attention today. Every matter needs an owner, a next step, and a due date.',
    'Empieza por los asuntos urgentes y después revisa lo que requiere atención hoy. Cada asunto debe tener responsable, próximo paso y fecha límite.'],
  'dash.new': ['＋ 新建事项', '＋ New matter', '＋ Nuevo asunto'],
  'dash.kpi.red': ['🔴 红色事项', '🔴 Red matters', '🔴 Asuntos rojos'],
  'dash.kpi.redFoot': ['需要立即处理', 'Needs immediate action', 'Requieren acción inmediata'],
  'dash.kpi.due': ['📅 本周到期', '📅 Due this week', '📅 Vencen esta semana'],
  'dash.kpi.dueFoot': ['7 天内截止', 'Due within 7 days', 'Vencen en 7 días'],
  'dash.kpi.mine': ['⏳ 等我推进', '⏳ Waiting on me', '⏳ Pendientes de mí'],
  'dash.kpi.mineFoot': ['我要做的事情', 'Things I need to do', 'Mis tareas'],
  'dash.kpi.visible': ['👀 我能看到', '👀 I can see', '👀 Puedo ver'],
  'dash.kpi.visibleAdmin': ['Carol · 全部事项', 'Carol · all matters', 'Carol · todos los asuntos'],
  'dash.kpi.visibleMember': ['仅我是项目成员的事项', 'Only matters I am assigned to', 'Solo asuntos en los que participo'],
  'dash.today': ['今天要处理的', 'To do today', 'Para hoy'],
  'dash.todayDesc': ['红色 + 黄色事项，按紧急程度排序。点任意一行可以打开详情。',
    'Red + yellow matters, most urgent first. Click any row to open it.',
    'Asuntos rojos y amarillos, los más urgentes primero. Haz clic en una fila para abrirla.'],
  'dash.empty': ['目前没有需要关注的事项 🎉', 'Nothing needs attention right now 🎉', 'Nada requiere atención por ahora 🎉'],
  'legend.green': ['🟢 正常推进', '🟢 On track', '🟢 En curso'],
  'legend.yellow': ['🟡 等待客户／第三方／有风险', '🟡 Waiting on client / third party / at risk', '🟡 Esperando al cliente o a terceros / en riesgo'],
  'legend.red': ['🔴 需要团队立即处理', '🔴 Team must act now', '🔴 El equipo debe actuar ya'],

  'list.title': ['事项', 'Matters', 'Asuntos'],
  'list.desc': ['共 {n} 条', '{n} matters', '{n} asuntos'],
  'list.descAdmin': ['（Carol，全部事项）', '(Carol, all matters)', '(Carol, todos los asuntos)'],
  'list.descMember': ['（只含你是项目成员的事项）', '(only matters you are assigned to)', '(solo asuntos en los que participas)'],
  'list.export': ['导出CSV表格', 'Export CSV spreadsheet', 'Exportar tabla CSV'],
  'list.bulkDelete': ['批量删除', 'Bulk delete', 'Eliminar en lote'],
  'list.import': ['Excel/CSV导入', 'Import Excel/CSV', 'Importar Excel/CSV'],
  'modal.import.title': ['Excel/CSV导入事项', 'Import matters from Excel/CSV', 'Importar asuntos desde Excel/CSV'],
  'modal.import.hint': ['支持同时选择多个文件。第一行必须是表头。截止日期可留空，“截止方式”可填具体日期、ASAP 或不设置；常见近义表头也能识别。', 'You can select multiple files. The first row must contain headers. Due date is optional; Due setting accepts Specific date, ASAP, or No due date. Common header synonyms are recognized.', 'Puedes seleccionar varios archivos. La primera fila debe contener encabezados. La fecha límite es opcional; Tipo de vencimiento admite Fecha concreta, ASAP o Sin fecha límite. Se reconocen sinónimos habituales.'],
  'modal.import.choose': ['选择 .xlsx、.xls 或 .csv 文件', 'Choose .xlsx, .xls, or .csv files', 'Elige archivos .xlsx, .xls o .csv'],
  'modal.import.confirm': ['导入事项', 'Import matters', 'Importar asuntos'],
  'modal.import.importing': ['导入中…', 'Importing…', 'Importando…'],
  'modal.import.result': ['已导入 {ok} 条，跳过 {bad} 条', 'Imported {ok}; skipped {bad}', 'Importados {ok}; omitidos {bad}'],
  'modal.import.invalid': ['格式不对，是否查看示例文件？', 'The format is incorrect. Would you like to view a sample file?', 'El formato no es correcto. ¿Quieres ver un archivo de ejemplo?'],
  'modal.import.yes': ['查看示例文件', 'View sample file', 'Ver archivo de ejemplo'],
  'modal.import.no': ['否', 'No', 'No'],
  'modal.import.sample': ['示例文件', 'Sample file', 'Archivo de ejemplo'],
  'modal.export.title': ['导出CSV表格', 'Export CSV spreadsheet', 'Exportar tabla CSV'],
  'modal.export.body': ['CSV 表格可用 Excel 打开。', 'CSV spreadsheets can be opened in Excel.', 'Las tablas CSV se pueden abrir con Excel.'],
  'modal.export.confirm': ['下载CSV表格', 'Download CSV', 'Descargar CSV'],
  'list.search': ['搜索客户、事项、这一步', 'Search client, matter, current step', 'Buscar cliente, asunto, paso actual'],
  'list.allAreas': ['全部业务类型', 'All practice areas', 'Todas las áreas'],
  'list.allOwners': ['全部负责人', 'All owners', 'Todos los responsables'],
  'list.allStatus': ['全部状态', 'All statuses', 'Todos los estados'],
  'list.allWaiting': ['全部等待对象', 'All waiting statuses', 'Todos los estados de espera'],
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
  'inbox.desc': ['事项、文件、客户和日程操作通知。聊天消息请到独立的“聊天”页面查看。',
    'Matter, file, client, and schedule notifications. Messages are kept on the separate Chat page.',
    'Avisos de asuntos, archivos, clientes y agenda. Los mensajes están en la página Chat.'],
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
  'inbox.markAllRead': ['全部已读', 'Mark all as read', 'Marcar todo como leído'],
  'inbox.selectAll': ['全选通知', 'Select all notifications', 'Seleccionar todas las notificaciones'],
  'inbox.bulkDelete': ['批量删除', 'Delete selected', 'Eliminar seleccionadas'],
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
  'inbox.fileAdd': ['{actor} 在事项“{title}”中上传了文件“{name}”。',
    '{actor} uploaded the file “{name}” to “{title}”.',
    '{actor} subió el archivo «{name}» al asunto «{title}».'],
  'inbox.fileRemove': ['{actor} 从事项“{title}”中删除了文件“{name}”。',
    '{actor} deleted the file “{name}” from “{title}”.',
    '{actor} eliminó el archivo «{name}» del asunto «{title}».'],
  'inbox.chat': ['{actor} 在事项“{title}”中发送消息：“{message}”',
    '{actor} sent a message in “{title}”: “{message}”',
    '{actor} envió un mensaje en «{title}»: «{message}»'],
  'inbox.scheduleReminder': ['日程提醒：{message}', 'Schedule reminder: {message}', 'Recordatorio: {message}'],
  'inbox.deadlineReminder': ['截止提醒：{kind}，{title}，截止日期 {date}', 'Deadline reminder: {kind}, {title}, due {date}', 'Recordatorio de vencimiento: {kind}, {title}, vence {date}'],
  'inbox.clientCreated': ['{actor} 创建了客户档案“{client}”。', '{actor} created the client record “{client}”.', '{actor} creó el expediente del cliente «{client}».'],
  'inbox.clientUpdated': ['{actor} 修改了客户档案“{client}”。', '{actor} updated the client record “{client}”.', '{actor} actualizó el expediente del cliente «{client}».'],
  'inbox.clientDeleted': ['{actor} 删除了客户档案“{client}”，已进入回收站。', '{actor} deleted the client record “{client}”; it is now in the recycle bin.', '{actor} eliminó el expediente «{client}»; ahora está en la papelera.'],
  'inbox.clientRestored': ['{actor} 从回收站恢复了客户档案“{client}”。', '{actor} restored the client record “{client}”.', '{actor} restauró el expediente «{client}».'],
  'inbox.clientContacted': ['{actor} 将事项“{title}”的最后联系时间更新为 {time}。', '{actor} updated the last contact time for “{title}” to {time}.', '{actor} actualizó la hora del último contacto de «{title}» a {time}.'],
  'inbox.readReceipt': ['{reader} 已读您的通知【{preview}】',
    '{reader} read your notification [{preview}]',
    '{reader} leyó tu notificación [{preview}]'],

  'status.green': ['绿 · 正常', 'Green · On track', 'Verde · En curso'],
  'status.green.short': ['正常', 'On track', 'En curso'],
  'status.yellow': ['黄 · 关注', 'Yellow · Needs attention', 'Amarillo · Requiere atención'],
  'status.yellow.short': ['关注', 'Needs attention', 'Requiere atención'],
  'status.red': ['红 · 紧急', 'Red · Urgent', 'Rojo · Urgente'],
  'status.red.short': ['紧急', 'Urgent', 'Urgente'],

  'wait.none': ['—', '—', '—'],
  'wait.client': ['客户', 'Client', 'Cliente'],
  'wait.counterparty': ['对方律师', 'Opposing counsel', 'Abogado de la contraparte'],
  'wait.authority': ['政府部门', 'Government authority', 'Autoridad'],
  'wait.notary': ['墨西哥公证', 'Mexican notary', 'Notaría (México)'],
  'wait.bank': ['银行', 'Bank', 'Banco'],
  'wait.ofac': ['OFAC', 'OFAC', 'OFAC'],
  'wait.tax': ['税务顾问', 'Tax adviser', 'Asesor fiscal'],
  'wait.carol': ['Carol', 'Carol', 'Carol'],
  'wait.benson': ['Benson', 'Benson', 'Benson'],
  'wait.other': ['其他', 'Other', 'Otro'],

  'stage.engagement': ['立项委托', 'Engagement', 'Encargo'],
  'stage.consultation': ['咨询', 'Consultation', 'Consulta'],
  'stage.dd': ['尽职调查', 'Due diligence', 'Debida diligencia'],
  'stage.research': ['法律研究', 'Legal research', 'Investigación legal'],
  'stage.drafting': ['文件起草', 'Drafting', 'Redacción'],
  'stage.filing': ['申报递交', 'Filing / submission', 'Presentación'],
  'stage.gov': ['政府审批', 'Government review', 'Revisión de la autoridad'],
  'stage.closing': ['交割结项', 'Closing', 'Cierre'],
  'stage.hold': ['暂停', 'On hold', 'En pausa'],

  'role.carol': ['中国律师 · 团队负责人', 'China-qualified lawyer · Team lead', 'Abogada en China · Líder del equipo'],
  'role.benson': ['协作成员', 'Team member', 'Miembro del equipo'],

  'back.toList': ['← 返回事项列表', '← Back to matters', '← Volver a asuntos'],
  'back.toSettings': ['← 返回回收站', '← Back to recycle bin', '← Volver a la papelera'],
  'back.toDashboard': ['← 回到工作台', '← Back to dashboard', '← Volver al panel'],

  'detail.info': ['事项信息', 'Matter details', 'Datos del asunto'],
  'detail.client': ['客户', 'Client', 'Cliente'],
  'detail.counterparties': ['对方当事人', 'Opposing parties', 'Contrapartes'],
  'detail.relatedParties': ['关联方', 'Related parties', 'Partes relacionadas'],
  'detail.title': ['事项名称', 'Matter name', 'Nombre del asunto'],
  'detail.area': ['业务类型', 'Practice area', 'Área'],
  'detail.areaHint': ['换业务类型会自动把项目成员改成该类事项的默认成员。', 'Changing the practice area resets the matter members to the defaults for that area.', 'Al cambiar el área de práctica, los miembros del asunto vuelven a la selección predeterminada para esa área.'],
  'detail.stage': ['当前阶段', 'Current stage', 'Etapa actual'],
  'detail.owner': ['负责人（唯一）', 'Sole owner', 'Único responsable'],
  'detail.nextOwner': ['谁做这一步？', 'Who will do this step?', '¿Quién hará este paso?'],
  'detail.status': ['状态', 'Status', 'Estado'],
  'detail.due': ['截止日期', 'Due date', 'Fecha límite'],
  'detail.dueMode': ['截止方式', 'Due setting', 'Tipo de vencimiento'],
  'detail.dueDate': ['具体日期', 'Specific date', 'Fecha concreta'],
  'detail.dueNone': ['不设置', 'No due date', 'Sin fecha límite'],
  'detail.dueAsap': ['ASAP（每天提醒）', 'ASAP (daily reminder)', 'ASAP (aviso diario)'],
  'detail.waiting': ['等待谁', 'Waiting for', 'Esperando a'],
  'detail.lastContact': ['最后联系客户', 'Last client contact', 'Último contacto con el cliente'],
  'detail.next': ['现在要做什么？', 'What needs to be done now?', '¿Qué hay que hacer ahora?'],
  'detail.reason': ['状态说明（黄／红必填）', 'Status note (required for yellow / red)', 'Nota de estado (obligatoria si es amarillo o rojo)'],
  'detail.reasonPh': ['例如：等墨方土地意见，客户在催', 'e.g. Waiting for the Mexico land-use opinion; the client is following up', 'p. ej. A la espera del dictamen sobre el terreno en México; el cliente está dando seguimiento'],
  'form.reasonPh': ['为什么急', 'Why is it urgent?', '¿Por qué es urgente?'],
  'detail.background': ['背景', 'Background', 'Antecedentes'],
  'detail.priority': ['优先级', 'Priority', 'Prioridad'],
  'detail.startDate': ['开始日期', 'Start date', 'Fecha de inicio'],
  'detail.totalFee': ['费用总额', 'Total fee', 'Honorarios totales'],
  'detail.paymentsReceived': ['已收款', 'Payments received', 'Pagos recibidos'],
  'detail.balance': ['余额', 'Balance', 'Saldo'],
  'detail.contactName': ['联系人', 'Contact name', 'Persona de contacto'],
  'detail.contactEmail': ['联系邮箱', 'Contact email', 'Correo de contacto'],
  'detail.notes': ['备注', 'Notes', 'Notas'],
  'detail.members': ['项目成员', 'Matter members', 'Miembros del asunto'],
  'detail.membersHint': ['只有勾进来的人能打开这条事项，没勾的人连列表里都看不到。Carol 始终能看到全部。负责人是唯一对结果负责的人。',
    'Only the people selected here can open this matter; everyone else will not even see it in the list. Carol can always see all matters. The owner is the person accountable for the outcome.',
    'Solo las personas marcadas aquí pueden abrir este asunto; las demás ni siquiera lo verán en la lista. Carol siempre puede verlos todos. El responsable es quien rinde cuentas del resultado.'],
  'detail.save': ['保存修改', 'Save changes', 'Guardar cambios'],
  'detail.undoEdit': ['撤回上次修改', 'Undo last edit', 'Deshacer última modificación'],
  'detail.delete': ['删除这条事项', 'Delete this matter', 'Eliminar este asunto'],
  'detail.deleteHintOwner': ['删除后进入回收站，在设置页可以恢复。', 'Deleted matters go to the Recycle Bin, where you can restore them.', 'Los asuntos eliminados van a la papelera, donde puedes restaurarlos.'],
  'detail.deleteHintOther': ['只有项目负责人 {name} 才能删除这条事项。', 'Only the matter owner, {name}, can delete it.', 'Solo el responsable del asunto, {name}, puede eliminarlo.'],
  'detail.deleteHintAdmin': ['Carol 可以删除任何事项；删除后进回收站，可在设置页恢复。',
    'Carol can delete any matter. Deleted matters go to the Recycle Bin, where they can be restored.',
    'Carol puede eliminar cualquier asunto. Los asuntos eliminados van a la papelera, donde pueden restaurarse.'],
  'detail.notFound': ['找不到这个事项。', 'Matter not found.', 'No se encontró el asunto.'],
  'detail.noAccessTitle': ['无权查看', 'No access', 'Sin acceso'],
  'detail.noAccess1': ['「{no} {title}」的项目成员里没有你，所以打不开。', 'You are not a member of “{no} {title}”, so you cannot open it.', 'No eres miembro de «{no} {title}», así que no puedes abrirlo.'],
  'detail.noAccess2': ['需要参与的话，请项目负责人 {owner} 或 Carol 把你的名字勾进「项目成员」。',
    'To take part, ask the matter owner {owner} or Carol to add you under Matter members.',
    'Para participar, pide al responsable {owner} o a Carol que te añada en Miembros del asunto.'],
  'detail.trashTitle': ['这条事项在回收站里', 'This matter is in the recycle bin', 'Este asunto está en la papelera'],
  'detail.trashWhen': ['删除时间：{when}', 'Deleted: {when}', 'Eliminado: {when}'],
  'detail.trashRestore': ['恢复这条事项', 'Restore this matter', 'Restaurar este asunto'],
  'detail.trashAdminOnly': ['仅事项负责人 {name} 可操作', 'Only the matter owner, {name}, can take this action', 'Solo el responsable del asunto, {name}, puede realizar esta acción'],
  'detail.step.title': ['当前步骤', 'Current step', 'Paso actual'],
  'detail.step.button': ['完成当前步骤 →', 'Complete this step →', 'Completar este paso →'],
  'detail.step.hintOwner': ['完成时会让你填写下一步：阶段、状态、截止日期、在等谁、下一步做什么、下一步负责人。',
    'When you complete this step, you will enter the next stage, status, due date, who or what you are waiting for, the next action, and its owner.',
    'Al completar este paso, indicarás la etapa, el estado y la fecha límite siguientes, a quién o qué se espera, la próxima acción y su responsable.'],
  'detail.step.hintOther': ['只有当前步骤负责人 {name} 才能完成这一步。', 'Only the owner of the current step, {name}, can complete it.', 'Solo el responsable del paso actual, {name}, puede completarlo.'],
  'detail.step.hintAdmin': ['Carol 可以代为完成这一步（正常由 {name} 负责）。',
    'Carol can complete this step on their behalf (normally {name}).',
    'Carol puede completar este paso (normalmente lo hace {name}).'],
  'detail.undo.button': ['撤销到上一步【{text}】', 'Undo to previous step [{text}]', 'Deshacer al paso anterior [{text}]'],
  'detail.undo.hint': ['撤销会把事项退回上一步，并删掉那条完成记录。',
    'Undo sends the matter back one step and removes that completion record.',
    'Deshacer devuelve el asunto un paso atrás y borra ese registro.'],
  'detail.undo.hintDenied': ['只有 Carol，或刚完成这一步的人，可以撤销。',
    'Only Carol, or the person who just completed the step, can undo.',
    'Solo Carol o quien acaba de completar el paso puede deshacer.'],
  'detail.step.waiting': ['⏳ 在等：{w}', '⏳ Waiting for: {w}', '⏳ En espera de: {w}'],
  'detail.history.title': ['已完成的步骤', 'Completed steps', 'Pasos completados'],
  'detail.history.count': ['{n} 步', '{n} steps', '{n} pasos'],
  'detail.history.empty': ['还没有完成过步骤。点上面的「完成当前步骤」推进第一条。', 'No steps completed yet. Use “Complete this step” above to move it forward.', 'Aún no hay pasos completados. Usa «Completar este paso» para avanzar.'],
  'detail.history.meta': ['{who} · 完成于 {when}（原定 {due}）', '{who} · completed {when} (was due {due})', '{who} · completado {when} (vencía {due})'],
  'detail.history.by': [' · 由 {name} 操作', ' · by {name}', ' · por {name}'],
  'detail.files.title': ['文件', 'Files', 'Archivos'],
  'detail.files.version': ['v{n}', 'v{n}', 'v{n}'],
  'detail.files.uploaded': ['{name} · {time}', '{name} · {time}', '{name} · {time}'],
  'detail.files.add': ['＋ 添加', '＋ Add', '＋ Añadir'],
  'detail.files.empty': ['还没有文件。事项成员可以下载并查看你上传的文件，你也可以删除你上传的文件。',
    'No files yet. Matter members can download and view files you upload, and you can delete files you uploaded.',
    'Aún no hay archivos. Los miembros del asunto pueden descargar y ver los archivos que subas, y puedes eliminar los archivos que hayas subido.'],
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
  'detail.entry.fileAdd': ['上传文件：{name}', 'File uploaded: {name}', 'Archivo subido: {name}'],
  'detail.entry.fileRemove': ['删除文件：{name}', 'File deleted: {name}', 'Archivo eliminado: {name}'],
  'detail.entry.deleted': ['删除事项（已进入回收站）', 'Matter deleted (moved to recycle bin)', 'Asunto eliminado (a la papelera)'],
  'detail.entry.restored': ['从回收站恢复', 'Restored from recycle bin', 'Restaurado desde la papelera'],
  'detail.entry.stepUndo': ['撤销到上一步：{text}', 'Returned to the previous step: {text}', 'Se volvió al paso anterior: {text}'],
  'detail.entry.stepDone': ['完成步骤：{text}（负责人 {owner}）', 'Step completed: {text} (owner {owner})', 'Paso completado: {text} (responsable {owner})'],
  'detail.entry.stageMove': ['阶段推进：{from} → {to}', 'Stage changed: {from} → {to}', 'Cambio de etapa: {from} → {to}'],
  'detail.entry.advanced': ['状态 {status}｜下一步：{next}（{owner}，{due}）', 'Status {status} | next: {next} ({owner}, {due})', 'Estado {status} | siguiente: {next} ({owner}, {due})'],
  'detail.entry.chat': ['发送消息：{message}', 'Message sent: {message}', 'Mensaje enviado: {message}'],
  'detail.entry.readReceipt': ['{reader} 已读通知', '{reader} read the notification', '{reader} leyó la notificación'],

  'settings.title': ['信息', 'Info', 'Información'],
  'settings.desc': ['成员、可见范围和安全性。',
    'Members, visibility, and security.',
    'Miembros, visibilidad y seguridad.'],
  'settings.reset': ['重置演示数据', 'Reset demo data', 'Restablecer datos de demo'],
  'settings.members': ['团队成员', 'Team members', 'Miembros del equipo'],
  'th.name': ['姓名', 'Name', 'Nombre'],
  'th.email': ['邮箱', 'Email', 'Correo'],
  'th.role': ['角色', 'Role', 'Rol'],
  'th.access': ['权限', 'Access', 'Acceso'],
  'settings.admin': ['Carol', 'Carol', 'Carol'],
  'settings.member': ['成员', 'Member', 'Miembro'],
  'settings.loginHint': ['使用团队分配的邮箱和密码登录。',
    'Sign in with the email address and password assigned to your team account.',
    'Inicia sesión con el correo y la contraseña asignados a tu cuenta del equipo.'],
  'settings.defaultTeam': ['新事项默认勾选谁', 'Default members for new matters', 'Miembros predeterminados'],
  'settings.defaultTeamHint': ['真正的门禁是事项里的「项目成员」：只有被勾选的人能打开它，别人连列表里都看不到。这张表只是新建时的默认值，每一条事项都可以单独调整。<br>Carol 始终能看到全部事项。',
    'Access is controlled by the “Matter members” list: only selected people can open a matter, and everyone else will not even see it. This table only sets the default members for new matters; each matter can be adjusted separately.<br>Carol can always see all matters.',
    'El control real son los «Miembros del asunto»: solo quienes estén marcados pueden abrirlo y los demás ni lo ven en la lista. Esta tabla es solo el valor predeterminado y cada asunto puede ajustarse.<br>Carol siempre puede verlos todos.'],
  'settings.trash': ['回收站', 'Recycle bin', 'Papelera'],
  'settings.trashCount': ['{n} 条', '{n} items', '{n} elementos'],
  'settings.trashEmpty': ['回收站是空的。删除的事项或客户档案会先放到这里。', 'The recycle bin is empty. Deleted matters and client records appear here.', 'La papelera está vacía. Aquí aparecen asuntos y clientes eliminados.'],
  'settings.trashMeta': ['{client} · 删除于 {when}', '{client} · deleted {when}', '{client} · eliminado {when}'],
  'settings.trashRestore': ['恢复', 'Restore', 'Restaurar'],
  'settings.trashPurge': ['彻底删除', 'Delete forever', 'Eliminar definitivamente'],
  'trash.selectAll': ['全选可操作事项', 'Select all available', 'Seleccionar todos los disponibles'],
  'trash.bulkPurge': ['批量彻底删除', 'Delete forever in bulk', 'Eliminar definitivamente en lote'],
  'settings.trashAdminOnly': ['仅事项负责人{name}可操作', 'Only the matter owner, {name}, can take this action', 'Solo el responsable del asunto, {name}, puede realizar esta acción'],
  'settings.trashHint': ['恢复或彻底删除，只能由原负责人或创建者操作。', 'Only the original owner or creator can restore or permanently delete an item.', 'Solo el responsable o creador original puede restaurar o eliminar definitivamente.'],
  'trash.desc': ['删除的事项和客户档案会保留在这里，可以恢复或彻底删除。', 'Deleted matters and client records stay here and can be restored or permanently deleted.', 'Los asuntos y clientes eliminados permanecen aquí y pueden restaurarse o eliminarse definitivamente.'],
  'modal.new.title': ['新建事项', 'New matter', 'Nuevo asunto'],
  'modal.new.submit': ['创建事项', 'Create matter', 'Crear asunto'],
  'conflict.title': ['发现潜在利益冲突', 'Potential conflict found', 'Posible conflicto detectado'],
  'conflict.body': ['以下名称与现有资料相似：\n\n{matches}\n\n请确认不是同一主体或利益冲突后再继续。', 'These names are similar to existing records:\n\n{matches}\n\nConfirm that they do not represent the same party or a conflict before continuing.', 'Estos nombres se parecen a registros existentes:\n\n{matches}\n\nConfirma que no corresponden a la misma parte ni generan un conflicto antes de continuar.'],
  'conflict.continue': ['确认并继续创建', 'Confirm and continue', 'Confirmar y continuar'],
  'conflict.check': ['检查利益冲突', 'Check conflicts', 'Comprobar conflictos'],
  'conflict.clear': ['未发现相似的现有主体。', 'No similar existing parties were found.', 'No se encontraron partes existentes similares.'],
  'conflict.editTitle': ['发现潜在利益冲突', 'Potential conflict found', 'Posible conflicto detectado'],
  'conflict.saved': ['已完成利益冲突检查', 'Conflict check completed', 'Comprobación de conflictos completada'],
  'syncConflict.title': ['检测到其他人的修改', 'Another person changed this matter', 'Otra persona modificó este asunto'],
  'syncConflict.body': ['服务器上的事项已经更新。为避免覆盖他人的修改，本次保存已停止。请重新载入最新内容后再修改。', 'The matter has changed on the server. Saving stopped to avoid overwriting someone else’s work. Reload the latest version before editing again.', 'El asunto cambió en el servidor. Se detuvo el guardado para no sobrescribir el trabajo de otra persona. Vuelve a cargar la versión más reciente antes de editar.'],
  'syncConflict.reload': ['重新载入最新内容', 'Reload latest version', 'Cargar la versión más reciente'],
  'clients.title': ['客户档案', 'Client records', 'Expedientes de clientes'],
  'clients.desc': ['集中记录客户资料与沟通进度。', 'Client details and communication progress.', 'Datos del cliente y progreso de comunicación.'],
  'clients.new': ['新建客户', 'New client', 'Nuevo cliente'],
  'clients.import': ['Excel/CSV 导入', 'Import Excel/CSV', 'Importar Excel/CSV'],
  'clients.empty': ['还没有客户档案。', 'No client records yet.', 'Aún no hay expedientes de clientes.'],
  'clients.name': ['客户名称', 'Client name', 'Nombre del cliente'],
  'clients.contact': ['联系人', 'Contact person', 'Persona de contacto'],
  'clients.phone': ['电话', 'Phone', 'Teléfono'],
  'clients.email': ['邮箱', 'Email', 'Correo electrónico'],
  'clients.progress': ['沟通进度', 'Communication progress', 'Progreso de comunicación'],
  'clients.lastContact': ['最后联系', 'Last contact', 'Último contacto'],
  'clients.notes': ['备注', 'Notes', 'Notas'],
  'clients.actions': ['操作', 'Actions', 'Acciones'],
  'clients.edit': ['编辑', 'Edit', 'Editar'],
  'clients.delete': ['删除', 'Delete', 'Eliminar'],
  'clients.save': ['保存客户', 'Save client', 'Guardar cliente'],
  'clients.saved': ['客户档案已保存', 'Client record saved', 'Expediente guardado'],
  'clients.deleteTitle': ['删除客户档案？', 'Delete client record?', '¿Eliminar expediente?'],
  'clients.deleteBody': ['只删除客户档案，不会删除已有事项。', 'Only the client record is deleted; existing matters remain.', 'Solo se elimina el expediente; los asuntos existentes permanecen.'],
  'clients.importTitle': ['导入客户档案', 'Import client records', 'Importar expedientes'],
  'clients.importHint': ['支持多选 .xlsx、.xls 和 .csv 文件。至少需要“客户名称”一列。', 'You can select multiple .xlsx, .xls, or .csv files. Each file must include a “Client name” column.', 'Puedes seleccionar varios archivos .xlsx, .xls o .csv. Cada archivo debe incluir una columna «Nombre del cliente».'],
  'clients.imported': ['已导入 {n} 条客户档案', 'Imported {n} client records', 'Se importaron {n} expedientes'],
  'clients.statusUpdated': ['已更新状态', 'Status updated', 'Estado actualizado'],
  'clients.custom': ['自定义……', 'Custom…', 'Personalizado…'],
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
  'modal.new.membersHint': ['只有勾选的成员能打开这条事项；更换业务类型会重设默认成员。',
    'Only selected members can open this matter. Changing the practice area resets the default members.',
    'Solo los miembros seleccionados pueden abrir este asunto. Al cambiar el área se restablecen los miembros predeterminados.'],
  'settings.sessions': ['登录设备', 'Signed-in devices', 'Dispositivos conectados'],
  'settings.sessionsDesc': ['发现异常时，可立即退出包括本机在内的所有登录。', 'If something looks wrong, immediately sign out every session, including this one.', 'Si detectas algo extraño, cierra inmediatamente todas las sesiones, incluida esta.'],
  'settings.deviceCurrent': ['当前设备', 'Current device', 'Dispositivo actual'],
  'settings.deviceLastSeen': ['最近活动：{time}', 'Last active: {time}', 'Última actividad: {time}'],
  'settings.deviceLocation': ['位置：{place}', 'Location: {place}', 'Ubicación: {place}'],
  'settings.deviceLocationUnknown': ['位置未收集', 'Location not collected', 'Ubicación no recopilada'],
  'settings.deviceIp': ['IP：{ip}', 'IP: {ip}', 'IP: {ip}'],
  'settings.deviceRevoke': ['退出此设备', 'Sign out this device', 'Cerrar sesión en este dispositivo'],
  'settings.deviceEmpty': ['暂无已记录设备，重新登录后会显示。', 'No recorded devices yet. Sign in again to register this device.', 'Aún no hay dispositivos registrados. Vuelve a iniciar sesión.'],
  'modal.deviceRevoke.title': ['退出这台设备？', 'Sign out this device?', '¿Cerrar sesión en este dispositivo?'],
  'modal.deviceRevoke.body': ['这台设备将立即失去网站访问权限，需要重新输入密码。', 'This device will immediately lose access and must sign in again.', 'Este dispositivo perderá el acceso inmediatamente y deberá iniciar sesión de nuevo.'],
  'modal.deviceRevoke.confirm': ['确认退出', 'Sign out device', 'Cerrar sesión'],
  'settings.logoutAll': ['退出所有设备', 'Sign out all devices', 'Cerrar sesión en todos'],
  'settings.securityEvents': ['查看安全记录', 'View security events', 'Ver eventos de seguridad'],
  'modal.securityEvents.title': ['最近安全记录', 'Recent security events', 'Eventos de seguridad recientes'],
  'modal.securityEvents.empty': ['暂无异常记录。', 'No security events recorded.', 'No hay eventos de seguridad.'],
  'settings.securityTools': ['安全与备份', 'Security and backup', 'Seguridad y respaldo'],
  'settings.backupExport': ['下载加密备份', 'Download encrypted backup', 'Descargar respaldo cifrado'],
  'settings.backupRestore': ['恢复加密备份', 'Restore encrypted backup', 'Restaurar respaldo cifrado'],
  'settings.backupHint': ['仅 Carol 可操作。备份仍是密文，恢复时需要原账号密码。', 'Only Carol can use these features. Backups remain encrypted and require the original account password for restoration.', 'Solo Carol puede utilizar estas funciones. Los respaldos permanecen cifrados y requieren la contraseña original para restaurarlos.'],
  'toast.backupDone': ['加密备份已下载', 'Encrypted backup downloaded', 'Respaldo cifrado descargado'],
  'toast.restoreDone': ['加密备份已恢复', 'Encrypted backup restored', 'Respaldo cifrado restaurado'],
  'modal.backupRestore.title': ['恢复加密备份？', 'Restore encrypted backup?', '¿Restaurar respaldo cifrado?'],
  'modal.backupRestore.body': ['备份中的密文数据会写回服务器。现有同编号数据将被覆盖。', 'Encrypted backup data will be written to the server. Existing matching records will be replaced.', 'Los datos cifrados se escribirán en el servidor y sustituirán los registros coincidentes.'],
  'modal.backupRestore.confirm': ['确认恢复', 'Restore backup', 'Restaurar respaldo'],
  'modal.logoutAll.title': ['退出所有设备？', 'Sign out all devices?', '¿Cerrar sesión en todos los dispositivos?'],
  'modal.logoutAll.body': ['所有设备上的登录都会失效，本机也要重新登录。账号和密码不会改变。', 'Every session will be revoked and this device must sign in again. Your account and password will not change.', 'Se revocarán todas las sesiones y tendrás que iniciar sesión de nuevo aquí. La cuenta y la contraseña no cambiarán.'],
  'modal.logoutAll.confirm': ['确认全部退出', 'Sign out everywhere', 'Cerrar todas las sesiones'],
  'modal.file.title': ['上传加密附件', 'Upload encrypted attachment', 'Subir archivo cifrado'],
  'modal.file.name': ['选择文件', 'Choose file', 'Elegir archivo'],
  'modal.file.hint': ['支持同时选择多个文件。文件会先在本机加密，再上传到私有存储。超过 20 MB 时需要确认。', 'You can select multiple files. Each file is encrypted on this device before upload to private storage. Files over 20 MB require confirmation.', 'Puedes seleccionar varios archivos. Cada archivo se cifra en este dispositivo antes de subirlo al almacenamiento privado. Los archivos de más de 20 MB requieren confirmación.'],
  'modal.file.submit': ['加密并上传', 'Encrypt and upload', 'Cifrar y subir'],
  'modal.file.uploading': ['上传中…', 'Uploading…', 'Subiendo…'],
  'modal.fileLarge.title': ['继续上传大文件？', 'Continue uploading large file?', '¿Continuar subiendo el archivo grande?'],
  'modal.fileLarge.body': ['上传的文件大于 20MB，继续可能导致设备卡顿、增加存储空间占用。确定继续上传？', 'The uploaded file is larger than 20 MB. Continuing may slow down your device and use more storage. Continue uploading?', 'El archivo supera los 20 MB. Continuar puede ralentizar el dispositivo y aumentar el uso de almacenamiento. ¿Continuar con la carga?'],
  'modal.fileLarge.confirm': ['确定继续上传', 'Continue uploading', 'Continuar carga'],
  'modal.fileDownload.title': ['确认下载文件', 'Confirm file download', 'Confirmar descarga'],
  'modal.fileDownload.body': ['要下载 {name} 吗？', 'Download {name}?', '¿Descargar {name}?'],
  'modal.fileDownload.confirm': ['下载', 'Download', 'Descargar'],
  'modal.fileRemove.title': ['确认移除文件', 'Remove this file?', '¿Eliminar este archivo?'],
  'modal.fileRemove.body': ['要移除 {name} 吗？', 'Remove {name}?', '¿Eliminar {name}?'],
  'modal.fileRemove.confirm': ['移除', 'Remove', 'Eliminar'],
  'modal.matterAction.title': ['你想干什么？', 'What would you like to do?', '¿Qué deseas hacer?'],
  'modal.matterAction.edit': ['编辑事项', 'Edit matter', 'Editar asunto'],
  'modal.matterAction.work': ['在事项中工作', 'Work on matter', 'Trabajar en el asunto'],
  'modal.chat.title': ['事项聊天', 'Matter chat', 'Chat del asunto'],
  'modal.chat.to': ['发送给事项成员', 'Send to matter members', 'Enviar a los miembros del asunto'],
  'modal.chat.members': ['群成员', 'Group members', 'Miembros del grupo'],
  'modal.chat.empty': ['还没有消息，发一条开始聊天。', 'No messages yet. Start the conversation.', 'Aún no hay mensajes. Empieza la conversación.'],
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
  'form.waiting': ['正在等待谁', 'Who are we waiting for?', '¿A quién estamos esperando?'],
  'form.nextPh': ['例如：把修改稿发给客户确认', 'e.g. Send the revised draft to the client', 'p. ej. Enviar el borrador revisado al cliente'],
  'form.stepMembers': ['当前步骤成员', 'Members for this step', 'Miembros de este paso'],
  'form.stepMembersHint': ['和详情页里的「项目成员」是同一份名单：勾谁，谁就能看到这条事项。',
    'This is the same “Matter members” list shown on the details page. Everyone selected here can see the matter.',
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
  'modal.delete.body': ['确定删除「{no} {title}」吗？\n\n删除后它会进入回收站，你和团队立刻都看不到它了；需要的话可以在设置页恢复。',
    'Delete “{no} {title}”?\n\nIt will immediately disappear for you and the team and move to the Recycle Bin, where it can be restored if needed.',
    '¿Eliminar «{no} {title}»?\n\nDesaparecerá de inmediato para ti y el equipo y se moverá a la papelera, donde podrás restaurarlo si es necesario.'],
  'modal.delete.confirm': ['删除', 'Delete', 'Eliminar'],
  'modal.bulkDelete.title': ['批量删除事项？', 'Delete matters in bulk?', '¿Eliminar asuntos en lote?'],
  'modal.bulkDelete.body': ['确定删除选中的 {n} 条事项吗？\n\n删除后将进入回收站，需要时可以恢复。',
    'Delete the {n} selected matters?\n\nThey will be moved to the recycle bin and can be restored later.',
    '¿Eliminar los {n} asuntos seleccionados?\n\nSe moverán a la papelera y podrán restaurarse más adelante.'],
  'modal.bulkDelete.confirm': ['删除 {n} 条', 'Delete {n}', 'Eliminar {n}'],
  'modal.bulkDeleteClients.title': ['批量删除客户档案？', 'Delete client records in bulk?', '¿Eliminar expedientes de clientes en lote?'],
  'modal.bulkDeleteClients.body': ['确定删除选中的 {n} 条客户档案吗？\n\n删除后将进入回收站，需要时可以恢复。',
    'Delete the {n} selected client records?\n\nThey will be moved to the recycle bin and can be restored later.',
    '¿Eliminar los {n} expedientes seleccionados?\n\nSe moverán a la papelera y podrán restaurarse más adelante.'],
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
  'modal.undo.body': ['「{text}」会重新变成当前待办步骤（负责人 {owner}，截止 {due}），刚才那条完成记录会被删掉。\n\n这一步通常是用来修正误操作。',
    '“{text}” becomes the current pending step again (owner {owner}, due {due}), and the completion record is removed.\n\nUse this to fix a mistake.',
    '«{text}» vuelve a ser el paso pendiente (responsable {owner}, vence {due}) y se borra el registro de finalización.\n\nSirve para corregir un error.'],
  'modal.undo.confirm': ['撤销', 'Undo', 'Deshacer'],
  'modal.undoEdit.title': ['撤回上次修改？', 'Undo the last edit?', '¿Deshacer la última modificación?'],
  'modal.undoEdit.body': ['将撤回 {name} 在 {when} 保存的那次事项修改。聊天、文件、步骤和删除记录不会受影响。',
    'This will undo the matter edit saved by {name} at {when}. Chat, files, steps and deletion history are not affected.',
    'Se deshará la modificación del asunto guardada por {name} a las {when}. El chat, los archivos, los pasos y el historial de eliminación no se verán afectados.'],
  'modal.undoEdit.confirm': ['撤回修改', 'Undo edit', 'Deshacer modificación'],
  'modal.denyUndoEdit.title': ['无法撤回修改', 'Cannot undo this edit', 'No se puede deshacer esta modificación'],
  'modal.denyUndoEdit.body': ['只有 Carol，或上次修改事项的人 {name}，可以撤回这次修改。',
    'Only Carol or {name}, who made the last edit, can undo it.',
    'Solo Carol o {name}, quien hizo la última modificación, puede deshacerla.'],
  'modal.disableSystem.title': ['关闭系统通知？', 'Turn off system notifications?', '¿Desactivar las notificaciones del sistema?'],
  'modal.disableSystem.body': ['注意，关闭系统通知后任何人执行操作时都不会向您发送响铃通知，团队协作时，强烈建议您开启！',
    'If you turn off system notifications, you will no longer receive an alert when another team member takes an action. We recommend keeping notifications on while working with the team.',
    'Si desactivas las notificaciones del sistema, dejarás de recibir avisos cuando otro miembro del equipo realice una acción. Recomendamos mantenerlas activadas mientras trabajas con el equipo.'],
  'modal.disableSystem.confirm': ['确认关闭', 'Turn off', 'Desactivar'],
  'modal.deleteNotification.title': ['删除这条消息？', 'Delete this message?', '¿Eliminar este mensaje?'],
  'modal.deleteNotification.body': ['删除后，这条消息将从您的通知中移除，但不会影响事项动态或其他成员收到的通知。',
    'This message will be removed from your notifications. Matter activity and other members’ copies will not be affected.',
    'Este mensaje se eliminará de tus notificaciones. La actividad del asunto y las copias de los demás miembros no se verán afectadas.'],
  'modal.deleteNotification.confirm': ['删除消息', 'Delete message', 'Eliminar mensaje'],
  'modal.bulkDeleteNotifications.title': ['批量删除通知？', 'Delete selected notifications?', '¿Eliminar las notificaciones seleccionadas?'],
  'modal.bulkDeleteNotifications.body': ['确定删除选中的 {n} 条通知吗？\n\n只会从您的通知中移除，不会影响事项动态或其他成员收到的通知。',
    'Delete the {n} selected notifications?\n\nThey will only be removed from your notifications. Matter activity and other members’ copies will not be affected.',
    '¿Eliminar las {n} notificaciones seleccionadas?\n\nSolo se eliminarán de tus notificaciones. La actividad del asunto y las copias de los demás miembros no se verán afectadas.'],
  'modal.bulkDeleteNotifications.confirm': ['删除 {n} 条通知', 'Delete {n} notifications', 'Eliminar {n} notificaciones'],
  'modal.denyUndo.title': ['无法撤销', 'Cannot undo', 'No se puede deshacer'],
  'modal.denyUndo.body': ['只有 Carol，或刚完成这一步的人，可以撤销。<br><br>最后完成这一步的是 {name}。',
    'Only Carol, or the person who completed the step, can undo.<br><br>The last completion was by {name}.',
    'Solo Carol o quien completó el paso puede deshacer.<br><br>La última finalización fue de {name}.'],
  'modal.delete.adminNote': ['\n\n（Carol 操作：这条事项的负责人是 {name}）', '\n\n(Carol action: the matter owner is {name})', '\n\n(Acción de Carol: el responsable es {name})'],
  'modal.complete.adminNote': ['Carol 操作：这一步正常由 {name} 负责。', 'Carol action: {name} is normally responsible for this step.', 'Acción de Carol: normalmente {name} es responsable de este paso.'],
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
  'toast.deleted': ['已删除 {no}，可在设置里恢复', 'Deleted {no}. You can restore it from the Recycle Bin.', 'Se eliminó {no}. Puedes restaurarlo desde la papelera.'],
  'toast.bulkDeleted': ['已删除 {n} 条事项，可在回收站恢复', '{n} matters deleted. You can restore them from the Recycle Bin.', 'Se eliminaron {n} asuntos. Puedes restaurarlos desde la papelera.'],
  'toast.bulkDeletedClients': ['已删除 {n} 条客户档案，可在回收站恢复', '{n} client records deleted. You can restore them from the Recycle Bin.', 'Se eliminaron {n} expedientes. Puedes restaurarlos desde la papelera.'],
  'toast.restored': ['已恢复 {no}', 'Restored {no}', 'Restaurado {no}'],
  'toast.purged': ['已彻底删除', 'Permanently deleted', 'Eliminado definitivamente'],
  'toast.bulkPurged': ['已彻底删除 {n} 条事项', '{n} matters permanently deleted', 'Se eliminaron definitivamente {n} asuntos'],
  'toast.stepDone': ['已完成这一步，事项进入下一步', 'Step completed — the matter moved on', 'Paso completado: el asunto ha avanzado'],
  'toast.fileAdded': ['加密文件已上传', 'Encrypted file upload complete', 'Carga de archivos cifrados completada'],
  'toast.fileDownloaded': ['附件已安全解密', 'Attachment decrypted securely', 'Archivo descifrado de forma segura'],
  'toast.fileTooLarge': ['文件不能超过 20 MB', 'File must be 20 MB or smaller', 'El archivo no puede superar 20 MB'],
  'toast.fileFailed': ['附件操作失败，请重试', 'Attachment operation failed. Try again.', 'Error con el archivo. Inténtalo de nuevo.'],
  'toast.logoutAllFailed': ['无法退出其他设备，请重试', 'Could not sign out other devices. Try again.', 'No se pudieron cerrar las otras sesiones. Inténtalo de nuevo.'],
  'toast.chatSent': ['消息已发送', 'Message sent', 'Mensaje enviado'],
  'toast.needMessage': ['请输入消息或选择文件', 'Enter a message or choose a file', 'Escribe un mensaje o elige un archivo'],
  'toast.needChatRecipient': ['请至少勾选一位事项成员', 'Select at least one matter member', 'Selecciona al menos un miembro del asunto'],
  'toast.markedRead': ['已标为已读', 'Marked as read', 'Marcado como leído'],
  'toast.markedAllRead': ['已将全部通知标为已读', 'All notifications marked as read', 'Todas las notificaciones se marcaron como leídas'],
  'toast.bulkNotificationsDeleted': ['已删除 {n} 条通知', '{n} notifications deleted', 'Se eliminaron {n} notificaciones'],
  'toast.systemEnabled': ['✅已开启系统通知', '✅ System notifications enabled', '✅ Notificaciones del sistema activadas'],
  'toast.systemDisabled': ['❎已关闭系统通知', '❎ System notifications turned off', '❎ Notificaciones del sistema desactivadas'],
  'toast.notificationDeleted': ['已删除消息', 'Message deleted', 'Mensaje eliminado'],
  'toast.systemDenied': ['系统通知已被浏览器阻止', 'System notifications have been blocked by the browser', 'El navegador ha bloqueado las notificaciones del sistema'],
  'toast.loggedOut': ['已退出登录', 'Signed out', 'Sesión cerrada'],
  'toast.reset': ['已重置为演示数据', 'Demo data restored', 'Datos de demo restablecidos'],
  'toast.areaDefault': ['已按业务类型默认勾选项目成员', 'Members reset to this area\'s defaults', 'Miembros restablecidos para esta área'],
  'toast.needClient': ['客户、事项名称、下一步、截止日期都必须填写', 'Client, matter name, next step and due date are required', 'Cliente, nombre, próximo paso y fecha límite son obligatorios'],
  'toast.needReason': ['选了黄色或红色，请写一句原因', 'Yellow or red needs a short reason', 'Amarillo o rojo requiere un motivo'],
  'toast.needNext': ['请填写下一步做什么', 'Please fill in the next step', 'Indica el próximo paso'],
  'toast.needDue': ['请填写截止日期', 'Please set a due date', 'Indica la fecha límite'],
  'toast.needStatus': ['请选择状态', 'Please choose a status', 'Elige un estado'],
  'toast.needFileName': ['请选择文件', 'Please choose a file', 'Elige un archivo'],
  'toast.onlyOwnerDelete': ['只有项目负责人 {name} 才能删除事项', 'Only the matter owner, {name}, can delete it', 'Solo el responsable, {name}, puede eliminarlo'],
  'toast.onlyOwnerEdit': ['只有事项负责人 {name} 才能修改事项', 'Only the matter owner, {name}, can edit this matter', 'Solo el responsable, {name}, puede modificar este asunto'],
  'toast.importStatusInvalid': ['事项“{title}”的“状态”填写错误，请修改！', 'The Status field for “{title}” is invalid. Please correct it.', 'El campo Estado del asunto «{title}» no es válido. Corrígelo.'],
  'modal.importStatusInvalid.title': ['导入完成，但部分内容填写错误', 'Import complete, but some entries are invalid', 'Importación completada, pero algunos datos son incorrectos'],
  'modal.importFieldInvalid': ['事项“{title}”的“{field}”填写错误，请修改！', 'The {field} field for “{title}” is invalid. Please correct it.', 'El campo {field} del asunto «{title}» no es válido. Corrígelo.'],
  'list.importError': ['错误的事项，请点击修改', 'This matter contains invalid data. Click to edit it.', 'Este asunto contiene datos no válidos. Haz clic para corregirlos.'],
  'toast.onlyStepOwner': ['只有当前步骤负责人 {name} 才能完成这一步', 'Only the current step owner, {name}, can complete it', 'Solo el responsable del paso, {name}, puede completarlo'],
  'toast.adminRestore': ['仅事项负责人 {name} 可以恢复事项', 'Only the matter owner, {name}, can restore it', 'Solo el responsable del asunto, {name}, puede restaurarlo'],
  'toast.adminPurge': ['仅事项负责人 {name} 可以彻底删除事项', 'Only the matter owner, {name}, can permanently delete it', 'Solo el responsable del asunto, {name}, puede eliminarlo definitivamente'],
  'toast.exported': ['已导出 CSV', 'CSV exported', 'CSV exportado'],

  'csv.filename': ['Matter总表.csv', 'Matter-board.csv', 'Tablero-de-asuntos.csv'],
  'csv.no': ['编号', 'No.', 'Nº'],
  'csv.client': ['客户', 'Client', 'Cliente'],
  'csv.counterparties': ['对方当事人', 'Opposing parties', 'Contrapartes'],
  'csv.relatedParties': ['关联方', 'Related parties', 'Partes relacionadas'],
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
  'csv.background': ['背景', 'Background', 'Antecedentes'],
  'csv.priority': ['优先级', 'Priority', 'Prioridad'],
  'csv.startDate': ['开始日期', 'Start date', 'Fecha de inicio'],
  'csv.totalFee': ['费用总额', 'Total fee', 'Honorarios totales'],
  'csv.paymentsReceived': ['已收款', 'Payments received', 'Pagos recibidos'],
  'csv.balance': ['余额', 'Balance', 'Saldo'],
  'csv.contactName': ['联系人', 'Contact name', 'Persona de contacto'],
  'csv.contactEmail': ['联系邮箱', 'Contact email', 'Correo de contacto'],
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
  { id: 'mx_invest', name: { zh: '墨西哥公司／投资', en: 'Mexico Corporate / Investment', es: 'Derecho corporativo / Inversión en México' }, restricted: false },
  { id: 'mx_reg', name: { zh: '墨西哥监管', en: 'Mexico Regulatory', es: 'Regulación mexicana' }, restricted: false },
  { id: 'sanctions', name: { zh: '制裁／涉美', en: 'Sanctions / U.S.-related', es: 'Sanciones / Asuntos relacionados con EE. UU.' }, restricted: true, members: ['carol', 'benson'] },
  { id: 'aml', name: { zh: '反洗钱／跨境支付', en: 'AML / Cross-border Payments', es: 'Prevención de lavado de dinero / Pagos transfronterizos' }, restricted: false },
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
const WAITING = ['none', 'client', 'counterparty', 'authority', 'notary', 'bank', 'ofac', 'tax', 'carol', 'benson', 'other'];

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
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) { return fallback; }
}
function saveSessionValue(key, value) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* ignore */ }
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
function parseISO(s) { const [y, m, dd] = String(s).slice(0,10).split('-').map(Number); return new Date(y, m - 1, dd); }
function daysFromToday(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null;
  return Math.round((parseISO(s) - today()) / 86400000);
}
const MONTHS = {
  zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
};
function fmtDate(s) {
  if (!s) return t('fmt.notSet');
  if (s === 'ASAP') return 'ASAP';
  const d = parseISO(s);
  if (lang === 'zh') return `${d.getMonth() + 1}月${d.getDate()}日`;
  if (lang === 'es') return `${d.getDate()} ${MONTHS.es[d.getMonth()]}`;
  return `${MONTHS.en[d.getMonth()]} ${d.getDate()}`;
}
function fmtDateShort(s) {
  if (!s) return '—';
  if (s === 'ASAP') return 'ASAP';
  const d = parseISO(s);
  if (lang === 'es') return `${d.getDate()}/${d.getMonth() + 1}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtStamp(t) {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtContactStamp(value) {
  if(!value) return '—';
  const dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(String(value));
  const d=dateOnly?parseISO(value):new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  const p=n=>String(n).padStart(2,'0');
  if(lang==='zh') return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日${p(d.getHours())}:${p(d.getMinutes())}`;
  if(lang==='es') return `${d.getDate()} ${MONTHS.es[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${MONTHS.en[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function dueClass(s) {
  const n = daysFromToday(s);
  if (n === null) return '';
  if (n < 0) return 'over';
  if (n <= 3) return 'soon';
  return '';
}
function dueText(s) {
  if (s === 'ASAP') return L({zh:'每天提醒',en:'Daily reminder',es:'Aviso diario'});
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
  if (/^(asap|urgent|尽快|紧急|urgente)$/i.test(raw)) return 'ASAP';
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 80000) return iso(new Date(Date.UTC(1899, 11, 30) + serial * 86400000));
  }
  const m = raw.match(/^(\d{4})\s*[年\/-](\d{1,2})\s*[月\/-](\d{1,2})日?$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const numeric = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (numeric) {
    let first = Number(numeric[1]), second = Number(numeric[2]), year = Number(numeric[3]);
    if (year < 100) year += 2000;
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) return iso(parsed);
    return '';
  }
  const d = new Date(raw.replace(/[年\/]/g, '-').replace(/月/g, '-').replace(/日/g, ''));
  return Number.isNaN(d.getTime()) ? '' : iso(d);
}
function normalizeImportedStatus(value) {
  const raw = String(value == null ? '' : value).toLowerCase()
    .replace(/[🟢🟡🔴]/g, ' ')
    .replace(/[·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const has = values => values.some(value => raw.includes(value));
  if (has(['紧急', 'urgent', 'urgente', '需要团队立即处理', 'team must act now', 'act now', 'el equipo debe actuar ya']) || ['red', 'rojo'].includes(raw)) return 'red';
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
  const all = ['carol', 'benson'];
  const cc = ['carol', 'benson'];
  const seeded = [
    {
      id: 35, no: '2026-035', client: 'ABC Ltd',
      title: { zh: '墨西哥设厂项目', en: 'Mexico plant setup', es: 'Proyecto de planta en México' },
      area: 'mx_invest', owner: 'carol', team: all, stage: 'Due Diligence',
      status: 'yellow',
      reason: { zh: '等墨方土地权属意见，客户在催', en: 'Waiting for the land-title opinion from Mexico; the client is following up', es: 'A la espera del dictamen sobre la titularidad del terreno en México; el cliente está dando seguimiento' },
      next: { zh: '墨方核实土地权属并出具摘要', en: 'Verify land title in Mexico and issue a memo', es: 'Verificar títulos de propiedad y emitir un memo' },
      nextOwner: 'benson',
      due: iso(addDays(6)), waiting: 'notary',
      files: [{ name: { zh: '土地权属摘要_v01.pdf（Google Drive）', en: 'Land-title-memo_v01.pdf (Google Drive)', es: 'Memo-titulos_v01.pdf (Google Drive)' }, url: 'https://drive.google.com/' }],
      lastContact: iso(addDays(-2)),
      notes: { zh: '客户希望 9 月底前完成尽调。', en: 'The client wants due diligence completed by the end of September.', es: 'El cliente quiere que la debida diligencia termine antes de finales de septiembre.' },
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
      notes: { zh: '涉美事项，仅向事项成员开放。', en: 'US-related matter; access is limited to matter members.', es: 'Asunto vinculado a EE. UU.; acceso limitado a los miembros.' },
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
      area: 'mx_reg', owner: 'benson', team: all, stage: 'Government Review',
      status: 'red',
      reason: { zh: '客户资料逾期两周，签证预约快到了', en: 'Client documents are two weeks late and the visa appointment is close', es: 'Documentos con dos semanas de retraso y la cita de visa se acerca' },
      next: { zh: '催客户补齐无犯罪记录双认证', en: 'Follow up with the client for the authenticated criminal-record certificates', es: 'Solicitar al cliente los certificados de antecedentes penales debidamente legalizados' },
      nextOwner: 'benson',
      due: iso(addDays(2)), waiting: 'client',
      files: [], lastContact: iso(addDays(-9)), notes: '',
    },
    {
      id: 31, no: '2026-031', client: 'Grupo A',
      title: { zh: 'IMMEX 续期', en: 'IMMEX renewal', es: 'Renovación IMMEX' },
      area: 'mx_reg', owner: 'benson', team: all, stage: 'Government Review',
      status: 'yellow',
      reason: { zh: '等待经济部回执，已过三周', en: 'Waiting on the Ministry\'s reply for three weeks', es: 'Esperando respuesta de la Secretaría desde hace tres semanas' },
      next: { zh: '跟进经济部回执，必要时预约面谈', en: 'Follow up with the Ministry, book a meeting if needed', es: 'Dar seguimiento a la Secretaría y agendar reunión si hace falta' },
      nextOwner: 'benson',
      due: iso(addDays(13)), waiting: 'authority',
      files: [], lastContact: iso(addDays(-5)), notes: '',
    },
    {
      id: 40, no: '2026-040',
      client: { zh: 'LCB 内部', en: 'LCB internal', es: 'LCB interno' },
      title: { zh: '深圳办公室启动', en: 'Shenzhen office launch', es: 'Apertura de la oficina de Shenzhen' },
      area: 'internal', owner: 'carol', team: all, stage: 'Engagement',
      status: 'yellow',
      reason: { zh: '申报口径要先确认，避免对外造成已设立印象', en: 'Confirm the filing approach first to avoid suggesting that the office has already been established', es: 'Definir primero el criterio de presentación para evitar dar la impresión de que la oficina ya está constituida' },
      next: { zh: '确认深圳市司法局最新申报要求与材料清单', en: 'Confirm the latest Shenzhen filing requirements and checklist', es: 'Confirmar los requisitos y la lista de documentos de Shenzhen' },
      nextOwner: 'carol',
      due: iso(addDays(18)), waiting: 'authority',
      files: [], lastContact: iso(addDays(-3)),
      notes: { zh: '内部战略项目，不混入客户 Matter。', en: 'Internal strategic project, kept out of client matters.', es: 'Proyecto interno, fuera de los asuntos de clientes.' },
    },
    {
      id: 37, no: '2026-037', client: 'ABC Ltd',
      title: { zh: '合资公司 SHA 起草', en: 'JV shareholders\' agreement', es: 'Acuerdo de socios (JV)' },
      area: 'mx_invest', owner: 'benson', team: all, stage: 'Drafting',
      status: 'green', reason: '',
      next: { zh: '完成 SHA 第二稿并交 Carol 复核', en: 'Finish draft 2 of the SHA for Carol to review', es: 'Terminar el segundo borrador del acuerdo para revisión de Carol' },
      nextOwner: 'benson',
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
      area: 'dispute', owner: 'benson', team: all, stage: 'Legal Research',
      status: 'green', reason: '',
      next: { zh: '整理尽调清单初稿，交 Benson 补充执行细节', en: 'Prepare the initial due-diligence checklist for Benson to add implementation details', es: 'Preparar el borrador de la lista para que Benson añada los detalles de ejecución' },
      nextOwner: 'benson',
      due: iso(addDays(24)), waiting: 'none',
      files: [], lastContact: iso(addDays(-8)), notes: '',
    },
  ];
  const memberId = id => id === 'carol' ? 'carol' : 'benson';
  return seeded.map(m => Object.assign({}, m, {
    owner: memberId(m.owner),
    nextOwner: memberId(m.nextOwner),
    team: [...new Set((m.team || []).map(memberId))],
    steps: (m.steps || []).map(step => Object.assign({}, step, { owner:memberId(step.owner), by:memberId(step.by) })),
  }));
}

function seedLogs() {
  const now = Date.now();
  const h = 3600000;
  const seeded = [
    { id: 'l1', matterId: 36, at: now - 26 * h, by: 'carol', key: 'detail.entry.status', vars: { status: { __t: 'status.red', prefix: '🔴 ' } } },
    { id: 'l2', matterId: 36, at: now - 25 * h, by: 'carol', key: 'detail.entry.next', vars: { next: { zh: '补交 MT103 与贸易合同，完成许可申请递交', en: 'File MT103 and the trade contract, submit the licence application', es: 'Presentar MT103 y el contrato, y la solicitud de licencia' } } },
    { id: 'l3', matterId: 35, at: now - 50 * h, by: 'carol', key: 'detail.entry.note', vars: { text: { zh: '结构调整已确认', en: 'The structure change was confirmed', es: 'Se confirmó el cambio de estructura' } } },
    { id: 'l4', matterId: 35, at: now - 49 * h, by: 'benson', key: 'detail.entry.fileAdd', vars: { name: { zh: '土地权属摘要_v01.pdf', en: 'Land-title-memo_v01.pdf', es: 'Memo-titulos_v01.pdf' } } },
    { id: 'l5', matterId: 33, at: now - 72 * h, by: 'benson', key: 'detail.entry.waiting', vars: { w: { __t: 'wait.client' } } },
    { id: 'l6', matterId: 40, at: now - 74 * h, by: 'carol', key: 'detail.entry.new', vars: { no: '2026-040', area: 'Internal Project' } },
  ];
  return seeded.map(entry => Object.assign({}, entry, { by:entry.by === 'carol' ? 'carol' : 'benson' }));
}

/* ------------------------------ 运行时状态 ------------------------------ */

// 加密私钥只在内存中，刷新页面后必须重新输入原密码解锁。
try { localStorage.removeItem(KEY.auth); } catch (e) { /* clear legacy token */ }
saveSessionValue(KEY.auth, null);
let authSession = null;
let loginFailures = 0;
let loginBlockedUntil = 0;
let loginCountdownTimer = null;
let loginCountdownEmail = '';
const TURNSTILE_SITE_KEY = SITE_CONFIG.turnstileSiteKey;
let turnstileToken = '';
let turnstileWidgetId = null;
let matters = REMOTE_ENABLED ? [] : (load(KEY.matters, null) || []);
let logs = REMOTE_ENABLED ? [] : (load(KEY.logs, null) || []);
let seq = REMOTE_ENABLED ? 0 : load(KEY.seq, 0);
let session = !REMOTE_ENABLED ? load(KEY.session, null) : null;
const state = {
  filters: { q: '', area: '', owner: '', status: '', waiting: '' },
  globalSearch: '',
  deadlineResult: null,
  reportFilters: { from:'', to:'', client:'', owner:'', area:'' },
  integrityResult: null,
  bulkSelected: new Set(),
  clientSelected: new Set(),
  trashSelected: new Set(),
  notificationSelected: new Set(),
  loginDraft: { email:'', password:'' },
  chatDraft: { message:'', mentions:[], blocked:null, referenceType:'matter', refMatter:'', refStep:'', refClient:'', refFile:'', files:[] },
  chatScrollToBottom: false,
  chatOpened: false,
  loginError: '',
  calendarOffset: 0,
  mobileNavOpen: false,
  devices: [],
  guide: null,
  modal: null,
};
let lastSystemError = { message:'', at:0 };
function showSystemError(error) {
  const message = String((error && (error.message || error.reason)) || error || 'Unknown error');
  if (message === 'bad-credentials') return;
  const now = Date.now();
  if (lastSystemError.message === message && now - lastSystemError.at < 2000) return;
  lastSystemError = { message, at:now };
  state.modal = {
    type:'notice',
    titleKey:'sync.errorModalTitle',
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
  const token = authSession && authSession.access_token;
  const headers = Object.assign({
    apikey: SUPABASE.key,
    Authorization: 'Bearer ' + (token || SUPABASE.key),
  }, (opts && opts.headers) || {});
  return fetch(SUPABASE.url + '/storage/v1' + path, Object.assign({}, opts || {}, { headers })).then(trackAuthResponse);
}
function recordSecurityEvent(eventType, details) {
  if (!authSession) return Promise.resolve();
  return sbFetch('/rpc/lcb_record_security_event', { method:'POST', body:JSON.stringify({ event_type:eventType, details:details || {} }) }).catch(() => {});
}

let consecutiveAuthFailures = 0;
function trackAuthResponse(response) {
  if (response.status === 401) {
    consecutiveAuthFailures += 1;
    if (authSession) expireAuthSession();
  } else if (response.ok) consecutiveAuthFailures = 0;
  return response;
}

function expireAuthSession() {
  finishLogout({expired:true});
}

function authExpiredError(error) {
  return !authSession && /(?:HTTP|http-)[-_]?401/i.test(String((error && error.message) || error));
}

let sessionValidation=null;
async function ensureActiveServerSession() {
  if(!authSession) return false;
  if(sessionValidation) return sessionValidation;
  const checkedSession=authSession;
  sessionValidation=(async()=>{
    const res=await sbFetch('/rpc/lcb_session_active',{method:'POST',body:'{}'});
    if(!authSession||authSession!==checkedSession) return false;
    if(res.status===401){expireAuthSession();return false;}
    if(!res.ok) throw new Error('session-check-http-'+res.status);
    const active=await res.json();
    if(active!==true){expireAuthSession();return false;}
    return true;
  })();
  try{return await sessionValidation;}finally{sessionValidation=null;}
}

async function signOutEverywhere() {
  if (sync.dirty) await pushRemote();
  const res = await fetch(SUPABASE.url + '/auth/v1/logout?scope=global', {
    method:'POST', headers:{ apikey:SUPABASE.key, Authorization:'Bearer ' + authSession.access_token },
  });
  if (!res.ok) throw new Error('logout-http-' + res.status);
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
function devicePlace(d) {
  return String(d && d.city || '').trim() || t('settings.deviceLocationUnknown');
}
async function loadDevices(register) {
  if (!authSession) return;
  const checkedSession=authSession;
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  if (register) {
    const saved=await sbFetch('/rpc/lcb_register_device_safe',{method:'POST',body:JSON.stringify({p_device_id:stableDeviceId(),p_device_name:deviceDescription(),p_timezone:timezone})});
    if(!saved.ok) throw new Error('device-register-http-'+saved.status+': '+await saved.text());
  }
  const res=await sbFetch('/rpc/lcb_list_devices_safe',{method:'POST',body:'{}'});
  if(!res.ok) throw new Error('device-list-http-'+res.status);
  const devices=await res.json();
  if(authSession===checkedSession) state.devices=devices;
}
let deviceListRefresh=null;
async function refreshDeviceList() {
  if(!authSession) return false;
  if(deviceListRefresh) return deviceListRefresh;
  deviceListRefresh=(async()=>{
    const before=JSON.stringify(state.devices||[]);
    await loadDevices(false);
    if(location.hash.startsWith('#/settings')&&JSON.stringify(state.devices||[])!==before) render();
    return true;
  })();
  try{return await deviceListRefresh;}finally{deviceListRefresh=null;}
}
async function revokeDevice(sessionId) {
  const current=(state.devices||[]).find(x=>x.session_id===sessionId && x.is_current);
  const res=await sbFetch('/rpc/lcb_revoke_device',{method:'POST',body:JSON.stringify({target_session:sessionId})});
  if(!res.ok) throw new Error('device-revoke-http-'+res.status);
  if(current) finishLogout(); else { await loadDevices(false); render(); }
}

async function signIn(email, password, captchaToken) {
  const res = await fetch(SUPABASE.url + '/functions/v1/lcb-login', {
    method: 'POST', headers: { apikey: SUPABASE.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceId:stableDeviceId(), captchaToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || 'login-failed');
    error.code = data.error || 'login_failed';
    error.remainingAttempts = Number(data.remainingAttempts);
    error.retryAfter = Number(data.retryAfter);
    throw error;
  }
  authSession = { access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    email: data.user && data.user.email };
  saveSessionValue(KEY.auth, authSession);
  consecutiveAuthFailures = 0;
  const member = USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (globalThis.LCBCrypto && member) await LCBCrypto.initialize(member.id, password, sbFetch);
}

async function refreshAuth() {
  if (!authSession || !authSession.refresh_token) return false;
  if (authSession.expires_at > Math.floor(Date.now() / 1000) + 60) return true;
  const res = await fetch(SUPABASE.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: { apikey: SUPABASE.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: authSession.refresh_token }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  authSession = { access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    email: data.user && data.user.email };
  saveSessionValue(KEY.auth, authSession);
  return true;
}

function clearPrivateCache() {
  [KEY.matters, KEY.logs, KEY.seq, KEY.session].forEach(k => {
    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
  });
  matters = []; logs = []; seq = 0;
}

function finishLogout(options) {
  const expired=!!(options&&options.expired);
  session=null;authSession=null;consecutiveAuthFailures=0;
  state.loginDraft={email:'',password:''};
  state.chatDraft={message:'',mentions:[],blocked:null,referenceType:'matter',refMatter:'',refStep:'',refClient:'',refFile:'',files:[]};
  state.chatOpened=false;state.chatScrollToBottom=false;
  if(globalThis.LCBCrypto) LCBCrypto.lock();
  saveSessionValue(KEY.auth,null);save(KEY.session,null);clearPrivateCache();
  state.bulkSelected.clear();state.clientSelected.clear();state.trashSelected.clear();state.notificationSelected.clear();
  state.devices=[];state.modal=null;state.mobileNavOpen=false;state.loginError=expired?t('login.errExpired'):'';
  if(typeof pushTimer!=='undefined'&&pushTimer){clearTimeout(pushTimer);pushTimer=null;}
  resetSyncRetries();
  sync.busy=false;sync.dirty=false;sync.status='loading';sync.error='';sync.lastAt=0;
  sync.syncedLogs.clear();sync.logStateBaseline.clear();sync.purged.clear();
  syncReady=!REMOTE_ENABLED;
  go('#/');render();
}

let lastUserActivityAt = Date.now();
async function idleLogout() {
  if (!authSession || Date.now() - lastUserActivityAt < IDLE_LOGOUT_MS) return;
  if (sync.dirty) await pushRemote();
  finishLogout();
  toast(t('toast.loggedOut'));
}

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
    showSystemError(sync.error);
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
  if (location.hash.startsWith('#/chat') && active && active.closest && active.closest('.chat-composer')) return false;
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
  let shouldEncryptPlaintext = false;
  if (background && userIsInteracting()) return;
  if (!REMOTE_ENABLED || sync.busy || !authSession) return;
  if (sync.dirty) return;              // 本地还有没推上去的改动，先别覆盖
  sync.busy = true;
  try {
    if(!await ensureActiveServerSession()){sync.busy=false;return;}
    const [mRes, lRes, metaRes] = await Promise.all([
      sbFetch('/matters?select=id,data,updated_at&id=not.like.solo_*'),
      sbFetch('/logs?select=id,data&id=not.like.solo_*'),
      sbFetch('/meta?select=key,value&key=eq.seq'),
    ]);
    if (mRes.status === 404) throw new Error('tables-missing');
    if (!mRes.ok) throw new Error('HTTP ' + mRes.status);
    const mRows = await mRes.json();
    const lRows = lRes.ok ? await lRes.json() : [];
    const metaRows = metaRes.ok ? await metaRes.json() : [];

    const nextMatters = globalThis.LCBCrypto && LCBCrypto.state.ready
      ? await Promise.all(mRows.map(r => LCBCrypto.openMatter(r.data, sbFetch)))
      : mRows.map(r => r.data);
    const nextLogs = globalThis.LCBCrypto && LCBCrypto.state.ready
      ? await Promise.all(lRows.map(r => LCBCrypto.openLog(r.data, sbFetch)))
      : lRows.map(r => r.data);
    const seqRow = metaRows.filter(r => r.key === 'seq')[0];
    const nextSeq = seqRow && typeof seqRow.value === 'number' ? seqRow.value : seq;
    const changed = JSON.stringify(nextMatters) !== JSON.stringify(matters) ||
      JSON.stringify(nextLogs) !== JSON.stringify(logs) || nextSeq !== seq;
    // 请求发出后用户可能刚开始输入；这次结果留到下一轮再取。
    if (background && userIsInteracting()) { sync.busy = false; return; }
    const activeUserBeforePull = currentUser();
    if (location.hash.startsWith('#/chat') && activeUserBeforePull && LCBChatCore.hasNewVisibleMessage(logs,nextLogs,activeUserBeforePull.id)) {
      state.chatScrollToBottom = true;
    }
    matters = nextMatters;
    matterServerUpdatedAt.clear();
    matterPlainBaseline.clear();
    mRows.forEach((row,index) => {
      matterServerUpdatedAt.set(String(row.id), row.updated_at || '');
      if(row.data&&row.data.encrypted==='lcb-e2ee-v1') matterPlainBaseline.set(String(row.id),JSON.stringify(nextMatters[index]));
    });
    const activeUser = currentUser();
    shouldEncryptPlaintext = !!(globalThis.LCBCrypto && LCBCrypto.state.ready && activeUser &&
      mRows.some((row, i) => row.data &&
        (row.data.encrypted !== 'lcb-e2ee-v1' || Object.prototype.hasOwnProperty.call(row.data, 'no')) &&
        (activeUser.admin || nextMatters[i].owner === activeUser.id)));
    deliverSystemNotifications(nextLogs);
    logs = nextLogs;
    seq = nextSeq;
    sync.syncedLogs = new Set(logs.map(l => l.id));
    sync.logStateBaseline = new Map(logs.map(l => [l.id, LCBLogSync.stateFingerprint(l)]));
    if (!REMOTE_ENABLED) {
      save(KEY.matters, matters);
      save(KEY.logs, logs);
      save(KEY.seq, seq);
    }
    sync.status = 'ok';
    resetSyncRetries();
    sync.lastAt = Date.now();
    sync.error = '';
    if (background && !changed) {
      syncReady = true; sync.busy = false;
      if (shouldEncryptPlaintext) commit();
      if (materializeRecurringMatters()) commit();
      deliverDeadlineReminders();
      deliverScheduleReminders();
      return;
    }
  } catch (e) {
    sync.error = String((e && e.message) || e);
    recordSecurityEvent('sync_failed', { direction:'pull', error:sync.error.slice(0,160) });
    sync.busy = false;
    syncReady = true;
    if (authExpiredError(e)) { render(); return; }
    queueSyncRetry('pull');
    render();
    return;
  }
  syncReady = true;
  sync.busy = false;
  if (shouldEncryptPlaintext) commit();
  if (materializeRecurringMatters()) commit();
  deliverDeadlineReminders();
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
    if(!await ensureActiveServerSession()){sync.busy=false;return;}
    const changedMatters=matters.filter(m=>matterPlainBaseline.get(String(m.id))!==JSON.stringify(m));
    if (changedMatters.length) {
      const encrypted = globalThis.LCBCrypto && LCBCrypto.state.ready
        ? await Promise.all(changedMatters.map(m => LCBCrypto.prepareMatter(m, sbFetch))) : changedMatters;
      const pushedAt = new Date().toISOString();
      const rows = encrypted.map((m, i) => ({ id: String(changedMatters[i].id), data: m, updated_at: pushedAt }));
      if (globalThis.LCBCrypto && LCBCrypto.state.ready) {
        // 新事项先建立不含敏感正文的访问空壳，密钥成功写入后才上传密文。
        const shells = changedMatters.map(m => ({
          id:String(m.id),
          data:{ id:m.id, owner:m.owner, team:m.team || [], deletedAt:m.deletedAt || null, encrypted:'lcb-e2ee-pending' },
          updated_at:new Date().toISOString(),
        }));
        const shellResult = await sbFetch('/matters', {
          method:'POST', headers:{ Prefer:'resolution=ignore-duplicates,return=minimal' }, body:JSON.stringify(shells),
        });
        if (!shellResult.ok) throw new Error('matter-shell-http-' + shellResult.status);
        await LCBCrypto.flushMatterKeys(sbFetch);
      }
      const versionedRows=rows.map(row=>Object.assign({},row,{expected_updated_at:matterServerUpdatedAt.get(String(row.id))||null}));
      const r = await sbFetch('/rpc/lcb_store_matters_if_current', { method:'POST', body:JSON.stringify({payload:versionedRows}) });
      if (r.status === 404) throw new Error('tables-missing');
      if (!r.ok) {
        const message=await r.text();
        if(message.includes('matter_conflict:')) {
          const error=new Error(message); error.code='matter_conflict';
          error.matterId=(message.match(/matter_conflict:([^"\\]+)/)||[])[1]||'';
          throw error;
        }
        throw new Error('HTTP ' + r.status);
      }
      changedMatters.forEach(m => { matterServerUpdatedAt.set(String(m.id), pushedAt); matterPlainBaseline.set(String(m.id),JSON.stringify(m)); });
    }
    // 新日志只做 INSERT；旧日志只同步可变的已读/删除状态，避免触发服务端“历史不可改写”保护。
    const logChanges=LCBLogSync.partition(logs,sync.syncedLogs,sync.logStateBaseline);
    if (logChanges.newLogs.length) {
      const encrypted = globalThis.LCBCrypto && LCBCrypto.state.ready
        ? await Promise.all(logChanges.newLogs.map(l => LCBCrypto.prepareLog(l, sbFetch))) : logChanges.newLogs;
      const rows = encrypted.map((l, i) => ({ id: logChanges.newLogs[i].id, matter_id: String(logChanges.newLogs[i].matterId), data: l }));
      const r = await sbFetch('/logs', { method: 'POST', headers:{Prefer:'resolution=ignore-duplicates,return=minimal'}, body: JSON.stringify(rows) });
      if (!r.ok) throw new Error('log-insert-http-' + r.status + ':' + (await r.text()).slice(0,240));
      logChanges.newLogs.forEach(l=>{sync.syncedLogs.add(l.id);sync.logStateBaseline.set(l.id,LCBLogSync.stateFingerprint(l));});
    }
    for(const log of logChanges.stateUpdates){
      const data=globalThis.LCBCrypto&&LCBCrypto.state.ready?await LCBCrypto.prepareLog(log,sbFetch):log;
      const r=await sbFetch('/logs?id=eq.'+encodeURIComponent(log.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({data})});
      if(!r.ok)throw new Error('log-state-http-'+r.status+':'+(await r.text()).slice(0,240));
      sync.logStateBaseline.set(log.id,LCBLogSync.stateFingerprint(log));
    }
    await sbFetch('/meta', { method: 'POST', headers: UPSERT, body: JSON.stringify([{ key: 'seq', value: seq }]) });
    for (const id of [...sync.purged]) {
      // 日志权限依赖事项仍存在，必须先删日志，再删事项。
      const logDelete = await sbFetch('/logs?matter_id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
      if (!logDelete.ok) throw new Error('log-delete-http-' + logDelete.status);
      const matterDelete = await sbFetch('/matters?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
      if (!matterDelete.ok) throw new Error('matter-delete-http-' + matterDelete.status);
      sync.purged.delete(id);
    }
    sync.status = 'ok';
    resetSyncRetries();
    sync.lastAt = Date.now();
    sync.error = '';
    sync.dirty = false;
  } catch (e) {
    // 推失败：把改动留在本机，标成"未同步"，下次同步时再试
    sync.error = String((e && e.message) || e);
    recordSecurityEvent('sync_failed', { direction:'push', error:sync.error.slice(0,160) });
    sync.dirty = true;
    sync.busy = false;
    if(e&&e.code==='matter_conflict') {
      state.modal={type:'confirm',titleKey:'syncConflict.title',body:t('syncConflict.body'),confirmKey:'syncConflict.reload',action:'reload-conflicted-matter',id:e.matterId};
      sync.status='error'; render(); return;
    }
    if (authExpiredError(e)) { render(); return; }
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

// 门禁规则：只有被勾进「项目成员」的人能打开这条事项；Carol 始终可见。
// 业务类型不决定可见范围，只决定新建时默认勾谁。
function defaultTeam(areaId) {
  const a = AREA[areaId];
  if (a && a.members) return a.members.slice();
  return USERS.map(u => u.id);
}
function canSee(user, m) {
  if (!user) return false;
  if (user.admin) return true;
  return (m.team || []).includes(user.id);
}
function visibleMatters(user) {
  return matters.filter(m => !['schedule','client','chat-channel'].includes(m.kind) && !m.deletedAt && canSee(user, m));
}
function trashedMatters(user) {
  const u = user || currentUser();
  return matters.filter(m => m.kind !== 'schedule' && m.deletedAt && canSee(u, m)).sort((a, b) => b.deletedAt - a.deletedAt);
}
function clientProfiles() {
  return matters.filter(m => m.kind === 'client' && !m.deletedAt && canSee(currentUser(),m))
    .sort((a,b)=>String(a.clientName||'').localeCompare(String(b.clientName||'')));
}
function clientOptions() {
  return clientProfiles().map(c=>({v:c.clientName,t:c.clientName}));
}
function scheduleItems(user, date) {
  if (!user) return [];
  return matters.filter(m => m.kind === 'schedule' && !m.deletedAt && m.owner === user.id && (!date || m.due === date))
    .sort((a, b) => String(a.reminderTime || '').localeCompare(String(b.reminderTime || '')));
}
function isAdmin() {
  const u = currentUser();
  return !!(u && u.admin);
}
// 当前步骤 = 这条事项正在推进的那一步，它的负责人就是「下一步负责人」
function isStepOwner(user, m) {
  return !!user && user.id === m.nextOwner;
}
function stepsOf(m) {
  return (m.steps || []).slice().sort((a, b) => b.at - a.at);
}
function lastStep(m) {
  const list = stepsOf(m);
  return list.length ? list[0] : null;
}
const MATTER_EDIT_FIELDS = ['client', 'title', 'counterparties', 'relatedParties', 'background', 'priority', 'startDate', 'totalFee', 'paymentsReceived', 'balance', 'contactName', 'contactEmail', 'area', 'stage', 'owner', 'nextOwner', 'status', 'due', 'waiting', 'lastContact', 'next', 'reason', 'notes', 'team', 'recurrence', 'recurrenceUntil', 'recurrenceNext', 'handoff'];
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
// Carol 可以代为完成步骤；撤销只给 Carol 和「刚完成这一步的人」
function canUndoStep(user, m) {
  if (!user) return false;
  if (user.admin) return true;
  const s = lastStep(m);
  return !!(s && s.by === user.id);
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
function addOperationNotification(m,key,vars,recipients) {
  const u=currentUser();
  if(!u || !m) return null;
  const entry={id:'l'+Math.random().toString(36).slice(2,9),matterId:m.id,at:Date.now(),by:u.id,key,vars:vars||{},
    notice:{key,vars:vars||{}},notifyTo:[...new Set((recipients||[...(m.team||[]),m.owner]).filter(id=>USER[id]))],readBy:[],matterTitle:m.title||m.clientName||'',matterNo:m.no||''};
  logs.push(entry); return entry;
}
function deliverOperationNotification() {
  deliverSystemNotifications(logs);
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
    if (v.__contactStamp !== undefined) return fmtContactStamp(v.__contactStamp);
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
function notificationEntries(user,source) {
  if (!user) return [];
  return (source||logs).filter(l => l.notice && (l.notifyTo || []).includes(user.id) && !(l.deletedBy || []).includes(user.id));
}
function inboxEntries(user) {
  return notificationEntries(user)
    .sort((a, b) => b.at - a.at);
}
function unreadNotifications(user) {
  return inboxEntries(user).filter(l => l.key !== LCBChatCore.CHAT_KEY && !(l.readBy || []).includes(user.id));
}
function notificationOnlyEntries(user) {
  return inboxEntries(user).filter(l => l.key !== LCBChatCore.CHAT_KEY);
}
function chatMessages(user) {
  return LCBChatCore.visibleMessages(logs, user && user.id).sort((a,b)=>a.at-b.at);
}
function chatSeenKey(userId) { return KEY.chatSeen + ':' + userId; }
function chatBlockKey(userId) { return KEY.chatBlocks + ':' + userId; }
function chatBlocks(userId) { const ids=load(chatBlockKey(userId),[]); return Array.isArray(ids)?ids.filter(id=>USER[id]&&id!==userId):[]; }
function unreadChats(user) { return user ? LCBChatCore.unreadCount(logs,user.id,load(chatSeenKey(user.id),0)) : 0; }
function ensureGlobalChatChannel() {
  let channel=matters.find(m=>m.kind==='chat-channel'&&!m.deletedAt);
  if(channel)return channel;
  const u=currentUser();
  channel={id:'global_chat',kind:'chat-channel',no:'CHAT',client:'',title:{zh:'团队聊天',en:'Team chat',es:'Chat del equipo'},owner:u.id,team:USERS.map(x=>x.id),status:'green',stage:'',next:'',nextOwner:u.id,due:'',waiting:'none',files:[],steps:[],deletedAt:null};
  matters.push(channel);return channel;
}
function chatReferenceOptions() {
  const rows=[];
  visibleMatters(currentUser()).forEach(m=>{
    rows.push({value:`matter:${m.id}`,label:`${t('chat.matter')} · ${m.no} · ${L(m.title)}`});
    (m.steps||[]).forEach((step,index)=>rows.push({value:`step:${m.id}:${step.id||index}`,label:`${t('chat.step')} · ${m.no} · ${L(step.text)}`}));
    (m.files||[]).forEach((file,index)=>rows.push({value:`file:${m.id}:${index}`,label:`${t('chat.file')} · ${m.no} · ${L(file.name)}`}));
  });
  clientProfiles().forEach(c=>rows.push({value:`client:${c.id}`,label:`${t('chat.client')} · ${c.clientName}`}));
  return rows;
}
function chatReferenceFromValue(value) {
  const parts=String(value||'').split(':');
  if(parts[0]==='matter'){const m=matterById(parts[1]);return m?{type:'matter',id:String(m.id),title:`${m.no} · ${L(m.title)}`,subtitle:L(m.client),details:[areaName(m.area),L(m.next),fmtDate(m.due)].filter(Boolean)}:null;}
  if(parts[0]==='client'){const c=matterById(parts[1]);return c?{type:'client',id:String(c.id),title:c.clientName,subtitle:c.communicationProgress||'',details:[c.contactPerson,c.phone,c.email].filter(Boolean)}:null;}
  if(parts[0]==='step'){const m=matterById(parts[1]),step=m&&(m.steps||[]).find((s,i)=>String(s.id||i)===parts[2]);return m&&step?{type:'step',matterId:String(m.id),id:String(step.id||parts[2]),title:L(step.text),subtitle:`${m.no} · ${L(m.title)}`,details:[(USER[step.owner]||{}).name||step.owner,fmtDate(step.due)].filter(Boolean)}:null;}
  if(parts[0]==='file'){const m=matterById(parts[1]),file=m&&(m.files||[])[Number(parts[2])];return m&&file?{type:'file',matterId:String(m.id),id:String(file.storagePath||parts[2]),title:L(file.name),subtitle:`${m.no} · ${L(m.title)}`,details:[file.size?`${Math.max(1,Math.round(file.size/1024))} KB`:'',file.uploadedAt?fmtStamp(file.uploadedAt):''].filter(Boolean)}:null;}
  return null;
}
function chatReferenceCard(reference) {
  if(!reference)return '';
  const attributes=reference.type==='file'?` role="button" tabindex="0" data-action="download-chat-file" data-id="${esc(reference.matterId||'')}" data-file-id="${esc(reference.id||'')}"`:'';
  return `<div class="chat-reference-card ${reference.type==='file'?'chat-file-card':''}"${attributes}><span>${esc(t('chat.'+reference.type))}</span><b>${esc(reference.title||'')}</b><small>${esc(reference.subtitle||'')}</small>${(reference.details||[]).length?`<div>${reference.details.map(x=>`<em>${esc(x)}</em>`).join('')}</div>`:''}</div>`;
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
  notificationEntries(u,nextLogs).filter(l => !(l.readBy || []).includes(u.id)).forEach(l => {
    const seenKey = u.id + ':' + l.id;
    if (systemNotice.seen.has(seenKey)) return;
    systemNotice.seen.add(seenKey);
    changed = true;
    showWebNotification(l);
    if (systemNotice.enabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const notice = new Notification(t('system.title'), { body: inboxText(l), tag: 'lcb-' + l.id });
      notice.onclick = () => {
        if (window.focus) window.focus();
        location.hash = l.key === LCBChatCore.CHAT_KEY ? '#/chat' : '#/inbox';
        render();
        if (notice.close) notice.close();
      };
    }
  });
  if (changed) saveSystemSeen();
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
  const loginForm=document.querySelector('form[data-action="login"]');
  if(loginForm) state.loginDraft={email:loginForm.email.value||'',password:loginForm.password.value||''};
  lang = id;
  save(KEY.lang, id);
  render();
}
function matterById(id) { return matters.find(m => String(m.id) === String(id)); }
function sorted(list) {
  return [...list].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    const dueKey = value => value === 'ASAP' ? '0000' : (value || '9999');
    return dueKey(a.due).localeCompare(dueKey(b.due));
  });
}

function reminderItems(user) {
  return sorted(visibleMatters(user).filter(m => {
    const due = daysFromToday(m.due);
    const contact = m.lastContact ? -daysFromToday(m.lastContact) : 999;
    return m.due === 'ASAP' || (due !== null && due <= 3) || m.waiting === 'client' || contact >= 7;
  })).map(m => {
    const due = daysFromToday(m.due);
    const contact = m.lastContact ? -daysFromToday(m.lastContact) : 999;
    let kind = m.due === 'ASAP' ? L({zh:'ASAP · 快截止',en:'ASAP · Due soon',es:'ASAP · Próximo a vencer'}) : (due < 0 ? ft('overdue') : (due <= 3 ? ft('dueSoon') : ft('waitingClient')));
    if (contact >= 7 && m.due !== 'ASAP') kind = ft('staleClient');
    return { matter:m, kind, days:due };
  });
}

function followupItems(user) {
  return reminderItems(user).filter(x => x.matter.waiting === 'client' || x.kind === ft('staleClient'));
}

function advanceRecurringDate(value, recurrence) {
  const d = parseISO(value);
  if (recurrence === 'weekly') d.setDate(d.getDate() + 7);
  else if (recurrence === 'monthly') {
    const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, monthEnd));
  }
  return iso(d);
}

function materializeRecurringMatters() {
  const u = currentUser();
  if (!u) return false;
  let changed = false;
  matters.filter(m => !m.deletedAt && ['weekly','monthly'].includes(m.recurrence) && (u.admin || m.owner === u.id)).forEach(template => {
    let next = template.recurrenceNext || advanceRecurringDate(template.due, template.recurrence);
    let guard = 0;
    while (next <= iso(today()) && guard++ < 12 && (!template.recurrenceUntil || next <= template.recurrenceUntil)) {
      const occurrenceId = `rec_${template.id}_${next}`;
      if (!matterById(occurrenceId)) {
        const copy = cloneData(template);
        copy.id = occurrenceId;
        copy.no = `${template.no}-${next.slice(5).replace('-','')}`;
        copy.due = next;
        copy.status = 'green'; copy.reason = ''; copy.steps = []; copy.files = [];
        copy.recurrence = 'none'; copy.recurrenceSource = template.id;
        copy.handoff = null; copy.deletedAt = null;
        matters.push(copy);
        addLogKey(copy.id, u.id, 'detail.entry.new', { no:copy.no, area:areaName(copy.area) });
      }
      next = advanceRecurringDate(next, template.recurrence);
      changed = true;
    }
    template.recurrenceNext = next;
  });
  return changed;
}

function deliverDeadlineReminders() {
  const u = currentUser();
  if (!u) return;
  const day = iso(today());
  let changed = false;
  reminderItems(u).forEach(item => {
    const id=`deadline_${u.id}_${item.matter.id}_${day}`;
    if(logs.some(l=>l.id===id)) return;
    logs.push({
      id,matterId:item.matter.id,at:Date.now(),by:u.id,
      key:'inbox.deadlineReminder',vars:{kind:item.kind,title:item.matter.title,date:{__date:item.matter.due}},
      notice:{key:'inbox.deadlineReminder',vars:{kind:item.kind,title:item.matter.title,date:{__date:item.matter.due}}},
      notifyTo:[u.id],readBy:[],matterTitle:item.matter.title,matterNo:item.matter.no||'',
    });
    changed=true;
  });
  if(!changed) return;
  commit();
  deliverSystemNotifications(logs);
  if(location.hash.startsWith('#/inbox')) render();
}

function deliverScheduleReminders() {
  const u = currentUser();
  if (!u) return;
  const now = new Date(), day = iso(now), time = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  let changed = false;
  scheduleItems(u).forEach(item => {
    if (!item.reminderEnabled || item.reminderSentAt || item.due > day || (item.due === day && item.reminderTime > time)) return;
    item.reminderSentAt = Date.now();
    logs.push({
      id:'l'+Math.random().toString(36).slice(2,9), matterId:item.id, at:Date.now(), by:u.id,
      key:'calendar.dayReminder', vars:{message:item.reminderText},
      notice:{key:'inbox.scheduleReminder',vars:{message:item.reminderText}},
      notifyTo:[u.id], readBy:[], matterTitle:item.reminderText, matterNo:'',
    });
    changed = true;
  });
  if (!changed) return;
  commit();
  deliverSystemNotifications(logs);
  if (location.hash.startsWith('#/calendar') || location.hash.startsWith('#/inbox')) render();
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
function showWebNotification(entry) {
  const root = document.getElementById('web-notice-root');
  if (!root || !entry) return;
  if ([...root.children].some(node => node.dataset.noticeId === String(entry.id))) return;
  const card = document.createElement('section');
  card.className = 'web-notice-card';
  card.dataset.noticeId = String(entry.id);
  const heading = document.createElement('div');
  heading.className = 'web-notice-heading';
  const title = document.createElement('b');
  title.textContent = t('system.title');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'web-notice-close';
  close.setAttribute('aria-label', L({zh:'关闭通知',en:'Close notification',es:'Cerrar notificación'}));
  close.textContent = '×';
  const body = document.createElement('div');
  body.className = 'web-notice-body';
  body.textContent = inboxText(entry);
  heading.append(title, close);
  card.append(heading, body);
  root.appendChild(card);
  let removed = false;
  const dismiss = () => {
    if (removed) return;
    removed = true;
    card.classList.add('is-leaving');
    setTimeout(() => card.remove(), 220);
  };
  close.addEventListener('click', dismiss);
  setTimeout(dismiss, 5000);
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
          <input type="email" name="email" value="${esc(state.loginDraft.email)}" placeholder="you@lcb.com" autocomplete="username" required>
        </div>
        <div class="field">
          <label>${esc(t('login.password'))}</label>
          <input type="password" name="password" value="${esc(state.loginDraft.password)}" placeholder="••••••••" autocomplete="current-password" required>
        </div>
        ${LOCAL_TEST_MODE ? `<div class="hint local-test-notice">${esc(t('login.localMode'))}</div><div class="local-test-users">${USERS.map(u=>`<button class="btn" type="button" data-action="local-login" data-user="${u.id}">${esc(t('login.localEnter',{name:u.name}))}</button>`).join('')}</div>` : `<div id="turnstile-login" class="turnstile-login" aria-label="Security verification"></div><button class="btn btn-primary btn-block" type="submit">${esc(t('login.signin'))}</button>`}
        <div class="err">${esc(err)}</div>
      </form>
    </div>
  </div>`;
}

function renderTurnstile() {
  if (LOCAL_TEST_MODE) return;
  const container = document.getElementById('turnstile-login');
  if (!container || !globalThis.turnstile) return;
  turnstileToken = '';
  turnstileWidgetId = globalThis.turnstile.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    theme: 'auto',
    callback(token) { turnstileToken = token; },
    'expired-callback'() { turnstileToken = ''; },
    'error-callback'() { turnstileToken = ''; },
  });
}

globalThis.onTurnstileLoad = () => {
  if (!currentUser()) renderTurnstile();
};

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
    ['#/search', null, L({zh:'全文搜索',en:'Search',es:'Búsqueda'})],
    ['#/matters', 'nav.matters'],
    ['#/calendar', null, ft('calendar')],
    ['#/clients', 'nav.clients'],
    ['#/followups', null, ft('followups')],
    ['#/team', null, ft('team')],
    ['#/deadline', null, L({zh:'期限计算',en:'Deadline',es:'Plazos'})],
    ['#/reports', null, L({zh:'工作报告',en:'Reports',es:'Informes'})],
    ['#/inbox', 'nav.inbox'],
    ['#/chat', 'nav.chat'],
    ['#/settings', 'nav.settings'],
    ['#/trash', 'nav.trash'],
  ];
  const links = items.map(([href, key, label]) => {
    const active = (href === '#/' && (route === '/' || route === '')) || (href !== '#/' && route.startsWith(href.slice(1)));
    let badge = '';
    if (key === 'nav.matters') badge = `<span class="nav-count">${visibleMatters(currentUser()).length}</span>`;
    if (key === 'nav.inbox') {
      const unread = unreadNotifications(currentUser()).length;
      if (unread) badge = `<span class="nav-count unread-count">${unread}</span>`;
    }
    if (key === 'nav.chat') {
      const unread = unreadChats(currentUser());
      if (unread) badge = `<span class="nav-count unread-count">${unread}</span>`;
    }
    if (href === '#/followups') {
      const followups = followupItems(currentUser()).length;
      if (followups) badge = `<span class="nav-count">${followups}</span>`;
    }
    return `<a href="${href}" data-action="mobile-nav-link" class="${active ? 'active' : ''}"><span class="nav-label">${esc(label || t(key))}${badge}</span></a>`;
  }).join('');
  const tutorialLabel = (BEGINNER_TUTORIAL[lang] || BEGINNER_TUTORIAL.zh).title;
  return `${links}<button class="nav-tutorial" type="button" data-action="open-tutorial"><span class="nav-label">${esc(tutorialLabel)}</span></button>`;
}

function shell(route, content) {
  const u = currentUser();
  const unread = unreadNotifications(u).length + unreadChats(u);
  return `
  <div class="topbar ${state.mobileNavOpen?'mobile-nav-open':''}">
    <div class="topbar-inner">
      <button class="mobile-nav-toggle" type="button" data-action="mobile-nav-toggle" aria-expanded="${state.mobileNavOpen?'true':'false'}" aria-label="${esc(L({zh:'打开导航菜单',en:'Open navigation menu',es:'Abrir menú de navegación'}))}" title="${esc(L({zh:'导航菜单',en:'Navigation menu',es:'Menú de navegación'}))}"><span class="menu-glyph">☰</span>${unread?`<span class="nav-toggle-count">${unread}</span>`:''}</button>
      <div class="logo"><div class="brand-mark">C</div><span>${esc(t(APP_TITLE_KEY))}</span></div>
      <div class="nav-shell">
        <div class="mobile-drawer-head"><b>${esc(t(APP_TITLE_KEY))}</b><button type="button" data-action="mobile-nav-close" aria-label="${esc(L({zh:'关闭导航菜单',en:'Close navigation menu',es:'Cerrar menú de navegación'}))}">×</button></div>
        <button class="nav-scroll-btn" type="button" data-action="nav-scroll-left" aria-label="${esc(L({zh:'向左滚动导航',en:'Scroll navigation left',es:'Desplazar navegación a la izquierda'}))}" title="${esc(L({zh:'向左滚动',en:'Scroll left',es:'Desplazar a la izquierda'}))}">‹</button>
        <nav class="nav">${navFor(route)}</nav>
        <button class="nav-scroll-btn" type="button" data-action="nav-scroll-right" aria-label="${esc(L({zh:'向右滚动导航',en:'Scroll navigation right',es:'Desplazar navegación a la derecha'}))}" title="${esc(L({zh:'向右滚动',en:'Scroll right',es:'Desplazar a la derecha'}))}">›</button>
        <div class="mobile-drawer-account"><span class="avatar">${esc(u.short)}</span><span><b>${esc(u.name)}</b><small>${esc(t(u.roleKey))}</small></span><button class="btn btn-sm" type="button" data-action="logout">${esc(t('topbar.signout'))}</button></div>
      </div>
      <div class="topbar-right">
        ${langSwitcher('topbar-lang')}
        ${syncBadge()}
        <div class="user-chip" aria-label="${esc(u.name)}" style="pointer-events:none;cursor:default">
          <span class="avatar">${esc(u.short)}</span>
          <span>
            <span class="nm">${esc(u.name)}</span>
            <span class="rl" style="display:block">${esc(t(u.roleKey))}</span>
          </span>
        </div>
        <button class="btn btn-sm btn-ghost" type="button" data-action="logout">${esc(t('topbar.signout'))}</button>
      </div>
    </div>
  </div>
  <button class="mobile-nav-overlay" type="button" data-action="mobile-nav-close" aria-label="${esc(L({zh:'关闭导航菜单',en:'Close navigation menu',es:'Cerrar menú de navegación'}))}"></button>
  <div class="page">
    ${CAN_PERSIST ? '' : `<div class="warn">${esc(t('banner.noStorage'))}</div>`}
    ${content}
  </div>`;
}

function setMobileNavOpen(open) {
  state.mobileNavOpen = !!open;
  const topbar = document.querySelector('.topbar');
  const toggle = document.querySelector('.mobile-nav-toggle');
  if (topbar) topbar.classList.toggle('mobile-nav-open', state.mobileNavOpen);
  if (toggle) toggle.setAttribute('aria-expanded', state.mobileNavOpen ? 'true' : 'false');
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
  const waitingMe = list.filter(m => m.waiting === u.id || (USER[m.nextOwner] && m.nextOwner === u.id));
  const hot = sorted(list.filter(m => m.status === 'red' || m.status === 'yellow'));
  const reminders = reminderItems(u);
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
    <div class="row" data-action="choose-matter-action" data-id="${m.id}">
      <div class="no">${esc(m.no)}</div>
      <div class="cell-main">
        <div class="t">${esc(L(m.title))}</div>
        <div class="meta">${esc(L(m.client))} · ${esc((USER[m.owner] || {}).name || m.owner)}${m.reason ? ' · ' + esc(L(m.reason)) : ''}</div>
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
    <div class="card reminder-card">
      <div class="section-title">${esc(ft('reminders'))}</div>
      ${reminders.length ? reminders.slice(0, 8).map(x => `<button class="reminder-row" type="button" data-action="choose-matter-action" data-id="${x.matter.id}">
        <span class="reminder-kind">${esc(x.kind)}</span><span><b>${esc(L(x.matter.title))}</b><small>${esc(L(x.matter.client))} · ${fmtDate(x.matter.due)}</small></span>
      </button>`).join('') : `<div class="empty compact">${esc(ft('remindersEmpty'))}</div>`}
    </div>
    <div class="legend">
      <span>${esc(t('legend.green'))}</span><span>${esc(t('legend.yellow'))}</span><span>${esc(t('legend.red'))}</span>
    </div>`;
}

function viewCalendar() {
  const base = today();
  base.setDate(1); base.setMonth(base.getMonth() + state.calendarOffset);
  const year = base.getFullYear(), month = base.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first); start.setDate(first.getDate() - first.getDay());
  const names = lang === 'zh' ? ['日','一','二','三','四','五','六'] : (lang === 'es' ? ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
  const list = visibleMatters(currentUser());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = iso(d), items = list.filter(m => m.due === key), schedules = scheduleItems(currentUser(), key);
    cells.push(`<div class="calendar-cell ${d.getMonth() !== month ? 'outside' : ''} ${key === iso(today()) ? 'is-today' : ''}" data-action="calendar-date" data-date="${key}">
      <div class="calendar-date">${d.getDate()}</div>
      ${items.slice(0,4).map(m => `<button type="button" class="calendar-item status-${esc(m.status)}" data-action="choose-matter-action" data-id="${m.id}">${esc(L(m.title))}</button>`).join('')}
      ${items.length > 4 ? `<div class="small muted">+${items.length - 4}</div>` : ''}
      ${schedules.map(s => `<button type="button" class="calendar-item schedule-item" data-action="open-schedule" data-id="${esc(s.id)}">${esc(s.reminderTime)} · ${esc(s.reminderText)}</button>`).join('')}
    </div>`);
  }
  return `<div class="page-head"><div><h1>${esc(ft('calendar'))}</h1><div class="desc">${year}-${String(month + 1).padStart(2,'0')}</div></div>
    <div class="right"><button class="btn" data-action="calendar-prev">‹ ${esc(ft('previous'))}</button><button class="btn" data-action="calendar-today">${esc(ft('today'))}</button><button class="btn" data-action="calendar-next">${esc(ft('nextMonth'))} ›</button></div></div>
    <div class="calendar-wrap"><div class="calendar-grid calendar-head">${names.map(n => `<div>${esc(n)}</div>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div></div>`;
}

function viewFollowups() {
  const list = followupItems(currentUser());
  return `<div class="page-head"><div><h1>${esc(ft('followups'))}</h1><div class="desc">${esc(ft('waitingClient'))}</div></div></div>
    <div class="card followup-list">${list.length ? list.map(x => `<div class="followup-row">
      <button class="followup-main" data-action="open-matter" data-id="${x.matter.id}"><b>${esc(L(x.matter.client))}</b><span>${esc(L(x.matter.title))} · ${esc(x.kind)}</span><small>${esc(ft('lastContact'))}：${esc(fmtContactStamp(x.matter.lastContact))}</small></button>
      <button class="btn btn-primary btn-sm" data-action="mark-contacted" data-id="${x.matter.id}">${esc(ft('contactNow'))}</button>
    </div>`).join('') : `<div class="empty">${esc(ft('followupEmpty'))}</div>`}</div>`;
}

function viewClients() {
  const list=clientProfiles();
  const selectable=list.filter(c=>currentUser().admin||c.owner===currentUser().id);
  const selectedCount=selectable.filter(c=>state.clientSelected.has(String(c.id))).length;
  const allSelected=selectable.length>0&&selectable.every(c=>state.clientSelected.has(String(c.id)));
  const rows=list.map(c=>{
    const contacts=(c.contacts&&c.contacts.length?c.contacts:[{name:c.contactPerson,phone:c.phone,email:c.email}]).filter(x=>x&&(x.name||x.phone||x.email));
    const contactSummary=contacts.length?contacts.map(x=>[x.name,x.role].filter(Boolean).join(' · ')).join('\n'):'—';
    const contactDetails=contacts.length?contacts.map(x=>[x.phone,x.email].filter(Boolean).join(' / ')).filter(Boolean).join('\n'):'—';
    const relationSummary=(c.relations||[]).map(x=>[x.name,x.type].filter(Boolean).join(' · ')).filter(Boolean).join('\n')||'—';
    return `<tr><td class="bulk-cell"><input class="bulk-check" type="checkbox" data-action="toggle-client" data-id="${esc(c.id)}" ${state.clientSelected.has(String(c.id))?'checked':''} ${(currentUser().admin||c.owner===currentUser().id)?'':'disabled'} aria-label="${esc(t('list.bulkDelete'))}: ${esc(c.clientName)}"></td><td><b>${esc(c.clientName)}</b></td><td class="multiline-cell">${esc(contactSummary)}</td><td class="multiline-cell">${esc(contactDetails)}</td><td class="multiline-cell">${esc(relationSummary)}</td><td>${esc(c.communicationProgress||'—')}</td><td>${esc(fmtContactStamp(c.lastContact))}</td><td>${esc(c.notes||'—')}</td><td class="nw"><button class="btn btn-sm" type="button" data-action="edit-client" data-id="${esc(c.id)}">${esc(t('clients.edit'))}</button> ${(currentUser().admin||c.owner===currentUser().id)?`<button class="btn btn-sm btn-danger" type="button" data-action="delete-client" data-id="${esc(c.id)}">${esc(t('clients.delete'))}</button>`:''}</td></tr>`;
  }).join('');
  return `<div class="page-head"><div><h1>${esc(t('clients.title'))}</h1><div class="desc">${esc(t('clients.desc'))}</div></div><div class="right"><button class="btn btn-danger" type="button" data-action="bulk-delete-clients" ${selectedCount?'':'disabled'}>${esc(t('list.bulkDelete'))}${selectedCount?` (${selectedCount})`:''}</button><button class="btn" type="button" data-action="import-clients">${esc(t('clients.import'))}</button><button class="btn btn-primary" type="button" data-action="new-client">${esc(t('clients.new'))}</button></div></div>
    <div class="card table-wrap"><table class="grid"><thead><tr><th class="bulk-cell"><input class="bulk-check" type="checkbox" data-action="toggle-all-clients" ${allSelected?'checked':''} ${selectable.length?'':'disabled'} aria-label="${esc(t('list.bulkDelete'))}"></th><th>${esc(t('clients.name'))}</th><th>${esc(t('clients.contact'))}</th><th>${esc(t('clients.phone'))} / ${esc(t('clients.email'))}</th><th>${esc(L({zh:'关联方',en:'Related parties',es:'Partes relacionadas'}))}</th><th>${esc(t('clients.progress'))}</th><th>${esc(t('clients.lastContact'))}</th><th>${esc(t('clients.notes'))}</th><th>${esc(t('clients.actions'))}</th></tr></thead><tbody>${rows}</tbody></table>${rows?'':`<div class="empty">${esc(t('clients.empty'))}</div>`}</div>`;
}

function viewTeamWorkload() {
  const list = visibleMatters(currentUser());
  const cards = USERS.map(u => {
    const own = list.filter(m => m.owner === u.id || m.nextOwner === u.id);
    const red = own.filter(m => m.status === 'red').length;
    const overdue = own.filter(m => daysFromToday(m.due) < 0).length;
    const waiting = own.filter(m => m.waiting !== 'none').length;
    return `<div class="workload-card"><div class="workload-person"><span class="avatar">${esc(u.short)}</span><b>${esc(u.name)}</b></div>
      <div class="workload-value">${own.length}</div><div class="small muted">${esc(ft('workloadOpen'))}</div>
      <div class="workload-stats"><span>${esc(ft('workloadRed'))} <b>${red}</b></span><span>${esc(ft('workloadOverdue'))} <b>${overdue}</b></span><span>${esc(ft('workloadWaiting'))} <b>${waiting}</b></span></div></div>`;
  }).join('');
  return `<div class="page-head"><div><h1>${esc(ft('team'))}</h1><div class="desc">${esc(ft('workloadOpen'))}</div></div></div><div class="workload-grid">${cards}</div>`;
}

function searchableText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(searchableText).join(' ');
  if (typeof value === 'object') return Object.values(value).map(searchableText).join(' ');
  return '';
}

function globalSearchMatches(rawQuery) {
  const query=String(rawQuery||'').trim().toLocaleLowerCase();
  if(query.length<2) return [];
  const rows=[], add=(type,title,subtitle,href,data)=>{
    if(searchableText(data).toLocaleLowerCase().includes(query)) rows.push({type,title,subtitle,href});
  };
  visibleMatters(currentUser()).forEach(m=>add(L({zh:'事项',en:'Matter',es:'Asunto'}),`${m.no||''} ${L(m.title)||''}`.trim(),[L(m.client),m.counterparties,m.relatedParties,L(m.next)].filter(Boolean).join(' · '),`#/matters/${m.id}`,[m.no,m.title,m.client,m.counterparties,m.relatedParties,m.next,m.notes,(m.files||[]).map(f=>f.name)]));
  clientProfiles().forEach(c=>add(L({zh:'客户',en:'Client',es:'Cliente'}),c.clientName,[c.contactPerson,c.phone,c.email].filter(Boolean).join(' · '),'#/clients',[c.clientName,c.contactPerson,c.phone,c.email,c.notes,c.contacts,c.relations]));
  const ids=new Set(visibleMatters(currentUser()).map(m=>String(m.id)));
  logs.filter(l=>ids.has(String(l.matterId))).forEach(l=>{const m=matterById(l.matterId);add(L({zh:'聊天／动态',en:'Chat / activity',es:'Chat / actividad'}),m?L(m.title):String(l.matterId),inboxText(l),m?`#/matters/${m.id}`:'#/inbox',[inboxText(l),l.vars]);});
  const seen=new Set();
  return rows.filter(row=>{const key=JSON.stringify(row);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,80);
}

function viewGlobalSearch() {
  const q=state.globalSearch||'', rows=globalSearchMatches(q);
  const body=q.trim().length<2?`<div class="empty">${esc(L({zh:'请输入至少 2 个字符。',en:'Enter at least two characters.',es:'Introduce al menos dos caracteres.'}))}</div>`:rows.length?rows.map(row=>`<a class="search-result" href="${esc(row.href)}"><span class="search-type">${esc(row.type)}</span><b>${esc(row.title)}</b><small>${esc(row.subtitle||'')}</small></a>`).join(''):`<div class="empty">${esc(L({zh:'没有找到符合权限范围的结果。',en:'No permitted records matched.',es:'No se encontraron registros permitidos.'}))}</div>`;
  return `<div class="page-head"><div><h1>${esc(L({zh:'全文搜索',en:'Full search',es:'Búsqueda completa'}))}</h1><div class="desc">${esc(L({zh:'搜索事项、客户、聊天、动态和文件名，只显示你有权查看的内容。',en:'Search matters, clients, chats, activity, and filenames within your permissions.',es:'Busca asuntos, clientes, chats, actividad y archivos dentro de tus permisos.'}))}</div></div></div><div class="card card-pad"><form data-action="global-search" class="search-form"><input name="q" type="search" value="${esc(q)}" placeholder="${esc(L({zh:'输入名称、编号、聊天文字或文件名',en:'Name, number, chat text, or filename',es:'Nombre, número, chat o archivo'}))}"><button class="btn btn-primary" type="submit">${esc(L({zh:'搜索',en:'Search',es:'Buscar'}))}</button></form></div><div class="card search-results">${body}</div>`;
}

function addBusinessDays(start,days,holidays){
  const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()),skip=new Set(holidays||[]);let left=Math.max(0,Number(days)||0);
  while(left){d.setDate(d.getDate()+1);if(d.getDay()!==0&&d.getDay()!==6&&!skip.has(iso(d)))left--;}
  return d;
}

function viewDeadlineCalculator(){
  const r=state.deadlineResult;
  return `<div class="page-head"><div><h1>${esc(L({zh:'期限计算器',en:'Deadline calculator',es:'Calculadora de plazos'}))}</h1><div class="desc">${esc(L({zh:'按自然日或工作日计算；工作日会跳过周末和指定节假日。结果仅供工作管理，法定期限仍应人工复核。',en:'Count calendar or business days, excluding weekends and entered holidays. Always verify statutory deadlines.',es:'Calcula días naturales o hábiles, omitiendo fines de semana y festivos. Verifica siempre los plazos legales.'}))}</div></div></div><div class="card card-pad"><form data-action="calculate-deadline"><div class="grid-2"><div class="field"><label class="req">${esc(L({zh:'起始日期',en:'Start date',es:'Fecha inicial'}))}</label><input type="date" name="startDate" required value="${esc(r&&r.startDate||new Date().toISOString().slice(0,10))}"></div><div class="field"><label class="req">${esc(L({zh:'期限天数',en:'Number of days',es:'Número de días'}))}</label><input type="number" min="0" step="1" name="days" required value="${esc(r&&r.days||15)}"></div><div class="field"><label>${esc(L({zh:'计算方式',en:'Counting method',es:'Método'}))}</label><select name="mode"><option value="calendar">${esc(L({zh:'自然日',en:'Calendar days',es:'Días naturales'}))}</option><option value="business" ${r&&r.mode==='business'?'selected':''}>${esc(L({zh:'工作日',en:'Business days',es:'Días hábiles'}))}</option></select></div><div class="field"><label>${esc(L({zh:'节假日（逗号或换行分隔）',en:'Holidays (comma or line separated)',es:'Festivos (coma o línea)'}))}</label><textarea name="holidays" rows="3" placeholder="2026-10-01, 2026-10-02">${esc(r&&r.holidaysText||'')}</textarea></div></div><button class="btn btn-primary" type="submit">${esc(L({zh:'计算截止日',en:'Calculate',es:'Calcular'}))}</button></form></div>${r?`<div class="card card-pad deadline-result"><span>${esc(L({zh:'计算结果',en:'Result',es:'Resultado'}))}</span><b>${esc(r.date)}</b><small>${esc(r.mode==='business'?L({zh:'已排除周末和指定节假日',en:'Weekends and listed holidays excluded',es:'Se excluyeron fines de semana y festivos'}):L({zh:'按自然日计算',en:'Calendar-day count',es:'Conteo de días naturales'}))}</small><button class="btn" type="button" data-action="deadline-reminders">${esc(L({zh:'创建 7／3／1 天前提醒',en:'Create 7 / 3 / 1-day reminders',es:'Crear avisos 7 / 3 / 1 días antes'}))}</button></div>`:''}`;
}

function reportFilteredMatters(){
  const f=state.reportFilters;
  return visibleMatters(currentUser()).filter(m=>(!f.client||searchableText([m.client,m.counterparties,m.relatedParties]).toLocaleLowerCase().includes(f.client.toLocaleLowerCase()))&&(!f.owner||m.owner===f.owner)&&(!f.area||m.area===f.area)&&(!f.from||String(m.due||'')>=f.from)&&(!f.to||String(m.due||'')<=f.to));
}
function reportGroups(rows,keyFn,labelFn){const map=new Map();rows.forEach(m=>{const key=keyFn(m),g=map.get(key)||{label:labelFn(key),rows:[]};g.rows.push(m);map.set(key,g);});return [...map.values()].sort((a,b)=>String(a.label).localeCompare(String(b.label)));}
function csvCell(value){
  let text=String(value==null?'':value);
  if(/^[\t\r ]*[=+\-@]/.test(text)) text="'"+text;
  return `"${text.replace(/"/g,'""')}"`;
}
function reportCsv(rows){
  const data=[[L({zh:'编号',en:'Number',es:'Número'}),L({zh:'客户',en:'Client',es:'Cliente'}),L({zh:'事项',en:'Matter',es:'Asunto'}),L({zh:'负责人',en:'Owner',es:'Responsable'}),L({zh:'业务类型',en:'Area',es:'Área'}),L({zh:'阶段',en:'Stage',es:'Etapa'}),L({zh:'状态',en:'Status',es:'Estado'}),L({zh:'截止日期',en:'Due',es:'Vencimiento'})],...rows.map(m=>[m.no,L(m.client),L(m.title),(USER[m.owner]||{}).name||m.owner,areaName(m.area),stageLabel(m.stage),statusName(m.status),m.due])];
  return data.map(row=>row.map(csvCell).join(',')).join('\n');
}
function viewReports(){
  const f=state.reportFilters,rows=reportFilteredMatters(),group=(title,items)=>`<div class="report-block"><h3>${esc(title)}</h3>${items.map(g=>`<div class="report-row"><span>${esc(g.label||'—')}</span><b>${g.rows.length}</b><small>${g.rows.filter(m=>m.status==='red').length} ${esc(L({zh:'红色',en:'red',es:'rojos'}))} · ${g.rows.filter(m=>daysFromToday(m.due)<0).length} ${esc(L({zh:'逾期',en:'overdue',es:'vencidos'}))}</small></div>`).join('')||`<div class="empty compact">${esc(L({zh:'无数据',en:'No data',es:'Sin datos'}))}</div>`}</div>`;
  return `<div class="page-head"><div><h1>${esc(L({zh:'工作报告',en:'Work reports',es:'Informes de trabajo'}))}</h1><div class="desc">${esc(L({zh:'按客户、成员、业务类型和时间汇总可见事项。',en:'Summarize visible matters by client, member, area, and date.',es:'Resume asuntos visibles por cliente, miembro, área y fecha.'}))}</div></div></div><div class="card card-pad"><form data-action="report-filter"><div class="grid-2"><div class="field"><label>${esc(L({zh:'开始日期',en:'From',es:'Desde'}))}</label><input type="date" name="from" value="${esc(f.from)}"></div><div class="field"><label>${esc(L({zh:'结束日期',en:'To',es:'Hasta'}))}</label><input type="date" name="to" value="${esc(f.to)}"></div><div class="field"><label>${esc(L({zh:'客户',en:'Client',es:'Cliente'}))}</label><input name="client" value="${esc(f.client)}"></div><div class="field"><label>${esc(L({zh:'负责人',en:'Owner',es:'Responsable'}))}</label><select name="owner"><option value="">${esc(L({zh:'全部',en:'All',es:'Todos'}))}</option>${USERS.map(u=>`<option value="${u.id}" ${f.owner===u.id?'selected':''}>${esc(u.name)}</option>`).join('')}</select></div><div class="field"><label>${esc(L({zh:'业务类型',en:'Area',es:'Área'}))}</label><select name="area"><option value="">${esc(L({zh:'全部',en:'All',es:'Todas'}))}</option>${PRACTICE_AREAS.map(a=>`<option value="${a.id}" ${f.area===a.id?'selected':''}>${esc(areaName(a.id))}</option>`).join('')}</select></div></div><div class="right"><button class="btn" type="button" data-action="report-export">${esc(L({zh:'导出 Excel/CSV',en:'Export Excel/CSV',es:'Exportar Excel/CSV'}))}</button><button class="btn" type="button" data-action="print">${esc(L({zh:'打印／导出 PDF',en:'Print / export PDF',es:'Imprimir / exportar PDF'}))}</button><button class="btn btn-primary" type="submit">${esc(L({zh:'生成报告',en:'Generate',es:'Generar'}))}</button></div></form></div><div class="card card-pad report-summary"><div class="report-kpis"><div><b>${rows.length}</b><span>${esc(L({zh:'事项总数',en:'Total',es:'Total'}))}</span></div><div><b>${rows.filter(m=>m.status==='red').length}</b><span>${esc(L({zh:'红色',en:'Red',es:'Rojos'}))}</span></div><div><b>${rows.filter(m=>daysFromToday(m.due)<0).length}</b><span>${esc(L({zh:'逾期',en:'Overdue',es:'Vencidos'}))}</span></div></div>${group(L({zh:'按客户',en:'By client',es:'Por cliente'}),reportGroups(rows,m=>L(m.client),x=>x))}${group(L({zh:'按成员',en:'By member',es:'Por miembro'}),reportGroups(rows,m=>m.owner,id=>(USER[id]||{}).name||id))}${group(L({zh:'按业务类型',en:'By area',es:'Por área'}),reportGroups(rows,m=>m.area,areaName))}</div>`;
}

async function runIntegrityReport(){
  const ids=new Set(matters.map(m=>String(m.id))),orphan=logs.filter(l=>!ids.has(String(l.matterId))),issues=[];
  let missingPath=0,plainFiles=0,badTeams=0;
  matters.filter(m=>!m.deletedAt).forEach(m=>{(m.files||[]).forEach(f=>{if(f.encrypted&&!f.storagePath)missingPath++;if(f.storagePath&&!f.encrypted)plainFiles++;});if(m.kind!=='schedule'&&m.owner&&!(m.team||[]).includes(m.owner))badTeams++;});
  if(orphan.length)issues.push(`${orphan.length} ${L({zh:'条动态没有对应记录',en:'activity records have no matching item',es:'registros de actividad sin elemento'})}`);
  if(missingPath)issues.push(`${missingPath} ${L({zh:'个加密文件缺少存储路径',en:'encrypted files lack a storage path',es:'archivos cifrados sin ruta'})}`);
  if(plainFiles)issues.push(`${plainFiles} ${L({zh:'个已存储文件缺少加密标记',en:'stored files lack an encryption marker',es:'archivos almacenados sin marca de cifrado'})}`);
  if(badTeams)issues.push(`${badTeams} ${L({zh:'个事项负责人不在成员列表中',en:'matters have an owner outside the member list',es:'asuntos con responsable fuera de miembros'})}`);
  const cryptoReady=!!(globalThis.LCBCrypto&&LCBCrypto.state&&LCBCrypto.state.ready);if(!cryptoReady)issues.push(L({zh:'当前会话未解锁加密钥匙',en:'Encryption keys are not unlocked in this session',es:'Las claves no están desbloqueadas'}));
  try{
    const [remoteMatters,publicKeys,privateKeys,wrappedKeys]=await Promise.all(['matters','lcb_public_keys','lcb_private_keys','lcb_matter_keys'].map(fetchBackupRows));
    const plain=remoteMatters.filter(row=>!row.data||row.data.encrypted!=='lcb-e2ee-v1');
    if(plain.length)issues.push(`${plain.length} ${L({zh:'条服务器事项不是标准密文',en:'server matter rows are not standard ciphertext',es:'asuntos del servidor no son texto cifrado estándar'})}`);
    const pubIds=new Set(publicKeys.map(row=>row.user_id));USERS.forEach(u=>{if(!pubIds.has(u.id))issues.push(`${u.name}: ${L({zh:'缺少公开钥匙',en:'public key missing',es:'falta clave pública'})}`);});
    if(!privateKeys.some(row=>row.user_id===currentUser().id))issues.push(L({zh:'当前账号缺少加密私钥',en:'The current account has no encrypted private key',es:'La cuenta actual no tiene clave privada cifrada'}));
    const wrappedIds=new Set(wrappedKeys.filter(row=>row.user_id===currentUser().id).map(row=>String(row.matter_id)));
    visibleMatters(currentUser()).forEach(m=>{if(!wrappedIds.has(String(m.id)))issues.push(`${m.no||m.id}: ${L({zh:'当前账号缺少事项钥匙',en:'matter key missing for current account',es:'falta clave del asunto para la cuenta'})}`);});
  }catch(error){issues.push(`${L({zh:'服务器巡检未完成',en:'Server-side check did not complete',es:'La revisión del servidor no se completó'})}: ${String(error.message||error)}`);}
  return {at:Date.now(),count:matters.filter(m=>!m.deletedAt).length,issues};
}
function integrityPanel(){
  if(!isAdmin())return '';
  const r=state.integrityResult;
  return `<div class="card card-pad" style="margin-top:16px"><div class="section-title">${esc(L({zh:'数据完整性巡检',en:'Data integrity check',es:'Revisión de integridad'}))}</div><div class="hint" style="margin-bottom:12px">${esc(L({zh:'检查加密标记、孤立动态、文件路径、权限关系和当前密钥状态。',en:'Checks encryption markers, orphaned activity, file paths, permissions, and key state.',es:'Revisa cifrado, actividad huérfana, archivos, permisos y claves.'}))}</div><button class="btn" type="button" data-action="run-integrity-check">${esc(L({zh:'开始巡检',en:'Run check',es:'Ejecutar'}))}</button>${r?`<div class="integrity-result"><b>${r.issues.length?`${r.issues.length} ${esc(L({zh:'项需要关注',en:'items need attention',es:'puntos requieren atención'}))}`:esc(L({zh:'未发现明显问题',en:'No obvious issues found',es:'No se encontraron problemas evidentes'}))}</b><small>${esc(fmtStamp(r.at))} · ${r.count} ${esc(L({zh:'条记录',en:'records',es:'registros'}))}</small>${r.issues.length?`<ul>${r.issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</div>`:''}</div>`;
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
  return list.map(m => `
    <tr class="${m.importStatusError ? 'import-error' : ''}" data-action="choose-matter-action" data-id="${m.id}">
      <td class="bulk-cell"><input class="bulk-check" type="checkbox" data-action="toggle-bulk-matter" data-id="${m.id}" ${state.bulkSelected.has(String(m.id)) ? 'checked' : ''} ${currentUser().id === m.owner || isAdmin() ? '' : 'disabled'} aria-label="${esc(t('list.bulkDelete'))}: ${esc(m.no)}"></td>
      <td class="nw">${m.importStatusError ? `<div class="import-error-label">${esc(t('list.importError'))}</div>` : ''}${esc(m.no)}</td>
      <td>${esc(L(m.client))}</td>
      <td><b>${esc(L(m.title))}</b>${m.notes ? `<div class="small muted">${esc(L(m.notes))}</div>` : ''}</td>
      <td>${areaTag(m.area)}</td>
      <td class="nw">${esc((USER[m.owner] || {}).name || m.owner)}</td>
      <td class="nw">${statusChip(m.status)}</td>
      <td>${esc(L(m.next))}</td>
      <td class="nw">${fmtDateShort(m.due)}<div class="small muted">${dueText(m.due)}</div></td>
      <td class="nw">${esc(waitLabel(m.waiting))}</td>
    </tr>`).join('');
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
  const ownerOpts = USERS.filter(u => seen.some(m => m.owner === u.id)).map(u => ({ v: u.id, t: u.name }));
  const statusOpts = ['red', 'yellow', 'green'].map(k => ({ v: k, t: STATUS[k].dot + ' ' + statusShort(k) }));
  // 等待谁的筛选项按实际用到的值生成，自定义填的也会出现在这里
  const waitingOpts = [...new Set([...seen.map(m => m.waiting).filter(w => w && w !== 'none'), 'other'])]
    .map(w => ({ v: w, t: waitLabel(w) }))
    .sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const n = sorted(filterMatters()).length;
  const bulkCount = [...state.bulkSelected].filter(id => {
    const m = matterById(id);
    return m && !m.deletedAt && canSee(currentUser(), m) && (currentUser().id === m.owner || isAdmin());
  }).length;
  const selectable = sorted(filterMatters()).filter(m => currentUser().id === m.owner || isAdmin());
  const allSelected = selectable.length > 0 && selectable.every(m => state.bulkSelected.has(String(m.id)));

  return `
    <div class="page-head">
      <div>
        <h1>${esc(t('list.title'))}</h1>
        <div class="desc">${esc(t('list.desc', { n }))}${esc(t(currentUser().admin ? 'list.descAdmin' : 'list.descMember'))}</div>
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
      <select data-filter="owner">${opts(ownerOpts, f.owner, t('list.allOwners'))}</select>
      <select data-filter="status">${opts(statusOpts, f.status, t('list.allStatus'))}</select>
      <select data-filter="waiting">${opts(waitingOpts, f.waiting, t('list.allWaiting'))}</select>
      <button class="btn btn-sm btn-ghost" type="button" data-action="clear-filters">${esc(t('list.clear'))}</button>
    </div>
    <div class="card table-wrap">
      <table class="grid">
        <thead><tr>
          <th class="bulk-cell"><input class="bulk-check" type="checkbox" data-action="toggle-all-bulk-matters" ${allSelected ? 'checked' : ''} ${selectable.length ? '' : 'disabled'} aria-label="${esc(t('list.bulkDelete'))}"></th>
          <th>${esc(t('th.no'))}</th><th>${esc(t('th.client'))}</th><th>${esc(t('th.title'))}</th>
          <th>${esc(t('th.area'))}</th><th>${esc(t('th.owner'))}</th><th>${esc(t('th.status'))}</th>
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

/* ------------------------------ 视图：收件箱 ------------------------------ */

function viewInbox() {
  const u = currentUser();
  const entries = inboxEntries(u).filter(l => l.key !== 'detail.entry.chat');
  const entryIds = new Set(entries.map(l => String(l.id)));
  [...state.notificationSelected].forEach(id => { if (!entryIds.has(String(id))) state.notificationSelected.delete(String(id)); });
  const selectedCount = state.notificationSelected.size;
  const allSelected = entries.length > 0 && entries.every(l => state.notificationSelected.has(String(l.id)));
  const unreadCount = entries.filter(l => !(l.readBy || []).includes(u.id)).length;
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
      <input class="bulk-check inbox-select" type="checkbox" data-action="toggle-notification" data-id="${esc(l.id)}" ${state.notificationSelected.has(String(l.id)) ? 'checked' : ''} aria-label="${esc(t('inbox.bulkDelete'))}">
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
      <div class="desc">${esc(t('inbox.systemHint'))}</div></div><div class="right">${systemControl}
      <button class="btn" type="button" data-action="mark-all-notifications-read" ${unreadCount ? '' : 'disabled'}>${esc(t('inbox.markAllRead'))}</button>
      <button class="btn btn-danger" type="button" data-action="bulk-delete-notifications" ${selectedCount ? '' : 'disabled'}>${esc(t('inbox.bulkDelete'))}${selectedCount ? ` (${selectedCount})` : ''}</button></div></div>
    <div class="inbox-bulkbar"><label><input class="bulk-check" type="checkbox" data-action="toggle-all-notifications" ${allSelected ? 'checked' : ''} ${entries.length ? '' : 'disabled'}> ${esc(t('inbox.selectAll'))}</label></div>
    <div class="card inbox-list">${rows}</div>`;
}

function viewChat() {
  const u = currentUser();
  const messages = chatMessages(u);
  const latest = messages.reduce((n,l)=>Math.max(n,Number(l.at)||0),Number(load(chatSeenKey(u.id),0)||0));
  if(latest)save(chatSeenKey(u.id),latest);
  const names=Object.fromEntries(USERS.map(x=>[x.id,x.name]));
  const rows = messages.length ? messages.map(l => {
    const blocked=LCBChatCore.blockedLabel(l,u.id,names),mentions=(l.vars&&l.vars.mentions||[]).map(id=>(USER[id]||{}).name||id);
    const attachments=(l.vars&&l.vars.attachments||[]).map(chatReferenceCard).join('');
    return `<div class="chat-message ${l.by===u.id?'mine':''}"><div class="chat-message-meta"><b>${esc((USER[l.by]||{}).name||l.by)}</b><span>${esc(fmtStamp(l.at))}</span>${mentions.length?`<span>@ ${esc(mentions.join('、'))}</span>`:''}</div>${l.vars&&l.vars.message?`<div class="chat-message-body">${esc(L(l.vars.message))}</div>`:''}${chatReferenceCard(l.vars&&l.vars.reference)}${attachments}${blocked?`<div class="chat-blocked-label">${esc(t('chat.blockedByMe',{names:blocked}))}</div>`:''}</div>`;
  }).join('') : `<div class="chat-empty">${esc(t('modal.chat.empty'))}</div>`;
  if(state.chatDraft.blocked===null)state.chatDraft.blocked=chatBlocks(u.id);
  const draft=state.chatDraft,blocked=new Set(draft.blocked),options=chatReferenceOptions(),others=USERS.filter(x=>x.id!==u.id);
  const optionList=(type,value)=>`<option value="">${esc(t('chat.noReference'))}</option>${options.filter(x=>x.value.startsWith(type+':')).map(x=>`<option value="${esc(x.value)}" ${x.value===value?'selected':''}>${esc(x.label.replace(/^.*? · /,''))}</option>`).join('')}`;
  const checked=(list,id)=>list.includes(id)?'checked':'';
  const fileNames=(draft.files||[]).map(file=>file.name).join('、');
  const closeTool=`<button class="chat-tool-close" type="button" data-action="close-chat-tool" aria-label="${esc(L({zh:'关闭弹窗',en:'Close popup',es:'Cerrar ventana'}))}">×</button>`;
  return `<div class="page-head"><div><h1>${esc(t('nav.chat'))}</h1><div class="desc">${esc(t('chat.desc'))}</div></div></div>
    <div class="card card-pad chat-workspace">
      <div class="chat-history chat-global-history" aria-live="polite">${rows}</div>
      <form data-action="send-global-chat" class="chat-composer">
        <div class="chat-compose-row">
          <div class="chat-tool-rail">
            <details class="chat-tool"><summary title="${esc(t('chat.memberPopup'))}">@</summary><div class="chat-tool-pop">${closeTool}<b>${esc(t('chat.memberPopup'))}</b><div class="chat-choice-list">${others.map(x=>`<label><input type="checkbox" name="mentions" value="${x.id}" ${checked(draft.mentions,x.id)}> ${esc(x.name)}</label>`).join('')}</div></div></details>
            <details class="chat-tool"><summary class="chat-block-button" title="${esc(t('chat.block'))}">${esc(t('chat.block'))}</summary><div class="chat-tool-pop">${closeTool}<b>${esc(t('chat.block'))}</b><div class="chat-choice-list">${others.map(x=>`<label><input type="checkbox" name="blocked" value="${x.id}" ${checked(draft.blocked,x.id)}> ${esc(x.name)}</label>`).join('')}</div><small>${esc(t('chat.blockedHint'))}</small></div></details>
            <details class="chat-tool"><summary title="${esc(t('chat.referencePopup'))}">+</summary><div class="chat-tool-pop chat-reference-pop">${closeTool}<b>${esc(t('chat.referencePopup'))}</b><div class="reference-switch">
              ${['matter','step','client','file'].map(type=>`<input id="ref-${type}" type="radio" name="referenceType" value="${type}" ${draft.referenceType===type?'checked':''}><label for="ref-${type}">${esc(t('chat.'+type))}</label>`).join('')}
              <div class="reference-panels"><div data-reference-panel="matter"><select name="refMatter">${optionList('matter',draft.refMatter)}</select></div><div data-reference-panel="step"><select name="refStep">${optionList('step',draft.refStep)}</select></div><div data-reference-panel="client"><select name="refClient">${optionList('client',draft.refClient)}</select></div><div data-reference-panel="file"><select name="refFile">${optionList('file',draft.refFile)}</select></div></div>
            </div><label class="chat-upload-button"><input type="file" name="chatFiles" multiple><span>📎 ${esc(t('chat.uploadFiles'))}</span></label>${fileNames?`<small class="chat-selected-files">${esc(t('chat.selectedFiles',{names:fileNames}))}</small>`:''}</div></details>
          </div>
          <div class="chat-input-area"><textarea name="message" rows="1" placeholder="${esc(t('chat.messagePlaceholder'))}">${esc(draft.message)}</textarea><button class="btn btn-primary" type="submit">${esc(t('chat.send'))}</button></div>
        </div>
      </form>
    </div>`;
}

/* ------------------------------ 视图：事项详情 ------------------------------ */

function viewMatter(id,mode) {
  const m = matterById(id);
  const u = currentUser();
  const workMode=mode==='work';
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
        ${currentUser().id === m.owner
          ? `<button class="btn btn-primary" type="button" data-action="restore-matter" data-id="${m.id}">${esc(t('detail.trashRestore'))}</button>`
          : `<div class="muted">${esc(t('detail.trashAdminOnly', { name: (USER[m.owner] || {}).name || m.owner }))}</div>`}
      </div>`;
  }

  const myLogs = logs.filter(l => String(l.matterId) === String(m.id)).sort((a, b) => b.at - a.at);
  const steps = stepsOf(m);
  const last = lastStep(m);
  const lastEdit = lastMatterEditLog(m);
  const areaField = selectWithCustom('data-field="area" data-area-picker', m.area, practiceAreaOptions(), t('form.customAreaPh'));
  const ownerOpts = USERS.map(x => `<option value="${x.id}" ${m.owner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const nextOwnerOpts = USERS.map(x => `<option value="${x.id}" ${m.nextOwner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const stageField = selectWithCustom('data-field="stage"', m.stage, stageOptions(), t('form.customStagePh'));
  const waitField = selectWithCustom('data-field="waiting"', m.waiting, waitingOptions(), t('form.customWaitPh'));
  const statusOpts = Object.keys(STATUS).map(k => `<option value="${k}" ${m.status === k ? 'selected' : ''}>${STATUS[k].dot} ${esc(statusName(k))}</option>`).join('');
  const canEditMatter = u.id === m.owner;
  const recurrenceOpts = [['none',ft('recurrenceNone')],['weekly',ft('recurrenceWeekly')],['monthly',ft('recurrenceMonthly')]]
    .map(([v,n]) => `<option value="${v}" ${(m.recurrence || 'none') === v ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const handoff = m.handoff && !m.handoff.acceptedAt ? m.handoff : null;

  const teamBoxes = USERS.map(x => `
    <label class="member-item">
      <input type="checkbox" data-field="team" value="${x.id}" ${(m.team || []).includes(x.id) ? 'checked' : ''}>
      <span class="nm">${esc(x.name)}</span>
      <span class="rl">${esc(t(x.roleKey))}</span>
    </label>`).join('');

  return `
    <a class="back" href="#/matters">${esc(t('back.toList'))}</a>
    <div class="page-head">
      <div>
        <h1>${esc(L(m.title))}</h1>
        <div class="desc">${esc(m.no)} · ${esc(L(m.client))} · ${esc((USER[m.owner] || {}).name || m.owner)}</div>
      </div>
      <div class="right">
        ${workMode
          ? `<button class="btn" type="button" data-action="open-matter-edit" data-id="${m.id}">${esc(t('modal.matterAction.edit'))}</button>
             <button class="btn" type="button" data-action="export-csv" data-id="${m.id}">${esc(t('list.export'))}</button>`
          : `<button class="btn" type="button" data-action="open-matter-work" data-id="${m.id}">${esc(t('modal.matterAction.work'))}</button>
             ${lastEdit ? `<button class="btn" type="button" data-action="undo-matter-edit" data-id="${m.id}">${esc(t('detail.undoEdit'))}</button>` : ''}
             <button class="btn btn-primary" type="button" data-action="save-matter" data-id="${m.id}">${esc(t('detail.save'))}</button>`}
      </div>
    </div>
    <div class="detail-grid ${workMode?'mode-work':'mode-edit'}">
      <div class="matter-edit-pane">
        <div class="card card-pad" data-matter="${m.id}">
          <fieldset style="border:0;padding:0;margin:0;min-width:0" ${canEditMatter ? '' : 'disabled'}>
          <div class="section-title">${esc(t('detail.info'))}</div>
          ${canEditMatter ? '' : `<div class="hint" style="margin-bottom:12px">${esc(t('toast.onlyOwnerEdit', { name: (USER[m.owner] || {}).name || m.owner }))}</div>`}
          <div class="grid-2">
            <div class="field"><label>${esc(t('detail.client'))}</label><input data-field="client" value="${esc(L(m.client))}"></div>
            <div class="field"><label>${esc(t('detail.title'))}</label><input data-field="title" value="${esc(L(m.title))}"></div>
            <div class="field"><label>${esc(t('detail.counterparties'))}</label><input data-field="counterparties" value="${esc(m.counterparties || '')}"></div>
            <div class="field"><label>${esc(t('detail.relatedParties'))}</label><input data-field="relatedParties" value="${esc(m.relatedParties || '')}"></div>
            <div class="field"><label>${esc(t('detail.priority'))}</label><input data-field="priority" value="${esc(m.priority || '')}"></div>
            <div class="field"><label>${esc(t('detail.startDate'))}</label><input type="date" data-field="startDate" value="${esc(String(m.startDate || '').slice(0,10))}"></div>
            <div class="field"><label>${esc(t('detail.totalFee'))}</label><input data-field="totalFee" value="${esc(m.totalFee || '')}"></div>
            <div class="field"><label>${esc(t('detail.paymentsReceived'))}</label><input data-field="paymentsReceived" value="${esc(m.paymentsReceived || '')}"></div>
            <div class="field"><label>${esc(t('detail.balance'))}</label><input data-field="balance" value="${esc(m.balance || '')}"></div>
            <div class="field"><label>${esc(t('detail.contactName'))}</label><input data-field="contactName" value="${esc(m.contactName || '')}"></div>
            <div class="field"><label>${esc(t('detail.contactEmail'))}</label><input data-field="contactEmail" value="${esc(m.contactEmail || '')}"></div>
            <div class="field"><label>${esc(t('detail.area'))}</label>${areaField}
              <div class="hint">${esc(t('detail.areaHint'))}</div></div>
            <div class="field"><label>${esc(t('detail.stage'))}</label>${stageField}</div>
            <div class="field"><label>${esc(t('detail.owner'))}</label><select data-field="owner">${ownerOpts}</select></div>
            <div class="field"><label>${esc(t('detail.nextOwner'))}</label><select data-field="nextOwner">${nextOwnerOpts}</select></div>
            <div class="field"><label>${esc(t('detail.status'))}</label><select data-field="status">${statusOpts}</select></div>
            <div class="field"><label>${esc(t('detail.dueMode'))}</label><select data-field="dueMode"><option value="date" ${/^\d{4}-\d{2}-\d{2}$/.test(m.due||'')?'selected':''}>${esc(t('detail.dueDate'))}</option><option value="asap" ${m.due==='ASAP'?'selected':''}>${esc(t('detail.dueAsap'))}</option><option value="none" ${!m.due?'selected':''}>${esc(t('detail.dueNone'))}</option></select></div>
            <div class="field"><label>${esc(t('detail.due'))}</label><input type="date" data-field="due" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(m.due||'')?m.due:'')}"></div>
            <div class="field"><label>${esc(t('detail.waiting'))}</label>${waitField}</div>
            <div class="field"><label>${esc(t('detail.lastContact'))}</label><input type="date" data-field="lastContact" value="${esc(String(m.lastContact||'').slice(0,10))}"></div>
            <div class="field"><label>${esc(ft('recurrence'))}</label><select data-field="recurrence">${recurrenceOpts}</select></div>
            <div class="field"><label>${esc(ft('recurrenceUntil'))}</label><input type="date" data-field="recurrenceUntil" value="${esc(m.recurrenceUntil || '')}"></div>
          </div>
          <div class="field"><label>${esc(t('detail.background'))}</label><textarea data-field="background" rows="4">${esc(m.background || '')}</textarea></div>
          <div class="field"><label>${esc(t('detail.next'))}</label><input data-field="next" value="${esc(L(m.next))}"></div>
          <div class="field"><label>${esc(t('detail.reason'))}</label><input data-field="reason" value="${esc(L(m.reason))}" placeholder="${esc(t('detail.reasonPh'))}"></div>
          <div class="field"><label>${esc(t('detail.notes'))}</label><textarea data-field="notes" rows="3">${esc(L(m.notes))}</textarea></div>
          <div class="field"><label>${esc(t('detail.members'))}</label><div class="member-list">${teamBoxes}</div>
            <div class="hint">${esc(t('detail.membersHint'))}</div></div>
          <button class="btn" type="button" data-action="check-matter-conflicts" data-id="${m.id}">${esc(t('conflict.check'))}</button>
          </fieldset>
          <div class="danger-zone">
            <button class="btn btn-danger btn-sm" type="button" data-action="delete-matter" data-id="${m.id}">${esc(t('detail.delete'))}</button>
            <span class="small muted">${u.id === m.owner
              ? esc(t('detail.deleteHintOwner'))
              : (u.admin
                ? esc(t('detail.deleteHintAdmin'))
                : esc(t('detail.deleteHintOther', { name: (USER[m.owner] || {}).name || m.owner })))}</span>
          </div>
        </div>
      </div>
      <div class="matter-work-pane">
        <div class="card card-pad" style="margin-bottom:16px">
          ${handoff ? `<div class="handoff-banner"><div><b>${esc(ft('handoffPending', { name:(USER[handoff.to] || {}).name || handoff.to }))}</b><span>${esc((USER[handoff.from] || {}).name || handoff.from)} → ${esc((USER[handoff.to] || {}).name || handoff.to)}</span></div>${u.id === handoff.to ? `<button class="btn btn-sm btn-primary" data-action="accept-handoff" data-id="${m.id}">${esc(ft('handoffAccept'))}</button>` : ''}</div>` : ''}
          <div class="section-title">${esc(t('detail.step.title'))}
            <span class="tag" style="margin-left:auto">${esc((USER[m.nextOwner] || {}).name || m.nextOwner)}</span>
          </div>
          <div class="step-now">${esc(L(m.next))}</div>
          <div class="step-meta">
            <span class="${dueClass(m.due)}">📅 ${fmtDate(m.due)} · ${dueText(m.due)}</span>
            <span>${esc(t('detail.step.waiting', { w: waitLabel(m.waiting) }))}</span>
          </div>
          <button class="btn btn-primary btn-block" type="button" data-action="complete-step" data-id="${m.id}">${esc(t('detail.step.button'))}</button>
          ${last
            ? `<button class="btn btn-block btn-wrap" style="margin-top:8px" type="button" data-action="undo-step" data-id="${m.id}">${esc(t('detail.undo.button', { text: L(last.text) }))}</button>
               <div class="hint" style="margin-top:6px">${u.admin || last.by === u.id ? esc(t('detail.undo.hint')) : esc(t('detail.undo.hintDenied'))}</div>`
            : ''}
          <div class="hint" style="margin-top:8px">${u.id === m.nextOwner
            ? esc(t('detail.step.hintOwner'))
            : (u.admin
              ? esc(t('detail.step.hintAdmin', { name: (USER[m.nextOwner] || {}).name || m.nextOwner }))
              : esc(t('detail.step.hintOther', { name: (USER[m.nextOwner] || {}).name || m.nextOwner })))}</div>
        </div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">${esc(t('detail.files.title'))}
            <button class="btn btn-sm" style="margin-left:auto" type="button" data-action="add-file" data-id="${m.id}">${esc(t('detail.files.add'))}</button>
          </div>
          <div class="files">
            ${(m.files || []).length ? m.files.map((f, i) => `
              <div class="file-item">
                <span>📎</span>
                <div class="file-version-main">${f.encrypted ? `<button class="btn btn-ghost nm" type="button" data-action="download-encrypted-file" data-id="${m.id}" data-idx="${i}">${esc(L(f.name))}</button>` : `<a class="nm" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(L(f.name))}</a>`}
                  <span class="tag">${esc(t('detail.files.version',{n:f.version||1}))}</span>
                  ${f.uploadedAt?`<span class="small muted">${esc(t('detail.files.uploaded',{name:(USER[f.uploadedBy]||{}).name||f.uploadedBy||'',time:fmtStamp(f.uploadedAt)}))}</span>`:''}</div>
                ${(u.admin||(f.uploadedBy?f.uploadedBy===u.id:m.owner===u.id))?`<button class="btn btn-sm btn-ghost" type="button" data-action="remove-file" data-id="${m.id}" data-idx="${i}">${esc(t('common.remove'))}</button>`:''}
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
              <div class="small muted">${esc(t('detail.history.meta', { who: (USER[s.owner] || {}).name || s.owner, when: fmtStamp(s.at), due: fmtDate(s.due) }))}${
                s.by && s.by !== s.owner ? esc(t('detail.history.by', { name: (USER[s.by] || {}).name || s.by })) : ''}</div>
              ${s.note ? `<div class="small">${esc(L(s.note))}</div>` : ''}
            </div>`).join('')
            : `<div class="small muted">${esc(t('detail.history.empty'))}</div>`}
        </div>
        <div class="card card-pad">
          <div class="section-title">${esc(t('detail.timeline.title'))}</div>
          <div class="timeline">
            ${myLogs.length ? myLogs.slice(0, 40).map(l => `
              <div class="tl-item ${l.at > Date.now() - 86400000 ? 'hot' : ''}">
                <div class="when">${fmtStamp(l.at)} · ${esc((USER[l.by] || {}).name || l.by)}</div>
                <div class="what">${esc(logText(l))}</div>
              </div>`).join('') : `<div class="small muted">${esc(t('detail.timeline.empty'))}</div>`}
          </div>
        </div>
      </div>
    </div>`;
}

/* ------------------------------ 视图：设置 ------------------------------ */

function viewSettings() {
  const rows = PRACTICE_AREAS.map(a => {
    const ids = defaultTeam(a.id);
    const cells = USERS.map(u => {
      const ok = ids.includes(u.id);
      return `<td class="${ok ? 'yes' : 'no'}">${ok ? '✓' : '—'}</td>`;
    }).join('');
    return `<tr><td>${esc(areaName(a.id))}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="page-head">
      <div>
        <h1>${esc(t('settings.title'))}</h1>
        <div class="desc">${esc(t('settings.desc'))}</div>
      </div>
    </div>
    <div class="detail-grid">
      <div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">${esc(t('settings.members'))}</div>
          <table class="matrix">
            <thead><tr><th>${esc(t('th.name'))}</th><th>${esc(t('th.email'))}</th><th>${esc(t('th.role'))}</th><th>${esc(t('th.access'))}</th></tr></thead>
            <tbody>
              ${USERS.map(u => `<tr>
                <td><b>${esc(u.name)}</b></td>
                <td>${esc(u.email)}</td>
                <td>${esc(t(u.roleKey))}</td>
                <td>${u.admin ? `<span class="yes">${esc(t('settings.admin'))}</span>` : esc(t('settings.member'))}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          <div class="hint" style="margin-top:10px">${esc(t('settings.loginHint'))}</div>
        </div>
        <div class="card card-pad">
          <div class="section-title">${esc(t('settings.defaultTeam'))}</div>
          <table class="matrix">
            <thead><tr><th>${esc(t('th.area'))}</th>${USERS.map(u => `<th>${esc(u.name)}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="hint" style="margin-top:10px">${t('settings.defaultTeamHint')}</div>
        </div>
      </div>
      <div>
        <div class="card card-pad">
          <div class="section-title">${esc(t('settings.sessions'))}</div>
          <div class="hint" style="margin-bottom:12px">${esc(t('settings.sessionsDesc'))}</div>
          ${(state.devices||[]).length ? state.devices.map(d=>`<div class="file-item" style="align-items:center;margin-bottom:8px"><span>▣</span><span class="nm"><b>${esc(d.device_name)}</b>${d.is_current?` · ${esc(t('settings.deviceCurrent'))}`:''}<br><span class="small muted">${esc((USER[d.user_id]||{}).name||d.user_id)} · ${esc(t('settings.deviceLocation',{place:devicePlace(d)}))} · ${esc(t('settings.deviceIp',{ip:d.ip_address||'—'}))} · ${esc(t('settings.deviceLastSeen',{time:fmtStamp(d.last_seen)}))}</span></span><button class="btn btn-sm btn-ghost" type="button" data-action="revoke-device" data-session-id="${esc(d.session_id)}">${esc(t('settings.deviceRevoke'))}</button></div>`).join(''):`<div class="hint" style="margin-bottom:12px">${esc(t('settings.deviceEmpty'))}</div>`}
          <button class="btn btn-danger" type="button" data-action="logout-all-devices">${esc(t('settings.logoutAll'))}</button>
        </div>
        ${isAdmin() ? `<div class="card card-pad" style="margin-top:16px">
          <div class="section-title">${esc(t('settings.securityTools'))}</div>
          <div class="hint" style="margin-bottom:12px">${esc(t('settings.backupHint'))}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" type="button" data-action="export-encrypted-backup">${esc(t('settings.backupExport'))}</button>
            <button class="btn" type="button" data-action="restore-encrypted-backup">${esc(t('settings.backupRestore'))}</button>
            <button class="btn" type="button" data-action="view-security-events">${esc(t('settings.securityEvents'))}</button>
          </div>
        </div>${integrityPanel()}` : ''}
      </div>
    </div>`;
}

function viewTrash() {
  const trashed = trashedMatters();
  const u = currentUser();
  const selectable = trashed.filter(m => u.id === m.owner);
  const selectedCount = selectable.filter(m => state.trashSelected.has(String(m.id))).length;
  const allSelected = selectable.length > 0 && selectable.every(m => state.trashSelected.has(String(m.id)));
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
        <label class="trash-select-all"><input class="bulk-check" type="checkbox" data-action="toggle-all-trash" ${allSelected ? 'checked' : ''} ${selectable.length ? '' : 'disabled'}> ${esc(t('trash.selectAll'))}</label>
        <span class="small muted" style="margin-left:auto;font-weight:400">${esc(t('settings.trashCount', { n: trashed.length }))}</span>
      </div>
      ${trashed.length ? trashed.map(m => `
        <div class="trash-row">
          <input class="bulk-check" type="checkbox" data-action="toggle-trash-matter" data-id="${m.id}" ${state.trashSelected.has(String(m.id)) ? 'checked' : ''} ${u.id === m.owner ? '' : 'disabled'} aria-label="${esc(t('trash.bulkPurge'))}: ${esc(m.kind==='client'?m.clientName:m.no)}">
          <span class="nm"><b>${m.kind==='client'?`${esc(t('clients.title'))} · ${esc(m.clientName)}`:`${esc(m.no)} ${esc(L(m.title))}`}</b>
            <span class="meta">${m.kind==='client'?esc(fmtStamp(m.deletedAt)):esc(t('settings.trashMeta', { client: L(m.client), when: fmtStamp(m.deletedAt) }))}</span></span>
          ${u.id === m.owner ? `
            <button class="btn btn-sm" type="button" data-action="restore-matter" data-id="${m.id}">${esc(t('settings.trashRestore'))}</button>
            <button class="btn btn-sm btn-danger" type="button" data-action="purge-matter" data-id="${m.id}">${esc(t('settings.trashPurge'))}</button>`
            : `<span class="small muted">${esc(t('settings.trashAdminOnly', { name: (USER[m.owner] || {}).name || m.owner }))}</span>`}
        </div>`).join('')
        : `<div class="small muted">${esc(t('settings.trashEmpty'))}</div>`}
      <div class="hint" style="margin-top:10px">${t('settings.trashHint')}</div>
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

function modalSecurityNotice() {
  const copy = SECURITY_NOTICE[lang] || SECURITY_NOTICE.zh;
  const sections = copy.sections.map(section => `
    <section class="security-notice-section">
      <h3>${esc(section[0])}</h3>
      <ul>${section[1].map(item => `<li>${esc(item)}</li>`).join('')}</ul>
    </section>`).join('');
  return modalFrame(
    copy.title,
    `<div class="security-notice-intro">${esc(copy.intro)}</div>
     <div class="security-notice-sections">${sections}</div>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(copy.close)}</button>
     <button class="btn btn-primary" type="button" data-action="close-security-notice">${esc(copy.hide)}</button>`
  );
}

function modalTutorial(mo) {
  const copy = BEGINNER_TUTORIAL[lang] || BEGINNER_TUTORIAL.zh;
  if (!Number.isInteger(mo.step)) {
    const topics = copy.steps.map((item, index) => `<button class="tutorial-topic" type="button" data-action="tutorial-topic" data-step="${index}"><span>${index + 1}</span>${esc(item[0])}</button>`).join('');
    return modalFrame(copy.title, `<p class="tutorial-choose">${esc(copy.choose)}</p><div class="tutorial-topics">${topics}</div>`, `<button class="btn" type="button" data-action="tutorial-skip">${esc(copy.skip)}</button>`);
  }
  const step = Math.max(0, Math.min(mo.step, copy.steps.length - 1));
  const item = copy.steps[step];
  const detailSet = TUTORIAL_DETAILS[lang] || TUTORIAL_DETAILS.zh;
  const details = detailSet[step] || [item[1]];
  return modalFrame(
    copy.title,
    `<div class="tutorial-progress"><span>${step + 1} / ${copy.steps.length}</span></div>
     <section class="tutorial-step"><div class="tutorial-number">${step + 1}</div><div><h3>${esc(item[0])}</h3><ol class="tutorial-detail-list">${details.map(detail => `<li>${esc(detail)}</li>`).join('')}</ol></div></section>`,
    `<button class="btn tutorial-skip" type="button" data-action="tutorial-catalog">${esc(copy.catalog)}</button>
     <button class="btn btn-primary" type="button" data-action="tutorial-finish">${esc(copy.finish)}</button>`
  );
}

function guideDetails() {
  if (!state.guide) return [];
  const all = TUTORIAL_DETAILS[lang] || TUTORIAL_DETAILS.zh;
  return all[state.guide.topic] || [];
}

function renderGuide() {
  if (!state.guide || state.modal) return '';
  const copy = BEGINNER_TUTORIAL[lang] || BEGINNER_TUTORIAL.zh;
  const ui = GUIDE_UI[lang] || GUIDE_UI.zh;
  const details = guideDetails();
  const index = Math.max(0, Math.min(state.guide.index || 0, details.length - 1));
  const last = index >= details.length - 1;
  return `<aside class="guide-coach" role="dialog" aria-label="${esc(copy.title)}">
      <div class="guide-coach-head"><b>${esc(copy.steps[state.guide.topic][0])}</b><span>${index + 1} / ${details.length}</span></div>
      <p>${esc(details[index] || '')}</p>
      <div class="guide-try">${esc(ui.tryIt)}</div>
      <div class="guide-actions">
        <button class="btn btn-ghost" type="button" data-action="guide-exit">${esc(ui.exit)}</button>
        <button class="btn" type="button" data-action="guide-prev" ${index ? '' : 'disabled'}>${esc(ui.back)}</button>
        <button class="btn btn-primary" type="button" data-action="${last ? 'guide-finish' : 'guide-next'}">${esc(last ? ui.done : ui.next)}</button>
      </div>
    </aside>`;
}

function importErrorModal(errors) {
  if (!errors.length) return null;
  return {
    type: 'notice',
    titleKey: 'modal.importStatusInvalid.title',
    body: errors.map(error => `<div>${esc(t('modal.importFieldInvalid', {
      title: error.title,
      field: t(error.fieldKey),
    }))}</div>`).join(''),
  };
}

function modalCompleteStep(mo) {
  const m = matterById(mo.matterId);
  if (!m) return '';
  const stageField = selectWithCustom('name="stage"', m.stage, stageOptions(), t('form.customStagePh'));
  const statusOpts = Object.keys(STATUS).map(k =>
    `<option value="${k}" ${m.status === k ? 'selected' : ''}>${STATUS[k].dot} ${esc(statusName(k))}</option>`).join('');
  const waitField = selectWithCustom('name="waiting"', m.waiting, waitingOptions(), t('form.customWaitPh'));
  const ownerOpts = USERS.map(x =>
    `<option value="${x.id}" ${m.nextOwner === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const members = USERS.map(x => `
    <label class="member-item">
      <input type="checkbox" name="team" value="${x.id}" ${(m.team || []).includes(x.id) ? 'checked' : ''}>
      <span class="nm">${esc(x.name)}</span>
      <span class="rl">${esc(t(x.roleKey))}</span>
    </label>`).join('');

  return modalFrame(
    t('modal.complete.title'),
    `<div class="step-box">
       <div class="small muted">${esc(t('modal.complete.aboutTo'))}</div>
       <div class="sd-text">✓ ${esc(L(m.next))}</div>
       <div class="small muted">${esc((USER[m.nextOwner] || {}).name || m.nextOwner)} · ${fmtDate(m.due)}（${dueText(m.due)}）</div>
       ${isAdmin() && currentUser().id !== m.nextOwner
         ? `<div class="small muted" style="margin-top:6px">${esc(t('modal.complete.adminNote', { name: (USER[m.nextOwner] || {}).name || m.nextOwner }))}</div>`
         : ''}
     </div>
     <div class="hint" style="margin-bottom:14px">${t('modal.complete.afterHint')}</div>
     <form id="complete-form" data-action="confirm-complete-step" data-id="${m.id}">
       <div class="grid-2">
         <div class="field"><label class="req">${esc(t('modal.complete.stage'))}</label>${stageField}</div>
         <div class="field"><label class="req">${esc(t('detail.status'))}</label><select name="status">${statusOpts}</select></div>
         <div class="field"><label>${esc(t('detail.dueMode'))}</label><select name="dueMode"><option value="date" ${/^\d{4}-\d{2}-\d{2}$/.test(m.due||'')?'selected':''}>${esc(t('detail.dueDate'))}</option><option value="asap" ${m.due==='ASAP'?'selected':''}>${esc(t('detail.dueAsap'))}</option><option value="none" ${!m.due?'selected':''}>${esc(t('detail.dueNone'))}</option></select></div>
         <div class="field"><label>${esc(t('detail.due'))}</label><input type="date" name="due" value="${esc(/^\d{4}-\d{2}-\d{2}$/.test(m.due||'')?m.due:'')}"></div>
         <div class="field"><label>${esc(t('form.waiting'))}</label>${waitField}</div>
       </div>
       <div class="field"><label class="req">${esc(t('form.next'))}</label>
         <input name="next" autocomplete="off" placeholder="${esc(t('form.nextPh'))}"></div>
       <div class="field"><label class="req">${esc(t('modal.complete.nextOwner'))}</label><select name="nextOwner">${ownerOpts}</select></div>
       <div class="field"><label>${esc(t('detail.reason'))}</label>
         <input name="reason" autocomplete="off" value="" placeholder="${esc(t('form.reasonPh'))}"></div>
       <div class="field"><label>${esc(t('form.stepMembers'))}</label>
         <div class="member-list">${members}</div>
         <div class="hint">${esc(t('form.stepMembersHint'))}</div></div>
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
         <input type="file" name="fileBlob" multiple required></div>
       <div class="hint">${esc(t('modal.file.hint'))}</div>
     </form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn btn-primary" type="submit" form="file-form">${esc(t('modal.file.submit'))}</button>`
  );
}

function modalMatterAction(mo) {
  const m=matterById(mo.matterId);
  if(!m) return '';
  return modalFrame(t('modal.matterAction.title'),
    `<div class="small muted">${esc(m.no)} · ${esc(L(m.title))}</div>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn" type="button" data-action="open-matter-edit" data-id="${esc(m.id)}">${esc(t('modal.matterAction.edit'))}</button>
     <button class="btn btn-primary" type="button" data-action="open-matter-work" data-id="${esc(m.id)}">${esc(t('modal.matterAction.work'))}</button>`);
}

let fileUploadInFlight = false;

async function uploadEncryptedAttachment(id,file,options) {
  const m=matterById(id);
  if(!m||!file) return false;
  try {
    if(!await ensureMatterCurrent(id)) return false;
    const sealed=await LCBCrypto.encryptFile(id,await file.arrayBuffer(),sbFetch);
    const storagePath=encodeURIComponent(String(id))+'/'+crypto.randomUUID()+'.lcb';
    const uploaded=await storageFetch('/object/lcb-encrypted-files/'+storagePath,{
      method:'POST',headers:{'Content-Type':'application/json','x-upsert':'false'},body:JSON.stringify(sealed),
    });
    if(!uploaded.ok) throw new Error('upload-http-'+uploaded.status);
    m.files=m.files||[];
    const safeName=String(file.name||'file').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim().slice(0,180)||'file';
    const versionGroup=safeName.toLocaleLowerCase();
    const sameVersions=m.files.filter(item=>(item.versionGroup||String(L(item.name)).normalize('NFKC').toLocaleLowerCase())===versionGroup);
    const version=sameVersions.reduce((max,item)=>Math.max(max,Number(item.version)||1),0)+1;
    const uploadedFile={name:safeName,type:file.type,size:file.size,storagePath,encrypted:'lcb-e2ee-v1',uploadedBy:currentUser().id,uploadedAt:Date.now(),versionGroup,version};
    m.files.push(uploadedFile);
    if(!(options&&options.silent))addLogKey(id,currentUser().id,'detail.entry.fileAdd',{name:safeName},{
      key:'inbox.fileAdd',vars:noticeVars(m,currentUser().id,{name:safeName}),
    });
    commit();
    return uploadedFile;
  } catch(e) {
    if(!authExpiredError(e)) showSystemError(e);
    return false;
  }
}

async function uploadEncryptedAttachments(id, files) {
  if (fileUploadInFlight || !files.length) return;
  fileUploadInFlight = true;
  let completed = 0;
  try {
    for (const file of files) {
      if (!await uploadEncryptedAttachment(id, file)) break;
      completed++;
    }
    if (completed === files.length) {
      state.modal = null;
      render();
      toast(t('toast.fileAdded'));
    }
  } finally {
    fileUploadInFlight = false;
  }
}

async function downloadEncryptedAttachment(id,index) {
  const m=matterById(id),f=m&&(m.files||[])[Number(index)];
  if(!m||!f||!f.storagePath||!canSee(currentUser(),m)) return;
  try {
    const res=await storageFetch('/object/authenticated/lcb-encrypted-files/'+f.storagePath);
    if(!res.ok) throw new Error('download-http-'+res.status);
    const sealed=JSON.parse(await res.text());
    const clear=await LCBCrypto.decryptFile(m.id,sealed,sbFetch);
    const blob=new Blob([clear],{type:f.type||'application/octet-stream'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=f.name;a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    state.modal=null;render();toast(t('toast.fileDownloaded'));
  } catch(e) { if(!authExpiredError(e)) showSystemError(e); }
}

async function removeEncryptedAttachment(id,index) {
  const m=matterById(id),i=Number(index),f=m&&(m.files||[])[i],u=currentUser();
  if(!m||!f||!u||(!u.admin&&(f.uploadedBy?f.uploadedBy!==u.id:m.owner!==u.id))) return;
  if(!await ensureMatterCurrent(id)) return;
  if(f.storagePath){
    const removed=await storageFetch('/object/lcb-encrypted-files/'+f.storagePath,{method:'DELETE'});
    if(!removed.ok){showSystemError(new Error('file-delete-http-'+removed.status));return;}
  }
  m.files.splice(i,1);
  addLogKey(id,u.id,'detail.entry.fileRemove',{name:f.name},{key:'inbox.fileRemove',vars:noticeVars(m,u.id,{name:f.name})});
  commit();state.modal=null;render();
}

function renderModal() {
  const mo = state.modal;
  if (!mo) return '';
  if (mo.type === 'new-matter') return modalNewMatter();
  if (mo.type === 'calendar-choice') return modalCalendarChoice(mo);
  if (mo.type === 'schedule-reminder') return modalScheduleReminder(mo);
  if (mo.type === 'schedule-details') return modalScheduleDetails(mo);
  if (mo.type === 'client-form') return modalClientForm(mo);
  if (mo.type === 'client-import') return modalClientImport();
  if (mo.type === 'file') return modalFile(mo);
  if (mo.type === 'matter-action') return modalMatterAction(mo);
  if (mo.type === 'complete-step') return modalCompleteStep(mo);
  if (mo.type === 'confirm') return modalConfirm(mo);
  if (mo.type === 'notice') return modalNotice(mo);
  if (mo.type === 'security-notice') return modalSecurityNotice();
  if (mo.type === 'tutorial') return modalTutorial(mo);
  if (mo.type === 'import') return modalImport();
  if (mo.type === 'import-invalid') return modalImportInvalid();
  return '';
}

function modalImport() {
  return modalFrame(t('modal.import.title'), `<div class="hint" style="margin-bottom:14px">${esc(t('modal.import.hint'))}</div><form id="import-form" data-action="import-file"><div class="field"><label class="req">${esc(t('modal.import.choose'))}</label><input type="file" name="importFile" accept=".csv,.xlsx,.xls" multiple required></div></form>`, `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button><button class="btn btn-primary" type="submit" form="import-form">${esc(t('modal.import.confirm'))}</button>`);
}

function modalImportInvalid() {
  const isClients = state.modal && state.modal.importKind === 'clients';
  return modalFrame(isClients ? t('clients.importTitle') : t('modal.import.title'), `<div style="font-size:14.5px;color:var(--ink-2);line-height:1.75">${esc(t('modal.import.invalid'))}</div>`, `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.import.no'))}</button><button class="btn btn-primary" type="button" data-action="download-import-sample" data-kind="${isClients ? 'clients' : 'matters'}">${esc(t('modal.import.yes'))}</button>`);
}

function modalCalendarChoice(mo) {
  return modalFrame(t('calendar.chooseTitle',{date:fmtDate(mo.date)}),
    `<div class="hint">${esc(t('calendar.chooseHint'))}</div>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button>
     <button class="btn" type="button" data-action="calendar-new-matter" data-date="${esc(mo.date)}">${esc(t('calendar.newMatter'))}</button>
     <button class="btn btn-primary" type="button" data-action="calendar-new-reminder" data-date="${esc(mo.date)}">${esc(t('calendar.dayReminder'))}</button>`);
}

function modalScheduleReminder(mo) {
  return modalFrame(t('calendar.reminderTitle'), `<form id="schedule-form" data-action="create-schedule">
    <input type="hidden" name="date" value="${esc(mo.date)}">
    <div class="field"><label>${esc(t('detail.due'))}</label><input type="date" value="${esc(mo.date)}" disabled></div>
    <div class="field"><label class="req">${esc(t('calendar.reminderTime'))}</label><input type="time" name="time" value="09:00" required></div>
    <div class="field"><label class="req">${esc(t('calendar.reminderMessage'))}</label><textarea name="message" rows="4" required placeholder="${esc(t('calendar.reminderPlaceholder'))}"></textarea></div>
    <label class="member-item"><input type="checkbox" name="enabled" value="1" checked><span class="nm">${esc(t('calendar.reminderEnable'))}</span></label>
    <div class="hint" style="margin-top:10px">${esc(t('calendar.reminderHint'))}</div>
  </form>`, `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button><button class="btn btn-primary" type="submit" form="schedule-form">${esc(t('calendar.reminderSave'))}</button>`);
}

function modalScheduleDetails(mo) {
  const item=matterById(mo.id);
  if (!item || item.kind !== 'schedule' || item.owner !== currentUser().id) return '';
  return modalFrame(t('calendar.dayReminder'),
    `<div class="kv"><span class="k">${esc(t('detail.due'))}</span><span class="v">${esc(fmtDate(item.due))}</span></div>
     <div class="kv"><span class="k">${esc(t('calendar.reminderTime'))}</span><span class="v">${esc(item.reminderTime)}</span></div>
     <div class="kv"><span class="k">${esc(t('calendar.reminderMessage'))}</span><span class="v">${esc(item.reminderText)}</span></div>`,
    `<button class="btn btn-danger" type="button" data-action="delete-schedule" data-id="${esc(item.id)}">${esc(t('calendar.reminderDelete'))}</button><button class="btn btn-primary" type="button" data-action="close-modal">${esc(t('common.ok'))}</button>`);
}

function modalClientForm(mo) {
  const c=mo.id?matterById(mo.id):null;
  const value=k=>esc(c&&c[k]||'');
  const contacts=(c&&c.contacts||[]).map(x=>[x.name,x.role,x.phone,x.email].join(' | ')).join('\n');
  const relations=(c&&c.relations||[]).map(x=>[x.name,x.type,x.note].join(' | ')).join('\n');
  return modalFrame(t(c?'clients.edit':'clients.new'),`<form id="client-form" data-action="save-client">${c?`<input type="hidden" name="id" value="${esc(c.id)}">`:''}<div class="grid-2"><div class="field"><label class="req">${esc(t('clients.name'))}</label><input name="clientName" value="${value('clientName')}" required></div><div class="field"><label>${esc(t('clients.lastContact'))}</label><input type="date" name="lastContact" value="${esc(String(c&&c.lastContact||'').slice(0,10))}"></div><div class="field"><label>${esc(t('clients.progress'))}</label><input name="communicationProgress" value="${value('communicationProgress')}"></div></div><div class="field"><label>${esc(L({zh:'联系人（每行：姓名 | 职务 | 电话 | 邮箱）',en:'Contacts (one per line: name | role | phone | email)',es:'Contactos (una línea: nombre | cargo | teléfono | correo)'}))}</label><textarea name="contactsText" rows="5">${esc(contacts)}</textarea></div><div class="field"><label>${esc(L({zh:'关联方（每行：名称 | 关系类型 | 说明）',en:'Related parties (one per line: name | relationship | note)',es:'Partes relacionadas (una línea: nombre | relación | nota)'}))}</label><textarea name="relationsText" rows="5">${esc(relations)}</textarea></div><div class="field"><label>${esc(t('clients.notes'))}</label><textarea name="notes" rows="4">${value('notes')}</textarea></div></form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button><button class="btn btn-primary" type="submit" form="client-form">${esc(t('clients.save'))}</button>`);
}
function modalClientImport() {
  return modalFrame(t('clients.importTitle'),`<div class="hint" style="margin-bottom:14px">${esc(t('clients.importHint'))}</div><form id="client-import-form" data-action="import-clients-file"><div class="field"><input type="file" name="clientFile" accept=".csv,.xlsx,.xls" multiple required></div></form>`,
    `<button class="btn" type="button" data-action="close-modal">${esc(t('modal.cancel'))}</button><button class="btn btn-primary" type="submit" form="client-import-form">${esc(t('clients.import'))}</button>`);
}

function modalNewMatter() {
  if (!state.modal || state.modal.type !== 'new-matter') return '';
  const areaField = selectWithCustom('name="area" data-area-picker', PRACTICE_AREAS[0].id, practiceAreaOptions(), t('form.customAreaPh'));
  const ownerOpts = USERS.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
  const nextOwnerOpts = ownerOpts;
  const stageField = selectWithCustom('name="stage"', STAGES[0], stageOptions(), t('form.customStagePh'));
  const waitField = selectWithCustom('name="waiting"', 'none', waitingOptions(), t('form.customWaitPh'));
  const statusOpts = Object.keys(STATUS).map(k => `<option value="${k}" ${k === 'green' ? 'selected' : ''}>${STATUS[k].dot} ${esc(statusName(k))}</option>`).join('');
  const clientField=selectWithCustom('name="client"',clientOptions()[0]&&clientOptions()[0].v||'__custom__',clientOptions(),t('clients.name'));
  return `
  <div class="modal-mask" data-mask="1">
    <div class="modal" data-stop="1">
      <form data-action="create-matter">
        <div class="modal-head"><h2>${esc(t('modal.new.title'))}</h2></div>
        <div class="modal-body">
          <div class="grid-2">
            <div class="field"><label class="req">${esc(t('detail.client'))}</label>${clientField}</div>
            <div class="field"><label class="req">${esc(t('detail.title'))}</label><input name="title" required></div>
            <div class="field"><label>${esc(t('detail.counterparties'))}</label><input name="counterparties"></div>
            <div class="field"><label>${esc(t('detail.relatedParties'))}</label><input name="relatedParties"></div>
            <div class="field"><label>${esc(t('detail.priority'))}</label><input name="priority"></div>
            <div class="field"><label>${esc(t('detail.startDate'))}</label><input type="date" name="startDate"></div>
            <div class="field"><label>${esc(t('detail.totalFee'))}</label><input name="totalFee"></div>
            <div class="field"><label>${esc(t('detail.paymentsReceived'))}</label><input name="paymentsReceived"></div>
            <div class="field"><label>${esc(t('detail.balance'))}</label><input name="balance"></div>
            <div class="field"><label>${esc(t('detail.contactName'))}</label><input name="contactName"></div>
            <div class="field"><label>${esc(t('detail.contactEmail'))}</label><input name="contactEmail"></div>
            <div class="field"><label class="req">${esc(t('detail.area'))}</label>${areaField}</div>
            <div class="field"><label class="req">${esc(t('detail.owner'))}</label><select name="owner">${ownerOpts}</select></div>
            <div class="field"><label class="req">${esc(t('detail.stage'))}</label>${stageField}</div>
            <div class="field"><label class="req">${esc(t('detail.status'))}</label><select name="status">${statusOpts}</select></div>
            <div class="field"><label>${esc(t('detail.dueMode'))}</label><select name="dueMode"><option value="date" selected>${esc(t('detail.dueDate'))}</option><option value="asap">${esc(t('detail.dueAsap'))}</option><option value="none">${esc(t('detail.dueNone'))}</option></select></div>
            <div class="field"><label>${esc(t('detail.due'))}</label><input type="date" name="due" value="${esc(state.modal.due || '')}"></div>
            <div class="field"><label>${esc(t('detail.waiting'))}</label>${waitField}</div>
            <div class="field"><label>${esc(ft('recurrence'))}</label><select name="recurrence"><option value="none">${esc(ft('recurrenceNone'))}</option><option value="weekly">${esc(ft('recurrenceWeekly'))}</option><option value="monthly">${esc(ft('recurrenceMonthly'))}</option></select></div>
            <div class="field"><label>${esc(ft('recurrenceUntil'))}</label><input type="date" name="recurrenceUntil"></div>
          </div>
          <div class="field"><label>${esc(t('detail.background'))}</label><textarea name="background" rows="4"></textarea></div>
          <div class="field"><label class="req">${esc(t('detail.next'))}</label><input name="next" required></div>
          <div class="field"><label>${esc(t('detail.nextOwner'))}</label><select name="nextOwner">${nextOwnerOpts}</select></div>
          <div class="field"><label>${esc(t('detail.reason'))}</label>
            <input name="reason" autocomplete="off" value="" placeholder="${esc(t('form.reasonPh'))}"></div>
          <div class="field"><label>${esc(t('detail.notes'))}</label><textarea name="notes" rows="3"></textarea></div>
          <div class="field"><label>${esc(t('detail.members'))}</label>
            <div class="member-list">
              ${USERS.map(u => `<label class="member-item">
                <input type="checkbox" name="team" value="${u.id}" ${defaultTeam('mx_invest').includes(u.id) ? 'checked' : ''}>
                <span class="nm">${esc(u.name)}</span>
                <span class="rl">${esc(t(u.roleKey))}</span>
              </label>`).join('')}
            </div>
            <div class="hint">${esc(t('modal.new.membersHint'))}</div>
          </div>
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

function viewForRoute(route) {
  if (route === '' || route === '/') return viewDashboard();
  if (route.startsWith('/matters/')) return viewMatter(route.split('/')[2],route.split('/')[3]);
  if (route.startsWith('/matters')) return viewMatters();
  if (route.startsWith('/search')) return viewGlobalSearch();
  if (route.startsWith('/calendar')) return viewCalendar();
  if (route.startsWith('/clients')) return viewClients();
  if (route.startsWith('/followups')) return viewFollowups();
  if (route.startsWith('/team')) return viewTeamWorkload();
  if (route.startsWith('/deadline')) return viewDeadlineCalculator();
  if (route.startsWith('/reports')) return viewReports();
  if (route.startsWith('/inbox')) return viewInbox();
  if (route.startsWith('/chat')) return viewChat();
  if (route.startsWith('/settings')) return viewSettings();
  if (route.startsWith('/trash')) return viewTrash();
  return viewDashboard();
}

function pageMarkup(content) {
  return `${CAN_PERSIST ? '' : `<div class="warn">${esc(t('banner.noStorage'))}</div>`}${content}`;
}

function scrollChatToBottom() {
  const history=document.querySelector('.chat-global-history');
  if(history)history.scrollTop=history.scrollHeight;
}

function render() {
  const app = document.getElementById('app');
  const modalRoot = document.getElementById('modal-root');
  const route = (location.hash || '#/').slice(1);
  const u = currentUser();

  if (!u) {
    app.innerHTML = viewLogin();
    modalRoot.innerHTML = '';
    turnstileWidgetId = null;
    requestAnimationFrame(renderTurnstile);
    return;
  }

  const content=viewForRoute(route);

  app.innerHTML = shell(route, content);
  requestAnimationFrame(updateNavScrollControls);
  if(route.startsWith('/chat')&&(state.chatScrollToBottom||!state.chatOpened)){
    state.chatOpened=true;state.chatScrollToBottom=false;
    requestAnimationFrame(scrollChatToBottom);
  } else if(!route.startsWith('/chat')) state.chatOpened=false;
  modalRoot.innerHTML = renderModal() + renderGuide();
  if (state.modal && state.modal.type === 'file') {
    const first = document.getElementById('file-form');
    if (first && first.fileName) first.fileName.focus();
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

function setFormBusy(form, label) {
  if (!form || form.dataset.busy === '1') return false;
  form.dataset.busy = '1';
  const buttons = [...form.querySelectorAll('button[type="submit"],input[type="submit"]')];
  if (form.id) buttons.push(...document.querySelectorAll(`button[form="${form.id}"],input[form="${form.id}"]`));
  [...new Set(buttons)].forEach(button => {
    button.disabled = true;
    button.dataset.idleLabel = button.textContent || button.value || '';
    if (button.tagName === 'INPUT') button.value = label;
    else button.textContent = label;
  });
  return true;
}

function clearFormBusy(form) {
  if (!form) return;
  form.dataset.busy = '';
  const buttons = [...form.querySelectorAll('button[type="submit"],input[type="submit"]')];
  if (form.id) buttons.push(...document.querySelectorAll(`button[form="${form.id}"],input[form="${form.id}"]`));
  [...new Set(buttons)].forEach(button => {
    button.disabled = false;
    const label = button.dataset.idleLabel;
    if (label !== undefined) {
      if (button.tagName === 'INPUT') button.value = label;
      else button.textContent = label;
    }
  });
}

/* 完成当前步骤：把这一步记进历史，然后把事项推进到下一步。
   data 里是「完成之后」的新状态，字段与需求单一致。 */
function completeStep(id, data) {
  const m = matterById(id);
  const u = currentUser();
  if (!m || !u) return false;
  if (!isStepOwner(u, m) && !u.admin) { toast(t('toast.onlyStepOwner', { name: (USER[m.nextOwner] || {}).name || m.nextOwner })); return false; }
  if (!String(data.next || '').trim()) { toast(t('toast.needNext')); return false; }
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
  m.due = data.dueMode === 'asap' ? 'ASAP' : (data.dueMode === 'date' ? String(data.due || '').trim() : '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.due || '')) { m.recurrence = 'none'; m.recurrenceUntil = ''; m.recurrenceNext = ''; }
  m.waiting = waiting || 'none';
  m.next = String(data.next).trim();
  m.nextOwner = data.nextOwner || m.nextOwner;
  m.handoff = m.nextOwner !== u.id ? { from:u.id, to:m.nextOwner, at:Date.now(), acceptedAt:null } : null;
  if (String(data.reason || '') !== L(m.reason)) m.reason = data.reason || '';
  if (Array.isArray(data.team) && data.team.length) {
    m.team = data.team.slice();
    if (!m.team.includes(m.owner)) m.team.push(m.owner);
  }

  addLogKey(id, u.id, 'detail.entry.stepDone', { text: done.text, owner: (USER[done.owner] || {}).name || done.owner }, {
    key: 'inbox.stepDone',
    vars: noticeVars(m, u.id, {
      step: done.text,
      next: m.next,
      owner: (USER[m.nextOwner] || {}).name || m.nextOwner,
      status: { __t: 'status.' + m.status + '.short', prefix: STATUS[m.status].dot + ' ' },
    }),
  });
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
  m.handoff = null;
  addLogKey(id, u.id, 'detail.entry.stepUndo', { text: s.text }, {
    key: 'inbox.stepUndo',
    vars: noticeVars(m, u.id, { step: s.text, owner: (USER[s.owner] || {}).name || s.owner }),
  });
  commit();
  toast(t('toast.undoDone', { text: L(s.text) }));
  return true;
}

function saveClientRecord(data,id) {
  const name=String(data.clientName||'').trim();
  if(!name) return null;
  let item=id&&matterById(id);
  if(item && item.kind!=='client') return null;
  if(!item){
    item={id:'client_'+crypto.randomUUID(),kind:'client',owner:currentUser().id,team:USERS.map(u=>u.id),deletedAt:null,status:'green'};
    matters.push(item);
  }
  const parseLines=(value,fields)=>String(value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const parts=line.split('|').map(x=>x.trim()),out={};fields.forEach((field,i)=>out[field]=parts[i]||'');return out;});
  const contacts=data.contacts||parseLines(data.contactsText,['name','role','phone','email']);
  const relations=data.relations||parseLines(data.relationsText,['name','type','note']);
  const first=contacts[0]||{};
  Object.assign(item,{clientName:name,title:name,contacts,relations,contactPerson:first.name||String(data.contactPerson||'').trim(),phone:first.phone||String(data.phone||'').trim(),email:first.email||String(data.email||'').trim(),communicationProgress:String(data.communicationProgress||'').trim(),lastContact:String(data.lastContact||'').trim(),notes:String(data.notes||'').trim()});
  return item;
}
async function clientImportRows(file) {
  if(file.size>IMPORT_FILE_LIMIT) throw new Error(L({zh:'导入文件不能超过 20MB',en:'Import files cannot exceed 20 MB',es:'Los archivos importados no pueden superar 20 MB'}));
  let rows;
  if(/\.xlsx?$/i.test(file.name)){
    if(!globalThis.XLSX) throw new Error('Excel parser unavailable');
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});
    rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
  } else {
    const lines=(await file.text()).split(/\r?\n/).filter(Boolean);
    const parse=line=>line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(x=>x.replace(/^\"|\"$/g,'').replace(/\"\"/g,'\"').trim());
    const heads=parse(lines.shift()||'');
    rows=lines.map(line=>Object.fromEntries(parse(line).map((v,i)=>[heads[i],v])));
  }
  if(rows.length>IMPORT_ROW_LIMIT) throw new Error(L({zh:'单个文件最多导入 5000 行',en:'Each file can contain at most 5,000 rows',es:'Cada archivo puede contener como máximo 5000 filas'}));
  return rows;
}

function importMatterRows(rows) {
  const aliases = {
    client:['客户','客户名称','委托人','client','client name','customer','cliente','nombre del cliente'],
    counterparties:['对方当事人','对方','对手方','opposing parties','opposing party','counterparties','counterparty','contrapartes','contraparte','parte contraria'],
    relatedParties:['关联方','关联主体','关联公司','related parties','related party','related entities','related companies','partes relacionadas','partes vinculadas','empresas relacionadas'],
    title:['事项名称','事项','事项标题','案件名称','项目名称','matter name','matter title','matter','title','case name','case title','case type','asunto','nombre del asunto','nombre del caso'],
    area:['业务类型','业务领域','案件类型','领域','practice area','practice','matter type','legal area','area','área','área de práctica','area de practica','tipo de asunto'],
    stage:['当前阶段','阶段','进度','stage','current stage','phase','etapa','etapa actual','fase'],
    status:['状态','事项状态','status','matter status','estado','estatus','situación','situacion'],
    due:['截止日期','截止','到期日','截止时间','期限','due date','due','deadline','expiry date','fecha límite','fecha limite','fecha de vencimiento','plazo'],
    dueMode:['截止方式','期限方式','due setting','due mode','deadline setting','tipo de vencimiento','modo de vencimiento'],
    waiting:['等待谁','等待对象','等待','waiting for','waiting on','waiting','pending from','en espera de','pendiente de','a la espera de'],
    next:['现在要做什么','当前步骤','下一步','下一步行动','当前任务','待办','next step','next steps','next action','current step','current action','next task','next','próximo paso','proximo paso','próxima acción','proxima accion','acción siguiente','accion siguiente','tarea siguiente'],
    owner:['负责人','经办人','主办人','承办人','owner','matter owner','assignee','assigned attorney','person responsible','responsable','encargado','a cargo'],
    team:['成员','事项成员','团队成员','members','matter members','team members','miembros','miembros del asunto','miembros del equipo'],
    nextOwner:['下一步负责人','下一步经办人','next step owner','next owner','next assignee','responsable del próximo paso','responsable del proximo paso','siguiente responsable'],
    background:['背景','案件背景','事项背景','background','case background','description','antecedentes','descripción','descripcion'],
    priority:['优先级','重要程度','priority','importance','prioridad'],
    startDate:['开始日期','启动日期','start date','opening date','fecha de inicio'],
    totalFee:['费用总额','总费用','律师费','total fee','total fee ($)','fees','honorarios totales'],
    paymentsReceived:['已收款','已付款','收款金额','payments received','payments received ($)','amount received','pagos recibidos'],
    balance:['余额','未收款','应收余额','balance','balance ($)','outstanding balance','saldo'],
    contactName:['联系人','客户联系人','contact name','contact person','persona de contacto'],
    contactEmail:['联系邮箱','联系人邮箱','contact email','email contact','correo de contacto'],
    lastContact:['最后联系客户','最后联系','最后联系时间','last client contact','last contact','last contacted','último contacto','ultimo contacto'],
    recurrence:['重复事项','重复规则','重复','recurrence','repeat','repeat rule','repetición','repeticion','regla de repetición','regla de repeticion'],
    recurrenceUntil:['重复至','重复截止日期','repeat until','recurrence until','repetir hasta','repetición hasta','repeticion hasta'],
    reason:['风险原因','原因','状态原因','risk reason','reason','status reason','motivo del riesgo','motivo','razón del estado','razon del estado'],
    notes:['备注','说明','notes','note','remarks','notas','observaciones'],
  };
  const val = (row, keys) => { const key = Object.keys(row).find(k => keys.some(a => k.trim().toLowerCase() === a.toLowerCase())); return key ? row[key] : ''; };
  const requiredHeaders = ['client','title','status','next'];
  const headersPresent = Object.keys(rows[0] || {}).map(k => k.trim().toLowerCase());
  const headerAliases = Object.fromEntries(requiredHeaders.map(name => [name, aliases[name]]));
  const validFormat = rows.length > 0 && requiredHeaders.every(name => headerAliases[name].some(alias => headersPresent.includes(alias.toLowerCase())));
  if (!validFormat) return { invalid:true, ok:0, bad:0, errors:[] };
  let ok = 0, bad = 0;
  const errors = [];
  rows.forEach(row => {
    const d = {};
    Object.keys(aliases).forEach(k => d[k] = String(val(row, aliases[k]) ?? '').trim());
    const displayTitle = d.title || d.client || '—';
    const rawDue = String(val(row, aliases.due) ?? '').trim();
    d.due = normalizeImportedDate(rawDue);
    const rawDueMode = d.dueMode.toLowerCase();
    if (['asap','尽快','紧急','urgente'].includes(rawDueMode)) d.due = 'ASAP';
    if (['不设置','无','none','no due date','sin fecha límite','sin fecha limite'].includes(rawDueMode)) d.due = '';
    d.startDate = normalizeImportedDate(d.startDate) || d.startDate;
    d.lastContact = normalizeImportedDate(d.lastContact) || d.lastContact;
    const member = value => USERS.find(u => [u.id,u.name,u.email].some(candidate => String(candidate||'').toLowerCase() === String(value||'').toLowerCase()));
    d.owner = member(d.owner)?.id || currentUser().id;
    d.nextOwner = member(d.nextOwner)?.id || d.owner;
    d.team = String(d.team || '').split(/[,，;；|\n]/).map(name => member(name.trim())?.id).filter(Boolean);
    const recurrence = String(d.recurrence || '').trim().toLowerCase();
    d.recurrence = ['weekly','每周','semanal'].includes(recurrence) ? 'weekly'
      : (['monthly','每月','mensual'].includes(recurrence) ? 'monthly' : 'none');
    d.recurrenceUntil = normalizeImportedDate(d.recurrenceUntil) || '';
    const importedStatus = normalizeImportedStatus(val(row, aliases.status));
    if (!d.client) errors.push({ title: displayTitle, fieldKey: 'detail.client' });
    if (!d.title) errors.push({ title: displayTitle, fieldKey: 'detail.title' });
    if (!importedStatus) errors.push({ title: displayTitle, fieldKey: 'detail.status' });
    if (!d.next) errors.push({ title: displayTitle, fieldKey: 'detail.next' });
    d.status = importedStatus || 'green';
    d.area = d.area || 'other'; d.stage = d.stage || STAGES[0]; d.waiting = d.waiting || 'none';
    d.importStatusError = !importedStatus || !d.client || !d.title || !d.next;
    d.client = d.client || '—'; d.title = d.title || '—'; d.due = d.due || '';
    d.allowImportErrors = true;
    if ((d.counterparties || d.relatedParties) && potentialConflicts(d).length) {
      errors.push({ title:displayTitle, fieldKey:'conflict.title' }); bad++; return;
    }
    if (createMatter(d)) ok++; else bad++;
  });
  return { invalid:false, ok, bad, errors };
}

const CLIENT_IMPORT_ALIASES = {
  clientName:['客户名称','客户','委托人','客户名','client name','client','customer','customer name','nombre del cliente','cliente'],
  contactPerson:['联系人','主要联系人','联络人','contact person','contact','primary contact','persona de contacto','contacto principal'],
  phone:['电话','手机','联系电话','手机号','phone','mobile','telephone','phone number','teléfono','telefono','móvil','movil'],
  email:['邮箱','电子邮箱','邮件','email','email address','e-mail','correo electrónico','correo electronico','correo'],
  communicationProgress:['沟通进度','进度','跟进状态','沟通状态','communication progress','progress','follow-up status','contact status','progreso de comunicación','progreso de comunicacion','estado de seguimiento'],
  lastContact:['最后联系','最后一次联系','最后联系时间','最近联系','last contact','last contacted','last contact date','último contacto','ultimo contacto','fecha del último contacto','fecha del ultimo contacto'],
  notes:['备注','说明','补充信息','notes','note','remarks','comments','nota','notas','observaciones','comentarios'],
  contactsText:['多个联系人','联系人列表','其他联系人','contacts','contact list','additional contacts','contactos','lista de contactos'],
  relationsText:['关联方','关联公司','关联主体','related parties','related companies','related entities','partes relacionadas','empresas relacionadas','partes vinculadas'],
};

function importedClientData(row) {
  const aliases=CLIENT_IMPORT_ALIASES;
  const out={};
  for(const [field,names] of Object.entries(aliases)){
    const key=Object.keys(row).find(k=>names.includes(String(k).trim().toLowerCase()));
    out[field]=key===undefined?'':String(row[key]??'').trim();
  }
  if(out.lastContact) out.lastContact=normalizeImportedDate(out.lastContact)||'';
  return out;
}

function validClientImportFormat(rows) {
  if (!rows.length) return false;
  const names = CLIENT_IMPORT_ALIASES.clientName;
  return Object.keys(rows[0]).some(key => names.includes(String(key).trim().toLowerCase()));
}

function importSample(kind) {
  const samples = kind === 'clients' ? {
    zh: { heads:['客户名称','联系人','电话','邮箱','沟通进度','最后联系','备注','多个联系人','关联方'], required:[0], filename:'客户档案导入示例.xls' },
    en: { heads:['Client name','Contact person','Phone','Email','Communication progress','Last contact','Notes','Contacts','Related parties'], required:[0], filename:'client-record-import-sample.xls' },
    es: { heads:['Nombre del cliente','Persona de contacto','Teléfono','Correo electrónico','Progreso de comunicación','Último contacto','Notas','Contactos','Partes relacionadas'], required:[0], filename:'ejemplo-importacion-clientes.xls' },
  } : {
    zh: { heads:['客户','事项名称','对方当事人','关联方','业务类型','当前阶段','状态','截止日期','截止方式','等待谁','现在要做什么','负责人','事项成员','下一步负责人','背景','优先级','开始日期','费用总额','已收款','余额','联系人','联系邮箱','最后联系客户','重复事项','重复至','风险原因','备注'], required:[0,1,6,10], filename:'事项导入示例.xls' },
    en: { heads:['Client','Matter name','Opposing parties','Related parties','Practice area','Stage','Status','Due date','Due setting','Waiting for','Next step','Owner','Matter members','Next step owner','Background','Priority','Start date','Total fee','Payments received','Balance','Contact name','Contact email','Last client contact','Recurrence','Repeat until','Risk reason','Notes'], required:[0,1,6,10], filename:'matter-import-sample.xls' },
    es: { heads:['Cliente','Asunto','Contrapartes','Partes relacionadas','Área','Etapa','Estado','Fecha límite','Tipo de vencimiento','En espera de','Próximo paso','Responsable','Miembros del asunto','Responsable del próximo paso','Antecedentes','Prioridad','Fecha de inicio','Honorarios totales','Pagos recibidos','Saldo','Persona de contacto','Correo de contacto','Último contacto','Repetición','Repetir hasta','Motivo del riesgo','Notas'], required:[0,1,6,10], filename:'ejemplo-importacion-asuntos.xls' },
  };
  return samples[lang] || samples.zh;
}

function partyNames(value) {
  return String(value || '').split(/[,，;；\n]/).map(name => name.trim()).filter(Boolean);
}
function partyKey(value) {
  return String(value || '').toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '');
}
function potentialConflicts(data, excludeId) {
  const inputs = [
    ...partyNames(data.client).map(name=>({name,role:'client'})),
    ...partyNames(data.counterparties).map(name=>({name,role:'opposing'})),
    ...partyNames(data.relatedParties).map(name=>({name,role:'related'})),
  ];
  const seen = new Set();
  const matches = [];
  const compare = (name, source, existingRole) => {
    const target = partyKey(name);
    if (target.length < 2) return;
    inputs.forEach(input => {
      if(input.role==='client'&&existingRole==='client') return;
      const key = partyKey(input.name);
      if (!key || (key !== target && (key.length < 4 || target.length < 4 || (!key.includes(target) && !target.includes(key))))) return;
      const signature = key + '|' + source;
      if (seen.has(signature)) return;
      seen.add(signature);
      matches.push(`${input.name} ↔ ${source}`);
    });
  };
  matters.filter(item => !item.deletedAt && item.kind !== 'client' && item.kind !== 'schedule' && String(item.id) !== String(excludeId || '') && canSee(currentUser(), item)).forEach(item => {
    const source = `${item.no || ''} ${L(item.title)}`.trim();
    partyNames(L(item.client)).forEach(name=>compare(name,source,'client'));
    partyNames(item.counterparties).forEach(name=>compare(name,source,'opposing'));
    partyNames(item.relatedParties).forEach(name=>compare(name,source,'related'));
  });
  clientProfiles().filter(item => String(item.id) !== String(excludeId || '') && canSee(currentUser(), item)).forEach(item => {
    compare(item.clientName,item.clientName,'client');
    (item.relations||[]).forEach(x=>compare(x.name,`${item.clientName} · ${x.type||''}`,'related'));
  });
  return matches.slice(0, 12);
}

function createMatter(data) {
  const customClient=data.client==='__custom__';
  const client=resolveCustom(data.client,data.clientCustom);
  data.client=client;
  if (!data.allowImportErrors && (!data.client || !data.title || !data.next)) { toast(t('toast.needClient')); return false; }
  if (!data.allowImportErrors && (data.status === 'red' || data.status === 'yellow') && !String(data.reason || '').trim()) { toast(t('toast.needReason')); return false; }
  const stage = resolveCustom(data.stage, data.stageCustom);
  const waiting = resolveCustom(data.waiting, data.waitingCustom);
  const area = resolveCustom(data.area, data.areaCustom);
  if (area === null || stage === null || waiting === null) { toast(t('toast.needCustom')); return false; }
  let createdClient=false;
  if(customClient && !clientProfiles().some(c=>String(c.clientName).toLowerCase()===String(client).toLowerCase())){
    const profile=saveClientRecord({clientName:client});
    if(profile){
      addOperationNotification(profile,'inbox.clientCreated',{actor:(USER[currentUser().id]||{}).name||currentUser().id,client},USERS.map(u=>u.id));
      createdClient=true;
    }
  }
  seq += 1;
  const id = seq;
  const team = (data.team && data.team.length) ? data.team.slice() : defaultTeam(area);
  const due = data.dueMode === 'asap' ? 'ASAP' : (data.dueMode === 'none' ? '' : String(data.due || '').trim());
  const recurrence = /^\d{4}-\d{2}-\d{2}$/.test(due) ? (data.recurrence || 'none') : 'none';
  const m = {
    id, no: `2026-${String(id).padStart(3, '0')}`,
    client: data.client, title: data.title, area,
    counterparties:String(data.counterparties || '').trim(), relatedParties:String(data.relatedParties || '').trim(),
    background:String(data.background || '').trim(), priority:String(data.priority || '').trim(),
    startDate:String(data.startDate || '').trim(), totalFee:String(data.totalFee || '').trim(),
    paymentsReceived:String(data.paymentsReceived || '').trim(), balance:String(data.balance || '').trim(),
    contactName:String(data.contactName || '').trim(), contactEmail:String(data.contactEmail || '').trim(),
    owner: data.owner, team,
    stage: stage || STAGES[0], status: data.status, reason: data.reason || '',
    next: data.next, nextOwner: data.nextOwner || data.owner,
    due, waiting: waiting || 'none',
    recurrence, recurrenceUntil: recurrence === 'none' ? '' : (data.recurrenceUntil || ''),
    importStatusError: !!data.importStatusError,
    files: [], lastContact: data.lastContact || iso(today()), notes: String(data.notes || '').trim(),
  };
  if (m.recurrence !== 'none') m.recurrenceNext = advanceRecurringDate(m.due, m.recurrence);
  if (!m.team.includes(m.owner)) m.team.push(m.owner);
  matters.push(m);
  addLogKey(id, currentUser().id, 'detail.entry.new', { no: m.no, area: areaName(m.area) }, {
    key: 'inbox.new',
    vars: noticeVars(m, currentUser().id, {
      next: m.next,
      owner: (USER[m.nextOwner] || {}).name || m.nextOwner,
      status: { __t: 'status.' + m.status + '.short', prefix: STATUS[m.status].dot + ' ' },
    }),
  });
  commit();
  if(createdClient) deliverOperationNotification();
  toast(t('toast.created', { no: m.no }));
  return m;
}

async function matterChangedOnServer(id) {
  if (!REMOTE_ENABLED || !authSession) return false;
  const known = matterServerUpdatedAt.get(String(id));
  if (!known) return false;
  const response = await sbFetch('/matters?select=updated_at&id=eq.' + encodeURIComponent(id) + '&limit=1');
  if (!response.ok) throw new Error('matter-version-http-' + response.status);
  const rows = await response.json();
  return !!(rows[0] && rows[0].updated_at && rows[0].updated_at !== known);
}
async function ensureMatterCurrent(id) {
  if (!await matterChangedOnServer(id)) return true;
  state.modal={type:'confirm',titleKey:'syncConflict.title',body:t('syncConflict.body'),confirmKey:'syncConflict.reload',action:'reload-conflicted-matter',id};
  render();
  return false;
}
async function reloadMatterFromServer(id) {
  const response=await sbFetch('/matters?select=id,data,updated_at&id=eq.'+encodeURIComponent(id)+'&limit=1');
  if(!response.ok) throw new Error('matter-reload-http-'+response.status);
  const rows=await response.json();
  if(!rows[0]) throw new Error('matter-reload-missing');
  const latest=globalThis.LCBCrypto&&LCBCrypto.state.ready?await LCBCrypto.openMatter(rows[0].data,sbFetch):rows[0].data;
  const index=matters.findIndex(item=>String(item.id)===String(id));
  if(index>=0) matters[index]=latest; else matters.push(latest);
  matterServerUpdatedAt.set(String(id),rows[0].updated_at||'');
  matterPlainBaseline.set(String(id),JSON.stringify(latest));
}

function saveMatterFromDom(id) {
  const m = matterById(id);
  if (!m) return;
  if (currentUser().id !== m.owner) {
    toast(t('toast.onlyOwnerEdit', { name: (USER[m.owner] || {}).name || m.owner }));
    return;
  }
  const box = document.querySelector(`[data-matter="${id}"]`);
  if (!box) return;
  const get = f => { const el = box.querySelector(`[data-field="${f}"]`); return el ? el.value : undefined; };
  const changes = [];
  const before = { ...m };
  const beforeSnapshot = matterEditSnapshot(m);
  // 表单里显示的是当前语言的文字；如果用户没改，就保留原来的多语言数据
  const shown = {
    client: L(m.client), title: L(m.title), counterparties:m.counterparties || '', relatedParties:m.relatedParties || '',
    background:m.background || '', priority:m.priority || '', startDate:String(m.startDate || '').slice(0,10),
    totalFee:m.totalFee || '', paymentsReceived:m.paymentsReceived || '', balance:m.balance || '',
    contactName:m.contactName || '', contactEmail:m.contactEmail || '', next: L(m.next), reason: L(m.reason), notes: L(m.notes),
    area: m.area, stage: m.stage, owner: m.owner, nextOwner: m.nextOwner, status: m.status,
    due: /^\d{4}-\d{2}-\d{2}$/.test(m.due || '') ? m.due : '', dueMode: m.due === 'ASAP' ? 'asap' : (m.due ? 'date' : 'none'), waiting: m.waiting, lastContact: String(m.lastContact || '').slice(0, 10),
    recurrence: m.recurrence || 'none', recurrenceUntil: m.recurrenceUntil || '',
  };

  // 选了「自定义…」就必须填内容，先校验再改数据
  if ((get('area') === '__custom__' && !String(get('areaCustom') || '').trim()) ||
      (get('stage') === '__custom__' && !String(get('stageCustom') || '').trim()) ||
      (get('waiting') === '__custom__' && !String(get('waitingCustom') || '').trim())) {
    toast(t('toast.needCustom')); return;
  }
  const dueMode = get('dueMode') || 'none';
  const nextDue = dueMode === 'asap' ? 'ASAP' : (dueMode === 'date' ? String(get('due') || '').trim() : '');
  if (nextDue !== m.due) { m.due = nextDue; changes.push('due'); }
  ['client', 'title', 'counterparties', 'relatedParties', 'background', 'priority', 'startDate', 'totalFee', 'paymentsReceived', 'balance', 'contactName', 'contactEmail', 'area', 'stage', 'owner', 'nextOwner', 'status', 'due', 'waiting', 'lastContact', 'recurrence', 'recurrenceUntil', 'next', 'reason', 'notes'].forEach(f => {
    if (f === 'due') return;
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
  const team = [...box.querySelectorAll('[data-field="team"]:checked')].map(x => x.value);
  if (!team.includes(m.owner)) team.push(m.owner);
  if (team.slice().sort().join() !== (m.team || []).slice().sort().join()) { m.team = team; changes.push('team'); }

  if (!m.client || !m.title || !m.next) { toast(t('toast.needClient')); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.due || '')) { m.recurrence = 'none'; m.recurrenceUntil = ''; }
  if ((m.status === 'red' || m.status === 'yellow') && !String(L(m.reason) || '').trim()) { toast(t('toast.needReason')); return; }
  if (m.importStatusError) { m.importStatusError = false; changes.push('importStatusError'); }

  if (before.status !== m.status) addLogKey(id, currentUser().id, 'detail.entry.status', { status: { __t: 'status.' + m.status, prefix: STATUS[m.status].dot + ' ' } });
  if (before.next !== m.next) addLogKey(id, currentUser().id, 'detail.entry.next', { next: L(m.next) });
  if (before.due !== m.due) addLogKey(id, currentUser().id, 'detail.entry.due', { date: { __date: m.due }, rel: { __rel: m.due } });
  if (before.owner !== m.owner) addLogKey(id, currentUser().id, 'detail.entry.owner', { name: USER[m.owner].name });
  if (before.waiting !== m.waiting) addLogKey(id, currentUser().id, 'detail.entry.waiting', { w: { __t: 'wait.' + m.waiting } });
  if (before.nextOwner !== m.nextOwner) m.handoff = m.nextOwner !== currentUser().id ? { from:currentUser().id, to:m.nextOwner, at:Date.now(), acceptedAt:null } : null;
  if (before.recurrence !== m.recurrence || before.due !== m.due) m.recurrenceNext = m.recurrence && m.recurrence !== 'none' ? advanceRecurringDate(m.due, m.recurrence) : '';
  if (changes.length) {
    const editLog = addLogKey(id, currentUser().id, 'detail.entry.edited', {}, {
      key: 'inbox.edited',
      vars: noticeVars(m, currentUser().id, {
        next: m.next,
        owner: (USER[m.nextOwner] || {}).name || m.nextOwner,
        status: { __t: 'status.' + m.status + '.short', prefix: STATUS[m.status].dot + ' ' },
      }),
    });
    editLog.undo = { kind: 'matter-edit', before: beforeSnapshot };
  }
  commit();
  toast(t('toast.saved'));
  render();
}

function exportCSV(onlyId) {
  const u = currentUser();
  const list = onlyId ? [matterById(onlyId)].filter(Boolean) : sorted(filterMatters());
  const head = ['csv.no', 'csv.client', 'csv.counterparties', 'csv.relatedParties', 'csv.title', 'csv.area', 'csv.owner', 'csv.status', 'csv.stage',
    'csv.next', 'csv.nextOwner', 'csv.due', 'csv.waiting', 'csv.lastContact', 'csv.background', 'csv.priority', 'csv.startDate',
    'csv.totalFee', 'csv.paymentsReceived', 'csv.balance', 'csv.contactName', 'csv.contactEmail', 'csv.notes'].map(k => t(k));
  const rows = list.map(m => [
    m.no, L(m.client), m.counterparties || '', m.relatedParties || '', L(m.title), areaName(m.area), USER[m.owner].name,
    statusName(m.status), stageLabel(m.stage), L(m.next), USER[m.nextOwner] ? USER[m.nextOwner].name : m.nextOwner,
    m.due, waitLabel(m.waiting), m.lastContact, m.background || '', m.priority || '', m.startDate || '',
    m.totalFee || '', m.paymentsReceived || '', m.balance || '', m.contactName || '', m.contactEmail || '', L(m.notes),
  ]);
  if (onlyId) { head.push(t('csv.reason')); rows[0].push(L(matterById(onlyId).reason)); }
  const csv = '\ufeff' + [head, ...rows].map(r => r.map(csvCell).join(',')).join('\n');
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
  if (!isAdmin()) throw new Error('admin-required');
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
  const payload = { format:'lcb-encrypted-backup-v1', site:'team', createdAt:new Date().toISOString(), tables, files };
  const blob = new Blob([JSON.stringify(payload)], { type:'application/json' });
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='lcb-team-encrypted-backup-'+new Date().toISOString().slice(0,10)+'.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href),1000); recordSecurityEvent('backup_exported',{files:files.length}); toast(t('toast.backupDone'));
}
async function upsertBackupRows(table, rows) {
  if (!rows || !rows.length) return;
  const res = await sbFetch('/'+table, { method:'POST', headers:UPSERT, body:JSON.stringify(rows) });
  if (!res.ok) throw new Error('restore-'+table+'-http-'+res.status);
}
async function restoreEncryptedBackup(file) {
  if (!isAdmin()) throw new Error('admin-required');
  const data=JSON.parse(await file.text());
  if (!data || data.format!=='lcb-encrypted-backup-v1' || data.site!=='team' || !data.tables) throw new Error('invalid-backup');
  const restored=await sbFetch('/rpc/lcb_restore_encrypted_backup',{method:'POST',body:JSON.stringify({payload:data.tables})});
  if (!restored.ok) throw new Error('restore-backup-http-'+restored.status);
  for (const item of (data.files||[])) {
    const res=await storageFetch('/object/'+ENCRYPTED_BUCKET+'/'+item.path,{method:'POST',headers:{'Content-Type':'application/json','x-upsert':'true'},body:JSON.stringify(item.sealed)});
    if (!res.ok) throw new Error('restore-file-http-'+res.status);
  }
  await pullRemote({initial:true}); sync.dirty=true; await pushRemote(); recordSecurityEvent('backup_restored',{files:(data.files||[]).length}); toast(t('toast.restoreDone'));
}
async function showSecurityEvents() {
  if(!isAdmin()) throw new Error('admin-required');
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
    case 'close-chat-tool': {
      const tool=el.closest('details.chat-tool');
      if(tool)tool.open=false;
      break;
    }
    case 'local-login': {
      if(!LOCAL_TEST_MODE)break;
      const userId=el.getAttribute('data-user');
      if(!USER[userId])break;
      if(!matters.length){matters=seedMatters();logs=seedLogs();seq=Math.max(0,...matters.map(m=>Number(m.id)||0));save(KEY.matters,matters);save(KEY.logs,logs);save(KEY.seq,seq);}
      session={userId};save(KEY.session,session);state.loginError='';state.modal=null;go('#/');render();toast(t('toast.welcome',{name:USER[userId].name.split(' ')[0]}));break;
    }
    case 'mobile-nav-toggle':
      setMobileNavOpen(!state.mobileNavOpen);break;
    case 'mobile-nav-close':
      setMobileNavOpen(false);break;
    case 'mobile-nav-link':
      ev.preventDefault();
      {
        const href=el.getAttribute('href');
        setMobileNavOpen(false);
        history.pushState(null,'',href);
        const route=(location.hash||'#/').slice(1);
        const page=document.querySelector('.page');
        if(page) page.innerHTML=pageMarkup(viewForRoute(route));
        if(route.startsWith('/settings')) refreshDeviceList().catch(()=>{});
        setTimeout(render,300);
      }
      break;
    case 'open-tutorial':
      setMobileNavOpen(false);
      state.modal = { type:'tutorial' };
      render();
      break;
    case 'tutorial-topic':
      state.guide = { topic:Number(el.getAttribute('data-step')) || 0, index:0 };
      state.modal = null;
      go(GUIDE_ROUTES[state.guide.topic]);
      render();
      break;
    case 'tutorial-catalog':
      state.modal = { type:'tutorial' };
      render();
      break;
    case 'tutorial-skip':
    case 'tutorial-finish':
      save(KEY.tutorialCompleted, true);
      state.modal = null;
      render();
      break;
    case 'guide-next':
      if (state.guide) state.guide.index = Math.min(guideDetails().length - 1, state.guide.index + 1);
      render();
      break;
    case 'guide-prev':
      if (state.guide) state.guide.index = Math.max(0, state.guide.index - 1);
      render();
      break;
    case 'guide-exit':
      state.guide = null;
      state.modal = { type:'tutorial' };
      render();
      break;
    case 'guide-finish':
      save(KEY.tutorialCompleted, true);
      state.guide = null;
      render();
      break;
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
      state.modal = {
        type:'confirm', titleKey:'modal.logoutAll.title', body:t('modal.logoutAll.body'),
        confirmKey:'modal.logoutAll.confirm', action:'confirm-logout-all-devices', danger:true,
      };
      render();
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
      try { await signOutEverywhere(); toast(t('toast.loggedOut')); }
      catch (e) { showSystemError(e); }
      break;
    case 'export-encrypted-backup':
      try { await exportEncryptedBackup(); } catch (e) { showSystemError(e); }
      break;
    case 'view-security-events':
      try { await showSecurityEvents(); } catch(e) { showSystemError(e); }
      break;
    case 'restore-encrypted-backup': {
      const input=document.createElement('input'); input.type='file'; input.accept='.json,application/json';
      input.onchange=()=>{ if(input.files[0]) { state.modal={type:'confirm',titleKey:'modal.backupRestore.title',body:t('modal.backupRestore.body'),confirmKey:'modal.backupRestore.confirm',action:'confirm-restore-encrypted-backup',backupFile:input.files[0],danger:true}; render(); } };
      input.click(); break;
    }
    case 'confirm-restore-encrypted-backup': {
      const file=state.modal && state.modal.backupFile; state.modal=null;
      try { if(file) await restoreEncryptedBackup(file); } catch(e) { showSystemError(e); }
      break;
    }
    case 'set-lang':
      setLang(el.getAttribute('data-lang'));
      break;
    case 'sync-now':
      resetSyncRetries();
      sync.status = 'loading';
      render();
      refreshDeviceList().catch(e=>{if(!authExpiredError(e)) showSystemError(e);});
      if (sync.dirty) { pushRemote(); toast(t('sync.loading')); }
      else { toast(t('sync.loading')); pullRemote(); }
      break;
    case 'new-matter':
      state.modal = { type: 'new-matter' }; render(); break;
    case 'calendar-prev': state.calendarOffset -= 1; render(); break;
    case 'calendar-next': state.calendarOffset += 1; render(); break;
    case 'calendar-today': state.calendarOffset = 0; render(); break;
    case 'calendar-date':
      state.modal = { type:'calendar-choice', date:el.getAttribute('data-date') }; render(); break;
    case 'calendar-new-matter':
      state.modal = { type:'new-matter', due:el.getAttribute('data-date') }; render(); break;
    case 'calendar-new-reminder':
      state.modal = { type:'schedule-reminder', date:el.getAttribute('data-date') }; render(); break;
    case 'new-client': state.modal={type:'client-form'}; render(); break;
    case 'edit-client': state.modal={type:'client-form',id:el.getAttribute('data-id')}; render(); break;
    case 'import-clients': state.modal={type:'client-import'}; render(); break;
    case 'toggle-client': {
      const id=String(el.getAttribute('data-id')),item=matterById(id);
      if(!item||item.kind!=='client'||(!currentUser().admin&&item.owner!==currentUser().id)) break;
      if(el.checked) state.clientSelected.add(id); else state.clientSelected.delete(id);
      render(); break;
    }
    case 'toggle-all-clients': {
      const selectable=clientProfiles().filter(c=>currentUser().admin||c.owner===currentUser().id);
      const selectAll=selectable.length>0&&!selectable.every(c=>state.clientSelected.has(String(c.id)));
      selectable.forEach(c=>selectAll?state.clientSelected.add(String(c.id)):state.clientSelected.delete(String(c.id)));
      render(); break;
    }
    case 'bulk-delete-clients': {
      const ids=[...state.clientSelected].filter(id=>{
        const item=matterById(id);
        return item&&item.kind==='client'&&!item.deletedAt&&canSee(currentUser(),item)&&(currentUser().admin||item.owner===currentUser().id);
      });
      if(!ids.length) break;
      state.modal={type:'confirm',titleKey:'modal.bulkDeleteClients.title',body:t('modal.bulkDeleteClients.body',{n:ids.length}),confirmText:t('modal.bulkDelete.confirm',{n:ids.length}),action:'confirm-bulk-delete-clients',ids,danger:true};
      render(); break;
    }
    case 'confirm-bulk-delete-clients': {
      const ids=(state.modal&&state.modal.ids||[]).filter(id=>{
        const item=matterById(id);
        return item&&item.kind==='client'&&!item.deletedAt&&canSee(currentUser(),item)&&(currentUser().admin||item.owner===currentUser().id);
      });
      ids.forEach(id=>{
        const item=matterById(id);
        item.deletedAt=Date.now();
        addOperationNotification(item,'inbox.clientDeleted',{actor:(USER[currentUser().id]||{}).name||currentUser().id,client:item.clientName},USERS.map(u=>u.id));
        state.clientSelected.delete(String(id));
      });
      if(ids.length){commit();deliverOperationNotification();}
      state.modal=null;render();
      if(ids.length) toast(t('toast.bulkDeletedClients',{n:ids.length}));
      break;
    }
    case 'delete-client': state.modal={type:'confirm',titleKey:'clients.deleteTitle',body:t('clients.deleteBody'),confirmKey:'clients.delete',action:'confirm-delete-client',id:el.getAttribute('data-id'),danger:true}; render(); break;
    case 'confirm-delete-client': {
      const id=el.getAttribute('data-id'), item=matterById(id);
      if(item && item.kind==='client' && (currentUser().admin || item.owner===currentUser().id)){
        item.deletedAt=Date.now();
        addOperationNotification(item,'inbox.clientDeleted',{actor:(USER[currentUser().id]||{}).name||currentUser().id,client:item.clientName},USERS.map(u=>u.id));
        state.clientSelected.delete(String(id));
        commit(); deliverOperationNotification();
      }
      state.modal=null; render(); break;
    }
    case 'open-schedule':
      state.modal = { type:'schedule-details', id:el.getAttribute('data-id') }; render(); break;
    case 'delete-schedule':
      state.modal = { type:'confirm', titleKey:'calendar.reminderDeleteTitle', body:t('calendar.reminderMessage'), confirmKey:'calendar.reminderDelete', action:'confirm-delete-schedule', id:el.getAttribute('data-id'), danger:true }; render(); break;
    case 'confirm-delete-schedule': {
      const id=el.getAttribute('data-id');
      const item=matterById(id);
      if (item && item.kind === 'schedule' && item.owner === currentUser().id) {
        matters=matters.filter(m=>String(m.id)!==String(id));
        logs=logs.filter(l=>String(l.matterId)!==String(id));
        sync.purged.add(String(id)); commit();
      }
      state.modal=null; render(); break;
    }
    case 'mark-contacted': {
      const m = matterById(el.getAttribute('data-id'));
      if (!m || !canSee(currentUser(), m)) break;
      m.lastContact = new Date().toISOString();
      const profile=clientProfiles().find(c=>String(c.clientName).toLowerCase()===String(L(m.client)).toLowerCase());
      if(profile) profile.lastContact=m.lastContact;
      addOperationNotification(m,'inbox.clientContacted',{actor:(USER[currentUser().id]||{}).name||currentUser().id,title:m.title,time:{__contactStamp:m.lastContact}});
      commit(); deliverOperationNotification(); render(); toast(t('clients.statusUpdated'));
      break;
    }
    case 'accept-handoff': {
      const m = matterById(el.getAttribute('data-id'));
      if (!m || !m.handoff || m.handoff.to !== currentUser().id || m.handoff.acceptedAt) break;
      m.handoff.acceptedAt = Date.now(); m.handoff.acceptedBy = currentUser().id;
      addLogKey(m.id, currentUser().id, 'detail.entry.edited');
      commit(); render(); toast(ft('handoffAccepted'));
      break;
    }
    case 'confirm-large-file-upload': {
      const pending=state.modal&&state.modal.pendingUpload;
      if(pending && !fileUploadInFlight) {
        el.disabled = true;
        el.textContent = t('modal.file.uploading');
        await uploadEncryptedAttachments(pending.id,pending.files);
      }
      break;
    }
    case 'close-modal':
      state.modal = null; render(); break;
    case 'close-security-notice': {
      save(KEY.securityNoticeUntil, Date.now() + 3 * 24 * 60 * 60 * 1000);
      state.modal = null;
      render();
      break;
    }
    case 'choose-matter-action':
      state.modal={type:'matter-action',matterId:el.getAttribute('data-id')};render();break;
    case 'open-matter':
    case 'open-matter-edit':
      state.modal=null;go(`#/matters/${el.getAttribute('data-id')}`);break;
    case 'open-matter-work':
      state.modal=null;go(`#/matters/${el.getAttribute('data-id')}/work`);break;
    case 'toggle-notification': {
      const id=String(el.getAttribute('data-id'));
      if (!notificationOnlyEntries(currentUser()).some(item=>String(item.id)===id)) break;
      if (el.checked) state.notificationSelected.add(id); else state.notificationSelected.delete(id);
      render(); break;
    }
    case 'toggle-all-notifications': {
      const entries=notificationOnlyEntries(currentUser());
      const selectAll=entries.length>0&&!entries.every(item=>state.notificationSelected.has(String(item.id)));
      entries.forEach(item=>selectAll?state.notificationSelected.add(String(item.id)):state.notificationSelected.delete(String(item.id)));
      render(); break;
    }
    case 'mark-all-notifications-read': {
      const unread=notificationOnlyEntries(currentUser()).filter(item=>!(item.readBy||[]).includes(currentUser().id));
      unread.forEach(item=>markNotificationRead(item.id,currentUser().id));
      if(unread.length){render();toast(t('toast.markedAllRead'));pushRemote();}
      break;
    }
    case 'bulk-delete-notifications': {
      const allowed=new Set(notificationOnlyEntries(currentUser()).map(item=>String(item.id)));
      const ids=[...state.notificationSelected].filter(id=>allowed.has(String(id)));
      if(!ids.length) break;
      state.modal={type:'confirm',titleKey:'modal.bulkDeleteNotifications.title',body:t('modal.bulkDeleteNotifications.body',{n:ids.length}),confirmText:t('modal.bulkDeleteNotifications.confirm',{n:ids.length}),action:'confirm-bulk-delete-notifications',ids,danger:true};
      render();break;
    }
    case 'confirm-bulk-delete-notifications': {
      const u=currentUser();
      const allowed=new Set(notificationOnlyEntries(u).map(item=>String(item.id)));
      const ids=(state.modal&&state.modal.ids||[]).filter(id=>allowed.has(String(id)));
      ids.forEach(id=>{
        const item=logs.find(log=>String(log.id)===String(id));
        if(item)item.deletedBy=[...new Set([...(item.deletedBy||[]),u.id])];
        state.notificationSelected.delete(String(id));
      });
      if(ids.length)commit();
      state.modal=null;render();
      if(ids.length)toast(t('toast.bulkNotificationsDeleted',{n:ids.length}));
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
        state.notificationSelected.delete(String(el.getAttribute('data-id')));
        state.modal = null;
        render();
        toast(t('toast.notificationDeleted'));
      }
      break;
    case 'confirm-create-conflicted-matter': {
      const pending = state.modal && state.modal.pendingMatter;
      const m = pending && createMatter(pending);
      if (m) { state.modal = null; go(`#/matters/${m.id}`); render(); toast(t('conflict.saved')); }
      break;
    }
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
    case 'save-matter': {
      const id=el.getAttribute('data-id');
      try {
        if(!await ensureMatterCurrent(id)) break;
        saveMatterFromDom(id);
      } catch(e) { showSystemError(e); }
      break;
    }
    case 'check-matter-conflicts': {
      const id=el.getAttribute('data-id'), box=document.querySelector(`[data-matter="${id}"]`);
      const value=field=>{const input=box&&box.querySelector(`[data-field="${field}"]`);return input?input.value:'';};
      const matches=potentialConflicts({client:value('client'),counterparties:value('counterparties'),relatedParties:value('relatedParties')},id);
      state.modal={type:'notice',titleKey:'conflict.title',body:matches.length?`<div style="white-space:pre-line">${esc(matches.join('\n'))}</div>`:esc(t('conflict.clear'))};
      render(); break;
    }
    case 'reload-conflicted-matter':
      try { const id=el.getAttribute('data-id'); await reloadMatterFromServer(id); state.modal=null; go(`#/matters/${id}`); render(); }
      catch(e){showSystemError(e);} break;
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
      const id=el.getAttribute('data-id'),idx=Number(el.getAttribute('data-idx'));
      const m=matterById(id),f=m&&(m.files||[])[idx];
      if(!m||!f||!f.storagePath||!canSee(currentUser(),m)) break;
      state.modal={type:'confirm',titleKey:'modal.fileDownload.title',body:t('modal.fileDownload.body',{name:L(f.name)}),confirmKey:'modal.fileDownload.confirm',action:'confirm-download-file',id,idx};
      render();
      break;
    }
    case 'download-chat-file': {
      const id=el.getAttribute('data-id'),fileId=el.getAttribute('data-file-id');
      const m=matterById(id),idx=m?(m.files||[]).findIndex((file,index)=>String(file.storagePath||index)===String(fileId)):-1;
      const file=m&&idx>=0&&(m.files||[])[idx];
      if(!file||!file.storagePath||!canSee(currentUser(),m))break;
      state.modal={type:'confirm',titleKey:'modal.fileDownload.title',body:t('modal.fileDownload.body',{name:L(file.name)}),confirmKey:'modal.fileDownload.confirm',action:'confirm-download-file',id,idx};
      render();break;
    }
    case 'confirm-download-file': {
      const pending=state.modal;
      if(pending) await downloadEncryptedAttachment(pending.id,pending.idx);
      break;
    }
    case 'remove-file': {
      const id=el.getAttribute('data-id'),idx=Number(el.getAttribute('data-idx'));
      const m=matterById(id),f=m&&(m.files||[])[idx];
      const u=currentUser();
      if(!m||!f||!u||(!u.admin&&(f.uploadedBy?f.uploadedBy!==u.id:m.owner!==u.id))) break;
      state.modal={type:'confirm',titleKey:'modal.fileRemove.title',body:t('modal.fileRemove.body',{name:L(f.name)}),confirmKey:'modal.fileRemove.confirm',action:'confirm-remove-file',id,idx,danger:true};
      render();
      break;
    }
    case 'confirm-remove-file': {
      const pending=state.modal;
      if(pending) await removeEncryptedAttachment(pending.id,pending.idx);
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
    case 'report-export': {
      const blob=new Blob(['\ufeff'+reportCsv(reportFilteredMatters())],{type:'text/csv;charset=utf-8'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`LCB-work-report-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);break;
    }
    case 'run-integrity-check':
      if(isAdmin()){el.disabled=true;state.integrityResult=await runIntegrityReport();render();toast(L({zh:'巡检完成',en:'Integrity check completed',es:'Revisión completada'}));}break;
    case 'deadline-reminders': {
      const r=state.deadlineResult,u=currentUser();if(!r||!u)break;
      let added=0;
      [7,3,1].forEach(before=>{const d=parseISO(r.date);d.setDate(d.getDate()-before);if(d<today())return;const marker=`deadline:${u.id}:${r.date}:${before}`;if(matters.some(m=>m.kind==='schedule'&&m.deadlineMarker===marker&&!m.deletedAt))return;matters.push({id:'schedule_'+crypto.randomUUID(),kind:'schedule',deadlineMarker:marker,no:'',client:'',title:`${r.date} deadline`,owner:u.id,team:[u.id],due:iso(d),reminderTime:'09:00',reminderText:L({zh:`法定期限将在 ${before} 天后到期（${r.date}）`,en:`Deadline is in ${before} days (${r.date})`,es:`El plazo vence en ${before} días (${r.date})`}),reminderEnabled:true,reminderSentAt:null,status:'green',deletedAt:null});added++;});
      if(added)commit();render();toast(added?L({zh:'提醒已加入日历和通知',en:'Reminders added to Calendar and Notifications',es:'Avisos añadidos al calendario y notificaciones'}):L({zh:'这个期限的提醒已存在',en:'Reminders already exist for this deadline',es:'Ya existen avisos para este plazo'}));break;
    }
    case 'import-matters':
      state.modal = { type: 'import' };
      render();
      break;
    case 'download-import-sample': {
      const sample = importSample(el.getAttribute('data-kind') === 'clients' ? 'clients' : 'matters');
      const required = new Set(sample.required || []);
      const headers = sample.heads.map((x, index) => `<th style="font-weight:700;color:${required.has(index)?'#c62828':'#111827'};background:#f3f4f6;border:1px solid #cbd5e1;padding:6px;white-space:nowrap">${esc(x)}</th>`).join('');
      const cells = sample.heads.map(() => '<td style="border:1px solid #cbd5e1;padding:6px;min-width:110px">&nbsp;</td>').join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><table><tr>${headers}</tr><tr>${cells}</tr></table></body></html>`;
      const blob = new Blob(['\ufeff', html], { type: 'application/vnd.ms-excel;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = sample.filename; a.click(); URL.revokeObjectURL(a.href);
      state.modal = null; render();
      break;
    }
    case 'toggle-bulk-matter': {
      const id = String(el.getAttribute('data-id'));
      const m = matterById(id);
      if (!m || (currentUser().id !== m.owner && !isAdmin())) break;
      if (el.checked) state.bulkSelected.add(id); else state.bulkSelected.delete(id);
      render();
      break;
    }
    case 'toggle-all-bulk-matters': {
      const selectable = sorted(filterMatters()).filter(m => currentUser().id === m.owner || isAdmin());
      const selectAll = selectable.length > 0 && !selectable.every(m => state.bulkSelected.has(String(m.id)));
      selectable.forEach(m => selectAll ? state.bulkSelected.add(String(m.id)) : state.bulkSelected.delete(String(m.id)));
      render();
      break;
    }
    case 'bulk-delete-matters': {
      const ids = [...state.bulkSelected].filter(id => {
        const m = matterById(id);
        return m && !m.deletedAt && canSee(currentUser(), m) && (currentUser().id === m.owner || isAdmin());
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
        return m && !m.deletedAt && canSee(currentUser(), m) && (currentUser().id === m.owner || isAdmin());
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
      if(m.kind==='client'){
        addOperationNotification(m,'inbox.clientRestored',{actor:(USER[currentUser().id]||{}).name||currentUser().id,client:m.clientName},USERS.map(u=>u.id));
        commit(); deliverOperationNotification(); go('#/clients'); render(); toast(t('clients.saved')); break;
      }
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
      if (!m || !m.deletedAt || currentUser().id !== m.owner) break;
      if (el.checked) state.trashSelected.add(id); else state.trashSelected.delete(id);
      render();
      break;
    }
    case 'toggle-all-trash': {
      const selectable = trashedMatters().filter(m => currentUser().id === m.owner);
      const selectAll = selectable.length > 0 && !selectable.every(m => state.trashSelected.has(String(m.id)));
      selectable.forEach(m => selectAll ? state.trashSelected.add(String(m.id)) : state.trashSelected.delete(String(m.id)));
      render();
      break;
    }
    case 'bulk-purge-trash': {
      const ids = [...state.trashSelected].filter(id => {
        const m = matterById(id);
        return m && m.deletedAt && currentUser().id === m.owner;
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
        return m && m.deletedAt && currentUser().id === m.owner;
      });
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
  const chatForm=ev.target.closest('.chat-composer');
  if(chatForm){
    const name=ev.target.name;
    if(name==='mentions')state.chatDraft.mentions=[...chatForm.querySelectorAll('[name="mentions"]:checked')].map(x=>x.value);
    if(name==='blocked'){
      state.chatDraft.blocked=[...chatForm.querySelectorAll('[name="blocked"]:checked')].map(x=>x.value);
      const u=currentUser();if(u)save(chatBlockKey(u.id),state.chatDraft.blocked);
    }
    if(name==='referenceType')state.chatDraft.referenceType=ev.target.value;
    if(['refMatter','refStep','refClient','refFile'].includes(name))state.chatDraft[name]=ev.target.value;
    if(name==='chatFiles'){
      state.chatDraft.files=[...(ev.target.files||[])];
      const label=chatForm.querySelector('.chat-selected-files');
      if(label)label.textContent=t('chat.selectedFiles',{names:state.chatDraft.files.map(file=>file.name).join('、')});
      else render();
    }
    return;
  }
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
  // 换业务类型 → 自动套用该类事项的默认项目成员
  const picker = ev.target.closest('[data-area-picker]');
  if (picker) {
    const ids = defaultTeam(picker.value);
    const scope = picker.closest('[data-matter]') || picker.closest('form') || document;
    scope.querySelectorAll('[data-field="team"], [name="team"]').forEach(cb => { cb.checked = ids.includes(cb.value); });
    if ((AREA[picker.value] || {}).members) toast(t('toast.areaDefault'));
    return;
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
  if(ev.target.matches('.chat-composer textarea[name="message"]')){
    state.chatDraft.message=ev.target.value;
    return;
  }
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

function startLoginCountdown(email) {
  loginCountdownEmail = String(email || loginCountdownEmail || '').toLowerCase();
  const update = () => {
    const seconds = Math.max(0, Math.ceil((loginBlockedUntil - Date.now()) / 1000));
    if (seconds <= 0) {
      if (loginCountdownTimer) clearInterval(loginCountdownTimer);
      loginCountdownTimer = null;
      loginFailures = 0;
      loginBlockedUntil = 0;
      loginCountdownEmail = '';
      state.loginError = '';
      render();
      return;
    }
    state.loginError = t('login.errCooldown', { n: seconds });
    render();
  };
  update();
  if (!loginCountdownTimer && loginBlockedUntil > Date.now()) {
    loginCountdownTimer = setInterval(update, 1000);
  }
}

document.addEventListener('submit', async ev => {
  const form = ev.target.closest('form[data-action]');
  if (!form) return;
  ev.preventDefault();
  const action = form.getAttribute('data-action');
  if(action==='send-global-chat'){
    const u=currentUser(),message=String(form.message&&form.message.value||'').trim();
    const pendingFiles=[...(state.chatDraft.files||[])];
    if(!u||(!message&&!pendingFiles.length)){toast(t('toast.needMessage'));return;}
    if(pendingFiles.some(file=>file.size>20*1024*1024)){toast(t('toast.fileTooLarge'));return;}
    if(!setFormBusy(form,pendingFiles.length?t('modal.file.uploading'):t('chat.send')))return;
    const mentions=[...form.querySelectorAll('[name="mentions"]:checked')].map(x=>x.value).filter(id=>USER[id]&&id!==u.id);
    const blocked=[...form.querySelectorAll('[name="blocked"]:checked')].map(x=>x.value).filter(id=>USER[id]&&id!==u.id);
    save(chatBlockKey(u.id),blocked);
    const channel=ensureGlobalChatChannel();
    const referenceType=(form.querySelector('[name="referenceType"]:checked')||{}).value||'';
    const referenceValue=LCBChatCore.pickReferenceValue(referenceType,{matter:form.refMatter&&form.refMatter.value,step:form.refStep&&form.refStep.value,client:form.refClient&&form.refClient.value,file:form.refFile&&form.refFile.value});
    const reference=chatReferenceFromValue(referenceValue);
    const attachments=[];
    for(const file of pendingFiles){
      const uploaded=await uploadEncryptedAttachment(channel.id,file,{silent:true});
      if(!uploaded){clearFormBusy(form);return;}
      attachments.push({type:'file',matterId:String(channel.id),id:String(uploaded.storagePath),title:uploaded.name,subtitle:t('nav.chat'),details:[uploaded.size?`${Math.max(1,Math.round(uploaded.size/1024))} KB`:''].filter(Boolean)});
    }
    const recipients=LCBChatCore.messageRecipients(USERS.map(x=>x.id),u.id,blocked);
    addLogKey(channel.id,u.id,LCBChatCore.CHAT_KEY,{message,mentions,blockedTo:blocked,reference,attachments},{key:'inbox.chat',vars:{actor:u.name,title:L(channel.title),message:message||attachments.map(x=>x.title).join('、')},to:recipients});
    commit();
    deliverOperationNotification();
    save(chatSeenKey(u.id),Date.now());
    state.chatDraft={message:'',mentions:[],blocked:blocked.slice(),referenceType:'matter',refMatter:'',refStep:'',refClient:'',refFile:'',files:[]};
    state.chatScrollToBottom=true;
    render();
    toast(t('toast.chatSent'));
    return;
  }
  if(action==='global-search'){state.globalSearch=String(form.q.value||'').trim();render();return;}
  if(action==='calculate-deadline'){
    const data=readForm(form),start=parseISO(data.startDate),days=Math.max(0,Number(data.days)||0),holidays=String(data.holidays||'').split(/[,，\s]+/).map(x=>x.trim()).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));
    const result=data.mode==='business'?addBusinessDays(start,days,holidays):new Date(start.getFullYear(),start.getMonth(),start.getDate()+days);
    state.deadlineResult={startDate:data.startDate,days,mode:data.mode,holidaysText:data.holidays||'',date:iso(result)};render();return;
  }
  if(action==='report-filter'){const data=readForm(form);state.reportFilters={from:data.from||'',to:data.to||'',client:String(data.client||'').trim(),owner:data.owner||'',area:data.area||''};render();return;}
  if (action === 'login') {
    const email = (form.email.value || '').trim().toLowerCase();
    const pass = form.password.value || '';
    state.loginDraft={email,password:pass};
    const user = USERS.find(u => u.email.toLowerCase() === email);
    if (!user) {
      state.loginError = t('login.errNoUser');
      render();
      return;
    }
    if (Date.now() < loginBlockedUntil) { startLoginCountdown(email); return; }
    if (!turnstileToken) {
      state.loginError = t('login.captchaRequired');
      render();
      return;
    }
    if (!setFormBusy(form, t('login.signingIn'))) return;
    try {
      const captchaToken = turnstileToken;
      turnstileToken = '';
      await signIn(email, pass, captchaToken);
      loginFailures=0; loginBlockedUntil=0;
      if (loginCountdownTimer) { clearInterval(loginCountdownTimer); loginCountdownTimer=null; }
    }
    catch (e) {
      if (e && e.code === 'device_locked') {
        loginFailures = LOGIN_FAILURE_LIMIT;
        loginBlockedUntil = Date.now() + Math.max(1, e.retryAfter || 300) * 1000;
        startLoginCountdown(email);
      }
      else if (e && e.code === 'invalid_credentials') {
        const remaining = Number.isFinite(e.remainingAttempts) ? e.remainingAttempts : 0;
        loginFailures = LOGIN_FAILURE_LIMIT - remaining;
        state.loginError=t('login.errBadPass', { n: remaining });
      }
      else throw e;
      render(); return;
    }
    state.loginError = '';
    recordSecurityEvent('login_success', { client:'web' });
    session = { userId: user.id }; state.loginDraft={email:'',password:''}; lastUserActivityAt = Date.now(); state.bulkSelected.clear(); state.clientSelected.clear(); state.trashSelected.clear(); state.notificationSelected.clear();
    state.modal = Number(load(KEY.securityNoticeUntil, 0)) > Date.now() ? null : { type:'security-notice' };
    await loadDevices(true);
    go('#/'); render();
    if (sync.dirty) await pushRemote(); else await pullRemote({ initial: true });
    toast(t('toast.welcome', { name: user.name.split(' ')[0] }));
    return;
  }
  if (action === 'import-file') {
    const files = [...(form.importFile && form.importFile.files || [])];
    if (!files.length || !setFormBusy(form, t('modal.import.importing'))) return;
    let ok = 0, bad = 0;
    const importErrors = [];
    try {
      for (const file of files) {
        const result = importMatterRows(await clientImportRows(file));
        if (result.invalid) { state.modal = { type:'import-invalid' }; render(); return; }
        ok += result.ok; bad += result.bad; importErrors.push(...result.errors);
      }
      state.modal = importErrorModal(importErrors);
      render();
      toast(t('modal.import.result', { ok, bad }));
    } catch (e) {
      state.modal = { type:'notice', titleKey:'modal.import.title', body:esc(String(e.message || e)) };
      render();
    } finally {
      clearFormBusy(form);
    }
  }
  if (action === 'create-matter') {
    const data = readForm(form);
    const checkData = Object.assign({}, data, { client:resolveCustom(data.client, data.clientCustom) || '' });
    const matches = potentialConflicts(checkData);
    if (matches.length) {
      state.modal = { type:'confirm', titleKey:'conflict.title', body:t('conflict.body',{matches:matches.join('\n')}),
        confirmKey:'conflict.continue', action:'confirm-create-conflicted-matter', pendingMatter:data };
      render(); return;
    }
    const m = createMatter(data);
    if (m) { state.modal = null; go(`#/matters/${m.id}`); render(); }
  }
  if(action==='save-client'){
    const data=readForm(form),created=!data.id,item=saveClientRecord(data,data.id);
    if(item){
      addOperationNotification(item,created?'inbox.clientCreated':'inbox.clientUpdated',{actor:(USER[currentUser().id]||{}).name||currentUser().id,client:item.clientName},USERS.map(u=>u.id));
      commit();deliverOperationNotification();state.modal=null;render();toast(t('clients.saved'));
    }
  }
  if(action==='import-clients-file'){
    const files=[...(form.clientFile&&form.clientFile.files||[])];
    if(!files.length||!setFormBusy(form,t('modal.import.importing'))) return;
    try{
      let count=0;
      for(const file of files){
        const rows=await clientImportRows(file);
        if(!validClientImportFormat(rows)){state.modal={type:'import-invalid',importKind:'clients'};render();return;}
        rows.forEach(row=>{
          const data=importedClientData(row); if(!data.clientName) return;
          const old=clientProfiles().find(c=>String(c.clientName).toLowerCase()===data.clientName.toLowerCase());
          const item=saveClientRecord(data,old&&old.id);
          if(item){
            addOperationNotification(item,old?'inbox.clientUpdated':'inbox.clientCreated',{actor:(USER[currentUser().id]||{}).name||currentUser().id,client:item.clientName},USERS.map(u=>u.id));
            count++;
          }
        });
      }
      if(count){commit();deliverOperationNotification();} state.modal=null; render(); toast(t('clients.imported',{n:count}));
    }catch(e){showSystemError(e);}
    finally{clearFormBusy(form);}
  }
  if (action === 'create-schedule') {
    const data=readForm(form), u=currentUser();
    const message=String(data.message||'').trim();
    if (!u || !data.date || !data.time || !message) return;
    matters.push({
      id:'schedule_'+crypto.randomUUID(), kind:'schedule', no:'', client:'', title:message,
      owner:u.id, team:[u.id], due:data.date, reminderTime:data.time, reminderText:message,
      reminderEnabled:data.enabled==='1', reminderSentAt:null, status:'green', deletedAt:null,
    });
    commit(); state.modal=null; render(); toast(t('calendar.reminderSaved'));
  }
  if (action === 'confirm-add-file') {
    const id = form.getAttribute('data-id');
    const files = [...(form.fileBlob && form.fileBlob.files || [])];
    if (!files.length) { toast(t('toast.needFileName')); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024)) {
      state.modal={type:'confirm',titleKey:'modal.fileLarge.title',body:t('modal.fileLarge.body'),confirmKey:'modal.fileLarge.confirm',action:'confirm-large-file-upload',pendingUpload:{id,files}};
      render();return;
    }
    if (!setFormBusy(form, t('modal.file.uploading'))) return;
    await uploadEncryptedAttachments(id,files);
    clearFormBusy(form);
  }
  if (action === 'confirm-complete-step') {
    if(!await ensureMatterCurrent(form.getAttribute('data-id'))) return;
    const ok = completeStep(form.getAttribute('data-id'), readForm(form));
    if (ok) { state.modal = null; render(); }
  }
});

window.addEventListener('hashchange',()=>{
  render();
  if(state.mobileNavOpen) setMobileNavOpen(false);
  if(location.hash.startsWith('#/settings')) refreshDeviceList().catch(()=>{});
});
window.addEventListener('resize', updateNavScrollControls);
document.addEventListener('scroll', event => { if(event.target && event.target.matches && event.target.matches('.nav')) updateNavScrollControls(); }, true);
document.addEventListener('wheel', event => {
  const nav=event.target.closest && event.target.closest('.nav');
  if(!nav || nav.scrollWidth<=nav.clientWidth || Math.abs(event.deltaX)>Math.abs(event.deltaY)) return;
  event.preventDefault(); nav.scrollLeft+=event.deltaY; updateNavScrollControls();
}, {passive:false});
document.addEventListener('toggle', event => {
  const opened=event.target;
  if(!opened.matches||!opened.matches('.chat-tool[open]'))return;
  document.querySelectorAll('.chat-tool[open]').forEach(item=>{if(item!==opened)item.open=false;});
}, true);
window.addEventListener('error', event => showSystemError(event.error || event.message));
window.addEventListener('unhandledrejection', event => {
  event.preventDefault();
  showSystemError(event.reason);
});

// 按 Esc 关掉弹窗
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && state.modal) { state.modal = null; render(); }
});

/* ------------------------------ 启动 ------------------------------ */

// 本地还没有缓存时，从空列表开始；联网后会拉取团队数据。
if (LOCAL_TEST_MODE && !load(KEY.matters, null)) {
  matters = seedMatters();
  logs = seedLogs();
  seq = Math.max(0, ...matters.map(m => Number(m.id) || 0));
}
if (!REMOTE_ENABLED && !load(KEY.matters, null)) {
  save(KEY.matters, matters);
  save(KEY.logs, logs);
  save(KEY.seq, seq);
}
render();

if (REMOTE_ENABLED) {
  clearPrivateCache();
  refreshAuth().then(ok => {
    if (ok) pullRemote({ initial: true });
    else finishLogout({expired:true});
  });
  setInterval(() => {
    if (!sync.dirty && sync.status !== 'error') pullRemote({ background: true });
  }, SYNC_EVERY_MS);
  setInterval(idleLogout, 60000);
  setInterval(() => {
    if(authSession) ensureActiveServerSession().then(active=>{
      if(active&&location.hash.startsWith('#/settings')) refreshDeviceList().catch(()=>{});
    }).catch(() => {});
  }, 5000);
  setInterval(deliverScheduleReminders, 30000);
  setInterval(async () => {
    if (!authSession) return;
    try { await loadDevices(true); if (location.hash.startsWith('#/settings')) render(); } catch (e) { /* next sync will retry */ }
  }, 5 * 60 * 1000);
  ['pointerdown', 'pointermove', 'keydown', 'touchstart', 'wheel', 'scroll', 'input'].forEach(type => {
    document.addEventListener(type, () => { lastUserActivityAt = Date.now(); }, { passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) lastUserActivityAt = Date.now();
    if(!document.hidden&&authSession){
      ensureActiveServerSession().then(active=>{if(active&&!sync.dirty) pullRemote({background:true});}).catch(()=>{});
    }
  });
  window.addEventListener('online', () => {
    resetSyncRetries();
    ensureActiveServerSession().then(active=>{if(active){if(sync.dirty) pushRemote();else pullRemote({background:true});}}).catch(()=>{});
  });
}
