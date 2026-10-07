/* Automotriz Medina V4 — conector Drive V4 Etapa 4.
   - Guardado transaccional: una recepción completa viaja en una sola llamada.
   - La contraseña/PIN nunca se guarda; el dispositivo conserva solo un token revocable.
   - Media remoto cacheado por fileId y por expediente para evitar cruces y descargas repetidas.
   - Carga de workspace y media en lotes para minimizar viajes a Apps Script.
*/
globalThis.AM_CLOUD_SYNC = (() => {
  'use strict';

  const BUILD = 'v4-stage4.18.2-invoices-2026-10-07';
  const DRIVE_REQUIRED = true;
  const CONFIG_KEY = 'am_v4_sync_config_v2';
  const SESSIONS_KEY = 'am_v4_backend_device_sessions_v2';
  const ACTIVE_HINT_KEY = 'am_v4_backend_active_session_v1';
  const MEDIA_CACHE_KEY = 'am_v4_cloud_media_refs_v2';
  const MEDIA_DATA_CACHE_NAME = 'am-v4-media-data-v1';
  const DEFAULT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwhzohmpF7t7931rxoNdilGmm_sClWlSBJJ4IhfhJpKMHI_S64RjtIXajMGb3BJvsEd/exec';
  const DEFAULT_ACCOUNT = 'automotrizmedinaapp@gmail.com';

  const invoiceCache = new Map();
  const photoCache = new Map();
  const thumbnailCache = new Map();
  const thumbnailStateCache = new Map();
  const mediaPrimeInFlight = new Map();
  const mediaRetryAfter = new Map();
  let saveTail = Promise.resolve();
  let lastSnapshot = null;
  let lastRemoteIndex = null;

  function clone(v, fallback = null) {
    try { return v == null ? fallback : JSON.parse(JSON.stringify(v)); } catch { return fallback; }
  }
  function cleanEmployeeId(value) {
    let id = String(value || '').toLowerCase().trim();
    if (id === 'christian') id = 'cristian';
    return id;
  }
  function canonicalItemKey(item) {
    if (!item) return '';
    const number = String(item.number || item.rec || '').trim();
    if (number) return `rec:${number}`;
    const folderId = String(item?._storage?.folderId || '').trim();
    if (folderId) return `folder:${folderId}`;
    const employee = cleanEmployeeId(item.employeeId || item.eid || '');
    const localId = String(item.id || item.vehicleId || '').trim();
    if (employee && localId) return `emp:${employee}:${localId}`;
    if (localId) return `id:${localId}`;
    return '';
  }
  function keys(item) {
    const key = canonicalItemKey(item);
    return key ? [key] : [];
  }
  function allItemKeys(item) {
    const out=[]; const add=(v)=>{v=String(v||'').trim();if(v&&!out.includes(v))out.push(v)};
    if(!item)return out;
    const number=String(item.number||item.rec||'').trim(); if(number)add(`rec:${number}`);
    const folderId=String(item?._storage?.folderId||item.folderId||'').trim(); if(folderId)add(`folder:${folderId}`);
    const employee=cleanEmployeeId(item.employeeId||item.eid||'');
    const localId=String(item.id||item.vehicleId||'').trim();
    if(employee&&localId)add(`emp:${employee}:${localId}`);
    if(localId){add(`id:${localId}`);add(`id:${localId.replace(/^emp-/,'')}`);}
    return out;
  }
  function readJson(storage, key, fallback) {
    try { return JSON.parse(storage.getItem(key) || '') || fallback; } catch { return fallback; }
  }

  function config() {
    const stored = readJson(localStorage, CONFIG_KEY, {}) || {};
    return {
      mode: 'drive-v4',
      endpoint: DEFAULT_ENDPOINT,
      account: DEFAULT_ACCOUNT,
      ...stored,
      // Esta compilación es Drive-first: nunca debe aceptar un guardado local como confirmado.
      enabled: DRIVE_REQUIRED ? true : stored.enabled !== false
    };
  }
  function saveConfig(next) {
    const current = config();
    const cfg = {
      ...current,
      ...(next || {}),
      endpoint: String(next?.endpoint ?? current.endpoint ?? DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
      account: String(next?.account ?? current.account ?? DEFAULT_ACCOUNT).trim() || DEFAULT_ACCOUNT,
      enabled: DRIVE_REQUIRED ? true : !!(next?.enabled ?? current.enabled)
    };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    return cfg;
  }

  function readSessions() {
    const stored = readJson(localStorage, SESSIONS_KEY, {}) || {};
    if (!stored.employee || typeof stored.employee !== 'object') stored.employee = {};
    return stored;
  }
  function writeSessions(store) {
    try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(store || {})); } catch {}
  }
  function pageEmployeeId() {
    try {
      const q = new URLSearchParams(location.search);
      const h = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
      return cleanEmployeeId(q.get('empleado') || h.get('empleado') || sessionStorage.getItem('am_empleado_activo_v1') || '');
    } catch { return ''; }
  }
  function activeHint() {
    try { return readJson(sessionStorage, ACTIVE_HINT_KEY, null); } catch { return null; }
  }
  function setActiveHint(value) {
    try {
      if (value) sessionStorage.setItem(ACTIVE_HINT_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(ACTIVE_HINT_KEY);
    } catch {}
  }
  function validSession(value) {
    if (!value || !value.session) return null;
    if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) return null;
    return value;
  }
  function session(role = '', employeeId = '') {
    const store = readSessions();
    let wantedRole = String(role || '');
    let wantedEmployee = cleanEmployeeId(employeeId);
    if (!wantedRole) {
      const page = String(document?.body?.dataset?.page || '');
      if (page === 'admin') wantedRole = 'admin';
      else if (page === 'employee') { wantedRole = 'employee'; wantedEmployee = pageEmployeeId(); }
      else {
        const hint = activeHint();
        wantedRole = String(hint?.role || '');
        wantedEmployee = cleanEmployeeId(hint?.employeeId || '');
      }
    }
    let value = null;
    if (wantedRole === 'admin') value = store.admin;
    else if (wantedRole === 'employee') {
      if (wantedEmployee) value = store.employee?.[wantedEmployee];
      else {
        const candidates = Object.values(store.employee || {}).filter(Boolean);
        if (candidates.length === 1) value = candidates[0];
      }
    }
    value = validSession(value);
    if (!value) return null;
    return value;
  }
  function setSession(value) {
    if (!value || !value.session) return null;
    const clean = {
      session: String(value.session), role: String(value.role || ''), employeeId: cleanEmployeeId(value.employeeId || ''),
      expiresAt: String(value.expiresAt || ''), rememberedDevice: value.rememberedDevice !== false
    };
    const store = readSessions();
    if (clean.role === 'admin') store.admin = clean;
    else if (clean.role === 'employee' && clean.employeeId) store.employee[clean.employeeId] = clean;
    writeSessions(store);
    setActiveHint({ role: clean.role, employeeId: clean.employeeId });
    return clean;
  }
  function clearSession(role = '', employeeId = '') {
    const current = role ? session(role, employeeId) : session();
    const store = readSessions();
    const r = role || current?.role || '';
    const e = cleanEmployeeId(employeeId || current?.employeeId || '');
    if (r === 'admin') delete store.admin;
    else if (r === 'employee' && e) delete store.employee[e];
    else if (!r) { delete store.admin; store.employee = {}; }
    writeSessions(store);
    const hint = activeHint();
    if (!hint || hint.role === r && (!e || cleanEmployeeId(hint.employeeId) === e)) setActiveHint(null);
  }
  function hasSession(role = '', employeeId = '') { return !!session(role, employeeId); }
  function sessionMatches(role, employeeId = '') {
    const current = session(role, employeeId);
    if (!current || current.role !== role) return false;
    if (role === 'employee' && employeeId) return cleanEmployeeId(current.employeeId) === cleanEmployeeId(employeeId);
    return true;
  }
  function activateSession(role = '', employeeId = '') {
    const current = session(role, employeeId);
    if (!current) return null;
    setActiveHint({ role: current.role, employeeId: current.employeeId || '' });
    return current;
  }
  function isReady() {
    const cfg = config();
    return !!(cfg.endpoint && session());
  }
  function connectionState() {
    const cfg = config();
    const current = session();
    return {
      build: BUILD,
      driveRequired: DRIVE_REQUIRED,
      endpointConfigured: !!cfg.endpoint,
      configuredEnabled: !!cfg.enabled,
      role: current?.role || '',
      employeeId: current?.employeeId || '',
      hasSession: !!current,
      ready: !!(cfg.endpoint && current)
    };
  }

  function endpointUrl() {
    const url = String(config().endpoint || DEFAULT_ENDPOINT).trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\//i.test(url)) throw new Error('La URL del backend V4 no es válida.');
    return url;
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {
      throw new Error('El backend respondió con un formato no válido.');
    }
    if (!response.ok) throw new Error(data?.error || `Error HTTP ${response.status}`);
    return data;
  }

  async function ping() {
    const url = new URL(endpointUrl());
    url.searchParams.set('action', 'ping');
    const response = await fetch(url.toString(), { method: 'GET', cache: 'no-store', redirect: 'follow' });
    const data = await readJsonResponse(response);
    if (!data?.ok) throw new Error(data?.error || 'El backend V4 no respondió correctamente.');
    return data;
  }

  async function request(action, payload = {}, options = {}) {
    const authSession = options.public ? null : (options.session || session(options.role || '', options.employeeId || ''));
    const auth = options.public ? {} : { session: authSession?.session || '' };
    const body = { action, payload: payload || {}, auth };
    const response = await fetch(endpointUrl(), {
      method: 'POST',
      redirect: 'follow',
      cache: 'no-store',
      // text/plain evita preflight CORS y Apps Script recibe igualmente el JSON en e.postData.contents.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
    const data = await readJsonResponse(response);
    if (!data?.ok) throw new Error(data?.error || `La operación ${action} falló.`);
    return data;
  }

  async function loginAdmin(pin) {
    const data = await request('loginAdmin', { pin: String(pin || ''), rememberDevice: true }, { public: true });
    return setSession(data);
  }
  async function loginEmployee(employeeId, credential) {
    const data = await request('loginEmployee', { employeeId: String(employeeId || ''), credential: String(credential || ''), rememberDevice: true }, { public: true });
    return setSession(data);
  }
  async function logout(role = '', employeeId = '') {
    const current = session(role, employeeId);
    try {
      if (current?.session) await request('logout', {}, { session: current });
    } finally {
      clearSession(role || current?.role || '', employeeId || current?.employeeId || '');
    }
    return { ok: true };
  }
  async function configureCredentials(adminPin, employees) {
    const data = await request('configureCredentials', { adminPin: String(adminPin || ''), employees: employees || {} });
    try { localStorage.removeItem(SESSIONS_KEY); } catch {}
    setActiveHint(null);
    return data;
  }

  function snapshot() {
    return window.AM_V4_DATA?.snapshot?.() || {
      version: 4,
      exportedAt: new Date().toISOString(),
      appState: window.AM_SIMPLE_STORE?.load?.() || null,
      employeeState: null,
      archives: { master: {}, quick: {} }
    };
  }
  function applySnapshot(snap) {
    if (snap) lastSnapshot = clone(snap, snap);
    return window.AM_V4_DATA?.restoreSnapshot?.(snap) || snap;
  }

  function mediaHash(value) {
    let h = 2166136261 >>> 0;
    const s = String(value || '');
    const step = Math.max(1, Math.floor(s.length / 4096));
    for (let i = 0; i < s.length; i += step) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return `${h.toString(36)}_${s.length.toString(36)}`;
  }
  function readMediaRefCache() { return readJson(localStorage, MEDIA_CACHE_KEY, {}) || {}; }
  function writeMediaRefCache(cache) {
    try { localStorage.setItem(MEDIA_CACHE_KEY, JSON.stringify(cache || {})); } catch {}
  }
  function mediaScope(item) { return canonicalItemKey(item) || 'unknown'; }
  function mediaRefCacheKey(item, dataUrl) { return `${mediaScope(item)}:${mediaHash(dataUrl)}`; }
  async function mediaDataCacheGet(fileId) {
    if (!fileId || !globalThis.caches) return '';
    try {
      const cache = await caches.open(MEDIA_DATA_CACHE_NAME);
      const key = new Request(`${location.origin}/__am_v4_media_cache__/${encodeURIComponent(fileId)}`);
      const hit = await cache.match(key);
      return hit ? await hit.text() : '';
    } catch { return ''; }
  }
  async function mediaDataCacheSet(fileId, dataUrl) {
    if (!fileId || !dataUrl || !globalThis.caches) return;
    try {
      const cache = await caches.open(MEDIA_DATA_CACHE_NAME);
      const key = new Request(`${location.origin}/__am_v4_media_cache__/${encodeURIComponent(fileId)}`);
      await cache.put(key, new Response(dataUrl, { headers: { 'Content-Type': 'text/plain;charset=utf-8' } }));
    } catch {}
  }
  async function thumbnailDataCacheGet(fileId) {
    if (!fileId || !globalThis.caches) return '';
    try {
      const cache = await caches.open(MEDIA_DATA_CACHE_NAME);
      const key = new Request(`${location.origin}/__am_v4_thumb_cache__/${encodeURIComponent(fileId)}`);
      const hit = await cache.match(key);
      return hit ? await hit.text() : '';
    } catch { return ''; }
  }
  async function thumbnailDataCacheSet(fileId, dataUrl) {
    if (!fileId || !dataUrl || !globalThis.caches) return;
    try {
      const cache = await caches.open(MEDIA_DATA_CACHE_NAME);
      const key = new Request(`${location.origin}/__am_v4_thumb_cache__/${encodeURIComponent(fileId)}`);
      await cache.put(key, new Response(dataUrl, { headers: { 'Content-Type': 'text/plain;charset=utf-8' } }));
    } catch {}
  }
  function makeThumbnailDataUrl(dataUrl, maxEdge = 320, quality = 0.68) {
    if (!dataUrl || !/^data:image\//i.test(String(dataUrl))) return Promise.resolve(dataUrl || '');
    if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(dataUrl);
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        try {
          const width = Math.max(1, Number(image.naturalWidth || image.width || 1));
          const height = Math.max(1, Number(image.naturalHeight || image.height || 1));
          const scale = Math.min(1, maxEdge / Math.max(width, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const context = canvas.getContext('2d', { alpha: false });
          if (!context) { resolve(dataUrl); return; }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const thumb = canvas.toDataURL('image/webp', quality);
          resolve(thumb || dataUrl);
        } catch { resolve(dataUrl); }
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }
  function rememberMediaPair(owner, dataUrl, ref) {
    if (!isDataMedia(dataUrl) || !isRemoteMediaRef(ref)) return;
    const refs = readMediaRefCache();
    const cleanRef = clone(ref, ref);
    if (cleanRef && typeof cleanRef === 'object') delete cleanRef._receptionId;
    refs[mediaRefCacheKey(owner, dataUrl)] = cleanRef;
    writeMediaRefCache(refs);
  }
  function replaceKnownMediaWithRefs(value, owner, refs = readMediaRefCache()) {
    if (isDataMedia(value)) return clone(refs[mediaRefCacheKey(owner, value)] || value, value);
    if (Array.isArray(value)) return value.map(item => replaceKnownMediaWithRefs(item, owner, refs));
    if (!value || typeof value !== 'object') return value;
    if (isRemoteMediaRef(value)) { const out = clone(value, value); if (out) delete out._receptionId; return out; }
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = replaceKnownMediaWithRefs(item, owner, refs);
    return out;
  }
  function forgetMediaRefs(item) {
    const scopes = allItemKeys(item);
    if (!scopes.length) return 0;
    const refs = readMediaRefCache();
    let removed = 0;
    for (const key of Object.keys(refs)) {
      if (!scopes.some(scope => key.startsWith(`${scope}:`))) continue;
      delete refs[key];
      removed += 1;
    }
    if (removed) writeMediaRefCache(refs);
    return removed;
  }
  function collectRemoteFileIds(value, out = new Set()) {
    if (Array.isArray(value)) { value.forEach(v=>collectRemoteFileIds(v,out)); return out; }
    if (!value || typeof value !== 'object') return out;
    if (isRemoteMediaRef(value) && value.fileId) out.add(String(value.fileId));
    Object.values(value).forEach(v=>collectRemoteFileIds(v,out));
    return out;
  }
  async function purgeLocalReceptionCaches(item) {
    const scopes=allItemKeys(item);
    const fileIds=collectRemoteFileIds(item,new Set());
    const refs=readMediaRefCache();
    let removedRefs=0;
    for(const [key,ref] of Object.entries(refs)){
      if(!scopes.some(scope=>key.startsWith(`${scope}:`)))continue;
      if(ref?.fileId)fileIds.add(String(ref.fileId));
      delete refs[key];removedRefs+=1;
    }
    if(removedRefs)writeMediaRefCache(refs);
    let removedMemory=0;
    for(const scope of scopes){if(invoiceCache.delete(scope))removedMemory+=1;if(photoCache.delete(scope))removedMemory+=1;if(thumbnailCache.delete(scope))removedMemory+=1;thumbnailStateCache.delete(scope);}
    try{window.AM_V4_DATA?.purgeLocalReceptionResidue?.(item);}catch{}
    let removedCacheStorage=0;
    if(globalThis.caches&&fileIds.size){
      try{
        const cache=await caches.open(MEDIA_DATA_CACHE_NAME);
        for(const fileId of fileIds){
          const key=new Request(`${location.origin}/__am_v4_media_cache__/${encodeURIComponent(fileId)}`);
          if(await cache.delete(key))removedCacheStorage+=1;
        }
      }catch{}
    }
    return {removedRefs,removedMemory,removedCacheStorage,fileIds:[...fileIds]};
  }
  function pairMediaTrees(localValue, remoteValue, owner) {
    if (isDataMedia(localValue) && isRemoteMediaRef(remoteValue)) { rememberMediaPair(owner, localValue, remoteValue); return; }
    if (Array.isArray(localValue) && Array.isArray(remoteValue)) {
      for (let i = 0; i < Math.min(localValue.length, remoteValue.length); i += 1) pairMediaTrees(localValue[i], remoteValue[i], owner);
      return;
    }
    if (!localValue || !remoteValue || typeof localValue !== 'object' || typeof remoteValue !== 'object') return;
    for (const key of Object.keys(localValue)) if (key in remoteValue) pairMediaTrees(localValue[key], remoteValue[key], owner);
  }
  function isDataMedia(value) { return typeof value === 'string' && /^data:(?:image|video|audio)\//i.test(value); }
  function isRemoteMediaRef(value) { return !!(value && typeof value === 'object' && value.__amMediaFile === true && (value.fileId || value.path)); }

  function safeNamePart(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'media';
  }
  function extensionFromDataUrl(value) {
    const m = /^data:([^;,]+)/i.exec(String(value || ''));
    const mime = String(m?.[1] || '').toLowerCase();
    return ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'video/webm': '.webm', 'video/mp4': '.mp4', 'audio/webm': '.webm', 'audio/mpeg': '.mp3' })[mime] || '';
  }

  async function uploadEmbeddedMedia(expedienteId, value, path = [], cache = readMediaRefCache()) {
    if (isRemoteMediaRef(value)) return clone(value, value);
    if (isDataMedia(value)) {
      const hash = mediaHash(value);
      const scopedHash = `${String(expedienteId || 'unknown')}:${hash}`;
      if (cache[scopedHash]?.fileId) return clone(cache[scopedHash]);
      const label = path.filter(Boolean).slice(-3).join('-') || 'media';
      const fileName = `${safeNamePart(label)}-${hash.slice(0, 10)}${extensionFromDataUrl(value)}`;
      const result = await request('uploadMedia', { id: expedienteId, fileName, dataUrl: value });
      cache[scopedHash] = result.media;
      writeMediaRefCache(cache);
      return clone(result.media, result.media);
    }
    if (Array.isArray(value)) {
      const out = [];
      for (let i = 0; i < value.length; i += 1) out.push(await uploadEmbeddedMedia(expedienteId, value[i], [...path, String(i)], cache));
      return out;
    }
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = await uploadEmbeddedMedia(expedienteId, item, [...path, key], cache);
    return out;
  }

  function stripEmbeddedMedia(value) {
    if (isDataMedia(value)) return '';
    if (Array.isArray(value)) return value.map(stripEmbeddedMedia);
    if (!value || typeof value !== 'object') return value;
    if (isRemoteMediaRef(value)) return clone(value, value);
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = stripEmbeddedMedia(item);
    return out;
  }

  async function hydrateRemoteMedia(value, cache = new Map(), options = {}) {
    if (isRemoteMediaRef(value)) {
      const key = String(value.fileId || value.path || '');
      if (!key) return '';
      if (cache.has(key)) return cache.get(key);
      let url = value.fileId ? await mediaDataCacheGet(value.fileId) : '';
      if (!url) {
        const data = options.public
          ? await request('publicMedia', { token: options.token, type: options.type, media: value }, { public: true })
          : await request('loadMedia', { media: value, id: value._receptionId || options.receptionId || undefined });
        url = data?.media?.dataUrl || '';
        if (url && value.fileId && !options.public) await mediaDataCacheSet(value.fileId, url);
      }
      cache.set(key, url);
      if (url && options.owner && !options.public) rememberMediaPair(options.owner, url, value);
      return url;
    }
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await hydrateRemoteMedia(item, cache, options));
      return out;
    }
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = await hydrateRemoteMedia(item, cache, options);
    return out;
  }

  function collectWorkspaceRefs(value, receptionId, out = new Map()) {
    if (isRemoteMediaRef(value)) {
      const fileId = String(value.fileId || '');
      if (fileId && !out.has(fileId)) out.set(fileId, { id: receptionId, media: value, key: fileId });
      return out;
    }
    if (Array.isArray(value)) { value.forEach(item => collectWorkspaceRefs(item, receptionId, out)); return out; }
    if (value && typeof value === 'object') Object.values(value).forEach(item => collectWorkspaceRefs(item, receptionId, out));
    return out;
  }
  function replaceRefsFromMap(value, dataMap, owner) {
    if (isRemoteMediaRef(value)) {
      const fileId = String(value.fileId || '');
      const url = dataMap.get(fileId) || '';
      if (url) rememberMediaPair(owner, url, value);
      return url;
    }
    if (Array.isArray(value)) return value.map(item => replaceRefsFromMap(item, dataMap, owner));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = replaceRefsFromMap(item, dataMap, owner);
    return out;
  }
  async function hydrateWorkspaceMedia(receptions) {
    const refs = new Map();
    for (const rec of receptions) collectWorkspaceRefs(rec, rec.id || rec.number, refs);
    const dataMap = new Map();
    const missing = [];
    for (const [fileId, item] of refs.entries()) {
      const cached = await mediaDataCacheGet(fileId);
      if (cached) dataMap.set(fileId, cached);
      else missing.push(item);
    }
    const chunkSize = 18;
    for (let i = 0; i < missing.length; i += chunkSize) {
      const chunk = missing.slice(i, i + chunkSize);
      let result = { items: [] };
      try {
        result = await request('loadMediaBatch', { items: chunk });
      } catch (batchError) {
        // V4.18: una fotografía corrupta o ausente jamás puede abortar el workspace.
        // Se intenta cada elemento por separado y se conserva el resto del lote.
        for (const item of chunk) {
          try {
            const single = await request('loadMedia', { id: item.id, media: item.media });
            result.items.push({ key: item.key, media: single.media });
          } catch (singleError) {
            console.warn('Media omitido durante carga visual', item?.media?.fileId || item?.media?.path || '', singleError);
          }
        }
      }
      for (const item of (result.items || [])) {
        const fileId = String(item.key || item.media?.fileId || '');
        const url = item.media?.dataUrl || '';
        if (fileId && url) {
          dataMap.set(fileId, url);
          await mediaDataCacheSet(fileId, url);
        }
      }
    }
    return receptions.map(rec => replaceRefsFromMap(rec, dataMap, rec));
  }

  function receptionVisualKey(rec) {
    return String(rec?.number || rec?.id || rec?._storage?.folderId || '');
  }
  function dispatchMediaReady(kind, rec) {
    try {
      window.dispatchEvent(new CustomEvent('am-cloud-media-ready', { detail: { kind, id: rec?.id || '', number: rec?.number || '' } }));
    } catch {}
  }
  function thumbnailCacheKeys(rec) {
    const out = allItemKeys(rec);
    const canonical = receptionVisualKey(rec);
    if (canonical && !out.includes(canonical)) out.push(canonical);
    return out;
  }
  function photoLabelKey(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }
  function frontPhotoEntry(rec) {
    const photos = Array.isArray(rec?.photos) ? rec.photos : [];
    return photos.find(photo => photoLabelKey(photo?.label) === 'frente') || photos[0] || null;
  }
  function setThumbnail(rec, dataUrl, status = 'ready') {
    const src = String(dataUrl || '');
    for (const key of thumbnailCacheKeys(rec)) {
      if (src) thumbnailCache.set(key, src);
      else thumbnailCache.delete(key);
      thumbnailStateCache.set(key, status);
    }
    return src;
  }
  function cachedThumbnail(rec) {
    for (const key of thumbnailCacheKeys(rec)) {
      const src = thumbnailCache.get(key);
      if (src) return src;
    }
    return '';
  }
  function thumbnailStatus(rec) {
    if (cachedThumbnail(rec)) return 'ready';
    const front = frontPhotoEntry(rec);
    if (!front?.dataUrl) return 'missing';
    for (const key of thumbnailCacheKeys(rec)) {
      const status = thumbnailStateCache.get(key);
      if (status) return status;
    }
    return 'loading';
  }
  async function ensureReceptionThumbnail(rec) {
    if (!rec) return '';
    const ready = cachedThumbnail(rec);
    if (ready) return ready;
    const front = frontPhotoEntry(rec);
    if (!front?.dataUrl) {
      setThumbnail(rec, '', 'missing');
      dispatchMediaReady('thumbnail', rec);
      return '';
    }
    const media = front.dataUrl;
    const key = `thumb:${receptionVisualKey(rec)}`;
    if (Date.now() < Number(mediaRetryAfter.get(key) || 0)) return '';
    if (mediaPrimeInFlight.has(key)) return mediaPrimeInFlight.get(key);
    for (const cacheKey of thumbnailCacheKeys(rec)) thumbnailStateCache.set(cacheKey, 'loading');
    const task = (async () => {
      try {
        let full = '';
        let fileId = '';
        if (typeof media === 'string') {
          full = media;
        } else if (isRemoteMediaRef(media)) {
          fileId = String(media.fileId || '');
          if (fileId) {
            const cachedThumb = await thumbnailDataCacheGet(fileId);
            if (cachedThumb) {
              setThumbnail(rec, cachedThumb, 'ready');
              mediaRetryAfter.delete(key);
              dispatchMediaReady('thumbnail', rec);
              return cachedThumb;
            }
            full = await mediaDataCacheGet(fileId);
          }
          if (!full) {
            const result = await request('loadMedia', { id: rec.id || rec.number, media });
            full = result?.media?.dataUrl || '';
          }
        }
        if (!full) throw new Error('La fotografía frontal no está disponible.');
        const thumb = await makeThumbnailDataUrl(full);
        if (!thumb) throw new Error('No se pudo preparar la miniatura.');
        if (fileId) await thumbnailDataCacheSet(fileId, thumb);
        setThumbnail(rec, thumb, 'ready');
        mediaRetryAfter.delete(key);
        dispatchMediaReady('thumbnail', rec);
        return thumb;
      } catch (error) {
        mediaRetryAfter.set(key, Date.now() + 30000);
        setThumbnail(rec, '', 'error');
        dispatchMediaReady('thumbnail', rec);
        console.warn('No se pudo cargar miniatura de recepción', rec?.number || rec?.id || '', error);
        return '';
      } finally {
        mediaPrimeInFlight.delete(key);
      }
    })();
    mediaPrimeInFlight.set(key, task);
    return task;
  }
  async function primeReceptionThumbnails(receptions) {
    const queue = Array.isArray(receptions) ? receptions.slice() : [];
    const workers = Math.min(4, queue.length);
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const rec = queue[cursor++];
        await ensureReceptionThumbnail(rec);
      }
    }
    await Promise.all(Array.from({ length: workers }, worker));
    return true;
  }

  async function ensureReceptionPhotos(rec) {
    if (!rec) return [];
    const existing = cachedPhotos(rec);
    if (Array.isArray(existing) && existing.some(p => typeof p?.dataUrl === 'string' && p.dataUrl)) return existing;
    const refs = Array.isArray(rec.photos) ? rec.photos : [];
    if (!refs.some(p => isRemoteMediaRef(p?.dataUrl))) return refs;
    const key = `photos:${receptionVisualKey(rec)}`;
    if (Date.now() < Number(mediaRetryAfter.get(key) || 0)) return refs;
    if (mediaPrimeInFlight.has(key)) return mediaPrimeInFlight.get(key);
    const task = (async () => {
      try {
        const [hydrated] = await hydrateWorkspaceMedia([{ ...clone(rec, {}), invoices: [], damages: [], updates: [], pendingTracking: null, adminTrackingDraft: null }]);
        const photos = Array.isArray(hydrated?.photos) ? hydrated.photos : [];
        cachePhotos(rec, photos, { persist: false });
        mediaRetryAfter.delete(key);
        dispatchMediaReady('photos', rec);
        return photos;
      } catch (error) {
        mediaRetryAfter.set(key, Date.now() + 30000);
        console.warn('No se pudieron cargar fotografías visuales', rec?.number || rec?.id || '', error);
        return [];
      } finally {
        mediaPrimeInFlight.delete(key);
      }
    })();
    mediaPrimeInFlight.set(key, task);
    return task;
  }
  async function ensureReceptionInvoices(rec) {
    if (!rec) return [];
    const existing = cachedInvoices(rec);
    if (Array.isArray(existing) && existing.some(p => typeof p?.dataUrl === 'string' && p.dataUrl)) return existing;
    const refs = Array.isArray(rec.invoices) ? rec.invoices : [];
    if (!refs.some(p => isRemoteMediaRef(p?.dataUrl))) return refs;
    const key = `invoices:${receptionVisualKey(rec)}`;
    if (Date.now() < Number(mediaRetryAfter.get(key) || 0)) return refs;
    if (mediaPrimeInFlight.has(key)) return mediaPrimeInFlight.get(key);
    const task = (async () => {
      try {
        const [hydrated] = await hydrateWorkspaceMedia([{ id: rec.id, number: rec.number, _storage: rec._storage, photos: [], invoices: clone(refs, []) }]);
        const invoices = Array.isArray(hydrated?.invoices) ? hydrated.invoices : [];
        cacheInvoices(rec, invoices, { persist: false });
        mediaRetryAfter.delete(key);
        dispatchMediaReady('invoices', rec);
        return invoices;
      } catch (error) {
        mediaRetryAfter.set(key, Date.now() + 30000);
        console.warn('No se pudieron cargar facturas visuales', rec?.number || rec?.id || '', error);
        return [];
      } finally {
        mediaPrimeInFlight.delete(key);
      }
    })();
    mediaPrimeInFlight.set(key, task);
    return task;
  }
  async function primeReceptionPhotos(receptions) {
    const queue = (Array.isArray(receptions) ? receptions : []).filter(rec => Array.isArray(rec?.photos) && rec.photos.some(p => isRemoteMediaRef(p?.dataUrl)));
    const workers = Math.min(3, queue.length);
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const rec = queue[cursor++];
        await ensureReceptionPhotos(rec);
      }
    }
    await Promise.all(Array.from({ length: workers }, worker));
    return true;
  }

  function markReceptionMediaRefs(value, receptionId) {
    if (isRemoteMediaRef(value)) return { ...value, _receptionId: receptionId };
    if (Array.isArray(value)) return value.map(item => markReceptionMediaRefs(item, receptionId));
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = markReceptionMediaRefs(item, receptionId);
    return out;
  }


  async function loadRemoteSnapshot(options = {}) {
    if (!hasSession()) throw new Error('Falta iniciar una sesión segura con el backend V4.');
    const workspace = await request('loadWorkspace', {});
    const entries = Array.isArray(workspace.entries) ? workspace.entries : [];
    lastRemoteIndex = {
      ok: true, schemaVersion: workspace.schemaVersion, updatedAt: workspace.updatedAt,
      nextReceptionNumber: workspace.nextReceptionNumber, expedientes: entries
    };

    // V4.18: el workspace se aplica INMEDIATAMENTE con referencias Drive pequeñas.
    // Las imágenes son una mejora visual asíncrona: jamás bloquean ni ponen el dashboard en cero.
    let remoteReceptions = Array.isArray(workspace.expedientes) ? clone(workspace.expedientes, []) : [];
    const local = window.AM_V4_DATA?.readAdminState?.() || {};

    // Liberar únicamente residuos locales de expedientes ya confirmados por Drive.
    // Esto no toca Drive ni elimina CacheStorage visual compartido.
    for (const remote of remoteReceptions) {
      try { window.AM_V4_DATA?.purgeLocalReceptionResidue?.(remote); } catch {}
    }

    let receptions = remoteReceptions;
    const currentSession = session();
    if (currentSession?.role === 'employee') {
      const employeeId = cleanEmployeeId(currentSession.employeeId);
      const preserved = (local.receptions || [])
        .filter(rec => cleanEmployeeId(rec.employeeId) !== employeeId)
        .map(rec => stripEmbeddedMedia(rec));
      receptions = [...receptions, ...preserved];
    }
    const appState = {
      ...local, receptions,
      config: { ...(local.config || {}), nextReceptionNumber: Number(workspace.nextReceptionNumber || local.config?.nextReceptionNumber || 1) },
      deletedReceptionNumbers: [],
      reservedReceptionNumbers: clone(local.reservedReceptionNumbers || [], []),
      selectedId: receptions.some(r => r.id === local.selectedId) ? local.selectedId : (receptions[0]?.id || null)
    };
    const snap = { version: 4, exportedAt: workspace.updatedAt || new Date().toISOString(), appState, employeeState: null, archives: { master: {}, quick: {} } };
    lastSnapshot = clone(snap, snap);
    applySnapshot(snap);

    // No esperamos fotografías para entregar el workspace. Se cargan en segundo plano
    // con concurrencia limitada y errores aislados por expediente.
    if (options.hydrateMedia !== false) {
      setTimeout(() => { primeReceptionThumbnails(remoteReceptions).catch(error => console.warn('Carga visual de miniaturas incompleta', error)); }, 0);
    }
    return snap;
  }

  function desiredState(rec) {
    if (rec?.deletedAt) return 'TRASH';
    if (rec?.archivedAt) return 'ARCHIVED';
    return 'ACTIVE';
  }

  function receptionFingerprint(rec) {
    let text = '';
    try { text = JSON.stringify(rec || {}); } catch { text = String(rec?.id || rec?.number || ''); }
    let h = 2166136261 >>> 0;
    const step = Math.max(1, Math.floor(text.length / 12000));
    for (let i = 0; i < text.length; i += step) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return `${h.toString(36)}:${text.length}`;
  }

  async function syncReception(rec) {
    if (!rec || !rec.id) throw new Error('Expediente local inválido.');
    const prepared = replaceKnownMediaWithRefs(clone(rec, {}), rec);
    const expectedVersion = Number(rec?._storage?.version || 0);
    const payload = { expediente: prepared };
    if (expectedVersion > 0) payload.expectedVersion = expectedVersion;
    const result = await request('saveReceptionBundle', payload);
    if (result?.conflict) throw new Error(`Conflicto de versión en ${rec.number || rec.id}. Recargue la información antes de guardar.`);
    if (result?.expediente) pairMediaTrees(rec, result.expediente, result.expediente);
    return result;
  }

  function recIdentity(rec) {
    return String(rec?.number || rec?._storage?.folderId || rec?.id || '');
  }
  function patchSnapshotAfterBundle(snap, localRec, result) {
    if (!snap || !localRec || !result?.ok) return;
    const oldId = String(localRec.id || '');
    const oldNumber = String(localRec.number || '');
    localRec.id = result.id || localRec.id;
    localRec.number = result.number || localRec.number;
    localRec._storage = { ...(localRec._storage || {}), ...(result.expediente?._storage || {}),
      state: result.state || localRec?._storage?.state, folderId: result.folderId || localRec?._storage?.folderId,
      mediaFolderId: result.mediaFolderId || localRec?._storage?.mediaFolderId, version: Number(result.version || localRec?._storage?.version || 0), updatedAt: result.updatedAt || new Date().toISOString() };
    if (snap.appState?.selectedId === oldId) snap.appState.selectedId = localRec.id;
    if (snap.appState?.config && result.nextReceptionNumber) snap.appState.config.nextReceptionNumber = Number(result.nextReceptionNumber);
    for (const vehicle of (snap.employeeState?.vehicles || [])) {
      if (String(vehicle.rec || '') === oldNumber || String(vehicle.id || '') === String(localRec.employeeMeta?.id || '')) vehicle.rec = localRec.number;
    }
  }

  async function reconcileLifecycle(rec, entry) {
    if (!entry) return null;
    const wanted = desiredState(rec);
    let current = entry;
    if (wanted === 'TRASH') {
      if (current.state !== 'TRASH') {
        const moved = await request('trashReception', { id: current.id });
        current = moved.entry || { ...current, state: 'TRASH' };
      }
      return current;
    }
    if (wanted === 'ARCHIVED') {
      if (current.state === 'TRASH') {
        const restored = await request('restoreReception', { id: current.id });
        current = restored.entry || current;
      }
      if (current.state === 'ACTIVE') {
        const archived = await request('archiveReception', { id: current.id });
        current = archived.entry || { ...current, state: 'ARCHIVED' };
      }
      return current;
    }
    // ACTIVE
    if (current.state === 'TRASH') {
      const restored = await request('restoreReception', { id: current.id });
      current = restored.entry || current;
    }
    if (current.state === 'ARCHIVED') {
      const activated = await request('activateReception', { id: current.id, employeeId: rec.employeeId || current.employeeId || '' });
      current = activated.entry || { ...current, state: 'ACTIVE' };
    }
    return current;
  }

  async function syncSnapshotToDrive(snap, previousSnapshot = null) {
    if (!hasSession()) throw new Error('Falta iniciar una sesión segura con el backend V4.');
    const prevList = previousSnapshot?.appState?.receptions || [];
    const prevByIdentity = new Map();
    prevList.forEach(rec => {
      [recIdentity(rec), String(rec?.id || ''), String(rec?.number || '')].filter(Boolean).forEach(k => prevByIdentity.set(k, rec));
    });
    const allReceptions = Array.isArray(snap?.appState?.receptions) ? snap.appState.receptions : [];
    const currentSession = session();
    const receptions = currentSession?.role === 'employee'
      ? allReceptions.filter(rec => cleanEmployeeId(rec.employeeId) === cleanEmployeeId(currentSession.employeeId))
      : allReceptions;
    const results = [];

    for (const rec of receptions) {
      const previous = prevByIdentity.get(recIdentity(rec)) || prevByIdentity.get(String(rec.id || '')) || prevByIdentity.get(String(rec.number || '')) || null;
      const contentChanged = !previous || receptionFingerprint(previous) !== receptionFingerprint(rec);
      let result = null;
      if (contentChanged) {
        result = await syncReception(rec);
        results.push(result);
        patchSnapshotAfterBundle(snap, rec, result);
      }
      const wanted = desiredState(rec);
      const knownState = String(result?.state || rec?._storage?.state || 'ACTIVE');
      if (wanted === 'TRASH' && knownState !== 'TRASH') await request('trashReception', { id: rec.number || rec.id });
      else if (wanted === 'ARCHIVED' && knownState !== 'ARCHIVED') {
        if (knownState === 'TRASH') await request('restoreReception', { id: rec.number || rec.id });
        await request('archiveReception', { id: rec.number || rec.id });
      } else if (wanted === 'ACTIVE' && knownState !== 'ACTIVE') {
        if (knownState === 'TRASH') await request('restoreReception', { id: rec.number || rec.id });
        if (knownState === 'ARCHIVED') await request('activateReception', { id: rec.number || rec.id, employeeId: rec.employeeId || '' });
      }
    }

    const purgeNumbers = new Set((snap?.appState?.deletedReceptionNumbers || []).map(v => String(v || '').trim()).filter(Boolean));
    for (const number of purgeNumbers) {
      try { await request('trashReception', { id: number }); } catch {}
      try {
        await request('purgeReception', { id: number, confirm: 'DELETE_FOREVER' });
      } catch (error) {
        // Una cola heredada puede contener un número que ya fue purgado en una ejecución anterior.
        // Ese caso es idempotente: no debe bloquear todos los guardados futuros.
        const msg=String(error?.message||error||'').toLowerCase();
        if(!/(no existe|no se encontr|not found|inexistente)/.test(msg))throw error;
      }
      if(snap?.appState){
        snap.appState.deletedReceptionNumbers=(snap.appState.deletedReceptionNumbers||[]).filter(v=>String(v||'').trim()!==number);
        if(!Array.isArray(snap.appState.reservedReceptionNumbers))snap.appState.reservedReceptionNumbers=[];
        if(!snap.appState.reservedReceptionNumbers.includes(number))snap.appState.reservedReceptionNumbers.push(number);
      }
    }
    return results;
  }


  function requireDriveReady() {
    const state = connectionState();
    if (!state.endpointConfigured) throw new Error('No hay URL de backend configurada.');
    if (!state.hasSession) throw new Error('No hay una sesión válida con Drive. Vuelva a iniciar sesión en este dispositivo.');
    return state;
  }
  function fetchLatest() {
    requireDriveReady();
    return loadRemoteSnapshot({ hydrateMedia: true });
  }
  function loadLatest() { return fetchLatest(); }
  async function ready() {
    requireDriveReady();
    return loadRemoteSnapshot({ hydrateMedia: true });
  }
  function rollbackToConfirmed() {
    if (!lastSnapshot) return false;
    try { applySnapshot(clone(lastSnapshot, lastSnapshot)); return true; } catch { return false; }
  }

  function saveNow(reason = 'drive-v4', fixedSnapshot = null) {
    // Una falla anterior no debe envenenar para siempre la cola de guardado.
    saveTail = saveTail.catch(() => undefined).then(async () => {
      requireDriveReady();
      const fixed = fixedSnapshot ? clone(fixedSnapshot, {}) : snapshot();
      const previous = clone(lastSnapshot, null);
      try {
        await syncSnapshotToDrive(fixed, previous);
        fixed.exportedAt = fixed.exportedAt || new Date().toISOString();
        lastSnapshot = clone(fixed, fixed);
        applySnapshot(fixed);
        return { ok: true, mode: 'drive-v4', reason, exportedAt: fixed.exportedAt, remote: true, confirmedByServer: true };
      } catch (error) {
        // Drive es la fuente de verdad. Nunca convertir un fallo remoto en éxito local.
        if (previous) {
          lastSnapshot = clone(previous, previous);
          try { applySnapshot(previous); } catch {}
        }
        throw error;
      }
    });
    return saveTail;
  }

  function receptionMatchesTarget(rec, target) {
    if (!rec || !target) return false;
    const t = typeof target === 'object' ? target : { id: target, number: target };
    const targetNumber = String(t.number || t.rec || '').trim();
    const targetId = String(t.id || '').trim();
    const targetFolder = String(t?._storage?.folderId || t.folderId || '').trim();
    if (targetNumber && String(rec.number || '').trim() === targetNumber) return true;
    if (targetFolder && String(rec?._storage?.folderId || '').trim() === targetFolder) return true;
    if (targetId && String(rec.id || '').trim() === targetId) return true;
    return false;
  }

  function patchLiveReceptionMeta(target, result) {
    if (!result?.ok || !window.AM_SIMPLE_STORE?.mutate) return;
    window.AM_SIMPLE_STORE.mutate((state) => {
      const rec = (state.receptions || []).find((item) => receptionMatchesTarget(item, target));
      if (!rec) return;
      const oldId = rec.id;
      rec.id = result.id || rec.id;
      rec.number = result.number || rec.number;
      rec._storage = {
        ...(rec._storage || {}),
        ...(result.expediente?._storage || {}),
        state: result.state || rec?._storage?.state || 'ACTIVE',
        folderId: result.folderId || rec?._storage?.folderId || '',
        mediaFolderId: result.mediaFolderId || rec?._storage?.mediaFolderId || '',
        version: Number(result.version || result.expediente?._storage?.version || rec?._storage?.version || 0),
        updatedAt: result.updatedAt || result.expediente?._storage?.updatedAt || new Date().toISOString()
      };
      if (result.expediente?.clientToken) rec.clientToken = result.expediente.clientToken;
      if (result.expediente?.trackingToken) rec.trackingToken = result.expediente.trackingToken;
      if (state.selectedId === oldId) state.selectedId = rec.id;
      if (state.config && result.nextReceptionNumber) state.config.nextReceptionNumber = Number(result.nextReceptionNumber);
    }, { markLocalWrite: false });
  }

  function patchLastSnapshotReception(target, savedRec, result) {
    const baseline = lastSnapshot ? clone(lastSnapshot, lastSnapshot) : snapshot();
    if (!baseline?.appState) return;
    if (!Array.isArray(baseline.appState.receptions)) baseline.appState.receptions = [];
    const pos = baseline.appState.receptions.findIndex((item) => receptionMatchesTarget(item, target) || receptionMatchesTarget(item, savedRec));
    const copy = clone(savedRec, {});
    if (result?.ok) {
      copy.id = result.id || copy.id;
      copy.number = result.number || copy.number;
      copy._storage = {
        ...(copy._storage || {}),
        ...(result.expediente?._storage || {}),
        state: result.state || copy?._storage?.state || 'ACTIVE',
        folderId: result.folderId || copy?._storage?.folderId || '',
        mediaFolderId: result.mediaFolderId || copy?._storage?.mediaFolderId || '',
        version: Number(result.version || result.expediente?._storage?.version || copy?._storage?.version || 0),
        updatedAt: result.updatedAt || result.expediente?._storage?.updatedAt || new Date().toISOString()
      };
    }
    if (pos >= 0) baseline.appState.receptions[pos] = copy;
    else baseline.appState.receptions.push(copy);
    if (baseline.appState.config && result?.nextReceptionNumber) baseline.appState.config.nextReceptionNumber = Number(result.nextReceptionNumber);
    baseline.exportedAt = result?.updatedAt || new Date().toISOString();
    lastSnapshot = baseline;
  }

  /**
   * Guarda un solo expediente. Se usa para operaciones del ADMIN que modifican
   * únicamente el vehículo seleccionado (por ejemplo publicar seguimiento).
   * Evita recorrer y reescribir expedientes ajenos a la operación.
   */
  function saveReceptionNow(target, reason = 'targeted-reception-save') {
    saveTail = saveTail.catch(() => undefined).then(async () => {
      requireDriveReady();
      const fixed = snapshot();
      const list = Array.isArray(fixed?.appState?.receptions) ? fixed.appState.receptions : [];
      const rec = list.find((item) => receptionMatchesTarget(item, target));
      if (!rec) throw new Error('No se encontró el expediente seleccionado para guardar.');
      const previousBaseline = lastSnapshot?.appState?.receptions?.find((item) => receptionMatchesTarget(item, target)) || null;
      try {
        const result = await syncReception(rec);
        if (!result?.ok) throw new Error(result?.error || 'El servidor no confirmó el expediente.');
        patchSnapshotAfterBundle(fixed, rec, result);
        patchLiveReceptionMeta(target, result);
        patchLastSnapshotReception(target, rec, result);
        return {
          ok: true,
          mode: 'drive-v4',
          reason,
          remote: true,
          confirmedByServer: true,
          id: result.id,
          number: result.number,
          version: result.version,
          updatedAt: result.updatedAt,
          backupOk: result.backupOk !== false,
          backupWarning: result.backupWarning || '',
          expediente: result.expediente || null
        };
      } catch (error) {
        // Revertimos solo el expediente objetivo; nunca tocamos los otros vehículos.
        if (previousBaseline && window.AM_SIMPLE_STORE?.mutate) {
          window.AM_SIMPLE_STORE.mutate((state) => {
            const pos = (state.receptions || []).findIndex((item) => receptionMatchesTarget(item, target));
            if (pos >= 0) state.receptions[pos] = clone(previousBaseline, previousBaseline);
          }, { markLocalWrite: false });
        }
        throw error;
      }
    });
    return saveTail;
  }
  function queueSave(reason = 'auto') { return saveNow(reason); }

  function invoiceListContainsRemoteRefs(list) {
    return Array.isArray(list) && list.some(entry => isRemoteMediaRef(entry?.dataUrl));
  }
  function cacheInvoices(item, invoices, options = {}) {
    const list = clone(Array.isArray(invoices) ? invoices : [], []);
    // saveReceptionBundle devuelve el expediente ya materializado para Drive, por lo
    // que invoice.dataUrl puede ser un objeto {__amMediaFile,fileId,...}. Esa forma
    // es correcta para expediente.json, pero NO es renderizable por <img>/<button>.
    // Nunca permitimos que reemplace el cache visual hidratado del navegador.
    if (invoiceListContainsRemoteRefs(list)) {
      const existing = cachedInvoices(item);
      return clone(Array.isArray(existing) ? existing : [], []);
    }
    for (const k of keys(item)) invoiceCache.set(k, list);
    // V4.18.2: las facturas visuales viven en memoria/CacheStorage, nunca en localStorage.
    // Esto evita reintroducir el problema de cuota que V4.17 eliminó para los medios remotos.
    window.AM_V4_DATA?.clearAux?.('invoices', item);
    return clone(list, []);
  }
  function cachedInvoices(item) {
    for (const k of keys(item)) {
      if (!invoiceCache.has(k)) continue;
      const list = invoiceCache.get(k);
      if (!invoiceListContainsRemoteRefs(list)) return clone(list, []);
      invoiceCache.delete(k);
    }
    // Auxiliares heredados de versiones anteriores pueden contener imágenes grandes o
    // estados visuales viejos. Se descartan; Drive + CacheStorage son la fuente visual.
    window.AM_V4_DATA?.clearAux?.('invoices', item);
    return null;
  }
  function clearInvoiceCache(item) {
    let removed = 0;
    for (const k of keys(item)) {
      if (invoiceCache.delete(k)) removed += 1;
    }
    if (window.AM_V4_DATA?.clearAux?.('invoices', item)) removed += 1;
    return removed;
  }
  function cachePhotos(item, photos, options = {}) {
    const list = clone(Array.isArray(photos) ? photos : [], []);
    for (const k of keys(item)) {
      const old = photoCache.get(k) || [];
      const oldCount = old.filter(x => typeof x?.dataUrl === 'string' && x.dataUrl).length;
      const newCount = list.filter(x => typeof x?.dataUrl === 'string' && x.dataUrl).length;
      if (newCount >= oldCount) photoCache.set(k, list);
    }
    // V4.17: el cache visual de nube no se duplica en localStorage.
    if (options.persist !== false) window.AM_V4_DATA?.setAux?.('photos', item, list);
    return clone(list, []);
  }
  function cachedPhotos(item) {
    let best = null, bestCount = -1;
    for (const k of keys(item)) {
      const list = photoCache.get(k);
      if (Array.isArray(list)) {
        const count = list.filter(x => x?.dataUrl).length;
        if (count > bestCount) { best = list; bestCount = count; }
      }
    }
    if (best) return clone(best, []);
    const aux = window.AM_V4_DATA?.getAux?.('photos', item);
    if (Array.isArray(aux)) { for (const k of keys(item)) photoCache.set(k, aux); return clone(aux, []); }
    return null;
  }

  function dispatch(status, job = {}) {
    const detail = { status, operationId: job.operationId || `v4_${Date.now()}`, context: job.context || {}, reason: job.reason || 'v4', mode: isReady() ? 'drive-v4' : 'local-v4' };
    try { window.dispatchEvent(new CustomEvent('am-cloud-background-status', { detail })); } catch {}
    return detail;
  }
  async function enqueueBackgroundSave(reason = 'v4', options = {}) {
    if (options.snapshot) applySnapshot(options.snapshot);
    const job = { reason, context: options.context || {}, operationId: `v4_${Date.now()}` };
    try {
      await saveNow(reason, options.snapshot || null);
      dispatch('confirmed', job);
      return { status: 'confirmed', ...job };
    } catch (error) {
      dispatch('error', { ...job, error: String(error?.message || error) });
      throw error;
    }
  }
  async function processBackgroundOutbox() { requireDriveReady(); return 'confirmed'; }
  async function retryBackgroundSave(options = {}) { return enqueueBackgroundSave(options.reason || 'retry', options); }
  async function backgroundStatus() { const state = connectionState(); return { status: state.ready ? 'confirmed' : 'error', mode: 'drive-v4', ...state }; }

  async function loadIndex() { return request('loadIndex', {}); }
  async function loadReception(id) { return request('loadReception', { id }); }
  async function archiveReception(id) { return request('archiveReception', { id }); }
  async function trashReception(id) { return request('trashReception', { id }); }
  async function restoreReception(id) { return request('restoreReception', { id }); }
  async function activateReception(id, employeeId = '') { return request('activateReception', { id, employeeId }); }
  async function pruneMedia(id) { return request('pruneMedia', { id }); }
  async function purgeReception(id, confirm = 'DELETE_FOREVER') { return request('purgeReception', { id, confirm }); }
  async function publicClient(token) { return request('publicClient', { token }, { public: true }); }
  async function publicTracking(token) { return request('publicTracking', { token }, { public: true }); }
  async function publicAuthorize(token, evidence = {}) { return request('publicAuthorize', { token, evidence }, { public: true }); }
  async function publicAcknowledgePhotos(token, evidence = {}) { return request('publicAcknowledgePhotos', { token, evidence }, { public: true }); }
  async function publicConfirmTrackingRequest(token, rowIndex, type, confirmedLabel = '', evidence = {}) {
    return request('publicConfirmTrackingRequest', { token, rowIndex, type, confirmedLabel, evidence }, { public: true });
  }
  async function loadPublicSnapshot(type, token) {
    type = type === 'client' ? 'client' : 'tracking';
    const response = type === 'client' ? await publicClient(token) : await publicTracking(token);
    let rec = clone(response.expediente, {});
    rec = await hydrateRemoteMedia(rec, new Map(), { public: true, token, type });
    if (type === 'client') rec.clientToken = token;
    else rec.trackingToken = token;
    const local = window.AM_V4_DATA?.readAdminState?.() || {};
    const appState = {
      ...local,
      receptions: [rec],
      selectedId: rec.id || null
    };
    const snap = { version: 4, exportedAt: rec.updatedAt || new Date().toISOString(), appState, employeeState: null, archives: { master: {}, quick: {} } };
    // Las vistas públicas viven solo en memoria: no persistimos datos de clientes en localStorage.
    globalThis.__AM_PUBLIC_RECEPTION__ = rec;
    return snap;
  }

  return {
    config, saveConfig, isReady, hasSession, session, sessionMatches, setSession, clearSession, activateSession, connectionState, rollbackToConfirmed,
    ping, request, loginAdmin, loginEmployee, logout, configureCredentials,
    snapshot, saveNow, saveReceptionNow, queueSave, fetchLatest, applySnapshot, loadLatest, ready,
    enqueueBackgroundSave, processBackgroundOutbox, retryBackgroundSave, backgroundStatus,
    cacheInvoices, cachedInvoices, clearInvoiceCache, cachePhotos, cachedPhotos, cachedThumbnail, thumbnailStatus, ensureReceptionThumbnail, ensureReceptionPhotos, ensureReceptionInvoices, forgetMediaRefs, purgeLocalReceptionCaches,
    loadIndex, loadReception, archiveReception, trashReception, restoreReception, activateReception, pruneMedia, purgeReception,
    publicClient, publicTracking, publicAuthorize, publicAcknowledgePhotos, publicConfirmTrackingRequest, loadPublicSnapshot,
    _integrationStage: 'stage4.18-integrity', _build: BUILD
  };
})();
