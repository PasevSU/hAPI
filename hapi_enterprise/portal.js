"use strict";
/* hAPI Enterprise — Evidence Portal client.
 * Served at /p/{slug}. Talks to the Phase 7 evidence API using a
 * bearer credential (role-bearing, HMAC-signed, per-case scoped).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------
  // i18n
  // ---------------------------------------------------------------------
  const I18N = {
    bg: {
      lang: 'Език', logout: 'Изход',
      role: { judge: 'Съдия', prosecutor: 'Прокурор', clerk: 'Деловодител', investigator: 'Разследващ', expert: 'Вещо лице', public: 'Публичен' },
      vis: { public: 'Публичен', private: 'Ограничен' },
      loginLabel: 'Съдебен идентификатор (credential)',
      loginPlaceholder: 'Поставете издадения credential тук…',
      loginBtn: 'Влизане',
      loginInvalid: 'Невалиден или изтекъл credential.',
      loginMissing: 'Порталът не е намерен.',
      metaVisibility: 'Видимост', metaFiles: 'Документи', metaCreated: 'Създаден',
      legal: 'Този портал предоставя доказателства с проверяема криптографска цялост. Всеки запис носи SHA-256/SHA-512 отпечатъци и подписана разписка (HMAC-SHA256) в неизменим регистър с верига на попечителство. Промяна дори на един байт се открива при проверка.',
      tabCases: 'Доказателства', tabUpload: 'Качване',
      filterPlaceholder: 'Търсене по име, дело или отпечатък…', allCases: 'Всички дела',
      summary: 'Доказателства: {n}', empty: 'Няма налични доказателства за тази роля.',
      back: 'Назад',
      kvCase: 'Дело', kvClassification: 'Класификация', kvUploadedBy: 'Качено от', kvUploadedAt: 'Качено на', kvSize: 'Размер', kvTags: 'Етикети', kvFileId: 'Идентификатор',
      integrity: 'Цялост', integrityOk: 'Потвърдена', integrityBad: 'Нарушена',
      verify: 'Провери цялостта', verifyValid: 'Цялостта е потвърдена — файлът не е променян.', verifyInvalid: 'Цялостта е нарушена.',
      chain: 'Верига на попечителство', chainOk: 'Регистърът е непокътнат.', chainBad: 'Регистърът е нарушен!',
      evtUpload: 'Качване', evtVerify: 'Проверка на цялостта',
      download: 'Изтегли', package: 'Доклад (JSON)',
      uploadTitle: 'Качване на доказателство',
      dropzone: 'Плъзнете файл тук или щракнете за избор',
      chosen: 'Избран файл: {name} ({size})',
      uploadCaseLabel: 'Номер на дело', uploadClassificationLabel: 'Класификация', uploadTagsLabel: 'Етикети (по избор)',
      uploadTagsPlaceholder: 'напр. снимка, протокол, експертиза',
      uploadBtn: 'Качване', hashing: 'Изчисляване на SHA-256 / SHA-512…',
      uploadSuccess: 'Доказателството е прието и подписано.', uploadFail: 'Качването не бе успешно.', uploadNoRole: 'Ролята ви няма право да качва доказателства.',
      receiptTitle: 'Разписка (receipt)',
      toastErr: 'Възникна грешка.', requiredCase: 'Въведете номер на дело.', noFile: 'Изберете файл.'
    },
    de: {
      lang: 'Sprache', logout: 'Abmelden',
      role: { judge: 'Richter', prosecutor: 'Staatsanwalt', clerk: 'Geschäftsstelle', investigator: 'Ermittler', expert: 'Sachverständiger', public: 'Öffentlich' },
      vis: { public: 'Öffentlich', private: 'Eingeschränkt' },
      loginLabel: 'Justiz-Ausweis (credential)',
      loginPlaceholder: 'Ausgestellten Credential hier einfügen…',
      loginBtn: 'Anmelden',
      loginInvalid: 'Ungültiger oder abgelaufener Credential.',
      loginMissing: 'Portal nicht gefunden.',
      metaVisibility: 'Sichtbarkeit', metaFiles: 'Dokumente', metaCreated: 'Erstellt',
      legal: 'Dieses Portal stellt Beweismittel mit überprüfbarer kryptografischer Integrität bereit. Jeder Eintrag trägt SHA-256/SHA-512-Hashes und eine signierte Quittung (HMAC-SHA256) in einem unveränderlichen Register mit Beweiskette. Jede Veränderung, selbst ein einzelnes Byte, wird bei der Prüfung erkannt.',
      tabCases: 'Beweismittel', tabUpload: 'Hochladen',
      filterPlaceholder: 'Nach Name, Akte oder Hash suchen…', allCases: 'Alle Akten',
      summary: 'Beweismittel: {n}', empty: 'Keine Beweismittel für diese Rolle verfügbar.',
      back: 'Zurück',
      kvCase: 'Akte', kvClassification: 'Einstufung', kvUploadedBy: 'Hochgeladen von', kvUploadedAt: 'Hochgeladen am', kvSize: 'Größe', kvTags: 'Tags', kvFileId: 'Kennung',
      integrity: 'Integrität', integrityOk: 'Bestätigt', integrityBad: 'Verletzt',
      verify: 'Integrität prüfen', verifyValid: 'Integrität bestätigt — Datei unverändert.', verifyInvalid: 'Integrität verletzt.',
      chain: 'Beweiskette', chainOk: 'Register unversehrt.', chainBad: 'Register verletzt!',
      evtUpload: 'Hochladen', evtVerify: 'Integritätsprüfung',
      download: 'Herunterladen', package: 'Bericht (JSON)',
      uploadTitle: 'Beweismittel hochladen',
      dropzone: 'Datei hierher ziehen oder klicken zum Auswählen',
      chosen: 'Ausgewählt: {name} ({size})',
      uploadCaseLabel: 'Aktenzeichen', uploadClassificationLabel: 'Einstufung', uploadTagsLabel: 'Tags (optional)',
      uploadTagsPlaceholder: 'z. B. Foto, Protokoll, Gutachten',
      uploadBtn: 'Hochladen', hashing: 'Berechne SHA-256 / SHA-512…',
      uploadSuccess: 'Beweismittel angenommen und signiert.', uploadFail: 'Hochladen fehlgeschlagen.', uploadNoRole: 'Ihre Rolle darf keine Beweismittel hochladen.',
      receiptTitle: 'Quittung (receipt)',
      toastErr: 'Ein Fehler ist aufgetreten.', requiredCase: 'Aktenzeichen eingeben.', noFile: 'Datei auswählen.'
    },
    en: {
      lang: 'Language', logout: 'Sign out',
      role: { judge: 'Judge', prosecutor: 'Prosecutor', clerk: 'Clerk', investigator: 'Investigator', expert: 'Expert', public: 'Public' },
      vis: { public: 'Public', private: 'Restricted' },
      loginLabel: 'Judicial credential',
      loginPlaceholder: 'Paste the issued credential here…',
      loginBtn: 'Sign in',
      loginInvalid: 'Invalid or expired credential.',
      loginMissing: 'Portal not found.',
      metaVisibility: 'Visibility', metaFiles: 'Documents', metaCreated: 'Created',
      legal: 'This portal serves evidence with verifiable cryptographic integrity. Every record carries SHA-256/SHA-512 fingerprints and a signed receipt (HMAC-SHA256) in an immutable, custody-chained register. Any change — even a single byte — is detected on verification.',
      tabCases: 'Evidence', tabUpload: 'Upload',
      filterPlaceholder: 'Search by name, case or hash…', allCases: 'All cases',
      summary: 'Evidence: {n}', empty: 'No evidence available for this role.',
      back: 'Back',
      kvCase: 'Case', kvClassification: 'Classification', kvUploadedBy: 'Uploaded by', kvUploadedAt: 'Uploaded at', kvSize: 'Size', kvTags: 'Tags', kvFileId: 'Identifier',
      integrity: 'Integrity', integrityOk: 'Verified', integrityBad: 'Compromised',
      verify: 'Verify integrity', verifyValid: 'Integrity verified — file unchanged.', verifyInvalid: 'Integrity compromised.',
      chain: 'Chain of custody', chainOk: 'Register intact.', chainBad: 'Register compromised!',
      evtUpload: 'Upload', evtVerify: 'Integrity check',
      download: 'Download', package: 'Report (JSON)',
      uploadTitle: 'Upload evidence',
      dropzone: 'Drag a file here or click to select',
      chosen: 'Selected: {name} ({size})',
      uploadCaseLabel: 'Case ID', uploadClassificationLabel: 'Classification', uploadTagsLabel: 'Tags (optional)',
      uploadTagsPlaceholder: 'e.g. photo, protocol, report',
      uploadBtn: 'Upload', hashing: 'Computing SHA-256 / SHA-512…',
      uploadSuccess: 'Evidence accepted and signed.', uploadFail: 'Upload failed.', uploadNoRole: 'Your role cannot upload evidence.',
      receiptTitle: 'Receipt',
      toastErr: 'An error occurred.', requiredCase: 'Enter a case ID.', noFile: 'Select a file.'
    }
  };

  function detectLang() {
    const saved = localStorage.getItem('portal.lang');
    if (saved && I18N[saved]) return saved;
    const nav = (navigator.language || 'bg').slice(0, 2).toLowerCase();
    return I18N[nav] ? nav : 'bg';
  }
  let lang = detectLang();
  const t = (k, vars) => {
    let s = (I18N[lang] && I18N[lang][k]) || I18N.en[k] || k;
    if (vars) for (const key in vars) s = s.replace('{' + key + '}', vars[key]);
    return s;
  };
  const roleName = (r) => (I18N[lang].role && I18N[lang].role[r]) || r;

  // ---------------------------------------------------------------------
  // Routing / auth helpers
  // ---------------------------------------------------------------------
  const segments = location.pathname.split('/').filter(Boolean); // ['p', slug]
  const slug = decodeURIComponent((segments[1] || '').trim());
  const base = '/api/v1/p/' + encodeURIComponent(slug);
  const STORE_KEY = 'portal.credential.' + slug;

  let credential = sessionStorage.getItem(STORE_KEY) || new URL(location.href).searchParams.get('portal_credential') || '';
  let payload = decodePayload(credential);

  const UPLOAD_ROLES = ['prosecutor', 'clerk', 'investigator', 'expert'];
  const CHAIN_ROLES = ['judge', 'prosecutor'];
  const CLASSIFICATIONS = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'SECRET', 'EVIDENCE'];

  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return atob(s);
  }
  function decodePayload(token) {
    if (!token) return null;
    const i = token.lastIndexOf('.');
    if (i <= 0) return null;
    try {
      const o = JSON.parse(b64urlDecode(token.slice(0, i)));
      return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    } catch { return null; }
  }
  function formatBytes(n) {
    if (!Number.isFinite(n)) return '—';
    const u = ['B', 'KB', 'MB', 'GB'], i = n === 0 ? 0 : Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? (iso || '—') : d.toLocaleString(lang === 'bg' ? 'bg-BG' : lang === 'de' ? 'de-DE' : 'en-GB');
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  async function digestHex(buf, alg) {
    const h = await crypto.subtle.digest(alg, buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------
  async function api(path, opts = {}) {
    const headers = Object.assign({}, opts.headers);
    if (credential) headers.Authorization = 'Bearer ' + credential;
    const res = await fetch(base + path, Object.assign({}, opts, { headers, referrerPolicy: 'no-referrer' }));
    if (res.status === 401) { clearCredential(); return res; }
    return res;
  }
  async function apiJson(path, opts) {
    const res = await api(path, opts);
    if (!res.ok) throw new Error(res.status === 401 ? t('loginInvalid') : 'HTTP ' + res.status);
    return res.json();
  }

  function clearCredential() {
    credential = ''; payload = null;
    sessionStorage.removeItem(STORE_KEY);
  }

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg, kind) {
    const el = $('toast');
    el.textContent = msg;
    el.className = kind || '';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  // ---------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------
  const VIEWS = ['landing', 'dashboard', 'details', 'upload'];
  let activeView = 'landing';
  function showView(name) {
    activeView = name;
    VIEWS.forEach((v) => { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    window.scrollTo(0, 0);
  }

  function applyBranding(portal) {
    const b = portal.branding || {};
    const accent = b.accentColor;
    if (/^#[0-9a-fA-F]{6}$/.test(accent || '')) {
      document.documentElement.style.setProperty('--accent', accent);
    }
    const logo = b.logoUrl || '';
    const showLogo = (id, el) => { const n = $(id); if (logo) { n.src = logo; n.hidden = false; el.hidden = false; } else { n.hidden = true; el.hidden = true; } };
    showLogo('brand-logo', $('brand-logo'));
    showLogo('landing-logo', $('landing-logo'));
  }

  // ---------------------------------------------------------------------
  // Landing + portal metadata
  // ---------------------------------------------------------------------
  async function loadPortal() {
    const res = await fetch(base, { referrerPolicy: 'no-referrer' });
    if (!res.ok) { throw new Error(t('loginMissing')); }
    const portal = await res.json();
    document.title = portal.title || 'Evidence Portal';
    $('brand-title').textContent = portal.title || '';
    $('brand-sub').textContent = portal.slug || '';
    $('landing-title').textContent = portal.title || '';
    $('landing-desc').textContent = portal.description || '';
    $('landing-legal').textContent = t('legal');
    applyBranding(portal);

    const meta = $('landing-meta');
    meta.innerHTML = '';
    [[t('metaVisibility'), t('vis')[portal.visibility] || portal.visibility], [t('metaFiles'), portal.fileCount], [t('metaCreated'), formatDate(portal.createdAt)]].forEach(([k, v]) => {
      meta.insertAdjacentHTML('beforeend', '<div class="m"><span class="k">' + escapeHtml(k) + '</span><span class="v">' + escapeHtml(v) + '</span></div>');
    });
    return portal;
  }

  function renderAuthChrome() {
    const has = !!payload;
    $('topbar').hidden = false;
    $('session').hidden = !has;
    if (has) {
      $('role-badge').textContent = roleName(payload.role);
      $('session-subject').textContent = payload.sub || '';
      $('session-subject').title = payload.sub || '';
      $('logout').textContent = t('logout');
      const exp = payload.exp ? new Date(payload.exp * 1000) : null;
      if (exp) $('session-subject').title += ' · ' + t('kvUploadedAt') + ' ' + formatDate(exp.toISOString());
    }
  }

  // ---------------------------------------------------------------------
  // Dashboard / evidence list
  // ---------------------------------------------------------------------
  async function loadEvidence() {
    const data = await apiJson('/evidence');
    const rows = data.evidence || [];
    renderCaseFilter(rows);
    renderEvidence(rows);
    $('tab-upload').hidden = !UPLOAD_ROLES.includes(payload.role);
    showView('dashboard');
  }

  function renderCaseFilter(rows) {
    const cases = [...new Set(rows.map((r) => r.caseId).filter(Boolean))].sort();
    const sel = $('case-filter');
    const prev = sel.value;
    sel.innerHTML = '<option value="">' + escapeHtml(t('allCases')) + '</option>' +
      cases.map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join('');
    sel.value = prev || '';
  }

  function integrityBadge(valid) {
    return valid
      ? '<span class="integrity ok">✓ ' + escapeHtml(t('integrityOk')) + '</span>'
      : '<span class="integrity bad">✕ ' + escapeHtml(t('integrityBad')) + '</span>';
  }

  function renderEvidence(rows) {
    const filter = $('filter').value.toLowerCase();
    const caseSel = $('case-filter').value;
    let list = rows.filter((r) => caseSel === '' || r.caseId === caseSel);
    if (filter) list = list.filter((r) => (r.name + ' ' + r.caseId + ' ' + r.sha256 + ' ' + r.sha512).toLowerCase().includes(filter));
    $('summary').textContent = t('summary', { n: list.length });
    $('empty').hidden = list.length > 0;
    const ul = $('evidence-list');
    ul.innerHTML = '';
    list.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'evidence-item';
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const cls = escapeHtml(r.classification || 'EVIDENCE');
      li.innerHTML =
        '<span class="icon" aria-hidden="true">🗂️</span>' +
        '<span class="body"><span class="name">' + escapeHtml(r.name) + '</span>' +
        '<span class="meta">' + escapeHtml(r.caseId || '—') + ' · ' + escapeHtml(formatBytes(r.size)) + ' · ' + escapeHtml(formatDate(r.uploadedAt)) + '</span></span>' +
        '<span class="class-badge class-' + cls + '">' + cls + '</span>';
      li.addEventListener('click', () => openDetail(r.fileId));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.fileId); } });
      ul.append(li);
    });
  }

  // ---------------------------------------------------------------------
  // Detail + chain of custody + verify
  // ---------------------------------------------------------------------
  async function openDetail(fileId) {
    showView('details');
    const el = $('details');
    el.innerHTML = '<p class="empty">…</p>';
    try {
      const { evidence: r } = await apiJson('/evidence/' + encodeURIComponent(fileId));
      const cls = escapeHtml(r.classification || 'EVIDENCE');
      const kv = (k, v) => '<div class="kv"><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd></div>';
      let html = '<div class="card"><h2>' + escapeHtml(r.name) + '</h2>' +
        '<span class="class-badge class-' + cls + '">' + cls + '</span>' +
        kv(t('kvCase'), r.caseId) + kv(t('kvFileId'), r.fileId) +
        kv(t('kvUploadedBy'), r.uploadedBy) + kv(t('kvUploadedAt'), formatDate(r.uploadedAt)) +
        kv(t('kvSize'), formatBytes(r.size)) + kv(t('kvTags'), (r.tags || []).join(', ') || '—') +
        kv('SHA-256', r.sha256) + kv('SHA-512', r.sha512) +
        '<div class="actions"><button class="btn" id="btn-verify">' + escapeHtml(t('verify')) + '</button>' +
        '<button class="btn secondary" id="btn-download">' + escapeHtml(t('download')) + '</button>' +
        '<button class="btn ghost" id="btn-package">' + escapeHtml(t('package')) + '</button></div>' +
        '<div id="verify-out" hidden></div></div>';

      const canChain = CHAIN_ROLES.includes(payload.role);
      html += '<div class="card" id="chain-card"><h2>' + escapeHtml(t('chain')) + '</h2><div id="chain-body"><p class="empty">…</p></div></div>';
      el.innerHTML = html;

      $('btn-verify').addEventListener('click', () => runVerify(fileId));
      $('btn-download').addEventListener('click', () => download(fileId, r.name));
      $('btn-package').addEventListener('click', () => packageJson(fileId));
      if (!canChain) { $('chain-card').hidden = true; }

      await Promise.all([runVerify(fileId, { quiet: true }), canChain ? loadChain(fileId) : Promise.resolve()]);
    } catch (e) { el.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>'; }
  }

  async function runVerify(fileId, opts = {}) {
    const out = $('verify-out');
    if (!opts.quiet) { out.hidden = false; out.innerHTML = '<p class="empty">…</p>'; }
    try {
      const v = await apiJson('/evidence/' + encodeURIComponent(fileId) + '/verify');
      out.hidden = false;
      out.innerHTML = '<div class="verify-result ' + (v.valid ? 'ok' : 'bad') + '">' +
        (v.valid ? '✓ ' + t('verifyValid') : '✕ ' + t('verifyInvalid') + (v.reason ? ' (' + escapeHtml(v.reason) + ')' : '')) + '</div>';
      if (!opts.quiet) toast(v.valid ? t('verifyValid') : t('verifyInvalid'), v.valid ? 'ok' : 'err');
    } catch (e) { out.hidden = false; out.innerHTML = '<div class="verify-result bad">' + escapeHtml(e.message) + '</div>'; }
  }

  async function loadChain(fileId) {
    const body = $('chain-body');
    try {
      const c = await apiJson('/evidence/' + encodeURIComponent(fileId) + '/chain');
      const events = c.events || [];
      const integ = c.integrity;
      let html = integBadge(integ && integ.valid) + '<ul class="timeline">';
      if (!events.length) html += '<li>' + escapeHtml(t('empty')) + '</li>';
      events.forEach((e) => {
        const evtName = e.event === 'evidence.upload' ? t('evtUpload') : e.event === 'evidence.verify' ? t('evtVerify') : e.event;
        const d = e.details || {};
        const bits = [];
        if (d.name) bits.push(d.name);
        if (e.event === 'evidence.verify') bits.push(d.valid ? t('integrityOk') : t('integrityBad'));
        if (d.sha256) bits.push('SHA-256 ' + d.sha256.slice(0, 12) + '…');
        html += '<li><div class="evt">' + escapeHtml(evtName) + '</div>' +
          '<div class="meta">' + escapeHtml(formatDate(e.at)) + (bits.length ? ' · ' + escapeHtml(bits.join(' · ')) : '') + '</div>' +
          '<div class="hash">' + escapeHtml((e.hash || '').slice(0, 16)) + '</div></li>';
      });
      html += '</ul>';
      body.innerHTML = html;
    } catch (e) { body.innerHTML = '<p class="error">' + escapeHtml(e.message) + '</p>'; }
  }

  async function download(fileId, name) {
    try {
      const res = await api('/evidence/' + encodeURIComponent(fileId) + '/download');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url; link.download = name || fileId;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { toast(t('toastErr') + ' ' + e.message, 'err'); }
  }

  async function packageJson(fileId) {
    try {
      const data = await apiJson('/evidence/' + encodeURIComponent(fileId) + '/package');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url; link.download = 'evidence-' + fileId.slice(0, 8) + '.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { toast(t('toastErr') + ' ' + e.message, 'err'); }
  }

  // ---------------------------------------------------------------------
  // Upload (role-gated, client-side hashing)
  // ---------------------------------------------------------------------
  let selectedFile = null;

  function bindUpload() {
    const dz = $('dropzone'), input = $('file-input');
    dz.addEventListener('click', () => input.click());
    dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { if (input.files[0]) setFile(input.files[0]); });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
  }

  function setFile(f) {
    selectedFile = f;
    $('file-chosen').hidden = false;
    $('file-chosen').textContent = t('chosen', { name: f.name, size: formatBytes(f.size) });
    $('client-hash').hidden = false;
    $('client-hash').textContent = t('hashing');
    f.arrayBuffer().then(async (buf) => {
      const [s256, s512] = await Promise.all([digestHex(buf, 'SHA-256'), digestHex(buf, 'SHA-512')]);
      $('client-hash').innerHTML =
        '<span class="hash-line"><span class="k">SHA-256</span>' + escapeHtml(s256) + '</span>' +
        '<span class="hash-line"><span class="k">SHA-512</span>' + escapeHtml(s512) + '</span>';
    }).catch(() => { $('client-hash').textContent = ''; });
  }

  async function submitUpload(e) {
    e.preventDefault();
    if (!selectedFile) { toast(t('noFile'), 'err'); return; }
    const caseId = $('upload-case').value.trim();
    if (!caseId) { toast(t('requiredCase'), 'err'); return; }
    const btn = $('upload-btn'), status = $('upload-status');
    btn.disabled = true; status.textContent = t('hashing');
    try {
      const buf = await selectedFile.arrayBuffer();
      const tags = $('upload-tags').value.split(',').map((s) => encodeURIComponent(s.trim())).filter(Boolean).join(',');
      const res = await api('/evidence', {
        method: 'POST',
        headers: {
          'X-File-Name': encodeURIComponent(selectedFile.name),
          'X-Case-Id': encodeURIComponent(caseId),
          'X-Classification': $('upload-classification').value,
          'X-Tags': tags
        },
        body: buf
      });
      if (!res.ok) {
        let msg = 'HTTP ' + res.status;
        try { const e = await res.json(); if (e && e.error) msg = e.error; } catch {}
        throw new Error(msg);
      }
      const { receipt } = await res.json();
      status.textContent = '';
      renderReceipt(receipt);
      toast(t('uploadSuccess'), 'ok');
      $('upload-form').reset(); selectedFile = null;
      $('file-chosen').hidden = true; $('client-hash').hidden = true; $('receipt').hidden = false;
    } catch (err) { status.textContent = ''; toast(t('uploadFail') + ' (' + err.message + ')', 'err'); }
    finally { btn.disabled = false; }
  }

  function renderReceipt(r) {
    const el = $('receipt');
    const kv = (k, v) => '<div class="kv"><dt>' + escapeHtml(k) + '</dt><dd>' + escapeHtml(v) + '</dd></div>';
    el.innerHTML = '<h2>' + escapeHtml(t('receiptTitle')) + '</h2>' +
      kv(t('kvFileId'), r.fileId) + kv(t('kvCase'), r.caseId) +
      kv('SHA-256', r.sha256) + kv('SHA-512', r.sha512) +
      kv(t('kvSize'), formatBytes(r.size)) + kv(t('kvClassification'), r.classification);
    el.hidden = false;
  }

  // ---------------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------------
  function bindLogin() {
    $('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = $('credential').value.trim();
      const p = decodePayload(raw);
      if (!p || !p.role) {
        $('login-error').textContent = t('loginInvalid');
        $('login-error').hidden = false;
        return;
      }
      credential = raw; payload = p;
      sessionStorage.setItem(STORE_KEY, raw);
      $('login-error').hidden = true;
      $('credential').value = '';
      enterPortal();
    });
    $('logout').addEventListener('click', () => {
      clearCredential();
      showView('landing');
      renderAuthChrome();
      toast(t('logout'));
    });
  }

  function enterPortal() {
    renderAuthChrome();
    loadEvidence().catch((e) => toast(t('toastErr') + ' ' + e.message, 'err'));
  }

  // ---------------------------------------------------------------------
  // i18n wiring
  // ---------------------------------------------------------------------
  function bindI18n() {
    const sel = $('lang');
    ['bg', 'de', 'en'].forEach((code) => {
      const o = document.createElement('option');
      o.value = code; o.textContent = code.toUpperCase();
      sel.append(o);
    });
    sel.value = lang;
    $('lang-label').textContent = t('lang');
    sel.addEventListener('change', () => {
      lang = sel.value;
      localStorage.setItem('portal.lang', lang);
      location.reload();
    });
  }

  function applyStaticText() {
    $('login-label').textContent = t('loginLabel');
    $('credential').placeholder = t('loginPlaceholder');
    $('login-btn').textContent = t('loginBtn');
    $('tab-dashboard').textContent = t('tabCases');
    $('tab-upload').textContent = t('tabUpload');
    $('filter').placeholder = t('filterPlaceholder');
    $('case-filter').setAttribute('aria-label', t('allCases'));
    $('back').textContent = '← ' + t('back');
    $('upload-title').textContent = t('uploadTitle');
    $('dropzone-text').textContent = t('dropzone');
    $('dropzone').setAttribute('aria-label', t('dropzone'));
    $('upload-case-label').textContent = t('uploadCaseLabel');
    $('upload-classification-label').textContent = t('uploadClassificationLabel');
    $('upload-tags-label').textContent = t('uploadTagsLabel');
    $('upload-tags').placeholder = t('uploadTagsPlaceholder');
    $('upload-btn').textContent = t('uploadBtn');
    const cls = $('upload-classification');
    cls.innerHTML = CLASSIFICATIONS.map((c) => '<option value="' + c + '">' + c + '</option>').join('');
    cls.value = 'EVIDENCE';
  }

  // ---------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------
  function bindGlobal() {
    $('back').addEventListener('click', () => { if (payload) showView('dashboard'); });
    $('filter').addEventListener('input', () => renderEvidence(cachedRows));
    $('case-filter').addEventListener('change', () => renderEvidence(cachedRows));
    document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.view === 'upload' && UPLOAD_ROLES.includes(payload.role)) showView('upload');
      else if (b.dataset.view === 'dashboard') showView('dashboard');
    }));
  }

  let cachedRows = [];
  const _origRender = renderEvidence;
  renderEvidence = (rows) => { cachedRows = rows; _origRender(rows); };

  async function boot() {
    bindI18n();
    applyStaticText();
    bindGlobal();
    bindLogin();
    bindUpload();

    if (!slug) {
      $('landing-title').textContent = t('loginMissing');
      $('landing-desc').textContent = '';
      $('login-form').hidden = true;
      showView('landing');
      $('topbar').hidden = true;
      return;
    }

    try {
      await loadPortal();
      if (payload && payload.role) enterPortal();
      else { renderAuthChrome(); showView('landing'); }
    } catch (e) {
      $('landing-title').textContent = t('loginMissing');
      $('landing-desc').textContent = e.message;
      $('login-form').hidden = true;
      $('topbar').hidden = true;
      showView('landing');
    }
  }

  boot();
})();
