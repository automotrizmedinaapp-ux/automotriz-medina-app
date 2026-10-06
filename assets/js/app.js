/* V4 Stage 4.7 - aro interno + facturas automáticas + firma dirigida */
function qs(selector, scope = document) { return scope.querySelector(selector); }
function qsa(selector, scope = document) { return Array.from(scope.querySelectorAll(selector)); }
function state() { return AM_SIMPLE_STORE.load(); }
let adminLocalArchivePreviewRec = null;
let adminLocalArchiveSearch = "";
let notifierMode = "";
const adminInvoiceDrafts = new Map();
function selected() { return adminLocalArchivePreviewRec || AM_SIMPLE_STORE.selected(); }
function selectedAdminReceptionFromHash() {
  if (adminLocalArchivePreviewRec) return adminLocalArchivePreviewRec;
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const params = new URLSearchParams(raw);
  const id = params.get("expediente") || "";
  const current = state();
  return current.receptions.find((rec) => rec.id === id) || AM_SIMPLE_STORE.selected(current);
}
function today() { return new Intl.DateTimeFormat("es-SV", { day: "numeric", month: "long", year: "numeric" }).format(new Date()); }

function statusTone(status) {
  if (/firmad|enviado|autorizado/i.test(status)) return "ok";
  if (/pendiente|revisión|lista/i.test(status)) return "warn";
  if (/rechaz/i.test(status)) return "danger";
  return "info";
}

function toast(message, tone = "") {
  let host = qs("[data-toast]");
  if (!host) {
    host = document.createElement("div");
    host.dataset.toast = "";
    host.className = "toast notice";
    document.body.appendChild(host);
  }
  host.className = `toast notice ${tone}`;
  host.textContent = message;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => host.remove(), 3200);
}

function showAccessGate(role) {
  const isAdmin = role === "admin";
  document.body.innerHTML = `
    <main class="public-main">
      <article class="panel" style="max-width:520px;margin:40px auto">
        <div class="panel-header"><div><h3>${isAdmin ? "Acceso administrador" : "Acceso empleado"}</h3><p>Automotriz Medina</p></div></div>
        <div class="panel-body grid">
          <div class="notice">${isAdmin ? "Ingrese el PIN administrativo." : "Ingrese su clave de acceso."}</div>
          <div class="field">
            <label>${isAdmin ? "PIN" : "Clave"}</label>
            <input type="password" data-login-value autocomplete="current-password" autofocus>
          </div>
          <button class="btn primary" data-action="${isAdmin ? "admin-login" : "employee-login"}">Entrar</button>
          <small>La contraseña se valida con el backend. Este dispositivo puede quedar autorizado sin guardar la contraseña.</small>
        </div>
      </article>
    </main>`;
}

function requireLocalAccess(page) {
  if (!globalThis.AM_CLOUD_SYNC) return true;
  if (page === "admin") {
    if (AM_CLOUD_SYNC.sessionMatches?.("admin")) return true;
    showAccessGate("admin");
    return false;
  }
  if (page === "employee") {
    if (AM_CLOUD_SYNC.sessionMatches?.("employee")) return true;
    showAccessGate("employee");
    return false;
  }
  return true;
}

const AM_IMAGE_QUALITY = 0.5;
const AM_CARD_BACK_IMAGE_QUALITY = 0.7;

function imageQualityForLabel(label = "") {
  return /(?:tarjeta.*reverso|reverso.*tarjeta)/i.test(String(label))
    ? AM_CARD_BACK_IMAGE_QUALITY
    : AM_IMAGE_QUALITY;
}

function compressImageDataUrl(src, quality = AM_IMAGE_QUALITY) {
  return new Promise((resolve) => {
    if (!src || !String(src).startsWith("data:image/")) {
      resolve(src || "");
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
        canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const out = canvas.toDataURL("image/webp", quality);
        resolve(out && out.length < src.length ? out : src);
      } catch {
        resolve(src);
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function readFile(input, callback, quality = AM_IMAGE_QUALITY) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => callback(await compressImageDataUrl(reader.result, quality));
  reader.readAsDataURL(file);
}

function readFilePromise(input) {
  return new Promise((resolve, reject) => {
    const file = input.files && input.files[0];
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = async () => resolve(await compressImageDataUrl(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function readImageFilePromise(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = async () => resolve(await compressImageDataUrl(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

function isTrackingVideoMedia(value) {
  if (typeof value === "string") return /^data:video\//i.test(value);
  return !!(value && typeof value === "object" && (value.type === "video" || /^data:video\//i.test(value.dataUrl || "")));
}

function trackingMediaDataUrl(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value.dataUrl || value.src || value.url || "";
}

function trackingMediaThumb(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  return value.thumbnail || value.thumb || value.dataUrl || "";
}

function renderTrackingMediaThumb(media, label, removeAttrs = "") {
  const src = trackingMediaDataUrl(media);
  const thumb = trackingMediaThumb(media);
  const isVideo = isTrackingVideoMedia(media);
  const action = isVideo ? "open-video-preview-direct" : "open-image-preview-direct";
  const cls = isVideo ? "photo-box has-image has-video" : "photo-box has-image";
  const style = thumb ? `background-image:url('${thumb}')` : "";
  const remove = removeAttrs ? `<button type="button" class="tracking-thumb-remove" ${removeAttrs} title="Eliminar archivo">X</button>` : "";
  return `<div class="tracking-thumb"><button type="button" class="${cls}" data-action="${action}" data-src="${esc(src)}" data-label="${esc(label)}" style="${style}">${isVideo ? '<span class="video-play-mark">▶</span>' : ""}</button>${remove}</div>`;
}

function videoDuration(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = Number(video.duration || 0);
      cleanup();
      resolve(duration);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("No se pudo leer la duración del video."));
    };
    video.src = url;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function videoPosterDataUrl(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.25, Math.max(0, (video.duration || 1) / 8));
      } catch {
        finish();
      }
    };
    video.onseeked = finish;
    video.onerror = () => {
      cleanup();
      resolve("");
    };
    function finish() {
      try {
        const maxWidth = 480;
        const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round((video.videoWidth || maxWidth) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 270) * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        cleanup();
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch {
        cleanup();
        resolve("");
      }
    }
    video.src = url;
  });
}

async function compressVideoFile(file, duration) {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return "";
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    const done = (value = "") => {
      cleanup();
      resolve(value);
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = async () => {
      try {
        const maxWidth = 640;
        const width = video.videoWidth || maxWidth;
        const height = video.videoHeight || 360;
        const scale = Math.min(1, maxWidth / width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext("2d");
        const stream = canvas.captureStream(12);
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
          ? "video/webm;codecs=vp8"
          : "video/webm";
        if (!MediaRecorder.isTypeSupported(mimeType)) return done("");
        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 650000 });
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          try { recorder.stop(); } catch {}
          try { stream.getTracks().forEach((track) => track.stop()); } catch {}
          try { video.pause(); } catch {}
        };
        const draw = () => {
          if (stopped) return;
          try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); } catch {}
          requestAnimationFrame(draw);
        };
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        };
        recorder.onstop = () => {
          if (!chunks.length) return done("");
          const blob = new Blob(chunks, { type: mimeType });
          const reader = new FileReader();
          reader.onload = () => done(reader.result || "");
          reader.onerror = () => done("");
          reader.readAsDataURL(blob);
        };
        video.onended = stop;
        recorder.start();
        draw();
        await video.play();
        setTimeout(stop, Math.min(10, Math.max(1, duration || 10)) * 1000 + 250);
      } catch {
        done("");
      }
    };
    video.onerror = () => done("");
    video.src = url;
  });
}

async function readTrackingMediaFile(file) {
  if (!file) return "";
  if (/^video\//i.test(file.type || "")) {
    const duration = await videoDuration(file);
    if (duration > 10.25) throw new Error("El video debe durar máximo 10 segundos.");
    const compressedDataUrl = await compressVideoFile(file, duration);
    const dataUrl = compressedDataUrl || await fileToDataUrl(file);
    const thumbnail = await videoPosterDataUrl(file);
    return {
      type: "video",
      dataUrl,
      thumbnail,
      name: file.name || "video-seguimiento",
      duration: Math.round(duration * 10) / 10,
      compressed: !!compressedDataUrl
    };
  }
  return readImageFilePromise(file);
}

function photoVisual(photo) {
  if (!photo) {
    return '<div class="photo-box" data-label="Foto">Foto pendiente</div>';
  }
  if (photo.dataUrl) {
    return `<button type="button" class="photo-box has-image" data-action="open-image-preview-direct" data-src="${esc(photo.dataUrl)}" data-label="${esc(photo.label)}"><img src="${esc(photo.dataUrl)}" alt="${esc(photo.label)}" loading="lazy"></button>`;
  }
  return `<div class="photo-box" data-label="${photo.label}" style="background:linear-gradient(135deg, ${photo.color || "#206f78"}, #eef2f5)">Foto pendiente</div>`;
}

const WORK_STATUSES = ["EN REVISIÓN", "EN DIAGNÓSTICO", "EN REPARACIÓN", "ESPERA DE REPUESTOS", "EN PAUSA", "FINALIZADO", "ENTREGADO"];
const CLIENT_REQUEST_TYPES = {
  none: { label: "Sin solicitud", button: "", done: "" },
  authorization: { label: "Solicitar autorizacion", button: "Autorizar solicitud", done: "Solicitud autorizada por el cliente." },
  call: { label: "Confirmar disponibilidad de contacto", button: "Confirmar", done: "Disponibilidad de contacto confirmada." }
};

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatDeadlineExact(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const weekday = date.toLocaleDateString("es-SV", { weekday: "long" });
  const calendarDate = date.toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" });
  const time = date.toLocaleTimeString("es-SV", { hour: "numeric", minute: "2-digit", hour12: true });
  const text = `${weekday} ${calendarDate} a las ${time}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function time12Parts(value) {
  const match = String(value || "").match(/(?:T|^)(\d{1,2}):(\d{2})/);
  if (!match) return { hour: "", minute: "", period: "AM" };
  let hour24 = Number(match[1]);
  const minute = match[2];
  if (!Number.isInteger(hour24) || hour24 < 0 || hour24 > 23) return { hour: "", minute: "", period: "AM" };
  const period = hour24 >= 12 ? "PM" : "AM";
  let hour = hour24 % 12;
  if (hour === 0) hour = 12;
  return { hour: String(hour), minute, period };
}

function time12To24(hourValue, minuteValue, periodValue) {
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const period = String(periodValue || "AM").toUpperCase();
  if (!Number.isInteger(hour) || hour < 1 || hour > 12 || !Number.isInteger(minute) || minute < 0 || minute > 59) return "";
  let hour24 = hour % 12;
  if (period === "PM") hour24 += 12;
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function setTime12Group(group, value) {
  if (!group) return;
  const parts = time12Parts(value);
  const hour = qs("[data-time12-hour]", group);
  const minute = qs("[data-time12-minute]", group);
  const period = qs("[data-time12-period]", group);
  if (hour) hour.value = parts.hour;
  if (minute) minute.value = parts.minute;
  if (period) period.value = parts.period;
}

function readTime12Group(group) {
  if (!group) return "";
  return time12To24(
    qs("[data-time12-hour]", group)?.value || "",
    qs("[data-time12-minute]", group)?.value || "",
    qs("[data-time12-period]", group)?.value || "AM"
  );
}

function syncAdminDeadline12Value() {
  const hidden = qs("[data-admin-deadline]");
  if (!hidden) return "";
  const date = qs("[data-admin-deadline-date]")?.value || "";
  const time = readTime12Group(qs("[data-admin-deadline-time12]"));
  hidden.value = date && time ? `${date}T${time}` : "";
  return hidden.value;
}

function syncFinalDelivery12Value() {
  const hidden = qs("[data-final-delivery-time]");
  if (!hidden) return "";
  hidden.value = readTime12Group(qs("[data-final-delivery-time12]"));
  return hidden.value;
}

function deadlineInputValue(value) {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function deadlineInfo(deadline, startedAt = "") {
  if (!deadline) return { active: false, label: "Esperando cálculo de sistema", tone: "info", progress: 0 };
  const end = new Date(deadline);
  if (Number.isNaN(end.getTime())) return { active: false, label: "Esperando cálculo de sistema", tone: "info", progress: 0 };
  const now = Date.now();
  const diff = end.getTime() - now;
  const startDate = startedAt ? new Date(startedAt) : null;
  const start = startDate && !Number.isNaN(startDate.getTime()) ? startDate.getTime() : now;
  const total = Math.max(1, end.getTime() - start);
  const progress = Math.max(0, Math.min(100, Math.round(((now - start) / total) * 100)));
  const tone = diff <= 0 || progress >= 75 ? "danger" : progress >= 50 ? "warn" : "ok";
  return {
    active: true,
    label: diff <= 0 ? "Tiempo vencido" : `Faltan ${formatRemaining(diff)}`,
    tone,
    progress
  };
}

function deadlineBadge(rec) {
  const info = deadlineInfo(rec?.employeeDeadline, rec?.employeeDeadlineSetAt);
  const recId = esc(rec?.id || rec?.number || "");
  if (!info.active) return `<span data-deadline-rec="${recId}"><span class="pill info">Esperando cálculo de sistema</span></span>`;
  const tokens = Number(rec?.employeeDeadlineTokensAvailable ?? 3);
  const exact = formatDeadlineExact(rec?.employeeDeadline);
  const request = rec?.employeeDeadlineUnlockRequested ? '<br><span class="pill danger">Solicitud de desbloqueo</span>' : "";
  return `<span data-deadline-rec="${recId}"><span class="pill ${info.tone}">${esc(info.label)}</span>${exact ? `<br><small>Finaliza: ${esc(exact)}</small>` : ""}<br><small>${tokens} token(s) disponible(s)</small>${request}</span>`;
}

function deadlineMobileGauge(rec) {
  const info = deadlineInfo(rec?.employeeDeadline, rec?.employeeDeadlineSetAt);
  const recId = esc(rec?.id || rec?.number || "");
  const label = info.active ? info.label : "Sin tiempo asignado";
  const progress = info.active ? info.progress : 0;
  const tone = info.active ? info.tone : "info";
  const exact = info.active ? formatDeadlineExact(rec?.employeeDeadline) : "";
  return `<div class="mobile-deadline-gauge ${tone}" data-mobile-deadline-rec="${recId}" style="--deadline-progress:${progress}%"><span class="mobile-deadline-clock"></span><span><strong>${esc(label)}</strong><small>Tiempo límite</small>${exact ? `<small>Finaliza: ${esc(exact)}</small>` : ""}</span></div>`;
}

function refreshAdminDeadlineBadges() {
  if (document.body.dataset.page !== "admin") return;
  const dashboard = qs('[data-section="dashboard"]');
  if (!dashboard || dashboard.classList.contains("hidden")) return;
  const current = state();
  qsa("[data-deadline-rec]").forEach((host) => {
    const id = host.dataset.deadlineRec || "";
    const rec = current.receptions.find((item) => item.id === id || item.number === id);
    if (!rec) return;
    const html = deadlineBadge(rec);
    if (host.outerHTML !== html) host.outerHTML = html;
  });
  qsa("[data-mobile-deadline-rec]").forEach((host) => {
    const id = host.dataset.mobileDeadlineRec || "";
    const rec = current.receptions.find((item) => item.id === id || item.number === id);
    if (!rec) return;
    const html = deadlineMobileGauge(rec);
    if (host.outerHTML !== html) host.outerHTML = html;
  });
}

function statusOptions(value) {
  return WORK_STATUSES.map((status) => `<option ${status === value ? "selected" : ""}>${status}</option>`).join("");
}

function yearOptions(value = "") {
  const currentYear = new Date().getFullYear();
  let html = '<option value="">Seleccione año</option>';
  for (let year = currentYear; year >= 1965; year -= 1) {
    html += `<option value="${year}" ${String(value) === String(year) ? "selected" : ""}>${year}</option>`;
  }
  return html;
}

function rawProcessRows(rec) {
  const details = trackingProfile(rec).processDetails || "";
  return details.split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function processRowItems(rec) {
  return rawProcessRows(rec).map(parseProcessRow).filter((item) => item.text);
}

function pendingTracking(rec) {
  return rec?.pendingTracking && rec.pendingTracking.status === "pending" ? rec.pendingTracking : null;
}

function finalizationNeedsPublish(rec) {
  if (String(rec?.status || "").toUpperCase() !== "FINALIZADO") return false;
  const trackingState = String(rec?.tracking?.state || "").toUpperCase();
  const publishedProgress = Number(rec?.publishedProgress ?? rec?.progress ?? 0);
  return pendingTracking(rec) || trackingState !== "FINALIZADO" || publishedProgress < 100;
}

function adminProcessRowItems(rec) {
  const pending = pendingTracking(rec);
  if (pending) {
    return String(pending.processDetails || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).map(parseProcessRow).filter((item) => item.text);
  }
  return processRowItems(rec);
}

function adminTrackingImages(rec) {
  const pending = pendingTracking(rec);
  if (pending) return Array.isArray(pending.images) ? pending.images : [];
  return Array.isArray(rec?.trackingImages) ? rec.trackingImages : [];
}

function parseProcessRow(row) {
  if (/^\[done\]\s*/i.test(row)) return { status: "done", text: row.replace(/^\[done\]\s*/i, "").trim() };
  if (/^\[(issue|problem|problema)\]\s*/i.test(row)) return { status: "issue", text: row.replace(/^\[(issue|problem|problema)\]\s*/i, "").trim() };
  if (/^\[pending\]\s*/i.test(row)) return { status: "pending", text: row.replace(/^\[pending\]\s*/i, "").trim() };
  if (/^✓\s*/.test(row)) return { status: "done", text: row.replace(/^✓\s*/, "").trim() };
  if (/^!\s*/.test(row)) return { status: "issue", text: row.replace(/^!\s*/, "").trim() };
  if (/^⏳\s*/.test(row)) return { status: "pending", text: row.replace(/^⏳\s*/, "").trim() };
  return { status: "pending", text: row };
}

function normalizeProcessStatus(status) {
  return status === "done" || status === "issue" ? status : "pending";
}

function processStatusIcon(status) {
  const value = normalizeProcessStatus(status);
  if (value === "done") return "✓";
  if (value === "issue") return "!";
  return "⏳";
}

function formatProcessRow(item) {
  return `[${normalizeProcessStatus(item.status)}] ${String(item.text || "").trim()}`;
}

function processRows(rec) {
  return processRowItems(rec).map((item) => item.text);
}

function collectAdminProcessRows() {
  return qsa("[data-admin-process-row]").map((input) => ({
    status: input.dataset.detailStatus || "pending",
    text: input.value.trim(),
    clientRequest: qs(`[data-admin-client-request="${input.dataset.adminProcessRow}"]`)?.value || ""
  })).filter((item) => item.text);
}

function normalizeClientRequestType(type) {
  return CLIENT_REQUEST_TYPES[type] ? type : "";
}

function requestTypeForRow(row, existingRequest) {
  if (row && Object.prototype.hasOwnProperty.call(row, "clientRequest")) {
    return normalizeClientRequestType(row.clientRequest || "");
  }
  return normalizeClientRequestType(existingRequest?.type || "");
}

function trackingRequestsForRows(rec, rows = []) {
  const requests = Array.isArray(rec?.trackingRequests) ? rec.trackingRequests : [];
  return rows.map((row, index) => {
    const existing = requests[index] || {};
    const type = requestTypeForRow(row, existing);
    const previousType = normalizeClientRequestType(existing.type || "");
    const fingerprint = clientRequestFingerprint(row);
    const previousFingerprint = existing.fingerprint || "";
    const keepConfirmation = type && type === previousType && (!previousFingerprint || previousFingerprint === fingerprint);
    return {
      type,
      fingerprint,
      confirmedAt: keepConfirmation ? existing.confirmedAt || "" : "",
      confirmedLabel: keepConfirmation ? existing.confirmedLabel || "" : ""
    };
  });
}

function attachClientRequestsToRows(rows = [], requests = []) {
  return rows.map((row, index) => ({
    ...row,
    clientRequest: normalizeClientRequestType(row?.clientRequest || requests[index]?.type || "")
  }));
}

function moveAdminTrackingItem(list, from, to) {
  if (!Array.isArray(list) || from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

function reorderAdminTrackingDraft(rec, from, to) {
  if (!rec) return false;
  const draft = captureAdminTrackingDraftFromDom(rec);
  if (!moveAdminTrackingItem(draft.rows, from, to)) return false;
  moveAdminTrackingItem(draft.images, from, to);
  moveAdminTrackingItem(draft.requests, from, to);
  AM_SIMPLE_STORE.mutate((current) => {
    persistAdminTrackingDraft(current, draft, false);
  });
  syncSelectedAdminReceptionToEmployee();
  renderAdmin();
  toast("Renglón movido. Presione Guardar seguimiento para respaldarlo.", "ok");
  return true;
}

function adminTrackingProfileSnapshot(rec, sourceProfile = trackingProfile(rec)) {
  return {
    receptionDate: sourceProfile.receptionDate || "",
    deliveryEstimate: sourceProfile.deliveryEstimate || "",
    finalDeliveryDate: sourceProfile.finalDeliveryDate || rec?.finalDelivery?.date || "",
    finalDeliveryTime: sourceProfile.finalDeliveryTime || rec?.finalDelivery?.time || "",
    vehicleTitle: sourceProfile.vehicleTitle || "",
    odometer: sourceProfile.odometer || "",
    plate: sourceProfile.plate || "",
    state: sourceProfile.state || rec?.status || "EN REVISIÓN"
  };
}

function createAdminTrackingDraft(rec) {
  const profile = trackingProfile(rec);
  const pending = pendingTracking(rec);
  const savedDraft = rec?.adminTrackingDraft && typeof rec.adminTrackingDraft === "object" ? rec.adminTrackingDraft : null;
  if (!pending && savedDraft) {
    return {
      id: rec?.id || "",
      sourcePendingAt: savedDraft.sourcePendingAt || "",
      profile: { ...adminTrackingProfileSnapshot(rec, profile), ...(savedDraft.profile || {}) },
      progress: Number(savedDraft.progress ?? rec?.progress ?? 0),
      rows: attachClientRequestsToRows(Array.isArray(savedDraft.rows) ? savedDraft.rows : processRowItems(rec), savedDraft.requests || rec?.trackingRequests || []),
      images: Array.isArray(savedDraft.images) ? savedDraft.images : (Array.isArray(rec?.trackingImages) ? rec.trackingImages : []),
      deadline: savedDraft.deadline ?? rec?.employeeDeadline ?? "",
      finalDeliveryTime: savedDraft.finalDeliveryTime || finalDeliverySchedule(rec, profile).time || "",
      requests: Array.isArray(savedDraft.requests) ? savedDraft.requests : trackingRequestsForRows(rec, savedDraft.rows || processRowItems(rec))
    };
  }
  const baseRows = pending ? adminProcessRowItems(rec) : processRowItems(rec);
  return {
    id: rec?.id || "",
    sourcePendingAt: pending?.submittedAt || "",
    profile: pending ? { ...adminTrackingProfileSnapshot(rec, profile), state: pending.state || profile.state || rec.status } : adminTrackingProfileSnapshot(rec, profile),
    progress: pending ? Number(pending.progress || 0) : Number(rec?.progress || 0),
    rows: attachClientRequestsToRows(baseRows, rec?.trackingRequests || []),
    images: pending ? adminTrackingImages(rec) : (Array.isArray(rec?.trackingImages) ? rec.trackingImages : []),
    deadline: rec?.employeeDeadline || "",
    finalDeliveryTime: finalDeliverySchedule(rec, profile).time || "",
    requests: trackingRequestsForRows(rec, baseRows)
  };
}

function ensureAdminTrackingDraft(rec) {
  const pending = pendingTracking(rec);
  const pendingAt = pending?.submittedAt || "";
  if (!adminTrackingDraft || adminTrackingDraft.id !== rec?.id || adminTrackingDraft.sourcePendingAt !== pendingAt) {
    adminTrackingDraft = createAdminTrackingDraft(rec);
  }
  return adminTrackingDraft;
}

function captureAdminTrackingDraftFromDom(rec) {
  const draft = ensureAdminTrackingDraft(rec);
  syncAdminDeadline12Value();
  syncFinalDelivery12Value();
  qsa("[data-track-field]").forEach((input) => {
    draft.profile[input.dataset.trackField] = input.value;
  });
  if (qs("[data-admin-progress]")) draft.progress = Number(qs("[data-admin-progress]").value || 0);
  const rows = collectAdminProcessRows();
  if (rows.length || qsa("[data-admin-process-row]").length) {
    draft.rows = rows;
    draft.images = (draft.images || []).slice(0, rows.length);
    draft.requests = trackingRequestsForRows({ ...rec, trackingRequests: draft.requests || rec?.trackingRequests || [] }, rows);
  }
  draft.deadline = qs("[data-admin-deadline]")?.value || draft.deadline || "";
  draft.finalDeliveryTime = qs("[data-final-delivery-time]")?.value || draft.finalDeliveryTime || "";
  return draft;
}

function persistAdminTrackingDraft(current, draft, publish = false) {
  const rec = AM_SIMPLE_STORE.selected(current);
  if (!rec) return;
  const profile = trackingProfile(rec);
  const rows = (draft.rows || []).filter((row) => String(row?.text || "").trim());
  const images = (draft.images || []).slice(0, rows.length).map((rowImages) => Array.isArray(rowImages) ? rowImages : []);
  const requestSource = {
    ...rec,
    trackingRequests: Array.isArray(draft.requests) ? draft.requests : rec.trackingRequests
  };
  const privateDraft = {
    id: rec.id,
    sourcePendingAt: draft.sourcePendingAt || "",
    savedAt: new Date().toISOString(),
    profile: { ...draft.profile },
    progress: Number(draft.progress || 0),
    rows,
    images,
    deadline: draft.deadline || "",
    finalDeliveryTime: draft.finalDeliveryTime || "",
    requests: trackingRequestsForRows(requestSource, rows)
  };
  rec.adminTrackingDraft = privateDraft;
  rec.pendingTracking = {
    ...(rec.pendingTracking || {}),
    status: "pending",
    employeeId: rec.employeeId || "",
    employeeName: rec.employeeName || "ADMINISTRADOR",
    submittedAt: privateDraft.savedAt,
    editedByAdmin: true,
    state: privateDraft.profile.state || rec.status || "EN REVISIÓN",
    progress: privateDraft.progress,
    processDetails: rows.map(formatProcessRow).join("\n"),
    images,
    requests: privateDraft.requests
  };

  const deadlineValue = draft.deadline || "";
  if ((rec.employeeDeadline || "") !== deadlineValue) {
    rec.employeeDeadlineSetAt = deadlineValue ? new Date().toISOString() : "";
    rec.employeeDeadlineUnlockRequested = false;
  }
  rec.employeeDeadline = deadlineValue;
  if (deadlineValue && rec.employeeDeadlineTokensAvailable == null) rec.employeeDeadlineTokensAvailable = 3;
  if (deadlineValue && rec.employeeDeadlineTokensUsed == null) rec.employeeDeadlineTokensUsed = 0;
  if (!deadlineValue) {
    rec.employeeDeadlineUnlockRequested = false;
    rec.employeeDeadlineTokensAvailable = 3;
    rec.employeeDeadlineTokensUsed = 0;
  }

  if (!publish) return;
  Object.assign(profile, draft.profile);
  rec.progress = Number(draft.progress || 0);
  rec.publishedProgress = rec.progress;
  profile.processDetails = rows.map(formatProcessRow).join("\n");
  rec.trackingImages = images;
  rec.trackingRequests = trackingRequestsForRows(requestSource, rows);
  rec.status = profile.state || rec.status;
  rec.progressLabel = profile.state || "En proceso";
  if (pendingTracking(rec)) {
    rec.pendingTracking = {
      ...rec.pendingTracking,
      status: "published",
      publishedAt: new Date().toISOString()
    };
  }
}

function internalRows(rec) {
  const note = rec.internalWork?.internalNote || "";
  return note.split(/\n+/).map((line) => line.trim()).filter(Boolean);
}

function whatsappPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 8) return `503${digits}`;
  return digits;
}

function absoluteHref(page, token) {
  const base = location.href.replace(/[^/\\]*$/, "");
  return `${base}${tokenHref(page, token)}`;
}

function absolutePhotoReviewHref(token) {
  const base = location.href.replace(/[^/\\]*$/, "");
  return `${base}${photoReviewHref(token)}`;
}

let activeDictation = null;

function startAdminDictation(button) {
  if (window.innerWidth <= 920) {
    toast("El dictado por micrófono está disponible solo en escritorio.", "warn");
    return;
  }
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    toast("Este navegador no permite dictado por micrófono.", "warn");
    return;
  }
  const target = qs(button.dataset.dictationTarget || "");
  if (!target) {
    toast("No se encontró el campo para dictar.", "warn");
    return;
  }
  if (activeDictation) {
    try { activeDictation.stop(); } catch {}
    activeDictation = null;
  }
  const originalText = button.textContent;
  const recognition = new SpeechRecognition();
  activeDictation = recognition;
  recognition.lang = "es-GT";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  button.disabled = true;
  button.textContent = "Escuchando...";
  target.focus();
  recognition.onresult = (event) => {
    const spoken = Array.from(event.results || [])
      .map((result) => result[0]?.transcript || "")
      .join(" ")
      .trim();
    if (!spoken) return;
    const current = target.value.trim();
    target.value = current ? `${current} ${spoken}` : spoken;
    target.dispatchEvent(new Event("input", { bubbles: true }));
  };
  recognition.onerror = () => {
    toast("No se pudo tomar el dictado. Revise permiso de micrófono.", "warn");
  };
  recognition.onend = () => {
    if (activeDictation === recognition) activeDictation = null;
    button.disabled = false;
    button.textContent = originalText;
  };
  try {
    recognition.start();
  } catch {
    activeDictation = null;
    button.disabled = false;
    button.textContent = originalText;
    toast("No se pudo iniciar el micrófono.", "warn");
  }
}

function closeActionMenus(except = null) {
  qsa(".action-menu[open]").forEach((menu) => {
    if (menu !== except) menu.open = false;
  });
}

function hasOpenActionMenu() {
  return !!qs(".action-menu[open]");
}

function initActionMenus() {
  qsa(".action-menu").forEach((menu) => {
    if (menu.dataset.menuReady) return;
    menu.dataset.menuReady = "1";
    menu.addEventListener("toggle", () => {
      if (!menu.open) return;
      closeActionMenus(menu);
      if (!history.state?.menuOpen) {
        history.pushState({ ...(history.state || {}), menuOpen: true }, "");
      }
    });
  });
}

function encodePayload(data) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data || {}))));
}

function vehiclePayloadFromReception(rec) {
  const profile = trackingProfile(rec);
  return {
    fecha: String(profile.receptionDate || "").split(",")[0] || "",
    hora: "",
    tecnico: rec.employeeName || "",
    marca: rec.vehicle?.marca || "",
    modelo: rec.vehicle?.modelo || "",
    anio: rec.vehicle?.anio || "",
    color: rec.vehicle?.color || "",
    vin: rec.vehicle?.vin || "",
    placa: rec.vehicle?.placa || "",
    odometro: rec.vehicle?.kilometraje || "",
    odometroUnidad: /km/i.test(profile.odometer || "") ? "km" : "mi",
    rec: rec.number || "",
    updatedAt: new Date().toISOString()
  };
}

function masterFileHref(rec) {
  const params = new URLSearchParams();
  params.set("rec", rec.number || rec.id || "");
  params.set("vehicle", encodePayload(vehiclePayloadFromReception(rec)));
  params.set("v", masterArchiveVersion(rec));
  params.set("modulev", "20260801-master-shared-archive1");
  return `modulo-master-taller.html?${params.toString()}`;
}

function masterArchiveVersion(rec) {
  const archive = masterArchiveForReception(rec);
  return archive?.updatedAt || "nuevo";
}

function archiveNorm(value) {
  return String(value || "").trim().toUpperCase();
}

function archiveVehicleKey(data = {}) {
  return [data.marca, data.modelo, data.anio].map(archiveNorm).filter(Boolean).join("|");
}

function archiveDataFromCandidate(archive = {}) {
  return archive.data || archive.vehicle || {};
}

function archiveMatchesReception(archive, rec) {
  const data = archiveDataFromCandidate(archive);
  const recKeys = [
    rec.number,
    rec.id,
    rec.vehicle?.vin,
    rec.vehicle?.placa
  ].map(archiveNorm).filter(Boolean);
  const archiveKeys = [
    archive.rec,
    data.rec,
    data.recepcion,
    data.vin,
    data.placa
  ].map(archiveNorm).filter(Boolean);
  if (archiveKeys.some((key) => recKeys.includes(key))) return true;
  const recVehicleKey = archiveVehicleKey({
    marca: rec.vehicle?.marca,
    modelo: rec.vehicle?.modelo,
    anio: rec.vehicle?.anio
  });
  return !!recVehicleKey && recVehicleKey === archiveVehicleKey(data);
}

function archiveContentScore(archive) {
  const data = archiveDataFromCandidate(archive);
  let score = 0;
  ["items", "repuestos", "repuestosIngreso", "authItems", "authRepuestos"].forEach((key) => {
    if (Array.isArray(data[key])) score += data[key].length * 5;
  });
  if (data.masterDocs && typeof data.masterDocs === "object") score += 20;
  if (data.ticketDoc && typeof data.ticketDoc === "object") score += 10;
  ["marca", "modelo", "anio", "color", "vin", "placa", "odometro", "tecnico"].forEach((key) => {
    if (String(data[key] || "").trim()) score += 1;
  });
  if (archive.html && !/No habia un archivo|No había un archivo|todavía no tiene un archivo/i.test(archive.html)) score += 1000;
  return score;
}

function newestUsefulArchive(candidates) {
  return [...new Set(candidates)].sort((a, b) => {
    const scoreDiff = archiveContentScore(b) - archiveContentScore(a);
    if (scoreDiff) return scoreDiff;
    return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
  })[0] || null;
}

function authorizationMessage(rec) {
  const link = absoluteHref("cliente.html", rec.clientToken);
  const vehicle = [rec.vehicle?.marca, rec.vehicle?.modelo, rec.vehicle?.anio].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  return [
    `Hola, ${String(rec.client?.name || "").trim()}.`,
    `Te compartimos el link privado de autorización para tu vehículo ${vehicle}.`,
    link
  ].join("\n\n");
}

function photoReviewMessage(rec) {
  const link = absolutePhotoReviewHref(rec.clientToken);
  return [
    `Hola ${rec.client?.name || ""}.`,
    `Tu autorización ya fue firmada en recepción. Te compartimos este enlace privado para que puedas revisar las fotografías e información visual registrada de Tu vehículo ${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}. Al terminar la revisión, presiona Siguiente para abrir el seguimiento de Tu vehículo:`,
    link
  ].join("\n\n");
}

function trackingMessage(rec) {
  const link = absoluteHref("seguimiento.html", rec.trackingToken);
  return [
    `Hola ${rec.client?.name || ""}.`,
    `Te compartimos el link privado de seguimiento de Tu vehículo ${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}.`,
    link
  ].join("\n\n");
}

function safeFileName(value) {
  return String(value || "archivo").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "archivo";
}

function safeFolderName(value, fallback = "CARPETA") {
  return String(value || fallback)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .toUpperCase() || fallback;
}

function archiveDateInfo(rec) {
  const stamp = receptionDateMs(rec) || Date.now();
  const date = new Date(stamp);
  const year = String(date.getFullYear());
  const monthNumber = String(date.getMonth() + 1).padStart(2, "0");
  const monthName = date.toLocaleDateString("es-SV", { month: "long" }).toUpperCase();
  const day = String(date.getDate()).padStart(2, "0");
  return {
    year,
    monthFolder: `${monthNumber} - ${safeFolderName(monthName, "MES")}`,
    dateLabel: `${year}-${monthNumber}-${day}`
  };
}

function excelDate() {
  return new Date().toLocaleString("es-SV");
}

function downloadBlob(filename, content, type = "application/vnd.ms-excel;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function workbookHtml(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#17202a}
    h1{font-size:22px;color:#206f78}h2{font-size:16px;margin-top:22px;color:#206f78}
    table{border-collapse:collapse;width:100%;margin-bottom:14px}td,th{border:1px solid #bfcad3;padding:7px 8px;vertical-align:top}
    th{background:#e9f2f3;text-align:left}.muted{color:#637282}.photo{max-width:180px;max-height:140px}
  </style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
}

function kvRows(rows) {
  return `<table><tbody>${rows.map(([key, value]) => `<tr><th>${esc(key)}</th><td>${value == null ? "" : esc(value)}</td></tr>`).join("")}</tbody></table>`;
}

function tableRows(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${row.map((cell) => {
    const raw = typeof cell === "string" && cell.startsWith("<img ");
    return `<td>${cell == null ? "" : (raw ? cell : esc(cell))}</td>`;
  }).join("")}</tr>`).join("") : `<tr><td colspan="${headers.length}">Sin datos registrados.</td></tr>`}</tbody></table>`;
}

function photoBackupRows(rec) {
  return receptionPhotos(rec).map((photo) => [
    photo.label || "Foto",
    photo.note || "",
    photo.dataUrl ? "Incluida en respaldo" : "Sin imagen",
    photo.dataUrl ? `<img class="photo" src="${photo.dataUrl}">` : ""
  ]);
}

function backupWorkbook(rec) {
  const profile = trackingProfile(rec);
  const evidence = rec.authorizationEvidence || {};
  const inventory = (rec.inventory || []).map((item) => [item.name, item.present ? "Presente" : "Faltante", item.note || ""]);
  const damages = (rec.damages || []).map((damage) => [damage.área || damage.area || "", damage.detail || "", (damage.photos || []).length]);
  const photos = photoBackupRows(rec);
  const updates = processRows(rec).map((row, index) => [index + 1, row]);
  const internal = internalRows(rec).map((row, index) => [index + 1, row]);
  return workbookHtml(`Respaldo expediente ${rec.number}`, `
    <p class="muted">Generado: ${esc(excelDate())}</p>
    <h2>Cliente</h2>${kvRows([["Nombre", rec.client?.name || ""], ["Teléfono", rec.client?.phone || ""], ["Estado autorización", rec.signed ? "Autorizado" : (rec.express ? "No aplica - servicio express" : "Pendiente")], ["Fecha autorización", rec.signatureDate || ""], ["Enlaces privados", "No incluidos en el respaldo imprimible"]])}
    <h2>Vehículo</h2>${kvRows([["Recepción", rec.number], ["Tipo", rec.express ? `Servicio express: ${rec.serviceType || ""}` : "Vehículo en taller"], ["Técnico", rec.employeeName || ""], ["Estado", rec.status || ""], ["Marca", rec.vehicle?.marca || ""], ["Modelo", rec.vehicle?.modelo || ""], ["Año", rec.vehicle?.anio || ""], ["Color", rec.vehicle?.color || ""], ["Placa", rec.vehicle?.placa || ""], ["VIN", rec.vehicle?.vin || ""], ["Kilometraje", rec.vehicle?.kilometraje || ""]])}
    <h2>Motivo y observaciones</h2>${kvRows([["Motivo de recepción / falla reportada", serviceReason(rec) || ""], ["Observaciones", rec.observations || ""]])}
    <h2>Inventario</h2>${tableRows(["Elemento", "Estado", "Detalle"], inventory)}
    <h2>Daños</h2>${tableRows(["Área", "Detalle", "Fotos"], damages)}
    <h2>Fotografías</h2>${tableRows(["Foto", "Nota", "Estado", "Imagen"], photos)}
    <h2>Seguimiento publicado</h2>${kvRows([["Recepción visible", profile.receptionDate || ""], ["Estimación entrega", profile.deliveryEstimate || ""], ["Vehículo visible", profile.vehicleTitle || ""], ["Odómetro visible", profile.odometer || ""], ["Placa visible", profile.plate || ""], ["Estado visible", profile.state || ""], ["Avance %", rec.progress || 0], ["Texto progreso", rec.progressLabel || ""]])}
    ${tableRows(["#", "Detalle"], updates)}
    <h2>Bitácora interna</h2>${tableRows(["#", "Nota interna"], internal)}
    <h2>Constancia técnica de autorización</h2>${kvRows([["Navegador", evidence.userAgent || ""], ["Plataforma", evidence.platform || ""], ["Idioma", evidence.language || ""], ["Zona horaria", evidence.timezone || ""], ["Pantalla", evidence.screen || ""], ["Ventana", evidence.viewport || ""]])}
  `);
}

function internalWorkbook(rec) {
  const rows = internalRows(rec).map((row, index) => [index + 1, row]);
  const profile = trackingProfile(rec);
  return workbookHtml(`Archivo interno ${rec.number}`, `
    <p class="muted">Generado: ${esc(excelDate())}</p>
    ${kvRows([["Recepción", rec.number], ["Fecha recepción", profile.receptionDate || ""], ["Técnico", rec.employeeName || ""], ["Cliente", rec.client?.name || ""], ["Teléfono", rec.client?.phone || ""], ["Vehículo", `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim()], ["Color", rec.vehicle?.color || ""], ["VIN", rec.vehicle?.vin || ""], ["Placa", rec.vehicle?.placa || ""], ["Odómetro", rec.vehicle?.kilometraje || ""], ["Estado", rec.status || ""], ["Avance %", rec.progress || 0], ["Motivo", serviceReason(rec) || ""]])}
    <h2>Bitácora interna</h2>${tableRows(["#", "Renglón"], rows)}
    <h2>Detalle de seguimiento</h2>${tableRows(["#", "Renglón"], processRows(rec).map((row, index) => [index + 1, row]))}
  `);
}

function downloadReceptionBackup(rec) {
  if (!rec) return;
  const backup = buildReceptionBackup(rec);
  const base = `${safeFileName(rec.number)}-${safeFileName(`${rec.vehicle?.marca || ""}-${rec.vehicle?.modelo || ""}-${rec.vehicle?.anio || ""}`)}`;
  downloadBlob(`respaldo-${base}.amr`, JSON.stringify(backup, null, 2), "application/json;charset=utf-8");
}

const LOCAL_ARCHIVE_DB = "am-local-archive-folder-v1";
const LOCAL_ARCHIVE_STORE = "handles";
const LOCAL_ARCHIVE_HANDLE_KEY = "archiveFolder";
let adminArchiveDirectoryHandle = null;
let adminLocalArchivedBackups = [];

function supportsLocalArchiveFolders() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window;
}

function exportExpedienteFolderName(rec) {
  const vehicle = `${rec?.vehicle?.marca || "VEHICULO"} ${rec?.vehicle?.modelo || ""} ${rec?.vehicle?.anio || ""}`.trim();
  const identity = rec?.vehicle?.placa || (rec?.vehicle?.vin ? `VIN ${String(rec.vehicle.vin).slice(-8)}` : "SIN PLACA");
  return safeFolderName(`${rec?.number || rec?.id || "EXPEDIENTE"} - ${vehicle} - ${identity}`, "EXPEDIENTE");
}

function archiveFolderParts(rec) {
  return [exportExpedienteFolderName(rec)];
}

function localArchiveFileName(rec, mode = "full") {
  return "expediente";
}

function localArchivePath(rec, mode = "full") {
  return `${exportExpedienteFolderName(rec)}/expediente.json`;
}

function openLocalArchiveDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_ARCHIVE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(LOCAL_ARCHIVE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalArchiveHandle(handle) {
  const db = await openLocalArchiveDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_ARCHIVE_STORE, "readwrite");
    tx.objectStore(LOCAL_ARCHIVE_STORE).put(handle, LOCAL_ARCHIVE_HANDLE_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadLocalArchiveHandle() {
  if (adminArchiveDirectoryHandle || !supportsLocalArchiveFolders()) return adminArchiveDirectoryHandle;
  const db = await openLocalArchiveDb();
  const handle = await new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_ARCHIVE_STORE, "readonly");
    const request = tx.objectStore(LOCAL_ARCHIVE_STORE).get(LOCAL_ARCHIVE_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  adminArchiveDirectoryHandle = handle || null;
  return adminArchiveDirectoryHandle;
}

async function verifyDirectoryPermission(handle, write = false) {
  if (!handle) return false;
  const options = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

async function configureLocalArchiveFolder() {
  if (!supportsLocalArchiveFolders()) {
    toast("Este navegador no permite seleccionar carpetas locales. Use Chrome o Edge en computadora.", "danger");
    return null;
  }
  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const ok = await verifyDirectoryPermission(handle, true);
  if (!ok) throw new Error("No se concedió permiso para escribir en la carpeta.");
  adminArchiveDirectoryHandle = handle;
  await saveLocalArchiveHandle(handle);
  localStorage.setItem("am_local_archive_folder_name", handle.name || "Carpeta configurada");
  toast(`Carpeta de exportaciones configurada: ${handle.name || "lista"}`);
  renderLocalArchiveStatus();
  return handle;
}

async function getLocalArchiveFolder(write = false) {
  let handle = await loadLocalArchiveHandle();
  if (!handle) return null;
  const ok = await verifyDirectoryPermission(handle, write);
  return ok ? handle : null;
}

async function ensureLocalArchiveFolder() {
  return (await getLocalArchiveFolder(true)) || configureLocalArchiveFolder();
}

async function getOrCreateFolder(root, parts) {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create: true });
  return current;
}

async function existingChildFolder(root, name) {
  try {
    return await root.getDirectoryHandle(name, { create: false });
  } catch {
    return null;
  }
}

async function selectLocalArchiveTarget(root, rec) {
  const folderName = exportExpedienteFolderName(rec);
  const existing = await existingChildFolder(root, folderName);
  if (existing) {
    const replace = confirm(`Ya existe una descarga de este expediente:

${folderName}

¿Desea reemplazarla por una copia actualizada?`);
    if (!replace) return null;
    try {
      await root.removeEntry(folderName, { recursive: true });
    } catch (error) {
      throw new Error("No se pudo reemplazar la carpeta existente. Cierre cualquier archivo de esa carpeta e inténtelo nuevamente.");
    }
  }
  return {
    folder: await root.getDirectoryHandle(folderName, { create: true }),
    pathParts: [folderName]
  };
}

async function writeTextFile(folder, name, content, type = "text/plain;charset=utf-8") {
  const fileHandle = await folder.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([content], { type }));
  await writable.close();
  const file = await fileHandle.getFile();
  return file.size > 0;
}

function exportMediaMimeExtension(mime = "") {
  const value = String(mime || "").toLowerCase();
  if (value.includes("jpeg")) return "jpg";
  if (value.includes("png")) return "png";
  if (value.includes("webp")) return "webp";
  if (value.includes("gif")) return "gif";
  if (value.includes("mp4")) return "mp4";
  if (value.includes("webm")) return "webm";
  if (value.includes("quicktime")) return "mov";
  return value.startsWith("video/") ? "video" : "bin";
}

function exportDataUrlBlob(dataUrl) {
  const raw = String(dataUrl || "");
  const match = raw.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  try {
    if (match[2]) {
      const binary = atob(match[3]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(match[3])], { type: mime });
  } catch {
    return null;
  }
}

async function writeBlobFile(folder, name, blob) {
  const fileHandle = await folder.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
  const file = await fileHandle.getFile();
  return file.size >= 0;
}

function exportMediaHint(path = [], hint = "") {
  const joined = path.join(".").toLowerCase();
  if (joined.includes("signaturedataurl")) return "firma-cliente";
  if (joined.includes("invoices")) return `factura-${String((path.find((part) => Number.isInteger(part)) ?? 0) + 1).padStart(2, "0")}`;
  if (joined.includes("damages")) return "dano";
  if (joined.includes("tracking")) return "seguimiento";
  if (joined.startsWith("photos")) return hint || "foto-recepcion";
  return hint || path.filter((part) => typeof part === "string").slice(-2).join("-") || "media";
}

async function externalizeExpedienteMedia(value, mediaFolder, path = [], counter = { value: 0 }, hint = "") {
  if (typeof value === "string" && /^data:(?:image|video)\//i.test(value)) {
    const blob = exportDataUrlBlob(value);
    if (!blob) return value;
    counter.value += 1;
    const ext = exportMediaMimeExtension(blob.type);
    const base = safeFileName(exportMediaHint(path, hint));
    const fileName = `${String(counter.value).padStart(2, "0")}-${base}.${ext}`;
    await writeBlobFile(mediaFolder, fileName, blob);
    return { __amFile: `media/${fileName}`, mimeType: blob.type };
  }
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i += 1) {
      out.push(await externalizeExpedienteMedia(value[i], mediaFolder, [...path, i], counter, hint));
    }
    return out;
  }
  if (!value || typeof value !== "object") return value;
  const objectHint = value.label || value.name || value.title || hint || "";
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = await externalizeExpedienteMedia(item, mediaFolder, [...path, key], counter, objectHint);
  }
  return out;
}

function cleanReceptionForExport(rec) {
  const clone = JSON.parse(JSON.stringify(rec || {}));
  const remove = new Set([
    "cloudStatus", "cloudError", "cloudUpdatedAt", "localArchiveConfirmedAt", "localArchivePath",
    "localArchiveMode", "localArchivePreviewOnly", "__localBackup", "__cloudId", "bitacora", "nota"
  ]);
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    Object.keys(value).forEach((key) => {
      if (remove.has(key)) delete value[key];
      else walk(value[key]);
    });
  };
  walk(clone);
  return clone;
}

async function fileToDataUrlForViewer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result || "");
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer un archivo multimedia del expediente."));
    reader.readAsDataURL(file);
  });
}

async function readRelativePackageFile(packageFolder, relativePath) {
  const parts = String(relativePath || "").split("/").filter(Boolean);
  const fileName = parts.pop();
  let folder = packageFolder;
  for (const part of parts) folder = await folder.getDirectoryHandle(part, { create: false });
  const handle = await folder.getFileHandle(fileName, { create: false });
  return handle.getFile();
}

async function hydrateExpedienteMedia(value, packageFolder) {
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await hydrateExpedienteMedia(item, packageFolder));
    return out;
  }
  if (!value || typeof value !== "object") return value;
  if (value.__amFile) {
    try {
      const file = await readRelativePackageFile(packageFolder, value.__amFile);
      return await fileToDataUrlForViewer(file);
    } catch (error) {
      console.warn("No se pudo cargar media del expediente", value.__amFile, error);
      return "";
    }
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = await hydrateExpedienteMedia(item, packageFolder);
  return out;
}

async function writeLocalArchiveBackup(rec, mode = "full") {
  const root = await ensureLocalArchiveFolder();
  if (!root) throw new Error("Configure primero la carpeta donde desea guardar los expedientes descargados.");
  const target = await selectLocalArchiveTarget(root, rec);
  if (!target) throw new Error("Descarga cancelada.");
  const folder = target.folder;
  const mediaFolder = await folder.getDirectoryHandle("media", { create: true });
  const exportedAt = new Date().toISOString();
  const cleanRec = cleanReceptionForExport(rec);
  const reception = await externalizeExpedienteMedia(cleanRec, mediaFolder);
  const payload = {
    type: "automotriz-medina-expediente",
    version: 4,
    exportedAt,
    reception
  };
  const wroteExpediente = await writeTextFile(folder, "expediente.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
  const readme = [
    "AUTOMOTRIZ MEDINA - EXPEDIENTE DESCARGADO",
    "",
    `Recepción: ${rec?.number || ""}`,
    `Vehículo: ${`${rec?.vehicle?.marca || ""} ${rec?.vehicle?.modelo || ""} ${rec?.vehicle?.anio || ""}`.trim()}`,
    `Placa: ${rec?.vehicle?.placa || ""}`,
    `Exportado: ${exportedAt}`,
    "",
    "Este folder contiene el expediente.json y su carpeta media.",
    "Para visualizarlo con todas sus fotografías, abra la sección Visor de Automotriz Medina V4 y seleccione esta carpeta o la carpeta que la contiene.",
    "No cambie los nombres de expediente.json ni de la carpeta media si desea conservar compatibilidad con el Visor."
  ].join("\r\n");
  const wroteReadme = await writeTextFile(folder, "LEEME.txt", readme, "text/plain;charset=utf-8");
  if (!wroteExpediente || !wroteReadme) throw new Error("No se pudo verificar la descarga del expediente.");
  return { path: `${target.pathParts.join("/")}/expediente.json`, exportedAt, mode: "full" };
}

async function deleteLocalArchiveBackup(entry) {
  const root = await getLocalArchiveFolder(true);
  if (!root) throw new Error("Configure primero la carpeta local de exportaciones.");
  const parts = String(entry?.path || "").split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error("No se pudo identificar el archivo local.");
  let folder = root;
  for (const part of parts) {
    folder = await folder.getDirectoryHandle(part);
  }
  const names = new Set([fileName]);
  const rec = entry?.backup?.reception;
  if (rec) {
    ["full", "partial"].forEach((mode) => {
      const base = localArchiveFileName(rec, mode);
      names.add(`${base}.amr`);
      names.add(`${base}.html`);
      names.add(`${base}-archivo.html`);
    });
  }
  for (const name of names) {
    try {
      await folder.removeEntry(name);
    } catch (error) {
      if (error?.name !== "NotFoundError") throw error;
    }
  }
}

async function freshReceptionForLocalArchive(rec) {
  if (!rec) return null;
  try {
    if (globalThis.AM_CLOUD_SYNC?.isReady?.() && globalThis.AM_CLOUD_SYNC?.fetchLatest) {
      const snapshot = await AM_CLOUD_SYNC.fetchLatest();
      AM_CLOUD_SYNC.applySnapshot?.(snapshot);
    }
  } catch (error) {
    console.warn("No se pudo actualizar desde nube antes de archivar", error);
  }
  return state().receptions.find((item) => item.id === rec.id || item.number === rec.number) || rec;
}

async function readLocalArchiveFiles(dirHandle, prefix = "") {
  const results = [];
  for await (const [name, handle] of dirHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      if (name.toLowerCase() === "media") continue;
      results.push(...await readLocalArchiveFiles(handle, path));
      continue;
    }
    if (/^expediente\.json$/i.test(name)) {
      try {
        const file = await handle.getFile();
        const payload = JSON.parse(await file.text());
        if (payload?.type === "automotriz-medina-expediente" && payload.reception) {
          const reception = await hydrateExpedienteMedia(payload.reception, dirHandle);
          results.push({
            path,
            backup: { type: "am-recepcion-backup", version: 4, exportedAt: payload.exportedAt || new Date(file.lastModified).toISOString(), reception },
            updatedAt: file.lastModified
          });
        }
      } catch (error) {
        console.warn("No se pudo leer expediente descargado", path, error);
      }
      continue;
    }
    if (/\.amr$/i.test(name) || /datos-expediente\.json$/i.test(name)) {
      try {
        const file = await handle.getFile();
        const backup = JSON.parse(await file.text());
        if (backup?.type === "am-recepcion-backup" && backup.reception) {
          results.push({ path, backup, updatedAt: file.lastModified });
        }
      } catch (error) {
        console.warn("No se pudo leer respaldo archivado", path, error);
      }
    }
  }
  return results;
}

async function loadLocalArchivedBackups() {
  const root = await getLocalArchiveFolder(false);
  if (!root) {
    adminLocalArchivedBackups = [];
    renderLocalArchiveStatus("Seleccione una carpeta para cargar expedientes descargados.");
    renderLocalArchiveTable();
    return [];
  }
  adminLocalArchivedBackups = await readLocalArchiveFiles(root);
  renderLocalArchiveStatus();
  renderLocalArchiveTable();
  return adminLocalArchivedBackups;
}

function renderLocalArchiveStatus(message = "") {
  const host = qs("[data-local-archive-status]");
  if (!host) return;
  const folderName = localStorage.getItem("am_local_archive_folder_name") || "";
  const count = adminLocalArchivedBackups.length;
  host.textContent = message || (folderName ? `Carpeta configurada: ${folderName}. ${count} expediente(s) local(es) cargado(s).` : "No hay carpeta de expedientes cargada.");
}

function renderLocalArchiveTable() {
  const tbody = qs("[data-local-archive-table]");
  const gallery = qs("[data-local-archive-gallery]");
  if (!tbody && !gallery) return;
  const entries = adminLocalArchivedBackups
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => localArchiveMatchesSearch(entry));
  if (gallery) {
    gallery.innerHTML = entries.length
      ? entries.map(({ entry, index }) => renderLocalArchiveMobileCard(entry, index)).join("")
      : '<div class="mobile-gallery-empty">No hay expedientes descargados en este filtro.</div>';
  }
  if (!tbody) return;
  tbody.innerHTML = entries.map(({ entry, index }) => {
    const rec = entry.backup.reception;
    return `<tr>
      <td><strong>${esc(`${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim() || rec.number)}</strong><br><small>${esc(rec.vehicle?.placa || rec.number || "")}</small></td>
      <td>${esc(rec.client?.name || "Cliente pendiente")}<br><small>${esc(rec.client?.phone || "")}</small></td>
      <td>${esc(rec.employeeName || "")}</td>
      <td><span class="pill ${statusTone(rec.status)}">${esc(rec.status || "")}</span></td>
      <td><small>${esc(entry.path)}</small></td>
      <td><div class="table-actions"><button class="btn primary" data-action="restore-local-archive-preview" data-local-archive-index="${index}">Ver expediente</button></div></td>
    </tr>`;
  }).join("") || '<tr><td colspan="6">No hay expedientes descargados en la carpeta seleccionada.</td></tr>';
}

function localArchiveSearchText(entry) {
  const rec = entry?.backup?.reception || {};
  const vehicle = rec.vehicle || {};
  const client = rec.client || {};
  return [
    rec.number,
    rec.id,
    rec.status,
    rec.employeeName,
    client.name,
    client.phone,
    vehicle.marca,
    vehicle.modelo,
    vehicle.anio,
    vehicle.color,
    vehicle.placa,
    vehicle.vin,
    serviceReason(rec),
    entry.path
  ].filter(Boolean).join(" ").toLowerCase();
}

function localArchiveMatchesSearch(entry) {
  const query = String(adminLocalArchiveSearch || "").trim().toLowerCase();
  if (!query) return true;
  return query.split(/\s+/).every((part) => localArchiveSearchText(entry).includes(part));
}

function renderLocalArchiveMobileCard(entry, index) {
  const rec = entry?.backup?.reception || {};
  const photo = mobileVehiclePhoto(rec);
  const title = mobileVehicleTitle(rec);
  const archiveModeLabel = entry?.backup?.archiveModeLabel || (entry?.backup?.archiveMode === "partial" || /-parcial\.amr$/i.test(entry?.path || "") ? "Parcial" : "Completo");
  return `
    <article class="mobile-vehicle-card" data-action="restore-local-archive-preview" data-local-archive-index="${index}" role="button" tabindex="0">
      <div class="mobile-vehicle-photo ${photo ? "" : `empty ${thumbInfo.status}`}">
        ${photo ? `<img src="${photo}" alt="${esc(title)}">` : `<span>${esc(rec.number || "AM")}</span>`}
      </div>
      <div class="mobile-vehicle-info">
        <span class="mobile-vehicle-status ${mobileVehicleStatusClass(rec.status || "ARCHIVADO")}">${esc(rec.status || "ARCHIVADO")}</span>
        <strong>${esc(title)}</strong>
        <small>${esc(rec.employeeName || "Sin técnico")}</small>
        <em>${esc(`${rec.client?.name || "Cliente pendiente"} · ${rec.number || ""} · ${archiveModeLabel}`)}</em>
      </div>
    </article>`;
}

function archiveDataFromHtml(html = "") {
  const match = String(html || "").match(/<pre[^>]*id=["']expediente-json["'][^>]*>([\s\S]*?)<\/pre>/i);
  if (!match) return null;
  const textarea = document.createElement("textarea");
  textarea.innerHTML = match[1];
  return safeJsonParse(textarea.value, null);
}

function archiveFromLocalBackup(backup, rec) {
  const archives = backup?.archives?.master || {};
  const candidates = Object.values(archives).filter(Boolean);
  const matched = candidates.filter((archive) => archiveMatchesReception(archive, rec));
  let archive = newestUsefulArchive(matched.length ? matched : candidates);
  const html = backup?.files?.archivoTallerHtml || "";
  const htmlData = archiveDataFromHtml(html);
  if (!archive && (htmlData || html)) {
    archive = {
      rec: rec.number || htmlData?.rec || "",
      updatedAt: backup.exportedAt || new Date().toISOString(),
      data: htmlData || vehiclePayloadFromReception(rec),
      html
    };
  }
  if (archive && !archive.html && html) archive = { ...archive, html };
  if (archive && (!archive.data || !Object.keys(archive.data).length)) {
    archive = { ...archive, data: htmlData || vehiclePayloadFromReception(rec) };
  }
  return archive || null;
}

function seedArchiveViewerFromLocalBackup(backup, rec) {
  if (!backup || !rec) return false;
  const archive = archiveFromLocalBackup(backup, rec);
  if (!archive?.data) return false;
  const key = archiveNorm(rec.number || archive.rec || archive.data.rec || rec.id || rec.vehicle?.vin || rec.vehicle?.placa || "");
  if (!key) return false;
  const nextArchive = {
    rec: archive.rec || rec.number || key,
    updatedAt: archive.updatedAt || backup.exportedAt || new Date().toISOString(),
    data: {
      ...archive.data,
      rec: archive.data.rec || rec.number || archive.rec || key
    },
    html: archive.html || ""
  };
  const store = safeJsonParse(localStorage.getItem("am_master_taller_archives_v1"), {});
  const aliases = [
    key,
    rec.number,
    rec.id,
    rec.vehicle?.vin,
    rec.vehicle?.placa,
    nextArchive.rec,
    nextArchive.data.rec,
    nextArchive.data.vin,
    nextArchive.data.placa
  ].map(archiveNorm).filter(Boolean);
  aliases.forEach((alias) => { store[alias] = nextArchive; });
  localStorage.setItem("am_master_taller_archives_v1", JSON.stringify(store));
  return true;
}

function openLocalArchiveAsExpediente(entry) {
  const backupRec = entry?.backup?.reception;
  if (!backupRec) return;
  const cloudRec = state().receptions.find((item) => item.id === backupRec.id || item.number === backupRec.number);
  adminFileTab = "seguimiento";
  adminLocalArchivePreviewRec = {
    ...backupRec,
    id: backupRec.id || cloudRec?.id || backupRec.number,
    __localBackup: entry.backup,
    __cloudId: cloudRec?.id || "",
    archivedAt: backupRec.archivedAt || entry.backup.exportedAt || new Date().toISOString(),
    archivedBy: backupRec.archivedBy || "Respaldo local",
    localArchivePreviewOnly: true
  };
  seedArchiveViewerFromLocalBackup(entry.backup, adminLocalArchivePreviewRec);
  renderAdmin();
  showSection("expediente");
  showAdminFileTab("seguimiento");
}

function safeJsonParse(value, fallback = {}) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

function archiveAliasesForReception(rec) {
  return [rec.number, rec.id, rec.vehicle?.vin, rec.vehicle?.placa].map(archiveNorm).filter(Boolean);
}

function relatedArchivesForReception(rec, key) {
  const store = safeJsonParse(localStorage.getItem(key), {});
  const out = {};
  const aliases = archiveAliasesForReception(rec);
  const keepHtml = key === "am_master_taller_archives_v1";
  Object.entries(store).forEach(([archiveKey, archive]) => {
    if (aliases.includes(archiveNorm(archiveKey)) || archiveMatchesReception(archive, rec)) {
      const data = archive?.data || {};
      const compactKey = archiveNorm(archive?.rec || data.rec || archiveKey);
      out[compactKey] = compactArchiveEntry(archive, keepHtml);
    }
  });
  return out;
}

function compactArchiveEntry(archive, keepHtml = false) {
  const data = archive?.data || {};
  return {
    rec: archive?.rec || data.rec || "",
    updatedAt: archive?.updatedAt || new Date().toISOString(),
    data,
    ...(keepHtml && archive?.html ? { html: archive.html } : {})
  };
}

function compactArchiveStoreValue(store = {}, keepHtml = false) {
  const compact = {};
  Object.values(store || {}).forEach((archive) => {
    const data = archive?.data || {};
    const key = archiveNorm(archive?.rec || data.rec || data.vin || data.placa || "");
    if (!key) return;
    const next = compactArchiveEntry(archive, keepHtml);
    const existing = compact[key];
    if (!existing || archiveContentScore(next) >= archiveContentScore(existing) || Date.parse(next.updatedAt || 0) > Date.parse(existing.updatedAt || 0)) {
      compact[key] = next;
    }
  });
  return compact;
}

function saveCompactedArchiveStore(key, incoming = {}, keepHtml = false) {
  const compact = compactArchiveStoreValue(incoming, keepHtml);
  localStorage.removeItem(key);
  localStorage.setItem(key, JSON.stringify(compact));
  return compact;
}

function setStorageSafely(key, value, fallbackValue = null) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`No se pudo guardar ${key}; limpiando espacio`, error);
    if (key !== "am_quick_taller_archives_v1") {
      try { localStorage.removeItem("am_quick_taller_archives_v1"); } catch {}
    }
    if (key !== "am_master_taller_archives_v1") {
      try { localStorage.removeItem("am_master_taller_archives_v1"); } catch {}
    }
    if (fallbackValue != null) {
      try {
        localStorage.setItem(key, fallbackValue);
        return true;
      } catch (fallbackError) {
        console.warn(`No se pudo guardar respaldo reducido para ${key}`, fallbackError);
      }
    }
    return false;
  }
}

function compactLocalArchiveStores() {
  try {
    saveCompactedArchiveStore("am_quick_taller_archives_v1", safeJsonParse(localStorage.getItem("am_quick_taller_archives_v1"), {}), false);
  } catch (error) {
    console.warn("No se pudo compactar archivo rápido", error);
    try { localStorage.removeItem("am_quick_taller_archives_v1"); } catch {}
  }
  try {
    saveCompactedArchiveStore("am_master_taller_archives_v1", safeJsonParse(localStorage.getItem("am_master_taller_archives_v1"), {}), true);
  } catch (error) {
    console.warn("No se pudo compactar archivo maestro", error);
  }
}

function employeeVehicleFromReception(rec) {
  const draft = rec?.adminTrackingDraft && typeof rec.adminTrackingDraft === "object" ? rec.adminTrackingDraft : null;
  const pending = pendingTracking(rec);
  const hasDraftRows = !!draft && Array.isArray(draft.rows);
  const draftRows = Array.isArray(draft?.rows) ? draft.rows.filter((row) => String(row?.text || "").trim()) : [];
  const pendingRows = pending ? String(pending.processDetails || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).map(parseProcessRow).filter((item) => item.text) : [];
  const rowItems = hasDraftRows ? draftRows : (pendingRows.length ? pendingRows : processRowItems(rec));
  const details = rowItems.map(formatProcessRow);
  const detailImages = Array.isArray(draft?.images) ? draft.images : (pending && Array.isArray(pending.images) ? pending.images : (Array.isArray(rec.trackingImages) ? rec.trackingImages : []));
  const internal = internalRows(rec);
  return {
    id: String(rec.id || `restored-${AM_SIMPLE_STORE.cryptoToken()}`).replace(/^emp-/, "") || AM_SIMPLE_STORE.cryptoToken(),
    rec: rec.number || "",
    express: !!rec.express,
    tipoServicio: rec.serviceType || "",
    eid: rec.employeeId || String(rec.employeeName || "edwin").toLowerCase(),
    en: rec.employeeName || "Edwin",
    fecha: String(trackingProfile(rec).receptionDate || "").split(",")[0] || new Date().toISOString().slice(0, 10),
    hora: "",
    marca: rec.vehicle?.marca || "",
    modelo: rec.vehicle?.modelo || "",
    anio: rec.vehicle?.anio || "",
    color: rec.vehicle?.color || "",
    vin: rec.vehicle?.vin || "",
    placa: rec.vehicle?.placa || "",
    odometro: rec.vehicle?.kilometraje || "",
    unidad: /km/i.test(trackingProfile(rec).odometer || "") ? "km" : "mi",
    estado: draft?.profile?.state || pending?.state || rec.status || "EN REVISIÓN",
    avance: Number(draft?.progress ?? pending?.progress ?? rec.progress ?? 0),
    autorizado: !!rec.signed,
    signed: !!rec.signed,
    manualAuthorization: !!rec.manualAuthorization,
    quickAuthorization: !!rec.quickAuthorization,
    adminSignatureReviewedAt: rec.adminSignatureReviewedAt || "",
    adminSignatureReviewedBy: rec.adminSignatureReviewedBy || "",
    termsAcceptedAt: rec.termsAcceptedAt || rec.signatureDate || "",
    clientName: rec.client?.name || "",
    clientPhone: rec.client?.phone || "",
    signatureName: rec.signatureName || rec.client?.name || "",
    signatureDate: rec.signatureDate || "",
    signatureDataUrl: rec.signatureDataUrl || "",
    authorizationEvidence: rec.authorizationEvidence ? { ...rec.authorizationEvidence } : null,
    motivo: serviceReason(rec) || "",
    observaciones: rec.observations || "",
    detalle: details.join("\n"),
    detalles: details,
    detalleImages: detailImages,
    __forceTrackingSync: true,
    pendingTracking: rec.pendingTracking?.status === "pending" ? { ...rec.pendingTracking } : null,
    beforeFinishedTracking: rec.beforeFinishedTracking || null,
    autoCorrection: !!rec.autoCorrection,
    autoCorrectionAttempts: Number(rec.autoCorrectionAttempts || 0),
    autoCorrectionForced: !!rec.autoCorrectionForced,
    adminReactivateAllowed: !!rec.adminReactivateAllowed,
    nota: internal.join("\n"),
    bitacora: internal,
    deadline: rec.employeeDeadline || "",
    deadlineSetAt: rec.employeeDeadlineSetAt || "",
    deadlineTokensAvailable: Number(rec.employeeDeadlineTokensAvailable ?? 3),
    deadlineTokensUsed: Number(rec.employeeDeadlineTokensUsed || 0),
    deadlineUnlockRequested: !!rec.employeeDeadlineUnlockRequested,
    notifications: Array.isArray(rec.employeeNotifications) ? rec.employeeNotifications.map((item) => ({ ...item })) : [],
    invoices: Array.isArray(rec.invoices) ? rec.invoices.map((item) => ({ ...item })) : [],
    photos: receptionPhotos(rec).map((photo) => ({ ...photo })),
    inventory: Array.isArray(rec.inventory) ? rec.inventory.map((item) => ({ ...item })) : [],
    damages: Array.isArray(rec.damages) ? rec.damages.map((damage) => ({ ...damage })) : []
  };
}

function mergeEmployeeVehicle(existing = {}, incoming = {}) {
  const merged = { ...existing, ...incoming };
  ["photos", "inventory", "damages", "detalles", "detalleImages", "bitacora", "notifications", "invoices"].forEach((key) => {
    const incomingArray = Array.isArray(incoming[key]) ? incoming[key] : null;
    const existingArray = Array.isArray(existing[key]) ? existing[key] : [];
    if (incomingArray && incomingArray.length) merged[key] = incomingArray;
    else if (existingArray.length) merged[key] = existingArray;
    else if (incomingArray) merged[key] = incomingArray;
  });
  if (!incoming.__forceTrackingSync && !String(incoming.detalle || "").trim() && String(existing.detalle || "").trim()) merged.detalle = existing.detalle;
  if (!String(incoming.nota || "").trim() && String(existing.nota || "").trim()) merged.nota = existing.nota;
  if (!incoming.__forceTrackingSync && !incoming.pendingTracking && existing.pendingTracking) merged.pendingTracking = existing.pendingTracking;
  if (incoming.__forceTrackingSync) {
    merged.detalles = Array.isArray(incoming.detalles) ? incoming.detalles : [];
    merged.detalle = incoming.detalle || "";
    merged.detalleImages = Array.isArray(incoming.detalleImages) ? incoming.detalleImages : [];
    merged.estado = incoming.estado || merged.estado;
    merged.avance = Number(incoming.avance || 0);
    merged.pendingTracking = incoming.pendingTracking || null;
  }
  delete merged.__forceTrackingSync;
  return merged;
}

function buildReceptionBackup(rec) {
  const masterArchives = relatedArchivesForReception(rec, "am_master_taller_archives_v1");
  const masterArchive = masterArchiveForReception(rec);
  const archivoTallerHtml = masterArchive?.html && !/todavía no tiene un archivo|No habia un archivo|No había un archivo/i.test(masterArchive.html)
    ? masterArchive.html
    : backupWorkbook(rec);
  return {
    type: "am-recepcion-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    reception: rec,
    employeeVehicle: employeeVehicleFromReception(rec),
    files: {
      expedienteHtml: backupWorkbook(rec),
      archivoTallerHtml
    },
    archives: {
      master: masterArchives,
      quick: {}
    }
  };
}

function partialReceptionForLocalArchive(rec) {
  const clone = JSON.parse(JSON.stringify(rec || {}));
  const keepPhotos = [];
  const keepByLabel = (label, fallback = "") => {
    const photo = receptionPhotoByLabel(clone, label, fallback) || (label === "Frente" ? frontReceptionPhoto(clone) : null);
    if (photo?.dataUrl && !keepPhotos.some((item) => item.dataUrl === photo.dataUrl && item.label === photo.label)) {
      keepPhotos.push({ ...photo });
    }
  };
  keepByLabel("Frente");
  keepByLabel("Tarjeta frente", "frente tarjeta");
  keepByLabel("Tarjeta reverso", "reverso tarjeta");
  clone.photos = keepPhotos;
  clone.damages = Array.isArray(clone.damages)
    ? clone.damages.map((damage) => ({
      ...damage,
      photos: Array.isArray(damage.photos) ? damage.photos.map(stripPhotoPayload) : []
    }))
    : [];
  clone.detalleImages = Array.isArray(clone.detalleImages) ? clone.detalleImages.map(stripPhotoPayload) : [];
  clone.trackingImages = Array.isArray(clone.trackingImages) ? clone.trackingImages.map(stripPhotoPayload) : [];
  clone.invoices = Array.isArray(clone.invoices)
    ? clone.invoices.map((invoice) => stripPhotoPayload(invoice))
    : [];
  clone.localArchiveMode = "partial";
  return clone;
}

function stripPhotoPayload(value) {
  if (typeof value === "string") return "";
  if (!value || typeof value !== "object") return value;
  const copy = { ...value };
  ["dataUrl", "image", "src", "url", "thumbnail", "thumb"].forEach((key) => {
    if (typeof copy[key] === "string" && /^data:image\//i.test(copy[key])) copy[key] = "";
  });
  return copy;
}

function askLocalArchiveDownloadMode(rec) {
  const answer = prompt(
    `Descargar expediente ${rec?.number || ""}\n\nEscriba COMPLETO para guardar todo el expediente con todas sus fotografías.\nEscriba PARCIAL para guardar todo el expediente, pero solo con estas fotografías: frente del vehículo, tarjeta frente y tarjeta reverso.`,
    "COMPLETO"
  );
  if (answer == null) return "";
  const value = String(answer).trim().toLowerCase();
  if (["completo", "complete", "full", "todo"].includes(value)) return "full";
  if (["parcial", "partial"].includes(value)) return "partial";
  toast("Descarga cancelada. Debe escribir COMPLETO o PARCIAL.", "danger");
  return "";
}

function buildFullProgramBackup() {
  const current = state();
  return {
    type: "am-recepcion-full-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    appState: current,
    employeeState: safeJsonParse(localStorage.getItem("am_employee_module_safe_v2"), null),
    archives: {
      master: compactArchiveStoreValue(safeJsonParse(localStorage.getItem("am_master_taller_archives_v1"), {}), true),
      quick: {}
    },
    receptions: (current.receptions || []).map((rec) => buildReceptionBackup(rec))
  };
}

function mergeArchiveStore(key, incoming = {}) {
  const keepHtml = key === "am_master_taller_archives_v1";
  const store = compactArchiveStoreValue(safeJsonParse(localStorage.getItem(key), {}), keepHtml);
  Object.entries(incoming || {}).forEach(([archiveKey, archive]) => {
    if (!archiveKey || !archive) return;
    const data = archive?.data || {};
    const keyName = archiveNorm(archive?.rec || data.rec || archiveKey);
    store[keyName] = compactArchiveEntry(archive, keepHtml);
  });
  saveCompactedArchiveStore(key, store, keepHtml);
}

function persistRestoredArchiveAliases(rec, backup) {
  const key = archiveNorm(rec.number || rec.id || rec.vehicle?.vin || rec.vehicle?.placa || "");
  if (!key) return;
  const masterStore = compactArchiveStoreValue(safeJsonParse(localStorage.getItem("am_master_taller_archives_v1"), {}), true);
  const quickStore = compactArchiveStoreValue(safeJsonParse(localStorage.getItem("am_quick_taller_archives_v1"), {}), false);
  const masterArchive = masterArchiveForReception(rec) || {
    rec: rec.number,
    updatedAt: backup.exportedAt || new Date().toISOString(),
    data: vehiclePayloadFromReception(rec),
    html: backup.files?.archivoTallerHtml || masterWorkbookFallback(rec)
  };
  const quickArchive = {
    rec: rec.number,
    updatedAt: backup.exportedAt || new Date().toISOString(),
    data: employeeVehicleFromReception(rec)
  };
  masterStore[key] = compactArchiveEntry(masterArchive, true);
  quickStore[key] = compactArchiveEntry(quickArchive, false);
  try {
    saveCompactedArchiveStore("am_master_taller_archives_v1", masterStore, true);
  } catch (error) {
    console.warn("No se pudo restaurar archivo maestro completo", error);
    saveCompactedArchiveStore("am_master_taller_archives_v1", { [key]: { ...masterArchive, html: "" } }, true);
  }
  try {
    saveCompactedArchiveStore("am_quick_taller_archives_v1", quickStore, false);
  } catch (error) {
    console.warn("No se pudo restaurar archivo rápido completo", error);
    saveCompactedArchiveStore("am_quick_taller_archives_v1", { [key]: quickArchive }, false);
  }
}

function upsertEmployeeVehicle(vehicle) {
  if (!vehicle?.rec) return;
  const employeeState = safeJsonParse(localStorage.getItem("am_employee_module_safe_v2"), { selected: "", seq: 0, vehicles: [] });
  if (!Array.isArray(employeeState.vehicles)) employeeState.vehicles = [];
  const index = employeeState.vehicles.findIndex((item) => item.rec === vehicle.rec || item.id === vehicle.id);
  const nextVehicle = index >= 0 ? mergeEmployeeVehicle(employeeState.vehicles[index], vehicle) : vehicle;
  if (index >= 0) employeeState.vehicles[index] = nextVehicle;
  else employeeState.vehicles.unshift(nextVehicle);
  const maxSeq = employeeState.vehicles.reduce((max, item) => {
    const number = Number(String(item.id || "").replace(/\D/g, ""));
    return Math.max(max, Number.isFinite(number) ? number : 0);
  }, Number(employeeState.seq || 0));
  employeeState.seq = Math.max(maxSeq, Number(employeeState.seq || 0), employeeState.vehicles.length);
  setStorageSafely("am_employee_module_safe_v2", JSON.stringify(employeeState), JSON.stringify({ selected: "", seq: employeeState.seq || 0, vehicles: [nextVehicle] }));
}

function removeEmployeeVehicleForReception(rec) {
  if (!rec) return;
  const employeeState = safeJsonParse(localStorage.getItem("am_employee_module_safe_v2"), { selected: "", seq: 0, vehicles: [] });
  if (!Array.isArray(employeeState.vehicles)) employeeState.vehicles = [];
  const recId = String(rec.id || "").replace(/^emp-/, "");
  employeeState.vehicles = employeeState.vehicles.filter((vehicle) => {
    const vehicleId = String(vehicle.id || "").replace(/^emp-/, "");
    return vehicle.rec !== rec.number
      && vehicle.number !== rec.number
      && vehicle.reception !== rec.number
      && (!recId || vehicleId !== recId);
  });
  if (employeeState.selected && !employeeState.vehicles.some((vehicle) => vehicle.id === employeeState.selected)) {
    employeeState.selected = "";
  }
  setStorageSafely(
    "am_employee_module_safe_v2",
    JSON.stringify(employeeState),
    JSON.stringify({ selected: "", seq: employeeState.seq || 0, vehicles: [] })
  );
}

async function purgeBrowserResidueForReception(rec) {
  if (!rec) return;
  try { await globalThis.AM_CLOUD_SYNC?.purgeLocalReceptionCaches?.(rec); } catch (error) { console.warn('No se pudo limpiar cache remoto local del expediente purgado.', error); }
  try { globalThis.AM_V4_DATA?.purgeLocalReceptionResidue?.(rec); } catch (error) { console.warn('No se pudo limpiar residuo local del expediente purgado.', error); }
  const tokens=[rec.clientToken,rec.trackingToken].map(v=>String(v||'').trim()).filter(Boolean);
  try {
    const keys=[]; for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key)keys.push(key);}
    keys.forEach(key=>{if(tokens.some(token=>key.startsWith(`am_client_request_confirmed_${token}_`)))localStorage.removeItem(key);});
    const consumed=JSON.parse(localStorage.getItem('am_consumed_client_links_v1')||'{}')||{};
    let changed=false;
    for(const [clientToken,entry] of Object.entries(consumed)){
      if(tokens.includes(clientToken)||tokens.includes(String(entry?.trackingToken||''))){delete consumed[clientToken];changed=true;}
    }
    if(changed)localStorage.setItem('am_consumed_client_links_v1',JSON.stringify(consumed));
  } catch(error){console.warn('No se pudieron limpiar confirmaciones locales del expediente purgado.',error);}
  try {
    const recNumber=String(rec.number||'').trim(); if(recNumber)sessionStorage.removeItem(`am_finalized_alertzy_lock_${recNumber}`);
    const selected=sessionStorage.getItem('am_admin_selected_reception_v1'); if(selected&&selected===String(rec.id||''))sessionStorage.removeItem('am_admin_selected_reception_v1');
  } catch {}
}

function syncSelectedAdminReceptionToEmployee() {
  const rec = AM_SIMPLE_STORE.selected(state());
  if (rec) upsertEmployeeVehicle(employeeVehicleFromReception(rec));
}

async function handleAdminTrackingAction(action, button, event) {
  if (!["start-dictation", "open-admin-tracking-link", "save-admin-tracking", "save-progress", "admin-add-detail-row", "admin-detail-status", "admin-move-detail-row", "admin-remove-detail-row", "admin-remove-detail-image"].includes(action)) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  if (action === "start-dictation") {
    startAdminDictation(button);
    return true;
  }
  const rec = selectedAdminReceptionFromHash();
  if (!rec) {
    toast("Seleccione un expediente para modificar seguimiento.", "warn");
    return true;
  }
  if (action === "open-admin-tracking-link") {
    const href = button.dataset.href || tokenHref("seguimiento.html", rec.trackingToken);
    if (window.innerWidth <= 920) {
      window.location.assign(href);
    } else {
      window.open(href, "_blank", "noopener");
    }
    return true;
  }
  if (action === "admin-detail-status") {
    const row = qs(`[data-admin-process-row="${button.dataset.index}"]`);
    if (row) {
      const nextStatus = button.dataset.status || "pending";
      row.dataset.detailStatus = nextStatus;
      row.closest(".admin-detail-row")?.querySelector("textarea")?.setAttribute("data-detail-status", nextStatus);
      button.parentElement?.querySelectorAll("button").forEach((item) => item.classList.toggle("primary", item === button));
    }
    return true;
  }
  const draft = captureAdminTrackingDraftFromDom(rec);
  if (action === "save-admin-tracking" || action === "save-progress") {
    let deliverySchedule = null;
    if (action === "save-progress" && String(draft.profile.state || "").toUpperCase() === "FINALIZADO") {
      const deliveryDate = draft.profile.deliveryEstimate || "";
      const deliveryTime = draft.finalDeliveryTime || "";
      if (!deliveryDate) {
        toast("Seleccione la estimación de entrega antes de publicar la finalización.", "warn");
        qs('[data-track-field="deliveryEstimate"]')?.focus();
        return true;
      }
      if (!deliveryTime) {
        toast("Escriba la hora de entrega antes de publicar la finalización.", "warn");
        qs("[data-time12-hour]", qs("[data-final-delivery-time12]"))?.focus();
        return true;
      }
      draft.progress = 100;
      draft.profile.finalDeliveryDate = deliveryDate;
      draft.profile.finalDeliveryTime = deliveryTime;
      deliverySchedule = { date: deliveryDate, time: deliveryTime };
    }
    AM_SIMPLE_STORE.mutate((current) => {
      persistAdminTrackingDraft(current, draft, action === "save-progress");
      const updated = current.receptions.find((item) => item.id === rec.id);
      if (deliverySchedule && updated) {
        applyFinalDeliverySchedule(updated, deliverySchedule);
        updated.status = "FINALIZADO";
        updated.progress = 100;
        updated.publishedProgress = 100;
        updated.progressLabel = "FINALIZADO";
        updated.finalizationPublishedAt = new Date().toISOString();
      }
    });
    if (action === "save-progress") adminTrackingDraft = null;
    syncSelectedAdminReceptionToEmployee();
    renderAdmin();
    const message = action === "save-progress" ? "Seguimiento publicado." : "Seguimiento guardado.";
    const reason = action === "save-progress" ? "publish-tracking" : "save-admin-tracking";
    if (!await confirmCloudSaved(message, reason)) return true;
    renderAdmin();
    return true;
  }
  if (action === "admin-add-detail-row") {
    const field = qs("[data-admin-new-detail]");
    const next = field?.value.trim() || "";
    if (!next) {
      field?.focus();
      return true;
    }
    draft.rows.push({ status: "pending", text: next });
    draft.images.push([]);
    if (field) field.value = "";
  }
  if (action === "admin-remove-detail-row") {
    const index = Number(button.dataset.index);
    if (!Number.isFinite(index)) return true;
    if (!confirm("¿Está seguro de que desea eliminar este renglón de seguimiento?")) return true;
    draft.rows.splice(index, 1);
    draft.images.splice(index, 1);
  }
  if (action === "admin-remove-detail-image") {
    const rowIndex = Number(button.dataset.rowIndex);
    const imageIndex = Number(button.dataset.imageIndex);
    if (!Number.isFinite(rowIndex) || !Number.isFinite(imageIndex)) return true;
    if (!Array.isArray(draft.images?.[rowIndex])) return true;
    if (!confirm("¿Eliminar esta imagen del renglón?")) return true;
    draft.images[rowIndex].splice(imageIndex, 1);
  }
  if (action === "admin-move-detail-row") {
    const from = Number(button.dataset.index);
    const to = from + Number(button.dataset.direction || 0);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return true;
    reorderAdminTrackingDraft(rec, from, to);
    return true;
  }
  AM_SIMPLE_STORE.mutate((current) => {
    persistAdminTrackingDraft(current, draft, false);
  });
  renderAdmin();
  toast("Cambio preparado. Presione Guardar seguimiento para respaldarlo.", "ok");
  return true;
}

async function handleAdminTrackingImageChange(input, event) {
  if (!input?.matches?.("[data-admin-detail-image]")) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  const rec = selectedAdminReceptionFromHash();
  if (!rec) {
    toast("Seleccione un expediente para agregar imagen.", "warn");
    input.value = "";
    return true;
  }
  const rowIndex = Number(input.dataset.adminDetailImage);
  try {
    const files = Array.from(input.files || []);
    if (!files.length || !Number.isFinite(rowIndex)) return true;
    const dataUrls = (await Promise.all(files.map((file) => readTrackingMediaFile(file)))).filter(Boolean);
    if (!dataUrls.length) return true;
    const draft = captureAdminTrackingDraftFromDom(rec);
    while (draft.images.length <= rowIndex) draft.images.push([]);
    if (!Array.isArray(draft.images[rowIndex])) draft.images[rowIndex] = [];
    draft.images[rowIndex].push(...dataUrls);
    AM_SIMPLE_STORE.mutate((current) => {
      persistAdminTrackingDraft(current, draft, false);
    });
    renderAdmin();
    toast("Imagen agregada. Presione Guardar seguimiento para respaldarla.", "ok");
  } catch (error) {
    console.error(error);
    toast(error.message || "No se pudo guardar la imagen.", "danger");
  } finally {
    input.value = "";
  }
  return true;
}

function reactivateReception(rec) {
  if (!rec) return null;
  const previousProgress = Number(rec.publishedProgress ?? rec.progress ?? 0);
  const nextProgress = previousProgress >= 100 ? 99 : Math.max(0, previousProgress);
  rec.status = rec.reactivatedState && rec.reactivatedState !== "FINALIZADO" ? rec.reactivatedState : "EN REVISIÓN";
  rec.archivedAt = "";
  rec.archivedBy = "";
  rec.deletedAt = "";
  rec.deletedBy = "";
  rec.employeeDeadlineUnlockRequested = false;
  rec.autoCorrection = false;
  rec.autoCorrectionAttempts = 0;
  rec.autoCorrectionForced = false;
  rec.autoCorrectionSentAt = "";
  rec.autoCorrectionDiscount = 0;
  rec.finalizationPublishedAt = "";
  rec.adminReactivateAllowed = true;
  rec.beforeFinishedTracking = null;
  rec.reactivatedAt = new Date().toISOString();
  rec.reactivatedBy = "Administrador";
  rec.progress = nextProgress;
  rec.publishedProgress = nextProgress;
  rec.progressLabel = rec.status;
  if (!rec.tracking) rec.tracking = {};
  rec.tracking.state = rec.status;
  rec.pendingTracking = {
    status: "pending",
    employeeName: rec.employeeName || "EMPLEADO",
    submittedAt: new Date().toISOString(),
    state: rec.status,
    progress: nextProgress,
    processDetails: rec.tracking.processDetails || "",
    images: Array.isArray(rec.trackingImages) ? rec.trackingImages : []
  };
  return rec;
}

function restoreReceptionBackup(backup) {
  const rec = backup?.reception;
  if (!rec?.number) throw new Error("El respaldo individual no contiene una recepción válida.");
  rec.archivedAt = "";
  rec.archivedBy = "";
  rec.deletedAt = "";
  rec.deletedBy = "";
  rec.localArchiveConfirmedAt = "";
  AM_SIMPLE_STORE.mutate((current) => {
    if (!Array.isArray(current.receptions)) current.receptions = [];
    if (!Array.isArray(current.deletedReceptionNumbers)) current.deletedReceptionNumbers = [];
    if (!Array.isArray(current.reservedReceptionNumbers)) current.reservedReceptionNumbers = [];
    current.deletedReceptionNumbers = current.deletedReceptionNumbers.filter((number) => number !== rec.number);
    current.reservedReceptionNumbers = current.reservedReceptionNumbers.filter((number) => number !== rec.number);
    const existing = current.receptions.findIndex((item) => item.number === rec.number || item.id === rec.id);
    if (existing >= 0) current.receptions[existing] = rec;
    else current.receptions.unshift(rec);
    current.selectedId = rec.id;
  });
  mergeArchiveStore("am_master_taller_archives_v1", backup.archives?.master || {});
  localStorage.removeItem("am_quick_taller_archives_v1");
  persistRestoredArchiveAliases(rec, backup);
  upsertEmployeeVehicle(backup.employeeVehicle || employeeVehicleFromReception(rec));
}

function restoreFullProgramBackup(backup) {
  if (backup?.appState?.receptions) {
    AM_SIMPLE_STORE.save(backup.appState);
  }
  const restoredEmployeeState = { selected: "", seq: 0, vehicles: [] };
  (backup.appState?.receptions || backup.receptions?.map((item) => item.reception) || []).filter(Boolean).forEach((rec) => {
    restoredEmployeeState.vehicles.push(employeeVehicleFromReception(rec));
  });
  restoredEmployeeState.seq = restoredEmployeeState.vehicles.length;
  setStorageSafely("am_employee_module_safe_v2", JSON.stringify(restoredEmployeeState), JSON.stringify({ selected: "", seq: 0, vehicles: [] }));
  mergeArchiveStore("am_master_taller_archives_v1", backup.archives?.master || {});
  localStorage.removeItem("am_quick_taller_archives_v1");
  (backup.receptions || []).forEach((item) => {
    if (item?.reception?.number) {
      mergeArchiveStore("am_master_taller_archives_v1", item.archives?.master || {});
      persistRestoredArchiveAliases(item.reception, item);
      upsertEmployeeVehicle(item.employeeVehicle || employeeVehicleFromReception(item.reception));
    }
  });
}

async function importBackupFile(file, expectedType = "") {
  if (!file) return;
  const backup = JSON.parse(await file.text());
  if (expectedType === "single" && backup.type !== "am-recepcion-backup") {
    throw new Error("Este botón solo acepta respaldos individuales de cliente/vehículo.");
  }
  if (expectedType === "full" && backup.type !== "am-recepcion-full-backup") {
    throw new Error("Este botón solo acepta respaldos completos del programa.");
  }
  if (backup.type === "am-recepcion-backup") {
    restoreReceptionBackup(backup);
    toast("Respaldo individual cargado.");
  } else if (backup.type === "am-recepcion-full-backup") {
    restoreFullProgramBackup(backup);
    toast("Respaldo completo cargado.");
  } else {
    throw new Error("El archivo no corresponde a un respaldo de Automotriz Medina.");
  }
  renderAdmin();
  showSection("dashboard");
}

function renderBackupPreview(backup) {
  const host = qs("[data-backup-viewer-content]");
  const restoreButton = qs("[data-preview-restore]");
  if (!host) return;
  previewBackup = null;
  if (!backup || backup.type !== "am-recepcion-backup" || !backup.reception) {
    if (restoreButton) restoreButton.disabled = true;
    host.innerHTML = '<div class="notice warn">Este visor temporal solo acepta respaldos individuales de cliente.</div>';
    return;
  }
  previewBackup = backup;
  const rec = backup.reception;
  if (restoreButton) restoreButton.disabled = false;
  const frameHtml = backup.files?.expedienteHtml || backupWorkbook(rec);
  host.innerHTML = `
    <article class="panel backup-preview">
      <div class="panel-header">
        <div><h3>${esc(rec.number || "Expediente")}</h3><p>Vista temporal. No altera el dashboard hasta restaurarlo.</p></div>
        <span class="pill info">Temporal</span>
      </div>
      <div class="panel-body grid">
        <div class="grid cols-4">
          <div class="metric"><span>Cliente</span><strong>${esc(rec.client?.name || "Cliente pendiente")}</strong><small>${esc(rec.client?.phone || "Sin teléfono")}</small></div>
          <div class="metric"><span>Vehículo</span><strong>${esc(`${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""}`.trim() || "Vehículo")}</strong><small>${esc(`${rec.vehicle?.anio || ""} ${rec.vehicle?.placa || ""}`.trim() || "Sin placa")}</small></div>
          <div class="metric"><span>Técnico</span><strong>${esc(rec.employeeName || "N/D")}</strong><small>${esc(rec.status || "Sin estado")}</small></div>
          <div class="metric"><span>Autorización</span><strong>${rec.signed ? "Autorizado" : "Pendiente"}</strong><small>${esc(rec.signatureDate || "")}</small></div>
        </div>
        <div class="photo-grid">
          <article class="photo-card">${photoVisual(frontReceptionPhoto(rec) || { label: "Frente", dataUrl: "" })}<div class="field"><label>Fotografía</label></div></article>
          <article class="photo-card">${photoVisual(receptionPhotoByLabel(rec, "Tarjeta reverso") || { label: "Tarjeta reverso", dataUrl: "" })}<div class="field"><label>Tarjeta reverso</label></div></article>
          <article class="photo-card">${photoVisual(receptionPhotoByLabel(rec, "Tarjeta frente") || { label: "Tarjeta frente", dataUrl: "" })}<div class="field"><label>Tarjeta frente</label></div></article>
        </div>
        <iframe class="backup-preview-frame" title="Expediente temporal" srcdoc="${esc(frameHtml)}"></iframe>
      </div>
    </article>`;
}

async function previewBackupFile(file) {
  if (!file) return;
  const backup = JSON.parse(await file.text());
  renderBackupPreview(backup);
  toast("Expediente cargado en visor temporal.");
}

function textBytes(text) {
  return new TextEncoder().encode(String(text == null ? "" : text));
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => {
    out.set(chunk, offset);
    offset += chunk.length;
  });
  return out;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipTimeParts(date = new Date()) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: (date.getFullYear() - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function zipHeader(values) {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return bytes;
}

function zipLongs(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value >>> 0, true));
  return bytes;
}

function createZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = zipTimeParts();
  files.forEach((file) => {
    const name = textBytes(file.path.replace(/\\/g, "/"));
    const data = typeof file.data === "string" ? textBytes(file.data) : file.data;
    const crc = crc32(data);
    const local = concatBytes([
      zipLongs([0x04034b50]),
      zipHeader([20, 0x0800, 0, now.time, now.day]),
      zipLongs([crc, data.length, data.length]),
      zipHeader([name.length, 0]),
      name,
      data
    ]);
    const central = concatBytes([
      zipLongs([0x02014b50]),
      zipHeader([20, 20, 0x0800, 0, now.time, now.day]),
      zipLongs([crc, data.length, data.length]),
      zipHeader([name.length, 0, 0, 0, 0, 0]),
      zipLongs([offset]),
      name
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  });
  const centralBytes = concatBytes(centrals);
  const localBytes = concatBytes(locals);
  const end = concatBytes([
    zipLongs([0x06054b50]),
    zipHeader([0, 0, files.length, files.length]),
    zipLongs([centralBytes.length, localBytes.length]),
    zipHeader([0])
  ]);
  return concatBytes([localBytes, centralBytes, end]);
}

function dataUrlFile(dataUrl, fallbackName) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
  const raw = match[2] ? atob(match[3]) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return { name: `${safeFileName(fallbackName)}.${ext}`, bytes };
}

function backupFolderName(rec, index) {
  const client = safeFileName(rec.client?.name || "sin-cliente");
  const vehicle = safeFileName(`${rec.vehicle?.marca || ""}-${rec.vehicle?.modelo || ""}-${rec.vehicle?.anio || ""}` || "vehiculo");
  return `${String(index + 1).padStart(2, "0")}-${safeFileName(rec.number || rec.id)}-${client}-${vehicle}`;
}

function allBackupSummaryWorkbook(receptions) {
  return workbookHtml("Resumen general de recepciones", `
    <p class="muted">Generado: ${esc(excelDate())}</p>
    ${tableRows(["Recepción", "Cliente", "Teléfono", "Vehículo", "Técnico", "Estado", "Autorización", "Motivo"], receptions.map((rec) => [
      rec.number || "",
      rec.client?.name || "",
      rec.client?.phone || "",
      `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim(),
      rec.employeeName || "",
      rec.status || "",
      rec.signed ? "Autorizado" : (rec.express ? "No aplica" : "Pendiente"),
      serviceReason(rec) || ""
    ]))}
  `);
}

function collectReceptionFiles(rec, index) {
  const folder = `respaldo-automotriz-medina/${backupFolderName(rec, index)}`;
  const files = [
    { path: `${folder}/datos-expediente.json`, data: JSON.stringify(rec, null, 2) },
    { path: `${folder}/expediente-completo.xls`, data: backupWorkbook(rec) },
    { path: `${folder}/expediente-completo.html`, data: backupWorkbook(rec) },
    { path: `${folder}/archivo-taller.xls`, data: masterArchiveForReception(rec)?.html || masterWorkbookFallback(rec) }
  ];
  receptionPhotos(rec).forEach((photo, photoIndex) => {
    const file = dataUrlFile(photo.dataUrl, `${String(photoIndex + 1).padStart(2, "0")}-${photo.label || "foto-recepcion"}`);
    if (file) files.push({ path: `${folder}/fotografias-recepcion/${file.name}`, data: file.bytes });
  });
  (rec.damages || []).forEach((damage, damageIndex) => {
    (damage.photos || []).forEach((photo, photoIndex) => {
      const file = dataUrlFile(photo.dataUrl, `${String(damageIndex + 1).padStart(2, "0")}-${damage.área || damage.area || "danio"}-${photoIndex + 1}`);
      if (file) files.push({ path: `${folder}/fotografias-danios/${file.name}`, data: file.bytes });
    });
  });
  return files;
}

function downloadAllProgramBackup() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  downloadBlob(`respaldo-completo-automotriz-medina-${stamp}.amr`, JSON.stringify(buildFullProgramBackup(), null, 2), "application/json;charset=utf-8");
}

function masterArchiveForReception(rec) {
  try {
    if (rec?.__localBackup?.files?.archivoTallerHtml) {
      return {
        rec: rec.number,
        updatedAt: rec.__localBackup.exportedAt || new Date().toISOString(),
        data: vehiclePayloadFromReception(rec),
        html: rec.__localBackup.files.archivoTallerHtml
      };
    }
    const master = JSON.parse(localStorage.getItem("am_master_taller_archives_v1") || "{}") || {};
    const quick = JSON.parse(localStorage.getItem("am_quick_taller_archives_v1") || "{}") || {};
    const lookupKeys = [rec.number, rec.id, rec.vehicle?.vin, rec.vehicle?.placa].map(archiveNorm).filter(Boolean);
    const exactCandidates = lookupKeys.flatMap((key) => [
      master[key],
      master[rec.number],
      master[rec.id],
      quick[key],
      quick[rec.number],
      quick[rec.id]
    ]);
    const scannedCandidates = [
      ...Object.values(master),
      ...Object.values(quick)
    ].filter((archive) => archiveMatchesReception(archive, rec));
    const candidates = [...exactCandidates, ...scannedCandidates].filter(Boolean);
    if (!candidates.length) return null;
    const archive = newestUsefulArchive(candidates);
    if (archive && !archive.html) {
      return {
        ...archive,
        html: archiveDataWorkbook(archive, rec)
      };
    }
    return archive;
  } catch {
    return null;
  }
}

function archiveDataWorkbook(archive, rec) {
  const data = archiveDataFromCandidate(archive) || {};
  const profile = trackingProfile(rec);
  const title = `Archivo taller ${data.rec || rec.number || ""}`.trim();
  const items = Array.isArray(data.items) ? data.items : [];
  const parts = Array.isArray(data.repuestos) ? data.repuestos : [];
  const authItems = Array.isArray(data.authItems) ? data.authItems : [];
  const authParts = Array.isArray(data.authRepuestos) ? data.authRepuestos : [];
  const itemRows = items.map((item) => [
    item.tipo || item.type || "",
    item.cant || item.cantidad || "",
    item.descripcion || item.description || "",
    item.asistencia || "",
    item.autorizado ? "Si" : ""
  ]);
  const partRows = parts.map((item) => [
    item.cant || item.cantidad || "",
    item.descripcion || item.description || "",
    item.precio || item.price || "",
    item.total || ""
  ]);
  const authRows = authItems.map((item) => [
    item.tipo || item.type || "",
    item.cant || item.cantidad || "",
    item.descripcion || item.description || "",
    item.asistencia || "",
    item.autorizado ? "Si" : ""
  ]);
  const authPartRows = authParts.map((item) => [
    item.cant || item.cantidad || "",
    item.descripcion || item.description || "",
    item.precio || item.price || "",
    item.total || ""
  ]);
  return workbookHtml(title, `
    <p class="muted">Archivo cargado desde el respaldo guardado para este expediente.</p>
    ${kvRows([
      ["Recepción", data.rec || rec.number],
      ["Fecha recepción", data.fecha || profile.receptionDate || ""],
      ["Hora", data.hora || ""],
      ["Técnico", data.tecnico || rec.employeeName || ""],
      ["Cliente", rec.client?.name || ""],
      ["Teléfono", rec.client?.phone || ""],
      ["Marca", data.marca || rec.vehicle?.marca || ""],
      ["Modelo", data.modelo || rec.vehicle?.modelo || ""],
      ["Año", data.anio || rec.vehicle?.anio || ""],
      ["Color", data.color || rec.vehicle?.color || ""],
      ["VIN", data.vin || rec.vehicle?.vin || ""],
      ["Placa", data.placa || rec.vehicle?.placa || ""],
      ["Odómetro", data.odometro || rec.vehicle?.kilometraje || ""],
      ["Estado", rec.status || ""],
      ["Motivo", serviceReason(rec) || ""]
    ])}
    <h2>Ingreso</h2>
    ${tableRows(["Tipo", "Cant", "Descripción", "Asistencia", "Autorizado"], itemRows)}
    <h2>Repuestos</h2>
    ${tableRows(["Cant", "Descripción", "Precio", "Total"], partRows)}
    <h2>Autorizado</h2>
    ${tableRows(["Tipo", "Cant", "Descripción", "Asistencia", "Autorizado"], authRows)}
    <h2>Repuestos autorizados</h2>
    ${tableRows(["Cant", "Descripción", "Precio", "Total"], authPartRows)}
  `);
}

function masterWorkbookFallback(rec) {
  const profile = trackingProfile(rec);
  return workbookHtml(`Archivo taller ${rec.number}`, `
    <p class="muted">Este expediente todavía no tiene un archivo de taller guardado. Se muestra una ficha base con los datos disponibles.</p>
    ${kvRows([["Recepción", rec.number], ["Fecha recepción", profile.receptionDate || ""], ["Técnico", rec.employeeName || ""], ["Cliente", rec.client?.name || ""], ["Teléfono", rec.client?.phone || ""], ["Vehículo", `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim()], ["Color", rec.vehicle?.color || ""], ["VIN", rec.vehicle?.vin || ""], ["Placa", rec.vehicle?.placa || ""], ["Odómetro", rec.vehicle?.kilometraje || ""], ["Estado", rec.status || ""], ["Motivo", serviceReason(rec) || ""]])}
  `);
}

function trackingProfile(rec) {
  if (!rec.tracking) {
    rec.tracking = {
      receptionDate: "18/6/2026, 3:23:00 p.m.",
      deliveryEstimate: "",
      odometer: "81,046 MILLAS",
      plate: "N/D",
      vehicleTitle: "NISSAN VERSA 2020",
      state: "EN DIAGNÓSTICO",
      processDetails: "Revisión de suspensión y dirección"
    };
    rec.progress = 20;
    rec.progressLabel = rec.tracking.state;
  }
  return rec.tracking;
}

function renderNav() {
  const buttons = qsa("[data-section-target]");
  if (!buttons.length) return;
  const mobile = qs("[data-mobile-nav]");
  buttons.forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.sectionTarget === "dashboard") {
      adminLocalArchivePreviewRec = null;
      adminDashboardFilter = "all";
      adminEmployeeFilter = "";
      const employeeMenu = qs("[data-employee-filter-menu]");
      if (employeeMenu) employeeMenu.classList.add("hidden");
      if (document.body.dataset.page === "admin") pushAdminHash("dashboard");
    }
    showSection(button.dataset.sectionTarget, { fromExpediente: button.hasAttribute("data-expediente-vineta") });
    if (button.dataset.sectionTarget === "dashboard") renderReceptionTable();
    if (button.dataset.sectionTarget === "clientes") renderClientCatalog();
    if (button.dataset.sectionTarget === "visor-local") loadLocalArchivedBackups().catch((error) => {
      console.warn("No se pudieron cargar expedientes descargados", error);
      renderLocalArchiveStatus("No se pudieron cargar los expedientes descargados.");
    });
  }));
  if (mobile) mobile.addEventListener("change", (event) => {
    const value = event.target.value;
    const dashboardOptions = {
      dashboard: { filter: "all", employee: "" },
      "workshop-dashboard": { filter: "workshop", employee: "" },
      "finished-dashboard": { filter: "finished", employee: "" },
      "employee-edwin-dashboard": { filter: "employee", employee: "edwin" },
      "employee-cristian-dashboard": { filter: "employee", employee: "cristian" },
      "employee-rafael-dashboard": { filter: "employee", employee: "rafael" },
      "archived-dashboard": { filter: "archived", employee: "" },
      "trash-dashboard": { filter: "trash", employee: "" }
    };
    const dashboardOption = dashboardOptions[value];
    if (dashboardOption) {
      adminDashboardFilter = dashboardOption.filter;
      adminEmployeeFilter = dashboardOption.employee;
      adminLocalArchivePreviewRec = null;
      showSection("dashboard");
      renderReceptionTable();
      pushAdminHash("dashboard");
      mobile.value = value;
      return;
    }
    showSection(value);
    if (value === "visor-local") loadLocalArchivedBackups().catch((error) => {
      console.warn("No se pudieron cargar expedientes descargados", error);
      renderLocalArchiveStatus("No se pudieron cargar los expedientes descargados.");
    });
  });
  showSection(buttons[0].dataset.sectionTarget);
}

const wizardOrder = ["datos", "fotos", "inventario", "danos", "finalizar"];

function showEmployeeStep(index) {
  const target = wizardOrder[Math.max(0, Math.min(index, wizardOrder.length - 1))];
  qsa("[data-section]").forEach((section) => section.classList.toggle("hidden", section.dataset.section !== target));
  qsa("[data-section-target]").forEach((button) => button.classList.toggle("active", button.dataset.sectionTarget === target));
  const mobile = qs("[data-mobile-nav]");
  if (mobile) mobile.value = target;
  const finalSummary = qs("[data-final-summary]");
  if (finalSummary) {
    const rec = selected();
    finalSummary.innerHTML = `
      <div class="grid cols-3">
        <div class="metric"><span>Vehículo</span><strong>${esc(rec.vehicle.marca || "Pendiente")} ${esc(rec.vehicle.modelo || "")}</strong><small>${esc(rec.vehicle.placa || "Sin placa")}</small></div>
        <div class="metric"><span>Fotos</span><strong>${receptionPhotos(rec).filter((p) => p.dataUrl).length}/${receptionPhotos(rec).length}</strong><small>Cargadas</small></div>
        <div class="metric"><span>Daños</span><strong>${rec.damages.length}</strong><small>Registrados</small></div>
      </div>`;
  }
}

function renderTabs() {
  qsa("[data-tabs]").forEach((tabs) => {
    if (tabs.dataset.tabsReady) return;
    tabs.dataset.tabsReady = "1";
    const host = tabs.closest(".panel");
    const buttons = qsa("[data-tab-target]", tabs);
    const panels = qsa("[data-tab]", host);
    const show = (target) => {
      buttons.forEach((button) => button.classList.toggle("active", button.dataset.tabTarget === target));
      panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.tab === target));
    };
    buttons.forEach((button) => button.addEventListener("click", () => show(button.dataset.tabTarget)));
    if (buttons[0]) show(buttons[0].dataset.tabTarget);
  });
}

let adminFileTab = "";
let adminDashboardFilter = "all";
let adminEmployeeFilter = "";
let trashSelectedIds = new Set();
let previewBackup = null;
let adminDashboardQuickSearch = "";
let adminTrackingDraft = null;
let adminSearchFilters = {
  text: "",
  dateFrom: "",
  dateTo: "",
  vehicleYear: ""
};

function isArchived(rec) {
  return !!rec?.archivedAt && !rec?.deletedAt;
}

function isDeleted(rec) {
  return !!rec?.deletedAt;
}

function isPublishedFinalized(rec) {
  return String(rec?.status || "").toUpperCase() === "FINALIZADO" && !!rec?.finalizationPublishedAt;
}

function isActiveDashboardRec(rec) {
  return !isArchived(rec) && !isDeleted(rec);
}

function employeeDisplayName(id) {
  const key = String(id || "").toLowerCase();
  return ({ edwin: "EDWIN", rafael: "RAFAEL", cristian: "CRISTIAN" }[key] || String(id || "EMPLEADO")).toUpperCase();
}

function notificationId() {
  return `ntf_${Date.now()}_${AM_SIMPLE_STORE.cryptoToken()}`;
}

function notificationDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("es-SV");
}

const ALERTZY_EMPLOYEE_ACCOUNT_KEY = "vyeddqocw7iw9jk";
const ALERTZY_ADMIN_ACCOUNT_KEY = "pjxh9op73pp1z21";
const ALERTZY_ACCOUNT_KEY = ALERTZY_EMPLOYEE_ACCOUNT_KEY;

function alertzyPriorityLabel(priority) {
  return priority === "danger" ? "Código rojo urgente" : "Código amarillo";
}

function alertzyBody(title, message, accountKey = ALERTZY_ACCOUNT_KEY) {
  const params = new URLSearchParams();
  params.set("accountKey", accountKey);
  params.set("title", title || "Automotriz Medina");
  params.set("message", message || "");
  params.set("group", "Automotriz Medina");
  return params;
}

async function sendAlertzySilent(title, message, accountKey = ALERTZY_ACCOUNT_KEY, priority = 0) {
  if (!accountKey) return false;
  const params = alertzyBody(title, message, accountKey);
  params.set("priority", String(Number(priority) || 0));
  try {
    // Envío directo: evita depender de permisos UrlFetchApp del Apps Script.
    await fetch("https://alertzy.app/send", {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
      keepalive: true
    });
    return true;
  } catch (error) {
    console.warn("Alertzy fetch falló; intentando sendBeacon", error);
    try {
      if (navigator?.sendBeacon) return !!navigator.sendBeacon("https://alertzy.app/send", params);
    } catch (beaconError) {
      console.warn("Alertzy sendBeacon tampoco pudo enviar", beaconError);
    }
    return false;
  }
}

async function sendAlertzyNotification(payload = {}) {
  const employeeName = String(payload.employeeName || "EMPLEADO").toUpperCase();
  const type = String(payload.type || "Notificacion");
  const priority = payload.priority === "danger" ? 2 : 1;
  const lines = [
    `Tecnico: ${employeeName}`,
    payload.recNumber ? `Recepcion: ${payload.recNumber}` : "",
    payload.vehicleTitle ? `Vehiculo: ${payload.vehicleTitle}` : "",
    payload.plate ? `Placa: ${payload.plate}` : "",
    String(payload.message || "").trim()
  ].filter(Boolean);
  return sendAlertzySilent(`${type} - ${employeeName}`, lines.join("\n"), ALERTZY_EMPLOYEE_ACCOUNT_KEY, priority);
}

function clientAvailabilityMessage(rec) {
  return `Hola Automotriz Medina, confirmo que estoy disponible para ser contactado sobre mi vehiculo, expediente ${rec?.number || "N/D"}. Quedo atento.`;
}

function clientAvailabilityWhatsappUrl(rec) {
  return `https://wa.me/50371660867?text=${encodeURIComponent(clientAvailabilityMessage(rec))}`;
}

async function forceReloadApplication(button = null) {
  const original = button?.textContent || "↻ Recargar";
  if (button) { button.disabled = true; button.textContent = "↻ Recargando…"; }
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.update().catch(() => null)));
    }
  } catch (error) {
    console.warn("No se pudo comprobar actualización del service worker", error);
  }
  const url = new URL(location.href);
  url.searchParams.set("_amreload", String(Date.now()));
  if (button) button.textContent = original;
  location.replace(url.toString());
}

function whatsappLogoSvg() {
  return '<svg class="whatsapp-logo" viewBox="0 0 448 512" aria-hidden="true" focusable="false"><path fill="currentColor" d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>';
}

function finalDeliverySchedule(rec, profile = trackingProfile(rec)) {
  return {
    date: profile?.finalDeliveryDate || rec?.finalDelivery?.date || "",
    time: profile?.finalDeliveryTime || rec?.finalDelivery?.time || ""
  };
}

function formatFinalDeliveryDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || "");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.toLocaleDateString("es-SV", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatFinalDeliveryTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return String(value || "");
  const date = new Date(2000, 0, 1, Number(match[1]), Number(match[2]));
  return date.toLocaleTimeString("es-SV", { hour: "numeric", minute: "2-digit", hour12: true });
}

function finalDeliveryWhatsappUrl(rec, dateText, timeText) {
  const message = `Hola, Automotriz Medina. He visto que mi vehículo, expediente ${rec?.number || "N/D"}, estará disponible para entrega el ${dateText} a las ${timeText}. Quisiera comunicarme con ustedes sobre la entrega. Gracias.`;
  return `https://wa.me/50371660867?text=${encodeURIComponent(message)}`;
}

function needsFinalDeliverySchedule(rec, nextState) {
  if (String(nextState || "").toUpperCase() !== "FINALIZADO") return false;
  const currentState = String(rec?.tracking?.state || "").toUpperCase();
  const schedule = finalDeliverySchedule(rec, rec?.tracking || {});
  return currentState !== "FINALIZADO" || !schedule.date || !schedule.time;
}

function applyFinalDeliverySchedule(rec, schedule) {
  if (!rec || !schedule) return;
  const profile = trackingProfile(rec);
  rec.finalDelivery = {
    date: schedule.date,
    time: schedule.time,
    scheduledAt: new Date().toISOString()
  };
  profile.deliveryEstimate = schedule.date;
  profile.finalDeliveryDate = schedule.date;
  profile.finalDeliveryTime = schedule.time;
}

function clientRequestFingerprint(row) {
  return String(row?.text || "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);
}

function clientRequestConfirmationKey(rec, rowIndex, type, row) {
  const token = rec?.trackingToken || rec?.clientToken || rec?.id || rec?.number || "tracking";
  return `am_client_request_confirmed_${token}_${rowIndex}_${type}_${clientRequestFingerprint(row)}`;
}

function readClientRequestConfirmation(rec, rowIndex, type, row) {
  try {
    const raw = localStorage.getItem(clientRequestConfirmationKey(rec, rowIndex, type, row));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function rememberClientRequestConfirmation(rec, rowIndex, type, row) {
  const confirmation = {
    type,
    confirmedAt: new Date().toLocaleString("es-SV"),
    confirmedLabel: CLIENT_REQUEST_TYPES[type]?.done || "Confirmado por el cliente."
  };
  try {
    localStorage.setItem(clientRequestConfirmationKey(rec, rowIndex, type, row), JSON.stringify(confirmation));
  } catch (error) {
    console.warn("No se pudo guardar confirmacion local del cliente", error);
  }
  return confirmation;
}

async function sendClientAvailabilityAlertzy(rec, rowIndex) {
  if (!ALERTZY_ADMIN_ACCOUNT_KEY || !rec) return false;
  const vehicleTitle = [rec.vehicle?.marca, rec.vehicle?.modelo, rec.vehicle?.anio].filter(Boolean).join(" ").trim();
  const lines = [
    "Cliente confirmo disponibilidad para ser contactado.",
    `Recepcion: ${rec.number || "N/D"}`,
    `Cliente: ${rec.client?.name || "N/D"}`,
    `Telefono: ${rec.client?.phone || "N/D"}`,
    vehicleTitle ? `Vehiculo: ${vehicleTitle}` : "",
    Number.isFinite(rowIndex) ? `Renglon seguimiento: ${rowIndex + 1}` : ""
  ].filter(Boolean);
  return sendAlertzySilent("Cliente disponible para contacto", lines.join("\n"), ALERTZY_ADMIN_ACCOUNT_KEY);
}

async function sendClientAuthorizationAlertzy(rec, rowIndex) {
  if (!ALERTZY_ADMIN_ACCOUNT_KEY || !rec) return false;
  const vehicleTitle = [rec.vehicle?.marca, rec.vehicle?.modelo, rec.vehicle?.anio].filter(Boolean).join(" ").trim();
  const lines = [
    "Cliente autorizo una solicitud del seguimiento.",
    `Recepcion: ${rec.number || "N/D"}`,
    `Cliente: ${rec.client?.name || "N/D"}`,
    `Telefono: ${rec.client?.phone || "N/D"}`,
    vehicleTitle ? `Vehiculo: ${vehicleTitle}` : "",
    Number.isFinite(rowIndex) ? `Renglon seguimiento: ${rowIndex + 1}` : ""
  ].filter(Boolean);
  return sendAlertzySilent("Cliente autorizo solicitud", lines.join("\n"), ALERTZY_ADMIN_ACCOUNT_KEY);
}

function ensureEmployeeNotifications(current) {
  if (!Array.isArray(current.employeeNotifications)) current.employeeNotifications = [];
  return current.employeeNotifications;
}

function ensureReceptionNotifications(rec) {
  if (!Array.isArray(rec.employeeNotifications)) rec.employeeNotifications = [];
  return rec.employeeNotifications;
}

function renderNotificationCards(items, emptyText = "Sin notificaciones.") {
  if (!items || !items.length) return `<div class="notice">${emptyText}</div>`;
  const cardStatus = (item) => item.completedAt && item.adminAckAt ? "validated" : (item.completedAt ? "completed" : "active");
  return items.map((item) => `
    <article class="notice notification-card priority-${esc(item.priority || "warn")} ${cardStatus(item)}">
      <strong>${esc(item.employeeName || employeeDisplayName(item.employeeId))}</strong>
      <span class="pill ${item.priority === "danger" ? "danger" : "warn"}">${item.priority === "danger" ? "Rojo" : "Amarillo"}</span>
      <small>${item.recNumber ? `Vehículo: ${esc(item.recNumber)}` : "Notificación general"}</small>
      ${item.completedAt && !item.adminAckAt ? '<span class="pill danger">Empleado cumplió - pendiente de validar</span>' : ""}
      ${item.completedAt && item.adminAckAt ? '<span class="pill ok">Cumplimiento validado</span>' : ""}
      <p>${esc(item.message || "")}</p>
      <small>${esc(notificationDate(item.createdAt || new Date().toISOString()))}</small>
      ${item.completedAt ? `<br><small><strong>${esc(item.completedBy || "Empleado")} ya realizó lo solicitado:</strong> ${esc(notificationDate(item.completedAt))}</small>` : ""}
      ${item.adminAckAt ? `<br><small><strong>Validado por administración:</strong> ${esc(notificationDate(item.adminAckAt))}</small>` : ""}
      <div class="btn-row" style="margin-top:10px">
        <button type="button" class="btn" data-action="edit-notification" data-id="${esc(item.id)}">Editar</button>
        <button type="button" class="btn danger" data-action="delete-notification" data-id="${esc(item.id)}">Eliminar</button>
        ${item.completedAt && !item.adminAckAt ? `<button type="button" class="btn primary" data-action="ack-notification" data-id="${esc(item.id)}">Validar cumplimiento</button>` : ""}
        ${item.completedAt && item.adminAckAt ? `<button type="button" class="btn" data-action="reactivate-notification" data-id="${esc(item.id)}">Reactivar notificación</button>` : ""}
      </div>
    </article>`).join("");
}

function notifierReceptions(employeeId = "") {
  const current = state();
  return (current.receptions || [])
    .filter((rec) => !isDeleted(rec) && !isArchived(rec))
    .filter((rec) => {
      if (!employeeId) return true;
      const recEmployee = String(rec.employeeId || rec.employeeName || "").toLowerCase();
      return recEmployee === employeeId || normalizeSearchText(rec.employeeName || "") === employeeId;
    })
    .sort((a, b) => String(b.number || "").localeCompare(String(a.number || "")));
}

function notifierVehicleLabel(rec) {
  const vehicle = `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim() || "Vehículo";
  const client = rec.client?.name || "Cliente pendiente";
  const employee = rec.employeeName || employeeDisplayName(rec.employeeId || "");
  return `${rec.number || "Sin recepción"} · ${vehicle} · ${client} · ${employee}`;
}

function notifierVehicleSearchText(rec) {
  return normalizeSearchText([
    rec.number,
    rec.client?.name,
    rec.client?.phone,
    rec.employeeName,
    rec.employeeId,
    rec.vehicle?.marca,
    rec.vehicle?.modelo,
    rec.vehicle?.anio,
    rec.vehicle?.placa,
    rec.vehicle?.vin,
    serviceReason(rec)
  ].filter(Boolean).join(" "));
}

function renderNotifierVehicles() {
  const select = qs("[data-notifier-vehicle-select]");
  if (!select) return;
  const employeeId = qs("[data-notifier-vehicle-employee]")?.value || "";
  const search = normalizeSearchText(qs("[data-notifier-vehicle-search]")?.value || "");
  const previous = select.value;
  const records = notifierReceptions(employeeId).filter((rec) => !search || notifierVehicleSearchText(rec).includes(search));
  if (!employeeId) {
    select.innerHTML = '<option value="">Primero seleccione tecnico</option>';
  } else if (!records.length) {
    select.innerHTML = '<option value="">No hay vehiculos para este tecnico</option>';
  } else {
    select.innerHTML = records.map((rec) => `<option value="${esc(rec.id)}">${esc(notifierVehicleLabel(rec))}</option>`).join("");
  }
  if (records.some((rec) => rec.id === previous)) select.value = previous;
  renderNotifierVehiclePreview();
}

function renderNotifierVehiclePreview() {
  const host = qs("[data-notifier-vehicle-preview]");
  if (!host) return;
  const recId = qs("[data-notifier-vehicle-select]")?.value || "";
  const rec = notifierReceptions().find((item) => item.id === recId);
  if (!rec) {
    host.innerHTML = '<div class="notice">Seleccione tecnico y vehiculo para continuar.</div>';
    return;
  }
  const vehicle = `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim() || "Vehículo";
  host.innerHTML = `
    <div class="grid cols-3 notifier-vehicle-summary">
      <div class="metric"><span>Recepción</span><strong>${esc(rec.number || "")}</strong><small>${esc(rec.status || "")}</small></div>
      <div class="metric"><span>Vehículo</span><strong>${esc(vehicle)}</strong><small>${esc(rec.vehicle?.placa || rec.vehicle?.vin || "Sin placa")}</small></div>
      <div class="metric"><span>Responsable</span><strong>${esc(rec.employeeName || employeeDisplayName(rec.employeeId || ""))}</strong><small>${esc(rec.client?.name || "Cliente pendiente")}</small></div>
    </div>`;
}

function renderNotifier() {
  qsa("[data-notifier-step]").forEach((item) => {
    const step = item.dataset.notifierStep || "";
    item.classList.toggle("hidden", step !== (notifierMode || "choice"));
  });
  qsa("[data-notifier-mode]").forEach((button) => {
    button.classList.toggle("primary", button.dataset.notifierMode === notifierMode);
  });
  renderNotifierVehicles();
}

function setNotifierMode(mode, pushHistory = true) {
  const nextMode = mode || "choice";
  if (pushHistory && document.body.dataset.page === "notificador" && nextMode !== "choice") {
    history.pushState({ notifierMode: nextMode }, "", `#${nextMode}`);
  }
  notifierMode = nextMode;
  renderNotifier();
}

async function sendNotifierGlobal() {
  const employeeId = qs("[data-notifier-general-employee]")?.value || "";
  const priority = qs("[data-notifier-general-priority]")?.value || "warn";
  const textField = qs("[data-notifier-general-message]");
  const message = textField?.value.trim() || "";
  if (!employeeId || !message) {
    toast("Seleccione empleado y escriba la notificación.", "warn");
    return;
  }
  const employeeName = employeeDisplayName(employeeId);
  AM_SIMPLE_STORE.mutate((current) => {
    ensureEmployeeNotifications(current).unshift({
      id: notificationId(),
      employeeId,
      employeeName,
      message,
      priority,
      createdAt: new Date().toISOString(),
      read: false
    });
  });
  const saved = await confirmCloudSaved("Notificación general enviada.", "notifier-global");
  if (!saved) return;
  const alertSent = await sendAlertzyNotification({
    employeeName,
    type: "Notificación general",
    priority,
    message
  });
  if (!alertSent) toast("Quedó guardada, pero Alertzy no confirmó el aviso externo.", "warn");
  if (textField) textField.value = "";
  renderNotifier();
}

async function sendNotifierVehicle() {
  const recId = qs("[data-notifier-vehicle-select]")?.value || "";
  const priority = qs("[data-notifier-vehicle-priority]")?.value || "warn";
  const textField = qs("[data-notifier-vehicle-message]");
  const message = textField?.value.trim() || "";
  if (!recId || !message) {
    toast("Seleccione vehículo y escriba la notificación.", "warn");
    return;
  }
  let alertPayload = null;
  AM_SIMPLE_STORE.mutate((current) => {
    const rec = (current.receptions || []).find((item) => item.id === recId);
    if (!rec) return;
    const employeeId = rec.employeeId || String(rec.employeeName || "edwin").toLowerCase();
    const employeeName = rec.employeeName || employeeDisplayName(employeeId);
    const vehicleTitle = `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim();
    alertPayload = {
      employeeName,
      type: "Notificación de vehículo",
      priority,
      message,
      recNumber: rec.number,
      vehicleTitle,
      plate: rec.vehicle?.placa || ""
    };
    ensureReceptionNotifications(rec).unshift({
      id: notificationId(),
      employeeId,
      employeeName,
      recId: rec.id,
      recNumber: rec.number,
      message,
      priority,
      createdAt: new Date().toISOString(),
      read: false
    });
    upsertEmployeeVehicle(employeeVehicleFromReception(rec));
  });
  const saved = await confirmCloudSaved("Notificación del vehículo enviada.", "notifier-vehicle");
  if (!saved) return;
  if (alertPayload) {
    const alertSent = await sendAlertzyNotification(alertPayload);
    if (!alertSent) toast("Quedó guardada, pero Alertzy no confirmó el aviso externo.", "warn");
  }
  if (textField) textField.value = "";
  renderNotifier();
}

function allAdminNotifications(current = state()) {
  const global = ensureEmployeeNotifications(current).map((item) => ({ ...item, source: "general" }));
  const vehicle = (current.receptions || []).flatMap((rec) => ensureReceptionNotifications(rec).map((item) => ({
    ...item,
    source: "vehículo",
    recNumber: item.recNumber || rec.number,
    vehicleTitle: `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim()
  })));
  return [...global, ...vehicle].sort((a, b) => String(b.completedAt || b.createdAt || "").localeCompare(String(a.completedAt || a.createdAt || "")));
}

function adminPendingNotificationAcks(current = state()) {
  return allAdminNotifications(current).filter((item) => item.completedAt && !item.adminAckAt);
}

function receptionNotificationAckCount(rec) {
  return ensureReceptionNotifications(rec).filter((item) => item.completedAt && !item.adminAckAt).length;
}

function openAdminNotificationSummary() {
  let modal = qs("[data-admin-notification-modal]");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "image-modal hidden";
    modal.dataset.adminNotificationModal = "1";
    modal.innerHTML = `
      <div class="image-modal-card notification-modal-card" role="dialog" aria-modal="true">
        <div class="image-modal-head">
          <h3>Notificaciones del sistema</h3>
          <button type="button" class="btn" data-action="close-admin-notification-summary">Cerrar</button>
        </div>
        <div class="panel-body grid" data-admin-notification-modal-body></div>
      </div>`;
    document.body.appendChild(modal);
  }
  const body = qs("[data-admin-notification-modal-body]", modal);
  const items = allAdminNotifications();
  body.innerHTML = items.length ? renderNotificationCards(items, "No hay notificaciones.") : '<div class="notice">No hay notificaciones.</div>';
  modal.classList.remove("hidden");
}

function openNotificationEditor(item) {
  return new Promise((resolve) => {
    qs("[data-notification-editor]")?.remove();
    const modal = document.createElement("div");
    modal.className = "image-modal";
    modal.dataset.notificationEditor = "1";
    modal.innerHTML = `
      <div class="image-modal-card notification-modal-card" role="dialog" aria-modal="true">
        <div class="image-modal-head">
          <h3>Editar notificación</h3>
          <button type="button" class="btn" data-edit-notification-cancel>Cerrar</button>
        </div>
        <div class="panel-body form-grid">
          <label class="full">Mensaje
            <textarea rows="5" data-edit-notification-message></textarea>
          </label>
          <label>Prioridad
            <select data-edit-notification-priority>
              <option value="warn">Amarillo</option>
              <option value="danger">Rojo</option>
            </select>
          </label>
          <div class="btn-row full">
            <button type="button" class="btn primary" data-edit-notification-save>Guardar edición</button>
            <button type="button" class="btn" data-edit-notification-cancel>Cancelar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const message = qs("[data-edit-notification-message]", modal);
    const priority = qs("[data-edit-notification-priority]", modal);
    if (message) {
      message.value = item?.message || "";
      setTimeout(() => message.focus(), 30);
    }
    if (priority) priority.value = item?.priority === "danger" ? "danger" : "warn";
    const close = (value) => {
      modal.remove();
      resolve(value);
    };
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-edit-notification-cancel]")) {
        event.preventDefault();
        close(null);
        return;
      }
      if (event.target.closest("[data-edit-notification-save]")) {
        event.preventDefault();
        const nextMessage = message?.value.trim() || "";
        if (!nextMessage) {
          toast("Escriba el mensaje de la notificación.", "warn");
          return;
        }
        close({ message: nextMessage, priority: priority?.value === "danger" ? "danger" : "warn" });
      }
    });
  });
}

function openManualAuthorizationDialog(rec) {
  return new Promise((resolve) => {
    qs("[data-manual-authorization-modal]")?.remove();
    const modal = document.createElement("div");
    modal.className = "image-modal";
    modal.dataset.manualAuthorizationModal = "1";
    modal.innerHTML = `
      <div class="image-modal-card notification-modal-card" role="dialog" aria-modal="true">
        <div class="image-modal-head">
          <h3>Autorizar manualmente</h3>
          <button type="button" class="btn" data-manual-auth-cancel>Cerrar</button>
        </div>
        <div class="panel-body form-grid">
          <div class="notice warn full">
            Se registrará autorización manual para el expediente <strong>${esc(rec?.number || "")}</strong>.
          </div>
          <label class="full">Motivo o referencia
            <textarea rows="4" data-manual-auth-reason>Cliente autoriza personalmente en taller / por llamada</textarea>
          </label>
          <div class="btn-row full">
            <button type="button" class="btn primary" data-manual-auth-save>Registrar autorización</button>
            <button type="button" class="btn" data-manual-auth-cancel>Cancelar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const reason = qs("[data-manual-auth-reason]", modal);
    setTimeout(() => reason?.focus(), 30);
    const close = (value) => {
      modal.remove();
      resolve(value);
    };
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-manual-auth-cancel]")) {
        event.preventDefault();
        close(null);
        return;
      }
      if (event.target.closest("[data-manual-auth-save]")) {
        event.preventDefault();
        close(reason?.value.trim() || "Autorización manual registrada por administrador");
      }
    });
  });
}

function openFinalDeliveryDialog(rec) {
  return new Promise((resolve) => {
    qs("[data-final-delivery-modal]")?.remove();
    const profile = trackingProfile(rec);
    const saved = finalDeliverySchedule(rec, profile);
    const estimatedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(profile.deliveryEstimate || ""))
      ? profile.deliveryEstimate
      : "";
    const modal = document.createElement("div");
    modal.className = "image-modal final-delivery-modal";
    modal.dataset.finalDeliveryModal = "1";
    modal.innerHTML = `
      <div class="image-modal-card notification-modal-card final-delivery-dialog-card" role="dialog" aria-modal="true" aria-labelledby="final-delivery-title">
        <div class="image-modal-head">
          <div>
            <h3 id="final-delivery-title">Programar entrega del vehículo</h3>
            <small>${esc(rec?.number || "")}</small>
          </div>
          <button type="button" class="btn" data-final-delivery-cancel>Cerrar</button>
        </div>
        <div class="panel-body form-grid final-delivery-form">
          <div class="notice full">
            Confirme desde qué fecha y hora podrá el cliente recoger el vehículo. Esta información se mostrará en su seguimiento.
          </div>
          <label>Fecha de entrega
            <input type="date" data-final-delivery-date value="${esc(saved.date || estimatedDate)}" required>
          </label>
          <label>Hora de entrega (12 horas)
            <div class="time12-row" data-final-dialog-time12>
              <select data-time12-hour aria-label="Hora"><option value="">Hora</option>${Array.from({ length: 12 }, (_, index) => `<option value="${index + 1}">${String(index + 1).padStart(2, "0")}</option>`).join("")}</select>
              <span>:</span>
              <select data-time12-minute aria-label="Minutos"><option value="">Min</option>${Array.from({ length: 60 }, (_, index) => `<option value="${String(index).padStart(2, "0")}">${String(index).padStart(2, "0")}</option>`).join("")}</select>
              <select data-time12-period aria-label="AM o PM"><option value="AM">AM</option><option value="PM">PM</option></select>
            </div>
          </label>
          <div class="btn-row full final-delivery-actions">
            <button type="button" class="btn primary" data-final-delivery-save>Confirmar y publicar</button>
            <button type="button" class="btn" data-final-delivery-cancel>Cancelar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const dateInput = qs("[data-final-delivery-date]", modal);
    const timeGroup = qs("[data-final-dialog-time12]", modal);
    setTime12Group(timeGroup, saved.time || "");
    const timeHour = qs("[data-time12-hour]", timeGroup);
    setTimeout(() => (dateInput?.value ? timeHour : dateInput)?.focus(), 30);
    const close = (value) => {
      modal.remove();
      resolve(value);
    };
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-final-delivery-cancel]")) {
        event.preventDefault();
        close(null);
        return;
      }
      if (event.target.closest("[data-final-delivery-save]")) {
        event.preventDefault();
        const date = dateInput?.value || "";
        const time = readTime12Group(timeGroup);
        if (!date || !time) {
          toast("Seleccione la fecha y la hora de entrega.", "warn");
          (!date ? dateInput : timeHour)?.focus();
          return;
        }
        close({ date, time });
      }
    });
  });
}

function purgeExpiredTrash(current) {
  // V4: la papelera no se vacía automáticamente. Solo el administrador puede
  // eliminar definitivamente un expediente desde la sección Papelera.
  return false;
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function receptionDateMs(rec) {
  const raw = rec?.tracking?.receptionDate || rec?.fecha || rec?.createdAt || rec?.signatureDate || "";
  if (!raw) return 0;
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const isoMatch = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3])).getTime();
  const svMatch = String(raw).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (svMatch) return new Date(Number(svMatch[3]), Number(svMatch[2]) - 1, Number(svMatch[1])).getTime();
  return 0;
}

function dateInputMs(value, endOfDay = false) {
  if (!value) return 0;
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function receptionSearchHaystack(rec) {
  const vehicle = rec.vehicle || {};
  const client = rec.client || {};
  return normalizeSearchText([
    rec.number,
    client.name,
    client.phone,
    vehicle.marca,
    vehicle.modelo,
    vehicle.anio,
    vehicle.color,
    vehicle.placa,
    vehicle.vin,
    vehicle.kilometraje,
    rec.employeeName,
    rec.employeeId,
    rec.status,
    rec.serviceType,
    serviceReason(rec),
    rec.tracking?.receptionDate
  ].filter(Boolean).join(" "));
}

function matchesAdminSearch(rec) {
  const textFilter = normalizeSearchText(adminSearchFilters.text);
  if (textFilter && !receptionSearchHaystack(rec).includes(textFilter)) return false;
  const year = String(adminSearchFilters.vehicleYear || "").trim();
  if (year && String(rec.vehicle?.anio || "").trim() !== year) return false;
  const time = receptionDateMs(rec);
  const from = dateInputMs(adminSearchFilters.dateFrom);
  const to = dateInputMs(adminSearchFilters.dateTo, true);
  if (from && (!time || time < from)) return false;
  if (to && (!time || time > to)) return false;
  return true;
}

function matchesDashboardQuickSearch(rec) {
  const textFilter = normalizeSearchText(adminDashboardQuickSearch);
  return !textFilter || receptionSearchHaystack(rec).includes(textFilter);
}

function applyAdminSearchFilters(receptions) {
  return (receptions || []).filter(matchesAdminSearch);
}

function syncAdminSearchInputs() {
  qsa("[data-admin-search]").forEach((input) => { if (input.value !== adminSearchFilters.text) input.value = adminSearchFilters.text; });
  qsa("[data-admin-date-from]").forEach((input) => { if (input.value !== adminSearchFilters.dateFrom) input.value = adminSearchFilters.dateFrom; });
  qsa("[data-admin-date-to]").forEach((input) => { if (input.value !== adminSearchFilters.dateTo) input.value = adminSearchFilters.dateTo; });
  qsa("[data-admin-vehicle-year]").forEach((input) => { if (input.value !== adminSearchFilters.vehicleYear) input.value = adminSearchFilters.vehicleYear; });
}

function syncDashboardQuickSearchInput() {
  qsa("[data-dashboard-quick-search]").forEach((input) => {
    if (input.value !== adminDashboardQuickSearch) input.value = adminDashboardQuickSearch;
  });
}

function renderCloudSettings() {
  if (!globalThis.AM_CLOUD_SYNC) return;
  const cfg = AM_CLOUD_SYNC.config();
  const endpoint = qs("[data-cloud-endpoint]");
  const account = qs("[data-cloud-account]");
  const enabled = qs("[data-cloud-enabled]");
  const status = qs("[data-cloud-status]");
  if (endpoint && endpoint.value !== cfg.endpoint) endpoint.value = cfg.endpoint || "";
  if (account && account.value !== cfg.account) account.value = cfg.account || "automotrizmedinaapp@gmail.com";
  if (enabled) enabled.checked = !!cfg.enabled;
  if (status) {
    status.textContent = cfg.enabled && cfg.endpoint ? "Nube activa" : "Sin configurar";
    status.className = `pill ${cfg.enabled && cfg.endpoint ? "ok" : "info"}`;
  }
}

function cloudLog(message, tone = "") {
  const host = qs("[data-cloud-log]");
  if (host) {
    host.className = `notice ${tone}`;
    host.textContent = message;
  }
  if (message) toast(message, tone);
}

function adminSavingOverlay() {
  let overlay = qs("[data-admin-saving-overlay]");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.dataset.adminSavingOverlay = "1";
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;display:none;place-items:center;background:rgba(8,16,28,.72);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px)";
  overlay.innerHTML = `
    <style>
      @keyframes amSaveSpin{to{transform:rotate(360deg)}}
      @keyframes amSaveCheckIn{0%{opacity:0;transform:scale(.55)}70%{opacity:1;transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}
      @keyframes amSaveTurnPulse{0%{transform:scale(.72);opacity:.45}60%{transform:scale(1.18);opacity:1}100%{transform:scale(1);opacity:1}}
      [data-admin-saving-card]{width:min(420px,calc(100vw - 34px));border:1px solid rgba(92,184,205,.42);border-radius:12px;background:#0b2038;color:#eef8ff;padding:28px 24px;text-align:center;box-shadow:0 28px 80px rgba(0,0,0,.42)}
      [data-admin-saving-symbol]{position:relative;width:102px;height:102px;margin:0 auto 18px}
      [data-admin-saving-ring]{position:absolute;inset:0;border-radius:50%;border:4px solid rgba(207,228,245,.18);border-top-color:#5bc1d0;animation:amSaveSpin .9s linear infinite;filter:drop-shadow(0 0 8px rgba(91,193,208,.16))}
      [data-admin-saving-turn]{position:absolute;left:10px;right:10px;top:14px;display:grid;place-items:center;color:#fff;line-height:1}
      [data-admin-saving-turn] b{font-size:21px;letter-spacing:.02em;min-width:28px}
      [data-admin-saving-turn] b.pulse{animation:amSaveTurnPulse .28s ease}
            [data-admin-saving-speed]{position:absolute;left:10px;right:10px;bottom:14px;display:grid;place-items:center;text-align:center;color:#eaf8ff;font-weight:800;line-height:1.02;font-size:13px;letter-spacing:.01em}
      [data-admin-saving-speed] small{display:block;margin-top:3px;font-size:8px;letter-spacing:.12em;color:#9dc9dc;text-transform:uppercase}
      [data-admin-saving-check]{position:absolute;inset:0;display:grid;place-items:center;border-radius:50%;background:#1f9d62;color:#fff;font-size:42px;font-weight:900;opacity:0;transform:scale(.55);box-shadow:0 0 0 8px rgba(31,157,98,.12),0 12px 28px rgba(31,157,98,.26)}
      [data-admin-saving-overlay].saved [data-admin-saving-ring]{opacity:0;animation:none}
      [data-admin-saving-overlay].saved [data-admin-saving-turn],
      [data-admin-saving-overlay].saved [data-admin-saving-speed]{opacity:0}
      [data-admin-saving-overlay].saved [data-admin-saving-check]{animation:amSaveCheckIn .35s ease forwards}
      [data-admin-saving-overlay].error [data-admin-saving-ring]{animation:none;border-color:#b52931}
      [data-admin-saving-overlay].error [data-admin-saving-turn],
      [data-admin-saving-overlay].error [data-admin-saving-speed]{opacity:0}
      [data-admin-saving-overlay].offline [data-admin-saving-ring]{animation-play-state:paused;border-top-color:#f4b942}
      [data-admin-saving-overlay].offline [data-admin-saving-speed]{color:#ffe7a3}
    </style>
    <article data-admin-saving-card>
      <div data-admin-saving-symbol>
        <span data-admin-saving-ring></span>
        <span data-admin-saving-turn><b>0</b></span>
        <span data-admin-saving-speed><b>--</b><small>kbps</small></span>
        <span data-admin-saving-check>✓</span>
      </div>
      <strong data-admin-saving-title style="display:block;font-size:21px;margin-bottom:10px">Guardando información…</strong>
      <p data-admin-saving-message style="margin:0;color:#cfe4f5">Sincronizando con el servidor.</p>
    </article>`;
  document.body.appendChild(overlay);
  const ring = overlay.querySelector("[data-admin-saving-ring]");
  if (ring && !ring.dataset.turnCounterBound) {
    ring.dataset.turnCounterBound = "1";
    ring.addEventListener("animationiteration", () => {
      if (overlay.style.display !== "grid" || overlay.classList.contains("saved") || overlay.classList.contains("error")) return;
      adminSavingTurnCount += 1;
      const value = overlay.querySelector("[data-admin-saving-turn] b");
      if (!value) return;
      value.textContent = String(adminSavingTurnCount);
      value.classList.remove("pulse");
      void value.offsetWidth;
      value.classList.add("pulse");
    });
  }
  return overlay;
}

let adminSavingSpeedTimer = null;
let adminSavingTurnCount = 0;
let adminSavingVisualKbps = 0;
let adminSavingStallUntil = 0;
let adminSavingStallValue = 0;
let adminSavingWillStall = false;
let adminSavingNextStallAt = 0;
function adminSavingOffline() { return typeof navigator !== "undefined" && navigator.onLine === false; }
function planAdminSavingVisual(reset = false) {
  if (!reset) return;
  adminSavingVisualKbps = 900 + Math.random() * 9000;
  adminSavingStallUntil = 0;
  adminSavingStallValue = 0;
  adminSavingWillStall = Math.random() < 0.16;
  adminSavingNextStallAt = performance.now() + 1800 + Math.random() * 4200;
}
function nextAdminVisualKbps() {
  const min = 100, max = 15000, now = performance.now();
  if (adminSavingWillStall && !adminSavingStallUntil && now >= adminSavingNextStallAt) {
    const rare = [0, 2, 8, 35, 90, 180, 420];
    adminSavingStallValue = rare[Math.floor(Math.random() * rare.length)];
    adminSavingStallUntil = now + 700 + Math.random() * 1500;
    adminSavingWillStall = false;
    adminSavingVisualKbps = adminSavingStallValue;
  }
  if (adminSavingStallUntil && now < adminSavingStallUntil) return adminSavingStallValue;
  if (adminSavingStallUntil && now >= adminSavingStallUntil) {
    adminSavingStallUntil = 0;
    adminSavingVisualKbps = 350 + Math.random() * 1800;
  }
  const current = adminSavingVisualKbps || (min + Math.random() * 7000);
  const drift = Math.max(250, current * .38);
  const target = Math.min(max, Math.max(min, current + (Math.random() - .46) * drift));
  adminSavingVisualKbps = Math.min(max, Math.max(min, current * .72 + target * .28));
  return Math.round(adminSavingVisualKbps / 10) * 10;
}
function adminSavingRingSeconds(value) {
  if (value <= 2) return 6.8;
  if (value < 100) return 4.8;
  if (value < 500) return 3.4;
  if (value < 1500) return 2.35;
  const normalized = Math.min(1, value / 15000);
  return Math.max(.62, 1.85 - normalized * 1.18);
}
function refreshAdminSavingSpeed() {
  const overlay = qs("[data-admin-saving-overlay]");
  const host = overlay?.querySelector("[data-admin-saving-speed]");
  const ring = overlay?.querySelector("[data-admin-saving-ring]");
  if (!host || overlay?.classList.contains("saved") || overlay?.classList.contains("error")) return;
  if (adminSavingOffline()) {
    const number = host.querySelector("b");
    const unit = host.querySelector("small");
    if (number) number.textContent = "0";
    if (unit) unit.textContent = "kbps";
    if (ring) ring.style.animationPlayState = "paused";
    return;
  }
  const value = nextAdminVisualKbps();
  const number = host.querySelector("b");
  const unit = host.querySelector("small");
  if (number) number.textContent = value.toLocaleString("es-SV");
  if (unit) unit.textContent = "kbps";
  if (ring) {
    ring.style.animationPlayState = "running";
    ring.style.animationDuration = `${adminSavingRingSeconds(value).toFixed(2)}s`;
  }
}
function resetAdminSavingMotion() {
  adminSavingTurnCount = 0;
  planAdminSavingVisual(true);
  const overlay = qs("[data-admin-saving-overlay]");
  const turn = overlay?.querySelector("[data-admin-saving-turn] b");
  if (turn) { turn.textContent = "0"; turn.classList.remove("pulse"); }
  refreshAdminSavingSpeed();
}
function startAdminSavingSpeed(reset = false) {
  clearInterval(adminSavingSpeedTimer);
  if (reset) resetAdminSavingMotion(); else refreshAdminSavingSpeed();
  adminSavingSpeedTimer = setInterval(refreshAdminSavingSpeed, 620);
}
function stopAdminSavingSpeed() { clearInterval(adminSavingSpeedTimer); adminSavingSpeedTimer = null; }
function updateAdminSavingNetworkState() {
  const overlay = qs("[data-admin-saving-overlay]");
  if (!overlay || overlay.style.display !== "grid" || overlay.classList.contains("saved") || overlay.classList.contains("error")) return;
  const titleEl = overlay.querySelector("[data-admin-saving-title]");
  const msgEl = overlay.querySelector("[data-admin-saving-message]");
  const ring = overlay.querySelector("[data-admin-saving-ring]");
  if (adminSavingOffline()) {
    overlay.classList.add("offline");
    stopAdminSavingSpeed();
    if (ring) ring.style.animationPlayState = "paused";
    const speed = overlay.querySelector("[data-admin-saving-speed] b");
    if (speed) speed.textContent = "0";
    if (titleEl) titleEl.textContent = "Sin conexión a internet";
    if (msgEl) msgEl.textContent = "Verificá tu conexión para continuar.";
  } else if (overlay.classList.contains("offline")) {
    overlay.classList.remove("offline");
    if (ring) ring.style.animationPlayState = "running";
    if (titleEl) titleEl.textContent = overlay.dataset.resumeTitle || "Guardando información…";
    if (msgEl) msgEl.textContent = overlay.dataset.resumeMessage || "Sincronizando con el servidor.";
    startAdminSavingSpeed(false);
  }
}
window.addEventListener("offline", () => { updateAdminSavingNetworkState(); try { toast("Sin conexión a internet. Verificá tu conexión para continuar.", "bad"); } catch {} });
window.addEventListener("online", updateAdminSavingNetworkState);

function setAdminSaving(show, title = "Guardando información…", message = "Sincronizando con el servidor.", progress = 18) {
  const overlay = adminSavingOverlay();
  const wasRunning = overlay.style.display === "grid" && !overlay.classList.contains("saved") && !overlay.classList.contains("error");
  overlay.style.display = show ? "grid" : "none";
  if (!show) {
    stopAdminSavingSpeed();
    overlay.classList.remove("saved", "error", "offline");
    return;
  }
  overlay.dataset.resumeTitle = title;
  overlay.dataset.resumeMessage = message;
  overlay.classList.toggle("saved", Number(progress) >= 100);
  overlay.classList.remove("error");
  if (Number(progress) >= 100) stopAdminSavingSpeed();
  else if (!wasRunning) startAdminSavingSpeed(true);
  else if (!adminSavingSpeedTimer) startAdminSavingSpeed(false);
  const titleEl = overlay.querySelector("[data-admin-saving-title]");
  const msgEl = overlay.querySelector("[data-admin-saving-message]");
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  updateAdminSavingNetworkState();
}

function adminSavingTitle(reason = "") {
  const map = {
    "publish-tracking": "Publicando seguimiento…",
    "save-admin-tracking": "Guardando seguimiento…",
    "publish-pending-tracking": "Publicando seguimiento…",
    "publish-finalization": "Publicando finalización…",
    "save-admin-expediente": "Guardando expediente…",
    "save-admin-all": "Guardando cambios…",
    "save-client-profile": "Guardando expediente…",
    "archive-reception": "Archivando expediente…",
    "unarchive-reception": "Restaurando expediente…",
    "restore-trash-reception": "Restaurando expediente…",
    "delete-reception": "Moviendo a papelera…",
    "purge-trash-reception": "Eliminando definitivamente…",
    "admin-detail-image": "Guardando imagen…"
  };
  return map[reason] || "Guardando información…";
}

function adminSavingSuccessTitle(message = "Guardado correctamente.") {
  const clean = String(message || "").replace(/[.!]+$/g, "").trim();
  return clean || "Guardado correctamente";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConfirmedCloudSnapshot(exportedAt) {
  if (!globalThis.AM_CLOUD_SYNC?.fetchLatest) throw new Error("La nube no esta disponible.");
  let last = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    setAdminSaving(true, "Guardando y respaldando", attempt < 2 ? "Enviando respaldo al servidor." : "Confirmando lectura desde nube.", 30 + attempt * 12);
    const snapshot = await AM_CLOUD_SYNC.fetchLatest();
    last = snapshot;
    if (snapshot && (!exportedAt || snapshot.exportedAt === exportedAt)) return snapshot;
    await sleep(1200 + attempt * 650);
  }
  throw new Error(last ? "El servidor respondio, pero no confirmo la version recien guardada." : "No se pudo leer el respaldo de nube.");
}

async function confirmCloudSaved(message = "Guardado correctamente.", reason = "confirmed-save") {
  if (!globalThis.AM_CLOUD_SYNC?.isReady?.()) {
    globalThis.AM_CLOUD_SYNC?.rollbackToConfirmed?.();
    toast("No hay una sesión válida con el servidor. El cambio NO se confirmó.", "danger");
    return false;
  }

  const targetedReasons = new Set([
    "publish-tracking",
    "save-admin-tracking",
    "publish-pending-tracking",
    "publish-finalization",
    "admin-add-detail-row",
    "admin-remove-detail-row",
    "admin-detail-image"
  ]);
  const targeted = targetedReasons.has(reason) && typeof AM_CLOUD_SYNC.saveReceptionNow === "function";
  const target = targeted ? AM_SIMPLE_STORE.selected() : null;

  setAdminSaving(true, adminSavingTitle(reason), "Sincronizando con el servidor.", 42);
  try {
    if (targeted && target) {
      await AM_CLOUD_SYNC.saveReceptionNow(target, reason);
    } else {
      const fixedSnapshot = AM_CLOUD_SYNC.snapshot ? AM_CLOUD_SYNC.snapshot() : null;
      await AM_CLOUD_SYNC.saveNow(reason, fixedSnapshot);
    }
    setAdminSaving(true, adminSavingSuccessTitle(message), "Información confirmada.", 100);
    await sleep(700);
    toast(message, "ok");
    return true;
  } catch (error) {
    console.error(error);
    const overlay = adminSavingOverlay();
    overlay.classList.remove("saved");
    overlay.classList.add("error");
    const titleEl = overlay.querySelector("[data-admin-saving-title]");
    const msgEl = overlay.querySelector("[data-admin-saving-message]");
    if (titleEl) titleEl.textContent = "No se pudo completar";
    if (msgEl) msgEl.textContent = error.message || String(error);
    await sleep(1100);
    toast(`No se pudo confirmar con el servidor: ${error.message || error}`, "danger");
    return false;
  } finally {
    setAdminSaving(false);
  }
}

function setAdminVehicleCloudStatus(recId, status, message = "") {
  if (!recId) return false;
  let changed = false;
  AM_SIMPLE_STORE.mutate((current) => {
    const rec = current.receptions.find((item) => item.id === recId);
    if (!rec) return;
    rec.cloudStatus = status;
    rec.cloudMessage = message;
    rec.cloudUpdatedAt = new Date().toISOString();
    changed = true;
  }, { markLocalWrite: false });
  return changed;
}

function markQueuedSnapshotCloudConfirmed(snapshot) {
  if (!snapshot) return;
  (snapshot.appState?.receptions || []).forEach((rec) => {
    if (rec.cloudStatus === "pending") rec.cloudStatus = "confirmed";
  });
  (snapshot.employeeState?.vehicles || []).forEach((vehicle) => {
    if (vehicle.cloudStatus === "pending") vehicle.cloudStatus = "confirmed";
  });
}

async function retryAdminVehicleCloudBackup(recId) {
  if (!recId) return;
  setAdminVehicleCloudStatus(recId, "pending", "Reintentando respaldo en nube.");
  renderReceptionTable();
  const fixedSnapshot = AM_CLOUD_SYNC.snapshot ? AM_CLOUD_SYNC.snapshot() : null;
  markQueuedSnapshotCloudConfirmed(fixedSnapshot);
  try {
    await AM_CLOUD_SYNC.enqueueBackgroundSave("admin-manual-retry", {
      snapshot: fixedSnapshot,
      context: { module: "admin", selectedId: recId },
      message: "Reintentando respaldo."
    });
  } catch (error) {
    setAdminVehicleCloudStatus(recId, "error", "No se pudo preparar el reintento.");
    renderReceptionTable();
    toast("No se pudo preparar el reintento del respaldo.", "danger");
  }
}

function applyAdminCloudStatus(detail = {}) {
  if (document.body?.dataset.page !== "admin") return;
  const moduleName = detail.context?.module || "";
  if (moduleName !== "admin" && moduleName !== "empleado") return;
  let selectedId = detail.context?.selectedId || "";
  let receptionNumber = "";
  if (moduleName === "empleado") {
    const employeeState = (() => { try { return JSON.parse(localStorage.getItem("am_employee_module_safe_v2") || "null"); } catch { return null; } })();
    const vehicle = employeeState?.vehicles?.find((item) => item.id === detail.context?.vehicleId);
    receptionNumber = vehicle?.rec || "";
    selectedId = vehicle?.id ? `emp-${vehicle.id}` : "";
  }
  const status = detail.status === "confirmed" ? "confirmed" : detail.status === "error" ? "error" : "pending";
  const message = status === "confirmed" ? "Respaldo confirmado en nube." : status === "error" ? "El respaldo local no pudo confirmarse en nube." : "Respaldo en nube pendiente de confirmar.";
  AM_SIMPLE_STORE.mutate((current) => {
    current.receptions.forEach((rec) => {
      const belongs = rec.id === selectedId || (receptionNumber && rec.number === receptionNumber) || ((status === "confirmed" || status === "error") && rec.cloudStatus === "pending");
      if (!belongs) return;
      rec.cloudStatus = status;
      rec.cloudMessage = message;
      rec.cloudUpdatedAt = new Date().toISOString();
    });
  }, { markLocalWrite: false });
  if (document.body?.dataset.page === "admin") renderReceptionTable();
  if (status === "confirmed" && moduleName === "empleado" && globalThis.AM_CLOUD_SYNC?.fetchLatest) {
    AM_CLOUD_SYNC.fetchLatest()
      .then((snapshot) => AM_CLOUD_SYNC.applySnapshot?.(snapshot))
      .then(() => renderReceptionTable())
      .catch(() => {});
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest?.('[data-action="open-dashboard-thumbnail"]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const rec = state().receptions.find(item => item.id === button.dataset.id);
  if (!rec) return;
  try {
    const photos = await globalThis.AM_CLOUD_SYNC?.ensureReceptionPhotos?.(rec);
    const front = (Array.isArray(photos) ? photos : []).find(photo => photoLabelKey(photo?.label) === "frente") || photos?.[0];
    if (front?.dataUrl) openImagePreviewFromData(front.dataUrl, `Frente - ${rec.number || ""}`, mobileVehicleTitle(rec));
  } catch (error) { console.warn("No se pudo abrir fotografía frontal", error); }
}, true);

let adminMediaRenderTimer = 0;
window.addEventListener("am-cloud-media-ready", (event) => {
  if (document.body?.dataset.page !== "admin") return;
  clearTimeout(adminMediaRenderTimer);
  adminMediaRenderTimer = setTimeout(() => {
    try {
      if (event?.detail?.kind === "thumbnail") {
        renderReceptionTable();
        return;
      }
      const expedienteVisible = !qs('[data-section="expediente"]')?.classList.contains("hidden");
      if (expedienteVisible) renderAdmin();
    } catch (error) { console.warn("No se pudo refrescar media visual", error); }
  }, 80);
});

window.addEventListener("am-cloud-background-status", (event) => {
  applyAdminCloudStatus(event.detail || {});
});

window.addEventListener("storage", (event) => {
  if (event.key === "am_cloud_media_refresh_v1" && document.body?.dataset.page === "admin") {
    AM_CLOUD_SYNC.fetchLatest?.()
      .then((snapshot) => AM_CLOUD_SYNC.applySnapshot?.(snapshot))
      .then(() => renderReceptionTable())
      .catch(() => {});
    return;
  }
  if (event.key === "am_cloud_last_status_v1" && event.newValue) {
    try { applyAdminCloudStatus(JSON.parse(event.newValue)); } catch {}
    return;
  }
  if ((event.key === "am_v4_catalog_v1" || event.key === "am_recepción_local_v1") && document.body?.dataset.page === "admin") renderReceptionTable();
});

function resizeAdminMasterFrame() {
  const frame = qs("[data-master-file-frame]");
  if (!frame) return;
  try {
    const doc = frame.contentDocument || frame.contentWindow?.document;
    const body = doc?.body;
    const root = doc?.documentElement;
    const contentHeight = Math.max(
      body?.scrollHeight || 0,
      body?.offsetHeight || 0,
      root?.scrollHeight || 0,
      root?.offsetHeight || 0,
      window.innerHeight
    );
    frame.style.height = `${Math.max(contentHeight + 80, window.innerHeight - 120)}px`;
  } catch (error) {
    frame.style.height = "2600px";
  }
}

async function confirmInternalLogSaved(message = "Bitácora interna guardada.", reason = "save-internal-log") {
  if (!globalThis.AM_CLOUD_SYNC?.enqueueBackgroundSave) {
    toast("La bitácora quedó guardada localmente, pero no se pudo preparar el respaldo en nube.", "danger");
    return false;
  }
  try {
    const hashParams = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
    const hashId = hashParams.get("expediente") || "";
    const selectedId = state().receptions.some((rec) => rec.id === hashId) ? hashId : "";
    const fixedSnapshot = AM_CLOUD_SYNC.snapshot ? AM_CLOUD_SYNC.snapshot() : null;
    await AM_CLOUD_SYNC.enqueueBackgroundSave(reason, {
      snapshot: fixedSnapshot,
      context: { module: "admin", selectedId, kind: "bitacora" },
      message: "Bitácora enviada."
    });
    toast(message, "ok");
    return true;
  } catch (error) {
    console.error(error);
    toast(`La bitácora quedó local, pero no se pudo preparar el respaldo: ${error.message || error}`, "danger");
    return false;
  }
}

function setAdminMasterFrameSource(href) {
  const frame = qs("[data-master-file-frame]");
  if (!frame) return;
  frame.removeAttribute("srcdoc");
  frame.removeAttribute("sandbox");
  frame.addEventListener("load", () => {
    resizeAdminMasterFrame();
    try {
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if (doc?.body && !frame.dataset.resizeObserverAttached) {
        const observer = new MutationObserver(() => resizeAdminMasterFrame());
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true });
        frame.dataset.resizeObserverAttached = "1";
      }
    } catch (error) {
      // Si el navegador bloquea acceso al iframe, queda la altura de respaldo.
    }
    setTimeout(resizeAdminMasterFrame, 300);
    setTimeout(resizeAdminMasterFrame, 900);
  }, { once: true });
  if (frame.getAttribute("src") !== href) {
    delete frame.dataset.resizeObserverAttached;
    frame.setAttribute("src", href);
  } else {
    resizeAdminMasterFrame();
  }
}

function setAdminMasterFrameForReception(rec) {
  const frame = qs("[data-master-file-frame]");
  const open = qs("[data-master-file-open]");
  if (!frame || !rec) return;
  if (rec.localArchivePreviewOnly && rec.__localBackup) seedArchiveViewerFromLocalBackup(rec.__localBackup, rec);
  const href = masterFileHref(rec);
  setAdminMasterFrameSource(href);
  if (open) {
    open.href = href;
    open.classList.remove("hidden");
  }
}

function showAdminFileTab(target = adminFileTab) {
  adminFileTab = target || "";
  document.body.classList.toggle("admin-mobile-folder", window.innerWidth <= 920 && !!adminFileTab && !qs('[data-section="expediente"]')?.classList.contains("hidden"));
  qsa("[data-admin-file-tab]").forEach((button) => {
    button.classList.toggle("active", !!adminFileTab && button.dataset.adminFileTab === adminFileTab);
  });
  qsa('[data-section="expediente"] [data-tab]').forEach((panel) => {
    panel.classList.toggle("active", !!adminFileTab && panel.dataset.tab === adminFileTab);
  });
  if (adminFileTab === "archivo") {
    const rec = selected();
    if (rec) renderAdminFile(rec);
  }
  if (adminFileTab === "facturas") renderAdminInvoices();
}

function initTheme() {
  const button = qs("[data-theme-toggle]");
  if (!button) return;
  const saved = localStorage.getItem("am_simple_theme") || "light";
  document.documentElement.dataset.theme = saved;
  button.textContent = saved === "dark" ? "Modo claro" : "Modo oscuro";
  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("am_simple_theme", next);
    button.textContent = next === "dark" ? "Modo claro" : "Modo oscuro";
  });
}

function renderReceptionSummary(host, reception = selected()) {
  if (!reception) {
    host.innerHTML = '<div class="notice">No hay expediente seleccionado.</div>';
    return;
  }
  host.innerHTML = `
    ${adminSignatureReviewNotice(reception)}
    <div class="grid cols-3">
      <div class="metric"><span>Recepción</span><strong>${reception.number}</strong><small>${reception.status}</small></div>
      <div class="metric"><span>Cliente</span><strong>${reception.client.name}</strong><small>${reception.client.phone}</small></div>
      <div class="metric"><span>Vehículo</span><strong>${reception.vehicle.marca} ${reception.vehicle.modelo}</strong><small>${reception.vehicle.anio} - ${reception.vehicle.color}</small></div>
    </div>`;
}

function hasCapturedClientSignature(rec) {
  const evidence = rec?.authorizationEvidence || {};
  return !!(
    rec?.quickAuthorization ||
    rec?.signatureDataUrl ||
    evidence.signatureDataUrl ||
    /firma presencial/i.test(evidence.authorizationType || "")
  );
}

function signatureNeedsAdminReview(rec) {
  return hasCapturedClientSignature(rec) && !rec?.adminSignatureReviewedAt;
}

function adminSignatureReviewNotice(rec) {
  if (!signatureNeedsAdminReview(rec)) return "";
  return "";
}

function adminAuthorizationCell(rec) {
  if (signatureNeedsAdminReview(rec)) {
    return '<span class="pill warn">Firma capturada</span><br><small class="signature-admin-pending">Revisar y autorizar</small>';
  }
  return rec.signed
    ? '<span class="pill ok">Autorizado</span>'
    : (rec.express ? '<span class="pill info">No aplica</span>' : '<span class="pill warn">Pendiente</span>');
}

function serviceReason(rec) {
  return rec?.serviceReason || rec?.motivo || rec?.reason || rec?.observations || "";
}

function shortText(value, limit = 96) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
}

function makePrivateTokens() {
  return {
    clientToken: "cli_" + AM_SIMPLE_STORE.cryptoToken(),
    trackingToken: "trk_" + AM_SIMPLE_STORE.cryptoToken()
  };
}

function tokenHref(page, token) {
  return `${page}#token=${encodeURIComponent(token)}`;
}

function photoReviewHref(token) {
  return `cliente.html?modo=fotos#token=${encodeURIComponent(token || "")}`;
}

const CONSUMED_CLIENT_LINKS_KEY = "am_consumed_client_links_v1";

function consumedClientLinks() {
  try {
    return JSON.parse(localStorage.getItem(CONSUMED_CLIENT_LINKS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function markConsumedClientLink(clientToken, trackingToken) {
  const token = String(clientToken || "").trim();
  const tracking = String(trackingToken || "").trim();
  if (!token || !tracking) return;
  try {
    const consumed = consumedClientLinks();
    consumed[token] = { trackingToken: tracking, consumedAt: new Date().toISOString() };
    localStorage.setItem(CONSUMED_CLIENT_LINKS_KEY, JSON.stringify(consumed));
  } catch (error) {
    console.warn("No se pudo registrar localmente el enlace consumido.", error);
  }
}

function forgetConsumedClientLink(clientToken) {
  const token = String(clientToken || "").trim();
  if (!token) return;
  const consumed = consumedClientLinks();
  delete consumed[token];
  localStorage.setItem(CONSUMED_CLIENT_LINKS_KEY, JSON.stringify(consumed));
}

function consumedClientTrackingHref(clientToken) {
  const token = String(clientToken || "").trim();
  if (!token) return "";
  const consumed = consumedClientLinks()[token];
  return consumed?.trackingToken ? tokenHref("seguimiento.html", consumed.trackingToken) : "";
}

function adminPreviewLinkAttrs() {
  return window.innerWidth <= 920 ? "" : ' target="_blank" rel="noopener"';
}

function syncEmployeeModuleVehiclesIntoAdmin() {
  if (document.body.dataset.page !== "admin") return;
  let employeeState = null;
  try {
    employeeState = JSON.parse(localStorage.getItem("am_employee_module_safe_v2") || "null");
  } catch {
    employeeState = null;
  }
  if (!employeeState || !Array.isArray(employeeState.vehicles)) return;
  if (!employeeState.vehicles.length) return;
  AM_SIMPLE_STORE.mutate((current) => {
    if (!Array.isArray(current.deletedReceptionNumbers)) current.deletedReceptionNumbers = [];
    if (!Array.isArray(current.reservedReceptionNumbers)) current.reservedReceptionNumbers = [];
    const employeeNumbers = employeeState.vehicles.map((vehicle) => String(vehicle.rec || vehicle.reception || "").trim()).filter(Boolean);
    const activeAdminCount = current.receptions.filter((rec) => !rec?.deletedAt && !rec?.archivedAt).length;
    const shouldReviveEmployeeVehicles = employeeNumbers.length > 0 && activeAdminCount === 0;
    const staleDeleteListBlocksAll = shouldReviveEmployeeVehicles && employeeNumbers.every((number) => current.deletedReceptionNumbers.includes(number));
    if (staleDeleteListBlocksAll) {
      current.deletedReceptionNumbers = current.deletedReceptionNumbers.filter((number) => !employeeNumbers.includes(number));
    }
    employeeState.vehicles.forEach((vehicle) => {
      const number = vehicle.rec || vehicle.reception || "";
      if (!number) return;
      let rec = current.receptions.find((item) => item.number === number);
      if (!rec && (current.deletedReceptionNumbers.includes(number) || current.reservedReceptionNumbers.includes(number))) return;
      if (!rec) {
        rec = {
          id: `emp-${vehicle.id || AM_SIMPLE_STORE.cryptoToken()}`,
          number,
          express: !!vehicle.express,
          serviceType: vehicle.tipoServicio || "",
          status: vehicle.estado || "EN REVISIÓN",
          sentToClient: !!(vehicle.autorizado || vehicle.signed),
          signed: !!(vehicle.autorizado || vehicle.signed),
          signatureName: vehicle.signatureName || vehicle.clientName || "",
          signatureDate: vehicle.signatureDate || vehicle.termsAcceptedAt || "",
          signatureDataUrl: vehicle.signatureDataUrl || "",
          manualAuthorization: !!vehicle.manualAuthorization,
          quickAuthorization: !!vehicle.quickAuthorization,
          termsAcceptedAt: vehicle.termsAcceptedAt || vehicle.signatureDate || "",
          authorizationEvidence: vehicle.authorizationEvidence || null,
          clientToken: "cli_" + AM_SIMPLE_STORE.cryptoToken(),
          trackingToken: "trk_" + AM_SIMPLE_STORE.cryptoToken(),
          client: { name: vehicle.clientName || "", phone: vehicle.clientPhone || "" },
          employeeId: vehicle.eid || "edwin",
          employeeName: vehicle.en || "Edwin",
          serviceReason: vehicle.motivo || "",
          vehicle: {},
          photos: [],
          inventory: [],
          observations: "",
          damages: [],
          progress: 0,
          progressLabel: vehicle.estado || "EN REVISIÓN",
          tracking: {},
          internalWork: { internalNote: "", lockedReception: true },
          updates: []
        };
        current.receptions.unshift(rec);
      }
      if (shouldReviveEmployeeVehicles) {
        rec.deletedAt = "";
        rec.deletedBy = "";
        rec.archivedAt = "";
        rec.archivedBy = "";
        rec.deliveredAt = "";
        rec.deliveredBy = "";
      }
      rec.express = !!vehicle.express;
      rec.serviceType = vehicle.tipoServicio || rec.serviceType || "";
      rec.employeeId = vehicle.eid || rec.employeeId || "edwin";
      rec.employeeName = vehicle.en || rec.employeeName || "Edwin";
      rec.status = vehicle.estado || rec.status;
      const vehicleSigned = !!(vehicle.autorizado || vehicle.signed || vehicle.signatureDataUrl);
      rec.sentToClient = vehicleSigned || !!rec.sentToClient;
      rec.signed = vehicleSigned || !!rec.signed;
      if (vehicle.clientName || vehicle.clientPhone) rec.client = { ...(rec.client || {}), name: vehicle.clientName || rec.client?.name || "", phone: vehicle.clientPhone || rec.client?.phone || "" };
      if (vehicle.signatureName || vehicle.clientName) rec.signatureName = vehicle.signatureName || vehicle.clientName;
      if (vehicle.signatureDate || vehicle.termsAcceptedAt) rec.signatureDate = vehicle.signatureDate || vehicle.termsAcceptedAt;
      if (vehicle.signatureDataUrl) rec.signatureDataUrl = vehicle.signatureDataUrl;
      if (vehicle.termsAcceptedAt || vehicle.signatureDate) rec.termsAcceptedAt = vehicle.termsAcceptedAt || vehicle.signatureDate;
      if (vehicle.manualAuthorization) rec.manualAuthorization = true;
      if (vehicle.quickAuthorization) rec.quickAuthorization = true;
      if (vehicle.authorizationEvidence) rec.authorizationEvidence = vehicle.authorizationEvidence;
      rec.serviceReason = vehicle.motivo || rec.serviceReason || "";
      rec.vehicle = {
        marca: vehicle.marca || "",
        modelo: vehicle.modelo || "",
        anio: vehicle.anio || "",
        color: vehicle.color || "",
        placa: vehicle.placa || "",
        vin: vehicle.vin || "",
        kilometraje: vehicle.odometro || vehicle.kilometraje || ""
      };
      rec.photos = Array.isArray(vehicle.photos) ? vehicle.photos.map((photo, index) => ({
        label: photo.label || `Foto ${index + 1}`,
        dataUrl: photo.dataUrl || "",
        note: photo.note || "",
        color: photo.color || (index % 2 === 0 ? "#206f78" : "#b52931")
      })) : rec.photos;
      rec.inventory = Array.isArray(vehicle.inventory) ? vehicle.inventory.map((item, index) => ({
        id: item.id || `inv-${rec.id}-${index}`,
        name: item.name || `Inventario ${index + 1}`,
        present: item.present !== false,
        note: item.note || ""
      })) : rec.inventory;
      rec.observations = vehicle.observaciones || rec.observations || "";
      rec.damages = Array.isArray(vehicle.damages) ? vehicle.damages.map((damage, index) => ({
        id: damage.id || `dam-${rec.id}-${index}`,
        area: damage.area || "Daño",
        detail: damage.detail || "",
        photos: Array.isArray(damage.photos) ? damage.photos : []
      })) : rec.damages;
      if (vehicle.pendingTracking) {
        rec.pendingTracking = {
          ...vehicle.pendingTracking,
          employeeId: vehicle.eid || rec.employeeId,
          employeeName: vehicle.en || rec.employeeName || "EMPLEADO"
        };
        if (rec.publishedProgress != null) rec.progress = Number(rec.publishedProgress || 0);
        else if (Number(rec.progress || 0) === Number(vehicle.pendingTracking.progress || 0)) rec.progress = 0;
      }
      rec.progress = Number(rec.progress || 0);
      rec.progressLabel = rec.progressLabel || rec.tracking?.state || "EN REVISIÓN";
      rec.employeeDeadline = vehicle.deadline || rec.employeeDeadline || "";
      rec.employeeDeadlineSetAt = vehicle.deadlineSetAt || rec.employeeDeadlineSetAt || "";
      rec.employeeDeadlineTokensAvailable = Number(vehicle.deadlineTokensAvailable ?? rec.employeeDeadlineTokensAvailable ?? 3);
      rec.employeeDeadlineTokensUsed = Number(vehicle.deadlineTokensUsed ?? rec.employeeDeadlineTokensUsed ?? 0);
      rec.employeeDeadlineUnlockRequested = !!(vehicle.deadlineUnlockRequested || rec.employeeDeadlineUnlockRequested);
      rec.tracking = {
        ...(rec.tracking || {}),
        receptionDate: [vehicle.fecha, vehicle.hora].filter(Boolean).join(", ") || rec.tracking?.receptionDate || "",
        odometer: `${vehicle.odometro || rec.vehicle.kilometraje || "N/D"} ${vehicle.unidad === "km" ? "KM" : "MILLAS"}`,
        plate: vehicle.placa || "N/D",
        vehicleTitle: `${vehicle.marca || ""} ${vehicle.modelo || ""} ${vehicle.anio || ""}`.trim().toUpperCase(),
        state: rec.tracking?.state || "EN REVISIÓN",
        processDetails: rec.tracking?.processDetails || ""
      };
      if (vehicle.express) {
        rec.tracking.processDetails = vehicle.detalle || `Servicio express: ${vehicle.tipoServicio || "N/D"}`;
      }
      rec.internalWork = {
        ...(rec.internalWork || {}),
        internalNote: vehicle.express ? (rec.internalWork?.internalNote || "Servicio express registrado desde módulo de empleado.") : (Array.isArray(vehicle.bitacora) ? vehicle.bitacora.join("\n") : (vehicle.nota || rec.internalWork?.internalNote || "")),
        lockedReception: true
      };
    });
  }, { markLocalWrite: false });
}

function frontReceptionPhoto(rec) {
  const photos = receptionPhotos(rec);
  return photos.find((photo) => photoLabelKey(photo.label) === "frente") || photos[0] || null;
}

function receptionPhotos(rec) {
  const own = Array.isArray(rec?.photos) ? rec.photos : [];
  const cached = globalThis.AM_CLOUD_SYNC?.cachedPhotos?.(rec);
  if (Array.isArray(cached) && cached.some((photo) => typeof photo?.dataUrl === 'string' && photo.dataUrl)) return cached;
  if (own.some((photo) => typeof photo?.dataUrl === 'string' && photo.dataUrl)) return own;
  // V4.18: las referencias Drive se hidratan en segundo plano. La tabla se muestra
  // inmediatamente y una fotografía lenta/ausente no bloquea los datos del dashboard.
  if (own.some((photo) => photo?.dataUrl && typeof photo.dataUrl === 'object')) {
    globalThis.AM_CLOUD_SYNC?.ensureReceptionPhotos?.(rec).catch(() => {});
  }
  return own.map((photo) => ({ ...photo, dataUrl: typeof photo?.dataUrl === 'string' ? photo.dataUrl : '' }));
}

function dashboardThumbnailInfo(rec) {
  if (!rec) return { src: "", status: "missing" };
  const cloud = globalThis.AM_CLOUD_SYNC;
  const src = cloud?.cachedThumbnail?.(rec) || "";
  let status = cloud?.thumbnailStatus?.(rec) || (src ? "ready" : "loading");
  if (!src && status === "loading") cloud?.ensureReceptionThumbnail?.(rec).catch(() => {});
  if (src) status = "ready";
  return { src, status };
}

function dashboardThumbnailMarkup(rec, className = "") {
  const { src, status } = dashboardThumbnailInfo(rec);
  if (src) {
    return `<button type="button" class="table-thumb dashboard-thumb ${className}" data-action="open-dashboard-thumbnail" data-id="${esc(rec.id)}" title="Ver fotografía frontal"><img src="${src}" alt="Miniatura ${esc(rec.vehicle?.marca || "vehículo")}"></button>`;
  }
  const label = status === "missing" ? "Sin fotografía" : status === "error" ? "Imagen no disponible" : "Cargando…";
  return `<div class="table-thumb table-thumb-empty dashboard-thumb ${status === "loading" ? "is-loading" : status === "error" ? "is-error" : "is-missing"} ${className}" aria-label="${esc(label)}">${esc(label)}</div>`;
}

function photoLabelKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function photoLabelTargets(label, fallback = "") {
  const aliasMap = {
    "tarjeta reverso": ["tarjeta reverso", "reverso tarjeta", "reverso de tarjeta"],
    "reverso tarjeta": ["tarjeta reverso", "reverso tarjeta", "reverso de tarjeta"],
    "reverso de tarjeta": ["tarjeta reverso", "reverso tarjeta", "reverso de tarjeta"],
    "tarjeta frente": ["tarjeta frente", "frente tarjeta", "frente de tarjeta"],
    "frente tarjeta": ["tarjeta frente", "frente tarjeta", "frente de tarjeta"],
    "frente de tarjeta": ["tarjeta frente", "frente tarjeta", "frente de tarjeta"],
    "compartimiento motor": ["compartimiento motor", "compartimiento del motor", "compartimento de motor"],
    "compartimiento del motor": ["compartimiento motor", "compartimiento del motor", "compartimento de motor"]
  };
  const keys = [photoLabelKey(label), photoLabelKey(fallback)].filter(Boolean);
  return new Set(keys.flatMap((key) => aliasMap[key] || [key]));
}

function receptionPhotoByLabel(rec, label, fallback = "") {
  const photos = receptionPhotos(rec);
  const targets = photoLabelTargets(label, fallback);
  return photos.find((photo) => targets.has(photoLabelKey(photo.label))) || null;
}

function rawReceptionPhotoByLabel(rec, label, fallback = "") {
  const photos = Array.isArray(rec?.photos) ? rec.photos : [];
  const targets = photoLabelTargets(label, fallback);
  return photos.find((photo) => targets.has(photoLabelKey(photo?.label))) || null;
}

function receptionTableThumb(rec, label = "Frente", fallback = "", className = "") {
  const photo = label === "Frente" ? frontReceptionPhoto(rec) : receptionPhotoByLabel(rec, label, fallback);
  const shortLabel = label.replace(/^Tarjeta\s+/i, "");
  if (photo?.dataUrl) {
    return `<button type="button" class="table-thumb ${className}" data-action="open-image-preview" data-id="${esc(rec.id)}" data-label="${esc(label)}" title="Ver ${esc(label)}"><img src="${photo.dataUrl}" alt="${esc(label)} ${esc(rec.vehicle?.marca || "vehículo")}"></button>`;
  }
  return `<div class="table-thumb table-thumb-empty ${className}">${esc(shortLabel)}</div>`;
}

function mobileVehiclePhoto(rec) {
  return dashboardThumbnailInfo(rec).src || "";
}

function mobileVehicleCardBackPhoto(rec) {
  return receptionPhotoByLabel(rec, "Tarjeta reverso")?.dataUrl || "";
}

function mobileVehicleStatusClass(status = "") {
  const value = String(status || "").toUpperCase();
  if (value.includes("FINALIZADO") || value.includes("ENTREGADO")) return "mobile-status-ok";
  if (value.includes("PAUSA") || value.includes("PENDIENTE") || value.includes("ESPERA")) return "mobile-status-warn";
  if (value.includes("PROBLEMA") || value.includes("ERROR")) return "mobile-status-danger";
  return "mobile-status-info";
}

function mobileVehicleTitle(rec) {
  const vehicle = rec.vehicle || {};
  return `${vehicle.marca || ""} ${vehicle.modelo || ""} ${vehicle.anio || ""}`.trim() || "Vehículo";
}

function adminVehicleCloudStatus(rec) {
  const status = String(rec?.cloudStatus || "").toLowerCase();
  if (!["pending", "confirmed", "error"].includes(status)) return "";
  const label = status === "confirmed" ? "Respaldo en nube" : status === "error" ? "Nube sin confirmar" : "Subiendo respaldo";
  const retry = status === "error"
    ? `<button type="button" class="vehicle-cloud-retry" data-action="retry-admin-cloud" data-id="${esc(rec.id)}">Reintentar</button>`
    : "";
  return `<div class="vehicle-cloud-state ${status}"><span class="vehicle-cloud-pill">${label}</span>${retry}</div>`;
}

function mobileAdminAuthorizationStatus(rec) {
  if (signatureNeedsAdminReview(rec)) {
    return '<div class="mobile-authorization-state warn"><span>Autorización</span><strong>Firma capturada</strong></div>';
  }
  if (rec?.signed) {
    return '<div class="mobile-authorization-state ok"><span>Autorización</span><strong>Autorizado</strong></div>';
  }
  if (rec?.express) {
    return '<div class="mobile-authorization-state info"><span>Autorización</span><strong>No aplica</strong></div>';
  }
  return '<div class="mobile-authorization-state warn"><span>Autorización</span><strong>Pendiente</strong></div>';
}

function mobileAdminActionsMenu(rec) {
  let actions = "";
  if (isDeleted(rec)) {
    actions = `
      <button type="button" class="btn" data-action="download-backup" data-id="${esc(rec.id)}">Descargar expediente</button>
      <button type="button" class="btn" data-action="restore-trash-reception" data-id="${esc(rec.id)}">Restaurar al dashboard</button>
      <button type="button" class="btn danger" data-action="purge-trash-reception" data-id="${esc(rec.id)}">Eliminar definitivamente</button>`;
  } else if (isArchived(rec)) {
    actions = `
      <button type="button" class="btn primary" data-action="download-local-archive" data-id="${esc(rec.id)}">Descargar expediente</button>
      <button type="button" class="btn" data-action="unarchive-reception" data-id="${esc(rec.id)}">Desarchivar</button>
      <button type="button" class="btn danger" data-action="delete-reception" data-id="${esc(rec.id)}">Mover a papelera</button>`;
  } else {
    actions = `
      <button type="button" class="btn" data-action="grant-deadline-token" data-id="${esc(rec.id)}">Dar más tokens</button>
      ${String(rec.status || "").toUpperCase() === "FINALIZADO" ? `<button type="button" class="btn primary" data-action="reactivate-reception" data-id="${esc(rec.id)}">Reactivar vehículo</button>` : ""}
      <button type="button" class="btn" data-action="archive-reception" data-id="${esc(rec.id)}">Archivar</button>
      <button type="button" class="btn danger" data-action="delete-reception" data-id="${esc(rec.id)}">Eliminar</button>`;
  }
  return `
    <details class="action-menu mobile-admin-action-menu">
      <summary class="btn mobile-admin-menu-trigger" data-action="toggle-mobile-admin-menu">Más opciones</summary>
      <div class="action-menu-list">
        <button type="button" class="btn" data-action="open-file" data-id="${esc(rec.id)}">Abrir expediente</button>
        ${actions}
      </div>
    </details>`;
}

function renderMobileVehicleCard(rec, options = {}) {
  const thumbInfo = dashboardThumbnailInfo(rec);
  const photo = thumbInfo.src;
  const cardBackAvailable = !!rawReceptionPhotoByLabel(rec, "Tarjeta reverso")?.dataUrl;
  const status = options.status || rec.status || "EN PROCESO";
  const owner = options.owner || rec.employeeName || "Sin técnico";
  const subtitle = options.subtitle || rec.number || rec.vehicle?.placa || "";
  const notificationCount = mobileVehicleNotificationCount(rec);
  const notificationBadge = notificationCount
    ? `<button type="button" class="mobile-notification-badge" data-action="open-mobile-notification-detail" data-id="${esc(rec.id)}" aria-label="${notificationCount} notificaciones pendientes">${notificationCount}</button>`
    : "";
  const attrs = options.employee
    ? `data-action="open-employee-vehicle" data-id="${esc(rec.id)}"`
    : `data-open-file-row="${esc(rec.id)}"`;
  const authorizationStatus = mobileAdminAuthorizationStatus(rec);
  const finalizationButton = !options.employee && finalizationNeedsPublish(rec)
    ? `<button type="button" class="btn primary mobile-publish-finalization" data-action="publish-finalization" data-id="${esc(rec.id)}">Publicar finalización</button>`
    : "";
  const adminActions = options.employee ? "" : mobileAdminActionsMenu(rec);
  const trashSelector = !options.employee && adminDashboardFilter === "trash"
    ? `<label class="trash-card-selector" title="Seleccionar ${esc(rec.number || "expediente")}"><input type="checkbox" data-trash-select-id="${esc(rec.id)}" ${trashSelectedIds.has(rec.id) ? "checked" : ""}><span>Seleccionar</span></label>`
    : "";
  return `
    <article class="mobile-vehicle-card" ${attrs} role="button" tabindex="0">
      ${trashSelector}
      <div class="mobile-vehicle-photo ${photo ? "" : "empty"}">
        ${notificationBadge}
        ${photo ? `<img src="${photo}" alt="${esc(mobileVehicleTitle(rec))}">` : `<span>${thumbInfo.status === "missing" ? "Sin fotografía" : thumbInfo.status === "error" ? "Imagen no disponible" : "Cargando imagen…"}</span>`}
      </div>
      <div class="mobile-vehicle-info">
        <span class="mobile-vehicle-status ${mobileVehicleStatusClass(status)}">${esc(status)}</span>
        ${authorizationStatus}
        <strong>${esc(mobileVehicleTitle(rec))}</strong>
        <small>${esc(owner)}</small>
        ${subtitle ? `<em>${esc(subtitle)}</em>` : ""}
        ${adminVehicleCloudStatus(rec)}
        ${deadlineMobileGauge(rec)}
        ${finalizationButton}
        <div class="mobile-vehicle-actions">
          <button type="button" class="mobile-card-link ${cardBackAvailable ? "" : "disabled"}" data-action="open-mobile-card-photo" data-id="${esc(rec.id)}" ${cardBackAvailable ? "" : "disabled"}>${cardBackAvailable ? "Tarjeta" : "Sin tarjeta"}</button>
        </div>
        ${adminActions}
      </div>
    </article>`;
}

function mobileVehicleNotificationCount(rec) {
  const list = Array.isArray(rec?.employeeNotifications) ? rec.employeeNotifications : [];
  const employeePending = list.filter((item) => item && !item.deleted && !item.adminAckAt).length;
  const clientPending = receptionNotificationAckCount(rec);
  const signaturePending = signatureNeedsAdminReview(rec) ? 1 : 0;
  return employeePending + clientPending + signaturePending;
}

function mobileVehicleNotificationSummary(rec) {
  const messages = [];
  if (signatureNeedsAdminReview(rec)) messages.push("Hay firma pendiente de revisión.");
  const clientPending = receptionNotificationAckCount(rec);
  if (clientPending) messages.push(`${clientPending} confirmación(es) del cliente pendiente(s) de revisar.`);
  const list = Array.isArray(rec?.employeeNotifications) ? rec.employeeNotifications : [];
  const employeePending = list.filter((item) => item && !item.deleted && !item.adminAckAt);
  if (employeePending.length) {
    const first = employeePending[0]?.message ? ` ${employeePending[0].message}` : "";
    messages.push(`${employeePending.length} notificación(es) del vehículo pendiente(s).${first}`);
  }
  return messages.length ? messages.join("\n") : "No hay notificaciones pendientes para este expediente.";
}

function openMobileNotificationDetail(recId) {
  const rec = state().receptions.find((item) => item.id === recId);
  if (!rec) return;
  alert(mobileVehicleNotificationSummary(rec));
  const targetTab = signatureNeedsAdminReview(rec) ? "autorización" : "notificaciones";
  openAdminReceptionFile(rec.id, false);
  adminFileTab = targetTab;
  showAdminFileTab(targetTab);
  pushAdminHash(`expediente=${encodeURIComponent(rec.id)}&tab=${encodeURIComponent(targetTab)}`);
}

function renderAdminMobileGallery(records) {
  const host = qs("[data-admin-mobile-gallery]");
  if (!host) return;
  host.innerHTML = records.length
    ? records.map((rec) => renderMobileVehicleCard(rec, {
        owner: rec.employeeName || "Sin técnico",
        subtitle: `${rec.client?.name || "Cliente pendiente"} · ${rec.number || ""}`
      })).join("")
    : '<div class="mobile-gallery-empty">No hay vehículos en este filtro.</div>';
  initActionMenus();
}

function updateTrashBulkControls(records = []) {
  const toolbar = qs("[data-trash-bulk-toolbar]");
  if (!toolbar) return;
  const trashRecords = records.filter(isDeleted);
  const visibleIds = new Set(trashRecords.map((rec) => rec.id));
  trashSelectedIds = new Set([...trashSelectedIds].filter((id) => visibleIds.has(id)));
  const isTrash = adminDashboardFilter === "trash";
  toolbar.classList.toggle("hidden", !isTrash);
  const selectAll = qs("[data-trash-select-all]", toolbar);
  const selectedCount = trashSelectedIds.size;
  if (selectAll) {
    selectAll.disabled = !trashRecords.length;
    selectAll.checked = !!trashRecords.length && selectedCount === trashRecords.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < trashRecords.length;
  }
  const count = qs("[data-trash-selected-count]", toolbar);
  if (count) count.textContent = `${selectedCount} seleccionado${selectedCount === 1 ? "" : "s"}`;
  const purge = qs('[data-action="purge-selected-trash"]', toolbar);
  if (purge) purge.disabled = !selectedCount;
}

function closeImagePreview() {
  qs("[data-image-modal]")?.classList.add("hidden");
}

function dataUrlToFile(dataUrl, fileName = "tarjeta-reverso.jpg") {
  const parts = String(dataUrl || "").split(",");
  const match = /^data:(.*?);base64$/i.exec(parts[0] || "");
  if (!match || !parts[1]) return null;
  const binary = atob(parts[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName, { type: match[1] || "image/jpeg" });
}

async function shareMobileCardBack(recId) {
  const rec = state().receptions.find((item) => item.id === recId);
  const dataUrl = mobileVehicleCardBackPhoto(rec);
  if (!rec || !dataUrl) {
    toast("Este expediente no tiene tarjeta reverso cargada.", "warn");
    return;
  }
  const title = `Tarjeta ${rec.number || ""}`.trim();
  const text = `${title} - ${mobileVehicleTitle(rec)}`;
  const file = dataUrlToFile(dataUrl, `${(rec.number || "tarjeta").replace(/[^\w-]+/g, "-")}-reverso.jpg`);
  try {
    if (file && navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ title, text, files: [file] });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title, text });
      return;
    }
    const whatsappText = encodeURIComponent(`${text}\n\nAbra el expediente para revisar la tarjeta.`);
    window.location.href = `whatsapp://send?text=${whatsappText}`;
    setTimeout(() => toast("Si no abrió WhatsApp, pruebe este botón desde el enlace publicado en GitHub Pages.", "warn"), 900);
  } catch (error) {
    if (error?.name !== "AbortError") toast("No se pudo abrir el menú para compartir.", "danger");
  }
}

function closeMobileCardBackViewer() {
  qs("[data-mobile-card-viewer]")?.remove();
}

async function openMobileCardBackViewer(recId) {
  const rec = state().receptions.find((item) => item.id === recId);
  if (!rec) return;
  let dataUrl = mobileVehicleCardBackPhoto(rec);
  if (!dataUrl && rawReceptionPhotoByLabel(rec, "Tarjeta reverso")?.dataUrl) {
    try {
      await globalThis.AM_CLOUD_SYNC?.ensureReceptionPhotos?.(rec);
      dataUrl = mobileVehicleCardBackPhoto(rec);
    } catch (error) { console.warn("No se pudo cargar tarjeta reverso", error); }
  }
  if (!dataUrl) {
    toast("Este expediente no tiene tarjeta reverso disponible.", "warn");
    return;
  }
  closeMobileCardBackViewer();
  const modal = document.createElement("div");
  modal.className = "mobile-card-viewer";
  modal.dataset.mobileCardViewer = "1";
  modal.innerHTML = `
    <article class="mobile-card-viewer-panel" role="dialog" aria-modal="true">
      <div class="mobile-card-viewer-head">
        <button type="button" class="btn" data-action="close-mobile-card-photo">Atrás</button>
        <div>
          <strong>Tarjeta</strong>
          <small>${esc(rec.number || mobileVehicleTitle(rec))}</small>
        </div>
        <button type="button" class="btn primary" data-action="share-mobile-card-photo" data-id="${esc(rec.id)}">Compartir</button>
      </div>
      <div class="mobile-card-viewer-body">
        <img src="${dataUrl}" alt="Tarjeta reverso ${esc(mobileVehicleTitle(rec))}">
      </div>
    </article>`;
  document.body.appendChild(modal);
  if (!history.state?.mobileCardViewer) history.pushState({ ...(history.state || {}), mobileCardViewer: true }, "", location.href);
}

function openImagePreview(recId, label) {
  const rec = state().receptions.find((item) => item.id === recId);
  if (!rec) return;
  const photo = label === "Frente" ? frontReceptionPhoto(rec) : receptionPhotoByLabel(rec, label);
  if (!photo?.dataUrl) return;
  openImagePreviewFromData(photo.dataUrl, `${label} - ${rec.number || ""}`, `${label} ${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""}`.trim());
}

function openImagePreviewFromData(dataUrl, title = "Imagen", alt = "") {
  if (!dataUrl) return;
  let modal = qs("[data-image-modal]");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "image-modal hidden";
    modal.dataset.imageModal = "1";
    modal.innerHTML = `
      <div class="image-modal-card" role="dialog" aria-modal="true">
        <div class="image-modal-head">
          <h3 data-image-modal-title>Imagen</h3>
          <button type="button" class="btn" data-action="close-image-preview">Cerrar</button>
        </div>
        <div class="image-modal-body"><img data-image-modal-img alt=""><video class="hidden" data-image-modal-video controls playsinline></video></div>
      </div>`;
    document.body.appendChild(modal);
  }
  qs("[data-image-modal-title]", modal).textContent = title;
  const img = qs("[data-image-modal-img]", modal);
  const video = qs("[data-image-modal-video]", modal);
  if (video) {
    video.pause?.();
    video.removeAttribute("src");
    video.load?.();
    video.classList.add("hidden");
  }
  img.classList.remove("hidden");
  img.src = dataUrl;
  img.alt = alt || title;
  modal.classList.remove("hidden");
}

function openVideoPreviewFromData(dataUrl, title = "Video") {
  if (!dataUrl) return;
  openImagePreviewFromData(dataUrl, title, title);
  const modal = qs("[data-image-modal]");
  const img = qs("[data-image-modal-img]", modal);
  const video = qs("[data-image-modal-video]", modal);
  if (!video) return;
  img?.classList.add("hidden");
  video.src = dataUrl;
  video.classList.remove("hidden");
  video.load?.();
}

function authorizationTermsHtml() {
  return `
    <h3>Contrato de servicio</h3>
    <p>El cliente autoriza a Automotriz Medina a recibir el vehículo identificado en esta recepción y a realizar las revisiones, pruebas, diagnósticos, desmontajes y verificaciones necesarias para determinar el estado del vehículo, la falla reportada y el trabajo requerido.</p>
    <p>El cliente o persona responsable del vehículo acepta que todo diagnóstico, revisión, prueba, desmontaje, verificación, mano de obra, reparación, repuesto o servicio previamente autorizado y efectivamente realizado deberá ser cancelado en su totalidad. Si después del diagnóstico el cliente decide no continuar con la reparación, igualmente deberá cancelar el costo correspondiente al diagnóstico, revisión, pruebas o procedimientos realizados hasta ese momento. Dicho costo podrá determinarse al finalizar el proceso de revisión o diagnóstico, según el tiempo, pruebas y procedimientos necesarios, y será informado y detallado al cliente.</p>
    <p>Cuando el cliente autorice una reparación, acepta pagar el costo total de los trabajos realizados, repuestos utilizados, mano de obra y cualquier cargo relacionado que haya sido previamente informado y autorizado. Automotriz Medina proporcionará el detalle de los conceptos cobrados. El vehículo podrá ser retenido únicamente en los casos y condiciones permitidos por la legislación aplicable, mientras existan saldos vencidos correspondientes a trabajos, repuestos o servicios autorizados.</p>
    <p>El cliente acepta que las reparaciones, repuestos, trabajos adicionales o intervenciones especiales que excedan el diagnóstico inicial o el motivo principal de ingreso deberán ser informados y autorizados previamente por el cliente o persona responsable. Los procedimientos necesarios para diagnosticar, verificar o confirmar la falla reportada podrán realizarse como parte del proceso de revisión autorizado. La falta de respuesta del cliente no se considerará una autorización.</p>
    <p>Si el cliente decide retirar el vehículo y no continuar con el diagnóstico o reparación, deberá cancelar los trabajos autorizados y realizados hasta ese momento, el diagnóstico efectuado, los repuestos o servicios previamente autorizados y, cuando sea necesario para entregar el vehículo de forma segura, el desmontaje o rearmado previamente informado. No se cobrarán trabajos que no hayan sido realizados.</p>
    <p>Si Automotriz Medina determina que no puede continuar con el diagnóstico o reparación por razones técnicas, de seguridad, falta de repuestos u otra causa justificada, se lo comunicará al cliente y coordinará la entrega del vehículo. En este caso, únicamente se cobrarán los trabajos y costos previamente autorizados que ya hayan sido realizados.</p>
    <p>El cliente autoriza a Automotriz Medina y a su personal encargado a hacer uso del vehículo para realizar pruebas de funcionamiento, pruebas de manejo y pruebas de carretera cuando sean necesarias para el diagnóstico, verificación de fallas, confirmación de una reparación o validación del trabajo realizado. Estas pruebas se limitarán al tiempo y recorrido razonablemente necesarios.</p>
    <p>El cliente acepta que las autorizaciones, confirmaciones, avisos y comunicaciones relacionadas con el servicio podrán realizarse por medios digitales, incluyendo este sistema, enlaces privados, mensajes de WhatsApp, correo electrónico u otros canales proporcionados por el cliente. Dichas confirmaciones quedarán registradas como constancia de la autorización o comunicación correspondiente.</p>
    <p>El cliente comprende que durante una revisión pueden aparecer fallas preexistentes, intermitentes o no visibles al momento de la recepción, así como desgaste natural, manipulaciones anteriores o condiciones ocultas del vehículo. Automotriz Medina no será responsable por fallas o daños cuya causa sea anterior y ajena al trabajo realizado, sin perjuicio de la responsabilidad que legalmente corresponda por daños atribuibles a la intervención del taller.</p>
    <p>La garantía de mano de obra aplica por 30 días continuos, cuando corresponda, contados desde la entrega del vehículo y siempre que la parte relacionada con el trabajo reclamado no haya sido intervenida posteriormente por terceros. La garantía cubre deficiencias directamente relacionadas con el trabajo realizado y no cubre fallas diferentes o preexistentes, desgaste normal ni daños causados por uso inadecuado.</p>
    <p>Cuando el cliente proporcione repuestos, Automotriz Medina no podrá garantizar su calidad, procedencia, durabilidad, compatibilidad o funcionamiento, pero conservará la responsabilidad y garantía que corresponda sobre la instalación o mano de obra realizada. Esta garantía no limita los demás derechos reconocidos al consumidor por la legislación aplicable.</p>
    <p>El cliente o persona responsable declara que, antes de entregar el vehículo a Automotriz Medina, tuvo la oportunidad de revisarlo y de informar cualquier daño, rayón, golpe, faltante, condición especial, objeto personal, accesorio, documento, herramienta o situación relevante.</p>
    <p>Declara además haber retirado dinero, objetos de valor y pertenencias personales importantes antes de entregar el vehículo, y deberá informar cualquier objeto que permanezca en su interior. Al aceptar estos términos, reconoce que está enterado de las condiciones en que entrega el vehículo y que la información, observaciones y daños registrados reflejan la condición conocida al momento de la recepción.</p>
    <p>Automotriz Medina no recibe en depósito objetos que no hayan sido declarados. Esta condición no excluye la responsabilidad que legalmente corresponda al taller cuando se compruebe dolo, culpa o negligencia de su personal.</p>
    <p>El cliente acepta que el vehículo debe contar con combustible, batería y condiciones mínimas necesarias para realizar pruebas, diagnóstico o movilización interna. Si se requiere combustible, carga de batería, grúa u otro apoyo externo que genere un costo, Automotriz Medina solicitará previamente la autorización del cliente.</p>
    <p>En una situación urgente destinada exclusivamente a evitar un daño inmediato al vehículo o a terceros, el taller podrá adoptar únicamente las medidas indispensables y deberá informar al cliente tan pronto como sea posible.</p>
    <p>El cliente comprende que durante diagnósticos, desmontajes, revisiones o reparaciones pueden encontrarse componentes frágiles, deteriorados, resecos, quebradizos, corroídos, vencidos o previamente manipulados. Automotriz Medina informará los riesgos previsibles antes de intervenirlos y no será responsable por daños cuya causa sea exclusivamente preexistente o ajena a su actuación, manteniendo la responsabilidad que legalmente corresponda por el trabajo realizado.</p>
    <p>Una vez notificado por un medio verificable que el vehículo está listo para retiro, el cliente tendrá 72 horas para retirarlo sin cargo adicional. Después de ese periodo podrá aplicarse un cargo diario de $5.00 USD por resguardo, parqueo, pernocta o custodia, siempre que dicho cargo haya sido informado y aceptado y que la demora no sea responsabilidad del taller.</p>
    <p>Si el vehículo no es retirado ni reclamado durante 90 días continuos después de la notificación y no existe un acuerdo vigente con el cliente, Automotriz Medina podrá iniciar las gestiones legales correspondientes para resolver el resguardo del vehículo y recuperar los saldos pendientes por diagnóstico, reparación, repuestos, almacenaje u otros cargos previamente autorizados.</p>
    <p>El transcurso de dicho plazo no transfiere automáticamente la propiedad del vehículo a Automotriz Medina ni autoriza su venta o disposición fuera del procedimiento permitido por la ley.</p>
    <p>Al aceptar estos términos, el cliente autoriza proceder con el diagnóstico y/o reparación según la información acordada con el taller, autoriza el uso del vehículo para las pruebas necesarias y acepta las responsabilidades de pago, resguardo, comunicación digital y demás condiciones aquí descritas.</p>
    <p>Cualquier trabajo o costo adicional requerirá autorización expresa del cliente. Para consultas o reclamos podrá comunicarse con Automotriz Medina al WhatsApp +503 7166-0867 o al correo oficinaautomotrizmedina@gmail.com.</p>`;
}

function authorizationProofHtml(rec) {
  const evidence = rec.authorizationEvidence || {};
  return rec.signed ? `
    <div class="notice">
      <strong>Autorizado por:</strong> ${esc(rec.signatureName || rec.client.name || "Cliente")}<br>
      <strong>Fecha:</strong> ${esc(rec.signatureDate || "")}<br>
      <strong>Tipo de autorización:</strong> ${esc(evidence.authorizationType || "Cliente por link")}<br>
      <strong>Registrado por:</strong> ${esc(evidence.registeredBy || "Cliente")}<br>
      <strong>Navegador:</strong> ${esc(evidence.userAgent || "No registrado")}<br>
      <strong>Plataforma:</strong> ${esc(evidence.platform || "No registrado")}<br>
      <strong>Idioma:</strong> ${esc(evidence.language || "No registrado")}<br>
      <strong>Zona horaria:</strong> ${esc(evidence.timezone || "No registrado")}<br>
      <strong>Pantalla:</strong> ${esc(evidence.screen || "No registrado")}<br>
      <strong>Ventana:</strong> ${esc(evidence.viewport || "No registrado")}
    </div>
    ${rec.signatureDataUrl ? `<div class="signature-preview"><strong>Firma registrada:</strong><br><img src="${rec.signatureDataUrl}" alt="Firma del cliente"></div>` : ""}` : '<div class="notice warn">Aún no hay autorización del cliente.</div>';
}

function renderAdminAuthorizationView(rec) {
  const host = qs("[data-admin-authorization-view]");
  if (!host) return;
  const statusLabel = rec.signed ? "Autorizado" : "Pendiente de autorización";
  const statusClass = rec.signed ? "ok" : "warn";
  host.innerHTML = `
    <article class="panel admin-authorization-view" data-admin-authorization-card>
      <div class="panel-header">
        <div><h3>Autorización administrativa</h3><p>Vista interna del expediente enviado y constancia del cliente.</p></div>
        <span class="pill ${statusClass}">${statusLabel}</span>
      </div>
      <div class="panel-body grid">
        <div class="grid cols-3">
          <div class="metric"><span>Cliente</span><strong>${esc(rec.client.name || "Cliente pendiente")}</strong><small>${esc(rec.client.phone || "Sin teléfono")}</small></div>
          <div class="metric"><span>Vehículo</span><strong>${esc(`${rec.vehicle.marca || ""} ${rec.vehicle.modelo || ""}`.trim() || "Vehículo")}</strong><small>${esc(`${rec.vehicle.anio || ""} ${rec.vehicle.placa || ""}`.trim() || "Sin placa")}</small></div>
          <div class="metric"><span>Recepción</span><strong>${esc(rec.number || "")}</strong><small>${esc(rec.status || "")}</small></div>
        </div>
        <div class="notice">
          <strong>Motivo de recepción / falla reportada:</strong><br>
          ${esc(serviceReason(rec) || "Sin motivo registrado.")}
        </div>
        <div class="notice ${rec.signed ? "" : "warn"}">
          ${rec.signed
            ? "El cliente ya aceptó esta autorización. Esta es la copia administrativa de lo que autorizo y la constancia registrada para imprimir."
            : "Esta autorización aún no ha sido aceptada por el cliente. Aquí puede revisar el expediente que se envió o se enviará al cliente."}
        </div>
        <div class="terms-box" tabindex="0">${authorizationTermsHtml()}</div>
        <article class="panel">
          <div class="panel-header"><h3>Constancia de autorización</h3></div>
          <div class="panel-body grid">${authorizationProofHtml(rec)}</div>
        </article>
      </div>
    </article>`;
}

function receptionRowActions(rec) {
  if (isDeleted(rec)) {
    return `
      <button class="btn" data-action="download-backup" data-id="${rec.id}" title="Descargar expediente completo">Descargar</button>
      <button class="btn" data-action="restore-trash-reception" data-id="${rec.id}" title="Restaurar al dashboard">Restaurar</button>
      <button class="btn danger icon-remove table-remove" data-action="purge-trash-reception" data-id="${rec.id}" title="Eliminar definitivamente">X</button>`;
  }
  if (isArchived(rec)) {
    return `
      <button class="btn primary" data-action="download-local-archive" data-id="${rec.id}" title="Guardar este expediente en la carpeta local configurada">Descargar</button>
      <button class="btn" data-action="unarchive-reception" data-id="${rec.id}" title="Sacar de archivados">Desarchivar</button>
      <button class="btn danger icon-remove table-remove" data-action="delete-reception" data-id="${rec.id}" title="Mover a papelera">X</button>`;
  }
  return `
    <button class="btn" data-action="grant-deadline-token" data-id="${rec.id}" title="Habilitar tokens extra">Token +</button>
    ${String(rec.status || "").toUpperCase() === "FINALIZADO" ? `<button class="btn primary" data-action="reactivate-reception" data-id="${rec.id}" title="Reactivar y devolver a vehículos en taller">Reactivar</button>` : ""}
    <button class="btn" data-action="archive-reception" data-id="${rec.id}" title="Archivar expediente">Archivar</button>
    <button class="btn danger icon-remove table-remove" data-action="delete-reception" data-id="${rec.id}" title="Mover a papelera">X</button>`;
}

function renderReceptionTable() {
  const tbody = qs("[data-reception-table]");
  if (!tbody) return;
  const current = state();
  const filtered = applyAdminSearchFilters(current.receptions.filter((rec) => {
    if (adminDashboardFilter === "archived") return isArchived(rec);
    if (adminDashboardFilter === "trash") return isDeleted(rec);
    if (adminDashboardFilter === "finished") return isActiveDashboardRec(rec) && rec.status === "FINALIZADO";
    if (!isActiveDashboardRec(rec)) return false;
    if (isPublishedFinalized(rec)) return false;
    if (adminDashboardFilter === "employee") {
      const employeeId = String(rec.employeeId || rec.employeeName || "").toLowerCase();
      return employeeId.includes(adminEmployeeFilter);
    }
    if (adminDashboardFilter === "workshop") return rec.status !== "FINALIZADO" && rec.status !== "ENTREGADO";
    if (adminDashboardFilter === "delivered") return rec.status === "ENTREGADO";
    if (adminDashboardFilter === "pending") return !rec.signed;
    if (adminDashboardFilter === "sent") return !!rec.sentToClient;
    return true;
  })).filter(matchesDashboardQuickSearch);
  syncDashboardQuickSearchInput();
  qsa("[data-admin-search-count]").forEach((input) => { input.value = `${filtered.length} expediente(s)`; });
  renderAdminMobileGallery(filtered);
  updateTrashBulkControls(filtered);
  tbody.innerHTML = filtered.map((rec) => `
    <tr class="clickable-row ${String(rec.status || "").toUpperCase() === "FINALIZADO" ? "row-finalized" : ""} ${signatureNeedsAdminReview(rec) ? "row-signature-review" : ""}" data-open-file-row="${rec.id}" tabindex="0" title="Abrir seguimiento">
      <td data-label="Vehículo">${isDeleted(rec) ? `<label class="trash-row-selector"><input type="checkbox" data-trash-select-id="${esc(rec.id)}" ${trashSelectedIds.has(rec.id) ? "checked" : ""}><span>Seleccionar</span></label>` : ""}${finalizationNeedsPublish(rec) ? `<button class="btn primary publish-finalization-btn" data-action="publish-finalization" data-id="${rec.id}" title="Publicar finalización al cliente">Publicar finalización</button>` : ""}<strong>${rec.vehicle.marca} ${rec.vehicle.modelo} ${rec.vehicle.anio}</strong>${receptionNotificationAckCount(rec) ? `<span class="vehicle-notify-count admin-vehicle-notify-count" title="Confirmaciones pendientes">${receptionNotificationAckCount(rec)}</span>` : ""}${signatureNeedsAdminReview(rec) ? `<span class="vehicle-notify-count admin-vehicle-notify-count signature-review-count" title="Firma pendiente de revisión">!</span>` : ""}<br><small>${rec.vehicle.placa}</small>${adminVehicleCloudStatus(rec)}</td>
      <td data-label="Miniatura">${dashboardThumbnailMarkup(rec)}</td>
      <td data-label="Técnico">${esc(rec.employeeName || "N/D")}</td>
      <td data-label="Tiempo límite">${deadlineBadge(rec)}</td>
      <td data-label="Estado"><span class="pill ${statusTone(rec.status)}">${rec.status}</span>${rec.express ? `<br><small>${esc(rec.serviceType || "Servicio express")}</small>` : ""}</td>
      <td data-label="Autorización">${adminAuthorizationCell(rec)}</td>
      <td data-label="Cliente">${esc(rec.client.name || "Cliente pendiente")}<br><small>${esc(rec.client.phone || "Sin teléfono")}</small></td>
      <td data-label="Motivo">${esc(shortText(serviceReason(rec) || "Sin motivo registrado", 110))}</td>
      <td data-label="Recepción"><strong>${esc(rec.number)}</strong><br><small>${isDeleted(rec) ? `Papelera: ${esc(new Date(rec.deletedAt).toLocaleDateString("es-SV"))}` : esc(rec.clientToken)}</small><div class="table-actions">${receptionRowActions(rec)}</div></td>
    </tr>`).join("") || '<tr><td colspan="9">No hay vehículos en este filtro.</td></tr>';
  qsa("[data-admin-filter]").forEach((button) => {
    const isEmployee = button.dataset.adminFilter === "employee" && adminDashboardFilter === "employee" && button.dataset.employeeFilter === adminEmployeeFilter;
    const isDirect = button.dataset.adminFilter !== "employee" && button.dataset.adminFilter === adminDashboardFilter;
    button.classList.toggle("active", isEmployee || isDirect);
  });
  const employeeMenu = qs("[data-employee-filter-menu]");
  if (employeeMenu) employeeMenu.classList.toggle("hidden", adminDashboardFilter !== "employee" && adminDashboardFilter !== "workshop");
  qsa("[data-admin-metric-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminMetricFilter === adminDashboardFilter);
  });
}

function clientCatalogKey(rec) {
  const client = rec.client || {};
  const name = normalizeSearchText(client.name || "cliente pendiente");
  const phone = normalizeSearchText(client.phone || "");
  return `${name}|${phone}`;
}

function clientDisplayName(rec) {
  return rec.client?.name || "Cliente pendiente";
}

function clientYearSummary(records) {
  const counts = {};
  records.forEach((rec) => {
    const time = receptionDateMs(rec);
    const year = time ? new Date(time).getFullYear() : "Sin fecha";
    counts[year] = (counts[year] || 0) + 1;
  });
  return Object.entries(counts)
    .sort(([a], [b]) => String(b).localeCompare(String(a)))
    .map(([year, count]) => `${year}: ${count}`)
    .join(" | ");
}

function renderClientCatalog() {
  const host = qs("[data-client-catalog]");
  if (!host) return;
  const records = applyAdminSearchFilters(state().receptions.filter((rec) => !isDeleted(rec)));
  const groups = new Map();
  records.forEach((rec) => {
    const key = clientCatalogKey(rec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  });
  const clients = Array.from(groups.values()).sort((a, b) => clientDisplayName(a[0]).localeCompare(clientDisplayName(b[0]), "es"));
  qsa("[data-admin-search-count]").forEach((input) => { input.value = `${records.length} expediente(s) / ${clients.length} cliente(s)`; });
  host.innerHTML = clients.map((recordsForClient) => {
    const first = recordsForClient[0];
    const vehicles = new Set(recordsForClient.map((rec) => normalizeSearchText(`${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""} ${rec.vehicle?.placa || ""}`)).filter(Boolean));
    const sorted = recordsForClient.slice().sort((a, b) => receptionDateMs(b) - receptionDateMs(a));
    return `
      <article class="panel client-card">
        <div class="panel-header">
          <div>
            <h3>${esc(clientDisplayName(first))}</h3>
            <p>${esc(first.client?.phone || "Sin teléfono")} | ${recordsForClient.length} expediente(s) | ${vehicles.size || recordsForClient.length} vehículo(s)</p>
          </div>
          <span class="pill info">${esc(clientYearSummary(recordsForClient) || "Sin fechas")}</span>
        </div>
        <div class="panel-body table-wrap">
          <table>
            <thead><tr><th>Vehículo</th><th>Recepción</th><th>Técnico</th><th>Estado</th><th>Autorización</th><th>Acción</th></tr></thead>
            <tbody>
              ${sorted.map((rec) => `
                <tr class="clickable-row" data-open-file-row="${rec.id}" tabindex="0" title="Abrir seguimiento">
                  <td data-label="Vehículo">${esc(`${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim() || "Vehículo")}<br><small>${esc(rec.vehicle?.placa || rec.vehicle?.vin || "Sin placa")}</small></td>
                  <td data-label="Recepción"><strong>${esc(rec.number || "")}</strong><br><small>${esc(rec.tracking?.receptionDate || "")}</small></td>
                  <td data-label="Técnico">${esc(rec.employeeName || "N/D")}</td>
                  <td data-label="Estado"><span class="pill ${statusTone(rec.status)}">${esc(rec.status || "")}</span>${isArchived(rec) ? '<br><small>Archivado</small>' : ""}</td>
                  <td data-label="Autorización">${rec.signed ? '<span class="pill ok">Autorizado</span>' : (rec.express ? '<span class="pill info">No aplica</span>' : '<span class="pill warn">Pendiente</span>')}</td>
                  <td data-label="Acción"><div class="table-actions"><button class="btn" data-action="download-backup" data-id="${rec.id}">Descargar</button><button class="btn primary" data-action="open-file" data-id="${rec.id}">Abrir</button></div></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </article>`;
  }).join("") || '<div class="notice">No hay clientes que coincidan con la búsqueda.</div>';
}

function saveAdminAllFromDom(current) {
  const rec = AM_SIMPLE_STORE.selected(current);
  if (!rec) return;
  qsa("[data-admin-client-field]").forEach((input) => {
    const key = input.dataset.adminClientField;
    if (key) rec.client[key] = input.value || "";
  });
  const get = (key) => qs(`[data-admin-edit="${key}"]`)?.value || "";
  if (qs('[data-admin-edit="employeeName"]')) {
    rec.employeeName = get("employeeName") || rec.employeeName;
    rec.employeeId = String(rec.employeeName || "").toLowerCase();
    rec.status = get("status") || rec.status;
    rec.adminEdited = true;
    rec.vehicle.marca = get("marca");
    rec.vehicle.modelo = get("modelo");
    rec.vehicle.anio = get("anio");
    rec.vehicle.color = get("color");
    rec.vehicle.placa = get("placa");
    rec.vehicle.vin = get("vin");
    rec.vehicle.kilometraje = get("kilometraje");
    rec.serviceReason = get("serviceReason");
    rec.observations = get("observations");
    rec.inventory.forEach((item) => {
      item.present = !!qs(`[data-admin-inv-present="${item.id}"]`)?.checked;
      item.note = qs(`[data-admin-inv-note="${item.id}"]`)?.value || "";
    });
    rec.photos.forEach((photo, index) => {
      photo.note = qs(`[data-admin-photo-note="${index}"]`)?.value || "";
    });
    rec.damages.forEach((damage) => {
      damage.área = qs(`[data-admin-damage-área="${damage.id}"]`)?.value || "";
      damage.detail = qs(`[data-admin-damage-detail="${damage.id}"]`)?.value || "";
    });
  }
  const profile = trackingProfile(rec);
  qsa("[data-track-field]").forEach((input) => {
    profile[input.dataset.trackField] = input.value;
  });
  if (qs("[data-admin-progress]")) rec.progress = Number(qs("[data-admin-progress]").value || 0);
  const processInputs = qsa("[data-admin-process-row]");
  if (processInputs.length) profile.processDetails = collectAdminProcessRows().map(formatProcessRow).join("\n");
  const internalInputs = qsa("[data-admin-internal-row]");
  if (internalInputs.length) {
    const rows = internalInputs.map((input) => input.value.trim()).filter(Boolean);
    rec.internalWork = { ...(rec.internalWork || {}), internalNote: rows.join("\n"), lockedReception: true };
  }
  profile.vehicleTitle = profile.vehicleTitle || `${rec.vehicle.marca} ${rec.vehicle.modelo} ${rec.vehicle.anio}`.trim().toUpperCase();
  profile.plate = profile.plate || rec.vehicle.placa || "N/D";
  profile.odometer = profile.odometer || (rec.vehicle.kilometraje ? `${rec.vehicle.kilometraje} MILLAS` : "N/D");
  rec.status = profile.state || rec.status;
  rec.progressLabel = profile.state || rec.status || "En proceso";
}

function adminHashParams() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  return new URLSearchParams(raw);
}

function pushAdminHash(hash) {
  const next = hash.startsWith("#") ? hash : `#${hash}`;
  if (location.hash === next) return;
  history.pushState(null, "", next);
}

function isMobileReload() {
  const navEntry = performance.getEntriesByType?.("navigation")?.[0];
  return window.innerWidth <= 920 && (navEntry?.type === "reload" || performance.navigation?.type === 1);
}

function resetAdminInitialViewToDashboard() {
  if (document.body.dataset.page !== "admin") return;
  adminLocalArchivePreviewRec = null;
  adminFileTab = "";
  AM_SIMPLE_STORE.setSelectedId("");
  AM_SIMPLE_STORE.mutate((current) => { current.selectedId = ""; }, { markLocalWrite: false });
  if (location.hash !== "#dashboard") {
    history.replaceState({ amAdminView: "dashboard" }, "", `${location.pathname}${location.search}#dashboard`);
  }
}

function applyAdminHashRoute() {
  if (document.body.dataset.page !== "admin") return;
  const params = adminHashParams();
  const fileId = params.get("expediente");
  if (fileId) {
    const current = state();
    if (current.receptions.some((rec) => rec.id === fileId)) AM_SIMPLE_STORE.setSelectedId(fileId);
    const requestedTab = params.get("tab");
    const mobileAdmin = window.innerWidth <= 920;
    adminFileTab = requestedTab || (mobileAdmin ? "" : adminFileTab || "seguimiento");
    renderAdmin();
    showSection("expediente");
    showAdminFileTab(adminFileTab);
    return;
  }
  renderAdmin();
  showSection("dashboard");
}

function openAdminReceptionFile(id, shouldPush = true) {
  if (!id) return;
  adminLocalArchivePreviewRec = null;
  const current = state();
  if (!current.receptions.some((rec) => rec.id === id)) {
    toast("No se encontró el expediente seleccionado.", "danger");
    return;
  }
  AM_SIMPLE_STORE.setSelectedId(id);
  const initialTab = window.innerWidth <= 920 ? "" : "seguimiento";
  if (shouldPush) {
    const hash = initialTab ? `expediente=${encodeURIComponent(id)}&tab=${encodeURIComponent(initialTab)}` : `expediente=${encodeURIComponent(id)}`;
    pushAdminHash(hash);
  }
  adminFileTab = initialTab;
  renderAdmin();
  showSection("expediente");
  showAdminFileTab(adminFileTab);
  toast("Expediente abierto.");
}

function showSection(target, options = {}) {
  qsa("[data-section]").forEach((section) => section.classList.toggle("hidden", section.dataset.section !== target));
  if (target !== "expediente") document.body.classList.remove("admin-mobile-folder");
  qsa("[data-section-target]").forEach((button) => button.classList.toggle("active", button.dataset.sectionTarget === target));
  const dashboardFilters = qs("[data-dashboard-filter-menu]");
  const searchPanel = qs("[data-admin-search-panel]");
  if (searchPanel) searchPanel.classList.toggle("hidden", !(target === "dashboard" && adminDashboardFilter === "archived"));
  const expedienteMenu = qs("[data-expediente-menu]");
  const expedienteVineta = target === "vineta" && options.fromExpediente;
  if (target !== "expediente" && !expedienteVineta && expedienteMenu) expedienteMenu.classList.add("hidden");
  if (target === "dashboard") {
    if (expedienteMenu) expedienteMenu.classList.add("hidden");
    if (dashboardFilters) dashboardFilters.classList.remove("hidden");
  } else if (target === "expediente" || expedienteVineta) {
    if (expedienteMenu) expedienteMenu.classList.remove("hidden");
    if (dashboardFilters) dashboardFilters.classList.add("hidden");
  } else if (dashboardFilters) {
    dashboardFilters.classList.remove("hidden");
  }
  const mobile = qs("[data-mobile-nav]");
  if (mobile && mobile.querySelector(`option[value="${target}"]`)) mobile.value = target;
  if (target === "nube") renderCloudSettings();
}

function fillReceptionForm() {
  const form = qs("[data-reception-form]");
  if (!form) return;
  const rec = selected();
  Object.entries({ ...rec.client, ...rec.vehicle, observations: rec.observations }).forEach(([key, value]) => {
    const input = qs(`[name="${key}"]`, form);
    if (input) input.value = value || "";
  });
}

function collectReceptionForm() {
  const form = qs("[data-reception-form]");
  const data = new FormData(form);
  return {
    client: { name: data.get("name") || "Cliente", phone: data.get("phone") || "" },
    vehicle: {
      marca: data.get("marca") || "",
      modelo: data.get("modelo") || "",
      anio: data.get("anio") || "",
      color: data.get("color") || "",
      placa: data.get("placa") || "",
      vin: data.get("vin") || "",
      kilometraje: data.get("kilometraje") || ""
    },
    observations: data.get("observations") || ""
  };
}

function renderPhotoEditor() {
  const host = qs("[data-photo-editor]");
  if (!host) return;
  const rec = selected();
  host.innerHTML = receptionPhotos(rec).map((photo, index) => `
    <article class="photo-card">
      ${photoVisual(photo)}
      <div class="field">
        <label>${photo.label}</label>
        <input type="file" accept="image/*" capture="environment" data-photo-index="${index}">
        <input placeholder="Nota opcional" value="${photo.note || ""}" data-photo-note="${index}">
      </div>
    </article>`).join("");
}

function normalizeFuelLevel(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function fuelGaugeMarkup(value, interactive = false) {
  const level = normalizeFuelLevel(value);
  const position = level == null ? 50 : level;
  const fill = level == null ? 0 : level;
  return `
    <div class="fuel-gauge-card ${level == null ? "is-unset" : ""}" data-fuel-gauge>
      <div class="fuel-gauge-head"><strong>Combustible</strong><span data-fuel-readout>${level == null ? "Sin registrar" : `${level}%`}</span></div>
      <div class="fuel-gauge-shell">
        <div class="fuel-gauge-fill" style="width:${fill}%"></div>
        <span class="fuel-gauge-marker" style="left:${position}%" aria-hidden="true"></span>
        ${interactive ? `<input class="fuel-gauge-input" type="range" min="0" max="100" step="5" value="${position}" data-fuel-level aria-label="Nivel de combustible">` : ""}
      </div>
      <div class="fuel-gauge-labels"><span>E</span><span>1/4</span><span>1/2</span><span>3/4</span><span>F</span></div>
      <small>${interactive ? "Mueva el marcador para registrar el nivel aproximado." : "Registro interno del taller."}</small>
    </div>`;
}

function updateFuelGaugeVisual(input) {
  if (!input?.matches?.('[data-fuel-level]')) return;
  const card = input.closest('[data-fuel-gauge]');
  if (!card) return;
  const level = normalizeFuelLevel(input.value);
  if (level == null) return;
  card.classList.remove('is-unset');
  const fill = card.querySelector('.fuel-gauge-fill');
  const marker = card.querySelector('.fuel-gauge-marker');
  const readout = card.querySelector('[data-fuel-readout]');
  if (fill) fill.style.width = `${level}%`;
  if (marker) marker.style.left = `${level}%`;
  if (readout) readout.textContent = `${level}%`;
}

function renderInventory() {
  const host = qs("[data-inventory]");
  if (!host) return;
  const rec = selected();
  host.innerHTML = rec.inventory.map((item) => `
    <div class="check-item">
      <input type="checkbox" ${item.present ? "checked" : ""} data-inventory-present="${item.id}">
      <div style="width:100%">
        <strong>${item.name}</strong>
        <input placeholder="Detalle" value="${item.note || ""}" data-inventory-note="${item.id}">
      </div>
    </div>`).join("") + fuelGaugeMarkup(rec.internalWork?.fuelLevel, true);
}

function renderDamageEditor() {
  const host = qs("[data-damages]");
  if (!host) return;
  const rec = selected();
  host.innerHTML = rec.damages.map((damage) => `
    <article class="panel">
      <div class="panel-header">
        <div><h3>${damage.área}</h3><p>${damage.detail}</p></div>
        <button class="btn danger" data-action="remove-damage" data-id="${damage.id}">Quitar</button>
      </div>
      <div class="panel-body">
        <div class="photo-grid">
          ${damage.photos.map((photo, photoIndex) => `
            <article class="photo-card">
              ${photoVisual(photo)}
              <div class="field">
                <label>Foto del daño</label>
                <input type="file" accept="image/*" capture="environment" data-damage-photo="${damage.id}" data-photo-index="${photoIndex}">
              </div>
            </article>`).join("")}
        </div>
      </div>
    </article>`).join("") || '<div class="notice">No hay daños registrados.</div>';
}

function renderAdmin() {
  syncEmployeeModuleVehiclesIntoAdmin();
  AM_SIMPLE_STORE.mutate((current) => {
    purgeExpiredTrash(current);
  });
  syncAdminHashSelection();
  const current = state();
  const rec = selected();
  const metrics = qs("[data-admin-metrics]");
  if (metrics) {
    const visible = current.receptions.filter((rec) => isActiveDashboardRec(rec) && !isPublishedFinalized(rec));
    const activeRecords = current.receptions.filter(isActiveDashboardRec);
    const pending = visible.filter((r) => !r.signed).length;
    const sent = visible.filter((r) => r.sentToClient).length;
    const finished = activeRecords.filter((r) => r.status === "FINALIZADO").length;
    const delivered = activeRecords.filter((r) => r.status === "ENTREGADO").length;
    const archived = current.receptions.filter(isArchived).length;
    const adminNotifications = adminPendingNotificationAcks(current).length;
    metrics.innerHTML = `
      <button type="button" class="metric metric-button" data-admin-metric-filter="all"><span>Recepciones</span><strong>${visible.length}</strong><small>Activas en dashboard</small></button>
      <button type="button" class="metric metric-button" data-admin-metric-filter="pending"><span>Pendientes</span><strong>${pending}</strong><small>Cliente aún no autoriza</small></button>
      <button type="button" class="metric metric-button" data-admin-metric-filter="sent"><span>Enviadas</span><strong>${sent}</strong><small>Link generado</small></button>
      <button type="button" class="metric metric-button" data-admin-metric-filter="finished"><span>Finalizados</span><strong>${finished}</strong><small>Pendientes de entrega</small></button>
      <button type="button" class="metric metric-button" data-admin-metric-filter="delivered"><span>Entregados</span><strong>${delivered}</strong><small>Cerrados por admin</small></button>
      <button type="button" class="metric metric-button" data-admin-metric-filter="archived"><span>Archivados</span><strong>${archived}</strong><small>Fuera del dashboard</small></button>
      <button type="button" class="metric metric-button ${adminNotifications ? "admin-notification-alert" : ""}" data-action="open-admin-notification-summary"><span>Notificaciones</span><strong>${adminNotifications}</strong><small>${adminNotifications ? "Empleado cumplió - validar" : "Sin confirmaciones pendientes"}</small></button>`;
  }
  renderReceptionTable();
  const summary = qs("[data-admin-selected-summary]");
  if (summary) renderReceptionSummary(summary, rec);
  const links = qs("[data-client-links]");
  if (links) {
    const previewAttrs = adminPreviewLinkAttrs();
    links.innerHTML = rec ? `
      <div class="notice">
        Autorización cliente: <a href="${tokenHref("cliente.html", rec.clientToken)}"${previewAttrs}>${tokenHref("cliente.html", rec.clientToken)}</a><br>
        Seguimiento: <a href="${tokenHref("seguimiento.html", rec.trackingToken)}"${previewAttrs}>${tokenHref("seguimiento.html", rec.trackingToken)}</a>
      </div>` : '<div class="notice">Seleccione un expediente para ver enlaces.</div>';
  }
  const openClient = qs("[data-open-client]");
  if (openClient && rec) openClient.href = tokenHref("cliente.html", rec.clientToken);
  const openTracking = qs("[data-open-tracking]");
  if (openTracking && rec) openTracking.href = tokenHref("seguimiento.html", rec.trackingToken);
  renderAdminFile(rec);
  renderTrackingAdmin();
  renderAdminInvoices();
  renderTabs();
  showAdminFileTab(adminFileTab);
  syncAdminSearchInputs();
  renderClientCatalog();
  renderAdminNotifications();
}

function renderAdminNotifications() {
  const current = state();
  const globalHost = qs("[data-admin-global-notifications]");
  if (globalHost) {
    const items = ensureEmployeeNotifications(current).slice().sort((a, b) => String(b.completedAt || b.createdAt || "").localeCompare(String(a.completedAt || a.createdAt || "")));
    globalHost.innerHTML = renderNotificationCards(items, "No hay notificaciones generales enviadas.");
  }
  const countHost = qs("[data-admin-notification-count]");
  if (countHost) {
    const pending = adminPendingNotificationAcks(current).length;
    countHost.textContent = `${pending} pendiente(s)`;
    countHost.className = `pill ${pending ? "danger" : "ok"}`;
  }
  const vehicleHost = qs("[data-admin-vehicle-notifications]");
  if (vehicleHost) {
    const rec = selected();
    const items = rec ? ensureReceptionNotifications(rec).slice().sort((a, b) => String(b.completedAt || b.createdAt || "").localeCompare(String(a.completedAt || a.createdAt || ""))) : [];
    vehicleHost.innerHTML = renderNotificationCards(items, "No hay notificaciones para este vehículo.");
  }
}

function findNotificationInState(current, id) {
  const global = ensureEmployeeNotifications(current);
  const globalIndex = global.findIndex((item) => item.id === id);
  if (globalIndex >= 0) return { type: "global", list: global, index: globalIndex, item: global[globalIndex], rec: null };
  for (const rec of current.receptions || []) {
    const list = ensureReceptionNotifications(rec);
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) return { type: "vehicle", list, index, item: list[index], rec };
  }
  return null;
}

function syncAdminHashSelection() {
  if (document.body.dataset.page !== "admin") return;
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const params = new URLSearchParams(raw);
  const fileId = params.get("expediente");
  if (!fileId) return;
  const current = state();
  if (current.selectedId === fileId) return;
  if (!current.receptions.some((rec) => rec.id === fileId)) return;
  AM_SIMPLE_STORE.mutate((state) => {
    state.selectedId = fileId;
  });
}

function renderAdminFile(rec) {
  const hasSelection = !!rec;
  const empty = qs("[data-admin-file-empty]");
  const panel = qs("[data-admin-file-panel]");
  const expedienteMenu = qs("[data-expediente-menu]");
  if (empty) empty.classList.toggle("hidden", hasSelection);
  if (panel) panel.classList.toggle("hidden", !hasSelection);
  if (expedienteMenu) expedienteMenu.classList.toggle("hidden", !hasSelection);
  if (!hasSelection) return;
  qsa("[data-admin-client-field]").forEach((input) => {
    input.value = rec.client?.[input.dataset.adminClientField] || "";
  });
  const links = qs("[data-admin-file-links]");
  if (links) {
    const previewAttrs = adminPreviewLinkAttrs();
    links.innerHTML = `
      <div class="notice">
        <strong>Link de autorización:</strong> <a href="${tokenHref("cliente.html", rec.clientToken)}"${previewAttrs}>${tokenHref("cliente.html", rec.clientToken)}</a><br>
        <strong>Link de seguimiento:</strong> <a href="${tokenHref("seguimiento.html", rec.trackingToken)}"${previewAttrs}>${tokenHref("seguimiento.html", rec.trackingToken)}</a>
      </div>`;
  }
  setAdminMasterFrameForReception(rec);
  const vehicle = qs("[data-admin-file-vehicle]");
  if (vehicle) {
    vehicle.innerHTML = `
      <div class="form-grid">
        <div class="field"><label>Técnico</label><select data-admin-edit="employeeName"><option ${String(rec.employeeName || "").toUpperCase() === "EDWIN" ? "selected" : ""}>EDWIN</option><option ${String(rec.employeeName || "").toUpperCase() === "RAFAEL" ? "selected" : ""}>RAFAEL</option><option ${String(rec.employeeName || "").toUpperCase() === "CRISTIAN" ? "selected" : ""}>CRISTIAN</option></select></div>
        <div class="field"><label>Estado</label><select data-admin-edit="status">${statusOptions(rec.status)}</select></div>
        <div class="field"><label>Marca</label><input data-admin-edit="marca" value="${esc(rec.vehicle.marca)}"></div>
        <div class="field"><label>Modelo</label><input data-admin-edit="modelo" value="${esc(rec.vehicle.modelo)}"></div>
        <div class="field"><label>Año</label><select data-admin-edit="anio">${yearOptions(rec.vehicle.anio)}</select></div>
        <div class="field"><label>Color</label><input data-admin-edit="color" value="${esc(rec.vehicle.color)}"></div>
        <div class="field"><label>Placa</label><input data-admin-edit="placa" value="${esc(rec.vehicle.placa)}"></div>
        <div class="field"><label>VIN</label><input data-admin-edit="vin" value="${esc(rec.vehicle.vin)}"></div>
        <div class="field"><label>Kilometraje</label><input data-admin-edit="kilometraje" value="${esc(rec.vehicle.kilometraje)}"></div>
        <div class="field full"><label>Motivo de recepción / falla reportada</label><textarea data-admin-edit="serviceReason">${esc(serviceReason(rec))}</textarea></div>
      </div>`;
  }
  const inventory = qs("[data-admin-file-inventory]");
  if (inventory) {
    inventory.innerHTML = rec.inventory.map((item) => `
      <div class="check-item">
        <input type="checkbox" ${item.present ? "checked" : ""} data-admin-inv-present="${item.id}">
        <div style="width:100%">
          <strong>${esc(item.name)}</strong>
          <input placeholder="Detalle" value="${esc(item.note || "")}" data-admin-inv-note="${item.id}">
        </div>
      </div>`).join("") + fuelGaugeMarkup(rec.internalWork?.fuelLevel, false);
  }
  const photos = qs("[data-admin-file-photos]");
  const expedienteVisibleForMedia = !qs('[data-section="expediente"]')?.classList.contains("hidden");
  const photoTabActive = expedienteVisibleForMedia && adminFileTab === "archivo";
  if (photos && photoTabActive) {
    photos.innerHTML = receptionPhotos(rec).map((photo, index) => `
      <article class="photo-card">
        ${photoVisual(photo)}
        <div class="field">
          <label>${photo.label}</label>
          <input type="file" accept="image/*" capture="environment" data-admin-photo-index="${index}">
          <input placeholder="Nota" value="${esc(photo.note || "")}" data-admin-photo-note="${index}">
        </div>
      </article>`).join("");
  }
  const damages = qs("[data-admin-file-damages]");
  if (damages) {
    damages.innerHTML = `
      <div class="field"><label>Observaciones generales</label><textarea data-admin-edit="observations">${esc(rec.observations || "")}</textarea></div>
      ${rec.damages.map((damage, damageIndex) => `
        <article class="panel">
          <div class="panel-header"><div><h3>Daño encontrado</h3><p>${damage.área || "Área"}</p></div><button class="btn danger" data-action="admin-remove-damage" data-id="${damage.id}">X</button></div>
          <div class="panel-body grid">
            <div class="form-grid">
              <div class="field"><label>Área</label><input value="${esc(damage.área)}" data-admin-damage-área="${damage.id}"></div>
              <div class="field"><label>Detalle</label><input value="${esc(damage.detail)}" data-admin-damage-detail="${damage.id}"></div>
            </div>
            <div class="photo-grid">${(damage.photos || []).map((photo, photoIndex) => `
              <article class="photo-card">
                ${photoVisual(photo)}
                <div class="field"><label>Foto daño</label><input type="file" accept="image/*" capture="environment" data-admin-damage-photo="${damage.id}" data-photo-index="${photoIndex}"></div>
              </article>`).join("")}</div>
            <button class="btn" data-action="admin-add-damage-photo" data-id="${damage.id}">Agregar foto al daño</button>
          </div>
        </article>
      `).join("") || '<div class="notice">No hay daños registrados.</div>'}
      <button class="btn" data-action="admin-add-damage">Agregar daño</button>`;
  }
  const internalHost = qs("[data-admin-internal-rows]");
  if (internalHost) {
    const rows = internalRows(rec);
    internalHost.innerHTML = rows.map((row, index) => `
      <div class="detail-row">
        <span>${index + 1}</span>
        <textarea data-admin-internal-row="${index}">${esc(row)}</textarea>
        <button type="button" class="btn icon-remove" data-action="admin-remove-internal-row" data-index="${index}">X</button>
      </div>`).join("") || '<div class="notice">Sin bitácora interna.</div>';
  }
  const proof = qs("[data-authorization-proof]");
  if (proof) {
    proof.innerHTML = authorizationProofHtml(rec);
  }
  renderAdminAuthorizationView(rec);
}

function renderEmployee() {
  fillReceptionForm();
  renderPhotoEditor();
  renderInventory();
  renderDamageEditor();
  const summary = qs("[data-employee-summary]");
  if (summary) renderReceptionSummary(summary);
  const finalSummary = qs("[data-final-summary]");
  if (finalSummary) showEmployeeStep(wizardOrder.indexOf(qs("[data-section]:not(.hidden)")?.dataset.section || "datos"));
}

function renderAdminInvoices() {
  const host = qs("[data-admin-invoices]");
  if (!host) return;
  const expedienteVisible = !qs('[data-section="expediente"]')?.classList.contains("hidden");
  if (!expedienteVisible || adminFileTab !== "facturas") return;
  const rec = selected();
  if (!rec) {
    host.innerHTML = '<div class="notice">Seleccione un expediente para ver facturas.</div>';
    return;
  }
  const invoices = adminInvoiceList(rec);
  host.innerHTML = invoices.map((item, index) => {
    const label = item.label || `Factura ${index + 1}`;
    const src = item.dataUrl || "";
    return `
      <article class="invoice-card">
        <button type="button" class="photo-box ${src ? "has-image" : ""}" data-action="open-image-preview-direct" data-src="${esc(src)}" data-label="${esc(label)}" style="${src ? `background-image:url('${src}')` : ""}">
          ${src ? "" : "Sin imagen"}
        </button>
        <input type="text" data-admin-invoice-label="${index}" value="${esc(label)}" aria-label="Nombre de factura">
        <button type="button" class="btn danger" data-action="remove-admin-invoice" data-index="${index}">Eliminar factura</button>
      </article>`;
  }).join("") || '<div class="notice">Sin facturas registradas para este vehículo.</div>';
}

function adminInvoiceList(rec) {
  if (!rec) return [];
  if (adminInvoiceDrafts.has(rec.id)) {
    const draft = adminInvoiceDrafts.get(rec.id);
    const poisoned = Array.isArray(draft) && draft.some(item => item?.dataUrl && typeof item.dataUrl === 'object');
    if (!poisoned) return draft;
    adminInvoiceDrafts.delete(rec.id);
  }
  const cloud = globalThis.AM_CLOUD_SYNC?.cachedInvoices?.(rec);
  if (!Array.isArray(cloud) && (rec.invoices || []).some(item => item?.dataUrl && typeof item.dataUrl === 'object')) {
    globalThis.AM_CLOUD_SYNC?.ensureReceptionInvoices?.(rec).catch(() => {});
  }
  const initial = Array.isArray(cloud) ? cloud : (Array.isArray(rec.invoices) ? rec.invoices : []);
  const list = JSON.parse(JSON.stringify(initial || [])).map((item) => ({
    ...item, dataUrl: typeof item?.dataUrl === 'string' ? item.dataUrl : ''
  }));
  adminInvoiceDrafts.set(rec.id, list);
  return list;
}

function captureAdminInvoicesFromDom(rec) {
  const current = adminInvoiceList(rec);
  qsa("[data-admin-invoice-label]").forEach((input) => {
    const index = Number(input.dataset.adminInvoiceLabel);
    if (current[index]) current[index].label = input.value.trim() || `Factura ${index + 1}`;
  });
  return current.map((item, index) => ({
    label: item.label || `Factura ${index + 1}`,
    dataUrl: item.dataUrl || ""
  }));
}

async function persistAdminInvoices(rec, invoices, title = "Guardando factura…", previousOverride = null) {
  if (!rec || !globalThis.AM_CLOUD_SYNC?.saveReceptionNow) throw new Error("El servidor no está disponible para guardar facturas.");
  const previous = previousOverride ? JSON.parse(JSON.stringify(previousOverride)) : JSON.parse(JSON.stringify(adminInvoiceList(rec) || []));
  adminInvoiceDrafts.set(rec.id, JSON.parse(JSON.stringify(invoices || [])));
  AM_SIMPLE_STORE.mutate((current) => {
    const localRec = current.receptions.find((item) => item.id === rec.id || item.number === rec.number);
    if (localRec) localRec.invoices = JSON.parse(JSON.stringify(invoices || []));
  });
  setAdminSaving(true, title, "Sincronizando con el servidor.", 62);
  try {
    const result = await AM_CLOUD_SYNC.saveReceptionNow(rec, "admin-invoice-auto");
    AM_CLOUD_SYNC.cacheInvoices?.(rec, invoices || []);
    setAdminSaving(true, invoices.length ? "Factura guardada" : "Factura eliminada", "Información confirmada.", 100);
    await sleep(700);
    renderAdminInvoices();
    return true;
  } catch (error) {
    adminInvoiceDrafts.set(rec.id, previous);
    AM_SIMPLE_STORE.mutate((current) => {
      const localRec = current.receptions.find((item) => item.id === rec.id || item.number === rec.number);
      if (localRec) localRec.invoices = JSON.parse(JSON.stringify(previous));
    }, { markLocalWrite: false });
    throw error;
  } finally {
    setAdminSaving(false);
  }
}

async function addAdminInvoices(input) {
  const rec = selected();
  const files = Array.from(input?.files || []);
  if (!rec || !files.length) return;
  // Aunque el selector permita más de un archivo por compatibilidad, se guardan uno por uno.
  for (const file of files) {
    setAdminSaving(true, "Guardando factura…", "Preparando imagen.", 30);
    try {
      const dataUrl = await readImageFilePromise(file);
      if (!dataUrl) throw new Error("No se pudo leer la factura seleccionada.");
      const previous = JSON.parse(JSON.stringify(adminInvoiceList(rec) || []));
      const invoices = JSON.parse(JSON.stringify(previous));
      invoices.push({ label: `Factura ${invoices.length + 1}`, dataUrl });
      await persistAdminInvoices(rec, invoices, "Guardando factura…", previous);
    } catch (error) {
      setAdminSaving(false);
      console.error(error);
      toast(error.message || "No se pudo guardar la factura.", "danger");
      break;
    }
  }
}

async function saveAdminInvoices() {
  const rec = selected();
  if (!rec) { toast("Seleccione un expediente para guardar facturas.", "warn"); return; }
  const invoices = captureAdminInvoicesFromDom(rec);
  try { await persistAdminInvoices(rec, invoices, "Guardando factura…"); }
  catch (error) { console.error(error); toast(`No se pudo guardar la factura: ${error.message || error}`, "danger"); }
}

async function removeAdminInvoice(index) {
  const rec = selected();
  if (!rec) return;
  if (!confirm("¿Está seguro de que desea eliminar esta factura?")) return;
  const invoices = JSON.parse(JSON.stringify(adminInvoiceList(rec) || []));
  invoices.splice(index, 1);
  try { await persistAdminInvoices(rec, invoices, "Eliminando factura…"); }
  catch (error) { console.error(error); toast(`No se pudo eliminar la factura: ${error.message || error}`, "danger"); }
}

function renderTrackingAdmin() {
  const rec = selectedAdminReceptionFromHash();
  if (!rec) return;
  const draft = ensureAdminTrackingDraft(rec);
  const trackingLink = qs("[data-admin-tracking-link]");
  if (trackingLink) {
    const href = tokenHref("seguimiento.html", rec.trackingToken);
    trackingLink.dataset.href = href;
    trackingLink.textContent = href;
  }
  qsa("[data-track-field]").forEach((input) => {
    input.value = draft.profile[input.dataset.trackField] || "";
  });
  const finalDeliveryTimeField = qs("[data-final-delivery-time-field]");
  const finalDeliveryTimeInput = qs("[data-final-delivery-time]");
  const draftIsFinalized = String(draft.profile.state || "").toUpperCase() === "FINALIZADO";
  if (finalDeliveryTimeField) finalDeliveryTimeField.classList.toggle("hidden", !draftIsFinalized);
  if (finalDeliveryTimeInput) finalDeliveryTimeInput.value = draft.finalDeliveryTime || "";
  setTime12Group(qs("[data-final-delivery-time12]"), draft.finalDeliveryTime || "");
  const progress = qs("[data-admin-progress]");
  if (progress) {
    progress.value = Number(draft.progress || 0);
    const progressValue = qs("[data-progress-value]");
    if (progressValue) progressValue.textContent = `${Number(draft.progress || 0)}%`;
  }
  const deadlineInput = qs("[data-admin-deadline]");
  const deadlineCanonical = deadlineInputValue(draft.deadline || rec.employeeDeadline || "");
  if (deadlineInput) deadlineInput.value = deadlineCanonical;
  const deadlineDate = qs("[data-admin-deadline-date]");
  if (deadlineDate) deadlineDate.value = deadlineCanonical ? deadlineCanonical.slice(0, 10) : "";
  setTime12Group(qs("[data-admin-deadline-time12]"), deadlineCanonical ? deadlineCanonical.slice(11, 16) : "");
  const deadlineStatus = qs("[data-admin-deadline-status]");
  if (deadlineStatus) {
    const info = deadlineInfo(rec.employeeDeadline, rec.employeeDeadlineSetAt);
    deadlineStatus.value = info.label;
    deadlineStatus.className = `deadline-status ${info.tone}`;
  }
  const detailHost = qs("[data-admin-detail-rows]");
  if (detailHost) {
    const rows = draft.rows || [];
    const images = draft.images || [];
    detailHost.innerHTML = rows.map((row, index) => `
      <div class="admin-detail-row" draggable="true" data-admin-detail-draggable="${index}">
        <div class="admin-detail-order">
          <span title="Arrastre para cambiar el orden">${index + 1}</span>
          <div class="admin-detail-move">
            <button type="button" class="btn" data-action="admin-move-detail-row" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""} title="Subir renglón">↑</button>
            <button type="button" class="btn" data-action="admin-move-detail-row" data-index="${index}" data-direction="1" ${index === rows.length - 1 ? "disabled" : ""} title="Bajar renglón">↓</button>
          </div>
        </div>
        <div class="admin-detail-status">
          <button type="button" class="btn ${row.status === "pending" ? "primary" : ""}" data-action="admin-detail-status" data-index="${index}" data-status="pending" title="En proceso">⏳</button>
          <button type="button" class="btn ${row.status === "done" ? "primary" : ""}" data-action="admin-detail-status" data-index="${index}" data-status="done" title="Finalizado satisfactoriamente">✓</button>
          <button type="button" class="btn ${row.status === "issue" ? "primary" : ""}" data-action="admin-detail-status" data-index="${index}" data-status="issue" title="Problema encontrado">!</button>
        </div>
        <div class="admin-detail-content">
          <textarea data-admin-process-row="${index}" data-detail-status="${row.status}">${esc(row.text)}</textarea>
          <div class="admin-client-request-row">
            <label>Accion para cliente</label>
            <select data-admin-client-request="${index}">
              <option value="" ${!row.clientRequest ? "selected" : ""}>Sin solicitud</option>
              <option value="authorization" ${row.clientRequest === "authorization" ? "selected" : ""}>Solicitar autorizacion</option>
              <option value="call" ${row.clientRequest === "call" ? "selected" : ""}>Confirmar disponibilidad de contacto</option>
            </select>
          </div>
          <div class="photo-grid">${(Array.isArray(images?.[index]) ? images[index] : []).map((media, imgIndex) => renderTrackingMediaThumb(media, `Avance ${index + 1}.${imgIndex + 1}`, `data-action="admin-remove-detail-image" data-row-index="${index}" data-image-index="${imgIndex}"`)).join("")}</div>
          <label class="btn admin-inline-upload">
            Agregar imagen / video
            <input class="hidden" type="file" accept="image/*,video/*" capture="environment" data-admin-detail-image="${index}" multiple>
          </label>
        </div>
        <button type="button" class="btn icon-remove" data-action="admin-remove-detail-row" data-index="${index}">X</button>
      </div>`).join("") || '<div class="notice">Sin renglones publicados.</div>';
  }
  const pendingPanel = qs("[data-pending-tracking-panel]");
  const pendingView = qs("[data-pending-tracking-view]");
  if (pendingPanel) pendingPanel.classList.add("hidden");
  if (pendingView) pendingView.innerHTML = "";
  const updates = qs("[data-admin-updates]");
  if (updates) {
    updates.innerHTML = rec.updates.map((item) => `
      <div class="timeline-item">
        <time>${item.date}</time>
        <div>
          <h4>${item.title}</h4>
          <p>${item.text}</p>
        </div>
      </div>`).join("");
  }
}

function activeEmployee() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const params = new URLSearchParams(raw);
  const id = (params.get("empleado") || "edwin").toLowerCase();
  const employees = state().employees || [];
  return employees.find((employee) => employee.id === id) || employees[0] || { id: "edwin", name: "Edwin" };
}

function setEmployeeLabels(employee) {
  qsa("[data-employee-name]").forEach((node) => { node.textContent = employee.name; });
  qsa("[data-employee-name-inline]").forEach((node) => { node.textContent = employee.name; });
  const tecnico = qs('[name="tecnico"]');
  if (tecnico) tecnico.value = employee.name;
}

function employeeVehicles(employee) {
  return state().receptions.filter((rec) => rec.employeeId === employee.id);
}

function renderEmployeeLists(employee) {
  const vehicles = employeeVehicles(employee);
  const active = vehicles.filter((rec) => rec.status !== "FINALIZADO" && rec.status !== "ENTREGADO");
  const finished = vehicles.filter((rec) => rec.status === "FINALIZADO");
  const metrics = qs("[data-employee-metrics]");
  if (metrics) {
    metrics.innerHTML = `
      <div class="metric"><span>En taller</span><strong>${active.length}</strong><small>Asignados a ${employee.name}</small></div>
      <div class="metric"><span>Finalizados</span><strong>${finished.length}</strong><small>Pendientes de cierre admin</small></div>
      <div class="metric"><span>Empleado</span><strong>${employee.name}</strong><small>Módulo interno</small></div>`;
  }
  const activeList = qs("[data-employee-active-list]");
  if (activeList) {
    activeList.innerHTML = active.map((rec) => `
      <tr>
        <td data-label="Recepción"><strong>${esc(rec.number)}</strong><br><small>${esc(rec.tracking?.receptionDate || "")}</small></td>
        <td data-label="Miniatura">${dashboardThumbnailMarkup(rec)}</td>
        <td data-label="Vehículo">${esc(rec.vehicle.marca)} ${esc(rec.vehicle.modelo)} ${esc(rec.vehicle.anio)}<br><small>${esc(rec.vehicle.placa || "N/D")}</small></td>
        <td data-label="Estado"><span class="pill ${statusTone(rec.status)}">${esc(rec.status)}</span></td>
        <td data-label="Autorización">${rec.signed ? '<span class="pill ok">Autorizado</span>' : '<span class="pill warn">Pendiente</span>'}</td>
        <td data-label="Acción"><button class="btn primary" data-action="open-employee-vehicle" data-id="${rec.id}">Abrir vehículo</button></td>
      </tr>`).join("") || '<tr><td colspan="6">No hay vehículos activos para este empleado.</td></tr>';
  }
  const finishedList = qs("[data-employee-finished-list]");
  if (finishedList) {
    finishedList.innerHTML = finished.map((rec) => `
      <tr>
        <td data-label="Recepción"><strong>${esc(rec.number)}</strong></td>
        <td data-label="Miniatura">${dashboardThumbnailMarkup(rec)}</td>
        <td data-label="Vehículo">${esc(rec.vehicle.marca)} ${esc(rec.vehicle.modelo)} ${esc(rec.vehicle.anio)}</td>
        <td data-label="Estado"><span class="pill ok">${esc(rec.status)}</span></td>
        <td data-label="Acción"><button class="btn" data-action="open-employee-vehicle" data-id="${rec.id}">Ver</button></td>
      </tr>`).join("") || '<tr><td colspan="5">No hay vehículos finalizados.</td></tr>';
  }
}

function setEmployeeWizardStep(step) {
  const formPanel = qs("[data-reception-form]")?.closest(".panel");
  if (formPanel) formPanel.classList.toggle("hidden", step !== "datos");
  qsa("[data-employee-wizard-step]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.employeeWizardStep !== step);
  });
}

function collectReceptionForm() {
  const form = qs("[data-reception-form]");
  const data = new FormData(form);
  return {
    fecha: data.get("fecha") || "",
    hora: data.get("hora") || "",
    tecnico: data.get("tecnico") || activeEmployee().name,
    client: { name: "", phone: "" },
    vehicle: {
      marca: String(data.get("marca") || "").toUpperCase(),
      modelo: String(data.get("modelo") || "").toUpperCase(),
      anio: String(data.get("anio") || "").toUpperCase(),
      color: String(data.get("color") || "").toUpperCase(),
      placa: String(data.get("placa") || "").toUpperCase(),
      vin: String(data.get("vin") || "").toUpperCase(),
      kilometraje: String(data.get("kilometraje") || "").toUpperCase(),
      odometroUnidad: data.get("odometroUnidad") || "mi"
    },
    observations: data.get("observations") || "",
    serviceReason: data.get("serviceReason") || data.get("motivo") || ""
  };
}

function fillReceptionForm() {
  const form = qs("[data-reception-form]");
  if (!form) return;
  const rec = selected();
  const employee = activeEmployee();
  const now = new Date();
  const values = {
    fecha: rec?.tracking?.receptionDate ? "" : now.toISOString().slice(0, 10),
    hora: now.toTimeString().slice(0, 5),
    tecnico: employee.name,
    marca: rec?.vehicle?.marca || "",
    modelo: rec?.vehicle?.modelo || "",
    anio: rec?.vehicle?.anio || "",
    color: rec?.vehicle?.color || "",
    placa: rec?.vehicle?.placa || "",
    vin: rec?.vehicle?.vin || "",
    kilometraje: rec?.vehicle?.kilometraje || "",
    odometroUnidad: rec?.vehicle?.odometroUnidad || "mi",
    observations: rec?.observations || "",
    serviceReason: serviceReason(rec)
  };
  Object.entries(values).forEach(([key, value]) => {
    const input = qs(`[name="${key}"]`, form);
    if (input) input.value = value || "";
  });
}

function createReception() {
  const employee = activeEmployee();
  AM_SIMPLE_STORE.mutate((current) => {
    const next = AM_SIMPLE_STORE.next(current, "reception");
    const id = `rec-${next}`;
    const clientToken = "cli_" + AM_SIMPLE_STORE.cryptoToken();
    const trackingToken = "trk_" + AM_SIMPLE_STORE.cryptoToken();
    const photos = AM_SIMPLE_STORE.requiredPhotos.map((label, index) => ({ label, dataUrl: "", note: "", color: index % 2 === 0 ? "#206f78" : "#b52931" }));
    current.receptions.unshift({
      id,
      number: `AM-R-${String(next).padStart(4, "0")}`,
      status: "BORRADOR",
      sentToClient: false,
      signed: false,
      signatureName: "",
      signatureDate: "",
      clientToken,
      trackingToken,
      employeeId: employee.id,
      employeeName: employee.name,
      client: { name: "", phone: "" },
      vehicle: { marca: "", modelo: "", anio: "", color: "", placa: "", vin: "", kilometraje: "", odometroUnidad: "mi" },
      photos,
      inventory: AM_SIMPLE_STORE.baseInventory.map((name, index) => ({ id: `inv-${id}-${index + 1}`, name, present: true, note: "" })),
      observations: "",
      damages: [],
      progress: 0,
      progressLabel: "EN REVISIÓN",
      tracking: {
        receptionDate: "",
        deliveryEstimate: "",
        odometer: "",
        plate: "",
        vehicleTitle: "",
        state: "EN REVISIÓN",
        processDetails: ""
      },
      internalWork: { internalNote: "", lockedReception: false },
      updates: []
    });
    current.selectedId = id;
  });
  fillReceptionForm();
  renderPhotoEditor();
  renderInventory();
  renderDamageEditor();
  setEmployeeWizardStep("datos");
  showSection("nuevo");
  toast("Nuevo vehículo listo para registrar.");
}

function saveReception() {
  const collected = collectReceptionForm();
  const employee = activeEmployee();
  saveInventoryFromDom();
  AM_SIMPLE_STORE.mutate((current) => {
    let rec = AM_SIMPLE_STORE.selected(current);
    if (!rec || rec.employeeId !== employee.id) {
      const next = AM_SIMPLE_STORE.next(current, "reception");
      const id = `rec-${next}`;
      rec = {
        id,
        number: `AM-R-${String(next).padStart(4, "0")}`,
        photos: AM_SIMPLE_STORE.requiredPhotos.map((label, index) => ({ label, dataUrl: "", note: "", color: index % 2 === 0 ? "#206f78" : "#b52931" })),
        inventory: AM_SIMPLE_STORE.baseInventory.map((name, index) => ({ id: `inv-${id}-${index + 1}`, name, present: true, note: "" })),
        damages: [],
        updates: []
      };
      current.receptions.unshift(rec);
      current.selectedId = id;
    }
    rec.client = { name: "", phone: "" };
    rec.vehicle = collected.vehicle;
    rec.employeeId = employee.id;
    rec.employeeName = employee.name;
    rec.serviceReason = collected.serviceReason || rec.serviceReason || "";
    rec.observations = collected.observations;
    rec.status = "EN REVISIÓN";
    rec.progressLabel = "EN REVISIÓN";
    rec.internalWork = { ...(rec.internalWork || {}), lockedReception: true };
    rec.tracking = {
      ...(rec.tracking || {}),
      receptionDate: `${collected.fecha || new Date().toLocaleDateString("es-SV")}, ${collected.hora || new Date().toLocaleTimeString("es-SV")}`,
      odometer: `${Number(collected.vehicle.kilometraje || 0).toLocaleString("en-US")} ${collected.vehicle.odometroUnidad === "km" ? "KILÓMETROS" : "MILLAS"}`,
      plate: collected.vehicle.placa || "N/D",
      vehicleTitle: `${collected.vehicle.marca} ${collected.vehicle.modelo} ${collected.vehicle.anio}`.trim(),
      state: "EN REVISIÓN",
      processDetails: collected.observations || collected.serviceReason || "Recepción registrada"
    };
  });
  renderEmployee();
  showSection("asignados");
  toast("Registro guardado y agregado a vehículos asignados.");
}

function renderEmployeeVehicle() {
  const current = state();
  const rec = current.receptions.find((item) => item.id === current.selectedId);
  const empty = qs("[data-employee-vehicle-empty]");
  const panel = qs("[data-employee-vehicle-panel]");
  if (empty) empty.classList.toggle("hidden", !!rec);
  if (panel) panel.classList.toggle("hidden", !rec);
  if (!rec) return;
  const summary = qs("[data-employee-vehicle-summary]");
  if (summary) {
    summary.innerHTML = `
      <div class="grid cols-4">
        <div class="metric"><span>Recepción</span><strong>${esc(rec.number)}</strong><small>${esc(rec.status)}</small></div>
        <div class="metric"><span>Vehículo</span><strong>${esc(rec.vehicle.marca)} ${esc(rec.vehicle.modelo)}</strong><small>${esc(rec.vehicle.anio)} - ${esc(rec.vehicle.color)}</small></div>
        <div class="metric"><span>Placa</span><strong>${esc(rec.vehicle.placa || "N/D")}</strong><small>VIN: ${esc(rec.vehicle.vin || "N/D")}</small></div>
        <div class="metric"><span>Autorización</span><strong>${rec.signed ? "Sí" : "No"}</strong><small>${rec.signed ? "Cliente autorizo" : "Pendiente"}</small></div>
      </div>`;
  }
  const statusInput = qs('[data-employee-work="status"]');
  if (statusInput) statusInput.value = rec.status || "EN REVISIÓN";
  const progressInput = qs('[data-employee-work="progress"]');
  if (progressInput) progressInput.value = rec.progress || 0;
  const detailInput = qs('[data-employee-work="processDetails"]');
  if (detailInput) detailInput.value = rec.tracking?.processDetails || "";
  const noteInput = qs('[data-employee-work="internalNote"]');
  if (noteInput) noteInput.value = rec.internalWork?.internalNote || "";
}

function renderEmployee() {
  const employee = activeEmployee();
  setEmployeeLabels(employee);
  renderEmployeeLists(employee);
  fillReceptionForm();
  renderPhotoEditor();
  renderInventory();
  renderDamageEditor();
  renderEmployeeVehicle();
}

let carouselIndex = 0;

function publicCloudLoadingNote(message) {
  const selector = document.body.dataset.page === "tracking"
    ? "[data-tracking-loading-note]"
    : "[data-client-loading-note]";
  const note = qs(selector);
  if (note) note.textContent = message;
}

function waitForPublicCloudRetry(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function loadPublicCloudReliably() {
  globalThis.__AM_PUBLIC_LINK_UNAVAILABLE__ = false;
  if (!globalThis.AM_CLOUD_SYNC?.loadPublicSnapshot) return null;
  const page = document.body.dataset.page;
  const type = page === "client" ? "client" : page === "tracking" ? "tracking" : "";
  if (!type) return null;
  const search = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
  const token = search.get("token") || hash.get("token") || "";
  if (!token) return null;
  const attempts = [0, 1200, 3000];
  for (let index = 0; index < attempts.length; index += 1) {
    if (attempts[index]) await waitForPublicCloudRetry(attempts[index]);
    if (index === 0) publicCloudLoadingNote("Estamos preparando la información y las fotografías de tu vehículo.");
    try {
      const snapshot = await AM_CLOUD_SYNC.loadPublicSnapshot(type, token);
      if (snapshot) return snapshot;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/enlace no valido|enlace no válido|token requerido|token no valido|token no válido|recepci[oó]n no encontrada/i.test(message)) {
        globalThis.__AM_PUBLIC_LINK_UNAVAILABLE__ = true;
        return null;
      }
      console.warn(`No se pudo cargar la vista pública (intento ${index + 1})`, error);
    }
  }
  return null;
}

function publicBrowserEvidence() {
  return {
    userAgent: navigator.userAgent || "",
    platform: navigator.platform || "",
    language: navigator.language || "",
    languages: Array.isArray(navigator.languages) ? navigator.languages.join(", ") : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screen: `${screen.width}x${screen.height}`,
    viewport: `${innerWidth}x${innerHeight}`
  };
}

function renderPublicCloudFailure(page) {
  if (page === "tracking" && globalThis.__AM_PUBLIC_LINK_UNAVAILABLE__) return renderInactiveTrackingLink();
  const host = page === "tracking" ? qs("[data-tracking-view]") : qs("[data-client-summary]");
  if (!host) return;
  host.innerHTML = `
    <div class="notice danger public-cloud-failure">
      <strong>No pudimos completar la carga.</strong><br>
      La informaci\u00f3n sigue protegida. Revisa tu conexi\u00f3n y vuelve a intentarlo.
      <div style="margin-top:14px"><button class="btn primary" type="button" onclick="location.reload()">Reintentar</button></div>
    </div>`;
}

function renderClient() {
  const rawClientHash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const clientParamsForRedirect = new URLSearchParams(location.search);
  const clientHashParamsForRedirect = new URLSearchParams(rawClientHash);
  clientHashParamsForRedirect.forEach((value, name) => {
    if (!clientParamsForRedirect.has(name)) clientParamsForRedirect.set(name, value);
  });
  const consumedHref = consumedClientTrackingHref(clientParamsForRedirect.get("token"));
  if (consumedHref) {
    location.replace(consumedHref);
    return;
  }
  const rec = findReceptionByParam("clientToken");
  if (!rec) return renderMissingToken();
  if (rec.signed || rec.photoAcknowledged) {
    markConsumedClientLink(rec.clientToken, rec.trackingToken);
    location.replace(tokenHref("seguimiento.html", rec.trackingToken));
    return;
  }
  const clientParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : "");
  const photoReviewMode = (clientParams.get("modo") || hashParams.get("modo") || "") === "fotos";
  const flow = qs("[data-authorization-flow]");
  const authorizedOnly = qs("[data-authorized-only]");
  const processingOnly = qs("[data-processing-only]");
  const hasAuthorization = !!rec.signed;
  const showTermsPanel = !photoReviewMode && !hasAuthorization;
  const showPhotoAckPanel = photoReviewMode || hasAuthorization;
  if (processingOnly) processingOnly.classList.add("hidden");
  if (flow) flow.classList.remove("hidden");
  if (authorizedOnly) authorizedOnly.classList.add("hidden");
  const summary = qs("[data-client-summary]");
  if (summary) {
    renderReceptionSummary(summary, rec);
    summary.insertAdjacentHTML("beforeend", `
      <article class="panel">
        <div class="panel-header"><h3>Motivo de recepción</h3></div>
        <div class="panel-body">
          <div class="notice"><strong>Motivo por el cual recibimos el vehículo:</strong><br>${esc(serviceReason(rec) || "Sin motivo registrado.")}</div>
        </div>
      </article>`);
  }
  renderClientInventory(rec);
  renderClientDamages(rec);
  const observations = qs("[data-client-observations]");
  if (observations) observations.innerHTML = `<strong>Observaciones generales:</strong><br>${esc(rec.observations || "Sin observaciones registradas.")}`;
  const authorizeButton = qs("[data-action='authorize-client']");
  if (authorizeButton) authorizeButton.classList.toggle("hidden", hasAuthorization || photoReviewMode);
  const termsPanel = qs("[data-client-terms-panel]");
  if (termsPanel) termsPanel.classList.toggle("hidden", !showTermsPanel);
  const termsBox = qs("[data-client-terms-box]");
  if (termsBox) termsBox.innerHTML = authorizationTermsHtml();
  const photoAckPanel = qs("[data-photo-ack-panel]");
  if (photoAckPanel) photoAckPanel.classList.toggle("hidden", !showPhotoAckPanel);
  const photoAckStatus = qs("[data-photo-ack-status]");
  const photoAckTitle = qs("[data-photo-ack-title]");
  const photoAckPrimary = qs("[data-photo-ack-primary]");
  const photoAckSecondary = qs("[data-photo-ack-secondary]");
  if (photoAckStatus) photoAckStatus.classList.toggle("hidden", !hasAuthorization);
  if (photoAckTitle) photoAckTitle.textContent = "Autorización registrada";
  if (photoAckPrimary) {
    photoAckPrimary.classList.toggle("hidden", !hasAuthorization);
    photoAckPrimary.textContent = hasAuthorization ? "La autorización del vehículo ya fue firmada de manera presencial en el taller." : "";
  }
  if (photoAckSecondary) {
    photoAckSecondary.classList.add("hidden");
    photoAckSecondary.textContent = "";
  }
  const photoAckSignature = qs("[data-photo-ack-signature]");
  if (photoAckSignature) photoAckSignature.innerHTML = renderReadonlyClientSignature(rec);
  const termsCheck = qs("[data-terms-check]");
  if (termsCheck) {
    termsCheck.checked = rec.signed;
    if (authorizeButton) authorizeButton.disabled = !termsCheck.checked;
  }
  const trackingLink = qs("[data-tracking-link]");
  if (trackingLink) trackingLink.href = tokenHref("seguimiento.html", rec.trackingToken);
}

function renderReadonlyClientSignature(rec) {
  const evidence = rec?.authorizationEvidence || {};
  const signature = rec?.signatureDataUrl || evidence.signatureDataUrl || "";
  const name = rec?.signatureName || evidence.signatureName || rec?.client?.name || "Cliente";
  const date = rec?.signatureDate || evidence.signatureDate || rec?.termsAcceptedAt || "";
  if (!signature) {
    return '<div class="notice">Firma registrada presencialmente en el taller.</div>';
  }
  return `
    <div class="signature-preview client-signature-readonly">
      <strong>Firma registrada presencialmente:</strong>
      <img src="${esc(signature)}" alt="Firma del cliente">
      <small>${esc(name)}${date ? ` · ${esc(date)}` : ""}</small>
    </div>`;
}

function renderClientCarousel(rec) {
  const host = qs("[data-carousel]");
  if (!host) return;
  const photos = receptionPhotos(rec).filter((photo) => AM_SIMPLE_STORE.carouselPhotos.includes(photo.label));
  if (!photos.length) {
    host.innerHTML = '<div class="notice">No hay fotografias de recepcion disponibles.</div>';
    return;
  }
  if (carouselIndex >= photos.length) carouselIndex = 0;
  const photo = photos[carouselIndex] || photos[0];
  const dots = photos.map((_, index) => `<span class="${index === carouselIndex ? "active" : ""}"></span>`).join("");
  host.innerHTML = `
    <div class="client-photo-viewer" data-client-carousel>
      <button class="client-photo-main" type="button" data-action="open-image-preview-direct" data-src="${esc(photo.dataUrl || "")}" data-label="${esc(photo.label || "Foto")}">
        ${photo.dataUrl ? `<img src="${esc(photo.dataUrl)}" alt="${esc(photo.label || "Foto")}" decoding="async">` : `<span>${esc(photo.label || "Foto pendiente")}</span>`}
      </button>
      <button class="client-photo-arrow prev" type="button" data-action="prev-photo" aria-label="Foto anterior">&#8249;</button>
      <button class="client-photo-arrow next" type="button" data-action="next-photo" aria-label="Foto siguiente">&#8250;</button>
      <div class="client-photo-dots" aria-hidden="true">${dots}</div>
    </div>
    <div class="carousel-caption">${carouselIndex + 1} de ${photos.length}: ${photo.label}</div>
    <div class="client-swipe-hint">Deslice la imagen o toque para ampliar.</div>`;
}

function moveClientCarousel(direction) {
  const rec = findReceptionByParam("clientToken");
  if (!rec) return;
  const total = receptionPhotos(rec).filter((photo) => AM_SIMPLE_STORE.carouselPhotos.includes(photo.label)).length;
  if (!total) return;
  carouselIndex = direction > 0 ? (carouselIndex + 1) % total : (carouselIndex - 1 + total) % total;
  renderClientCarousel(rec);
}

let clientCarouselTouch = null;
document.addEventListener("touchstart", (event) => {
  const target = event.target.closest("[data-client-carousel]");
  if (!target || !event.changedTouches.length) return;
  const touch = event.changedTouches[0];
  clientCarouselTouch = { x: touch.clientX, y: touch.clientY };
}, { passive: true });

document.addEventListener("touchend", (event) => {
  if (!clientCarouselTouch || !event.changedTouches.length) return;
  const target = event.target.closest("[data-client-carousel]");
  const touch = event.changedTouches[0];
  const dx = touch.clientX - clientCarouselTouch.x;
  const dy = touch.clientY - clientCarouselTouch.y;
  clientCarouselTouch = null;
  if (!target || Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
  moveClientCarousel(dx < 0 ? 1 : -1);
}, { passive: true });

function renderClientInventory(rec) {
  const host = qs("[data-client-inventory]");
  if (!host) return;
  host.innerHTML = rec.inventory.map((item) => `
    <div class="check-item">
      <span class="pill ${item.present ? "ok" : "danger"}">${item.present ? "Presente" : "Falta"}</span>
      <div><strong>${item.name}</strong><br><small>${item.note || "Sin detalle"}</small></div>
    </div>`).join("");
}

function renderClientDamages(rec) {
  const host = qs("[data-client-damages]");
  if (!host) return;
  host.innerHTML = rec.damages.map((damage) => `
    <article class="panel">
      <div class="panel-header"><div><h3>${esc(damage.área || damage.area || "Daño")}</h3><p>${esc(damage.detail || "Sin descripción.")}</p></div></div>
    </article>`).join("") || '<div class="notice">No se registraron daños adicionales.</div>';
}

function renderTrackingClientRequest(rec, row, index) {
  const request = (Array.isArray(rec.trackingRequests) ? rec.trackingRequests[index] : null) || {};
  const type = normalizeClientRequestType(row.clientRequest || request.type || "");
  if (!type) return "";
  const config = CLIENT_REQUEST_TYPES[type];
  const localConfirmation = readClientRequestConfirmation(rec, index, type, row);
  const confirmedAt = request.confirmedAt || localConfirmation?.confirmedAt || "";
  if (confirmedAt) return "";
  const message = type === "call"
    ? "El taller necesita contactarle sobre este avance. Si esta disponible para ser contactado, por favor confirme aqui."
    : "El taller solicita su autorizacion para continuar con este avance.";
  if (type === "call") {
    return `
      <div class="tracking-client-request whatsapp-request">
        <span>${esc(message)}</span>
        <button type="button" class="tracking-client-request-btn whatsapp-confirm-btn" data-action="confirm-tracking-request" data-row="${index}" data-request-type="${esc(type)}"><span class="whatsapp-btn-icon">${whatsappLogoSvg()}</span>${esc(config.button)}</button>
      </div>`;
  }
  return `
    <div class="tracking-client-request authorization-request">
      <strong>${esc(config.label)}</strong>
      <span>${esc(message)}</span>
      <button type="button" class="tracking-client-request-btn" data-action="confirm-tracking-request" data-row="${index}" data-request-type="${esc(type)}">${esc(config.button)}</button>
    </div>`;
}

function renderTracking() {
  const rec = findReceptionByParam("trackingToken");
  if (!rec) return renderMissingToken();
  if (rec.deletedAt || rec.archivedAt || String(rec.status || "").toUpperCase() === "ENTREGADO") {
    return renderInactiveTrackingLink();
  }
  const profile = trackingProfile(rec);
  const photos = receptionPhotos(rec);
  const publicProgress = pendingTracking(rec) ? (rec.publishedProgress ?? 0) : (rec.publishedProgress ?? rec.progress ?? profile.progress ?? 0);
  const progress = Math.max(0, Math.min(100, Number(publicProgress) || 0));
  AM_SIMPLE_STORE.mutate((current) => {
    const item = current.receptions.find((candidate) => candidate.id === rec.id);
    if (item && !item.tracking) item.tracking = profile;
  });
  const host = qs("[data-tracking-view]");
  if (!host) return;
  const frontPhoto = photos.find((photo) => /frente/i.test(photo.label || "")) || photos[0];
  const cardPhoto = photos.find((photo) => /reverso.*tarjeta|tarjeta.*reverso/i.test(photo.label || ""))
    || photos.find((photo) => /frente.*tarjeta|tarjeta.*frente/i.test(photo.label || ""));
  const isFinalized = String(profile.state || "").toUpperCase() === "FINALIZADO";
  const delivery = finalDeliverySchedule(rec, profile);
  const deliveryDateText = formatFinalDeliveryDate(delivery.date);
  const deliveryTimeText = formatFinalDeliveryTime(delivery.time);
  const hasDeliverySchedule = Boolean(deliveryDateText && deliveryTimeText);
  host.innerHTML = `
    <div class="tracking-brief-notice">
      <strong>Seguimiento en actualización</strong>
      <span>Los datos del vehículo se actualizan conforme el técnico registra avances. Algunas fotografías o detalles pueden reflejarse dentro de 24 a 48 horas.</span>
    </div>
    <div class="tracking-label">RECEPCION:</div>
    <div class="tracking-date">${profile.receptionDate}</div>

    <div class="tracking-vehicle-row">
      <div class="tracking-vehicle-photo">${photoVisual(frontPhoto)}</div>
      <div class="tracking-vehicle-info">
        <div class="tracking-purple">ESTIMACION DE ENTREGA:</div>
        <h2>${profile.vehicleTitle}</h2>
        <p>ODOMETRO: ${profile.odometer}</p>
        <p>PLACA:${profile.plate}</p>
      </div>
    </div>

    <div class="tracking-label">TARJETA DE CIRCULACION</div>
    <div class="tracking-card-photo">${photoVisual(cardPhoto)}</div>

    ${isFinalized ? `
      <section class="tracking-finalized">
        <div class="tracking-final-icon">✓</div>
        <div>
          <span>Proceso finalizado</span>
          <h3>El diagnóstico o reparación de tu vehículo ha sido culminado exitosamente.</h3>
          ${hasDeliverySchedule ? `<p class="tracking-final-delivery">Tu vehículo estará disponible para entrega a partir del <strong>${esc(deliveryDateText)}</strong> a las <strong>${esc(deliveryTimeText)}</strong>.</p>` : ""}
          <p>Automotriz Medina agradece tu confianza. Si tienes alguna consulta o necesitas coordinar otro horario, puedes comunicarte con el taller.</p>
          ${hasDeliverySchedule ? `<a class="tracking-final-whatsapp" href="${finalDeliveryWhatsappUrl(rec, deliveryDateText, deliveryTimeText)}" target="_blank" rel="noopener noreferrer"><span class="whatsapp-btn-icon">${whatsappLogoSvg()}</span>WhatsApp</a>` : ""}
        </div>
      </section>
    ` : `
      <div class="tracking-progress-head">
        <span>AVANCE %</span>
        <strong>${progress}</strong>
      </div>
      <div class="tracking-progress"><div style="width:${progress}%"></div></div>

      <div class="tracking-section">
        <div class="tracking-label">ESTADO DEL VEHICULO:</div>
        <strong>${profile.state}</strong>
      </div>

      <div class="tracking-section">
        <h3>Detalles del proceso Actual:</h3>
        <div class="timeline">
          ${processRowItems(rec).map((row, index) => `
            <div class="timeline-item">
              <time class="${normalizeProcessStatus(row.status)}">${processStatusIcon(row.status)}</time>
              <div>
                <p>${esc(row.text)}</p>
                ${renderTrackingClientRequest(rec, row, index)}
                <div class="photo-grid">${(Array.isArray(rec.trackingImages?.[index]) ? rec.trackingImages[index] : []).map((media, imgIndex) => renderTrackingMediaThumb(media, `Avance ${index + 1}.${imgIndex + 1}`)).join("")}</div>
              </div>
            </div>`).join("") || "<p>Sin avances publicados.</p>"}
        </div>
      </div>
    `}

  `;
}

function findReceptionByParam(key) {
  const rawHash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const params = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(rawHash);
  hashParams.forEach((value, name) => {
    if (!params.has(name)) params.set(name, value);
  });
  const token = params.get("token");
  const publicRec = globalThis.__AM_PUBLIC_RECEPTION__;
  if (token && publicRec && (publicRec[key] === token || (key === "clientToken" && publicRec.clientToken === token) || (key === "trackingToken" && publicRec.trackingToken === token))) return publicRec;
  const directV4 = token ? globalThis.AM_V4_DATA?.findReceptionByToken?.(token, key) : null;
  if (directV4) return directV4;
  const current = state();
  if (!token && (key === "clientToken" || key === "trackingToken")) return null;
  if (!token) return AM_SIMPLE_STORE.selected(current);
  const found = current.receptions.find((rec) => rec[key] === token);
  if (found) return found;
  if (key === "clientToken") {
    const consumed = current.receptions.find((rec) => rec.photoAcknowledged && rec.photoAcknowledgementEvidence?.token === token);
    if (consumed) return consumed;
  }
  return null;
}

function renderMissingToken() {
  if (document.body.dataset.page === "tracking") return renderInactiveTrackingLink();
  document.body.innerHTML = '<main class="public-main"><div class="notice danger">Token no válido o recepción no encontrada.</div></main>';
}

function renderInactiveTrackingLink() {
  document.body.innerHTML = `
    <main class="public-main">
      <article class="panel" style="max-width:640px;margin:34px auto">
        <div class="panel-header"><div><h3>Seguimiento no disponible</h3><p>Automotriz Medina</p></div></div>
        <div class="panel-body grid">
          <div class="notice warn">
            El identificador de este vehículo ya no se encuentra disponible.
          </div>
          <p class="muted-note">Si necesita información adicional, comuníquese directamente con el taller.</p>
        </div>
      </article>
    </main>`;
}

function saveReception() {
  const collected = collectReceptionForm();
  AM_SIMPLE_STORE.mutate((current) => {
    const rec = AM_SIMPLE_STORE.selected(current);
    rec.client = collected.client;
    rec.vehicle = collected.vehicle;
    rec.serviceReason = collected.serviceReason || rec.serviceReason || "";
    rec.observations = collected.observations;
    rec.status = "Revisión lista";
    rec.sentToClient = false;
  });
  renderEmployee();
  toast("Registro completo guardado. El administrador ya puede revisarlo.");
}

function saveReceptionDraft() {
  const collected = collectReceptionForm();
  AM_SIMPLE_STORE.mutate((current) => {
    const rec = AM_SIMPLE_STORE.selected(current);
    rec.client = collected.client;
    rec.vehicle = collected.vehicle;
    rec.serviceReason = collected.serviceReason || rec.serviceReason || "";
    rec.observations = collected.observations;
    if (rec.status === "Nueva recepción") rec.status = "Borrador empleado";
  });
  fillReceptionForm();
}

function saveInventoryFromDom() {
  AM_SIMPLE_STORE.mutate((current) => {
    const rec = AM_SIMPLE_STORE.selected(current);
    rec.inventory.forEach((item) => {
      const present = qs(`[data-inventory-present="${item.id}"]`);
      const note = qs(`[data-inventory-note="${item.id}"]`);
      item.present = !!present?.checked;
      item.note = note?.value || "";
    });
    const fuelInput = qs('[data-fuel-level]');
    rec.internalWork = { ...(rec.internalWork || {}), lockedReception: rec.internalWork?.lockedReception !== false };
    const fuelGauge = fuelInput?.closest?.('[data-fuel-gauge]');
    if (fuelInput && fuelGauge && !fuelGauge.classList.contains('is-unset')) {
      rec.internalWork.fuelLevel = normalizeFuelLevel(fuelInput.value);
    }
  });
}

function createReception() {
  AM_SIMPLE_STORE.mutate((current) => {
    const next = AM_SIMPLE_STORE.next(current, "reception");
    const id = `rec-${next}`;
    const base = AM_SIMPLE_STORE.selected(current);
    const tokens = makePrivateTokens();
    current.receptions.unshift({
      ...JSON.parse(JSON.stringify(base)),
      id,
      number: `AM-R-${String(next).padStart(4, "0")}`,
      status: "Nueva recepción",
      sentToClient: false,
      signed: false,
      signatureName: "",
      signatureDate: "",
      clientToken: tokens.clientToken,
      trackingToken: tokens.trackingToken,
      client: { name: "Nuevo cliente", phone: "" },
      vehicle: { marca: "", modelo: "", anio: "", color: "", placa: "", vin: "", kilometraje: "" },
      observations: "",
      damages: [],
      updates: []
    });
    current.selectedId = id;
  });
  renderEmployee();
  toast("Nueva recepción creada.");
}

function createReception() {
  const employee = activeEmployee();
  AM_SIMPLE_STORE.mutate((current) => {
    const next = AM_SIMPLE_STORE.next(current, "reception");
    const id = `rec-${next}`;
    const clientToken = "cli_" + AM_SIMPLE_STORE.cryptoToken();
    const trackingToken = "trk_" + AM_SIMPLE_STORE.cryptoToken();
    const photos = AM_SIMPLE_STORE.requiredPhotos.map((label, index) => ({ label, dataUrl: "", note: "", color: index % 2 === 0 ? "#206f78" : "#b52931" }));
    current.receptions.unshift({
      id,
      number: `AM-R-${String(next).padStart(4, "0")}`,
      status: "BORRADOR",
      sentToClient: false,
      signed: false,
      signatureName: "",
      signatureDate: "",
      clientToken,
      trackingToken,
      employeeId: employee.id,
      employeeName: employee.name,
      client: { name: "", phone: "" },
      vehicle: { marca: "", modelo: "", anio: "", color: "", placa: "", vin: "", kilometraje: "", odometroUnidad: "mi" },
      photos,
      inventory: AM_SIMPLE_STORE.baseInventory.map((name, index) => ({ id: `inv-${id}-${index + 1}`, name, present: true, note: "" })),
      observations: "",
      damages: [],
      progress: 0,
      progressLabel: "EN REVISIÓN",
      tracking: {
        receptionDate: "",
        deliveryEstimate: "",
        odometer: "",
        plate: "",
        vehicleTitle: "",
        state: "EN REVISIÓN",
        processDetails: ""
      },
      internalWork: { internalNote: "", lockedReception: false },
      updates: []
    });
    current.selectedId = id;
  });
  fillReceptionForm();
  renderPhotoEditor();
  renderInventory();
  renderDamageEditor();
  setEmployeeWizardStep("datos");
  showSection("nuevo");
  toast("Nuevo vehículo listo para registrar.");
}

function saveReception() {
  const collected = collectReceptionForm();
  const employee = activeEmployee();
  saveInventoryFromDom();
  AM_SIMPLE_STORE.mutate((current) => {
    const rec = AM_SIMPLE_STORE.selected(current);
    if (!rec) return;
    rec.client = { name: "", phone: "" };
    rec.vehicle = collected.vehicle;
    rec.employeeId = employee.id;
    rec.employeeName = employee.name;
    rec.serviceReason = collected.serviceReason || rec.serviceReason || "";
    rec.observations = collected.observations;
    rec.status = "EN REVISIÓN";
    rec.progressLabel = "EN REVISIÓN";
    rec.internalWork = { ...(rec.internalWork || {}), lockedReception: true };
    rec.tracking = {
      ...(rec.tracking || {}),
      receptionDate: `${collected.fecha || new Date().toLocaleDateString("es-SV")}, ${collected.hora || new Date().toLocaleTimeString("es-SV")}`,
      odometer: `${Number(collected.vehicle.kilometraje || 0).toLocaleString("en-US")} ${collected.vehicle.odometroUnidad === "km" ? "KILÓMETROS" : "MILLAS"}`,
      plate: collected.vehicle.placa || "N/D",
      vehicleTitle: `${collected.vehicle.marca} ${collected.vehicle.modelo} ${collected.vehicle.anio}`.trim(),
      state: "EN REVISIÓN",
      processDetails: collected.observations || collected.serviceReason || "Recepción registrada"
    };
  });
  renderEmployee();
  showSection("asignados");
  toast("Registro guardado y agregado a vehículos asignados.");
}

function handleActions() {
  document.addEventListener("change", (event) => {
    const selected = event.target.closest?.("[data-trash-select-id]");
    if (selected) {
      event.stopPropagation();
      if (selected.checked) trashSelectedIds.add(selected.dataset.trashSelectId);
      else trashSelectedIds.delete(selected.dataset.trashSelectId);
      renderReceptionTable();
      return;
    }
    if (event.target.matches?.("[data-trash-select-all]")) {
      event.stopPropagation();
      const visibleTrash = applyAdminSearchFilters(state().receptions.filter(isDeleted)).filter(matchesDashboardQuickSearch);
      trashSelectedIds = event.target.checked ? new Set(visibleTrash.map((rec) => rec.id)) : new Set();
      renderReceptionTable();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && hasOpenActionMenu()) {
      closeActionMenus();
      return;
    }
    const row = event.target.closest?.("[data-open-file-row]");
    if (!row || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openAdminReceptionFile(row.dataset.openFileRow);
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("[data-action]");
    if (!button) return;
    await handleAdminTrackingAction(button.dataset.action || "", button, event);
  }, true);
  document.addEventListener("change", async (event) => {
    const input = event.target;
    await handleAdminTrackingImageChange(input, event);
  }, true);
  document.addEventListener("dragstart", (event) => {
    const row = event.target.closest?.("[data-admin-detail-draggable]");
    if (!row) return;
    window.__amAdminTrackingDragIndex = Number(row.dataset.adminDetailDraggable);
    row.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(window.__amAdminTrackingDragIndex));
  });
  document.addEventListener("dragover", (event) => {
    const row = event.target.closest?.("[data-admin-detail-draggable]");
    if (!row || !Number.isFinite(window.__amAdminTrackingDragIndex)) return;
    event.preventDefault();
    row.classList.add("drag-over");
  });
  document.addEventListener("dragleave", (event) => {
    event.target.closest?.("[data-admin-detail-draggable]")?.classList.remove("drag-over");
  });
  document.addEventListener("drop", (event) => {
    const row = event.target.closest?.("[data-admin-detail-draggable]");
    if (!row || !Number.isFinite(window.__amAdminTrackingDragIndex)) return;
    event.preventDefault();
    const rec = selectedAdminReceptionFromHash();
    const to = Number(row.dataset.adminDetailDraggable);
    reorderAdminTrackingDraft(rec, window.__amAdminTrackingDragIndex, to);
    qsa("[data-admin-detail-draggable]").forEach((item) => item.classList.remove("dragging", "drag-over"));
    window.__amAdminTrackingDragIndex = null;
  });
  document.addEventListener("dragend", () => {
    qsa("[data-admin-detail-draggable]").forEach((item) => item.classList.remove("dragging", "drag-over"));
    window.__amAdminTrackingDragIndex = null;
  });
  document.addEventListener("click", async (event) => {
    const clickedMenu = event.target.closest?.(".action-menu");
    if (!clickedMenu) closeActionMenus();
    if (event.target.matches?.("[data-image-modal]")) {
      closeImagePreview();
      return;
    }
    const tabButton = event.target.closest("[data-admin-file-tab]");
    if (tabButton) {
      showSection("expediente");
      showAdminFileTab(tabButton.dataset.adminFileTab);
      const rec = selected();
      if (rec?.id) pushAdminHash(`expediente=${encodeURIComponent(rec.id)}&tab=${encodeURIComponent(tabButton.dataset.adminFileTab)}`);
      return;
    }
    const metricFilterButton = event.target.closest("[data-admin-metric-filter]");
    if (metricFilterButton) {
      adminDashboardFilter = metricFilterButton.dataset.adminMetricFilter || "all";
      adminEmployeeFilter = "";
      const employeeMenu = qs("[data-employee-filter-menu]");
      if (employeeMenu) employeeMenu.classList.add("hidden");
      showSection("dashboard");
      renderReceptionTable();
      pushAdminHash("dashboard");
      return;
    }
    const filterButton = event.target.closest("[data-admin-filter]");
    if (filterButton) {
      const filter = filterButton.dataset.adminFilter || "all";
      const employeeMenu = qs("[data-employee-filter-menu]");
      if (filter === "workshop") {
        adminDashboardFilter = "workshop";
        adminEmployeeFilter = "";
        if (employeeMenu) employeeMenu.classList.remove("hidden");
      } else if (filter === "employee") {
        adminDashboardFilter = "employee";
        adminEmployeeFilter = filterButton.dataset.employeeFilter || "";
        if (employeeMenu) employeeMenu.classList.remove("hidden");
      } else {
        adminDashboardFilter = filter;
        adminEmployeeFilter = "";
        if (employeeMenu) employeeMenu.classList.add("hidden");
      }
      showSection("dashboard");
      renderReceptionTable();
      return;
    }
    const row = event.target.closest("[data-open-file-row]");
    if (row && !event.target.closest("[data-action], [data-trash-select-id], .trash-row-selector, .trash-card-selector")) {
      openAdminReceptionFile(row.dataset.openFileRow);
      return;
    }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "purge-selected-trash") {
      event.preventDefault();
      const selectedRecords = state().receptions.filter((rec) => trashSelectedIds.has(rec.id) && isDeleted(rec));
      if (!selectedRecords.length) return;
      const label = selectedRecords.length === 1 ? selectedRecords[0].number : `${selectedRecords.length} expedientes`;
      if (!confirm(`Eliminar definitivamente ${label}? Esta acción ya no se podrá restaurar desde papelera.`)) return;
      const selectedIds = new Set(selectedRecords.map((rec) => rec.id));
      AM_SIMPLE_STORE.mutate((current) => {
        if (!Array.isArray(current.deletedReceptionNumbers)) current.deletedReceptionNumbers = [];
        if (!Array.isArray(current.reservedReceptionNumbers)) current.reservedReceptionNumbers = [];
        selectedRecords.forEach((rec) => {
          if (rec.number && !current.deletedReceptionNumbers.includes(rec.number)) current.deletedReceptionNumbers.push(rec.number);
          if (rec.number && !current.reservedReceptionNumbers.includes(rec.number)) current.reservedReceptionNumbers.push(rec.number);
        });
        current.receptions = current.receptions.filter((rec) => !selectedIds.has(rec.id));
        if (selectedIds.has(current.selectedId)) current.selectedId = "";
      });
      selectedRecords.forEach(removeEmployeeVehicleForReception);
      trashSelectedIds.clear();
      renderAdmin();
      if (!await confirmCloudSaved(`${selectedRecords.length} expediente(s) eliminado(s) definitivamente.`, "purge-selected-trash")) return;
      for (const rec of selectedRecords) await purgeBrowserResidueForReception(rec);
      toast(`${selectedRecords.length} expediente(s) eliminado(s) definitivamente.`);
      return;
    }
    if (action === "toggle-mobile-admin-menu") {
      event.preventDefault();
      event.stopPropagation();
      const menu = button.closest(".action-menu");
      if (menu) {
        menu.open = !menu.open;
        if (menu.open) closeActionMenus(menu);
      }
      return;
    }
    if (button.closest(".action-menu")) setTimeout(() => closeActionMenus(), 0);
    if (action === "retry-admin-cloud") {
      event.preventDefault();
      event.stopPropagation();
      retryAdminVehicleCloudBackup(button.dataset.id || "");
      return;
    }
    if (action === "start-dictation") {
      event.preventDefault();
      event.stopPropagation();
      startAdminDictation(button);
      return;
    }
    if (action === "open-image-preview") {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview(button.dataset.id, button.dataset.label || "Imagen");
      return;
    }
    if (action === "open-mobile-notification-detail") {
      event.preventDefault();
      event.stopPropagation();
      openMobileNotificationDetail(button.dataset.id);
      return;
    }
    if (action === "open-image-preview-direct") {
      event.preventDefault();
      event.stopPropagation();
      openImagePreviewFromData(button.dataset.src || "", button.dataset.label || "Imagen");
      return;
    }
    if (action === "open-video-preview-direct") {
      event.preventDefault();
      event.stopPropagation();
      openVideoPreviewFromData(button.dataset.src || "", button.dataset.label || "Video");
      return;
    }
    if (action === "open-mobile-card-photo") {
      event.preventDefault();
      event.stopPropagation();
      openMobileCardBackViewer(button.dataset.id || "").catch(() => {});
      return;
    }
    if (action === "close-mobile-card-photo") {
      event.preventDefault();
      event.stopPropagation();
      if (history.state?.mobileCardViewer) history.back();
      else closeMobileCardBackViewer();
      return;
    }
    if (action === "share-mobile-card-photo") {
      event.preventDefault();
      event.stopPropagation();
      await shareMobileCardBack(button.dataset.id || "");
      return;
    }
    if (action === "confirm-tracking-request") {
      event.preventDefault();
      event.stopPropagation();
      const rec = findReceptionByParam("trackingToken");
      const rowIndex = Number(button.dataset.row);
      const type = normalizeClientRequestType(button.dataset.requestType || "");
      if (!rec || !Number.isFinite(rowIndex) || !type) return;
      const card = button.closest(".tracking-client-request");
      button.disabled = true;
      if (type === "call") {
        button.textContent = "Abriendo WhatsApp...";
      } else {
        card?.classList.add("request-sending");
        button.innerHTML = '<span class="request-spinner" aria-hidden="true"></span>Enviando autorización...';
      }
      try {
        await AM_CLOUD_SYNC.publicConfirmTrackingRequest(
          rec.trackingToken,
          rowIndex,
          type,
          type === "authorization" ? "Autorizado por el cliente" : "Disponibilidad confirmada por el cliente",
          publicBrowserEvidence()
        );
      } catch (error) {
        console.error(error);
        card?.classList.remove("request-sending");
        button.disabled = false;
        button.textContent = type === "call" ? "Confirmar" : "Autorizar solicitud";
        toast("No se pudo confirmar la solicitud. Intente nuevamente.", "danger");
        return;
      }
      const rows = processRowItems(rec);
      const confirmation = rememberClientRequestConfirmation(rec, rowIndex, type, rows[rowIndex]);
      AM_SIMPLE_STORE.mutate((current) => {
        const item = current.receptions.find((candidate) => candidate.id === rec.id);
        if (!item) return;
        const itemRows = processRowItems(item);
        if (!Array.isArray(item.trackingRequests)) item.trackingRequests = trackingRequestsForRows(item, itemRows);
        while (item.trackingRequests.length <= rowIndex) item.trackingRequests.push({ type: "", confirmedAt: "", confirmedLabel: "" });
        item.trackingRequests[rowIndex] = {
          ...(item.trackingRequests[rowIndex] || {}),
          type,
          fingerprint: clientRequestFingerprint(itemRows[rowIndex]),
          confirmedAt: confirmation.confirmedAt,
          confirmedLabel: confirmation.confirmedLabel
        };
      });
      if (type === "call") {
        await sendClientAvailabilityAlertzy(rec, rowIndex);
        renderTracking();
        const target = clientAvailabilityWhatsappUrl(rec);
        setTimeout(() => {
          const opened = window.open(target, "_blank", "noopener");
          if (!opened) window.location.href = target;
        }, 1300);
      } else {
        await sendClientAuthorizationAlertzy(rec, rowIndex);
        card?.classList.remove("request-sending");
        card?.classList.add("request-sent");
        const label = card?.querySelector("strong");
        const text = card?.querySelector("span");
        if (label) label.textContent = "Autorización enviada";
        if (text) text.textContent = "Gracias por tu autorización. Esto nos ayuda a agilizar nuestro trabajo.";
        button.textContent = "Listo";
        setTimeout(() => renderTracking(), 2200);
      }
      return;
    }
    if (action === "save-admin-invoices") {
      event.preventDefault();
      await saveAdminInvoices();
      return;
    }
    if (action === "remove-admin-invoice") {
      event.preventDefault();
      await removeAdminInvoice(Number(button.dataset.index));
      return;
    }
    if (action === "open-admin-notification-summary") {
      event.preventDefault();
      openAdminNotificationSummary();
      return;
    }
    if (action === "set-notifier-mode") {
      event.preventDefault();
      setNotifierMode(button.dataset.notifierMode || "choice");
      return;
    }
    if (action === "back-notifier-choice") {
      event.preventDefault();
      setNotifierMode("choice");
      return;
    }
    if (action === "close-admin-notification-summary") {
      event.preventDefault();
      qs("[data-admin-notification-modal]")?.classList.add("hidden");
      return;
    }
    if (action === "close-image-preview") {
      event.preventDefault();
      closeImagePreview();
      return;
    }
    if (document.body.dataset.page === "employee" && handleEmployeeModuleAction(action, button, event)) return;
    if (action === "admin-login") {
      const value = qs("[data-login-value]")?.value || "";
      const buttonEl = event.target.closest("button");
      if (buttonEl) buttonEl.disabled = true;
      try {
        await AM_CLOUD_SYNC.loginAdmin(value);
        AM_CLOUD_SYNC.saveConfig({ enabled: true });
        location.reload();
      } catch (error) {
        if (buttonEl) buttonEl.disabled = false;
        toast(error.message || "PIN incorrecto.", "danger");
      }
      return;
    }
    if (action === "admin-logout") {
      try { await AM_CLOUD_SYNC?.logout?.(); } catch {}
      location.reload();
      return;
    }
    if (action === "employee-logout") {
      try { await AM_CLOUD_SYNC?.logout?.(); } catch {}
      location.reload();
      return;
    }
    if (action === "import-full-backup") {
      event.preventDefault();
      qs('[data-backup-input="full"]')?.click();
    }
    if (action === "import-single-backup") {
      event.preventDefault();
      qs('[data-backup-input="single"]')?.click();
    }
    if (action === "clear-admin-search") {
      event.preventDefault();
      adminSearchFilters = { text: "", dateFrom: "", dateTo: "", vehicleYear: "" };
      syncAdminSearchInputs();
      renderReceptionTable();
      renderClientCatalog();
      toast("Búsqueda limpia.");
    }
    if (action === "save-cloud-config") {
      event.preventDefault();
      if (!globalThis.AM_CLOUD_SYNC) {
        cloudLog("No se cargó el módulo de conexión nube.", "danger");
        return;
      }
      AM_CLOUD_SYNC.saveConfig({
        endpoint: qs("[data-cloud-endpoint]")?.value.trim() || "",
        account: qs("[data-cloud-account]")?.value.trim() || "automotrizmedinaapp@gmail.com",
        enabled: !!qs("[data-cloud-enabled]")?.checked
      });
      renderCloudSettings();
      cloudLog("Configuración de nube guardada.");
    }
    if (action === "test-cloud") {
      event.preventDefault();
      if (!globalThis.AM_CLOUD_SYNC) return;
      AM_CLOUD_SYNC.saveConfig({
        endpoint: qs("[data-cloud-endpoint]")?.value.trim() || "",
        account: qs("[data-cloud-account]")?.value.trim() || "automotrizmedinaapp@gmail.com",
        enabled: !!qs("[data-cloud-enabled]")?.checked
      });
      cloudLog("Probando conexión con Apps Script...");
      AM_CLOUD_SYNC.ping().then((result) => {
        renderCloudSettings();
        cloudLog(`Conexión correcta. Hoja: ${result.spreadsheetId || "lista"}.`, "ok");
      }).catch((error) => cloudLog(`No se pudo conectar: ${error.message}`, "danger"));
    }
    if (action === "sync-cloud-now") {
      event.preventDefault();
      if (!globalThis.AM_CLOUD_SYNC) return;
      AM_CLOUD_SYNC.saveConfig({
        endpoint: qs("[data-cloud-endpoint]")?.value.trim() || "",
        account: qs("[data-cloud-account]")?.value.trim() || "automotrizmedinaapp@gmail.com",
        enabled: !!qs("[data-cloud-enabled]")?.checked
      });
      cloudLog("Guardando respaldo completo en nube...");
      if (await confirmCloudSaved("Respaldo guardado correctamente en nube.", "manual-admin")) {
        cloudLog("Respaldo guardado correctamente en nube.", "ok");
      } else {
        cloudLog("No se pudo confirmar el respaldo en nube.", "danger");
      }
    }
    if (action === "load-cloud-latest") {
      event.preventDefault();
      if (!globalThis.AM_CLOUD_SYNC) return;
      if (!confirm("Esto reemplazará los datos actuales del navegador con el último respaldo guardado en nube. ¿Desea continuar?")) return;
      AM_CLOUD_SYNC.saveConfig({
        endpoint: qs("[data-cloud-endpoint]")?.value.trim() || "",
        account: qs("[data-cloud-account]")?.value.trim() || "automotrizmedinaapp@gmail.com",
        enabled: !!qs("[data-cloud-enabled]")?.checked
      });
      cloudLog("Cargando último respaldo de nube...");
      AM_CLOUD_SYNC.loadLatest().then((snapshot) => {
        if (!snapshot) {
          cloudLog("No hay respaldo guardado en nube.", "warn");
          return;
        }
        cloudLog("Respaldo cargado. Recargando pantalla...", "ok");
        setTimeout(() => location.reload(), 900);
      }).catch((error) => cloudLog(`No se pudo cargar la nube: ${error.message}`, "danger"));
    }
    if (action === "select-backup-preview") {
      event.preventDefault();
      qs("[data-backup-viewer-input]")?.click();
    }
    if (action === "restore-preview-backup") {
      event.preventDefault();
      if (!previewBackup) {
        toast("Primero cargue un respaldo individual en el visor.", "warn");
        return;
      }
      restoreReceptionBackup(previewBackup);
      const restoredNumber = previewBackup.reception?.number || "";
      previewBackup = null;
      const restored = state().receptions.find((item) => item.number === restoredNumber);
      if (restored) upsertEmployeeVehicle(employeeVehicleFromReception(restored));
      adminDashboardFilter = "workshop";
      renderAdmin();
      showSection("dashboard");
      if (!await confirmCloudSaved("Expediente restaurado al dashboard.", "restore-preview-backup")) return;
      toast("Expediente restaurado al dashboard.");
    }
    if (action === "grant-deadline-token") {
      event.preventDefault();
      event.stopPropagation();
      const amount = Number(prompt("¿Cuántos tokens desea habilitar para este vehículo?", "1") || 0);
      if (!Number.isFinite(amount) || amount <= 0) return;
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = current.receptions.find((item) => item.id === button.dataset.id);
        if (!rec) return;
        rec.employeeDeadlineTokensAvailable = Number(rec.employeeDeadlineTokensAvailable ?? 3) + Math.floor(amount);
        rec.employeeDeadlineUnlockRequested = false;
      });
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (rec) upsertEmployeeVehicle(employeeVehicleFromReception(rec));
      renderAdmin();
      toast("Token habilitado para el empleado.");
    }
    if (action === "reactivate-reception") {
      event.preventDefault();
      event.stopPropagation();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      if (!confirm(`¿Reactivar ${rec.number} y devolverlo a vehículos en taller?`)) return;
      let updated = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const item = current.receptions.find((candidate) => candidate.id === rec.id);
        updated = reactivateReception(item);
      });
      if (updated) upsertEmployeeVehicle(employeeVehicleFromReception(updated));
      const saved = await confirmCloudSaved("Vehículo reactivado y devuelto a taller.", "reactivate-reception");
      if (!saved) {
        renderAdmin();
        toast("No se pudo confirmar la reactivación. Intente nuevamente.", "danger");
        return;
      }
      const confirmed = state().receptions.find((item) => item.id === rec.id || item.number === rec.number);
      if (confirmed) upsertEmployeeVehicle(employeeVehicleFromReception(confirmed));
      adminDashboardFilter = "workshop";
      renderAdmin();
      showSection("dashboard");
    }
    if (action === "send-global-notification") {
      event.preventDefault();
      const employeeId = qs("[data-admin-notification-employee]")?.value || "";
      const textField = qs("[data-admin-global-notification-text]");
      const priority = qs("[data-admin-global-notification-priority]")?.value || "warn";
      const message = textField?.value.trim() || "";
      if (!employeeId || !message) {
        toast("Seleccione empleado y escriba la notificación.", "warn");
        return;
      }
      const employeeName = employeeDisplayName(employeeId);
      AM_SIMPLE_STORE.mutate((current) => {
        ensureEmployeeNotifications(current).unshift({
          id: notificationId(),
          employeeId,
          employeeName,
          message,
          priority,
          createdAt: new Date().toISOString(),
          read: false
        });
      });
      renderAdmin();
      const saved = await confirmCloudSaved("Notificación enviada al empleado.", "send-global-notification");
      if (!saved) return;
      const alertSent = await sendAlertzyNotification({
        employeeName,
        type: "Notificación general",
        priority,
        message
      });
      if (!alertSent) toast("La notificación quedó guardada, pero Alertzy no confirmó el envío externo.", "warn");
      if (textField) textField.value = "";
      renderAdmin();
    }
    if (action === "send-notifier-general") {
      event.preventDefault();
      await sendNotifierGlobal();
      return;
    }
    if (action === "send-notifier-vehicle") {
      event.preventDefault();
      await sendNotifierVehicle();
      return;
    }
    if (action === "send-vehicle-notification") {
      event.preventDefault();
      const textField = qs("[data-admin-vehicle-notification-text]");
      const priority = qs("[data-admin-vehicle-notification-priority]")?.value || "warn";
      const message = textField?.value.trim() || "";
      if (!message) {
        toast("Escriba la notificación del vehículo.", "warn");
        return;
      }
      if (!selected()) {
        toast("Seleccione un expediente para enviar la notificación.", "warn");
        return;
      }
      let alertPayload = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        if (!rec) return;
        const employeeId = rec.employeeId || String(rec.employeeName || "edwin").toLowerCase();
        const employeeName = rec.employeeName || employeeDisplayName(employeeId);
        const vehicleTitle = `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim();
        alertPayload = {
          employeeName,
          type: "Notificación de vehículo",
          priority,
          message,
          recNumber: rec.number,
          vehicleTitle,
          plate: rec.vehicle?.placa || ""
        };
        ensureReceptionNotifications(rec).unshift({
          id: notificationId(),
          employeeId,
          employeeName,
          recId: rec.id,
          recNumber: rec.number,
          message,
          priority,
          createdAt: new Date().toISOString(),
          read: false
        });
      });
      syncSelectedAdminReceptionToEmployee();
      const saved = await confirmCloudSaved("Notificación enviada al vehículo.", "send-vehicle-notification");
      if (!saved) return;
      if (alertPayload) {
        const alertSent = await sendAlertzyNotification(alertPayload);
        if (!alertSent) toast("La notificación del vehículo quedó guardada, pero Alertzy no confirmó el envío externo.", "warn");
      }
      if (textField) textField.value = "";
      renderAdmin();
    }
    if (action === "edit-notification") {
      event.preventDefault();
      const id = button.dataset.id || "";
      const currentMatch = findNotificationInState(state(), id);
      if (!currentMatch) return;
      const edit = await openNotificationEditor(currentMatch.item);
      if (!edit) return;
      let affectedRec = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const match = findNotificationInState(current, id);
        if (!match) return;
        affectedRec = match.rec;
        match.item.message = edit.message;
        match.item.priority = edit.priority;
        match.item.editedAt = new Date().toISOString();
      });
      if (affectedRec) upsertEmployeeVehicle(employeeVehicleFromReception(affectedRec));
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
      const saved = await confirmCloudSaved("Notificación editada.", "edit-notification");
      if (!saved) return;
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
      toast("Notificación editada.");
    }
    if (action === "delete-notification") {
      event.preventDefault();
      const id = button.dataset.id || "";
      if (!confirm("¿Eliminar esta notificación?")) return;
      let affectedRec = null;
      let deleted = false;
      AM_SIMPLE_STORE.mutate((current) => {
        const match = findNotificationInState(current, id);
        if (!match) return;
        affectedRec = match.rec;
        match.list.splice(match.index, 1);
        deleted = true;
      });
      if (!deleted) {
        toast("No se encontró la notificación para eliminar.", "warn");
        return;
      }
      if (affectedRec) upsertEmployeeVehicle(employeeVehicleFromReception(affectedRec));
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
      const saved = await confirmCloudSaved("Notificación eliminada.", "delete-notification");
      const stillExists = !!findNotificationInState(state(), id);
      if (!saved || stillExists) {
        renderAdmin();
        if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
        toast("No se pudo confirmar que la notificación fue eliminada. Intente nuevamente.", "danger");
        return;
      }
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
    }
    if (action === "ack-notification") {
      event.preventDefault();
      const id = button.dataset.id || "";
      let affectedRec = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const match = findNotificationInState(current, id);
        if (!match) return;
        affectedRec = match.rec;
        match.item.adminAckAt = new Date().toISOString();
        match.item.adminAckBy = "Administrador";
      });
      if (affectedRec) upsertEmployeeVehicle(employeeVehicleFromReception(affectedRec));
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
      const saved = await confirmCloudSaved("Cumplimiento validado.", "ack-notification");
      if (!saved) return;
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
      toast("Cumplimiento validado.");
    }
    if (action === "reactivate-notification") {
      event.preventDefault();
      const id = button.dataset.id || "";
      if (!confirm("¿Reactivar esta notificación y enviarla nuevamente al empleado?")) return;
      let affectedRec = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const match = findNotificationInState(current, id);
        if (!match) return;
        affectedRec = match.rec;
        match.item.completedAt = "";
        match.item.completedBy = "";
        match.item.adminAckAt = "";
        match.item.read = false;
        match.item.readAt = "";
        match.item.readBy = "";
        match.item.reactivatedAt = new Date().toISOString();
        match.item.reactivatedBy = "Administrador";
      });
      if (affectedRec) upsertEmployeeVehicle(employeeVehicleFromReception(affectedRec));
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
      const saved = await confirmCloudSaved("Notificación reactivada para el empleado.", "reactivate-notification");
      if (!saved) return;
      renderAdmin();
      if (qs("[data-admin-notification-modal]:not(.hidden)")) openAdminNotificationSummary();
      toast("Notificación reactivada para el empleado.");
    }
    if (action === "save-reception") {
      saveInventoryFromDom();
      saveReception();
    }
    if (action === "next-step" || action === "prev-step") {
      const currentSection = button.closest("[data-section]");
      const currentIndex = wizardOrder.indexOf(currentSection?.dataset.section || "datos");
      if (action === "next-step") {
        if (currentSection?.dataset.section === "datos") {
          const form = qs("[data-reception-form]");
          if (form && !form.reportValidity()) return;
          saveReceptionDraft();
        }
        if (currentSection?.dataset.section === "inventario") {
          saveInventoryFromDom();
        }
        showEmployeeStep(currentIndex + 1);
      } else {
        showEmployeeStep(currentIndex - 1);
      }
    }
    if (action === "new-reception") createReception();
    if (action === "add-inventory") {
      const name = prompt("Nombre del inventario");
      if (!name) return;
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const next = AM_SIMPLE_STORE.next(current, "inventory");
        rec.inventory.push({ id: `inv-${next}`, name, present: true, note: "" });
      });
      renderEmployee();
    }
    if (action === "add-damage") {
      const area = qs("[name='damageArea']")?.value || "Área no especificada";
      const detail = qs("[name='damageDetail']")?.value || "Detalle pendiente";
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const next = AM_SIMPLE_STORE.next(current, "damage");
        rec.damages.push({ id: `dam-${next}`, área, detail, photos: [{ label: `Daño ${área}`, dataUrl: "", note: "", color: "#b52931" }] });
      });
      renderEmployee();
      toast("Daño agregado.");
    }
    if (action === "remove-damage") {
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        rec.damages = rec.damages.filter((item) => item.id !== button.dataset.id);
      });
      renderEmployee();
    }
    if (action === "select-reception") {
      AM_SIMPLE_STORE.mutate((current) => { current.selectedId = button.dataset.id; });
      renderAdmin();
      toast("Recepción seleccionada.");
    }
    if (action === "open-file") {
      event.preventDefault();
      openAdminReceptionFile(button.dataset.id);
    }
    if (action === "download-backup") {
      event.preventDefault();
      const rec = button.dataset.id ? state().receptions.find((item) => item.id === button.dataset.id) : AM_SIMPLE_STORE.selected(state());
      if (!rec) return;
      if (!confirm(`Descargar ${rec.number} como una carpeta completa con su expediente y archivos multimedia?`)) return;
      try {
        toast("Preparando expediente completo...");
        await writeLocalArchiveBackup(rec);
        await loadLocalArchivedBackups().catch(() => {});
        toast("Expediente descargado en su carpeta local.", "ok");
      } catch (error) {
        console.error(error);
        toast(error.message || "No se pudo descargar el expediente.", "danger");
      }
    }
    if (action === "download-all-backup") {
      event.preventDefault();
      downloadAllProgramBackup();
      toast("Descargando respaldo completo del programa.");
    }
    if (action === "configure-local-archive-folder") {
      event.preventDefault();
      try {
        await configureLocalArchiveFolder();
      } catch (error) {
        console.error(error);
        toast(error.message || "No se pudo configurar la carpeta local.", "danger");
      }
    }
    if (action === "load-local-archives") {
      event.preventDefault();
      try {
        await loadLocalArchivedBackups();
        toast("Expedientes descargados cargados.");
      } catch (error) {
        console.error(error);
        toast(error.message || "No se pudieron cargar los expedientes descargados.", "danger");
      }
    }
    if (action === "restore-local-archive-preview") {
      event.preventDefault();
      const entry = adminLocalArchivedBackups[Number(button.dataset.localArchiveIndex)];
      if (!entry?.backup) return;
      openLocalArchiveAsExpediente(entry);
      toast("Expediente archivado abierto.");
    }
    if (action === "restore-local-archive-dashboard") {
      event.preventDefault();
      const entry = adminLocalArchivedBackups[Number(button.dataset.localArchiveIndex)];
      if (!entry?.backup) return;
      const rec = entry.backup.reception;
      if (!confirm(`Restaurar ${rec.number} al dashboard y volverlo activo?`)) return;
      restoreReceptionBackup(entry.backup);
      const restored = state().receptions.find((item) => item.id === rec.id || item.number === rec.number);
      if (restored) upsertEmployeeVehicle(employeeVehicleFromReception(restored));
      adminDashboardFilter = "workshop";
      renderAdmin();
      showSection("dashboard");
      const saved = await confirmCloudSaved("Expediente restaurado al dashboard.", "restore-local-archive-dashboard");
      if (!saved) {
        toast("No se pudo confirmar la restauración en nube. Intente nuevamente.", "danger");
        return;
      }
      toast("Expediente restaurado y activo.");
    }
    if (action === "delete-local-archive") {
      event.preventDefault();
      const entry = adminLocalArchivedBackups[Number(button.dataset.localArchiveIndex)];
      if (!entry?.backup) return;
      const rec = entry.backup.reception || {};
      if (!confirm(`Borrar localmente ${rec.number || "este expediente"}? Esto eliminará el respaldo guardado en la carpeta local.`)) return;
      try {
        await deleteLocalArchiveBackup(entry);
        if (adminLocalArchivePreviewRec?.id === rec.id || adminLocalArchivePreviewRec?.number === rec.number) {
          adminLocalArchivePreviewRec = null;
        }
        await loadLocalArchivedBackups();
        toast("Respaldo local borrado.");
      } catch (error) {
        console.error(error);
        toast(error.message || "No se pudo borrar el respaldo local.", "danger");
      }
    }
    if (action === "delete-reception") {
      event.preventDefault();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      if (!confirm(`Mover ${rec.number} a la papelera de reciclaje? El expediente seguirá guardado y permanecerá allí hasta que usted decida restaurarlo o eliminarlo definitivamente.`)) return;
      AM_SIMPLE_STORE.mutate((current) => {
        const item = current.receptions.find((candidate) => candidate.id === rec.id);
        if (!item) return;
        item.trashOrigin = item.archivedAt ? "archived" : "active";
        item.trashPreviousArchivedAt = item.archivedAt || "";
        item.deletedAt = new Date().toISOString();
        item.archivedAt = "";
        item.deletedBy = "Administrador";
        if (current.selectedId === item.id) current.selectedId = "";
      });
      removeEmployeeVehicleForReception(rec);
      if (location.hash.includes(rec.id)) history.replaceState(null, "", "admin.html");
      renderAdmin();
      showSection("dashboard");
      if (!await confirmCloudSaved("Expediente enviado a papelera.", "delete-reception")) return;
    }
    if (action === "archive-reception") {
      event.preventDefault();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      if (!confirm(`Archivar ${rec.number}? El expediente saldrá del dashboard y pasará a la sección Archivados, pero seguirá completamente guardado en el sistema.`)) return;
      AM_SIMPLE_STORE.mutate((current) => {
        const item = current.receptions.find((candidate) => candidate.id === rec.id);
        if (!item) return;
        item.archivedAt = new Date().toISOString();
        item.deletedAt = "";
        item.archivedBy = "Administrador";
      });
      renderAdmin();
      if (!await confirmCloudSaved("Expediente archivado.", "archive-reception")) return;
    }
    if (action === "download-local-archive") {
      event.preventDefault();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      if (!confirm(`Descargar ${rec.number} como una carpeta completa? Se incluirá expediente.json y una carpeta media con sus fotografías, facturas, daños, firma y medios de seguimiento disponibles.`)) return;
      try {
        toast("Preparando expediente completo...");
        await writeLocalArchiveBackup(rec);
        await loadLocalArchivedBackups().catch(() => {});
        toast("Expediente descargado correctamente.", "ok");
      } catch (error) {
        console.error(error);
        toast(error.message || "No se pudo descargar el expediente.", "danger");
      }
    }
    if (action === "unarchive-reception") {
      event.preventDefault();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      if (!confirm(`Restaurar ${rec.number} al dashboard y devolverlo a vehículos en taller?`)) return;
      let updated = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const item = current.receptions.find((candidate) => candidate.id === rec.id);
        if (!item) return;
        item.archivedAt = "";
        item.archivedBy = "";
        item.deletedAt = "";
        item.deletedBy = "";
        delete item.trashOrigin;
        delete item.trashPreviousArchivedAt;
        item.localArchiveConfirmedAt = "";
        item.localArchivePath = "";
        if (String(item.status || "").toUpperCase() === "FINALIZADO") {
          item.status = "EN REVISIÓN";
          item.progressLabel = item.status;
          if (!item.tracking) item.tracking = {};
          item.tracking.state = item.status;
        }
        updated = item;
      });
      if (updated) upsertEmployeeVehicle(employeeVehicleFromReception(updated));
      adminDashboardFilter = "workshop";
      renderAdmin();
      showSection("dashboard");
      if (!await confirmCloudSaved("Expediente restaurado al dashboard.", "unarchive-reception")) return;
    }
    if (action === "restore-trash-reception") {
      event.preventDefault();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      let restoredToArchive = false;
      AM_SIMPLE_STORE.mutate((current) => {
        const item = current.receptions.find((candidate) => candidate.id === rec.id);
        if (!item) return;
        restoredToArchive = item.trashOrigin === "archived";
        item.deletedAt = "";
        item.deletedBy = "";
        item.archivedAt = restoredToArchive ? (item.trashPreviousArchivedAt || new Date().toISOString()) : "";
        item.archivedBy = restoredToArchive ? (item.archivedBy || "Administrador") : "";
        delete item.trashOrigin;
        delete item.trashPreviousArchivedAt;
      });
      adminDashboardFilter = restoredToArchive ? "archived" : "all";
      renderAdmin();
      if (!await confirmCloudSaved(restoredToArchive ? "Expediente restaurado a Archivados." : "Expediente restaurado al dashboard.", "restore-trash-reception")) return;
    }
    if (action === "purge-trash-reception") {
      event.preventDefault();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      if (!confirm(`Eliminar definitivamente ${rec.number}? Esta acción ya no se podrá restaurar desde papelera.`)) return;
      AM_SIMPLE_STORE.mutate((current) => {
        if (!Array.isArray(current.deletedReceptionNumbers)) current.deletedReceptionNumbers = [];
        if (!Array.isArray(current.reservedReceptionNumbers)) current.reservedReceptionNumbers = [];
        if (rec.number && !current.deletedReceptionNumbers.includes(rec.number)) current.deletedReceptionNumbers.push(rec.number);
        if (rec.number && !current.reservedReceptionNumbers.includes(rec.number)) current.reservedReceptionNumbers.push(rec.number);
        current.receptions = current.receptions.filter((item) => item.id !== rec.id);
        if (current.selectedId === rec.id) current.selectedId = "";
      });
      removeEmployeeVehicleForReception(rec);
      if (location.hash.includes(rec.id)) history.replaceState(null, "", "admin.html");
      renderAdmin();
      if (!await confirmCloudSaved("Expediente eliminado definitivamente.", "purge-trash-reception")) return;
      await purgeBrowserResidueForReception(rec);
    }
    if (action === "send-client") {
      let target = "";
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        rec.sentToClient = true;
        rec.status = "Enviado al cliente";
        const phone = whatsappPhone(rec.client?.phone);
        const text = encodeURIComponent(authorizationMessage(rec));
        target = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
      });
      renderAdmin();
      if (target) window.open(target, "_blank");
      if (!await confirmCloudSaved("Link de autorización generado para WhatsApp.", "send-client-authorization")) return;
    }
    if (action === "send-client-photos") {
      let target = "";
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        rec.photoReviewSentAt = new Date().toISOString();
        const phone = whatsappPhone(rec.client?.phone);
        const text = encodeURIComponent(photoReviewMessage(rec));
        target = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
      });
      renderAdmin();
      if (target) window.open(target, "_blank");
      if (!await confirmCloudSaved("Link de revisión de fotografías generado para WhatsApp.", "send-client-photos")) return;
    }
    if (action === "admin-regenerate-photo-review-link") {
      const selectedRec = AM_SIMPLE_STORE.selected(state());
      if (!selectedRec) return;
      if (!confirm(`Generar un nuevo link de revisión de fotos para ${selectedRec.number}? El link anterior dejará de servir para revisar fotos.`)) return;
      let nextPhotoLink = "";
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        if (!rec) return;
        forgetConsumedClientLink(rec.clientToken);
        rec.photoAcknowledged = false;
        rec.photoAcknowledgedAt = "";
        rec.photoAcknowledgementEvidence = null;
        rec.photoReviewSentAt = "";
        rec.clientToken = "cli_" + AM_SIMPLE_STORE.cryptoToken();
        nextPhotoLink = photoReviewHref(rec.clientToken);
      });
      renderAdmin();
      await confirmCloudSaved("Nuevo link de revisión de fotos generado.", "regenerate-photo-review-link");
      if (nextPhotoLink) {
        try {
          await navigator.clipboard?.writeText(new URL(nextPhotoLink, location.href).href);
          toast("Nuevo link de revisión de fotos copiado al portapapeles.", "ok");
        } catch {
          toast("Nuevo link de revisión de fotos generado.", "ok");
        }
      }
      renderAdmin();
    }
    if (action === "send-client-tracking") {
      let target = "";
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        rec.trackingSentAt = new Date().toISOString();
        const phone = whatsappPhone(rec.client?.phone);
        const text = encodeURIComponent(trackingMessage(rec));
        target = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
      });
      renderAdmin();
      if (target) window.open(target, "_blank");
      if (!await confirmCloudSaved("Link de seguimiento generado para WhatsApp.", "send-client-tracking")) return;
    }
    if (action === "open-admin-authorization") {
      const card = qs("[data-admin-authorization-card]");
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
        card.classList.add("focus-flash");
        setTimeout(() => card.classList.remove("focus-flash"), 1200);
      }
      toast("Vista administrativa de autorización abierta.");
    }
    if (action === "admin-manual-authorize") {
      event.preventDefault();
      const selectedRec = AM_SIMPLE_STORE.selected(state());
      if (!selectedRec) {
        toast("Seleccione un expediente antes de autorizar.", "warn");
        return;
      }
      const reason = await openManualAuthorizationDialog(selectedRec);
      if (reason === null) return;
      let updatedRec = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        if (!rec) return;
        rec.signed = true;
        rec.sentToClient = true;
        rec.manualAuthorization = true;
        rec.adminSignatureReviewedAt = new Date().toISOString();
        rec.adminSignatureReviewedBy = "Administrador";
        rec.signatureName = rec.client?.name || "Autorización manual administrativa";
        rec.signatureDate = new Date().toLocaleString("es-SV");
        rec.status = "Autorizado";
        rec.clientToken = "";
        rec.authorizationEvidence = {
          acceptedAtIso: new Date().toISOString(),
          authorizationType: "Manual por administrador",
          registeredBy: "Administrador",
          reason: reason || "Autorización manual registrada por administrador",
          userAgent: navigator.userAgent || "",
          platform: navigator.platform || "",
          language: navigator.language || "",
          languages: Array.isArray(navigator.languages) ? navigator.languages.join(", ") : "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
          screen: `${screen.width}x${screen.height}`,
          viewport: `${innerWidth}x${innerHeight}`
        };
        updatedRec = rec;
      });
      if (updatedRec) upsertEmployeeVehicle(employeeVehicleFromReception(updatedRec));
      renderAdmin();
      if (!await confirmCloudSaved("Autorización manual registrada.", "manual-authorization")) return;
      renderAdmin();
      toast("Autorización manual registrada.");
    }
    if (action === "admin-remove-authorization") {
      const rec = AM_SIMPLE_STORE.selected(state());
      if (!rec) return;
      if (!confirm(`Quitar la autorización de ${rec.number}? El expediente volverá a estado pendiente.`)) return;
      let updatedRec = null;
      AM_SIMPLE_STORE.mutate((current) => {
        const item = AM_SIMPLE_STORE.selected(current);
        item.signed = false;
        item.sentToClient = false;
        item.manualAuthorization = false;
        item.adminSignatureReviewedAt = "";
        item.adminSignatureReviewedBy = "";
        item.signatureName = "";
        item.signatureDate = "";
        item.signatureDataUrl = "";
        item.termsAcceptedAt = "";
        item.quickAuthorization = false;
        item.photoAcknowledged = false;
        item.photoAcknowledgedAt = "";
        item.photoAcknowledgementEvidence = null;
        item.clientToken = "cli_" + AM_SIMPLE_STORE.cryptoToken();
        item.status = "Pendiente de autorización";
        item.authorizationEvidence = {
          removedAtIso: new Date().toISOString(),
          authorizationType: "Autorización eliminada",
          registeredBy: "Administrador",
          reason: "Autorización quitada manualmente por administrador"
        };
        updatedRec = item;
      });
      if (updatedRec) syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmCloudSaved("Autorización eliminada.", "remove-authorization")) return;
      renderAdmin();
    }
    if (action === "save-client-profile") {
      AM_SIMPLE_STORE.mutate((current) => {
        saveAdminAllFromDom(current);
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmCloudSaved("Guardado.", "save-client-profile")) return;
    }
    if (action === "save-admin-expediente") {
      AM_SIMPLE_STORE.mutate((current) => {
        saveAdminAllFromDom(current);
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmCloudSaved("Guardado.", "save-admin-expediente")) return;
    }
    if (action === "save-admin-all") {
      AM_SIMPLE_STORE.mutate((current) => {
        saveAdminAllFromDom(current);
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmCloudSaved("Guardado.", "save-admin-all")) return;
    }
    if (action === "admin-add-damage") {
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const next = AM_SIMPLE_STORE.next(current, "damage");
        rec.damages.push({ id: `adm-dam-${next}`, área: "Área", detail: "Detalle", photos: [{ label: "Foto daño", dataUrl: "", note: "", color: "#b52931" }] });
      });
      renderAdmin();
      toast("Daño agregado.");
    }
    if (action === "admin-remove-damage") {
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        rec.damages = rec.damages.filter((damage) => damage.id !== button.dataset.id);
      });
      renderAdmin();
      toast("Daño eliminado.");
    }
    if (action === "admin-add-damage-photo") {
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const damage = rec.damages.find((item) => item.id === button.dataset.id);
        if (!damage) return;
        if (!Array.isArray(damage.photos)) damage.photos = [];
        damage.photos.push({ label: `Foto daño ${damage.photos.length + 1}`, dataUrl: "", note: "", color: "#b52931" });
      });
      renderAdmin();
      toast("Foto agregada al daño.");
    }
    if (action === "copy-client-link") copyText(qs("[data-client-links] a")?.href || "");
    if (action === "save-admin-tracking") {
      event.preventDefault();
      const selectedRec = selected();
      if (!selectedRec) {
        toast("Seleccione un expediente para guardar seguimiento.", "warn");
        return;
      }
      const draft = captureAdminTrackingDraftFromDom(selectedRec);
      AM_SIMPLE_STORE.mutate((current) => {
        persistAdminTrackingDraft(current, draft, false);
      });
      syncSelectedAdminReceptionToEmployee();
      const saved = await confirmCloudSaved("Seguimiento guardado.", "save-admin-tracking");
      if (!saved) return;
      renderAdmin();
    }
    if (action === "save-progress") {
      event.preventDefault();
      const selectedRec = selected();
      if (!selectedRec) {
        toast("Seleccione un expediente para publicar seguimiento.", "warn");
        return;
      }
      const draft = captureAdminTrackingDraftFromDom(selectedRec);
      const isFinalized = String(draft.profile.state || "").toUpperCase() === "FINALIZADO";
      let deliverySchedule = null;
      if (isFinalized) {
        const deliveryDate = draft.profile.deliveryEstimate || "";
        const deliveryTime = draft.finalDeliveryTime || "";
        if (!deliveryDate) {
          toast("Seleccione la estimación de entrega antes de publicar la finalización.", "warn");
          qs('[data-track-field="deliveryEstimate"]')?.focus();
          return;
        }
        if (!deliveryTime) {
          toast("Escriba la hora de entrega antes de publicar la finalización.", "warn");
          qs("[data-time12-hour]", qs("[data-final-delivery-time12]"))?.focus();
          return;
        }
        draft.progress = 100;
        deliverySchedule = { date: deliveryDate, time: deliveryTime };
        draft.profile.finalDeliveryDate = deliveryDate;
        draft.profile.finalDeliveryTime = deliveryTime;
      }
      AM_SIMPLE_STORE.mutate((current) => {
        persistAdminTrackingDraft(current, draft, true);
        const updated = current.receptions.find((item) => item.id === selectedRec.id);
        if (deliverySchedule && updated) {
          applyFinalDeliverySchedule(updated, deliverySchedule);
          updated.finalizationPublishedAt = new Date().toISOString();
        }
      });
      adminTrackingDraft = null;
      syncSelectedAdminReceptionToEmployee();
      const saved = await confirmCloudSaved("Seguimiento publicado.", "publish-tracking");
      if (!saved) return;
      renderAdmin();
    }
    if (action === "publish-pending-tracking") {
      const selectedRec = selected();
      const pendingState = selectedRec?.pendingTracking?.state || selectedRec?.tracking?.state || selectedRec?.status;
      const deliverySchedule = needsFinalDeliverySchedule(selectedRec, pendingState)
        ? await openFinalDeliveryDialog(selectedRec)
        : null;
      if (needsFinalDeliverySchedule(selectedRec, pendingState) && !deliverySchedule) return;
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const pending = rec.pendingTracking && rec.pendingTracking.status === "pending" ? rec.pendingTracking : null;
        if (!pending) return;
        const profile = trackingProfile(rec);
        profile.state = pending.state || profile.state || rec.status;
        profile.processDetails = pending.processDetails || "";
        rec.progress = Number(pending.progress || 0);
        rec.publishedProgress = rec.progress;
        rec.progressLabel = profile.state || "En proceso";
        rec.status = profile.state || rec.status;
        rec.trackingImages = Array.isArray(pending.images) ? pending.images : [];
        rec.trackingRequests = Array.isArray(pending.requests)
          ? pending.requests
          : trackingRequestsForRows(rec, processRowItems(rec));
        rec.pendingTracking = {
          ...pending,
          status: "published",
          publishedAt: new Date().toISOString()
        };
        if (deliverySchedule) applyFinalDeliverySchedule(rec, deliverySchedule);
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmCloudSaved("Seguimiento publicado al cliente.", "publish-pending-tracking")) return;
    }
    if (action === "publish-finalization") {
      event.preventDefault();
      event.stopPropagation();
      const rec = state().receptions.find((item) => item.id === button.dataset.id);
      if (!rec) return;
      const deliverySchedule = await openFinalDeliveryDialog(rec);
      if (!deliverySchedule) return;
      let updated = null;
      AM_SIMPLE_STORE.mutate((current) => {
        updated = current.receptions.find((item) => item.id === rec.id);
        if (!updated) return;
        const profile = trackingProfile(updated);
        const pending = updated.pendingTracking && updated.pendingTracking.status === "pending" ? updated.pendingTracking : null;
        if (pending) {
          profile.processDetails = pending.processDetails || profile.processDetails || "";
          updated.trackingImages = Array.isArray(pending.images) ? pending.images : (updated.trackingImages || []);
          updated.trackingRequests = Array.isArray(pending.requests)
            ? pending.requests
            : trackingRequestsForRows(updated, processRowItems(updated));
        }
        profile.state = "FINALIZADO";
        updated.status = "FINALIZADO";
        updated.progress = 100;
        updated.publishedProgress = 100;
        updated.progressLabel = "FINALIZADO";
        updated.finalizationPublishedAt = new Date().toISOString();
        applyFinalDeliverySchedule(updated, deliverySchedule);
        updated.adminTrackingDraft = null;
        if (updated.pendingTracking) {
          updated.pendingTracking = {
            ...updated.pendingTracking,
            status: "published",
            state: "FINALIZADO",
            progress: 100,
            publishedAt: new Date().toISOString()
          };
        }
        if (!updated.internalWork) updated.internalWork = {};
        const stamp = new Date().toLocaleString("es-SV");
        const note = `FINALIZACIÓN PUBLICADA AL CLIENTE: ${stamp}`;
        const existing = String(updated.internalWork.internalNote || "").trim();
        updated.internalWork.internalNote = existing ? `${existing}\n${note}` : note;
      });
      if (updated) upsertEmployeeVehicle(employeeVehicleFromReception(updated));
      adminTrackingDraft = null;
      renderAdmin();
      if (!await confirmCloudSaved("Finalizacion publicada al cliente.", "publish-finalization")) return;
    }
    if (action === "admin-add-detail-row") {
      const rec = selected();
      const draft = captureAdminTrackingDraftFromDom(rec);
      const next = qs("[data-admin-new-detail]")?.value.trim();
      if (next) {
        draft.rows.push({ status: "pending", text: next });
        draft.images.push([]);
      }
      AM_SIMPLE_STORE.mutate((current) => {
        persistAdminTrackingDraft(current, draft, false);
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (next && !await confirmCloudSaved("Seguimiento guardado.", "admin-add-detail-row")) return;
    }
    if (action === "admin-detail-status") {
      const row = qs(`[data-admin-process-row="${button.dataset.index}"]`);
      if (row) {
        const nextStatus = button.dataset.status || "pending";
        row.dataset.detailStatus = nextStatus;
        row.closest(".admin-detail-row")?.querySelector("textarea")?.setAttribute("data-detail-status", nextStatus);
        button.parentElement?.querySelectorAll("button").forEach((item) => item.classList.toggle("primary", item === button));
      }
    }
    if (action === "admin-remove-detail-row") {
      const rec = selected();
      const draft = captureAdminTrackingDraftFromDom(rec);
      const index = Number(button.dataset.index);
      draft.rows.splice(index, 1);
      draft.images.splice(index, 1);
      AM_SIMPLE_STORE.mutate((current) => {
        persistAdminTrackingDraft(current, draft, false);
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmCloudSaved("Seguimiento guardado.", "admin-remove-detail-row")) return;
    }
    if (action === "save-internal-log") {
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const rows = qsa("[data-admin-internal-row]").map((input) => input.value.trim()).filter(Boolean);
        rec.internalWork = { ...(rec.internalWork || {}), internalNote: rows.join("\n"), lockedReception: true };
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmInternalLogSaved("Bitácora interna guardada.", "save-internal-log")) return;
    }
    if (action === "admin-add-internal-row") {
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const rows = internalRows(rec);
        const next = qs("[data-admin-new-internal]")?.value.trim();
        if (next) rows.push(next);
        rec.internalWork = { ...(rec.internalWork || {}), internalNote: rows.join("\n"), lockedReception: true };
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmInternalLogSaved("Bitácora interna guardada.", "admin-add-internal-row")) return;
    }
    if (action === "admin-remove-internal-row") {
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const rows = qsa("[data-admin-internal-row]").map((input) => input.value.trim()).filter(Boolean);
        rows.splice(Number(button.dataset.index), 1);
        rec.internalWork = { ...(rec.internalWork || {}), internalNote: rows.join("\n"), lockedReception: true };
      });
      syncSelectedAdminReceptionToEmployee();
      renderAdmin();
      if (!await confirmInternalLogSaved("Bitácora interna guardada.", "admin-remove-internal-row")) return;
    }
    if (action === "print-authorization") {
      const rec = AM_SIMPLE_STORE.selected(state());
      const evidence = rec.authorizationEvidence || {};
      const logoUrl = location.href.replace(/[^/\\]*$/, "") + "automotriz-medina-logo.png";
      const vehicleName = `${rec.vehicle?.marca || ""} ${rec.vehicle?.modelo || ""} ${rec.vehicle?.anio || ""}`.trim().toUpperCase();
      const authorizationType = evidence.authorizationType || (rec.quickAuthorization ? "Firma presencial en taller" : "Cliente por link");
      const inventoryRows = (rec.inventory || []).map((item) => `
        <tr>
          <td>${esc(item.name)}</td>
          <td><span class="${item.present ? "ok-text" : "danger-text"}">${item.present ? "Presente" : "Faltante"}</span></td>
          <td>${esc(item.note || "Sin observación")}</td>
        </tr>`).join("");
      const damageRows = (rec.damages || []).map((damage) => `
        <tr>
          <td>${esc(damage.área || damage.area || "Área no indicada")}</td>
          <td>${esc(damage.detail || "Sin detalle")}</td>
          <td>${(damage.photos || []).length}</td>
        </tr>`).join("");
      const photoRows = receptionPhotos(rec).map((photo) => `
        <tr>
          <td>${esc(photo.label || "Fotografía")}</td>
          <td>${photo.dataUrl ? "Registrada" : "Pendiente"}</td>
          <td>${esc(photo.note || "")}</td>
        </tr>`).join("");
      const signatureMarkup = rec.signatureDataUrl
        ? `<img class="signature-img" src="${rec.signatureDataUrl}" alt="Firma del cliente">`
        : `<div class="signature-line"></div><small>Firma no capturada en este documento</small>`;
      const html = `
        <!doctype html><html><head><meta charset="utf-8"><title>Autorización ${esc(rec.number)}</title><style>
          *{box-sizing:border-box}
          body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#16212c;background:#eef3f6;line-height:1.42}
          .page{max-width:960px;margin:0 auto;background:#fff;min-height:100vh;padding:34px 38px}
          .header{display:grid;grid-template-columns:170px 1fr 230px;gap:22px;align-items:start;border-bottom:4px solid #206f78;padding-bottom:18px;margin-bottom:18px}
          .logo{width:150px;max-height:118px;object-fit:contain}
          .brand h1{margin:0;font-size:24px;line-height:1.15;text-transform:uppercase;letter-spacing:.03em;color:#17202a}
          .brand p,.meta p{margin:4px 0;color:#637282}
          .meta{text-align:right;font-size:13px}
          .status{display:inline-block;border-radius:999px;padding:7px 12px;font-weight:800;background:${rec.signed ? "#e7f4ed" : "#fff3d8"};color:${rec.signed ? "#24744a" : "#8a5b00"};margin-top:7px}
          .folio{font-weight:800;color:#17202a;font-size:18px}
          .notice{border-left:5px solid #206f78;background:#f4f8f9;padding:13px 15px;margin:14px 0;border-radius:4px}
          h2{font-size:14px;margin:22px 0 9px;color:#206f78;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #d9e1e8;padding-bottom:6px}
          table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px}
          td,th{border:1px solid #d9e1e8;padding:8px 9px;vertical-align:top}
          th{background:#eef5f6;text-align:left;color:#17202a}
          td:first-child{font-weight:700;color:#344255;width:28%}
          .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
          .legal{font-size:12.5px;text-align:justify}
          .legal h3{margin:0 0 8px;color:#17202a;font-size:15px}
          .legal p{margin:0 0 9px}
          .proof-table td:first-child{width:32%}
          .signature{display:grid;grid-template-columns:1.2fr .8fr;gap:18px;margin-top:24px;align-items:stretch}
          .box{border:1px solid #d9e1e8;border-radius:6px;padding:14px;min-height:128px;background:#fbfdfe}
          .signature-img{display:block;width:100%;max-height:160px;object-fit:contain;background:#fff;border:1px solid #d9e1e8;border-radius:4px;margin:8px 0}
          .signature-line{border-bottom:2px solid #17202a;height:72px;margin:20px 0 10px}
          .ok-text{color:#24744a;font-weight:700}
          .danger-text{color:#b52931;font-weight:700}
          .footer{margin-top:24px;border-top:1px solid #d9e1e8;padding-top:10px;color:#637282;font-size:11px;display:flex;justify-content:space-between;gap:16px}
          @media print{body{background:#fff}.page{padding:18px 20px}.no-break{break-inside:avoid}.header{grid-template-columns:130px 1fr 200px}.logo{width:118px}.legal{font-size:11.5px}}
        </style></head><body>
        <main class="page">
          <section class="header">
            <div><img class="logo" src="${logoUrl}" alt="Automotriz Medina"></div>
            <div class="brand">
              <h1>Autorización de diagnóstico y/o reparación</h1>
              <p><strong>Automotriz Medina</strong></p>
              <p>Documento de consentimiento informado del cliente</p>
            </div>
            <div class="meta">
              <p class="folio">${esc(rec.number)}</p>
              <p><strong>Impresión:</strong> ${new Date().toLocaleString("es-SV")}</p>
              <span class="status">${rec.signed ? "AUTORIZADO POR EL CLIENTE" : "PENDIENTE DE AUTORIZACION"}</span>
            </div>
          </section>

          <div class="notice">
            Este documento deja constancia formal de la recepción del vehículo, la información presentada al cliente, las condiciones registradas por el taller y la autorización otorgada para proceder con diagnóstico y/o reparación según corresponda.
          </div>

          <section class="grid-2 no-break">
            <div>
              <h2>Datos del cliente</h2>
              <table>
                <tr><td>Nombre</td><td>${esc(rec.client?.name || "Cliente pendiente")}</td></tr>
                <tr><td>Teléfono</td><td>${esc(rec.client?.phone || "Sin teléfono")}</td></tr>
                <tr><td>Autorizado por</td><td>${esc(rec.signatureName || rec.client?.name || "")}</td></tr>
                <tr><td>Fecha autorización</td><td>${esc(rec.signatureDate || "Pendiente")}</td></tr>
              </table>
            </div>
            <div>
              <h2>Datos del vehículo</h2>
              <table>
                <tr><td>Vehículo</td><td>${esc(vehicleName || "Vehículo pendiente")}</td></tr>
                <tr><td>Color</td><td>${esc(rec.vehicle?.color || "N/D")}</td></tr>
                <tr><td>Placa</td><td>${esc(rec.vehicle?.placa || "N/D")}</td></tr>
                <tr><td>VIN</td><td>${esc(rec.vehicle?.vin || "N/D")}</td></tr>
                <tr><td>Kilometraje</td><td>${esc(rec.vehicle?.kilometraje || "N/D")}</td></tr>
                <tr><td>Técnico receptor</td><td>${esc(rec.employeeName || "N/D")}</td></tr>
              </table>
            </div>
          </section>

          <h2>Motivo de recepción / falla reportada</h2>
          <div class="notice">${esc(serviceReason(rec) || "Sin motivo registrado.")}</div>

          <h2>Observaciones de recepción</h2>
          <div class="notice">${esc(rec.observations || "Sin observaciones registradas.")}</div>

          <h2>Inventario registrado</h2>
          <table><thead><tr><th>Elemento</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>${inventoryRows || '<tr><td colspan="3">Sin inventario registrado.</td></tr>'}</tbody></table>

          <h2>Daños u observaciones de carrocería</h2>
          <table><thead><tr><th>Área</th><th>Detalle</th><th>Fotos</th></tr></thead><tbody>${damageRows || '<tr><td colspan="3">Sin daños registrados.</td></tr>'}</tbody></table>

          <h2>Registro fotográfico</h2>
          <table><thead><tr><th>Fotografía</th><th>Estado</th><th>Nota</th></tr></thead><tbody>${photoRows || '<tr><td colspan="3">Sin fotografías registradas.</td></tr>'}</tbody></table>

          <h2>Cláusulas de autorización</h2>
          <div class="legal no-break">${authorizationTermsHtml()}</div>

          <h2>Constancia técnica de aceptación</h2>
          <table class="proof-table">
            <tr><td>Estado</td><td>${rec.signed ? "Autorizado" : "Pendiente"}</td></tr>
            <tr><td>Tipo de autorización</td><td>${esc(authorizationType)}</td></tr>
            <tr><td>Registrado por</td><td>${esc(evidence.registeredBy || (rec.quickAuthorization ? rec.employeeName : "Cliente"))}</td></tr>
            <tr><td>Motivo / referencia</td><td>${esc(evidence.reason || "")}</td></tr>
            <tr><td>Fecha de autorización</td><td>${esc(rec.signatureDate || "")}</td></tr>
            <tr><td>Navegador</td><td>${esc(evidence.userAgent || "No registrado")}</td></tr>
            <tr><td>Plataforma</td><td>${esc(evidence.platform || "No registrado")}</td></tr>
            <tr><td>Idioma</td><td>${esc(evidence.language || "No registrado")}</td></tr>
            <tr><td>Zona horaria</td><td>${esc(evidence.timezone || "No registrado")}</td></tr>
            <tr><td>Pantalla / ventana</td><td>${esc([evidence.screen, evidence.viewport].filter(Boolean).join(" / ") || "No registrado")}</td></tr>
          </table>

          <section class="signature no-break">
            <div class="box">
              <strong>Cliente / responsable</strong><br>
              ${esc(rec.signatureName || rec.client?.name || "")}
              ${signatureMarkup}
              <small>Autorización registrada en el expediente ${esc(rec.number || "")}.</small>
            </div>
            <div class="box">
              <strong>Automotriz Medina</strong><br>
              Recepción y resguardo del expediente.<br><br>
              <div class="signature-line"></div>
              <small>Firma / sello interno</small>
            </div>
          </section>

          <div class="footer">
            <span>Documento generado desde el sistema de recepción de Automotriz Medina.</span>
            <span>${esc(rec.number || "")} · ${new Date().toLocaleDateString("es-SV")}</span>
          </div>
        </main>
        </body></html>`;
      const win = window.open("", "_blank");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
      }
    }
    if (action === "add-update") {
      const title = qs("[name='updateTitle']")?.value || "Avance";
      const text = qs("[name='updateText']")?.value || "Avance registrado.";
      AM_SIMPLE_STORE.mutate((current) => {
        const rec = AM_SIMPLE_STORE.selected(current);
        const next = AM_SIMPLE_STORE.next(current, "update");
        rec.updates.unshift({ id: `upd-${next}`, date: today(), title, text, photo: "" });
      });
      renderAdmin();
      toast("Avance publicado en seguimiento.");
    }
    if (action === "prev-photo" || action === "next-photo") {
      moveClientCarousel(action === "next-photo" ? 1 : -1);
    }
    if (action === "authorize-client") {
      const rec = findReceptionByParam("clientToken");
      const flow = qs("[data-authorization-flow]");
      const processingOnly = qs("[data-processing-only]");
      const authorizedOnly = qs("[data-authorized-only]");
      const processingTitle = qs("[data-processing-title]");
      const processingMessage = qs("[data-processing-message]");
      if (flow) flow.classList.add("hidden");
      if (authorizedOnly) authorizedOnly.classList.add("hidden");
      if (processingTitle) processingTitle.textContent = "Habilitando seguimiento";
      if (processingMessage) processingMessage.textContent = "En este momento se habilitará tu link de seguimiento.";
      if (processingOnly) processingOnly.classList.remove("hidden");
      setTimeout(async () => {
        try {
          const result = await AM_CLOUD_SYNC.publicAuthorize(rec.clientToken, publicBrowserEvidence());
          AM_SIMPLE_STORE.mutate((current) => {
            const item = current.receptions.find((candidate) => candidate.id === rec.id);
            if (!item) return;
            item.signed = true;
            item.signatureName = item.client?.name || "";
            item.signatureDate = new Date().toLocaleString("es-SV");
            item.status = "Autorizado";
          });
          const trackingToken = result.trackingToken || rec.trackingToken;
          markConsumedClientLink(rec.clientToken, trackingToken);
          window.location.replace(tokenHref("seguimiento.html", trackingToken));
        } catch (error) {
          console.error(error);
          if (processingTitle) processingTitle.textContent = "No se pudo completar la autorización";
          if (processingMessage) processingMessage.textContent = "Revisa tu conexión e intenta nuevamente.";
        }
      }, 250);
    }
    if (action === "acknowledge-client-photos") {
      const rec = findReceptionByParam("clientToken");
      const flow = qs("[data-authorization-flow]");
      const processingOnly = qs("[data-processing-only]");
      const authorizedOnly = qs("[data-authorized-only]");
      const processingTitle = qs("[data-processing-title]");
      const processingMessage = qs("[data-processing-message]");
      if (flow) flow.classList.add("hidden");
      if (authorizedOnly) authorizedOnly.classList.add("hidden");
      if (processingTitle) processingTitle.textContent = "Habilitando seguimiento";
      if (processingMessage) processingMessage.textContent = "En este momento se habilitará tu link de seguimiento.";
      if (processingOnly) processingOnly.classList.remove("hidden");
      setTimeout(async () => {
        try {
          const result = await AM_CLOUD_SYNC.publicAcknowledgePhotos(rec.clientToken, publicBrowserEvidence());
          const trackingToken = result.trackingToken || rec.trackingToken;
          markConsumedClientLink(rec.clientToken, trackingToken);
          window.location.replace(tokenHref("seguimiento.html", trackingToken));
        } catch (error) {
          console.error(error);
          if (processingTitle) processingTitle.textContent = "No se pudo confirmar la revisión";
          if (processingMessage) processingMessage.textContent = "Revisa tu conexión e intenta nuevamente.";
        }
      }, 700);
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (input.matches?.("[data-dashboard-quick-search]")) {
      adminDashboardQuickSearch = input.value || "";
      renderReceptionTable();
      return;
    }
    if (input.matches?.("[data-local-archive-search]")) {
      adminLocalArchiveSearch = input.value || "";
      renderLocalArchiveTable();
      return;
    }
    if (input.matches?.("[data-admin-search], [data-admin-date-from], [data-admin-date-to], [data-admin-vehicle-year]")) {
      adminSearchFilters.text = qs("[data-admin-search]")?.value || "";
      adminSearchFilters.dateFrom = qs("[data-admin-date-from]")?.value || "";
      adminSearchFilters.dateTo = qs("[data-admin-date-to]")?.value || "";
      adminSearchFilters.vehicleYear = qs("[data-admin-vehicle-year]")?.value || "";
      syncAdminSearchInputs();
      renderReceptionTable();
      renderClientCatalog();
    }
    if (input.matches?.("[data-notifier-vehicle-search]")) {
      renderNotifierVehicles();
    }
  });

  document.addEventListener("change", async (event) => {
    const input = event.target;
    if (input.matches?.("[data-notifier-vehicle-select]")) {
      renderNotifierVehiclePreview();
      return;
    }
    if (input.matches?.("[data-notifier-vehicle-employee]")) {
      renderNotifierVehicles();
      return;
    }
    if (input.matches?.("[data-admin-search], [data-admin-date-from], [data-admin-date-to], [data-admin-vehicle-year]")) {
      adminSearchFilters.text = qs("[data-admin-search]")?.value || "";
      adminSearchFilters.dateFrom = qs("[data-admin-date-from]")?.value || "";
      adminSearchFilters.dateTo = qs("[data-admin-date-to]")?.value || "";
      adminSearchFilters.vehicleYear = qs("[data-admin-vehicle-year]")?.value || "";
      syncAdminSearchInputs();
      renderReceptionTable();
      renderClientCatalog();
      return;
    }
    if (input.matches("[data-admin-invoice-label]")) {
      const rec = selected();
      if (!rec) return;
      const invoices = captureAdminInvoicesFromDom(rec);
      try { await persistAdminInvoices(rec, invoices, "Guardando factura…"); }
      catch (error) { console.error(error); toast(error.message || "No se pudo guardar el nombre de la factura.", "danger"); }
      return;
    }
    if (input.matches("[data-backup-input]")) {
      importBackupFile(input.files?.[0], input.dataset.backupInput || "").catch((error) => {
        console.error(error);
        toast(error.message || "No se pudo cargar el respaldo.", "danger");
      }).finally(() => {
        input.value = "";
      });
      return;
    }
    if (input.matches("[data-backup-viewer-input]")) {
      previewBackupFile(input.files?.[0]).catch((error) => {
        console.error(error);
        toast(error.message || "No se pudo abrir el expediente temporal.", "danger");
      }).finally(() => {
        input.value = "";
      });
      return;
    }
    if (input.matches("[data-photo-index]") && input.dataset.damagePhoto == null) {
      const index = Number(input.dataset.photoIndex);
      const quality = imageQualityForLabel(selected()?.photos?.[index]?.label);
      readFile(input, (dataUrl) => {
        AM_SIMPLE_STORE.mutate((current) => {
          AM_SIMPLE_STORE.selected(current).photos[index].dataUrl = dataUrl;
        });
        renderPhotoEditor();
      }, quality);
    }
    if (input.matches("[data-damage-photo]")) {
      const damageId = input.dataset.damagePhoto;
      const photoIndex = Number(input.dataset.photoIndex);
      readFile(input, (dataUrl) => {
        AM_SIMPLE_STORE.mutate((current) => {
          const damage = AM_SIMPLE_STORE.selected(current).damages.find((item) => item.id === damageId);
          if (damage) damage.photos[photoIndex].dataUrl = dataUrl;
        });
        renderDamageEditor();
      });
    }
    if (input.matches("[data-admin-photo-index]")) {
      const photoIndex = Number(input.dataset.adminPhotoIndex);
      const quality = imageQualityForLabel(selected()?.photos?.[photoIndex]?.label);
      readFile(input, (dataUrl) => {
        AM_SIMPLE_STORE.mutate((current) => {
          const rec = AM_SIMPLE_STORE.selected(current);
          if (rec.photos[photoIndex]) rec.photos[photoIndex].dataUrl = dataUrl;
        });
        renderAdmin();
      }, quality);
    }
    if (input.matches("[data-admin-detail-image]")) {
      const rec = selected();
      const rowIndex = Number(input.dataset.adminDetailImage);
      try {
        const files = Array.from(input.files || []);
        const dataUrls = (await Promise.all(files.map((file) => readTrackingMediaFile(file)))).filter(Boolean);
        if (!dataUrls.length) return;
        const draft = captureAdminTrackingDraftFromDom(rec);
        while (draft.images.length <= rowIndex) draft.images.push([]);
        if (!Array.isArray(draft.images[rowIndex])) draft.images[rowIndex] = [];
        draft.images[rowIndex].push(...dataUrls);
        AM_SIMPLE_STORE.mutate((current) => {
          persistAdminTrackingDraft(current, draft, false);
        });
        syncSelectedAdminReceptionToEmployee();
        renderAdmin();
        if (!await confirmCloudSaved("Imagen de seguimiento guardada.", "admin-detail-image")) return;
      } catch (error) {
        console.error(error);
        toast(error.message || "No se pudo guardar la imagen.", "danger");
      } finally {
        input.value = "";
      }
      return;
    }
    if (input.matches("[data-admin-invoice-upload]")) {
      try {
        await addAdminInvoices(input);
      } catch (error) {
        console.error(error);
        toast(error.message || "No se pudo agregar la factura.", "danger");
      } finally {
        input.value = "";
      }
      return;
    }
    if (input.matches("[data-admin-damage-photo]")) {
      const damageId = input.dataset.adminDamagePhoto;
      const photoIndex = Number(input.dataset.photoIndex);
      readFile(input, (dataUrl) => {
        AM_SIMPLE_STORE.mutate((current) => {
          const rec = AM_SIMPLE_STORE.selected(current);
          const damage = rec.damages.find((item) => item.id === damageId);
          if (damage?.photos?.[photoIndex]) damage.photos[photoIndex].dataUrl = dataUrl;
        });
        renderAdmin();
      });
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target.matches("[data-admin-progress]")) {
      const value = qs("[data-progress-value]");
      if (value) value.textContent = `${event.target.value}%`;
    }
    if (event.target.matches("[data-terms-check]")) {
      const button = qs("[data-action='authorize-client']");
      if (button) button.disabled = !event.target.checked;
    }
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-admin-deadline-date]") || event.target.closest?.("[data-admin-deadline-time12]")) {
      syncAdminDeadline12Value();
      return;
    }
    if (event.target.closest?.("[data-final-delivery-time12]")) {
      syncFinalDelivery12Value();
      return;
    }
    if (event.target.matches('[data-track-field="state"]')) {
      const isFinalized = String(event.target.value || "").toUpperCase() === "FINALIZADO";
      const field = qs("[data-final-delivery-time-field]");
      if (field) field.classList.toggle("hidden", !isFinalized);
      if (isFinalized) qs("[data-time12-hour]", qs("[data-final-delivery-time12]"))?.focus();
      return;
    }
    if (event.target.matches("[data-terms-check]")) {
      const button = qs("[data-action='authorize-client']");
      if (button) button.disabled = !event.target.checked;
    }
  });
}

function handleEmployeeModuleAction(action, button, event) {
  if (action === "employee-new-vehicle") {
    createReception();
    return true;
  }
  if (action === "next-step") {
    saveReceptionDraft();
    setEmployeeWizardStep("fotos");
    return true;
  }
  if (action === "employee-step-data") {
    setEmployeeWizardStep("datos");
    return true;
  }
  if (action === "employee-step-photos") {
    setEmployeeWizardStep("fotos");
    return true;
  }
  if (action === "employee-step-inventory") {
    saveReceptionDraft();
    setEmployeeWizardStep("inventario");
    return true;
  }
  if (action === "employee-step-damages") {
    saveInventoryFromDom();
    setEmployeeWizardStep("danos");
    return true;
  }
  if (action === "employee-step-finish") {
    const finalSummary = qs("[data-final-summary]");
    const rec = selected();
    if (finalSummary && rec) {
      finalSummary.innerHTML = `
        <div class="grid cols-3">
          <div class="metric"><span>Vehículo</span><strong>${esc(rec.vehicle.marca || "Pendiente")} ${esc(rec.vehicle.modelo || "")}</strong><small>${esc(rec.vehicle.placa || "Sin placa")}</small></div>
          <div class="metric"><span>Fotos</span><strong>${receptionPhotos(rec).filter((p) => p.dataUrl).length}/${receptionPhotos(rec).length}</strong><small>Cargadas</small></div>
          <div class="metric"><span>Daños</span><strong>${rec.damages.length}</strong><small>Registrados</small></div>
        </div>`;
    }
    setEmployeeWizardStep("finalizar");
    return true;
  }
  if (action === "save-reception") {
    saveReception();
    return true;
  }
  if (action === "add-inventory") {
    const name = prompt("Nombre del inventario");
    if (!name) return true;
    AM_SIMPLE_STORE.mutate((current) => {
      const rec = AM_SIMPLE_STORE.selected(current);
      if (!rec) return;
      const next = AM_SIMPLE_STORE.next(current, "inventory");
      rec.inventory.push({ id: `inv-${next}`, name, present: true, note: "" });
    });
    renderEmployee();
    return true;
  }
  if (action === "add-damage") {
    const area = qs("[name='damageArea']")?.value || "Área no especificada";
    const detail = qs("[name='damageDetail']")?.value || "Detalle pendiente";
    AM_SIMPLE_STORE.mutate((current) => {
      const rec = AM_SIMPLE_STORE.selected(current);
      if (!rec) return;
      const next = AM_SIMPLE_STORE.next(current, "damage");
      rec.damages.push({ id: `dam-${next}`, área, detail, photos: [{ label: `Daño ${área}`, dataUrl: "", note: "", color: "#b52931" }] });
    });
    renderEmployee();
    toast("Daño agregado.");
    return true;
  }
  if (action === "remove-damage") {
    AM_SIMPLE_STORE.mutate((current) => {
      const rec = AM_SIMPLE_STORE.selected(current);
      if (!rec) return;
      rec.damages = rec.damages.filter((item) => item.id !== button.dataset.id);
    });
    renderEmployee();
    return true;
  }
  if (action === "open-employee-vehicle") {
    AM_SIMPLE_STORE.mutate((current) => { current.selectedId = button.dataset.id; });
    renderEmployee();
    showSection("vehiculo");
    return true;
  }
  if (action === "employee-save-work") {
    AM_SIMPLE_STORE.mutate((current) => {
      const rec = AM_SIMPLE_STORE.selected(current);
      if (!rec) return;
      const status = qs('[data-employee-work="status"]')?.value || rec.status;
      const progress = Number(qs('[data-employee-work="progress"]')?.value || rec.progress || 0);
      const details = qs('[data-employee-work="processDetails"]')?.value || "";
      const note = qs('[data-employee-work="internalNote"]')?.value || "";
      rec.status = status;
      rec.pendingTracking = {
        status: "pending",
        employeeName: rec.employeeName || "EMPLEADO",
        submittedAt: new Date().toISOString(),
        state: status,
        progress,
        processDetails: details,
        images: []
      };
      rec.internalWork = { ...(rec.internalWork || {}), internalNote: note };
    });
    renderEmployee();
    toast("Cambios guardados.");
    return true;
  }
  if (action === "employee-mark-finished") {
    AM_SIMPLE_STORE.mutate((current) => {
      const rec = AM_SIMPLE_STORE.selected(current);
      if (!rec) return;
      rec.status = "FINALIZADO";
      rec.pendingTracking = {
        ...(rec.pendingTracking || {}),
        status: "pending",
        employeeName: rec.employeeName || "EMPLEADO",
        submittedAt: new Date().toISOString(),
        state: "FINALIZADO",
        progress: 100,
        processDetails: rec.pendingTracking?.processDetails || rec.tracking?.processDetails || "",
        images: rec.pendingTracking?.images || []
      };
    });
    renderEmployee();
    showSection("finalizados");
    toast("Vehículo marcado como finalizado.");
    return true;
  }
  return false;
}

function copyText(text) {
  if (!text) return;
  navigator.clipboard?.writeText(text);
  toast("Link copiado al portapapeles.");
}

function enableSpanishSpellcheck(root = document) {
  root.querySelectorAll?.("input:not([type='number']):not([type='date']):not([type='time']):not([type='range']):not([type='file']), textarea").forEach((field) => {
    field.setAttribute("spellcheck", "true");
    field.setAttribute("lang", "es");
  });
}

function initBackupViewer() {
  const drop = qs("[data-backup-viewer-drop]");
  const input = qs("[data-backup-viewer-input]");
  if (!drop && !input) return;
  if (drop && !drop.dataset.ready) {
    drop.dataset.ready = "1";
    ["dragenter", "dragover"].forEach((type) => {
      drop.addEventListener(type, (event) => {
        event.preventDefault();
        drop.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      drop.addEventListener(type, () => drop.classList.remove("dragover"));
    });
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      previewBackupFile(event.dataTransfer?.files?.[0]).catch((error) => {
        console.error(error);
        toast(error.message || "No se pudo abrir el expediente temporal.", "danger");
      });
    });
    drop.addEventListener("click", () => input?.click());
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  handleActions();
  initActionMenus();
  initBackupViewer();
  const page = document.body.dataset.page;
  if (page === "admin") compactLocalArchiveStores();
  if ((page === "admin" || page === "employee") && !requireLocalAccess(page)) return;
  if (page === "notificador" && !requireLocalAccess("admin")) return;
  let publicCloudLoaded = true;
  if (["client", "tracking"].includes(page)) {
    publicCloudLoaded = !!(await loadPublicCloudReliably());
  } else if (globalThis.AM_CLOUD_SYNC?.isReady?.() && ["admin", "notificador"].includes(page)) {
    try {
      await AM_CLOUD_SYNC.ready();
      if (page === "admin") cloudLog("Datos cargados desde nube.", "ok");
    } catch (error) {
      if (page === "admin") cloudLog(`No se pudo cargar nube: ${error.message || error}`, "danger");
      else toast(`No se pudo cargar nube: ${error.message || error}`, "danger");
    }
  }
  renderNav();
  renderTabs();
  if (page === "admin") {
    resetAdminInitialViewToDashboard();
    applyAdminHashRoute();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const startup = qs("[data-admin-startup]");
      if (!startup) return;
      startup.classList.add("is-complete");
      startup.addEventListener("transitionend", () => startup.remove(), { once: true });
      setTimeout(() => startup.remove(), 800);
    }));
  }
  if (page === "employee") renderEmployee();
  if (page === "client") publicCloudLoaded ? renderClient() : renderPublicCloudFailure(page);
  if (page === "tracking") publicCloudLoaded ? renderTracking() : renderPublicCloudFailure(page);
  if (page === "notificador") {
    history.replaceState({ notifierMode: "choice" }, "", location.pathname + location.search);
    setNotifierMode("choice", false);
  }
  enableSpanishSpellcheck();
  if (page === "admin") {
    setInterval(refreshAdminDeadlineBadges, 1000);
  }
});

document.addEventListener("input", (event) => {
  if (event.target?.matches?.('[data-fuel-level]')) updateFuelGaugeVisual(event.target);
});

document.addEventListener("pointerdown", (event) => {
  if (event.target?.matches?.('[data-fuel-level]')) updateFuelGaugeVisual(event.target);
});

document.addEventListener("focusin", (event) => {
  if (event.target.matches?.("input, textarea")) enableSpanishSpellcheck(document);
});

window.addEventListener("pageshow", (event) => {
  if (document.body.dataset.page !== "client") return;
  if (event.persisted) renderClient();
});

window.addEventListener("hashchange", () => {
  if (document.body.dataset.page !== "admin") return;
  applyAdminHashRoute();
});

window.addEventListener("popstate", (event) => {
  if (document.body.dataset.page !== "notificador") return;
  setNotifierMode(event.state?.notifierMode || "choice", false);
});

window.addEventListener("popstate", () => {
  if (qs("[data-mobile-card-viewer]")) {
    closeMobileCardBackViewer();
    return;
  }
  if (document.body.dataset.page === "admin") {
    applyAdminHashRoute();
  }
  if (document.body.dataset.page === "client") {
    renderClient();
  }
  if (hasOpenActionMenu()) closeActionMenus();
});






// V4.13 — recarga manual visible en el dashboard (útil en PWA instalada).
document.addEventListener("click", (event) => {
  const button = event.target.closest?.('[data-action="reload-app"]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  forceReloadApplication(button);
}, true);
