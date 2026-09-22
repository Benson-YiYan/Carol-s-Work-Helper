# Mother-Son Team Features and Chat Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `Carol-s-Work-Helper` to the current LCB Work Hub feature set, restore chat, exclude weekly view, preserve existing mother-son data, and prove complete isolation from the team deployment.

**Architecture:** Use the current `LCB-Work-Hub` frontend as the functional baseline and move deployment-specific values into a mother-son configuration module. Restore only chat code from `with-chat&weekly.bak`, then apply additive Supabase migrations and mother-son RLS/user mappings so both sites behave the same without sharing authentication, tables, keys, logs, or files.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js assertion tests, Supabase Auth/Postgres/Storage/Edge Functions, Cloudflare Turnstile, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-09-22-team-features-chat-migration-design.md`

## Global Constraints

- Team functional baseline is the current `main` of `/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/work/lcb-pages`.
- Chat source is `/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/work/with-chat&weekly.bak`, commit `846a542fafebd8576b40100ee2a99f92249e2506`.
- Target repository is `/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/outputs/Carol's-work-helper`.
- Preserve all existing mother-son users, matters, clients, files, logs, encryption keys, and device records.
- Mother-son production code must contain no team Supabase project ID `tvavifjfbdwgkehtbxum`, team storage bucket `lcb-encrypted-files`, or team-only user mapping.
- Chat is required in Chinese, English, and Spanish; weekly view is forbidden in code, UI, routes, styles, and tutorials.
- All database changes must be additive and backward-compatible; no table truncation, destructive reset, or storage-path rewrite.
- Do not commit `.DS_Store`, credentials, service-role keys, Turnstile secret keys, database dumps, or user passwords.

---

### Task 1: Create Recoverable Baselines and a Preflight Inventory

**Files:**
- Create locally, do not commit: `/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/work/carol-work-helper-before-team-migration.bak`
- Create locally, do not commit: a timestamped Supabase schema/data export under `/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/work/private-backups/`
- Create: `migration-preflight.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: target repository `main`, team repository `main`, chat bundle commit `846a542`.
- Produces: recoverable Git baseline and `migration-preflight.test.js`, which later tasks extend with forbidden-marker assertions.

- [ ] **Step 1: Write the failing preflight test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const file of ['app.js', 'crypto.js', 'index.html', 'styles.css', 'supabase-mother-son-security.sql']) {
  assert.equal(fs.existsSync(file), true, `missing baseline file: ${file}`);
}
assert.equal(fs.existsSync('site-config.js'), true, 'mother-son site config has not been created');
```

- [ ] **Step 2: Run the test and verify the intended failure**

Run: `node migration-preflight.test.js`

Expected: FAIL with `mother-son site config has not been created`.

- [ ] **Step 3: Create the Git Bundle and private backup directory**

Run:

```bash
git bundle create '/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/work/carol-work-helper-before-team-migration.bak' --all
mkdir -p '/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/work/private-backups'
git bundle verify '/Users/apple/Documents/Codex/2026-09-12/https-chatgpt-com-share-6aa50d39-5b38/work/carol-work-helper-before-team-migration.bak'
```

Expected: bundle verification names the current branch and reports that the bundle is okay.

- [ ] **Step 4: Export the mother-son Supabase schema and data without secrets**

Use the already authenticated Supabase CLI for project `fnkgulfdcljwjkcqibxi`; store the dump only in `private-backups`. Record row counts for `matters`, `logs`, `meta`, key tables, devices, and security events before migration. If the CLI is not authenticated, stop before database mutation and keep working on local code only.

- [ ] **Step 5: Ignore local artifacts**

Add to `.gitignore`:

```gitignore
.DS_Store
private-backups/
*.bak
*.dump
```

- [ ] **Step 6: Commit the recoverability scaffolding**

```bash
git add .gitignore migration-preflight.test.js
git commit -m "test: add mother-son migration preflight"
```

---

### Task 2: Introduce a Mother-Son Configuration Boundary

**Files:**
- Create: `site-config.js`
- Create: `site-config.test.js`
- Modify: `index.html`
- Modify: `app.js`

**Interfaces:**
- Consumes: existing mother-son Supabase URL, publishable key, bucket, local-storage prefixes, user list, branding, and GitHub Pages base path.
- Produces: `globalThis.LCBSiteConfig` with `{ storageKeys, supabase, bucket, users, turnstileSiteKey, branding }`.

- [ ] **Step 1: Write a failing configuration test**

```js
const assert = require('node:assert/strict');
const config = require('./site-config.js');

assert.equal(config.supabase.url, 'https://fnkgulfdcljwjkcqibxi.supabase.co');
assert.equal(config.bucket, 'carol-encrypted-files');
assert.equal(config.supabase.url.includes('tvavifjfbdwgkehtbxum'), false);
assert.equal(config.users.some(user => user.id === 'carol' && user.admin), true);
assert.equal(config.users.some(user => user.id === 'benson'), true);
assert.equal(new Set(config.users.map(user => user.email.toLowerCase())).size, config.users.length);
assert.equal(config.storageKeys.matters.startsWith('carol_solo_'), true);
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node site-config.test.js`

Expected: FAIL with `Cannot find module './site-config.js'`.

- [ ] **Step 3: Implement the configuration module**

Use a browser-and-Node compatible wrapper:

```js
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
      matters: 'carol_solo_matters_v1', logs: 'carol_solo_logs_v1',
      session: 'carol_solo_session_v1', auth: 'carol_solo_supabase_auth_v1',
      seq: 'carol_solo_seq_v1', lang: 'carol_solo_lang_v1',
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
    branding: Object.freeze({ title: '母子事务管理器', team: 'Carol 与 Benson' }),
  });
});
```

The publishable Supabase key and Turnstile site key are intentionally public client identifiers. Never add the Supabase service-role key or Turnstile secret key to this file.

- [ ] **Step 4: Load configuration before application code**

Add `<script src="site-config.js?...">` before `runtime-mode.js`, `log-sync.js`, and `app.js` in `index.html`.

- [ ] **Step 5: Update `app.js` to consume the interface**

At the top of `app.js`, require a valid config and derive `KEY`, `SUPABASE`, `ENCRYPTED_BUCKET`, `USERS`, branding, and `TURNSTILE_SITE_KEY` from `LCBSiteConfig`. Fail closed with a visible configuration error if it is missing.

- [ ] **Step 6: Run the tests**

Run: `node site-config.test.js && node migration-preflight.test.js && node --check site-config.js && node --check app.js`

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add site-config.js site-config.test.js migration-preflight.test.js index.html app.js
git commit -m "refactor: isolate mother-son deployment configuration"
```

---

### Task 3: Port the Current Team Feature Baseline Without Weekly View

**Files:**
- Replace from team baseline, then adapt: `app.js`, `crypto.js`, `index.html`, `styles.css`
- Create from team baseline: `runtime-mode.js`, `log-sync.js`, `local-mode.test.js`, `log-sync.test.js`
- Create: `feature-parity.test.js`
- Modify: `site-config.js`

**Interfaces:**
- Consumes: `globalThis.LCBSiteConfig`, `LCBRuntimeMode`, `LCBLogSync`.
- Produces: current team pages and workflows running exclusively against mother-son configuration.

- [ ] **Step 1: Write a failing parity test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync('app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

for (const marker of ['#/search', '#/clients', '#/followups', '#/team', '#/deadline', '#/reports']) {
  assert.equal(app.includes(marker), true, `missing team feature: ${marker}`);
}
for (const script of ['site-config.js', 'runtime-mode.js', 'log-sync.js', 'app.js']) {
  assert.equal(html.includes(script), true, `missing script: ${script}`);
}
assert.equal(app.includes('tvavifjfbdwgkehtbxum'), false);
assert.equal(app.includes("'lcb-encrypted-files'"), false);
```

- [ ] **Step 2: Verify the parity test fails on the old target**

Run: `node feature-parity.test.js`

Expected: FAIL on the first missing team route.

- [ ] **Step 3: Copy the current team frontend baseline**

Copy `app.js`, `crypto.js`, `index.html`, `runtime-mode.js`, `log-sync.js`, `styles.css`, and the matching vendor asset from the team repository. Immediately reapply the `LCBSiteConfig` boundary before running the app so no copied team endpoint is usable.

- [ ] **Step 4: Preserve mother-son identity and data compatibility**

Use mother-son storage keys, users, branding, Supabase URL/key, bucket, and Pages path from `site-config.js`. Add one-time local-storage compatibility reads only if the baseline expects a newly named key; write back to the established `carol_solo_*` keys.

- [ ] **Step 5: Run baseline tests**

Run:

```bash
node --check runtime-mode.js
node --check log-sync.js
node --check app.js
node local-mode.test.js
node log-sync.test.js
node site-config.test.js
node feature-parity.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app.js crypto.js index.html runtime-mode.js log-sync.js styles.css vendor/xlsx.full.min.js local-mode.test.js log-sync.test.js feature-parity.test.js site-config.js
git commit -m "feat: port current team workflows to mother-son site"
```

---

### Task 4: Restore Chat Without Restoring Weekly View

**Files:**
- Restore and adapt from commit `846a542`: `chat-core.js`, `chat-behavior.test.js`
- Modify: `app.js`, `index.html`, `styles.css`
- Create: `weekly-exclusion.test.js`

**Interfaces:**
- Consumes: current mother-son `USERS`, matter visibility helpers, notifications, file encryption/storage, language function `L`, and sync scheduler.
- Produces: `LCBChatCore` behavior plus `#/chat`; no `#/weekly` interface.

- [ ] **Step 1: Restore chat tests and write weekly exclusion tests before production changes**

Restore `chat-behavior.test.js` and extend it with draft preservation, append-only message refresh, bottom-scroll decisions, blocking, mentions, references, attachments, and popup closing. Create `weekly-exclusion.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = ['app.js', 'index.html', 'styles.css'].map(file => fs.readFileSync(file, 'utf8')).join('\n');

for (const marker of ['#/weekly', 'viewWeekly(', 'nav.weekly', '每周视图', 'Weekly view', 'Vista semanal']) {
  assert.equal(source.includes(marker), false, `weekly marker remains: ${marker}`);
}
```

- [ ] **Step 2: Verify chat tests fail and weekly exclusion passes before restoration**

Run: `node chat-behavior.test.js && node weekly-exclusion.test.js`

Expected: chat test fails because `chat-core.js` is absent; weekly exclusion passes.

- [ ] **Step 3: Restore `chat-core.js` and integrate chat routes/UI**

Take chat behavior and UI from `846a542`, not the full old application. Restore the chat navigation, route, rendering, state, message send/read behavior, sync hooks, and styles. Do not reverse the combined removal commit wholesale because that would also restore weekly view.

- [ ] **Step 4: Restore the final chat composer layout**

Implement the vertical buttons outside the lower-left of the input: `@` at top, `屏蔽` in the middle, `+` at bottom. Each opens a separate popup with a top-right close button. Preserve the normal site input style.

- [ ] **Step 5: Restore references and attachments**

The `+` popup provides references for matters, steps, client records, and matter files, plus file upload and send. Enforce the referenced item's visibility before rendering or sending. Store chat attachments in the mother-son bucket using a chat-specific path under the sender/session scope.

- [ ] **Step 6: Preserve drafts and scroll behavior**

Keep composer text in per-conversation draft state. Incoming messages must append without rebuilding the input node. After an incoming or self-sent message, scroll the message list to its bottom without moving the document to the top.

- [ ] **Step 7: Run chat and exclusion tests**

Run:

```bash
node --check chat-core.js
node --check app.js
node chat-behavior.test.js
node weekly-exclusion.test.js
node feature-parity.test.js
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add chat-core.js chat-behavior.test.js weekly-exclusion.test.js app.js index.html styles.css
git commit -m "feat: restore isolated chat without weekly view"
```

---

### Task 5: Complete Three-Language Copy and Tutorial Alignment

**Files:**
- Modify: `app.js`
- Create: `tutorial-alignment.test.js`

**Interfaces:**
- Consumes: final navigation and route list including chat and excluding weekly.
- Produces: equal Chinese/English/Spanish navigation, chat copy, tutorial topics, tutorial details, and guide routes.

- [ ] **Step 1: Write the failing tutorial alignment test**

Extract the tutorial declarations into a VM context, as in the team regression test, then assert:

```js
for (const lang of ['zh', 'en', 'es']) {
  assert.equal(BEGINNER_TUTORIAL[lang].steps.length, GUIDE_ROUTES.length);
  assert.equal(TUTORIAL_DETAILS[lang].length, GUIDE_ROUTES.length);
}
assert.equal(GUIDE_ROUTES.includes('#/chat'), true);
assert.equal(GUIDE_ROUTES.includes('#/weekly'), false);
```

Also assert each language contains labels for mention, block, reference, attachment, popup close, and chat tutorial content.

- [ ] **Step 2: Run and verify the intended failure**

Run: `node tutorial-alignment.test.js`

Expected: FAIL on missing or misaligned chat tutorial content.

- [ ] **Step 3: Add aligned copy without fragile numeric patching**

Place each chat tutorial topic and detail block directly in the three source arrays at the same semantic position. Avoid post-construction writes such as `TUTORIAL_DETAILS.zh[12].push(...)`; use route-keyed construction or direct array entries so removing a page cannot produce an undefined index.

- [ ] **Step 4: Run tests**

Run: `node tutorial-alignment.test.js && node weekly-exclusion.test.js && node --check app.js`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app.js tutorial-alignment.test.js
git commit -m "feat: add aligned trilingual chat guidance"
```

---

### Task 6: Add Additive Supabase Schema, Login, and RLS Migration

**Files:**
- Create: `supabase/config.toml`
- Create/adapt: `supabase/functions/lcb-login/index.ts`
- Create: `supabase-mother-son-team-parity.sql`
- Modify: `supabase-mother-son-security.sql`
- Create: `security-isolation.test.js`

**Interfaces:**
- Consumes: mother-son auth email-to-user mapping and existing encrypted matter/log/key/storage schema.
- Produces: versioning, login lockout, device/session functions, chat-compatible records/storage rules, and RLS matching team behavior.

- [ ] **Step 1: Write a failing static security test**

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const files = ['site-config.js', 'app.js', 'supabase-mother-son-team-parity.sql', 'supabase/functions/lcb-login/index.ts'];
const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');

assert.equal(source.includes('tvavifjfbdwgkehtbxum'), false);
assert.equal(source.includes("bucket_id='lcb-encrypted-files'"), false);
for (const required of ['lcb_app_user_id', 'lcb_matter_visible', 'lcb-login', 'carol-encrypted-files']) {
  assert.equal(source.includes(required), true, `missing isolation control: ${required}`);
}
```

- [ ] **Step 2: Run and verify failure**

Run: `node security-isolation.test.js`

Expected: FAIL because `supabase-mother-son-team-parity.sql` or the Edge Function is missing.

- [ ] **Step 3: Build one idempotent additive migration**

Port the current team versioning, login lock, key RPC, device, security event, and integrity mechanisms into `supabase-mother-son-team-parity.sql`. Use `create table if not exists`, `alter table ... add column if not exists`, and `create or replace function`. Do not include `drop table`, `truncate`, destructive `delete`, or storage-path rewrites.

- [ ] **Step 4: Adapt identity and RLS**

Keep the mother-son email-to-ID mapping from `supabase-mother-son-security.sql`. Admin visibility remains `carol`; ordinary users may select matters when owner or team member, and may mutate only according to the same team rules. Logs, wrapped keys, chat references, notifications, and files must verify the associated matter/conversation visibility server-side.

- [ ] **Step 5: Adapt secure login**

Copy the team `lcb-login` Edge Function and point it only at the mother-son Supabase project. Preserve Turnstile verification and rate limiting. Secrets such as the service-role key and Turnstile secret remain Supabase function secrets, never source files.

- [ ] **Step 6: Run static and SQL safety checks**

Run:

```bash
node security-isolation.test.js
rg -n -i 'drop table|truncate|delete from storage\.objects|service_role|turnstile.*secret' supabase-mother-son-team-parity.sql site-config.js app.js
```

Expected: security test passes; the safety scan returns no destructive statements or embedded secrets.

- [ ] **Step 7: Apply migration to the linked mother-son project and compare counts**

Apply only after confirming the linked project ref is `fnkgulfdcljwjkcqibxi`. Re-run the pre-migration row-count queries; all existing business row counts must be unchanged or higher, never lower.

- [ ] **Step 8: Deploy the Edge Function and configure secrets**

Deploy `lcb-login` to the mother-son Supabase project. Confirm its environment contains the Turnstile secret and allowed origin for the mother-son GitHub Pages URL without printing secret values.

- [ ] **Step 9: Commit**

```bash
git add supabase/config.toml supabase/functions/lcb-login/index.ts supabase-mother-son-team-parity.sql supabase-mother-son-security.sql security-isolation.test.js
git commit -m "feat: add isolated mother-son team backend controls"
```

---

### Task 7: Verify Local Behavior and Cross-Site Isolation

**Files:**
- Create: `migration-regression.test.js`
- Do not modify production files in this task; return to the task that owns any failing behavior and complete its red-green cycle there.

**Interfaces:**
- Consumes: final frontend, tests, mother-son backend, two valid mother-son accounts.
- Produces: automated and browser evidence that the migration is functional and isolated.

- [ ] **Step 1: Add the aggregate regression test**

Use `child_process.execFileSync(process.execPath, [testFile], { stdio: 'inherit' })` to run:

```js
[
  'site-config.test.js', 'local-mode.test.js', 'log-sync.test.js',
  'feature-parity.test.js', 'chat-behavior.test.js',
  'weekly-exclusion.test.js', 'tutorial-alignment.test.js',
  'security-isolation.test.js',
]
```

- [ ] **Step 2: Run complete static verification**

Run:

```bash
node migration-regression.test.js
node --check site-config.js
node --check runtime-mode.js
node --check log-sync.js
node --check chat-core.js
node --check app.js
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Run a local real-browser smoke test**

Serve the repository on `127.0.0.1`, open it in a real browser, and verify the mother-son branding, three languages, all current pages, chat, and absence of weekly view. Check the browser console for application errors.

- [ ] **Step 4: Run two-account permission tests against mother-son Supabase**

With two existing mother-son accounts: create a matter owned by one account; verify a non-member cannot see it; add the second account; verify it appears; send a chat message and attachment; remove membership; verify matter, chat reference, and file access are denied again.

- [ ] **Step 5: Prove cross-site isolation**

Create uniquely named test records in mother-son and team sites. Verify neither record appears on the other site. Confirm network requests from the mother-son page only target `fnkgulfdcljwjkcqibxi.supabase.co` and requests from the team page only target `tvavifjfbdwgkehtbxum.supabase.co`.

- [ ] **Step 6: Remove only newly created test records through normal application controls**

Delete the uniquely named test records and attachments from their own sites. Do not run broad SQL deletion.

- [ ] **Step 7: Commit the aggregate test**

```bash
git add migration-regression.test.js
git commit -m "test: cover mother-son migration regressions"
```

---

### Task 8: Deploy, Verify Production, and Preserve Rollback Evidence

**Files:**
- Modify: `index.html` cache versions
- Create from the team baseline and adapt: `.github/workflows/security-probe.yml`

**Interfaces:**
- Consumes: fully verified target repository and configured mother-son backend.
- Produces: live GitHub Pages deployment with chat, no weekly view, and recoverable release evidence.

- [ ] **Step 1: Add a release-specific cache version**

Update local script and stylesheet query strings in `index.html` to a unique `20260922-mother-son-team-chat1` version so browsers cannot retain the previous application shell.

- [ ] **Step 2: Configure the Turnstile hostname**

In the existing Cloudflare Turnstile widget, add the mother-son GitHub Pages hostname if it is not already allowed. Do not enable a production test bypass. Confirm the public site key in `site-config.js` belongs to this widget.

- [ ] **Step 3: Run final verification immediately before push**

Run:

```bash
node migration-regression.test.js
node --check app.js
git diff --check
git status --short
```

Expected: tests pass; status contains only intended tracked changes and no `.DS_Store`, dumps, backups, or secrets.

- [ ] **Step 4: Commit and push**

```bash
git add index.html .github/workflows/security-probe.yml
git commit -m "release: deploy mother-son team features with chat"
git push origin main
```

- [ ] **Step 5: Wait for GitHub Pages to serve the release version**

Poll the mother-son GitHub Pages HTML until it contains `20260922-mother-son-team-chat1`; a 200 response alone is insufficient.

- [ ] **Step 6: Verify the live site in a real browser**

Open the production URL with a cache-busting query. Confirm the login page renders, Turnstile works, two accounts can complete the core collaboration/chat flow, weekly view is absent, and the browser console contains no application errors.

- [ ] **Step 7: Record final evidence**

Report the release commit, live URL, passing test commands, backend project ref, preserved backup paths, and isolation checks. Keep the target Git Bundle and private database export until the user explicitly asks to remove them.
