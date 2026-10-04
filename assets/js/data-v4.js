/* Automotriz Medina V4 - almacenamiento local normalizado.
   Esta capa NO realiza ninguna petición de red ni conoce URLs de Apps Script.
   Mantiene un expediente por vehículo y separa cualquier media (imagen/video/firma)
   del JSON del expediente. Está diseñada para que luego el mismo contrato se conecte
   a Google Drive sin cambiar las pantallas. */
(function (global) {
  'use strict';

  const nativeGetItem = Storage.prototype.getItem;
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;
  const nativeKey = Storage.prototype.key;

  const CATALOG_KEY = 'am_v4_catalog_v1';
  const EXP_PREFIX = 'am_v4_expediente_v1:';
  const MEDIA_PREFIX = 'am_v4_media_v1:';
  const TOKEN_KEY = 'am_v4_tokens_v1';
  const AUX_PREFIX = 'am_v4_aux_v2:';
  const LEGACY_ADMIN_KEY = 'am_recepción_local_v1';
  const LEGACY_EMPLOYEE_KEY = 'am_employee_module_safe_v2';
  const ARCHIVE_KEYS = new Set(['am_master_taller_archives_v1', 'am_quick_taller_archives_v1']);
  const REQUIRED_PHOTOS = ['Frente', 'Frente de tarjeta', 'Reverso de tarjeta'];
  const BASE_INVENTORY = ['Herramientas', 'Llanta de repuesto', 'Mica', 'Llave de ruedas', 'Documentos', 'Radio/Pantalla', 'Extintor', 'Cono / triángulo', 'Objetos personales'];

  function rawGet(key) { return nativeGetItem.call(localStorage, key); }
  function rawSet(key, value) { return nativeSetItem.call(localStorage, key, String(value)); }
  function rawRemove(key) { return nativeRemoveItem.call(localStorage, key); }
  function clone(value, fallback = null) {
    try { return value == null ? fallback : JSON.parse(JSON.stringify(value)); } catch { return fallback; }
  }
  function parse(raw, fallback) { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
  function now() { return new Date().toISOString(); }
  function cleanId(value) { return String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '_'); }
  function token() {
    const bytes = new Uint8Array(16);
    if (global.crypto?.getRandomValues) {
      global.crypto.getRandomValues(bytes);
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function defaults() {
    return {
      version: 4,
      updatedAt: now(),
      config: { schemaVersion: 3, businessName: 'Automotriz Medina', adminPin: '', employeeToken: '', nextReceptionNumber: 1 },
      employees: [
        { id: 'edwin', name: 'Edwin', token: '' },
        { id: 'rafael', name: 'Rafael', token: '' },
        { id: 'cristian', name: 'Cristian', token: '' }
      ],
      session: { admin: true, employee: true },
      selectedId: null,
      sequence: { reception: 0, damage: 0, update: 0, inventory: 0 },
      receptionOrder: [],
      deletedReceptionNumbers: [],
      reservedReceptionNumbers: [],
      employeeNotifications: []
    };
  }
  function readCatalog() {
    const base = defaults();
    const current = parse(rawGet(CATALOG_KEY), null);
    if (!current || typeof current !== 'object') return base;
    return {
      ...base,
      ...current,
      config: { ...base.config, ...(current.config || {}), schemaVersion: 3 },
      session: { ...base.session, ...(current.session || {}) },
      sequence: { ...base.sequence, ...(current.sequence || {}) },
      employees: Array.isArray(current.employees) ? current.employees : base.employees,
      receptionOrder: Array.isArray(current.receptionOrder) ? current.receptionOrder : [],
      deletedReceptionNumbers: Array.isArray(current.deletedReceptionNumbers) ? current.deletedReceptionNumbers : [],
      reservedReceptionNumbers: Array.isArray(current.reservedReceptionNumbers) ? current.reservedReceptionNumbers : [],
      employeeNotifications: Array.isArray(current.employeeNotifications) ? current.employeeNotifications : []
    };
  }
  function writeCatalog(catalog) {
    const next = { ...catalog, version: 4, updatedAt: now() };
    rawSet(CATALOG_KEY, JSON.stringify(next));
    return next;
  }
  function isMediaData(value) {
    return typeof value === 'string' && /^data:(?:image|video)\//i.test(value);
  }
  function mediaHash(value) {
    // Suficiente para desduplicación local; Drive usará IDs reales en la siguiente etapa.
    let h1 = 2166136261 >>> 0;
    const len = value.length;
    const step = Math.max(1, Math.floor(len / 4096));
    for (let i = 0; i < len; i += step) {
      h1 ^= value.charCodeAt(i);
      h1 = Math.imul(h1, 16777619) >>> 0;
    }
    return `${h1.toString(36)}_${len.toString(36)}`;
  }
  function putMedia(data, used) {
    // El hash permite reutilizar exactamente el mismo archivo; si dos archivos distintos
    // coincidieran en el hash, jamás se sobreescribe uno con el otro.
    const baseId = mediaHash(data);
    let id = baseId;
    let key = MEDIA_PREFIX + id;
    let existing = rawGet(key);
    let collision = 0;
    while (existing != null && existing !== data) {
      collision += 1;
      id = `${baseId}_${collision}`;
      key = MEDIA_PREFIX + id;
      existing = rawGet(key);
    }
    if (existing !== data) rawSet(key, data);
    used?.add(id);
    return { __amMedia: id };
  }

  function collectMediaRefs(value, refs) {
    if (Array.isArray(value)) { value.forEach(item => collectMediaRefs(item, refs)); return; }
    if (!value || typeof value !== 'object') return;
    if (value.__amMedia) { refs.add(String(value.__amMedia)); return; }
    Object.values(value).forEach(item => collectMediaRefs(item, refs));
  }
  function garbageCollectMedia() {
    const refs = new Set();
    const mediaKeys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = nativeKey.call(localStorage, i);
      if (!key) continue;
      if (key.startsWith(MEDIA_PREFIX)) { mediaKeys.push(key); continue; }
      if (key.startsWith(EXP_PREFIX) || key.startsWith(AUX_PREFIX)) {
        const value = parse(rawGet(key), null);
        if (value) collectMediaRefs(value, refs);
      }
    }
    for (const key of mediaKeys) {
      const id = key.slice(MEDIA_PREFIX.length);
      if (!refs.has(id)) rawRemove(key);
    }
  }

  function dehydrate(value, used = new Set()) {
    if (isMediaData(value)) return putMedia(value, used);
    if (Array.isArray(value)) return value.map(v => dehydrate(v, used));
    if (!value || typeof value !== 'object') return value;
    if (value.__amMedia) { used.add(String(value.__amMedia)); return value; }
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      // Bitácora fue retirada de V4. No conservar payload heredado.
      if (key === 'bitacora' || key === 'nota') continue;
      if (key === 'internalNote' && value === value) {
        // Solo se descarta cuando forma parte de internalWork; se corrige en normalizeReception.
      }
      out[key] = dehydrate(item, used);
    }
    return out;
  }
  function hydrate(value) {
    if (Array.isArray(value)) return value.map(hydrate);
    if (!value || typeof value !== 'object') return value;
    if (value.__amMedia) return rawGet(MEDIA_PREFIX + value.__amMedia) || '';
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = hydrate(item);
    return out;
  }
  function photoKey(label) {
    return String(label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }
  function invoiceListContainsRemoteRefs(list) {
    return Array.isArray(list) && list.some(item => {
      const value = item?.dataUrl;
      return !!(value && typeof value === 'object' && value.__amMediaFile === true && (value.fileId || value.path));
    });
  }
  function normalizeMainPhotos(photos) {
    const src = Array.isArray(photos) ? photos : [];
    const aliases = {
      'tarjeta frente': 'frente de tarjeta', 'frente tarjeta': 'frente de tarjeta',
      'tarjeta reverso': 'reverso de tarjeta', 'reverso tarjeta': 'reverso de tarjeta'
    };
    return REQUIRED_PHOTOS.map((label, index) => {
      const wanted = photoKey(label);
      const found = src.find(p => {
        const k = aliases[photoKey(p?.label)] || photoKey(p?.label);
        return k === wanted;
      });
      return {
        label,
        dataUrl: found?.dataUrl || '',
        note: found?.note || '',
        color: found?.color || (index % 2 === 0 ? '#206f78' : '#b52931')
      };
    });
  }
  function normalizeReception(input) {
    const rec = clone(input, {}) || {};
    if (!rec.id) rec.id = `emp-v4-${Date.now()}-${token().slice(0, 6)}`;
    if (!rec.number) rec.number = `AM-R-${String(Date.now()).slice(-4)}`;
    if (!rec.clientToken) rec.clientToken = 'cli_' + token();
    if (!rec.trackingToken) rec.trackingToken = 'trk_' + token();
    if (!rec.client || typeof rec.client !== 'object') rec.client = { name: '', phone: '' };
    if (!rec.vehicle || typeof rec.vehicle !== 'object') rec.vehicle = {};
    if (!Array.isArray(rec.inventory)) rec.inventory = [];
    if (!Array.isArray(rec.damages)) rec.damages = [];
    if (!Array.isArray(rec.invoices)) rec.invoices = [];
    if (!Array.isArray(rec.updates)) rec.updates = [];
    if (!Array.isArray(rec.employeeNotifications)) rec.employeeNotifications = [];
    rec.photos = rec.express ? (Array.isArray(rec.photos) ? rec.photos : []) : normalizeMainPhotos(rec.photos);
    if (!rec.tracking || typeof rec.tracking !== 'object') rec.tracking = {};
    const internalWork = rec.internalWork && typeof rec.internalWork === 'object' ? rec.internalWork : {};
    const rawFuelLevel = internalWork.fuelLevel;
    rec.internalWork = { ...internalWork, lockedReception: internalWork.lockedReception !== false };
    if (rawFuelLevel === '' || rawFuelLevel == null || !Number.isFinite(Number(rawFuelLevel))) delete rec.internalWork.fuelLevel;
    else rec.internalWork.fuelLevel = Math.max(0, Math.min(100, Math.round(Number(rawFuelLevel))));
    delete rec.internalWork.internalNote;
    delete rec.bitacora;
    delete rec.nota;
    if (rec.employeeMeta) {
      delete rec.employeeMeta.bitacora;
      delete rec.employeeMeta.nota;
    }
    return rec;
  }
  function expKey(id) { return EXP_PREFIX + cleanId(id); }
  function readReceptionById(id) {
    const stored = parse(rawGet(expKey(id)), null);
    return stored ? normalizeReception(hydrate(stored)) : null;
  }
  function writeReception(rec) {
    const normalized = normalizeReception(rec);
    const used = new Set();
    const dehydrated = dehydrate(normalized, used);
    const key = expKey(normalized.id);
    const json = JSON.stringify(dehydrated);
    if (rawGet(key) !== json) rawSet(key, json);
    return normalized;
  }
  function auxKey(kind, id) { return `${AUX_PREFIX}${kind}:${cleanId(id)}`; }
  function auxIdentity(recOrId) {
    if (recOrId && typeof recOrId === 'object') {
      const number = String(recOrId.number || recOrId.rec || '').trim();
      if (number) return `rec:${number}`;
      const folderId = String(recOrId?._storage?.folderId || '').trim();
      if (folderId) return `folder:${folderId}`;
      let employee = String(recOrId.employeeId || recOrId.eid || '').toLowerCase().trim();
      if (employee === 'christian') employee = 'cristian';
      const localId = String(recOrId.id || recOrId.vehicleId || '').trim();
      if (employee && localId) return `emp:${employee}:${localId}`;
      if (localId) return `id:${localId}`;
      return '';
    }
    const id = String(recOrId || '').trim();
    return id ? `id:${id}` : '';
  }
  function auxIdentities(recOrId) {
    const ids = [];
    const add = (value) => { const v=String(value||'').trim(); if(v && !ids.includes(v)) ids.push(v); };
    if (recOrId && typeof recOrId === 'object') {
      const number=String(recOrId.number||recOrId.rec||'').trim(); if(number)add(`rec:${number}`);
      const folderId=String(recOrId?._storage?.folderId||recOrId.folderId||'').trim(); if(folderId)add(`folder:${folderId}`);
      let employee=String(recOrId.employeeId||recOrId.eid||'').toLowerCase().trim(); if(employee==='christian')employee='cristian';
      const localId=String(recOrId.id||recOrId.vehicleId||'').trim();
      if(employee&&localId)add(`emp:${employee}:${localId}`);
      if(localId){add(`id:${localId}`); add(`id:${localId.replace(/^emp-/,'')}`);}
    } else {
      const id=String(recOrId||'').trim(); if(id)add(`id:${id}`);
    }
    return ids;
  }
  function purgeLocalReceptionResidue(rec) {
    if (!rec) return { removedAux:0, removedMedia:0, removedTokens:0 };
    const identities=auxIdentities(rec).map(cleanId);
    let removedAux=0;
    const keys=[];
    for(let i=0;i<localStorage.length;i++){const key=nativeKey.call(localStorage,i);if(key)keys.push(key);}
    for(const key of keys){
      if(!key.startsWith(AUX_PREFIX))continue;
      if(identities.some(id=>key.endsWith(`:${id}`))){rawRemove(key);removedAux+=1;}
    }
    const localId=String(rec.id||rec.vehicleId||'').trim();
    if(localId)rawRemove(expKey(localId));
    const tokenIndex=parse(rawGet(TOKEN_KEY),{})||{};
    let removedTokens=0;
    for(const [tok,hit] of Object.entries(tokenIndex)){
      if(tok===rec.clientToken||tok===rec.trackingToken||String(hit?.id||'')===localId){delete tokenIndex[tok];removedTokens+=1;}
    }
    rawSet(TOKEN_KEY,JSON.stringify(tokenIndex));
    const before=[]; for(let i=0;i<localStorage.length;i++){const key=nativeKey.call(localStorage,i);if(key&&key.startsWith(MEDIA_PREFIX))before.push(key);}
    garbageCollectMedia();
    let afterCount=0; for(let i=0;i<localStorage.length;i++){const key=nativeKey.call(localStorage,i);if(key&&key.startsWith(MEDIA_PREFIX))afterCount+=1;}
    return {removedAux,removedMedia:Math.max(0,before.length-afterCount),removedTokens};
  }
  function setAux(kind, recOrId, value) {
    const id = auxIdentity(recOrId);
    if (!id) return;
    const used = new Set();
    const payload = JSON.stringify(dehydrate(clone(value, []), used));
    rawSet(auxKey(kind, id), payload);
    garbageCollectMedia();
  }
  function getAux(kind, recOrId) {
    const id = auxIdentity(recOrId);
    if (!id) return null;
    const raw = rawGet(auxKey(kind, id));
    return raw ? hydrate(parse(raw, [])) : null;
  }
  function clearAux(kind, recOrId) {
    const id = auxIdentity(recOrId);
    if (!id) return false;
    rawRemove(auxKey(kind, id));
    garbageCollectMedia();
    return true;
  }
  function writeTokens(receptions) {
    const index = {};
    for (const rec of receptions) {
      if (rec.clientToken) index[rec.clientToken] = { id: rec.id, type: 'client' };
      if (rec.trackingToken) index[rec.trackingToken] = { id: rec.id, type: 'tracking' };
    }
    rawSet(TOKEN_KEY, JSON.stringify(index));
  }
  function readAdminState() {
    const c = readCatalog();
    const receptions = [];
    for (const id of c.receptionOrder) {
      const rec = readReceptionById(id);
      if (rec) {
        const storedInvoices = Array.isArray(rec.invoices) ? rec.invoices : [];
        const cachedInvoices = getAux('invoices', rec);
        // V4.16: el auxiliar visual NUNCA puede crear facturas por sí solo.
        // Si expediente.json dice que no hay facturas, ese estado es autoritativo y
        // cualquier cache heredado del mismo número de recepción se descarta.
        if (!storedInvoices.length) {
          if (Array.isArray(cachedInvoices) && cachedInvoices.length) clearAux('invoices', rec);
          rec.invoices = [];
        } else if (Array.isArray(cachedInvoices) && cachedInvoices.length && !invoiceListContainsRemoteRefs(cachedInvoices)) {
          // El cache solo sirve para renderizar facturas que YA existen en el expediente.
          rec.invoices = cachedInvoices;
        }
        const cachedPhotos = getAux('photos', rec);
        const hasOwnPhotos = Array.isArray(rec.photos) && rec.photos.some(photo => photo?.dataUrl);
        if (!hasOwnPhotos && Array.isArray(cachedPhotos) && cachedPhotos.length) rec.photos = rec.express ? cachedPhotos : normalizeMainPhotos(cachedPhotos);
        receptions.push(rec);
      }
    }
    return {
      config: clone(c.config, {}), employees: clone(c.employees, []), session: clone(c.session, {}),
      selectedId: c.selectedId || null, sequence: clone(c.sequence, {}), receptions,
      deletedReceptionNumbers: clone(c.deletedReceptionNumbers, []), reservedReceptionNumbers: clone(c.reservedReceptionNumbers, []), employeeNotifications: clone(c.employeeNotifications, [])
    };
  }
  function writeAdminState(state) {
    const current = readCatalog();
    const incoming = state && typeof state === 'object' ? state : {};
    const receptions = (Array.isArray(incoming.receptions) ? incoming.receptions : []).map(normalizeReception);
    const existingNumbers = new Set((current.receptionOrder || []).map(id => String(readReceptionById(id)?.number || '').trim()).filter(Boolean));
    const order = [];
    for (const source of receptions) {
      const number = String(source.number || '').trim();
      const isNewReceptionNumber = !!number && !existingNumbers.has(number);
      // V4.16: un número reutilizado empieza con cache de facturas limpio.
      // La cache es solo una ayuda visual, nunca una fuente de datos para una recepción nueva.
      if (isNewReceptionNumber) {
        clearAux('invoices', source);
        if (!Array.isArray(source.invoices)) source.invoices = [];
      }
      const cachedPhotos = getAux('photos', source);
      if ((!Array.isArray(source.photos) || !source.photos.some(p => p?.dataUrl)) && Array.isArray(cachedPhotos) && cachedPhotos.length) source.photos = source.express ? cachedPhotos : normalizeMainPhotos(cachedPhotos);
      const rec = writeReception(source);
      order.push(rec.id);
    }
    // Expedientes que dejan de existir se retiran del almacenamiento local de prueba.
    // También se eliminan sus auxiliares visuales para que un número reutilizado no
    // herede fotografías o facturas de un expediente anterior.
    for (const oldId of current.receptionOrder || []) {
      if (!order.includes(oldId)) {
        const oldRec = readReceptionById(oldId);
        if (oldRec) purgeLocalReceptionResidue(oldRec);
        else rawRemove(expKey(oldId));
      }
    }
    const next = writeCatalog({
      ...current,
      config: { ...current.config, ...(incoming.config || {}), schemaVersion: 3 },
      employees: Array.isArray(incoming.employees) ? incoming.employees : current.employees,
      session: { ...current.session, ...(incoming.session || {}) },
      selectedId: incoming.selectedId ?? current.selectedId ?? null,
      sequence: { ...current.sequence, ...(incoming.sequence || {}) },
      receptionOrder: order,
      deletedReceptionNumbers: Array.isArray(incoming.deletedReceptionNumbers) ? incoming.deletedReceptionNumbers : current.deletedReceptionNumbers,
      reservedReceptionNumbers: Array.isArray(incoming.reservedReceptionNumbers) ? incoming.reservedReceptionNumbers : current.reservedReceptionNumbers,
      employeeNotifications: Array.isArray(incoming.employeeNotifications) ? incoming.employeeNotifications : current.employeeNotifications
    });
    writeTokens(receptions);
    garbageCollectMedia();
    try { global.dispatchEvent(new CustomEvent('am-v4-data-change', { detail: { updatedAt: next.updatedAt } })); } catch {}
    return true;
  }
  function employeeFromReception(rec) {
    const meta = rec.employeeMeta || {};
    const pending = rec.pendingTracking && rec.pendingTracking.status === 'pending' ? rec.pendingTracking : null;
    const detailText = pending?.processDetails ?? meta.detalle ?? '';
    const detailRows = Array.isArray(meta.detalles) ? meta.detalles : String(detailText || '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    const detailImages = pending?.images ?? meta.detalleImages ?? [];
    return {
      id: meta.id || String(rec.id || '').replace(/^emp-/, '') || `v-${token().slice(0, 8)}`,
      rec: rec.number || '',
      eid: rec.employeeId || meta.eid || 'edwin',
      en: rec.employeeName || meta.en || 'EDWIN',
      fecha: meta.fecha || String(rec.receptionDate || '').slice(0, 10) || '',
      hora: meta.hora || '',
      marca: rec.vehicle?.marca || '', modelo: rec.vehicle?.modelo || '', anio: rec.vehicle?.anio || '', color: rec.vehicle?.color || '',
      vin: rec.vehicle?.vin || '', placa: rec.vehicle?.placa || '', odometro: rec.vehicle?.kilometraje || '', unidad: meta.unidad || rec.vehicle?.kilometrajeUnidad || 'mi',
      estado: rec.status || rec.progressLabel || rec.tracking?.state || 'EN REVISIÓN', avance: Number(rec.progress || 0), autorizado: !!rec.signed,
      motivo: rec.serviceReason || '', observaciones: rec.observations || '', detalle: detailRows.join('\n'), detalles: clone(detailRows, []), detalleImages: clone(detailImages, []),
      deadline: rec.employeeDeadline || meta.deadline || '', deadlineSetAt: rec.employeeDeadlineSetAt || meta.deadlineSetAt || '',
      deadlineTokensAvailable: Number(rec.employeeDeadlineTokensAvailable ?? meta.deadlineTokensAvailable ?? 3),
      deadlineTokensUsed: Number(rec.employeeDeadlineTokensUsed ?? meta.deadlineTokensUsed ?? 0),
      deadlineUnlockRequested: !!(rec.employeeDeadlineUnlockRequested || meta.deadlineUnlockRequested),
      photos: clone(rec.photos, []), inventory: clone(rec.inventory, []), damages: clone(rec.damages, []), invoices: clone(rec.invoices, []),
      fuelLevel: rec.internalWork?.fuelLevel ?? null,
      notifications: clone(rec.employeeNotifications, []), pendingTracking: clone(rec.pendingTracking, null),
      express: !!rec.express, tipoServicio: rec.serviceType || meta.tipoServicio || '', cloudStatus: 'confirmed', cloudMessage: 'Guardado local V4',
      signatureDataUrl: rec.signatureDataUrl || '', authorizationEvidence: clone(rec.authorizationEvidence, null),
      finalization: clone(rec.finalization, null), finalizationPublishedAt: rec.finalizationPublishedAt || '', archivedAt: rec.archivedAt || '', deletedAt: rec.deletedAt || ''
    };
  }
  function employeeState() {
    const admin = readAdminState();
    const vehicles = admin.receptions.map(employeeFromReception);
    let selected = '';
    try { selected = sessionStorage.getItem('am_employee_selected_vehicle_v1') || ''; } catch {}
    return { selected, seq: Math.max(0, ...vehicles.map(v => Number(String(v.id || '').replace(/\D/g, '')) || 0)), vehicles };
  }
  function mergeVehicleIntoReception(rec, v) {
    rec = normalizeReception(rec || {});
    rec.number = v.rec || rec.number;
    rec.express = !!v.express;
    rec.serviceType = v.tipoServicio || rec.serviceType || '';
    rec.employeeId = v.eid || rec.employeeId || 'edwin';
    rec.employeeName = v.en || rec.employeeName || String(rec.employeeId).toUpperCase();
    rec.status = v.estado || rec.status || 'EN REVISIÓN';
    rec.progress = Number(v.avance ?? rec.progress ?? 0);
    rec.progressLabel = rec.status;
    rec.signed = v.express ? false : (!!v.autorizado || !!rec.signed);
    rec.serviceReason = v.motivo ?? rec.serviceReason ?? '';
    rec.observations = v.observaciones ?? rec.observations ?? '';
    rec.vehicle = { ...(rec.vehicle || {}), marca: v.marca || '', modelo: v.modelo || '', anio: v.anio || '', color: v.color || '', placa: v.placa || '', vin: v.vin || '', kilometraje: v.odometro || '', kilometrajeUnidad: v.unidad || 'mi' };
    if (Array.isArray(v.photos)) rec.photos = v.express ? clone(v.photos, []) : normalizeMainPhotos(v.photos);
    if (Array.isArray(v.inventory)) rec.inventory = clone(v.inventory, []);
    if (Array.isArray(v.damages)) rec.damages = clone(v.damages, []);
    if (Array.isArray(v.invoices)) rec.invoices = clone(v.invoices, []);
    if (Array.isArray(v.notifications)) rec.employeeNotifications = clone(v.notifications, []);
    rec.employeeDeadline = v.deadline || '';
    rec.employeeDeadlineSetAt = v.deadlineSetAt || '';
    rec.employeeDeadlineTokensAvailable = Number(v.deadlineTokensAvailable ?? 3);
    rec.employeeDeadlineTokensUsed = Number(v.deadlineTokensUsed ?? 0);
    rec.employeeDeadlineUnlockRequested = !!v.deadlineUnlockRequested;
    rec.employeeMeta = {
      ...(rec.employeeMeta || {}), id: v.id || rec.employeeMeta?.id || '', fecha: v.fecha || '', hora: v.hora || '', unidad: v.unidad || 'mi',
      detalles: clone(v.detalles, []), detalle: v.detalle || '', detalleImages: clone(v.detalleImages, []), tipoServicio: v.tipoServicio || ''
    };
    delete rec.employeeMeta.bitacora;
    delete rec.employeeMeta.nota;
    if (v.pendingTracking) rec.pendingTracking = clone(v.pendingTracking, null);
    if (v.signatureDataUrl) rec.signatureDataUrl = v.signatureDataUrl;
    if (v.authorizationEvidence) rec.authorizationEvidence = clone(v.authorizationEvidence, null);
    rec.tracking = {
      ...(rec.tracking || {}),
      receptionDate: [v.fecha, v.hora].filter(Boolean).join(', ') || rec.tracking?.receptionDate || '',
      odometer: (v.odometro || rec.vehicle.kilometraje || 'N/D') + ' ' + (v.unidad === 'km' ? 'KM' : 'MILLAS'),
      plate: v.placa || rec.tracking?.plate || 'N/D', vehicleTitle: [v.marca, v.modelo, v.anio].filter(Boolean).join(' ').trim().toUpperCase(),
      state: rec.tracking?.state || v.estado || 'EN REVISIÓN', processDetails: rec.tracking?.processDetails || ''
    };
    rec.internalWork = { ...(rec.internalWork || {}), lockedReception: true };
    if (v.fuelLevel === '' || v.fuelLevel == null || !Number.isFinite(Number(v.fuelLevel))) delete rec.internalWork.fuelLevel;
    else rec.internalWork.fuelLevel = Math.max(0, Math.min(100, Math.round(Number(v.fuelLevel))));
    return normalizeReception(rec);
  }
  function writeEmployeeState(s) {
    const employee = s && typeof s === 'object' ? s : { selected: '', seq: 0, vehicles: [] };
    const admin = readAdminState();
    const byNumber = new Map(admin.receptions.map(rec => [String(rec.number || ''), rec]));
    const byId = new Map(admin.receptions.map(rec => [String(rec.id || '').replace(/^emp-/, ''), rec]));
    const reservedNumbers = new Set([...(admin.reservedReceptionNumbers || []), ...(admin.deletedReceptionNumbers || [])].map(v=>String(v||'').trim()).filter(Boolean));
    for (const v of (Array.isArray(employee.vehicles) ? employee.vehicles : [])) {
      let rec = byNumber.get(String(v.rec || '')) || byId.get(String(v.id || ''));
      if (!rec && reservedNumbers.has(String(v.rec || '').trim())) continue;
      let index = rec ? admin.receptions.indexOf(rec) : -1;
      if (!rec) {
        rec = normalizeReception({
          id: `emp-${v.id || `v4-${token().slice(0, 8)}`}`, number: v.rec || '', clientToken: 'cli_' + token(), trackingToken: 'trk_' + token(),
          client: { name: '', phone: '' }, employeeId: v.eid || 'edwin', employeeName: v.en || 'EDWIN', vehicle: {}, photos: [], inventory: [], damages: [], invoices: [], tracking: {}, updates: []
        });
        admin.receptions.unshift(rec);
        index = 0;
      }
      const merged = mergeVehicleIntoReception(rec, v);
      admin.receptions[index] = merged;
      byNumber.set(String(merged.number || ''), merged);
      byId.set(String(merged.id || '').replace(/^emp-/, ''), merged);
    }
    writeAdminState(admin);
    try {
      if (employee.selected) sessionStorage.setItem('am_employee_selected_vehicle_v1', employee.selected);
      else sessionStorage.removeItem('am_employee_selected_vehicle_v1');
    } catch {}
    return true;
  }
  function snapshot() { return { version: 4, exportedAt: now(), appState: readAdminState(), employeeState: employeeState(), archives: { master: {}, quick: {} } }; }
  function restoreSnapshot(snap) {
    if (snap?.appState) writeAdminState(snap.appState);
    else if (snap?.employeeState) writeEmployeeState(snap.employeeState);
    return snapshot();
  }
  function findReceptionByToken(value, key) {
    if (!value) return null;
    const idx = parse(rawGet(TOKEN_KEY), {});
    const hit = idx[value];
    if (hit?.id) {
      const rec = readReceptionById(hit.id);
      if (rec && (!key || rec[key] === value || rec.photoAcknowledgementEvidence?.token === value)) return rec;
    }
    return readAdminState().receptions.find(rec => rec[key] === value || (key === 'clientToken' && rec.photoAcknowledgementEvidence?.token === value)) || null;
  }
  function resetAll() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = nativeKey.call(localStorage, i);
      if (k && (k === CATALOG_KEY || k === TOKEN_KEY || k.startsWith(EXP_PREFIX) || k.startsWith(MEDIA_PREFIX) || k.startsWith(AUX_PREFIX))) keys.push(k);
    }
    keys.forEach(rawRemove);
    writeCatalog(defaults());
  }

  const api = {
    requiredPhotos: REQUIRED_PHOTOS.slice(), baseInventory: BASE_INVENTORY.slice(), token,
    readAdminState, writeAdminState, employeeState, writeEmployeeState, snapshot, restoreSnapshot,
    findReceptionByToken, setAux, getAux, clearAux, purgeLocalReceptionResidue, resetAll, normalizeReception
  };
  global.AM_V4_DATA = api;

  // Capa de compatibilidad: el código visual original puede seguir pidiendo las claves viejas,
  // pero estas ya no existen físicamente como snapshots gigantes.
  Storage.prototype.getItem = function patchedGetItem(key) {
    if (this === localStorage) {
      if (key === LEGACY_ADMIN_KEY) return JSON.stringify(readAdminState());
      if (key === LEGACY_EMPLOYEE_KEY) return JSON.stringify(employeeState());
      if (ARCHIVE_KEYS.has(key)) return '{}';
    }
    return nativeGetItem.call(this, key);
  };
  Storage.prototype.setItem = function patchedSetItem(key, value) {
    if (this === localStorage) {
      if (key === LEGACY_ADMIN_KEY) {
        const parsed = parse(String(value || ''), null);
        if (parsed) return void writeAdminState(parsed);
        return;
      }
      if (key === LEGACY_EMPLOYEE_KEY) {
        const parsed = parse(String(value || ''), null);
        if (parsed) return void writeEmployeeState(parsed);
        return;
      }
      if (ARCHIVE_KEYS.has(key)) return;
    }
    return nativeSetItem.call(this, key, value);
  };
  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    if (this === localStorage) {
      if (key === LEGACY_ADMIN_KEY || key === LEGACY_EMPLOYEE_KEY) return;
      if (ARCHIVE_KEYS.has(key)) return;
    }
    return nativeRemoveItem.call(this, key);
  };

  if (!rawGet(CATALOG_KEY)) writeCatalog(defaults());
})(window);
