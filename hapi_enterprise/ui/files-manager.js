'use strict';
// Портали & файлове (единен модул, план 17 + API-01/02).
//
// Модел: порталът и файловете му са едно цяло.
//   1. Портали (таблица) → щракване отваря КОНТРОЛЕН ПАНЕЛ ПОД ПОРТАЛА:
//      настройки + API/QR (генерират се при създаване) + списък с файлове.
//   2. Файл (ред) → щракване отваря КОНТРОЛЕН ПАНЕЛ ПОД ФАЙЛА: 11 действия,
//      версии, метаданни, преименуване, достъп, споделяне/QR, изтриване.
//
// Режими:
//   • свързан (http/https → add-on/GUI през Ingress) — реални административни endpoints;
//   • демо (file://) — пълна функционалност в интерфейса, ясно надписана като демо.
(function () {
  // Иконите са вградени SVG (ui/icons.js) — един набор, еднакъв на всяка система,
  // оцветен с текущия цвят. `ICON` държи готовия markup, за да може да се вгражда
  // директно в шаблоните (${ICON.size}); действията пазят ИМЕ и се рисуват с ico().
  const ico = (name, extra) =>
    typeof window !== 'undefined' && window.HapiIcons ? window.HapiIcons.ico(name, extra) : '';
  const ACTIONS = [
    { id: 'preview', label: 'Преглед', icon: 'preview' },
    { id: 'download', label: 'Изтегли', icon: 'download' },
    { id: 'versions', label: 'Версии', icon: 'versions' },
    { id: 'metadata', label: 'Метаданни', icon: 'metadata' },
    { id: 'rename', label: 'Преименувай', icon: 'rename' },
    { id: 'access', label: 'Достъп', icon: 'access' },
    { id: 'share', label: 'Сподели / QR', icon: 'share' },
    { id: 'signedUrl', label: 'Подписан URL', icon: 'access' },
    { id: 'receipt', label: 'Разписка', icon: 'package' },
    { id: 'verifyReceipt', label: 'Провери разписка', icon: 'lock' },
    { id: 'delete', label: 'Изтрий', icon: 'delete' },
    { id: 'encrypt', label: 'Шифровай', icon: 'encrypt', info: 'Шифроването се избира при качване.' },
    { id: 'package', label: 'Пакет (ZIP)', icon: 'package' },
    { id: 'note', label: 'Бележка', icon: 'note' },
  ];
  // Допълнителни действия извън плана 17 §3.1: заключване на файла (икона lock в таблицата).
  const EXTRA_ACTIONS = [{ id: 'lock', label: 'Заключи / отключи', icon: 'lock' }];

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => window.HapiUI && window.HapiUI.toast(m, k);
  const fmtSize = (n) => {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
    if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
    return `${(v / 1073741824).toFixed(2)} GB`;
  };
  const fmtDate = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : '—');
  // „1 файл / 2 файла“ — броячите в експлорера на папките.
  const plural = (n, one, many) => `${Number(n) || 0} ${Number(n) === 1 ? one : many}`;
  // Детерминирани дати за демо данните (за да има сортиране по дата).
  const demoDate = (i, hour) => new Date(Date.UTC(2026, 9, 20 - i * 3, hour || 9, 15, 0)).toISOString();
  // Детерминиран демо SHA-256 (само за илюстрация на иконата за хеш).
  const demoHash = (i, j) => {
    let h = '';
    for (let k = 0; k < 64; k += 1) h += '0123456789abcdef'[(i * 7 + j * 13 + k * 5) % 16];
    return h;
  };

  // ── Икони за метаданните ────────────────────────────────────────────────
  // Вместо дълъг текст в таблицата: икона + кратка стойност, пълната е в title.
  // Един набор от емоджи-икони за ЦЕЛИЯ интерфейс — един и същ смисъл = една и съща икона.
  // Готов markup за вграждане в шаблоните (${ICON.size}). Изчислява се при ДОСТЪП,
  // за да е наличен спрайтът дори ако файловете се заредят в друг ред (или в тест без DOM).
  const ICON = {
    get id() {
      return ico('id');
    },
    get created() {
      return ico('calendar');
    },
    get uploaded() {
      return ico('uploadArrow');
    },
    get modified() {
      return ico('rename');
    },
    get hash() {
      return ico('hash');
    },
    get locked() {
      return ico('lock');
    },
    get unlocked() {
      return ico('unlock');
    },
    get eye() {
      return ico('eye');
    },
    get eyeOff() {
      return ico('eyeOff');
    },
    get topic() {
      return ico('note');
    },
    get size() {
      return ico('size');
    },
    get version() {
      return ico('versions');
    },
    get folder() {
      return ico('folder');
    },
    get copy() {
      return ico('copy');
    },
    get open() {
      return ico('openWindow');
    },
    get download() {
      return ico('download');
    },
    get refresh() {
      return ico('refresh');
    },
    get upload() {
      return ico('attachFile');
    },
    get filters() {
      return ico('filter');
    },
    get phone() {
      return ico('phone');
    },
    get mail() {
      return ico('mail');
    },
    get remove() {
      return ico('delete');
    },
  };
  /** Икона според типа на файла — заменя чекбокса и показва, че това е файлов блок. */
  function fileGlyph(f) {
    const name = String((f && f.name) || '').toLowerCase();
    const type = String((f && f.type) || '');
    if (type === 'pdf' || name.endsWith('.pdf')) return ico('filePdf');
    if (['xlsx', 'xls', 'csv'].some((e) => name.endsWith(`.${e}`))) return ico('fileSheet');
    if (['docx', 'doc', 'odt', 'rtf'].some((e) => name.endsWith(`.${e}`))) return ico('fileDoc');
    if (['zip', '7z', 'tar', 'gz', 'rar'].some((e) => name.endsWith(`.${e}`))) return ico('fileArchive');
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].some((e) => name.endsWith(`.${e}`))) return ico('fileImage');
    if (type === 'text' || ['txt', 'md', 'json', 'xml', 'log'].some((e) => name.endsWith(`.${e}`))) return ico('fileText');
    return ico('file');
  }
  /** Една икона-плочка: икона + кратка стойност, пълна стойност в tooltip. */
  function chip(icon, label, value, shown) {
    const full = value == null || value === '' ? '—' : String(value);
    return `<span class="fm-ico" title="${esc(`${label}: ${full}`)}"><span class="fm-ico-g" aria-hidden="true">${icon}</span><span class="fm-ico-v">${esc(
      shown == null ? full : shown,
    )}</span></span>`;
  }
  /**
   * Икони за файл в реда на картата: SHA-256 · създаден · качен · промяна · id · заключване
   * (без обвивка — редът се определя от контекста). SHA-256 се съкращава до 12 знака,
   * id — до 8, за да се побират три плочки на ред.
   */
  function metaChips(f) {
    const sha = f.sha256 ? `${String(f.sha256).slice(0, 12)}…` : '—';
    const shortId8 = f.id ? String(f.id).slice(0, 8) : '—';
    return [
      chip(ICON.hash, 'SHA-256', f.sha256 || '—', sha),
      chip(ICON.created, 'Създаден', f.createdAt || '—', fmtDate(f.createdAt)),
      chip(ICON.uploaded, 'Качен', f.uploadedAt || '—', fmtDate(f.uploadedAt)),
      chip(ICON.modified, 'Последна промяна', f.modifiedAt || '—', fmtDate(f.modifiedAt)),
      chip(ICON.id, 'id на файла', f.id || '—', shortId8),
      chip(
        f.locked ? ICON.locked : ICON.unlocked,
        'Заключване',
        f.locked ? `заключен от ${f.lockedBy || 'admin'}` : 'не е заключен',
        f.locked ? 'заключен' : 'свободен',
      ),
    ].join('');
  }

  // Флагове на портала: видим маркер + цвят (не само текст).
  // Маркерите са ТЕКСТОВИ, защото се показват и в <option> на падащо меню (там SVG не се рисува).
  const FLAGS = [
    { id: 'none', label: 'без флаг', icon: '●', cls: '' },
    { id: 'info', label: 'информация', icon: 'ℹ', cls: 'warn' },
    { id: 'important', label: 'важно', icon: '★', cls: 'warn' },
    { id: 'urgent', label: 'спешно', icon: '!', cls: 'err' },
    { id: 'archive', label: 'архив', icon: '▣', cls: '' },
  ];
  const flagOf = (id) => FLAGS.find((x) => x.id === id) || FLAGS[0];

  let host = null;
  const state = {
    portals: [],
    contacts: [],
    cases: [],
    portalIndex: 0,
    openPortal: null,
    newPortal: false,
    api: {},
    selected: null,
    panel: 'actions',
    query: '',
    type: 'all',
    access: 'all',
    topic: 'all',
    category: 'all',
    sort: '-date',
    portalQuery: '',
    portalSort: '-date',
    notesOnly: false,
    selectedIds: new Set(),
    versions: null,
    issuedKey: '',
    hashes: null,
    // Експлорер на папките: дървото на storage_root за текущия портал.
    // `open` е пътят на ЕДИНСТВЕНАТА отворена папка ('' = коренът, null = всички затворени).
    // По подразбиране всичко е СВИТО — потребителят отваря само това, което му трябва.
    tree: { portalId: '', loaded: false, error: '', data: null, open: null },
    // Коментари към папки (ключът е път с водeщ „/“) и формата за нова папка.
    folderNotes: {},
    // Флагове на папките (видима / медийна / заключена) — ключът е път с водeщ „/“.
    folderMeta: {},
    // Панел с филтри (по подразбиране ИЗКЛ.) и отворено падащо меню gear (null = затворено).
    filters: false,
    gear: null,
    // Отворено падащо меню ⚙ на кой файл (id на файла; null = затворено).
    fileGear: null,
    // Блокът „Контролен панел на портала“ може да се сгъва (по подразбиране е отворен).
    controlOpen: true,
    newFolder: false,
    busy: false,
    error: '',
    lastAction: '',
    // Публичен адрес за API/QR (сървърна настройка limits.publicBaseUrl).
    publicBaseUrl: '',
    connectionLoaded: false,
  };

  // ── Данни ────────────────────────────────────────────────────────────────
  function seed() {
    const data = (window.HAPI_DATA && window.HAPI_DATA.portals) || [];
    // Контакти (директория): порталът може да сочи към съществуващ или нов контакт.
    state.contacts = ((window.HAPI_DATA && window.HAPI_DATA.contacts) || []).map((c) => normalizeContact(c));
    state.cases = ((window.HAPI_DATA && window.HAPI_DATA.cases) || []).map((c) => normalizeCase(c));
    state.portals = data.map((p, i) => ({
      id: String(p.id || p.slug || `portal-${i + 1}`),
      slug: String(p.slug || p.id || `portal-${i + 1}`),
      title: p.title || `Портал ${i + 1}`,
      visibility: p.visibility || 'private',
      description: p.description || '',
      access: p.access || (p.visibility === 'public' ? 'FREE' : 'KEY_REQUIRED'),
      storage_root: p.storage_root || '/share',
      token_policy: { ttl_hours: 168, max_uses: 10, revocable: true },
      category: p.category || ['Правни дела', 'Договори', 'Експертизи', 'Публикации'][i % 4],
      flag: p.flag || ['important', 'none', 'urgent', 'archive'][i % 4],
      subject: p.subject || ['посещение на лице', 'доставка на документи', 'експертен доклад', 'публично оповестяване'][i % 4],
      contactId: p.contactId || '',
      caseId: p.caseId || '',
      createdAt: p.createdAt || demoDate(i, 9),
      notes: p.notes || '',
      files: (p.files || []).map((f, j) =>
        normalizeFile(
          Object.assign(
            {
              // Демо метаданни: създаден → качен → последна промяна.
              createdAt: demoDate(i, 8 + (j % 4)),
              uploadedAt: demoDate(i, 10 + (j % 8)),
              modifiedAt: demoDate(i, 13 + (j % 5)),
              sha256: demoHash(i, j),
              locked: j % 3 === 0,
              lockedBy: j % 3 === 0 ? 'admin' : '',
            },
            f,
            { uploadedAt: f.uploadedAt || demoDate(i, 10 + (j % 8)), notes: f.notes || '' },
          ),
        ),
      ),
    }));
  }

  function normalizeFile(f) {
    return {
      id: String(f.id || ''),
      name: String(f.name || 'file'),
      size: Number(f.size) || 0,
      sha256: String(f.sha256 || ''),
      uploadedAt: f.uploadedAt || '',
      createdAt: f.createdAt || f.uploadedAt || '',
      modifiedAt: f.modifiedAt || f.uploadedAt || '',
      locked: Boolean(f.locked),
      lockedBy: f.lockedBy || '',
      notes: f.notes || '',
      accessMode: f.accessMode || 'FREE',
      listed: f.listed !== false,
      encrypted: Boolean(f.encrypted),
      topic: f.topic || '',
      category: f.category || '',
      group: f.group || '',
      tags: Array.isArray(f.tags) ? f.tags : [],
      version: Number(f.version) || 1,
      versions: Array.isArray(f.versions) ? f.versions : [],
    };
  }

  const portal = () => {
    const open = state.openPortal ? state.portals.find((p) => p.id === state.openPortal) : null;
    return open || state.portals[state.portalIndex] || state.portals[0] || null;
  };
  const fileById = (id) => (portal() ? portal().files.find((f) => f.id === id) : null) || null;
  const current = () => fileById(state.selected);
  /** Контакт от директорията: приема и суров запис от /admin/api/directory. */
  function normalizeContact(c) {
    const f = (c && c.fields) || {};
    return {
      id: String((c && c.id) || ''),
      email: String((c && c.email) || ''),
      name: String((c && c.name) || f.name || ''),
      organization: String((c && c.organization) || f.organization || ''),
      department: String((c && c.department) || f.department || ''),
      phone: String((c && c.phone) || f.phone || ''),
      city: String((c && c.city) || f.city || ''),
      country: String((c && c.country) || f.country || ''),
      extras: Array.isArray(c && c.extras)
        ? c.extras.map((x) => ({ key: String(x.key || ''), value: String(x.value || '') })).filter((x) => x.key)
        : [],
    };
  }
  const contactOf = (id) => state.contacts.find((c) => c.id === id) || null;
  const contactLabel = (c) =>
    !c ? 'без контакт' : [c.name || c.email, c.organization].filter(Boolean).join(' · ') || c.email;

  // ── Контакт: избор от контактите или добавяне на нов ────────────────────
  const NEW_CONTACT = '__new__';
  function contactSelect(currentId) {
    return `<select name="contactId">
      <option value="">— без контакт —</option>
      <option value="${NEW_CONTACT}" ${currentId === NEW_CONTACT ? 'selected' : ''}>＋ нов контакт (попълни по-долу)</option>
      ${state.contacts
        .map(
          (c) =>
            `<option value="${esc(c.id)}" ${currentId === c.id ? 'selected' : ''}>${esc(contactLabel(c))}${c.email ? ` — ${esc(c.email)}` : ''
            }</option>`,
        )
        .join('')}
    </select>`;
  }
  function newContactFields() {
    return `<div class="pf-contact-new" hidden>
      <div class="u-grid u-grid-fields">
        <div class="field"><label>Име на контакта</label><input name="contact_name" maxlength="120" placeholder="напр. Мария Иванова" /></div>
        <div class="field"><label>Имейл (задължителен)</label><input name="contact_email" maxlength="190" placeholder="name@example.com" /></div>
        <div class="field"><label>Телефон</label><input name="contact_phone" maxlength="25" placeholder="+359 88 123 4567" /></div>
        <div class="field"><label>Организация</label><input name="contact_org" maxlength="120" /></div>
      </div>
      ${extrasEditor('contact', [])}
    </div>`;
  }
  const EMAIL_RE = /^[^\s@<>"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i;
  /** Връща id на контакта: съществуващ, новосъздаден или '' (без контакт). */
  async function ensureContact(form) {
    const sel = form.querySelector('[name="contactId"]');
    const val = sel ? sel.value : '';
    if (val !== NEW_CONTACT) return val || '';
    const get = (n) => {
      const el = form.querySelector(`[name="${n}"]`);
      return el ? String(el.value || '').trim() : '';
    };
    const email = get('contact_email').toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error('Имейлът на новия контакт е задължителен и трябва да е валиден');
    const fields = {
      name: get('contact_name').slice(0, 120),
      phone: get('contact_phone').slice(0, 25),
      organization: get('contact_org').slice(0, 120),
    };
    const extras = readExtras(form, 'contact');
    if (connected()) {
      const r = await api('/admin/api/directory/contacts', { method: 'POST', json: { email, fields, extras } });
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      state.contacts.push(normalizeContact(r.data));
      return r.data.id;
    }
    const existing = state.contacts.find((c) => c.email === email);
    if (existing) {
      // Допълваме липсващите полета/полетата по избор, вместо да губим въведеното.
      state.contacts = state.contacts.map((c) =>
        c.id === existing.id
          ? normalizeContact({
            ...c,
            name: c.name || fields.name,
            phone: c.phone || fields.phone,
            organization: c.organization || fields.organization,
            extras: [...c.extras, ...extras.filter((x) => !c.extras.some((y) => y.key === x.key))],
          })
          : c,
      );
      return existing.id;
    }
    const c = normalizeContact({ id: `demo-c-${Date.now()}`, email, fields, extras });
    state.contacts.push(c);
    return c.id;
  }
  async function loadContacts() {
    if (!connected()) return;
    const r = await api('/admin/api/directory');
    if (r.ok && r.data && Array.isArray(r.data.contacts)) state.contacts = r.data.contacts.map(normalizeContact);
  }

  // ── Дело (case): избор от делата или ново ───────────────────────────────
  const NEW_CASE = '__new_case__';
  function normalizeCase(c) {
    const src = c && typeof c === 'object' ? c : {};
    return {
      id: String(src.id || ''),
      number: String(src.number || ''),
      title: String(src.title || src.number || ''),
      category: String(src.category || ''),
      subject: String(src.subject || ''),
      contactId: String(src.contactId || ''),
      extras: Array.isArray(src.extras)
        ? src.extras.map((x) => ({ key: String(x.key || ''), value: String(x.value || '') })).filter((x) => x.key)
        : [],
    };
  }
  const caseOf = (id) => state.cases.find((c) => c.id === id) || null;
  const caseLabel = (c) => {
    if (!c) return 'без дело';
    if (!c.title || c.title === c.number) return c.number;
    return c.title.toLowerCase().includes(c.number.toLowerCase()) ? c.title : `${c.number} — ${c.title}`;
  };
  function caseSelect(currentId) {
    return `<select name="caseId">
      <option value="">— без дело —</option>
      <option value="${NEW_CASE}" ${currentId === NEW_CASE ? 'selected' : ''}>＋ ново дело (попълни по-долу)</option>
      ${state.cases
        .map(
          (c) =>
            `<option value="${esc(c.id)}" ${currentId === c.id ? 'selected' : ''}>${esc(caseLabel(c))}${c.category ? ` · ${esc(c.category)}` : ''
            }</option>`,
        )
        .join('')}
    </select>`;
  }
  function newCaseFields() {
    return `<div class="pf-case-new" hidden>
      <div class="u-grid u-grid-fields">
        <div class="field"><label>Номер на делото (задължителен)</label><input name="case_number" maxlength="80" placeholder="2026-114" /></div>
        <div class="field"><label>Заглавие на делото</label><input name="case_title" maxlength="160" placeholder="Дело 2026-114 — доказателства" /></div>
        <div class="field"><label>Категория на делото</label><input name="case_category" maxlength="120" placeholder="Правни дела" /></div>
        <div class="field"><label>Относно (дело)</label><input name="case_subject" maxlength="200" placeholder="посещение на лице" /></div>
      </div>
      ${extrasEditor('case', [])}
    </div>`;
  }
  async function ensureCase(form, contactId) {
    const sel = form.querySelector('[name="caseId"]');
    const val = sel ? sel.value : '';
    if (val !== NEW_CASE) return val || '';
    const get = (n) => {
      const el = form.querySelector(`[name="${n}"]`);
      return el ? String(el.value || '').trim() : '';
    };
    const number = get('case_number').slice(0, 80);
    if (!number) throw new Error('Номерът на новото дело е задължителен');
    const payload = {
      number,
      title: get('case_title').slice(0, 160),
      category: get('case_category').slice(0, 120),
      subject: get('case_subject').slice(0, 200),
      contactId: contactId || '',
      extras: readExtras(form, 'case'),
    };
    if (connected()) {
      const r = await api('/admin/api/cases', { method: 'POST', json: payload });
      if (!r.ok) throw new Error(r.error || `HTTP ${r.status}`);
      state.cases.push(normalizeCase(r.data));
      return r.data.id;
    }
    const existing = state.cases.find((c) => c.number.toLowerCase() === number.toLowerCase());
    if (existing) {
      // Допълваме липсващото, за да не се губи въведеното от формата.
      state.cases = state.cases.map((c) =>
        c.id === existing.id
          ? normalizeCase({
            ...c,
            title: c.title || payload.title || c.number,
            category: c.category || payload.category,
            subject: c.subject || payload.subject,
            contactId: c.contactId || payload.contactId,
            extras: [...c.extras, ...payload.extras.filter((x) => !c.extras.some((y) => y.key === x.key))],
          })
          : c,
      );
      return existing.id;
    }
    const c = normalizeCase(Object.assign({ id: `demo-k-${Date.now()}` }, payload));
    state.cases.push(c);
    return c.id;
  }
  async function loadCases() {
    if (!connected()) return;
    const r = await api('/admin/api/cases');
    if (r.ok && r.data && Array.isArray(r.data.cases)) state.cases = r.data.cases.map(normalizeCase);
  }

  // ── Полета по желание (extras) — за контакт и за дело ───────────────────
  function extrasRow(key, value) {
    return `<div class="pf-extra-row">
      <input data-extra-key placeholder="поле, напр. Съд" maxlength="60" value="${esc(key || '')}" />
      <input data-extra-value placeholder="стойност" maxlength="200" value="${esc(value || '')}" />
      <button type="button" class="btn btn-sm" data-extras-remove title="Премахни полето">${ICON.remove}</button>
    </div>`;
  }
  function extrasEditor(scope, list) {
    const rows = (list || []).map((x) => extrasRow(x.key, x.value)).join('');
    return `<div class="pf-extras" data-extras="${scope}">
      <div class="pf-extras-rows">${rows}</div>
      <div class="u-row u-row-1"><button type="button" class="btn btn-sm" data-extras-add="${scope}">＋ добави поле</button></div>
      <small class="hint">Полета по желание (име → стойност), до 20 реда.</small>
    </div>`;
  }
  function readExtras(form, scope) {
    const box = form.querySelector(`[data-extras="${scope}"]`);
    if (!box) return [];
    const out = [];
    box.querySelectorAll('.pf-extra-row').forEach((row) => {
      const k = row.querySelector('[data-extra-key]');
      const v = row.querySelector('[data-extra-value]');
      const key = k ? String(k.value || '').trim() : '';
      if (!key) return;
      out.push({ key: key.slice(0, 60), value: (v ? String(v.value || '') : '').trim().slice(0, 500) });
    });
    return out.slice(0, 20);
  }
  /** Добавяне/премахване на редове „поле по желание“ във всяка форма. */
  function wireExtras(root) {
    root.querySelectorAll('[data-extras-add]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scope = btn.dataset.extrasAdd;
        const box = root.querySelector(`[data-extras="${scope}"] .pf-extras-rows`);
        if (!box) return;
        if (box.children.length >= 20) return toast('Максимум 20 полета', 'err');
        box.insertAdjacentHTML('beforeend', extrasRow('', ''));
      });
    });
    root.querySelectorAll('[data-extras-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.pf-extra-row');
        if (row) row.remove();
      });
    });
  }

  function ext(name) {
    const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : 'other';
  }
  function typeOf(f) {
    const e = ext(f.name);
    if (e === 'pdf') return 'pdf';
    if (['docx', 'doc'].includes(e)) return 'docx';
    if (['xlsx', 'xls', 'csv'].includes(e)) return 'xlsx';
    if (['json', 'txt', 'md', 'log'].includes(e)) return 'text';
    if (['zip', '7z', 'tar', 'gz'].includes(e)) return 'archive';
    return 'other';
  }
  /** Възел от дървото по относителен път ('' → коренът). */
  function treeNode(rel) {
    const root = state.tree.data && state.tree.data.tree;
    if (!root) return null;
    const key = String(rel || '').replace(/^\/+|\/+$/g, '');
    if (!key) return root;
    let node = root;
    for (const part of key.split('/')) {
      node = (node.folders || []).find((f) => f.name === part) || null;
      if (!node) return null;
    }
    return node;
  }

  /**
   * Файловете на избраната папка — това, което се показва в „Файлове в портала“.
   * Регистрираните в портала файлове се показват с пълната си карта; файловете,
   * които са само на диска в папката, се показват като карта „хранилище“.
   */
  /**
   * Свързва файловете от дървото на една папка с регистрираните в портала файлове.
   * Правило: ПЪРВО по път (`storagePath`); по име — само за запис БЕЗ път (преди 0.69.20).
   * Иначе едноименен файл от друга папка „краде“ картата и два документа изглеждат като един.
   */
  function bindFolderFiles(treeFiles, registered) {
    const norm = (v) => String(v == null ? '' : v)
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase();
    const byPath = new Map();
    const byName = new Map();
    for (const f of registered || []) {
      const stored = norm(f.storagePath);
      if (stored) {
        if (!byPath.has(stored)) byPath.set(stored, f);
        continue;
      }
      const k = String(f.name || '').toLowerCase();
      if (!byName.has(k)) byName.set(k, f);
    }
    const used = new Set();
    const entries = [];
    for (const tf of treeFiles || []) {
      const name = String(tf.name || '');
      const reg = byPath.get(norm(tf.path || name)) || byName.get(name.toLowerCase());
      if (reg) {
        used.add(reg.id);
        entries.push(Object.assign({}, reg, { storagePath: treePath(tf.path || name) }));
        continue;
      }
      entries.push({
        id: '',
        name,
        size: Number(tf.size) || 0,
        path: treePath(tf.path || name),
        uploadedAt: tf.modifiedAt || '',
        createdAt: tf.modifiedAt || '',
        modifiedAt: tf.modifiedAt || '',
        storage: true,
      });
    }
    return { entries, used };
  }

  function filesForFolder(rel) {
    const p = portal();
    if (!p) return [];
    const registered = p.files || [];
    const key = String(rel || '').replace(/^\/+|\/+$/g, '');
    const node = treeNode(key);
    const treeFiles = (node && node.files) || [];
    const { entries, used } = bindFolderFiles(treeFiles, registered);
    const out = entries.slice();
    // В корена: регистрирани файлове БЕЗ път (стари записи) и тези, чийто файл вече го няма
    // в дървото — иначе биха изчезнали от екрана. Файл, който е в папка, НЕ се показва тук.
    if (!key) {
      const onDisk = treeFilePaths();
      for (const f of registered) {
        if (used.has(f.id)) continue;
        const stored = String(f.storagePath || '').replace(/^\/+/, '').toLowerCase();
        if (!stored || !onDisk.has(stored)) out.push(f);
      }
    }
    return out;
  }

  /** Всички пътища на файловете в дървото — за да знаем дали регистриран файл още съществува. */
  function treeFilePaths() {
    const paths = new Set();
    const walk = (node) => {
      for (const f of node.files || []) paths.add(String(f.path || f.name).replace(/^\/+/, '').toLowerCase());
      for (const child of node.folders || []) walk(child);
    };
    const root = state.tree.data && state.tree.data.tree;
    if (root) walk(root);
    return paths;
  }

  function visibleFiles() {
    const q = state.query.trim().toLowerCase();
    let list = filesForFolder(state.tree.open || '').slice();
    if (q) {
      list = list.filter(
        (f) => f.name.toLowerCase().includes(q) || String(f.topic || '').toLowerCase().includes(q),
      );
    }
    if (state.type !== 'all') list = list.filter((f) => typeOf(f) === state.type);
    if (state.access !== 'all') list = list.filter((f) => !f.storage && f.accessMode === state.access);
    if (state.topic !== 'all') list = list.filter((f) => !f.storage && f.topic === state.topic);
    if (state.category !== 'all') list = list.filter((f) => !f.storage && f.category === state.category);
    const dir = state.sort.startsWith('-') ? -1 : 1;
    const key = state.sort.replace('-', '');
    list.sort((a, b) => {
      if (key === 'size') return (a.size - b.size) * dir;
      if (key === 'date') return String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')) * dir;
      return a.name.localeCompare(b.name, 'bg') * dir;
    });
    return list;
  }

  /** Портална таблица: търсене по име/slug/бележки, само с бележки, сортиране по дата. */
  function visiblePortals() {
    const q = state.portalQuery.trim().toLowerCase();
    let list = state.portals.slice();
    if (q) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          String(p.notes || '').toLowerCase().includes(q),
      );
    }
    if (state.notesOnly) list = list.filter((p) => String(p.notes || '').trim());
    const dir = state.portalSort.startsWith('-') ? -1 : 1;
    const key = state.portalSort.replace('-', '');
    list.sort((a, b) =>
      key === 'title'
        ? a.title.localeCompare(b.title, 'bg') * dir
        : String(a.createdAt || '').localeCompare(String(b.createdAt || '')) * dir,
    );
    return list;
  }

  function stateOf(f) {
    if (f.accessMode === 'DISABLED') return { id: 'disabled', label: 'Забранен', cls: 'err' };
    if (!f.listed) return { id: 'hidden', label: f.accessMode === 'KEY_REQUIRED' ? 'Скрит + ключ' : 'Скрит', cls: 'warn' };
    if (f.accessMode === 'KEY_REQUIRED') return { id: 'key', label: 'Изисква ключ', cls: 'warn' };
    return { id: 'public', label: 'Публичен', cls: 'ok' };
  }

  // ── Връзка ───────────────────────────────────────────────────────────────
  function ingressPrefix() {
    const m = String(location.pathname || '').match(/^\/(?:app|hapi|hassio\/ingress)\/[^/]+/);
    return m ? m[0] : '';
  }
  const defaultBase = () => (location.protocol === 'file:' ? '' : location.origin + ingressPrefix());
  const base = () => (localStorage.getItem('hapi.apiBase') || defaultBase()).replace(/\/$/, '');
  // Адрес за ПУБЛИЧНИТЕ препратки (api.json, QR). При Home Assistant Ingress
  // адресът на интерфейса не е публичен, затова се ползва сървърната настройка.
  const publicBase = () => (state.publicBaseUrl || base() || 'https://portal.example.com').replace(/\/$/, '');
  const token = () => sessionStorage.getItem('hapiAdminToken') || '';
  const connected = () => Boolean(base());
  /** Роля и публичен адрес от add-on-а (един път при монтиране). */
  async function loadConnection() {
    if (state.connectionLoaded || !connected()) return;
    state.connectionLoaded = true;
    const r = await api('/admin/api/connection');
    if (r.ok && r.data && r.data.publicBaseUrl) {
      state.publicBaseUrl = r.data.publicBaseUrl;
      // Препратките се строят наново с публичния адрес (иначе сочат към Ingress).
      state.portals.forEach((p) => generateApi(p, true));
    }
  }
  function askToken(force) {
    if (!force && token()) return token();
    const entered = (window.prompt('Админ токен (само за тази сесия):') || '').trim();
    if (entered) sessionStorage.setItem('hapiAdminToken', entered);
    return entered;
  }
  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {});
    if (token()) headers.Authorization = `Bearer ${token()}`;
    if (o.json !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(base() + path, {
        method: o.method || 'GET',
        headers,
        body: o.json !== undefined ? JSON.stringify(o.json) : o.body,
      });
    } catch (e) {
      return { ok: false, status: 0, error: e.message, data: null };
    }
    if (res.status === 401 && !o.retried) {
      if (!askToken(true)) return { ok: false, status: 401, error: 'Нужен е админ токен', data: null };
      return api(path, Object.assign({}, o, { retried: true }));
    }
    const type = res.headers.get('Content-Type') || '';
    let data = null;
    if (type.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }
    return { ok: res.ok, status: res.status, error: res.ok ? '' : (data && data.error) || `HTTP ${res.status}`, data };
  }
  const P = () => `/admin/api/portals/${encodeURIComponent(portal().id)}`;
  const FP = (f) => `${P()}/files/${encodeURIComponent(f.id)}`;
  /** Списък с портали от add-on-а (в свързан режим демо данните се заменят). */
  function portalFromApi(p) {
    return {
      id: String(p.id),
      slug: String(p.slug),
      title: p.title,
      visibility: p.visibility || 'private',
      description: p.description || '',
      category: p.category || '',
      subject: p.subject || '',
      flag: p.flag || 'none',
      notes: p.notes || '',
      contactId: p.contactId || '',
      caseId: p.caseId || '',
      createdAt: p.createdAt || '',
      access: p.access || (p.visibility === 'public' ? 'FREE' : 'KEY_REQUIRED'),
      storage_root: p.storage_root || '/share',
      token_policy: { ttl_hours: 168, max_uses: 10, revocable: true },
      files: (p.files || []).map(normalizeFile),
    };
  }

  async function loadPortals() {
    if (!connected()) return false;
    const all = await api('/admin/api/portals');
    if (!all.ok || !all.data || !Array.isArray(all.data.portals)) return false;
    const list = all.data.portals.map(portalFromApi);
    const previous = state.openPortal;
    state.portals = list;
    // Списъкът е изходното състояние: отворен остава само портал, който още съществува.
    if (!list.some((p) => p.id === previous)) state.openPortal = null;
    state.portalIndex = Math.max(0, list.findIndex((p) => p.id === previous));
    // API + QR се създават ЗАЕДНО с портала (на сървъра), затова препратките се
    // сглобяват веднага — няма нужда от бутон „Генерирай“.
    list.forEach((p) => {
      if (!state.api[p.id]) generateApi(p, true);
    });
    return true;
  }

  async function reload() {
    if (!connected() || !portal()) return;
    const r = await api(P());
    if (r.ok && r.data) {
      // Обновяваме ТОЧНО отворения портал (по id), а не по индекс — иначе при
      // отворен друг портал промените (напр. бележка) остават невидими.
      const currentId = portal() ? portal().id : '';
      const idx = state.portals.findIndex((x) => x.id === currentId);
      if (idx < 0) return;
      state.portals[idx] = Object.assign({}, state.portals[idx], {
        title: r.data.title || state.portals[idx].title,
        slug: r.data.slug || state.portals[idx].slug,
        visibility: r.data.visibility || state.portals[idx].visibility,
        description: r.data.description || '',
        category: r.data.category || '',
        subject: r.data.subject || '',
        flag: r.data.flag || 'none',
        notes: r.data.notes || '',
        contactId: r.data.contactId || state.portals[idx].contactId || '',
        caseId: r.data.caseId || state.portals[idx].caseId || '',
        createdAt: r.data.createdAt || state.portals[idx].createdAt,
        files: (r.data.files || []).map(normalizeFile),
      });
      if (state.selected && !fileById(state.selected)) state.selected = null;
      state.versions = null;
    } else if (r.status) {
      state.error = r.error;
    }
  }

  // ── QR и API ─────────────────────────────────────────────────────────────
  function qrSvg(text) {
    try {
      if (typeof window.qrcode !== 'function' || !text) return '';
      const q = window.qrcode(0, 'M');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch {
      return '';
    }
  }

  function generateApi(p, quiet) {
    const spec = window.HapiApiSpec;
    if (!spec) {
      toast('Липсва api-spec.js', 'err');
      return null;
    }
    try {
      const portalObj = {
        slug: p.slug,
        id: p.id,
        title: p.title,
        files: p.files,
        visibility: p.visibility,
        access: p.access,
      };
      const record = spec.buildApiRecord(portalObj, { baseUrl: publicBase() });
      const openapi = spec.buildOpenApi(portalObj, { baseUrl: publicBase() });
      const refs = record.references || {};
      const qrUrl = refs.qrUrl || `${publicBase()}/api/v1/p/${p.slug}/qr.svg`;
      // „Адрес на портала“ е ЧОВЕШКАТА страница (там води QR кодът), не JSON API-то.
      // Адресира се с ID на портала: връзката не издава името и не се чупи при преименуване.
      const landing = refs.landingUrl || `${publicBase()}/p/${p.id || p.slug}`;
      state.api[p.id] = { record, openapi, refs, qrUrl, landing, at: new Date().toISOString() };
      if (!quiet) toast('API и QR са генерирани за портала', 'ok');
      return state.api[p.id];
    } catch (e) {
      toast(`${e.code || 'ГРЕШКА'}: ${e.message}`, 'err');
      return null;
    }
  }

  async function generateApiForPortal(p) {
    if (!connected()) {
      generateApi(p);
      render();
      return;
    }
    const r = await api(`/admin/api/v2/portals/${encodeURIComponent(p.slug)}/api`, { method: 'POST', json: {} });
    generateApi(p, true);
    if (!r.ok) toast(r.error || 'API не е записано на сървъра', 'err');
    else toast('API, openapi.json и qr.svg са записани от add-on-а', 'ok');
    render();
  }

  // ── Портални операции ────────────────────────────────────────────────────
  async function createPortal(form) {
    // Формата може да е <form> или контейнер с полета — взимаме стойностите устойчиво.
    const field = (name) => {
      const el = (form.elements && form.elements[name]) || form.querySelector(`[name="${name}"]`);
      return el ? String(el.value || '') : '';
    };
    const slug = field('slug').trim().toLowerCase();
    const title = field('title').trim();
    const visibility = field('visibility') || 'private';
    const storageRoot = (field('storage_root').trim() || '/share').replace(/\/+$/, '') || '/share';
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return toast('slug: 2–63 знака, a-z, 0-9, „-“', 'err');
    if (!title) return toast('Заглавието е задължително', 'err');
    if (!/^\/(share|media)(\/[^\\\r\n\0]*)?$/.test(storageRoot) || storageRoot.includes('..'))
      return toast('Папката трябва да е под /share или /media (без „..“)', 'err');
    const foldered = folderFiles(form);
    let contactId = '';
    let caseId = '';
    try {
      contactId = await ensureContact(form);
      caseId = await ensureCase(form, contactId);
    } catch (e) {
      return toast(e.message, 'err');
    }
    if (!connected()) {
      if (state.portals.some((p) => p.slug === slug)) return toast('Този slug вече съществува', 'err');
      const p = {
        id: `demo-${Date.now()}`,
        slug,
        title,
        visibility,
        description: field('description').trim(),
        category: field('category').trim(),
        subject: field('subject').trim(),
        flag: field('flag') || 'none',
        notes: field('notes').trim(),
        contactId,
        caseId,
        createdAt: new Date().toISOString(),
        access: visibility === 'public' ? 'FREE' : 'KEY_REQUIRED',
        storage_root: storageRoot,
        token_policy: { ttl_hours: 168, max_uses: 10, revocable: true },
        files: [],
      };
      state.portals.push(p);
      state.portalIndex = state.portals.length - 1;
      state.openPortal = p.id;
      state.newPortal = false;
      state.selected = null;
      const added = await uploadFolderFiles(foldered);
      generateApi(p, true); // при изграждане на портал: API + QR веднага
      state.lastAction = `Създаден портал ${slug}${added ? ` · ${added} файла от папка` : ''} · API и QR (демо)`;
      toast(
        `Демо: порталът е създаден${added ? `, качени ${added} файла от папката` : ''}; API и QR са генерирани`,
        'ok',
      );
      return render();
    }
    const created = await api('/admin/api/portals', {
      method: 'POST',
      json: {
        slug,
        title,
        description: field('description'),
        category: field('category'),
        subject: field('subject'),
        flag: field('flag'),
        notes: field('notes'),
        storage_root: storageRoot,
        contactId,
        caseId,
      },
    });
    if (!created.ok) return toast(created.error, 'err');
    if (visibility === 'public') {
      await api(`/admin/api/portals/${created.data.id}`, { method: 'PATCH', json: { visibility } });
    }
    const all = await api('/admin/api/portals');
    if (all.ok && all.data && Array.isArray(all.data.portals)) {
      state.portals = all.data.portals.map((p, i) => ({
        id: String(p.id),
        slug: String(p.slug),
        title: p.title,
        visibility: p.visibility || 'private',
        description: p.description || '',
        category: p.category || '',
        subject: p.subject || '',
        flag: p.flag || 'none',
        notes: p.notes || '',
        contactId: p.contactId || '',
        caseId: p.caseId || '',
        createdAt: p.createdAt || '',
        access: p.visibility === 'public' ? 'FREE' : 'KEY_REQUIRED',
        storage_root: p.storage_root || '/share',
        token_policy: { ttl_hours: 168, max_uses: 10, revocable: true },
        files: (p.files || []).map(normalizeFile),
      }));
      state.portalIndex = Math.max(0, state.portals.findIndex((p) => p.id === created.data.id));
      state.openPortal = state.portals[state.portalIndex].id;
    }
    state.newPortal = false;
    state.selected = null;
    const added = await uploadFolderFiles(foldered);
    await generateApiForPortal(portal());
    toast(
      `Порталът е създаден${added ? `, качени ${added} файла от папката` : ''}; API, openapi.json и qr.svg са генерирани`,
      'ok',
    );
    render();
  }

  /** Избраните файлове от папка (input[webkitdirectory]) — без ограничение по тип. */
  function folderFiles(form) {
    const input = form.querySelector ? form.querySelector('#pf-folder') : null;
    return input && input.files ? Array.from(input.files) : [];
  }

  /**
   * Качва всички файлове от избраната папка в текущия портал.
   * Подпапките се записват като „група“ (metadata.group), името остава само файлът.
   */
  async function uploadFolderFiles(list) {
    if (!list || !list.length) return 0;
    if (list.length > 200) {
      toast('Максимум 200 файла от папка наведнъж', 'err');
      return 0;
    }
    let done = 0;
    for (const file of list) {
      const rel = String(file.webkitRelativePath || file.name);
      const parts = rel.split('/').filter(Boolean);
      const name = parts.length > 1 ? parts[parts.length - 1] : file.name;
      const group = parts.length > 2 ? parts.slice(1, -1).join('/') : '';
      if (!connected()) {
        const now = new Date().toISOString();
        portal().files.push(
          normalizeFile({
            id: `demo-${Date.now()}-${done}`,
            name,
            size: file.size,
            group,
            createdAt: now,
            uploadedAt: now,
            modifiedAt: now,
          }),
        );
        done += 1;
        continue;
      }
      const buffer = await file.arrayBuffer();
      const r = await api(`${P()}/files`, {
        method: 'POST',
        body: buffer,
        headers: {
          'X-File-Name': encodeURIComponent(name),
          'X-File-Encrypt': '0',
          'Content-Type': 'application/octet-stream',
        },
      });
      if (!r.ok) {
        toast(`Пропуснат ${name}: ${r.error}`, 'err');
        continue;
      }
      if (group && r.data && r.data.id) {
        await api(`${P()}/files/${r.data.id}/metadata`, { method: 'PATCH', json: { group } });
      }
      done += 1;
    }
    return done;
  }

  async function savePortal(form) {
    const p = portal();
    let contactId = p.contactId || '';
    let caseId = p.caseId || '';
    try {
      contactId = await ensureContact(form);
      caseId = await ensureCase(form, contactId);
    } catch (e) {
      return toast(e.message, 'err');
    }
    const storageRoot = String((form.storage_root && form.storage_root.value) || p.storage_root || '/share')
      .trim()
      .replace(/\/+$/, '') || '/share';
    if (!/^\/(share|media)(\/[^\\\r\n\0]*)?$/.test(storageRoot) || storageRoot.includes('..')) {
      return toast('Папката трябва да е под /share или /media (без „..“)', 'err');
    }
    const payload = {
      title: String(form.title.value || '').trim(),
      description: String(form.description.value || '').trim(),
      notes: String((form.notes && form.notes.value) || '').trim().slice(0, 2000),
      category: String((form.category && form.category.value) || '').trim(),
      subject: String((form.subject && form.subject.value) || '').trim(),
      flag: (form.flag && form.flag.value) || 'none',
      storage_root: storageRoot,
      contactId,
      caseId,
      visibility: form.visibility.value,
      slug: String(form.slug.value || '').trim().toLowerCase(),
    };
    if (!connected()) {
      return demoMutate('настройките на портала са обновени', () => {
        Object.assign(p, payload);
      });
    }
    const r = await api(P(), { method: 'PATCH', json: payload });
    if (!r.ok) return toast(r.error, 'err');
    await reload();
    toast('Порталът е обновен', 'ok');
    render();
  }

  // ── Файлови операции ─────────────────────────────────────────────────────
  function demoMutate(message, fn) {
    fn();
    state.lastAction = message;
    toast(`Демо: ${message} (само в интерфейса)`, '');
    closePanel();
    render();
  }

  async function runAction(id) {
    const f = current();
    if (id === 'upload') {
      state.selected = null;
      state.panel = 'upload';
      return render();
    }
    if (!f) return toast('Избери файл', 'err');
    if (id === 'preview') return preview(f);
    if (id === 'download') return download(f);
    if (id === 'versions') return openVersions(f);
    if (id === 'metadata' || id === 'rename' || id === 'share' || id === 'access' || id === 'note') {
      state.panel = id;
      state.issuedKey = '';
      state.hashes = null;
      render();
      return openPanelModal();
    }
    if (id === 'signedUrl' || id === 'receipt' || id === 'verifyReceipt') {
      state.panel = id;
      render();
      return openPanelModal();
    }
    if (id === 'delete') return removeFile(f);
    if (id === 'lock') return toggleLock(f);
    if (id === 'package') return buildPackage();
    if (id === 'move' || id === 'copy') return toast('Планирано (F2-10 / F2-11): преместване и копиране между портали', '');
    if (id === 'encrypt') return toast('Шифроването се избира при качване на нов файл или версия', '');
    return undefined;
  }

  // ── Пакет с файловете на портала ────────────────────────────────────────
  // Пакетът е ZIP с PACKAGE_INDEX.json, hashes/sha256sum.txt, manifest и оригиналите.
  // Дали се подписва с PGP се задава еднократно в „Настройки“ (автоподписване),
  // затова тук не се пита — add-on-ът прилага запазената настройка.
  /**
   * Създава пакет и го изтегля.
   * opts.includeStorage — взима всичко от папката на портала (storage_root), не само
   * регистрираните файлове; opts.portalId — порталът, ако не е отворен панел.
   */
  async function buildPackage(opts) {
    const o = opts || {};
    const p = (o.portalId && state.portals.find((x) => x.id === o.portalId)) || portal();
    if (!p) return toast('Отвори портал', 'err');
    if (!connected()) return toast('Демо: пакетът се създава от add-on-а (свързан режим)', '');
    state.busy = true;
    if (o.includeStorage) toast('Създавам пакет от цялото хранилище…', '');
    const r = await api('/admin/api/packages', { method: 'POST', json: { portalId: p.id, includeStorage: o.includeStorage === true } });
    state.busy = false;
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    state.lastAction = `Пакет ${r.data.fileName}`;
    const extra = r.data.storageFiles ? ` · ${r.data.storageFiles} от хранилището` : '';
    const signed = r.data.hasSignature ? ' · подписан' : '';
    toast(`Пакет ${r.data.fileName} · ${r.data.files} файла${extra} · ${fmtSize(r.data.size)}${signed}`, 'ok');
    render();
    await downloadUrl(`${base()}/admin/api/packages/${r.data.id}/download`, r.data.fileName);
    if (r.data.hasSignature) await downloadUrl(`${base()}/admin/api/packages/${r.data.id}/signature`, `${r.data.fileName}.asc`);
  }

  /**
   * Видимост на файла в публичния каталог (икона eye / eye-off на картата) — същият флаг
   * `listed`, който ползва и политиката за достъп. Скрит файл → 404 в публичния API.
   */
  async function toggleListed(fileId) {
    const f = fileById(fileId);
    if (!f) return toast('Файлът не е намерен', 'err');
    const listed = f.listed === false;
    if (!connected()) {
      return demoMutate(listed ? `${f.name} е видим в каталога` : `${f.name} е скрит от каталога`, () => {
        f.listed = listed;
      });
    }
    const r = await api(`${FP(f)}/metadata`, { method: 'PATCH', json: { listed } });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    await reload();
    toast(listed ? 'Файлът е видим в публичния каталог' : 'Файлът е скрит от публичния каталог', 'ok');
    render();
  }

  /** Заключване на файл (само администратор) — показва се като икона lock в таблицата. */
  async function toggleLock(f) {
    const locked = !f.locked;
    const r = await api(`${FP(f)}/lock`, { method: 'PATCH', json: { locked, by: 'admin' } });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    await reload();
    toast(locked ? 'Файлът е заключен' : 'Файлът е отключен', 'ok');
    render();
  }

  async function preview(f) {
    state.lastAction = `Преглед на ${f.name}`;
    if (!connected()) {
      return showModal(`VIEW · ${f.name}`, {
        html: '<p class="hint">Демо: прегледът изисква свързан add-on (Ingress). В свързан режим файлът се отваря в този прозорец.</p>',
      });
    }
    const res = await fetch(base() + `${FP(f)}/preview`, { headers: { Authorization: `Bearer ${token()}` } });
    if (res.status === 401) {
      if (!askToken(true)) return toast('Нужен е админ токен', 'err');
      return preview(f);
    }
    if (!res.ok) return toast(`HTTP ${res.status}`, 'err');
    const blob = await res.blob();
    if (modalBlob) URL.revokeObjectURL(modalBlob);
    modalBlob = URL.createObjectURL(blob);
    const type = blob.type || '';
    if (/^(text\/|application\/(json|xml))/.test(type) && blob.size < 200000) {
      const text = await blob.text();
      return showModal(`VIEW · ${f.name}`, { html: `<pre>${esc(text)}</pre>`, downloadName: f.name });
    }
    showModal(`VIEW · ${f.name}`, { url: modalBlob, downloadName: f.name });
  }

  async function download(f) {
    if (!connected()) {
      state.lastAction = `Изтегляне на ${f.name}`;
      return toast('Демо: изтеглянето изисква свързан add-on', '');
    }
    const doFetch = async (retry) => {
      const res = await fetch(base() + `${FP(f)}/download`, { headers: { Authorization: `Bearer ${token()}` } });
      if (res.status === 401 && !retry) {
        if (!askToken(true)) return null;
        return doFetch(true);
      }
      return res;
    };
    const res = await doFetch(false);
    if (!res) return toast('Нужен е админ токен', 'err');
    if (!res.ok) return toast(`HTTP ${res.status}`, 'err');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.rel = 'noopener';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    state.lastAction = `Изтеглен ${f.name}`;
    toast('Изтеглянето започна', 'ok');
  }

  async function openVersions(f) {
    state.panel = 'versions';
    state.versions = null;
    render();
    openPanelModal();
    if (!connected()) {
      state.versions = { current: { version: f.version, size: f.size, sha256: f.sha256 }, versions: [], demo: true };
      return refreshPanel();
    }
    const r = await api(`${FP(f)}/versions`);
    state.versions = r.ok ? r.data : { error: r.error, versions: [] };
    render();
    refreshPanel();
  }

  async function removeFile(f) {
    if (!window.confirm(`Изтриване на „${f.name}“? Действието е необратимо.`)) return;
    if (!connected()) {
      return demoMutate(`изтрит ${f.name}`, () => {
        portal().files = portal().files.filter((x) => x.id !== f.id);
        state.selected = null;
        state.panel = 'actions';
      });
    }
    const r = await api(FP(f), { method: 'DELETE' });
    if (!r.ok) return toast(r.error, 'err');
    state.selected = null;
    closePanel();
    await reload();
    toast('Файлът е изтрит', 'ok');
    render();
  }

  async function saveRename(name) {
    const f = current();
    const value = String(name || '').trim();
    if (!value) return toast('Име не може да е празно', 'err');
    if (!connected()) {
      return demoMutate(`преименуван на ${value}`, () => {
        f.name = value;
        state.panel = 'actions';
      });
    }
    const r = await api(FP(f), { method: 'PATCH', json: { name: value } });
    if (!r.ok) return toast(r.error, 'err');
    await reload();
    closePanel();
    toast('Преименувано', 'ok');
    render();
  }

  /**
   * Бележка към файла — добавяне или редактиране. Пази се в същите метаданни
   * (`PATCH …/files/{id}/metadata` с `notes`), затова е отделно, кратко действие.
   */
  function notePane(f) {
    return `
      <form id="fm-note-form">
        <div class="field"><label>Бележка към файла (до 2000 знака)</label>
          <textarea name="notes" rows="4" maxlength="2000" placeholder="Напр. какво съдържа файлът, кой го е подписал, къде е оригиналът">${esc(
      f.notes || '',
    )}</textarea>
          <small class="hint">${f.notes ? 'Бележката се показва под картата на файла.' : 'Файлът още няма бележка — добави я тук.'
      }</small>
        </div>
        <div class="u-row u-row-2">
          <button type="submit" class="btn btn-sm btn-primary">${f.notes ? 'Запази бележката' : 'Добави бележка'}</button>
          <button type="button" class="btn btn-sm" id="fm-note-clear" ${f.notes ? '' : 'disabled'}>Изчисти бележката</button>
        </div>
      </form>`;
  }

  /** Записва (или изчиства) бележката на файла. */
  async function saveNote(text) {
    const f = current();
    if (!f) return;
    const notes = String(text == null ? '' : text)
      .trim()
      .slice(0, 2000);
    if (!connected()) {
      return demoMutate(notes ? 'бележката е запазена' : 'бележката е изчистена', () => {
        f.notes = notes;
        f.modifiedAt = new Date().toISOString();
        state.panel = 'actions';
      });
    }
    const r = await api(`${FP(f)}/metadata`, { method: 'PATCH', json: { notes } });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    await reload();
    closePanel();
    toast(notes ? 'Бележката е запазена' : 'Бележката е изчистена', 'ok');
    render();
  }

  async function saveMetadata(form) {
    const f = current();
    const payload = {
      topic: form.topic.value.trim(),
      category: form.category.value.trim(),
      group: form.group.value.trim(),
      notes: String((form.notes && form.notes.value) || '').trim().slice(0, 2000),
      tags: form.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
    };
    if (!connected()) {
      return demoMutate('метаданните са обновени', () => {
        Object.assign(f, payload);
        f.modifiedAt = new Date().toISOString();
        state.panel = 'actions';
      });
    }
    const r = await api(`${FP(f)}/metadata`, { method: 'PATCH', json: payload });
    if (!r.ok) return toast(r.error, 'err');
    await reload();
    closePanel();
    toast('Метаданните са запазени', 'ok');
    render();
  }

  async function saveAccess(mode, listed) {
    const f = current();
    if (!connected()) {
      return demoMutate(`политика ${mode}`, () => {
        f.accessMode = mode;
        f.listed = listed;
        state.panel = 'actions';
      });
    }
    const r = await api(`${FP(f)}/access`, { method: 'PATCH', json: { mode, listed } });
    if (!r.ok) return toast(r.error, 'err');
    await reload();
    closePanel();
    toast('Политиката е запазена', 'ok');
    render();
  }

  async function createKey() {
    const f = current();
    if (!connected()) {
      state.issuedKey = 'fk_demo_key_not_real';
      state.lastAction = 'Демо ключ (не е валиден)';
      return renderAll();
    }
    const r = await api(`${FP(f)}/access-keys`, { method: 'POST', json: {} });
    if (!r.ok) return toast(r.error, 'err');
    state.issuedKey = r.data.key;
    toast('Ключът е издаден — показва се само веднъж', 'ok');
    renderAll();
  }

  async function uploadVersion(input, note) {
    const f = current();
    const file = input.files && input.files[0];
    if (!file) return toast('Избери файл', 'err');
    if (!connected()) {
      return demoMutate(`нова версия на ${f.name}`, () => {
        f.version = (f.version || 1) + 1;
        f.size = file.size;
        f.uploadedAt = new Date().toISOString();
        f.modifiedAt = f.uploadedAt;
        state.panel = 'actions';
      });
    }
    const buffer = await file.arrayBuffer();
    const r = await api(`${FP(f)}/versions`, {
      method: 'POST',
      body: buffer,
      headers: { 'X-Version-Note': String(note || '').slice(0, 200) },
    });
    if (!r.ok) return toast(r.error, 'err');
    await reload();
    closePanel();
    toast(`Нова версия ${r.data && r.data.version ? r.data.version : ''}`, 'ok');
    render();
  }

  async function restoreVersion(vn) {
    const f = current();
    if (!connected()) return demoMutate(`възстановена версия ${vn}`, () => { state.panel = 'actions'; });
    const r = await api(`${FP(f)}/versions/${vn}/restore`, { method: 'POST', json: {} });
    if (!r.ok) return toast(r.error, 'err');
    await reload();
    closePanel();
    toast(`Възстановена версия ${vn}`, 'ok');
    render();
  }

  async function uploadFile(form) {
    const file = form.input.files && form.input.files[0];
    if (!file) return toast('Избери файл', 'err');
    const name = (form.name.value || file.name).trim();
    const mode = form.access.value;
    const encrypt = form.encrypt.checked;
    if (!connected()) {
      const now = new Date().toISOString();
      portal().files.push(
        normalizeFile({
          id: `demo-${Date.now()}`,
          name,
          size: file.size,
          accessMode: mode,
          encrypted: encrypt,
          createdAt: now,
          uploadedAt: now,
          modifiedAt: now,
        }),
      );
      state.panel = 'actions';
      return demoMutate(`качен ${name}`, () => { });
    }
    const buffer = await file.arrayBuffer();
    const r = await api(`${P()}/files`, {
      method: 'POST',
      body: buffer,
      headers: {
        'X-File-Name': encodeURIComponent(name),
        'X-File-Encrypt': encrypt ? '1' : '0',
        'Content-Type': 'application/octet-stream',
      },
    });
    if (!r.ok) return toast(r.error, 'err');
    const created = r.data;
    await reload();
    if (created && created.id) {
      const saved = await api(`${P()}/files/${created.id}/access`, { method: 'PATCH', json: { mode, listed: mode !== 'DISABLED' } });
      if (!saved.ok) toast(saved.error, 'err');
    }
    state.panel = 'actions';
    toast('Файлът е качен', 'ok');
    render();
  }

  async function applyBulk(mode) {
    const ids = [...state.selectedIds];
    if (!ids.length) return toast('Не са избрани файлове', 'err');
    if (!window.confirm(`Приложи политика ${mode} към ${ids.length} файл(а)?`)) return;
    if (!connected()) {
      return demoMutate(`политика ${mode} за ${ids.length} файла`, () => {
        portal().files.forEach((f) => {
          if (ids.includes(f.id)) f.accessMode = mode;
        });
        state.selectedIds.clear();
      });
    }
    const r = await api(`${P()}/files/bulk-access`, { method: 'POST', json: { fileIds: ids, mode, dryRun: false } });
    if (!r.ok) return toast(r.error, 'err');
    state.selectedIds.clear();
    await reload();
    toast(`Обновени ${r.data && r.data.count ? r.data.count : ids.length} файла`, 'ok');
    render();
  }

  function webLink(f) {
    return `${publicBase()}/api/public/v1/files/${encodeURIComponent(f.id)}/download`;
  }
  function qrUrl(f) {
    return `${publicBase()}/api/v1/p/${encodeURIComponent(portal().slug)}/files/${encodeURIComponent(f.id)}/qr.svg`;
  }

  // ── Рендер ───────────────────────────────────────────────────────────────
  function render() {
    if (!state.portals.length) {
      host.innerHTML = '<p class="hint">Няма портали. Създай първия с „Нов портал“.</p>';
      return;
    }
    const totalFiles = state.portals.reduce((n, x) => n + x.files.length, 0);
    // Отворен портал → показва се САМО той; иначе — списъкът с портали.
    const openP = state.openPortal ? state.portals.find((x) => x.id === state.openPortal) || null : null;
    const list = openP ? [openP] : visiblePortals();

    host.innerHTML = `
      <div class="page-title">
        <h1>Портали &amp; файлове</h1>
        <p>${openP
        ? 'Папки → файлове → контролен панел; в края на страницата се връщаш към списъка.'
        : 'Портал → API и QR → списък с файлове → контролен панел под избрания файл'
      }</p>
        <span class="badge ${connected() ? 'ok' : 'demo'}">${connected() ? 'свързан' : 'демо (без backend)'}</span>
      </div>

      <section class="panel">
        <div class="panel-head">
          <h2>${openP
        ? `Портал: ${esc(openP.title)}`
        : `Портали (${state.portals.length}) · файлове: ${totalFiles}`
      }</h2>
          ${openP
        ? `<div class="u-row u-row-1">
                   <button type="button" class="btn btn-sm" id="pf-test" title="${esc(base() || 'демо режим')}">Връзка</button>
                 </div>`
        : `<div class="u-row u-row-2">
                   <button type="button" class="btn btn-sm btn-primary" id="pf-new">Нов портал</button>
                   <button type="button" class="btn btn-sm" id="pf-test" title="${esc(base() || 'демо режим')}">Връзка</button>
                 </div>`
      }
        </div>
        <div class="panel-body">
          ${!openP && state.newPortal ? newPortalForm() : ''}
          ${openP
        ? ''
        : `<div class="fm-toolbar u-mb">
            <input id="pf-search" placeholder="Търси портал по име, slug или бележка" value="${esc(state.portalQuery)}" />
            <select id="pf-sort">
              ${[
          ['-date', 'Дата ↓ (най-нови)'],
          ['date', 'Дата ↑ (най-стари)'],
          ['title', 'Име A→Я'],
          ['-title', 'Име Я→A'],
        ]
          .map(([v, l]) => `<option value="${v}" ${state.portalSort === v ? 'selected' : ''}>${l}</option>`)
          .join('')}
            </select>
            <label class="hint row-check"><input type="checkbox" id="pf-notes-only" ${state.notesOnly ? 'checked' : ''}/> само с бележки</label>
          </div>`
      }
          <div class="pf-portals u-mt">
            ${list.length
        ? list.map((x) => portalCard(x, state.portals.indexOf(x), Boolean(openP))).join('')
        : '<p class="hint">Няма портал по това търсене.</p>'
      }
          </div>
          ${openP
        ? `<div class="u-row u-row-1 u-mt">
                   <button type="button" class="btn btn-primary" data-close-portal>← Списък с портали</button>
                 </div>`
        : ''
      }
          ${state.error ? `<p class="err-list">${esc(state.error)}</p>` : ''}
        </div>
      </section>`;

    wire();
  }

  /** Една карта на портал: в списъка се разгъва, а в самостоятелен изглед е „страница“. */
  function portalCard(x, i, single) {
    const api = state.api[x.id];
    const land = (api && api.landing) || `${publicBase()}/p/${x.id || x.slug}`;
    const ctc = contactOf(x.contactId);
    const kase = caseOf(x.caseId);
    return `<article class="pf-portal ${single ? 'pf-open pf-single' : ''}" data-portal="${i}">
                  <div class="pf-portal-head">
                    ${single
        ? `<h3 class="pf-portal-title">${esc(x.title)}</h3>`
        : `<button type="button" class="link-btn pf-portal-name" data-open-portal="${i}">▸ ${esc(
          x.title,
        )}</button>`
      }
                    <span class="flag-badge ${flagOf(x.flag).cls}" title="Флаг: ${esc(flagOf(x.flag).label)}">${flagOf(x.flag).icon
      } ${esc(flagOf(x.flag).label)}</span>
                    <span class="chip ${x.visibility === 'public' ? 'ok' : ''}" title="Видимост">${esc(x.visibility)}</span>
                    <code class="fm-code" title="Политика за достъп">${esc(x.access)}</code>
                    ${api
        ? `<span class="state-chip ok">API/QR</span><span class="chip">${esc(
          (api.at || '').slice(0, 16).replace('T', ' '),
        )}</span>`
        : '<span class="state-chip warn">няма API/QR</span>'
      }
                    ${apiMenu((api && api.refs && api.refs.apiUrl) || '', 'api.json', 'api.json')}
                    <button type="button" class="fm-ico-btn pf-pkg-btn" data-pkg-portal="${i}" title="Изтегли пакета (ZIP с всички файлове от хранилището: ${esc(
        x.storage_root || '/share',
      )})" aria-label="Изтегли пакета">${ICON.download}</button>
                  </div>
                  <hr class="u-divider" />
                  <p class="fm-file-sub">${ICON.topic} категория: <code>${esc(
        x.category || 'без категория',
      )}</code> · <strong>Относно:</strong> ${esc(x.subject || 'не е посочено')}</p>
                  <p class="fm-file-sub">${ico('person')} <strong>Контакт:</strong> ${ctc
        ? `${esc(contactLabel(ctc))}${ctc.phone ? ` · ${ICON.phone} ${esc(ctc.phone)}` : ''}${ctc.email ? ` · ${ICON.mail} ${esc(ctc.email)}` : ''}`
        : '<span class="hint">без контакт — добави от настройките на портала</span>'
      }</p>
                  <p class="fm-file-sub">${ico('case')} <strong>Дело:</strong> ${kase
        ? `${esc(caseLabel(kase))}${kase.category ? ` · ${esc(kase.category)}` : ''}${kase.subject ? ` · Относно: ${esc(kase.subject)}` : ''
        }`
        : '<span class="hint">без дело — добави от настройките на портала</span>'
      }</p>
                  ${(ctc && ctc.extras.length) || (kase && kase.extras.length)
        ? `<div class="fm-ico-row u-grid u-grid-chips">${[...(ctc ? ctc.extras : []), ...(kase ? kase.extras : [])]
          .map((y) => chip('•', y.key, y.value, `${y.key}: ${y.value}`))
          .join('')}</div>`
        : ''
      }
                  <p class="fm-file-sub">${ICON.id} id: <code>${esc(x.id)}</code> · slug: <code>${esc(
        x.slug,
      )}</code> · ${ICON.size} файлове: ${x.files.length} · ${ICON.folder} <code>${esc(
        x.storage_root || '/share',
      )}</code></p>
                  <div class="fm-ico-row u-grid u-grid-chips">
                    ${chip(ICON.created, 'Дата на създаване', x.createdAt || '—', fmtDate(x.createdAt))}
                    ${x.notes ? chip(ICON.modified, 'Бележки', x.notes, 'има бележка') : ''}
                    ${chip(ico('share'), 'Адрес на портала', land, land)}
                  </div>
                  ${x.notes ? `<p class="fm-file-notes">${ICON.modified} ${esc(x.notes)}</p>` : ''}
                  <hr class="u-divider" />
                  ${single
        ? ''
        : `<div class="u-row u-row-1">
                           <button type="button" class="btn btn-sm" data-open-portal="${i}">⚙ Отвори портала</button>
                         </div>`
      }
                  ${single ? `<div class="pf-panel-body">${portalDetail(x)}</div>` : ''}
                </article>`;
  }

  function newPortalForm() {
    const cats = [...new Set(state.portals.map((x) => x.category).filter(Boolean))].sort();
    return `
      <div class="pf-form u-mb">
        <h4>Нов портал</h4>
        <div class="u-grid u-grid-fields">
          <div class="field"><label>slug</label><input name="slug" placeholder="project-a" maxlength="63" /></div>
          <div class="field"><label>Заглавие</label><input name="title" placeholder="Project A" maxlength="160" /></div>
          <div class="field"><label>Относно</label><input name="subject" placeholder="напр. посещение на лице" maxlength="200" /></div>
          <div class="field"><label>Категория</label><input name="category" placeholder="напр. Правни дела" maxlength="120" list="pf-cats" />
            <datalist id="pf-cats">${cats.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
          <div class="field"><label>Флаг</label>
            <select name="flag">${FLAGS.map((f) => `<option value="${f.id}">${f.icon} ${esc(f.label)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Видимост</label>
            <select name="visibility"><option value="private">private</option><option value="public">public</option></select>
          </div>
        </div>
        <div class="field"><label>${ico('person')} Контакт (от контактите или нов)</label>
          ${contactSelect('')}
          ${newContactFields()}
        </div>
        <div class="field"><label>${ico('case')} Дело (case: от делата или ново)</label>
          ${caseSelect('')}
          ${newCaseFields()}
        </div>
        <div class="field"><label>${ICON.folder} Папка с файлове в хранилището</label>
          <input name="storage_root" list="pf-roots" value="/share" maxlength="240" placeholder="/share/portal-files" />
          <datalist id="pf-roots">${[...new Set(['/share', '/media', ...state.portals.map((x) => x.storage_root || '/share')])]
        .filter(Boolean)
        .sort()
        .map((r) => `<option value="${esc(r)}"></option>`)
        .join('')}</datalist>
          <small class="hint">Само под /share или /media. Пътят се пази към портала (storage_root).</small>
        </div>
        <div class="field"><label>${ICON.folder} Качи файловете от папка на компютъра</label>
          <input type="file" id="pf-folder" webkitdirectory directory multiple />
          <small class="hint">Избери папка — всички файлове в нея се качват в новия портал (подпапките стават „група“).</small>
        </div>
        <div class="u-grid u-grid-fields">
          <div class="field"><label>Описание</label><textarea name="description" rows="2"></textarea></div>
          <div class="field"><label>Бележки</label><textarea name="notes" rows="2" maxlength="2000" placeholder="вътрешни бележки към портала"></textarea></div>
        </div>
        <div class="u-row u-row-2">
          <button type="button" class="btn btn-primary" id="pf-create">Създай и генерирай API + QR</button>
          <button type="button" class="btn" id="pf-cancel">Отказ</button>
        </div>
      </div>`;
  }

  // ── Папки на портала: скриващо се меню за всяка папка ─────────────────────
  /** Пътят на папката, нормализиран за URL (?path=/a/b). */
  const treePath = (rel) => `/${String(rel || '').replace(/^\/+|\/+$/g, '')}`;

  /** Собствен адрес (api.json) на папка — публичен при свързан режим. */
  function folderApiUrl(rel, suffix) {
    const p = portal();
    if (!p) return '';
    const demo = Boolean(state.tree.data && state.tree.data.demo);
    const tail = demo ? 'storage' : 'tree' + (suffix === false ? '' : '/api.json');
    return `${publicBase()}/api/v1/p/${encodeURIComponent(p.slug)}/${tail}?path=${encodeURIComponent(treePath(rel))}`;
  }

  /** Демо дърво: папките идват от метаданните (тема → категория → група). */
  function demoTreeData(p) {
    const st = window.HapiStorageTree;
    const vs = window.HapiVirtualStorage;
    let tree = null;
    try {
      if (st && vs) tree = st.normalize(vs.buildTree(p.files || []));
    } catch {
      tree = null;
    }
    if (!tree) tree = { type: 'folder', name: '/', path: '', folders: [], files: [], folderCount: 0, fileCount: 0, bytes: 0 };
    return {
      portal: { id: p.id, slug: p.slug, title: p.title },
      storageRoot: p.storage_root || '/share',
      exists: true,
      truncated: false,
      demo: true,
      folderCount: tree.folderCount,
      fileCount: tree.fileCount,
      bytes: tree.bytes,
      tree,
    };
  }

  /** Зарежда папките на портала (при свързан режим — от add-on-а). */
  async function loadTree(force) {
    const p = portal();
    if (!p) return;
    if (!force && state.tree.loaded && state.tree.portalId === p.id) return;
    const fresh = state.tree.portalId !== p.id;
    // Дървото се зарежда СВИТО (open: null) — отваря се само папка, която потребителят избере.
    const open = fresh ? null : state.tree.open;
    if (!connected()) {
      // Демо: коментарите живеят само в паметта на интерфейса.
      if (fresh) {
        state.folderNotes = {};
        state.folderMeta = {};
      }
      state.tree = { portalId: p.id, loaded: true, error: '', open, data: demoTreeData(p) };
      return;
    }
    const r = await api(`/admin/api/portals/${encodeURIComponent(p.id)}/tree`);
    state.tree = {
      portalId: p.id,
      loaded: true,
      error: r.ok ? '' : r.error || `HTTP ${r.status}`,
      open,
      data: r.ok ? r.data : null,
    };
    // Коментарите и флаговете на папките идват заедно с дървото (ключът е път с водeщ „/“).
    state.folderNotes = (r.ok && r.data && r.data.folderNotes) || {};
    state.folderMeta = (r.ok && r.data && r.data.folderMeta) || {};
  }

  /** Флагове на папка: видима / медийна / заключена (по подразбиране: видима, не е медийна, отключена). */
  function folderFlags(rel) {
    const m = state.folderMeta[treePath(rel)] || null;
    return { visible: !m || m.visible !== false, media: Boolean(m && m.media), locked: Boolean(m && m.locked) };
  }

  /** Записва флаг на папка (свързан режим), после обновява дървото. */
  async function saveFolderFlag(rel, patch) {
    const p = portal();
    if (!p) return;
    if (!connected()) {
      const key = treePath(rel);
      state.folderMeta = Object.assign({}, state.folderMeta);
      state.folderMeta[key] = Object.assign({ visible: true, media: false, locked: false }, state.folderMeta[key], patch);
      render();
      return toast('Демо: флагът е само в интерфейса', '');
    }
    const r = await api(`/admin/api/portals/${encodeURIComponent(p.id)}/tree/folder`, { method: 'PATCH', json: { path: rel, ...patch } });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    const key = treePath(rel);
    state.folderMeta = Object.assign({}, state.folderMeta, { [key]: { visible: r.data.visible, media: r.data.media, locked: r.data.locked } });
    render();
    const labels = { visible: 'Видимост', media: 'Медийна', locked: 'Заключване' };
    const [name, value] = Object.entries(patch)[0] || ['', ''];
    return toast(`${labels[name] || 'Флаг'}: ${value ? 'включено' : 'изключено'}`, 'ok');
  }

  /**
   * Прикачва файлове в папката на портала (storage_root), като пази относителните
   * пътища на избраната папка (webkitRelativePath). Връща броя качени файлове.
   */
  async function uploadToStorage(folderRel, fileList) {
    const p = portal();
    const files = Array.from(fileList || []);
    if (!p || !files.length) return 0;
    if (!connected()) {
      toast('Демо: файловете се качват от add-on-а (свързан режим)', 'err');
      return 0;
    }
    const dirRel = String(folderRel || '').replace(/^\/+|\/+$/g, '');
    let done = 0;
    const failed = [];
    for (const file of files) {
      const rel = String(file.webkitRelativePath || file.name || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
      if (!rel) continue;
      const target = dirRel ? `${dirRel}/${rel}` : rel;
      const r = await api(`${P()}/tree/upload?path=${encodeURIComponent('/' + target)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (r.ok) done += 1;
      else failed.push(`${rel}: ${r.error || `HTTP ${r.status}`}`);
    }
    await loadTree(true);
    render();
    if (failed.length) toast(`Прикачени ${done}, неуспешни ${failed.length} · ${failed[0]}`, 'err');
    else toast(`Прикачени ${done} ${done === 1 ? 'файл' : 'файла'} в ${treePath(dirRel)}`, 'ok');
    return done;
  }

  /** Изтегля пакет само за една папка от хранилището. */
  async function packageFolder(rel) {
    const p = portal();
    if (!p) return;
    if (!connected()) return toast('Демо: пакетът се създава от add-on-а (свързан режим)', '');
    const r = await api('/admin/api/packages', { method: 'POST', json: { portalId: p.id, storagePath: treePath(rel) } });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    const signed = r.data.hasSignature ? ' · подписан' : '';
    toast(`Пакет ${r.data.fileName} · ${r.data.files} файла · ${fmtSize(r.data.size)}${signed}`, 'ok');
    await downloadUrl(`${base()}/admin/api/packages/${r.data.id}/download`, r.data.fileName);
    if (r.data.hasSignature) await downloadUrl(`${base()}/admin/api/packages/${r.data.id}/signature`, `${r.data.fileName}.asc`);
  }

  /** Създава папка в отворената папка (или в корена) през административното API. */
  async function createFolder(name) {
    const p = portal();
    if (!p) return;
    const value = String(name || '').trim();
    if (!value) return toast('Въведи име на папката', 'err');
    if (!connected()) return toast('Демо: папки се създават от add-on-а (свързан режим)', 'err');
    const parent = state.tree.open || '';
    const r = await api(`/admin/api/portals/${encodeURIComponent(p.id)}/tree/folder`, {
      method: 'POST',
      json: { parent, name: value },
    });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    state.newFolder = false;
    state.tree.loaded = false;
    await loadTree(true);
    // Новата папка се отваря, за да се види веднага (отворена е само тя).
    state.tree.open = String((r.data && r.data.path) || '').replace(/^\/+/, '');
    render();
    toast(`Създадена е папка ${r.data.path || value}`, 'ok');
  }

  /** Коментар към папка: пази се към портала; празен текст го изтрива. */
  async function saveFolderComment(rel, text) {
    const p = portal();
    if (!p) return;
    const key = treePath(rel);
    const value = String(text == null ? '' : text);
    if (!connected()) {
      state.folderNotes = Object.assign({}, state.folderNotes);
      if (value.trim()) state.folderNotes[key] = { text: value.trim(), at: new Date().toISOString() };
      else delete state.folderNotes[key];
      render();
      return toast('Демо: коментарът е само в интерфейса', '');
    }
    const r = await api(`/admin/api/portals/${encodeURIComponent(p.id)}/tree/comment`, {
      method: 'POST',
      json: { path: rel, comment: value },
    });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    state.folderNotes = (r.data && r.data.notes) || {};
    render();
    toast(value.trim() ? 'Коментарът е запазен' : 'Коментарът е изчистен', 'ok');
  }

  /** Контекст за трите контейнера на портала (контролен панел · папки · файлове). */
  function panelCtx(p) {
    const scope = state.tree.open || '';
    return {
      p,
      state,
      api: state.api[p.id] || null,
      files: p.files || [],
      scope,
      scoped: filesForFolder(scope),
      visible: visibleFiles(),
      // помощни функции — едни и същи за всички контейнери
      esc,
      chip,
      metaChips,
      plural,
      fmtSize,
      fmtDate,
      ICON,
      FLAGS,
      fileGlyph,
      // Една и съща икона навсякъде: модулите викат ico('download') вместо свои глифове.
      ico,
      treePath,
      folderApiUrl,
      apiMenu,
      qrSvg,
      connected,
      publicBase,
      folderFlags,
      stateOf,
      actionsPane,
      // Списъкът с действия се ползва и от изскачащото меню ⚙ на файла.
      ACTIONS: ACTIONS.concat(EXTRA_ACTIONS),
      contactSelect,
      caseSelect,
      newContactFields,
      newCaseFields,
      uploadForm,
    };
  }

  /** Един модул за контейнер (ако файлът не е зареден, блокът се пропуска). */
  function panel(mod, ctx) {
    return mod && typeof mod.render === 'function' ? mod.render(ctx) : '';
  }

  /**
   * Отвореният портал: ТРИ САМОСТОЯТЕЛНИ контейнера (всеки със собствена рамка):
   * контролен панел · папки на портала · файлове в портала. Всеки блок се рисува от
   * собствения си JS файл (ui/portal-control.js, ui/portal-folders.js, ui/portal-files.js).
   */
  function portalDetail(p) {
    const ctx = panelCtx(p);
    return `<div class="pf-panels">
        ${panel(window.HapiPortalControl, ctx)}
        ${panel(window.HapiPortalFolders, ctx)}
        ${panel(window.HapiPortalFiles, ctx)}
      </div>`;
  }

  /** Регистрира файл от папката на диска в портала (после картата става пълна). */
  async function registerStorageFile(rel) {
    const p = portal();
    if (!p || !rel) return;
    if (!connected()) return toast('Демо: регистрирането става от add-on-а (свързан режим)', 'err');
    const r = await api(`${P()}/tree/register`, { method: 'POST', json: { path: rel } });
    if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
    await loadPortals();
    await loadTree(true);
    render();
    toast(`Файлът ${r.data.name} е регистриран в портала`, 'ok');
  }

  function filePane(f) {
    switch (state.panel) {
      case 'versions':
        return versionsPane(f);
      case 'metadata':
        return metadataForm(f);
      case 'rename':
        return renameForm(f);
      case 'access':
        return accessForm(f);
      case 'share':
        return sharePane(f);
      case 'note':
        return notePane(f);
      case 'signedUrl':
        return signedUrlPane(f);
      case 'receipt':
        return receiptPane(f);
      case 'verifyReceipt':
        return verifyReceiptPane(f);
      default:
        return actionsPane(f);
    }
  }

  // ── Подписан URL, разписка и проверка на разписка ─────────────────────
  // Три реални административни маршрута, които преди съществуваха само в API-то.
  function signedUrlPane(f) {
    return `<form class="fm-form" data-signed-url>
      <p class="hint">Подписан URL важи само за файлове с публичен достъп (FREE); за защитени файлове
        add-on-ът отказва с 403. Ключът за подпис се сменя от „Контролен панел → Сигурност“.</p>
      <div class="field"><label>Валидност (секунди, 1–86400)</label>
        <input name="ttlSeconds" type="number" min="1" max="86400" value="300" required />
      </div>
      <button type="submit" class="btn btn-primary">Издай подписан URL</button>
      <output class="fm-out" data-signed-url-out aria-live="polite"></output>
    </form>`;
  }

  function receiptPane(f) {
    return `<form class="fm-form" data-receipt>
      <p class="hint">Разписката е HMAC-SHA256 върху SHA-256 на файла и момента на издаване. Тя се
        проверява с текущия ключ на портала — смяна на ключа прави старите разписки непроверими.</p>
      <div class="u-row u-row-2">
        <button type="submit" class="btn btn-primary">Издай разписка</button>
      </div>
      <output class="fm-out" data-receipt-out aria-live="polite"></output>
    </form>`;
  }

  function verifyReceiptPane(f) {
    return `<form class="fm-form" data-verify-receipt>
      <p class="hint">Постави разписката (JSON или низ), за да провериш дали е издадена от този портал.</p>
      <div class="field"><label>Разписка</label>
        <textarea name="receipt" rows="5" required placeholder='{"fileId":"…","sha256":"…","issuedAt":"…","mac":"…"}'></textarea>
      </div>
      <button type="submit" class="btn btn-primary">Провери</button>
      <output class="fm-out" data-verify-receipt-out aria-live="polite"></output>
    </form>`;
  }

  /** Меню за API: показва адреса, при натискане → копирай / отвори / изтегли. */
  function apiMenu(url, label, extra) {
    if (!url) return '';
    return `<div class="fm-menu-wrap">
      <button type="button" class="btn btn-sm" data-api-menu title="${esc(url)}">API ▾</button>
      <div class="fm-menu" hidden>
        <p class="hint u-mb">${esc(url)}</p>
        <button type="button" class="fm-menu-item" data-api-copy="${esc(url)}" title="Копирай адреса"><span aria-hidden="true">${ICON.copy}</span> <span class="fm-menu-label">Копирай</span></button>
        <button type="button" class="fm-menu-item" data-api-open="${esc(url)}" title="Отвори в изскачащ прозорец"><span aria-hidden="true">${ICON.open}</span> <span class="fm-menu-label">Отвори</span></button>
        <button type="button" class="fm-menu-item" data-api-dl="${esc(url)}" data-api-name="${esc(label || 'api.json')}" title="Изтегли файла"><span aria-hidden="true">${ICON.download}</span> <span class="fm-menu-label">Изтегли ${esc(extra || label || 'api.json')}</span></button>
      </div>
    </div>`;
  }

  // ── Изскачащ прозорец (преглед) — вътре в приложението ───────────────────
  let modalBlob = '';

  function ensureModal() {
    let m = document.getElementById('fm-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'fm-modal';
    m.className = 'fm-modal';
    m.hidden = true;
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'fm-modal-title');
    m.innerHTML = `<div class="fm-modal-box">
      <div class="fm-modal-head">
        <strong id="fm-modal-title">VIEW</strong>
        <span class="u-ml"></span>
        <button type="button" class="btn btn-sm" id="fm-modal-dl" title="Изтегли">Изтегли</button>
        <button type="button" class="btn btn-sm" id="fm-modal-close" title="Затвори">Затвори</button>
      </div>
      <div class="fm-modal-body" id="fm-modal-body"></div>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', (e) => {
      if (e.target === m) closeModal();
    });
    m.querySelector('#fm-modal-close').addEventListener('click', closeModal);
    return m;
  }
  function closeModal() {
    const m = document.getElementById('fm-modal');
    if (!m) return;
    const back = m._returnFocus;
    m.hidden = true;
    m.dataset.kind = '';
    m._returnFocus = null;
    m.querySelector('#fm-modal-body').innerHTML = '';
    if (modalBlob) {
      URL.revokeObjectURL(modalBlob);
      modalBlob = '';
    }
    // Затварянето на панел връща картата в основния изглед.
    if (state.panel !== 'actions') {
      state.panel = 'actions';
      state.versions = null;
      state.issuedKey = '';
      if (host) render();
    }
    if (back && back.focus) back.focus();
  }
  /** Показва HTML текст или URL (iframe) в модалния прозорец. */
  function showModal(title, opts) {
    const o = opts || {};
    const m = ensureModal();
    m.querySelector('#fm-modal-title').textContent = title;
    const body = m.querySelector('#fm-modal-body');
    body.innerHTML = o.html ? o.html : `<iframe src="${esc(o.url || 'about:blank')}" title="${esc(title)}"></iframe>`;
    const dl = m.querySelector('#fm-modal-dl');
    dl.hidden = !o.downloadName;
    dl.onclick = o.downloadName ? () => downloadFromModal(o.downloadName) : null;
    dl.dataset.name = o.downloadName || '';
    // Запомняме фокуса, за да го върнем при затваряне (достъпност).
    m._returnFocus = document.activeElement;
    m.hidden = false;
    const close = m.querySelector('#fm-modal-close');
    if (close) close.focus();
    return m;
  }
  /** Изтегляне от модала: ползва текущия blob (без препратки). */
  function downloadFromModal(name) {
    if (!modalBlob) return toast('Няма съдържание за изтегляне', 'err');
    const a = document.createElement('a');
    a.href = modalBlob;
    a.download = name || 'file';
    a.rel = 'noopener';
    a.click();
  }

  /** Затваря панела на действие (прозореца) без да пипа списъка. */
  function closePanel() {
    state.panel = 'actions';
    state.versions = null;
    state.issuedKey = '';
    const m = document.getElementById('fm-modal');
    if (m && m.dataset.kind === 'panel') {
      m.hidden = true;
      m.dataset.kind = '';
      m.querySelector('#fm-modal-body').innerHTML = '';
    }
  }

  // ── Панелите на действията се отварят в изскачащ прозорец ───────────────
  const PANEL_TITLES = {
    versions: 'Версии',
    metadata: 'Метаданни',
    rename: 'Преименувай',
    access: 'Достъп',
    share: 'Сподели / QR',
    note: 'Бележка',
  };
  function openPanelModal() {
    const f = current();
    if (!f) return undefined;
    const m = showModal(`${PANEL_TITLES[state.panel] || 'Действия'} · ${f.name}`, {
      html: `<div class="fm-detail">${filePane(f)}</div>`,
    });
    m.dataset.kind = 'panel';
    wirePanelHandlers(m.querySelector('#fm-modal-body'));
    // Хешовете са част от стандартния изглед — зареждат се веднага.
    ensureHashes(f);
    return m;
  }
  /** Пречертава съдържанието на отворения панел (след запис/зареждане). */
  function refreshPanel() {
    const m = document.getElementById('fm-modal');
    const f = current();
    if (!m || m.hidden || m.dataset.kind !== 'panel' || !f) return;
    const body = m.querySelector('#fm-modal-body');
    body.innerHTML = `<div class="fm-detail">${filePane(f)}</div>`;
    wirePanelHandlers(body);
  }
  /** Пречертава списъка и (ако е отворен) панела в прозореца. */
  function renderAll() {
    render();
    refreshPanel();
  }

  /** Закача обработчиците на панела — ползва се и в картата, и в прозореца. */
  function wirePanelHandlers(root) {
    if (!root) return;
    const q = (s) => root.querySelector(s);
    if (q('#fm-meta-form')) {
      q('#fm-meta-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveMetadata(e.target);
      });
    }
    if (q('#fm-rename-form')) {
      q('#fm-rename-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveRename(e.target.name.value);
      });
    }
    if (q('#fm-note-form')) {
      q('#fm-note-form').addEventListener('submit', (e) => {
        e.preventDefault();
        void saveNote(e.target.notes.value);
      });
      if (q('#fm-note-clear')) q('#fm-note-clear').addEventListener('click', () => void saveNote(''));
    }
    if (q('#fm-access-form')) {
      q('#fm-access-form').addEventListener('submit', (e) => {
        e.preventDefault();
        saveAccess(e.target.mode.value, e.target.listed.checked);
      });
    }
    if (q('#fm-version-upload')) {
      q('#fm-version-upload').addEventListener('click', () =>
        uploadVersion(q('#fm-version-file'), q('#fm-version-note').value),
      );
    }
    root.querySelectorAll('[data-restore]').forEach((el) => {
      el.addEventListener('click', () => restoreVersion(Number(el.dataset.restore)));
    });
    if (q('#fm-copy-link')) {
      q('#fm-copy-link').addEventListener('click', () => copyText(webLink(current()), 'Адресът е копиран'));
    }
    if (q('#fm-create-key')) q('#fm-create-key').addEventListener('click', createKey);
    // Подписан URL, разписка и проверка — трите реални маршрута под файла.
    if (q('[data-signed-url]')) {
      q('[data-signed-url]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const f = current();
        const out = q('[data-signed-url-out]');
        const ttlSeconds = Number(event.target.ttlSeconds.value);
        if (!f) return;
        if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400) {
          out.textContent = 'Валидността трябва да е цяло число между 1 и 86400 секунди.';
          out.className = 'fm-out err';
          return;
        }
        out.textContent = 'Издавам…';
        out.className = 'fm-out';
        const r = await api(`${P()}/files/${encodeURIComponent(f.id)}/signed-url`, { method: 'POST', json: { ttlSeconds } });
        if (!r.ok) {
          out.textContent = r.error || `HTTP ${r.status}`;
          out.className = 'fm-out err';
          return;
        }
        out.textContent = `${location.origin}${r.data.path}`;
        out.className = 'fm-out ok';
        copyText(`${location.origin}${r.data.path}`, 'Подписаният URL е копиран');
      });
    }
    if (q('[data-receipt]')) {
      q('[data-receipt]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const f = current();
        const out = q('[data-receipt-out]');
        if (!f) return;
        out.textContent = 'Издавам…';
        out.className = 'fm-out';
        const r = await api(`${P()}/files/${encodeURIComponent(f.id)}/sign`, { method: 'POST', json: {} });
        if (!r.ok) {
          out.textContent = r.error || `HTTP ${r.status}`;
          out.className = 'fm-out err';
          return;
        }
        const receipt = typeof r.data.receipt === 'string' ? r.data.receipt : JSON.stringify(r.data.receipt);
        out.textContent = receipt;
        out.className = 'fm-out ok';
        copyText(receipt, 'Разписката е копирана');
      });
    }
    if (q('[data-verify-receipt]')) {
      q('[data-verify-receipt]').addEventListener('submit', async (event) => {
        event.preventDefault();
        const f = current();
        const out = q('[data-verify-receipt-out]');
        if (!f) return;
        const raw = event.target.receipt.value.trim();
        if (!raw) return;
        let receipt = raw;
        try {
          receipt = JSON.parse(raw);
        } catch {
          /* оставяме низа — сървърът решава валиден ли е */
        }
        const r = await api(`${P()}/files/${encodeURIComponent(f.id)}/verify-signature`, { method: 'POST', json: { receipt } });
        if (!r.ok) {
          out.textContent = r.error || `HTTP ${r.status}`;
          out.className = 'fm-out err';
          return;
        }
        out.textContent = r.data.valid
          ? `Разписката е валидна · ключ ${r.data.keyId || '—'}`
          : `Разписката е НЕВАЛИДНА: ${r.data.reason || 'несъответствие'}`;
        out.className = 'fm-out ' + (r.data.valid ? 'ok' : 'err');
      });
    }
    wireHashHandlers(root);
    if (q('#fm-back')) {
      q('#fm-back').addEventListener('click', () => {
        state.panel = 'actions';
        state.versions = null;
        state.issuedKey = '';
        render();
      });
    }
  }

  /** Обработчици на блока с хешовете (ползват се и при частично пречертаване). */
  function wireHashHandlers(root) {
    if (!root) return;
    const q = (s) => root.querySelector(s);
    const hashesFor = (f) => (state.hashes && state.hashes.fileId === (f && f.id) ? state.hashes : null);
    if (q('#fm-hash-stack')) {
      q('#fm-hash-stack').addEventListener('click', () => {
        const f = current();
        if (f) void loadHashStack(f);
      });
    }
    // Копиране на целия пакет хешове и изтегляне като checksums.txt.
    if (q('#fm-hash-copy')) {
      q('#fm-hash-copy').addEventListener('click', () => {
        const f = current();
        const h = hashesFor(f);
        if (!f || !h || !h.hashes) return toast('Хешовете още не са изчислени', 'err');
        copyText(hashLines(h).join('\n'), 'Всички хешове са копирани');
      });
    }
    if (q('#fm-hash-file')) {
      q('#fm-hash-file').addEventListener('click', () => {
        const f = current();
        const h = hashesFor(f);
        if (!f || !h || !h.hashes) return toast('Хешовете още не са изчислени', 'err');
        downloadText(`checksums-${f.name.replace(/[^\w.-]+/g, '_')}.txt`, checksumsText(f, h));
      });
    }
  }

  // ── Делегирани менюта и действия (еднократно) ───────────────────────────
  let menusWired = false;
  async function openInModal(url, title) {
    if (!connected()) {
      return showModal(`OPEN · ${title || 'API'}`, {
        html: `<p class="hint">Демо: адресът е примерен.</p><pre>${esc(url)}</pre>`,
      });
    }
    try {
      const res = await fetch(url, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
      if (!res.ok) return toast(`HTTP ${res.status}`, 'err');
      const text = await res.text();
      showModal(`OPEN · ${title || 'API'}`, { html: `<pre>${esc(text.slice(0, 200000))}</pre>` });
    } catch (e) {
      toast(`Няма връзка: ${e.message}`, 'err');
    }
  }
  async function downloadUrl(url, name) {
    if (!connected()) return toast('Демо: изтеглянето изисква свързан add-on', '');
    try {
      const res = await fetch(url, { headers: token() ? { Authorization: `Bearer ${token()}` } : {} });
      if (!res.ok) return toast(`HTTP ${res.status}`, 'err');
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = name || 'download';
      a.rel = 'noopener';
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 60000);
      toast('Изтеглено', 'ok');
    } catch (e) {
      toast(`Няма връзка: ${e.message}`, 'err');
    }
  }
  function closeAllMenus() {
    document.querySelectorAll('.fm-menu').forEach((m) => {
      m.hidden = true;
      m.style.position = '';
      m.style.left = '';
      m.style.top = '';
      m.style.maxHeight = '';
      m.style.overflowY = '';
      // Менюто се връща при бутона си, за да не остава в body.
      if (m._wrap && m.parentElement === document.body) m._wrap.appendChild(m);
    });
  }
  function wireMenus() {
    if (menusWired) return;
    menusWired = true;
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target && e.target.closest ? e.target : null;
        if (!t) return;
        const copy = t.closest('[data-copy], [data-api-copy]');
        if (copy) {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('.fm-menu').forEach((m) => {
            m.hidden = true;
          });
          copyText(copy.dataset.copy || copy.dataset.apiCopy);
          return;
        }
        const openBtn = t.closest('[data-api-open]');
        if (openBtn) {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('.fm-menu').forEach((m) => {
            m.hidden = true;
          });
          openInModal(openBtn.dataset.apiOpen, openBtn.title || 'API');
          return;
        }
        const dl = t.closest('[data-api-dl]');
        if (dl) {
          e.preventDefault();
          e.stopPropagation();
          document.querySelectorAll('.fm-menu').forEach((m) => {
            m.hidden = true;
          });
          downloadUrl(dl.dataset.apiDl, dl.dataset.apiName);
          return;
        }
        const btn = t.closest('[data-api-menu]');
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          const wrap = btn.parentElement;
          const menu = wrap ? wrap.querySelector('.fm-menu') : null;
          if (!menu) return;
          const open = menu.hidden;
          document.querySelectorAll('.fm-menu').forEach((m) => {
            m.hidden = true;
            m.style.position = '';
            m.style.left = '';
            m.style.top = '';
          });
          menu.hidden = !open;
          btn.setAttribute('aria-expanded', String(open));
          if (open) {
            // Менюто е fixed; ширината му е процентна (CSS), тук само го пазим във viewport-а.
            const r = btn.getBoundingClientRect();
            menu.style.position = 'fixed';
            menu.style.maxHeight = `${window.innerHeight - 24}px`;
            menu.style.overflowY = 'auto';
            const w = menu.getBoundingClientRect().width;
            menu.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - w - 12))}px`;
            const h = menu.getBoundingClientRect().height;
            let top = r.bottom + 6;
            if (top + h > window.innerHeight - 12) top = r.top - 6 - h;
            top = Math.max(12, Math.min(top, window.innerHeight - h - 12));
            menu.style.top = `${Math.max(12, top)}px`;
          }
          return;
        }
        if (t.closest('.fm-menu')) return;
        document.querySelectorAll('.fm-menu').forEach((m) => {
          m.hidden = true;
        });
      },
      true,
    );
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const modal = document.getElementById('fm-modal');
      if (modal && !modal.hidden) return closeModal();
      document.querySelectorAll('.fm-menu').forEach((m) => {
        m.hidden = true;
      });
    });
  }

  function actionsPane(f) {
    const st = stateOf(f);
    // Действията са бутони (както в първоначалната версия); самите панели се отварят в прозорец.
    return `
      <div class="fm-actions">
        ${ACTIONS.concat(EXTRA_ACTIONS)
        .map(
          (a) =>
            `<button type="button" class="btn fm-action ${a.id === 'lock' && f.locked ? 'fm-action-on' : ''}" data-act="${a.id
            }" ${a.planned ? 'disabled title="Планирано (v2)"' : ''}><span aria-hidden="true">${ico(a.icon)}</span> ${esc(
              a.label,
            )}${a.planned ? ' <small>v2</small>' : ''}</button>`,
        )
        .join('')}
      </div>
      <div class="u-row u-row-2 u-mt">
        ${apiMenu(webLink(f), f.name, 'файл')}
        ${apiMenu(qrUrl(f), 'qr.svg', 'qr.svg')}
      </div>
      <h4 class="u-mt">Пълни данни</h4>
      <dl class="fm-meta">
        <dt>Име</dt><dd>${esc(f.name)}</dd>
        <dt>id</dt><dd><code>${esc(f.id)}</code></dd>
        <dt>Размер</dt><dd>${fmtSize(f.size)} (${f.size} B)</dd>
        <dt>Версия</dt><dd>${f.version}</dd>
        <dt>Политика</dt><dd><code>${esc(f.accessMode)}</code></dd>
        <dt>Видим</dt><dd>${f.listed ? 'да — показва се в публичния каталог' : 'не — само с адрес/ключ'}</dd>
        <dt>Състояние</dt><dd><span class="state-chip ${st.cls}">${esc(st.label)}</span></dd>
        <dt>Шифрован</dt><dd>${f.encrypted ? 'да (AES-256-GCM)' : 'не'}</dd>
        <dt>Тема</dt><dd>${esc(f.topic || '—')}</dd>
        <dt>Категория</dt><dd>${esc(f.category || '—')}</dd>
        <dt>Група</dt><dd>${esc(f.group || '—')}</dd>
        <dt>Тагове</dt><dd>${esc(f.tags.length ? f.tags.join(', ') : '—')}</dd>
        <dt>Бележки</dt><dd>${esc(f.notes || '—')}</dd>
        <dt>${ICON.created} Създаден</dt><dd>${esc(f.createdAt || '—')}</dd>
        <dt>${ICON.uploaded} Качен</dt><dd>${esc(f.uploadedAt || '—')}</dd>
        <dt>${ICON.modified} Последна промяна</dt><dd>${esc(f.modifiedAt || '—')}</dd>
        <dt>${ICON.hash} SHA-256</dt><dd>${f.sha256 ? `<code class="fm-hash">${esc(f.sha256)}</code>` : '—'}</dd>
        <dt>${ICON.locked} Заключване</dt><dd>${f.locked ? `заключен от ${esc(f.lockedBy || 'admin')}` : 'не е заключен'
      }</dd>
        <dt>DL URL</dt><dd class="fm-url"><code>${esc(webLink(f))}</code><button type="button" class="fm-ico-btn fm-copy-btn" data-copy="${esc(
        webLink(f),
      )}" title="Копирай адреса" aria-label="Копирай адреса за изтегляне">${ICON.copy}</button></dd>
        <dt>QR URL</dt><dd class="fm-url"><code>${esc(qrUrl(f))}</code><button type="button" class="fm-ico-btn fm-copy-btn" data-copy="${esc(
        qrUrl(f),
      )}" title="Копирай адреса" aria-label="Копирай адреса на QR кода">${ICON.copy}</button></dd>
      </dl>
      ${hashStack(f)}
      ${state.lastAction ? `<p class="hint">Последно действие: ${esc(state.lastAction)}</p>` : ''}`;
  }

  function versionsPane(f) {
    const v = state.versions;
    return `
      ${!v
        ? '<p class="hint">Зареждане…</p>'
        : v.error
          ? `<p class="err-list">${esc(v.error)}</p>`
          : `<p class="hint">Текуща версия ${v.current ? v.current.version : f.version} · ${fmtSize(
            v.current ? v.current.size : f.size,
          )}${v.demo ? ' · демо' : ''}</p>
               <table class="grid">
                 <thead><tr><th>Версия</th><th>Размер</th><th>Дата</th><th></th></tr></thead>
                 <tbody>${(v.versions || [])
            .map(
              (x) => `<tr><td>v${x.version}</td><td>${fmtSize(x.size)}</td><td>${esc(fmtDate(x.uploadedAt))}</td>
                       <td><button type="button" class="btn btn-sm" data-restore="${x.version}">Възстанови</button></td></tr>`,
            )
            .join('') || '<tr><td colspan="4" class="hint">Няма предишни версии</td></tr>'}</tbody>
               </table>
               <h4 class="u-mt">Нова версия</h4>
               <div class="field"><label>Файл</label><input type="file" id="fm-version-file" /></div>
               <div class="field"><label>Бележка</label><input id="fm-version-note" maxlength="200" /></div>
               <button type="button" class="btn btn-primary" id="fm-version-upload">Качи версия</button>`
      }`;
  }

  // Пълен набор хешове: етикети и дължини (за да е видимо, че нищо не липсва).
  const HASH_LABELS = {
    sha256: 'SHA-256',
    sha512: 'SHA-512',
    sha384: 'SHA-384',
    'sha3-256': 'SHA3-256',
    blake2b512: 'BLAKE2b-512',
    sha1: 'SHA-1',
    md5: 'MD5',
  };
  const HASH_BITS = { sha256: 256, sha512: 512, sha384: 384, 'sha3-256': 256, blake2b512: 512, sha1: 160, md5: 128 };
  /** Хешовете на текущия файл като редове „етикет<TAB>стойност“ (за копиране/файл). */
  function hashLines(h) {
    if (!h || !h.hashes) return [];
    return Object.keys(h.hashes).map((a) => `${HASH_LABELS[a] || a}\t${h.hashes[a]}`);
  }
  /** Всички хешове като текст (checksums.txt) — за изтегляне/сверка извън приложението. */
  function checksumsText(f, h) {
    const head = [
      `# ${f.name}`,
      `# id: ${f.id}`,
      `# размер: ${h.size} B · изчислено: ${h.computedAt || ''}`,
      `# регистриран SHA-256 при качване: ${f.sha256 || '—'}`,
      `# съвпадение: ${h.match ? 'да' : 'НЕ'}`,
      '',
    ];
    return head.concat(hashLines(h)).join('\n') + '\n';
  }

  /** Пълен стек с хешове: SHA-2 (256/384/512), SHA3-256, SHA-1, MD5 — с копиране и файл. */
  function hashStack(f) {
    const h = state.hashes && state.hashes.fileId === f.id ? state.hashes : null;
    const loading = Boolean(h && h.loading);
    const values = h && h.hashes ? Object.keys(h.hashes) : [];
    const body = h && h.error
      ? `<p class="err-list">${esc(h.error)}</p>`
      : loading
        ? '<p class="hint">Изчисляване на хешовете…</p>'
        : h
          ? `<p class="hint">Изчислени от съдържанието${f.encrypted ? ' (след декриптиране)' : ''
          } · ${fmtSize(h.size)} (${h.size} B) · ${esc(fmtDate(h.computedAt))} · ${values.length} алгоритъма</p>
             <dl class="fm-meta">
               <dt>Регистриран SHA-256<br /><small class="hint">при качване</small></dt>
               <dd class="fm-url"><code class="fm-hash">${esc(f.sha256 || '—')}</code>${f.sha256
            ? `<button type="button" class="fm-ico-btn fm-copy-btn" data-copy="${esc(
              f.sha256,
            )}" title="Копирай регистрирания SHA-256" aria-label="Копирай регистрирания SHA-256">${ICON.copy}</button>`
            : ''
          }</dd>
               ${values
            .map(
              (a) =>
                `<dt>${esc(HASH_LABELS[a] || a)}<br /><small class="hint">${HASH_BITS[a] || ''} бита · ${(h.hashes[a] || '').length
                } hex</small></dt>
                      <dd class="fm-url"><code class="fm-hash">${esc(h.hashes[a])}</code><button type="button" class="fm-ico-btn fm-copy-btn" data-copy="${esc(
                  h.hashes[a],
                )}" title="Копирай ${esc(HASH_LABELS[a] || a)}" aria-label="Копирай ${esc(
                  HASH_LABELS[a] || a,
                )}">${ICON.copy}</button></dd>`,
            )
            .join('')}
             </dl>
             ${h.match
            ? '<p class="state-chip ok u-mt">SHA-256 съвпада с регистрирания при качване</p>'
            : `<p class="err-list">${esc(h.warning || 'SHA-256 не съвпада с регистрирания при качване')}</p>`
          }
             <div class="u-row u-row-3 u-mt">
               <button type="button" class="btn btn-sm" id="fm-hash-copy">${ICON.copy} Копирай всички</button>
               <button type="button" class="btn btn-sm" id="fm-hash-file">${ICON.download} checksums.txt</button>
               <button type="button" class="btn btn-sm" id="fm-hash-stack">${ICON.refresh} Изчисли отново</button>
             </div>`
          : `<p class="hint">Пълният набор хешове се изчислява от съдържанието на файла${f.encrypted ? ' (след декриптиране)' : ''
          }.</p>
             <div class="u-row u-row-1 u-mt">
               <button type="button" class="btn" id="fm-hash-stack">${ICON.refresh} Изчисли всички хешове</button>
             </div>`;
    return `
      <section class="fm-hash-block" data-hash-block="${esc(f.id)}">
        <hr class="u-divider strong" />
        <h4>Пълен пакет хешове</h4>
        ${body}
      </section>`;
  }

  /** Пречертава САМО блока с хешовете (в картата и в модала), без да пипа формата. */
  function paintHashes(f) {
    const html = hashStack(f);
    // Съдържанието се взима от вътрешността на <section>, за да не се влагат блокове.
    const inner = html.replace(/^[\s\S]*?<section[^>]*>/, '').replace(/<\/section>\s*$/, '');
    document.querySelectorAll('[data-hash-block]').forEach((el) => {
      if (el.dataset.hashBlock !== f.id) return;
      el.innerHTML = inner;
      wireHashHandlers(el);
    });
  }

  /** Зарежда пълния стек с хешове за текущия файл (веднъж на файл). */
  async function loadHashStack(f) {
    if (!f) return undefined;
    if (!connected()) {
      state.hashes = { fileId: f.id, error: 'Демо: хешовете се изчисляват от add-on-а (свързан режим).' };
      return paintHashes(f);
    }
    if (state.hashes && state.hashes.fileId === f.id && state.hashes.loading) return undefined;
    state.hashes = { fileId: f.id, loading: true };
    paintHashes(f);
    const r = await api(`${FP(f)}/hashes`);
    state.hashes = r.ok ? Object.assign({ fileId: f.id }, r.data) : { fileId: f.id, error: r.error || `HTTP ${r.status}` };
    return paintHashes(f);
  }

  /** Хешовете се зареждат автоматично при отваряне на файла — стандартният изглед. */
  function ensureHashes(f) {
    if (!f || !connected()) return;
    if (state.hashes && state.hashes.fileId === f.id && !state.hashes.error) return;
    void loadHashStack(f);
  }

  function metadataForm(f) {
    return `
      <form id="fm-meta-form">
        <div class="field"><label>Тема</label><input name="topic" value="${esc(f.topic)}" maxlength="120" /></div>
        <div class="field"><label>Категория</label><input name="category" value="${esc(f.category)}" maxlength="120" /></div>
        <div class="field"><label>Група</label><input name="group" value="${esc(f.group)}" maxlength="120" /></div>
        <div class="field"><label>Тагове (през запетая)</label><input name="tags" value="${esc(f.tags.join(', '))}" /></div>
        <div class="field"><label>Бележки</label><textarea name="notes" rows="2" maxlength="2000">${esc(f.notes || '')}</textarea></div>
        <button type="submit" class="btn btn-primary">Запази</button>
      </form>
      ${hashStack(f)}`;
  }

  function renameForm(f) {
    return `
      <form id="fm-rename-form">
        <div class="field"><label>Име на файла</label><input name="name" value="${esc(f.name)}" maxlength="240" /></div>
        <button type="submit" class="btn btn-primary">Преименувай</button>
      </form>`;
  }

  function accessForm(f) {
    return `
      <form id="fm-access-form">
        <div class="field"><label>Политика</label>
          <select name="mode">${['FREE', 'KEY_REQUIRED', 'DISABLED']
        .map((m) => `<option ${m === f.accessMode ? 'selected' : ''}>${m}</option>`)
        .join('')}</select>
        </div>
        <div class="checks"><label><input type="checkbox" name="listed" ${f.listed ? 'checked' : ''}/> Показва се в публичния каталог</label></div>
        <p class="hint">Порталната политика остава в сила: файлът не може да е по-достъпен от портала.</p>
        <button type="submit" class="btn btn-primary">Запази</button>
      </form>`;
  }

  function sharePane(f) {
    return `
      <div class="field"><label>Публичен адрес за изтегляне</label><input readonly value="${esc(webLink(f))}" /></div>
      <div class="field"><label>QR код</label><input readonly value="${esc(qrUrl(f))}" /></div>
      <div class="u-row u-row-2">
        <button type="button" class="btn btn-sm" id="fm-copy-link">${ICON.copy} Копирай адреса</button>
        <button type="button" class="btn btn-sm" id="fm-create-key">Нов ключ</button>
      </div>
      ${state.issuedKey
        ? `<div class="field"><label>Ключ (показва се само веднъж)</label><input readonly value="${esc(
          state.issuedKey,
        )}" /></div><p class="hint">Подава се като <code>X-Portal-Key</code>.</p>`
        : ''
      }
      <p class="hint">Ако файлът е скрит (не е listed), адресът работи само с ключ.</p>`;
  }

  function uploadForm() {
    return `
      <form id="fm-upload-form">
        <div class="field"><label>Файл</label><input type="file" name="input" /></div>
        <div class="field"><label>Име (по избор)</label><input name="name" placeholder="остави празно за оригиналното име" maxlength="240" /></div>
        <div class="field"><label>Политика</label>
          <select name="access"><option>FREE</option><option>KEY_REQUIRED</option><option>DISABLED</option></select>
        </div>
        <div class="checks"><label><input type="checkbox" name="encrypt" /> Шифровай съдържанието (AES-256-GCM)</label></div>
        <div class="u-row u-row-2">
          <button type="submit" class="btn btn-primary">Качи</button>
          <button type="button" class="btn" id="fm-back">← Затвори</button>
        </div>
      </form>`;
  }

  function wire() {
    const q = (sel) => host.querySelector(sel);
    // „Нов портал“ съществува само в списъка (при отворен портал го няма).
    if (q('#pf-new')) {
      q('#pf-new').addEventListener('click', () => {
        state.newPortal = !state.newPortal;
        render();
      });
    }
    if (q('#pf-test')) q('#pf-test').addEventListener('click', testConnection);
    if (q('#pf-create')) {
      q('#pf-create').addEventListener('click', () => {
        const form = q('.pf-form');
        createPortal(form);
      });
    }
    if (q('#pf-cancel')) {
      q('#pf-cancel').addEventListener('click', () => {
        state.newPortal = false;
        render();
      });
    }
    [
      ['contactId', '.pf-contact-new', NEW_CONTACT],
      ['caseId', '.pf-case-new', NEW_CASE],
    ].forEach(([name, boxSelector, newValue]) => {
      host.querySelectorAll(`[name="${name}"]`).forEach((sel) => {
        const field = sel.closest('.field');
        const box = field ? field.querySelector(boxSelector) : null;
        if (!box) return;
        const sync = () => {
          box.hidden = sel.value !== newValue;
        };
        sel.addEventListener('change', sync);
        sync();
      });
    });
    host.querySelectorAll('.pf-form, #pf-settings').forEach(wireExtras);
    // Щракване върху портал отваря САМО него (списъкът се скрива), а в края на
    // страницата има бутон „← Списък с портали“.
    host.querySelectorAll('[data-open-portal]').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.openPortal);
        const target = state.portals[i];
        if (!target) return;
        state.portalIndex = i;
        state.openPortal = target.id;
        state.selected = null;
        state.panel = 'actions';
        state.selectedIds.clear();
        state.versions = null;
        state.newFolder = false;
        state.folderNotes = {};
        // Всеки портал има API + QR: в демо режим се изчисляват при отваряне.
        if (!connected() && !state.api[target.id]) generateApi(target, true);
        // Дървото на папките е за конкретен портал — при смяна се чете наново.
        if (state.tree.portalId !== target.id) void loadTree().then(render);
        render();
      });
    });
    host.querySelectorAll('[data-close-portal]').forEach((el) => {
      el.addEventListener('click', () => {
        state.openPortal = null;
        state.selected = null;
        state.selectedIds.clear();
        state.newFolder = false;
        render();
      });
    });
    host.querySelectorAll('[data-pkg-portal]').forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.pkgPortal);
        const target = state.portals[i];
        if (!target) return;
        state.portalIndex = i;
        void buildPackage({ portalId: target.id, includeStorage: true });
      });
    });
    // „Контролен панел на портала“ се сгъва/разгъва от заглавието си.
    host.querySelectorAll('[data-pf-control-tog]').forEach((el) => {
      el.addEventListener('click', () => {
        state.controlOpen = state.controlOpen === false;
        render();
      });
    });
    if (q('#pf-settings')) {
      q('#pf-settings').addEventListener('submit', (e) => {
        e.preventDefault();
        savePortal(e.target);
      });
    }
    // API/QR се създават заедно с портала — няма бутон „Генерирай“.
    if (q('#pf-dl-api') && state.api[portal().id]) {
      q('#pf-dl-api').addEventListener('click', () => downloadJson(`api-${portal().slug}.json`, state.api[portal().id].record));
    }
    if (q('#pf-dl-openapi') && state.api[portal().id]) {
      q('#pf-dl-openapi').addEventListener('click', () =>
        downloadJson(`openapi-${portal().slug}.json`, state.api[portal().id].openapi),
      );
    }
    if (q('#pf-copy-refs') && state.api[portal().id]) {
      q('#pf-copy-refs').addEventListener('click', () =>
        copyText(JSON.stringify(state.api[portal().id].refs, null, 2), 'Препратките са копирани'),
      );
    }
    // Сигурност на портала: ротация на ключа и проверка за цялост (реални административни
    // маршрути; без тях функциите съществуваха само в API).
    const securityOut = q('#pf-security-out');
    const say = (text, kind) => {
      if (!securityOut) return toast(text, kind);
      securityOut.textContent = text;
      securityOut.className = 'pf-security-out ' + (kind || '');
    };
    if (q('#pf-rotate-key')) {
      q('#pf-rotate-key').addEventListener('click', async () => {
        const p = portal();
        if (!p) return;
        if (!connected()) return say('Демо: смяната на ключа става от add-on-а', 'err');
        if (!window.confirm(`Да обновя ли ключа за подпис на „${p.title}“? Всички издадени досега подписани URL-и спират да важат.`)) return;
        const r = await api(`${P()}/signing-key`, { method: 'POST', json: {} });
        if (!r.ok) return say(r.error || `HTTP ${r.status}`, 'err');
        say('Ключът е обновен — старите подписани URL-и са невалидни.', 'ok');
      });
    }
    if (q('#pf-integrity')) {
      q('#pf-integrity').addEventListener('click', async () => {
        if (!connected()) return say('Демо: проверката се изпълнява от add-on-а', 'err');
        say('Проверявам SHA-256 на файловете…', '');
        const r = await api(`${P()}/integrity`);
        if (!r.ok) return say(r.error || `HTTP ${r.status}`, 'err');
        const summary = r.data.summary || {};
        say(
          `Проверени ${r.data.checked ?? summary.checked ?? 0} файла · съвпадат ${summary.ok ?? 0} · разминават се ${summary.mismatch ?? 0} · липсват ${summary.missing ?? 0}`,
          (summary.mismatch || summary.missing) ? 'err' : 'ok',
        );
      });
    }
    if (q('#pf-integrity-job')) {
      q('#pf-integrity-job').addEventListener('click', async () => {
        if (!connected()) return say('Демо: фоновата проверка се пуска от add-on-а', 'err');
        const r = await api(`${P()}/integrity-jobs`, { method: 'POST', json: {} });
        if (!r.ok) return say(r.error || `HTTP ${r.status}`, 'err');
        const jobId = r.data.jobId || r.data.id || '';
        say(`Фоновата проверка е в опашката${jobId ? ` (задача ${jobId})` : ''}. Прогресът е в „Настройки → Задачи“.`, 'ok');
      });
    }

    if (q('#fm-search')) {
      q('#fm-search').addEventListener('input', (e) => {
        const value = e.target.value;
        state.query = value;
        render();
        const el = host.querySelector('#fm-search');
        if (el) {
          el.focus();
          el.setSelectionRange(value.length, value.length);
        }
      });
      q('#fm-type').addEventListener('change', (e) => {
        state.type = e.target.value;
        render();
      });
      q('#fm-access').addEventListener('change', (e) => {
        state.access = e.target.value;
        render();
      });
      q('#fm-sort').addEventListener('change', (e) => {
        state.sort = e.target.value;
        render();
      });
    }
    if (q('#fm-upload')) q('#fm-upload').addEventListener('click', () => runAction('upload'));

    if (q('#fm-topic')) {
      q('#fm-topic').addEventListener('change', (e) => {
        state.topic = e.target.value;
        render();
      });
    }
    if (q('#fm-category')) {
      q('#fm-category').addEventListener('change', (e) => {
        state.category = e.target.value;
        render();
      });
    }
    if (q('#pf-search')) {
      q('#pf-search').addEventListener('input', (e) => {
        const value = e.target.value;
        state.portalQuery = value;
        render();
        const el = host.querySelector('#pf-search');
        if (el) {
          el.focus();
          el.setSelectionRange(value.length, value.length);
        }
      });
    }
    if (q('#pf-sort')) {
      q('#pf-sort').addEventListener('change', (e) => {
        state.portalSort = e.target.value;
        render();
      });
    }
    if (q('#pf-notes-only')) {
      q('#pf-notes-only').addEventListener('change', (e) => {
        state.notesOnly = e.target.checked;
        render();
      });
    }
    if (q('#fm-bulk-apply')) q('#fm-bulk-apply').addEventListener('click', () => applyBulk(q('#fm-bulk-mode').value));

    // Експлорер на папките: отваря се само една папка, обновяване и QR на папка.
    host.querySelectorAll('[data-folder]').forEach((el) => {
      el.addEventListener('click', () => {
        const rel = el.dataset.folder || '';
        // Щракване върху отворената папка я затваря; иначе всички останали се затварят.
        state.tree.open = state.tree.open === rel ? null : rel;
        render();
      });
    });
    if (q('#fm-new-folder')) {
      q('#fm-new-folder').addEventListener('click', () => {
        state.newFolder = !state.newFolder;
        render();
        const input = host.querySelector('#fm-new-folder-name');
        if (input) input.focus();
      });
    }
    if (q('#fm-new-folder-cancel')) {
      q('#fm-new-folder-cancel').addEventListener('click', () => {
        state.newFolder = false;
        render();
      });
    }
    if (q('#fm-new-folder-form')) {
      q('#fm-new-folder-form').addEventListener('submit', (e) => {
        e.preventDefault();
        void createFolder(q('#fm-new-folder-name') ? q('#fm-new-folder-name').value : '');
      });
    }
    host.querySelectorAll('[data-folder-comment-save]').forEach((el) => {
      el.addEventListener('click', () => {
        const rel = el.dataset.folderCommentSave || '';
        const box = host.querySelector(`[data-folder-comment="${CSS.escape(rel)}"]`);
        void saveFolderComment(rel, box ? box.value : '');
      });
    });
    host.querySelectorAll('[data-folder-comment-clear]').forEach((el) => {
      el.addEventListener('click', () => {
        const rel = el.dataset.folderCommentClear || '';
        void saveFolderComment(rel, '');
      });
    });
    if (q('#fm-tree-refresh')) {
      q('#fm-tree-refresh').addEventListener('click', async () => {
        await loadTree(true);
        render();
        toast(state.tree.error || 'Папките са прочетени наново', state.tree.error ? 'err' : 'ok');
      });
    }
    host.querySelectorAll('[data-folder-qr]').forEach((el) => {
      el.addEventListener('click', () => {
        const rel = el.dataset.folderQr || '';
        const url = folderApiUrl(rel);
        const svg = qrSvg(url);
        showModal(`QR · ${treePath(rel)}`, {
          html: `${svg ? `<div class="qf-svg">${svg}</div>` : '<p class="hint">QR SVG не е наличен в тази среда.</p>'}<p class="hint"><code>${esc(
            url,
          )}</code></p>`,
        });
      });
    });
    // Иконите на папка: ⚙ меню (коментар/видима/медийна/заключване), добави файл, пакет.
    host.querySelectorAll('[data-folder-gear]').forEach((el) => {
      el.addEventListener('click', () => {
        const rel = el.dataset.folderGear || '';
        state.gear = state.gear === rel ? null : rel;
        render();
      });
    });
    host.querySelectorAll('[data-folder-comment-open]').forEach((el) => {
      el.addEventListener('click', () => {
        const rel = el.dataset.folderCommentOpen || '';
        state.gear = null;
        state.tree.open = rel;
        render();
        const box = host.querySelector(`[data-folder-comment="${CSS.escape(rel)}"]`);
        if (box) box.focus();
      });
    });
    host.querySelectorAll('[data-folder-flag-btn]').forEach((el) => {
      el.addEventListener('click', () => {
        const rel = el.dataset.folderFlagPath || '';
        const flag = el.dataset.folderFlagBtn || '';
        if (!flag) return;
        const current = folderFlags(rel);
        // Щракването върху точка от менюто го затваря (както контекстно меню).
        state.gear = null;
        void saveFolderFlag(rel, { [flag]: !current[flag] });
      });
    });
    // Прикачване: файл/папка отиват в избраната папка (по подразбиране отворената).
    const pickFiles = (folderRel) => {
      const input = q('#fm-file-input');
      if (!input) return;
      input.value = '';
      input.dataset.target = folderRel == null ? state.tree.open || '' : folderRel;
      input.click();
    };
    const pickDir = (folderRel) => {
      const input = q('#fm-dir-input');
      if (!input) return;
      input.value = '';
      input.dataset.target = folderRel == null ? state.tree.open || '' : folderRel;
      input.click();
    };
    host.querySelectorAll('[data-attach-file]').forEach((el) => el.addEventListener('click', () => pickFiles()));
    host.querySelectorAll('[data-import-folder]').forEach((el) => el.addEventListener('click', () => pickDir()));
    host.querySelectorAll('[data-folder-upload]').forEach((el) =>
      el.addEventListener('click', () => pickFiles(el.dataset.folderUpload || '')),
    );
    host.querySelectorAll('[data-folder-pkg]').forEach((el) =>
      el.addEventListener('click', () => void packageFolder(el.dataset.folderPkg || '')),
    );
    host.querySelectorAll('[data-register-file]').forEach((el) =>
      el.addEventListener('click', () => void registerStorageFile(el.dataset.registerFile || '')),
    );
    host.querySelectorAll('[data-toggle-filters]').forEach((el) => {
      el.addEventListener('click', () => {
        state.filters = !state.filters;
        render();
      });
    });
    if (q('#fm-file-input')) {
      q('#fm-file-input').addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) void uploadToStorage(e.target.dataset.target || '', files);
        e.target.value = '';
      });
    }
    if (q('#fm-dir-input')) {
      q('#fm-dir-input').addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length) void uploadToStorage(e.target.dataset.target || '', files);
        e.target.value = '';
      });
    }

    // Икони на файла: eye / eye-off за видимост и lock / unlock за заключване.
    host.querySelectorAll('[data-file-listed]').forEach((el) => {
      el.addEventListener('click', () => void toggleListed(el.dataset.fileListed || ''));
    });
    host.querySelectorAll('[data-file-lock]').forEach((el) => {
      el.addEventListener('click', () => {
        const f = fileById(el.dataset.fileLock || '');
        if (!f) return toast('Файлът не е намерен', 'err');
        void toggleLock(f);
      });
    });
    // ⚙ на файла: изскачащо контекстно меню (като при папките) — отворено е най-много едно.
    host.querySelectorAll('[data-file-gear]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.fileGear || '';
        state.fileGear = state.fileGear === id ? null : id;
        render();
      });
    });
    // Ред от менюто: избира файла и изпълнява същото действие като плочката в панела.
    host.querySelectorAll('[data-file-act]').forEach((el) => {
      el.addEventListener('click', () => {
        const act = el.dataset.fileAct || '';
        const id = el.dataset.fileId || '';
        state.fileGear = null;
        if (!id || !act) return render();
        state.selected = id;
        state.panel = 'actions';
        void runAction(act);
      });
    });
    host.querySelectorAll('[data-open-file]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.openFile;
        state.selected = state.selected === id ? null : id;
        state.panel = 'actions';
        state.issuedKey = '';
        state.versions = null;
        render();
        // Отвореният файл показва и пълния пакет хешове (стандартен изглед).
        if (state.selected) ensureHashes(fileById(state.selected));
      });
    });
    host.querySelectorAll('[data-pick]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.pick;
        if (state.selectedIds.has(id)) state.selectedIds.delete(id);
        else state.selectedIds.add(id);
        render();
      });
    });
    host.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', () => runAction(el.dataset.act)));
    wirePanelHandlers(host);
    if (q('#fm-upload-form')) {
      q('#fm-upload-form').addEventListener('submit', (e) => {
        e.preventDefault();
        uploadFile(e.target);
      });
    }
  }

  function downloadJson(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    // Връзката се закача за документа — иначе някои браузъри игнорират клика.
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Изтегля произволен текстов файл (напр. checksums.txt) без сървър. */
  function downloadText(name, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Копиране в клипборда (без препратки и без нови табове). */
  async function copyText(text, okMessage) {
    const ok = okMessage || 'Копирано';
    try {
      if (navigator.clipboard && window.isSecureContext && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.className = 'u-hidden';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      toast(ok, 'ok');
    } catch {
      toast('Копирането не е позволено от браузъра', 'err');
    }
  }

  async function testConnection() {
    if (!connected()) {
      return toast('Демо режим: отвори GUI-я през add-on-а (Ingress), за да работи с реални данни', '');
    }
    try {
      const res = await fetch(base() + '/health');
      if (!res.ok) return toast(`HTTP ${res.status} от ${base()}`, 'err');
      await reload();
      render();
      toast(`Връзка: ${base()}`, 'ok');
    } catch (e) {
      toast(`Няма връзка: ${e.message}`, 'err');
    }
  }

  function mount(node) {
    host = node;
    wireMenus();
    // Менюто ⚙ се затваря при щракване извън него — като контекстно меню.
    if (!mount.gearBound) {
      mount.gearBound = true;
      document.addEventListener('click', (e) => {
        if (state.gear === null && state.fileGear === null) return;
        const target = e.target;
        if (
          target &&
          target.closest &&
          (target.closest('.fm-gear') || target.closest('[data-folder-gear]') || target.closest('[data-file-gear]'))
        ) {
          return;
        }
        state.gear = null;
        state.fileGear = null;
        render();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && (state.gear !== null || state.fileGear !== null)) {
          state.gear = null;
          state.fileGear = null;
          render();
        }
      });
    }
    // Долната лента не бива да казва „ДЕМО“, когато има реална връзка.
    if (connected()) {
      const bar = document.getElementById('bar-center');
      if (bar) bar.textContent = `Свързан · ${base()}`;
    }
    if (connected()) {
      // Свързан режим: списъкът идва от add-on-а, демо данните не се смесват с реалните.
      loadContacts()
        .catch(() => { })
        .then(loadCases)
        .catch(() => { })
        .then(loadPortals)
        .catch(() => { })
        .then(reload)
        .catch(() => { })
        .then(loadConnection)
        .catch(() => { })
        .then(loadTree)
        .catch(() => { })
        .then(render);
      return;
    }
    if (!state.portals.length) seed();
    // Изходно състояние е списъкът с портали (портал се отваря с щракване).
    state.portals.forEach((p) => {
      if (!state.api[p.id]) generateApi(p, true);
    });
    render();
  }

  const API = {
    ACTIONS,
    EXTRA_ACTIONS,
    ICON,
    FLAGS,
    mount,
    state,
    normalizeFile,
    normalizeContact,
    normalizeCase,
    // За тестовете: свързването „файл от дървото ↔ регистриран файл“ е чиста функция.
    bindFolderFiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.FilesManagerPanel = API;
})();
