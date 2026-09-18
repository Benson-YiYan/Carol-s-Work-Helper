(function () {
  'use strict';

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const state = { userId: '', privateKey: null, publicKey: null, ready: false, available: true };
  const matterKeys = new Map();
  const matterRecipients = new Map();
  const sealedLogCache = new Map();
  let publicDirectory = null;
  let pendingKeyRows = [];
  const pendingRecipientSets = new Map();

  function b64(bytes) {
    let text = '';
    new Uint8Array(bytes).forEach(x => { text += String.fromCharCode(x); });
    return btoa(text);
  }
  function unb64(text) {
    const raw = atob(text);
    return Uint8Array.from(raw, x => x.charCodeAt(0));
  }
  function random(n) {
    const out = new Uint8Array(n);
    crypto.getRandomValues(out);
    return out;
  }
  async function passwordKey(password, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt, iterations:310000, hash:'SHA-256' }, base,
      { name:'AES-GCM', length:256 }, false, ['encrypt', 'decrypt']
    );
  }
  async function encryptBytes(key, bytes) {
    const iv = random(12);
    const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, bytes);
    return { iv:b64(iv), cipher:b64(cipher) };
  }
  async function decryptBytes(key, sealed) {
    return crypto.subtle.decrypt({ name:'AES-GCM', iv:unb64(sealed.iv) }, key, unb64(sealed.cipher));
  }
  async function requestJson(request, path, opts) {
    const res = await request(path, opts);
    if (!res.ok) throw new Error(`crypto-http-${res.status}`);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  async function register(userId, password, request) {
    const pair = await crypto.subtle.generateKey(
      { name:'RSA-OAEP', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' },
      true, ['encrypt', 'decrypt']
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const salt = random(16);
    const lockKey = await passwordKey(password, salt);
    const sealed = await encryptBytes(lockKey, enc.encode(JSON.stringify(privateJwk)));
    const headers = { Prefer:'resolution=merge-duplicates,return=minimal' };
    await requestJson(request, '/lcb_public_keys', { method:'POST', headers, body:JSON.stringify([{ user_id:userId, public_jwk:publicJwk }]) });
    await requestJson(request, '/lcb_private_keys', { method:'POST', headers, body:JSON.stringify([{
      user_id:userId, salt:b64(salt), private_iv:sealed.iv, private_cipher:sealed.cipher,
    }]) });
    return pair;
  }
  async function unlock(row, password) {
    const lockKey = await passwordKey(password, unb64(row.salt));
    const raw = await decryptBytes(lockKey, { iv:row.private_iv, cipher:row.private_cipher });
    const jwk = JSON.parse(dec.decode(raw));
    return crypto.subtle.importKey('jwk', jwk, { name:'RSA-OAEP', hash:'SHA-256' }, false, ['decrypt']);
  }

  async function initialize(userId, password, request) {
    if (!globalThis.crypto || !crypto.subtle) throw new Error('webcrypto-unavailable');
    state.userId = userId;
    let rows;
    try {
      rows = await requestJson(request, `/lcb_private_keys?select=*&user_id=eq.${encodeURIComponent(userId)}`);
    } catch (e) {
      if (String(e.message).includes('404')) { state.available = false; return false; }
      throw e;
    }
    if (rows.length) {
      state.privateKey = await unlock(rows[0], password);
      const pubs = await requestJson(request, `/lcb_public_keys?select=public_jwk&user_id=eq.${encodeURIComponent(userId)}`);
      state.publicKey = await crypto.subtle.importKey('jwk', pubs[0].public_jwk, { name:'RSA-OAEP', hash:'SHA-256' }, true, ['encrypt']);
    } else {
      const pair = await register(userId, password, request);
      state.privateKey = pair.privateKey;
      state.publicKey = pair.publicKey;
    }
    state.ready = true;
    return true;
  }

  async function generateMatterKey() {
    return crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
  }
  async function wrapMatterKey(key, publicJwk) {
    const publicKey = await crypto.subtle.importKey('jwk', publicJwk, { name:'RSA-OAEP', hash:'SHA-256' }, false, ['encrypt']);
    const raw = await crypto.subtle.exportKey('raw', key);
    return b64(await crypto.subtle.encrypt({ name:'RSA-OAEP' }, publicKey, raw));
  }
  async function unwrapMatterKey(wrapped) {
    if (!state.privateKey) throw new Error('crypto-locked');
    const raw = await crypto.subtle.decrypt({ name:'RSA-OAEP' }, state.privateKey, unb64(wrapped));
    // Owners must be able to re-wrap the same matter key after a fresh login.
    return crypto.subtle.importKey('raw', raw, { name:'AES-GCM' }, true, ['encrypt','decrypt']);
  }
  async function sealJson(key, value) {
    const sealed = await encryptBytes(key, enc.encode(JSON.stringify(value)));
    return { v:1, alg:'A256GCM', iv:sealed.iv, cipher:sealed.cipher };
  }
  async function openJson(key, sealed) {
    return JSON.parse(dec.decode(await decryptBytes(key, sealed)));
  }
  async function directory(request) {
    if (publicDirectory) return publicDirectory;
    const rows = await requestJson(request, '/lcb_public_keys?select=user_id,public_jwk');
    publicDirectory = new Map(rows.map(row => [row.user_id, row.public_jwk]));
    return publicDirectory;
  }
  async function loadMatterKey(matterId, request) {
    const id = String(matterId);
    if (matterKeys.has(id)) return matterKeys.get(id);
    const rows = await requestJson(request, `/lcb_matter_keys?select=wrapped_key&matter_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(state.userId)}`);
    if (!rows.length) throw new Error('missing-matter-key');
    const key = await unwrapMatterKey(rows[0].wrapped_key);
    matterKeys.set(id, key);
    return key;
  }
  async function prepareMatter(matter, request) {
    if (!state.ready) throw new Error('crypto-locked');
    const id = String(matter.id);
    const recipients = [...new Set([...(matter.team || []), matter.owner, 'carol'].filter(Boolean))].sort();
    const recipientFingerprint = recipients.join(',');
    const canManageKeys = matter.owner === state.userId || state.userId === 'carol';
    let key = matterKeys.get(id);
    if (!key) {
      const rows = await requestJson(request, `/lcb_matter_keys?select=wrapped_key&matter_id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(state.userId)}`);
      if (rows.length) key = await unwrapMatterKey(rows[0].wrapped_key);
      else if (canManageKeys) key = await generateMatterKey();
      else return matter;
      matterKeys.set(id, key);
    }
    if (canManageKeys) {
      const previousRecipients = matterRecipients.get(id);
      if (previousRecipients && previousRecipients !== recipientFingerprint) {
        key = await generateMatterKey();
        matterKeys.set(id, key);
      }
      const keys = await directory(request);
      const missing = recipients.filter(userId => !keys.has(userId));
      if (missing.length) throw new Error('missing-public-keys:' + missing.join(','));
      pendingKeyRows = pendingKeyRows.filter(row => row.matter_id !== id);
      for (const userId of recipients) {
        pendingKeyRows.push({ matter_id:id, user_id:userId, wrapped_key:await wrapMatterKey(key, keys.get(userId)) });
      }
      pendingRecipientSets.set(id, recipients);
      matterRecipients.set(id, recipientFingerprint);
    }
    return {
      id:matter.id, owner:matter.owner, team:matter.team || [], deletedAt:matter.deletedAt || null,
      encrypted:'lcb-e2ee-v1', sealed:await sealJson(key, matter),
    };
  }
  async function openMatter(data, request) {
    if (!data || data.encrypted !== 'lcb-e2ee-v1') return data;
    const matter = await openJson(await loadMatterKey(data.id, request), data.sealed);
    const recipients = [...new Set([...(matter.team || []), matter.owner, 'carol'].filter(Boolean))].sort();
    matterRecipients.set(String(matter.id), recipients.join(','));
    return matter;
  }
  async function flushMatterKeys(request) {
    if (!pendingKeyRows.length) return;
    const rows = pendingKeyRows.slice();
    pendingKeyRows = [];
    await requestJson(request, '/rpc/lcb_store_wrapped_keys', {
      method:'POST', body:JSON.stringify({ payload:rows }),
    });
    pendingRecipientSets.clear();
  }
  function logPayload(log) {
    const payload = Object.assign({}, log);
    delete payload.readBy; delete payload.deletedFor;
    return payload;
  }
  async function prepareLog(log, request) {
    const key = await loadMatterKey(log.matterId, request);
    const payload = logPayload(log);
    const fingerprint = JSON.stringify(payload);
    let cached = sealedLogCache.get(String(log.id));
    if (!cached || cached.fingerprint !== fingerprint) {
      cached = { fingerprint, sealed:await sealJson(key, payload) };
      sealedLogCache.set(String(log.id), cached);
    }
    return {
      id:log.id, matterId:log.matterId, at:log.at, by:log.by, key:log.key,
      notifyTo:log.notifyTo || [], readBy:log.readBy || [], deletedFor:log.deletedFor || [],
      encrypted:'lcb-e2ee-v1', sealed:cached.sealed,
    };
  }
  async function openLog(data, request) {
    if (!data || data.encrypted !== 'lcb-e2ee-v1') return data;
    const payload = await openJson(await loadMatterKey(data.matterId, request), data.sealed);
    payload.readBy = data.readBy || [];
    payload.deletedFor = data.deletedFor || [];
    sealedLogCache.set(String(data.id), { fingerprint:JSON.stringify(logPayload(payload)), sealed:data.sealed });
    return payload;
  }
  async function encryptFile(matterId, bytes, request) {
    return encryptBytes(await loadMatterKey(matterId, request), bytes);
  }
  async function decryptFile(matterId, sealed, request) {
    return decryptBytes(await loadMatterKey(matterId, request), sealed);
  }
  function lock() {
    state.userId = ''; state.privateKey = null; state.publicKey = null; state.ready = false;
    matterKeys.clear(); matterRecipients.clear(); sealedLogCache.clear(); publicDirectory = null; pendingKeyRows = []; pendingRecipientSets.clear();
  }

  globalThis.LCBCrypto = {
    state, initialize, lock, generateMatterKey, wrapMatterKey, unwrapMatterKey, sealJson, openJson,
    prepareMatter, openMatter, flushMatterKeys, prepareLog, openLog, encryptFile, decryptFile,
  };
})();
