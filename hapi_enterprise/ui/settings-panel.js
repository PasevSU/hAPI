'use strict';
// Настройки на връзката: админ токен, API адрес и публичен адрес за API/QR.
//
// Токенът се пази само в sessionStorage (затваря се с таба), адресът на API-то —
// в localStorage, а публичният адрес е сървърна настройка (`limits.publicBaseUrl`),
// защото по него се строят адресите в QR кодовете и api.json.
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => window.HapiUI && window.HapiUI.toast(m, k);
  // Съдържанието на панела минава през общия речник (ui/i18n.js), за да не е „менюто
  // преведено, а екранът — не“ (BUG-11). Без речник пада на българския ключ.
  const T = (key) => (window.HapiI18n ? window.HapiI18n.t(key) : String(key));

  let host = null;
  const state = {
    base: '',
    token: '',
    role: '',
    ingress: false,
    publicBaseUrl: '',
    health: '',
    busy: false,
    loaded: false,
    // Активна секция на „Настройки“: 'general' или id от SECTIONS.
    section: 'general',
    // PGP: прикачени ключове + настройки на автоподписването на пакетите.
    pgp: { loaded: false, keys: [], settings: { autoSign: false, signKeyId: '' }, error: '', attached: null },
  };

  const storedBase = () => localStorage.getItem('hapi.apiBase') || '';
  const storedToken = () => sessionStorage.getItem('hapiAdminToken') || '';
  const defaultBase = () => (location.protocol === 'file:' ? '' : location.origin);
  const effectiveBase = () => (state.base || storedBase() || defaultBase()).replace(/\/$/, '');
  const connected = () => Boolean(effectiveBase());

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {});
    const token = storedToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (o.json !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(effectiveBase() + path, {
        method: o.method || 'GET',
        headers,
        body: o.json !== undefined ? JSON.stringify(o.json) : undefined,
      });
      const type = res.headers.get('Content-Type') || '';
      // `raw: true` е за текстови отговори (напр. Prometheus метрики), които не са JSON.
      const data = type.includes('application/json') ? await res.json() : o.raw ? await res.text() : null;
      return { ok: res.ok, status: res.status, error: res.ok ? '' : (data && data.error) || `HTTP ${res.status}`, data };
    } catch (e) {
      return { ok: false, status: 0, error: e.message, data: null };
    }
  }

  async function loadConnection() {
    if (!connected()) {
      state.loaded = true;
      return render();
    }
    const r = await api('/admin/api/connection');
    if (r.ok && r.data) {
      state.role = r.data.role || '';
      state.ingress = r.data.ingress === true;
      state.publicBaseUrl = r.data.publicBaseUrl || '';
      state.health = 'ok';
    } else {
      state.health = r.status === 0 ? 'no-connection' : r.status === 401 || r.status === 403 ? 'unauthorized' : 'error';
    }
    state.loaded = true;
    // ВАЖНО: връзката се зарежда асинхронно и може да пристигне СЛЕД като потребителят е
    // отворил секция и е натиснал бутон. Безусловното `render()` изтриваше това, което
    // той вижда (напр. току-що издадения CMS подпис) и полетата се оказваха празни.
    // Затова се пре-рисува само екранът „Основни“, който показва връзката.
    if (!state.section || state.section === 'general') render();
    void loadPgp();
  }

  // ── PGP ключ и автоподписване ───────────────────────────────────────────
  // Ключът се ПРИКАЧА (armored блок), не се генерира в add-on-а. След като има
  // прикачен ключ се показва падащото меню за автоподписване на пакетите.
  async function loadPgp() {
    if (!connected()) {
      state.pgp.loaded = true;
      return render();
    }
    const r = await api('/admin/api/pgp/keys');
    if (r.ok && r.data) {
      state.pgp.keys = r.data.keys || [];
      state.pgp.settings = Object.assign({}, state.pgp.settings, r.data.settings || {});
      state.pgp.error = '';
    } else {
      state.pgp.error = r.error || `HTTP ${r.status}`;
    }
    state.pgp.loaded = true;
    // Същата причина като в `loadConnection`: PGP статусът идва асинхронно и не бива да
    // изтрива секцията, в която потребителят вече работи. PGP блокът е в „Основни“.
    if (!state.section || state.section === 'general') render();
  }

  async function attachPgpKey() {
    const q = (sel) => host.querySelector(sel);
    const armored = q('#set-pgp-key').value.trim();
    const label = q('#set-pgp-label').value.trim();
    if (!armored) return toast('Постави armored PGP ключ (PRIVATE KEY BLOCK)', 'err');
    state.busy = true;
    const r = await api('/admin/api/pgp/keys', { method: 'POST', json: { label, secretArmored: armored } });
    state.busy = false;
    if (!r.ok) {
      state.pgp.error = r.error || `HTTP ${r.status}`;
      return toast(state.pgp.error, 'err');
    }
    state.pgp.attached = r.data;
    state.pgp.error = '';
    q('#set-pgp-key').value = '';
    q('#set-pgp-label').value = '';
    toast(`Прикачен ключ ${r.data.keyId} (v${r.data.version || 4})`, 'ok');
    return loadPgp();
  }

  async function importPgpBundle() {
    const r = await api('/admin/api/pgp/keys/import', { method: 'POST' });
    if (!r.ok) {
      state.pgp.error = r.error || `HTTP ${r.status}`;
      return toast(state.pgp.error, 'err');
    }
    const imported = (r.data && r.data.imported) || [];
    const skipped = (r.data && r.data.skipped) || [];
    state.pgp.error = '';
    toast(
      imported.length
        ? `Импортирани ${imported.length} ключ(а) от папка keys/`
        : skipped.length
          ? `Няма нови ключове (${skipped.length} пропуснати)`
          : 'Папката keys/ е празна или липсва',
      imported.length ? 'ok' : 'err',
    );
    return loadPgp();
  }

  async function savePgpSettings(patch) {
    const r = await api('/admin/api/packages/settings', { method: 'PATCH', json: patch });
    if (!r.ok) {
      state.pgp.error = r.error || `HTTP ${r.status}`;
      toast(state.pgp.error, 'err');
      return render();
    }
    state.pgp.settings = Object.assign({}, state.pgp.settings, r.data || {});
    state.pgp.error = '';
    toast(state.pgp.settings.autoSign ? 'Автоподписването е включено' : 'Автоподписването е изключено', 'ok');
    return render();
  }

  async function removePgpKey(id) {
    if (!id) return undefined;
    const r = await api(`/admin/api/pgp/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) {
      state.pgp.error = r.error || `HTTP ${r.status}`;
      return toast(state.pgp.error, 'err');
    }
    toast('Ключът е премахнат', 'ok');
    return loadPgp();
  }

  function pgpSection() {
    const p = state.pgp;
    const keys = p.keys || [];
    const on = connected() && state.role === 'admin';
    const autoSign = p.settings.autoSign === true;
    const badge = !keys.length ? '<span class="badge demo">няма ключ</span>' : `<span class="badge ok">${keys.length} ключ${keys.length === 1 ? '' : 'а'}</span>`;
    const keyList = !keys.length
      ? ''
      : `<div class="set-keys">
          ${keys
        .map(
          (k) => `<div class="set-key">
            <div class="set-key-line">
              <span class="chip">${esc(k.label || 'PGP ключ')}</span>
              <span class="state-chip ${Number(k.version) === 6 ? 'ok' : 'warn'}">OpenPGP v${Number(k.version) || 4}</span>
              <span class="badge">${esc(k.algorithm || '')}${k.bits ? ` ${k.bits}` : ''}</span>
              ${k.source === 'bundle' ? '<span class="badge">от папка keys/</span>' : ''}
              ${(k.roles || []).map((role) => `<span class="badge">${esc(role)}</span>`).join('')}
              <code>${esc(k.keyId || '')}</code>
            </div>
            <p class="hint">${esc(k.fingerprint || '')}</p>
            <div class="u-row u-row-1"><button type="button" class="btn" data-pgp-remove="${esc(k.id)}" ${on ? '' : 'disabled'}>Премахни</button></div>
          </div>`,
        )
        .join('')}
        </div>`;
    const autosignControls = !keys.length
      ? ''
      : `<div class="u-grid u-grid-fields">
            <div class="field">
              <label>Автоподписване с PGP</label>
              <select id="set-pgp-autosign" ${on ? '' : 'disabled'}>
                <option value="off" ${autoSign ? '' : 'selected'}>Изключено</option>
                <option value="on" ${autoSign ? 'selected' : ''}>Включено</option>
              </select>
              <small class="hint">Всеки създаден пакет се подписва автоматично (ZIP + .asc).</small>
            </div>
            ${keys.length > 1
        ? `<div class="field"><label>Ключ за подписване</label>
              <select id="set-pgp-keyid" ${on ? '' : 'disabled'}>
                ${keys
          .map(
            (k) =>
              `<option value="${esc(k.id)}" ${p.settings.signKeyId === k.id ? 'selected' : ''}>${esc(k.label)} · ${esc(k.keyId)}</option>`,
          )
          .join('')}
              </select></div>`
        : ''
      }
          </div>`;
    return `
      <section class="panel u-mt">
        <div class="panel-head"><h2>PGP ключ и автоподписване</h2>${badge}</div>
        <div class="panel-body">
          <p class="hint">Ключът се прикача като armored блок (PRIVATE KEY BLOCK) и се пази шифрован в базата. Поддържат се OpenPGP v4 и v6 (RFC 9580); ключът трябва да е без парола.</p>
          <div class="u-grid u-grid-fields">
            <div class="field">
              <label>Име на ключа</label>
              <input id="set-pgp-label" placeholder="напр. hAPI Enterprise signing" ${on ? '' : 'disabled'} />
            </div>
          </div>
          <div class="field u-mt">
            <label>PGP ключ (armored)</label>
            <textarea id="set-pgp-key" rows="6" spellcheck="false" placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----" ${on ? '' : 'disabled'
      }></textarea>
            <small class="hint">Публичната част се извлича автоматично от секретния блок.</small>
          </div>
          <div class="u-row u-row-1 u-mt">
            <button type="button" class="btn btn-primary" id="set-pgp-attach" ${on ? '' : 'disabled'}>Прикачи ключа</button>
            <button type="button" class="btn" id="set-pgp-import" ${on ? '' : 'disabled'}>Импорт от папка keys/</button>
          </div>
          ${autosignControls}
          ${keyList}
          ${p.error ? `<p class="hint" id="set-pgp-error"><span class="state-chip err">грешка</span> ${esc(p.error)}</p>` : ''}
        </div>
      </section>`;
  }

  function statusLine() {
    if (!connected()) return '<span class="state-chip warn">демо режим</span> адресът на API-то е празен';
    if (state.health === 'unauthorized') return '<span class="state-chip err">неоторизиран</span> провери токена';
    if (state.health === 'no-connection') return '<span class="state-chip err">няма връзка</span> провери адреса';
    if (state.health === 'error') return '<span class="state-chip warn">грешка</span> сървърът отговори с грешка';
    return `<span class="state-chip ok">свързан</span> роля <code>${esc(state.role || '—')}</code>${state.ingress ? ' · през Home Assistant Ingress' : ''
      }`;
  }

  // ── Секции на „Настройки“ ─────────────────────────────────────────────────
  // Десетте административни секции живеят ТУК, а не в главното меню: то остава късо,
  // а всичко „под капака“ се отваря от едно място. Всяка секция показва реални данни от
  // административния API и — където има смисъл — предлага самото действие.
  const SECTIONS = [
    { id: 'hierarchy', label: 'section.hierarchy' },
    { id: 'cabinet', label: 'section.cabinet' },
    { id: 'taxonomy', label: 'section.taxonomy' },
    { id: 'jobs', label: 'section.jobs' },
    { id: 'users', label: 'section.users' },
    { id: 'variables', label: 'section.variables' },
    { id: 'data', label: 'section.data' },
    { id: 'diagnostics', label: 'section.diagnostics' },
    { id: 'analytics', label: 'section.analytics' },
    { id: 'security', label: 'section.security' },
    { id: 'qr', label: 'section.qr' },
    { id: 'cms', label: 'section.cms' },
    { id: 'storage', label: 'section.storage' },
    { id: 'backups', label: 'section.backups' },
    { id: 'logs', label: 'section.logs' },
  ];

  const sectionCache = {};
  // Живо обновяване на „Задачи“ (Фаза 5): таймерът съществува само докато секцията е отворена.
  let jobsTimer = null;

  function stopJobsTimer() {
    if (jobsTimer) {
      clearInterval(jobsTimer);
      jobsTimer = null;
    }
  }

  const fmtBytes = (n) => {
    const v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1024 / 1024).toFixed(1) + ' MB';
  };
  const fmtTime = (v) => {
    if (!v) return '—';
    const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  };
  const table = (head, rows) =>
    rows.length
      ? '<table class="grid"><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr>' + r.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
      : '<p class="hint">Няма данни.</p>';

  function renderTabs() {
    const current = state.section || 'general';
    const tab = (id, label) =>
      '<button type="button" class="set-tab' + (current === id ? ' active' : '') + '" data-section="' + esc(id) + '"' +
      (current === id ? ' aria-current="true"' : '') + '>' + esc(label) + '</button>';
    return '<nav class="set-tabs" aria-label="' + esc(T('aria.sections')) + '">' + tab('general', T('tab.general')) + SECTIONS.map((s) => tab(s.id, T(s.label))).join('') + '</nav>';
  }

  function bindTabs() {
    host.querySelectorAll('.set-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.section = btn.getAttribute('data-section') || 'general';
        render();
      });
    });
  }

  // Зарежда данните за секция (с кеш за сесията, за да не се дърпа при всяко цъкане).
  async function loadSection(id) {
    if (sectionCache[id]) return sectionCache[id];
    const out = { error: '', data: null };
    if (!connected()) {
      out.error = 'Няма връзка с add-on-а — задай адрес и токен в „Основни“.';
      return out;
    }
    const grab = async (path) => api(path).then((r) => (r.ok ? r.data : null));
    if (id === 'hierarchy') {
      const [portals, groups, records] = await Promise.all([
        grab('/admin/api/portals'),
        grab('/admin/api/v2/groups'),
        grab('/admin/api/v2/records'),
      ]);
      out.data = {
        portals: (portals && portals.portals) || [],
        groups: (groups && groups.groups) || [],
        records: (records && records.records) || [],
      };
    } else if (id === 'cabinet') {
      out.data = await grab('/admin/api/cabinet/info');
    } else if (id === 'taxonomy') {
      out.data = await grab('/admin/api/taxonomy');
    } else if (id === 'jobs') {
      out.data = await grab('/admin/api/jobs');
    } else if (id === 'users') {
      out.data = await grab('/admin/api/users');
    } else if (id === 'variables') {
      out.data = await grab('/admin/api/variables');
    } else if (id === 'data') {
      const [secrets, portals] = await Promise.all([
        grab('/admin/api/v2/secrets'),
        grab('/admin/api/portals'),
      ]);
      out.data = { secrets: (secrets && secrets.secrets) || [], portals: (portals && portals.portals) || [] };
    } else if (id === 'diagnostics') {
      const [diag, load, metrics, who, portal, qr] = await Promise.all([
        grab('/admin/api/diagnostics'),
        grab('/admin/api/load'),
        grab('/admin/api/metrics'),
        grab('/admin/api/whoami'),
        grab('/admin/api/evidence-portal/status'),
        grab('/admin/api/qr-artifacts'),
      ]);
      out.data = { diag, load, metrics, who, portal, qr };
    } else if (id === 'analytics') {
      const [sensors, metrics] = await Promise.all([grab('/admin/api/sensors'), grab('/admin/api/metrics')]);
      out.data = { sensors, metrics };
    } else if (id === 'security') {
      const [audit, who] = await Promise.all([grab('/admin/api/audit/verify'), grab('/admin/api/whoami')]);
      out.data = { audit, who };
    } else if (id === 'qr') {
      out.data = await grab('/admin/api/qr-artifacts');
    } else if (id === 'cms') {
      // Подписът не зависи от данни от сървъра: формата се показва и преди избор на файл,
      // а реалната проверка е в действията долу.
      const who = await grab('/admin/api/whoami');
      out.data = { role: (who && who.role) || '' };
    } else if (id === 'storage') {
      const [status, retention] = await Promise.all([grab('/admin/api/storage/status'), grab('/admin/api/retention')]);
      out.data = { status, retention };
    } else if (id === 'backups') {
      const [list, schedule] = await Promise.all([grab('/admin/api/database/backups'), grab('/admin/api/database/backup-schedule')]);
      out.data = { backups: (list && list.backups) || [], mirror: list && list.mirror, schedule };
    } else if (id === 'logs') {
      const [errors, logs, rules] = await Promise.all([
        grab('/admin/api/errors?limit=50'),
        grab('/admin/api/logs?limit=50'),
        grab('/admin/api/rules'),
      ]);
      out.data = { events: (errors && errors.events) || [], logs, rules };
    } else if (id === 'general') {
      const profiles = await grab('/admin/api/config-profiles');
      out.data = { profiles: (profiles && profiles.profiles) || [] };
    }
    if (!out.data) out.error = 'Сървърът не отговори с данни за тази секция.';
    sectionCache[id] = out;
    return out;
  }

  const form = (id, placeholder, button, extra) =>
    '<div class="u-row u-row-inline u-mt">' +
    (extra || '') +
    '<input id="set-' + id + '-input" placeholder="' + esc(placeholder) + '" />' +
    '<button type="button" class="btn btn-primary" data-action="' + id + '">' + esc(button) + '</button>' +
    '</div>';

  function sectionBody(id, res) {
    if (res.error) return '<p><span class="badge err">грешка</span> <span class="hint">' + esc(res.error) + '</span></p>';
    const d = res.data || {};
    if (id === 'hierarchy') {
      const portals = (d.portals || []).map((p) => [
        esc(p.title || p.slug || '—'),
        '<code>' + esc(p.slug || '') + '</code>',
        String((p.files || []).length),
        esc(p.visibility || '—'),
      ]);
      const groups = (d.groups || []).map((g) => [esc(g.name || g.id || '—'), esc(g.description || '')]);
      // Записите от картотеката се свързват с група и се отделят — както в стария панел.
      const records = (d.records || []).map((r) => [
        '<code>' + esc(r.id || '') + '</code>',
        esc(r.prefix || '—'),
        esc(r.group_id || '—'),
        '<button type="button" class="btn" data-record-assoc="' + esc(r.id) + '">Свържи</button> ' +
        '<button type="button" class="btn" data-record-detach="' + esc(r.id) + '">Отдели</button>',
      ]);
      return '<h3>Портали</h3>' + table([T('th.portal'), T('th.address'), T('th.files'), T('th.visibility')], portals) +
        '<h3 class="u-mt">Групи записи</h3>' + table([T('th.group'), T('th.description')], groups) +
        form('group', 'Име на група', 'Създай група') +
        '<h3 class="u-mt">Записи (' + records.length + ')</h3>' +
        (records.length
          ? '<div class="u-row u-row-inline"><select id="set-record-group">' +
          (d.groups || []).map((g) => '<option value="' + esc(g.id || g.name) + '">' + esc(g.name || g.id) + '</option>').join('') +
          '</select><span class="hint">група за „Свържи“</span></div>' +
          table([T('th.record'), T('th.prefix'), T('th.group'), ''], records)
          : '<p class="hint">Няма записи в картотеката.</p>');
    }
    if (id === 'cabinet') {
      const rows = [
        ['Локално отваряне', d.localOpen ? 'включено' : 'изключено'],
        ['Максимален размер', fmtBytes(d.maxBytes)],
        ['Създаване на файлове', (d.createTypes || []).join(', ') || '—'],
        ['Конвертиране', Object.entries(d.convert || {}).map(([k, v]) => k + ' → ' + v.join(', ')).join('; ') || '—'],
      ];
      return table(['Възможност', T('th.value')], rows.map(([a, b]) => [esc(a), esc(b)]));
    }
    if (id === 'taxonomy') {
      const cats = (d.categories || []).map((c) => [esc(c)]);
      const grps = (d.groups || []).map((g) => [esc(g)]);
      return '<h3>Категории (' + cats.length + ')</h3>' + table(['Категория'], cats) +
        '<h3 class="u-mt">Групи (' + grps.length + ')</h3>' + table([T('th.group')], grps) +
        '<div class="u-row u-row-inline u-mt">' +
        '<select id="set-tax-kind"><option value="category">Категория</option><option value="group">Група</option></select>' +
        '<input id="set-tax-input" placeholder="Име" />' +
        '<button type="button" class="btn btn-primary" data-action="taxonomy">Добави</button></div>';
    }
    if (id === 'jobs') {
      // Живи състояния по Фаза 5: queued → running → succeeded / failed / cancelled.
      const LABELS = {
        queued: 'в опашка',
        running: 'изпълнява се',
        paused: 'на пауза',
        succeeded: 'готово',
        failed: 'грешка',
        cancelled: 'отказано',
      };
      const CLS = { queued: 'demo', running: 'ok', paused: 'demo', succeeded: 'ok', failed: 'err', cancelled: 'demo' };
      const jobs = (d.jobs || []).map((j) => {
        const st = String(j.status || '').toLowerCase();
        const pct = j.progress != null ? Math.max(0, Math.min(100, Number(j.progress))) : null;
        const live = st === 'running' || st === 'queued' || st === 'paused';
        return [
          esc(j.type || j.kind || '—'),
          '<span class="badge ' + (CLS[st] || '') + '">' + esc(LABELS[st] || st || '—') + '</span>',
          pct == null
            ? '—'
            : '<progress max="100" value="' + pct + '"></progress> ' + pct + '%',
          esc(j.error || j.message || ''),
          live
            ? (st === 'paused'
              ? '<button type="button" class="btn" data-job="' + esc(j.id) + '" data-job-action="resume">Продължи</button> '
              : '<button type="button" class="btn" data-job="' + esc(j.id) + '" data-job-action="pause">Пауза</button> ') +
            '<button type="button" class="btn" data-job="' + esc(j.id) + '" data-job-action="cancel">Откажи</button>'
            : '',
        ];
      });
      const active = jobs.length ? ' · ' + jobs.length + ' задачи' : '';
      return '<p class="hint">Състоянието се обновява само, докато панелът е отворен' + active +
        '. Задача в „грешка“ показва причината в колоната „Бележка“.</p>' +
        table([T('th.kind'), T('th.state'), T('th.progress'), T('th.note'), ''], jobs) +
        '<div class="u-row u-mt"><button type="button" class="btn" data-action="reload">Обнови сега</button></div>';
    }
    if (id === 'users') {
      const users = (d.users || []).map((u) => [
        esc(u.username || '—'),
        esc((u.scopes || []).join(', ')),
        u.active === false ? 'не' : 'да',
        '<button type="button" class="btn" data-user="' + esc(u.username) + '">Изтрий</button>',
      ]);
      return table([T('th.user'), T('th.scopes'), T('th.active'), ''], users) +
        '<div class="u-row u-row-inline u-mt">' +
        '<input id="set-user-name" placeholder="потребител" />' +
        '<input id="set-user-pass" type="password" placeholder="парола" autocomplete="new-password" />' +
        '<button type="button" class="btn btn-primary" data-action="user">Създай</button></div>';
    }
    if (id === 'variables') {
      const vars = (d.variables || []).map((v) => [
        esc(v.key || v.name || '—'),
        esc(v.type || '—'),
        esc(String(v.value == null ? '' : v.value).slice(0, 60)),
      ]);
      return table([T('th.variable'), T('th.type'), T('th.value')], vars) +
        '<div class="u-row u-row-inline u-mt">' +
        '<input id="set-var-key" placeholder="име" />' +
        '<input id="set-var-value" placeholder="стойност" />' +
        '<button type="button" class="btn btn-primary" data-action="variable">Добави</button></div>' +
        '<h3 class="u-mt">Преглед на текст с променливи</h3>' +
        '<p class="hint">Пиши <code>{{име}}</code> в име или описание на портал — то се заменя със стойността. ' +
        'Вградени са <code>{{year}}</code>, <code>{{month}}</code>, <code>{{day}}</code> и <code>{{date}}</code>. ' +
        'Пътища на файлове не се интерполират (риск от обхождане на директории).</p>' +
        '<div class="u-row u-row-inline"><input id="set-tpl-input" placeholder="Договор {{year}} — {{издател}}" />' +
        '<button type="button" class="btn" data-action="interpolate">' + T('action.preview') + '</button></div>' +
        '<pre class="u-mt" id="set-tpl-out" aria-live="polite">—</pre>';
    }
    if (id === 'data') {
      const secrets = (d.secrets || []).map((s) => [
        '<code>' + esc(String(s.idHash || s.id || '').slice(0, 16)) + '…</code>',
        esc(fmtTime(s.createdAt || s.at)),
        esc(s.note || '—'),
      ]);
      const portalOptions = (d.portals || []).map((p) => '<option value="' + esc(p.id) + '">' + esc(p.title || p.slug) + '</option>').join('');
      return '<h3>Създай тайна връзка</h3>' +
        '<p class="hint">Целият линк е след „#“ и не се изпраща към сървъра: той пази само шифротекст и го изтрива след последния преглед или след срока. Ключът се ражда в браузъра.</p>' +
        '<div class="field"><label>Какво споделяш</label>' +
        '<select id="set-secret-kind"><option value="text">текст (парола, IBAN, ключ…)</option>' +
        '<option value="url">връзка към панела или към портал</option></select></div>' +
        '<div class="field u-mt"><label>Съдържание</label>' +
        '<textarea id="set-secret-text" rows="3" placeholder="Текстът или адресът, който искаш да споделиш"></textarea></div>' +
        '<div class="field u-mt"><label>Подсказка (открит текст — сървърът я вижда)</label>' +
        '<input id="set-secret-hint" maxlength="200" placeholder="по избор" /></div>' +
        '<div class="u-row u-row-inline u-mt">' +
        '<select id="set-secret-ttl">' +
        [['3600', '1 час'], ['86400', '24 часа'], ['604800', '7 дни'], ['2592000', '30 дни']]
          .map(([v, l]) => '<option value="' + v + '"' + (v === '86400' ? ' selected' : '') + '>' + l + '</option>')
          .join('') +
        '</select>' +
        '<select id="set-secret-views">' +
        ['1', '2', '3', '5', '10'].map((v) => '<option value="' + v + '">' + v + ' преглед(а)</option>').join('') +
        '</select>' +
        '<input id="set-secret-password" type="password" autocomplete="new-password" placeholder="втора парола (по избор)" />' +
        '<button type="button" class="btn btn-primary" data-action="secretCreate">' + T('action.createLink') + '</button></div>' +
        '<div id="set-secret-out" class="u-mt"></div>' +
        '<h3 class="u-mt">Тайни връзки</h3>' + table([T('th.identifier'), T('th.createdF'), T('th.note')], secrets) +
        '<h3 class="u-mt">Търсене в картотеката</h3>' +
        '<div class="u-row u-row-inline"><input id="set-search-q" placeholder="търсена дума" />' +
        '<button type="button" class="btn" data-action="search">Търси</button></div>' +
        '<h3 class="u-mt">Организации</h3>' +
        '<div class="u-row u-row-inline"><input id="set-org-name" placeholder="име на организация" />' +
        '<button type="button" class="btn" data-action="organization">Добави</button></div>' +
        '<h3 class="u-mt">Внасяне на записи</h3>' +
        '<div class="u-row u-row-inline"><input id="set-ingest-emails" placeholder="имейли, разделени със запетая" />' +
        '<button type="button" class="btn" data-action="ingest">Внеси</button></div>' +
        '<h3 class="u-mt">Сливане на портали</h3>' +
        '<div class="u-row u-row-inline"><input id="set-merge-target" placeholder="портал-получател (id)" />' +
        '<input id="set-merge-sources" placeholder="източници (id, id)" />' +
        '<button type="button" class="btn" data-action="merge">Слей</button></div>' +
        '<h3 class="u-mt">Конфликти</h3>' +
        '<div class="u-row u-row-inline"><input id="set-conflict-id" placeholder="конфликт (id)" />' +
        '<input id="set-conflict-value" placeholder="стойност" />' +
        '<button type="button" class="btn" data-action="conflict">Реши</button></div>' +
        '<h3 class="u-mt">Портални функции</h3>' +
        (portalOptions
          ? '<div class="u-row u-row-inline"><select id="set-data-portal">' + portalOptions + '</select>' +
          '<input id="set-data-file" placeholder="файл (id, по избор)" />' +
          '<input id="set-data-folder" placeholder="папка на HTML проект" />' +
          '<input id="set-data-title" placeholder="заглавие" /></div>' +
          '<div class="u-row u-mt"><button type="button" class="btn" data-action="apiInfo">api-info</button>' +
          '<button type="button" class="btn" data-action="htmlProjects">HTML проекти</button>' +
          '<button type="button" class="btn" data-action="htmlProject">Нов HTML проект</button>' +
          '<button type="button" class="btn" data-action="sends">Изпрати връзка</button></div>'
          : '<p class="hint">Първо създай портал.</p>') +
        '<pre class="tree u-mt" id="set-data-out" aria-live="polite">—</pre>';
    }
    if (id === 'diagnostics') {
      const diag = d.diag || {};
      const load = d.load || {};
      const metrics = d.metrics || {};
      const who = d.who || {};
      const portal = d.portal || {};
      const rows = [
        ['Време на сървъра', fmtTime(diag.generatedAt)],
        ['Работи от', Math.round(Number(diag.uptimeSeconds) || 0) + ' s'],
        ['Node', esc((diag.runtime || {}).node || '—')],
        ['Памет (RSS)', fmtBytes((diag.runtime || {}).rssBytes)],
        ['Заявки / грешки', ((diag.traffic || {}).requests || 0) + ' / ' + ((diag.traffic || {}).errors || 0)],
        ['Изтегляния', String((diag.traffic || {}).downloads || 0)],
        ['Натоварване', esc(load.level || '—') + ' · паралелни ' + esc(load.effective != null ? load.effective : '—')],
        ['Съотношение памет', String(load.heapRatio == null ? '—' : load.heapRatio)],
        ['Роля / Ingress', esc(who.role || '—') + ' · ' + (who.ingress ? 'да' : 'не')],
        ['Броячи', String((metrics.requests || 0)) + ' заявки · ' + String((metrics.portals || 0)) + ' портала'],
        ['Портал за доказателства', esc(portal.dir || portal.error || 'не е разположен')],
        ['QR артефакти', String(((d.qr && d.qr.artifacts) || []).length)],
      ];
      return table([T('th.metric'), T('th.value')], rows.map(([a, b]) => [esc(a), b])) +
        '<div class="u-row u-row-inline u-mt">' +
        '<input id="set-notify-service" placeholder="услуга (напр. notify.mobile_app)" />' +
        '<input id="set-notify-link" placeholder="връзка или адрес" />' +
        '<button type="button" class="btn" data-action="notify">Изпрати известие</button></div>' +
        '<div class="u-row u-mt">' +
        '<button type="button" class="btn" data-action="portalDeploy">' + T('action.deployPortal') + '</button>' +
        '<button type="button" class="btn" data-action="metricsProm">' + T('action.metrics') + '</button>' +
        '</div>';
    }
    if (id === 'analytics') {
      const s = d.sensors || {};
      const m = d.metrics || {};
      const perPortal = (s.portals || []).map((p) => [
        esc(p.slug || p.id || '—'),
        String(p.visits || 0),
        String(p.downloads || 0),
        fmtBytes(p.bytes || 0),
      ]);
      const totals = [
        ['База данни', fmtBytes(s.databaseBytes)],
        ['Телеметрия', fmtBytes(s.telemetryBytes)],
        ['Файлове', String(s.files || 0) + ' · ' + fmtBytes(s.fileBytes || 0)],
        ['Посещения / изтегляния', String(s.visits || 0) + ' / ' + String(s.downloads || 0)],
        ['Режим на IP', esc(s.ipMode || '—')],
        ['Заявки (брояч)', String(m.requests || 0)],
        ['Портали (брояч)', String(m.portals || 0)],
      ];
      return table([T('th.metric'), T('th.value')], totals.map(([a, b]) => [esc(a), b])) +
        '<h3 class="u-mt">По портал</h3>' + table([T('th.portal'), 'Посещения', 'Изтегляния', 'Обем'], perPortal) +
        '<div class="u-row u-mt"><button type="button" class="btn" data-action="metricsProm">' + T('action.metrics') + '</button></div>';
    }
    if (id === 'security') {
      const a = d.audit || {};
      const who = d.who || {};
      const rows = [
        ['Одитен ланец', a.valid === false ? 'ПРОБЛЕМ' : a.integrity || 'проверен'],
        ['Записи в ланца', String(a.entries != null ? a.entries : a.lines != null ? a.lines : '—')],
        ['Последен запис', esc(a.lastAt || a.at || '—')],
        ['Роля в тази сесия', esc(who.role || '—')],
        ['Роля по подразбиране', esc(who.defaultRole || '—')],
        ['Ingress самоличност', who.ingress ? 'да' : 'не'],
        ['RBAC картографиран', who.mapped ? 'да' : 'не (общо правило)'],
        ['Бележка', esc(a.note || '')],
      ];
      return table([T('th.metric'), T('th.value')], rows.map(([x, y]) => [esc(x), esc(y)])) +
        '<div class="u-row u-mt"><button type="button" class="btn btn-primary" data-action="auditVerify">' + T('action.verifyChain') + '</button>' +
        '<button type="button" class="btn" data-action="audit">' + T('action.exportAudit') + '</button></div>';
    }
    if (id === 'qr') {
      const items = (d.artifacts || []).map((x) => [
        '<code>' + esc(x.qrId || '—') + '</code>',
        esc(x.label || x.title || '—'),
        esc(fmtTime(x.createdAt || x.at)),
        '<button type="button" class="btn" data-qr-revoke="' + esc(x.qrId || '') + '">Отмени</button>',
      ]);
      return '<p class="hint">Издадените QR артефакти се пазят, докато не бъдат отменени. Отмяната спира текущата връзка.</p>' +
        table(['QR ID', 'Етикет', T('th.created'), ''], items);
    }
    if (id === 'cms') {
      // Подписът е detached: PDF-ът НЕ се променя, а .p7s се пази до него. Така един и
      // същи отчет може да има няколко подписа от различни лица, без да се пре-рендира.
      return '<p class="hint">' + esc(T('cms.hint')) + '</p>' +
        '<div class="field"><label>' + esc(T('cms.pdf')) + '</label>' +
        '<input type="file" id="set-cms-file" accept="application/pdf,.pdf" /></div>' +
        '<div class="field u-mt"><label>' + esc(T('cms.cert')) + '</label>' +
        '<textarea id="set-cms-cert" rows="4" spellcheck="false" placeholder="PEM"></textarea></div>' +
        '<div class="field u-mt"><label>' + esc(T('cms.key')) + '</label>' +
        '<textarea id="set-cms-key" rows="4" spellcheck="false" placeholder="PEM"></textarea></div>' +
        '<div class="u-row u-mt"><button type="button" class="btn btn-primary" data-action="cmsSign">' + esc(T('cms.sign')) + '</button></div>' +
        '<div id="set-cms-out" class="u-mt"></div>' +
        '<h3 class="u-mt">' + esc(T('cms.verifyTitle')) + '</h3>' +
        '<p class="hint">Проверката ползва същия PDF файл по-горе — смени го, ако проверяваш друг отчет.</p>' +
        '<div class="field"><label>' + esc(T('cms.cms')) + '</label>' +
        '<textarea id="set-cms-sig" rows="3" spellcheck="false" placeholder="MIIB..."></textarea></div>' +
        '<div class="u-row u-mt"><button type="button" class="btn" data-action="cmsVerify">' + esc(T('cms.verify')) + '</button></div>' +
        '<pre class="tree u-mt" id="set-cms-verify-out" aria-live="polite">—</pre>';
    }
    if (id === 'storage') {
      const st = d.status || {};
      const last = st.lastCheck || {};
      const retention = d.retention || {};
      const locs = (last.locations || []).map((l) => [
        esc(l.name),
        l.available ? 'да' : 'не',
        l.writable ? 'да' : 'не',
        esc(l.error || '—'),
      ]);
      const ret = [
        ['Включено', retention.enabled ? 'да' : 'не'],
        ['Ще бъдат изтрити', String(retention.deleted != null ? retention.deleted : (retention.expired || []).length || 0)],
        ['Ще бъдат деактивирани', String(retention.disabled != null ? retention.disabled : 0)],
      ];
      return '<p class="hint">Последна проверка: ' + esc(fmtTime(last.checkedAt)) + ' · следваща: ' + esc(fmtTime(st.nextCheckAt)) + '</p>' +
        table([T('th.location'), T('th.available'), T('th.writable'), T('th.error')], locs) +
        '<h3 class="u-mt">Задържане</h3>' + table([T('th.metric'), T('th.value')], ret.map(([a, b]) => [esc(a), esc(b)])) +
        '<div class="u-row u-mt"><button type="button" class="btn btn-primary" data-action="storage">' + T('action.checkNow') + '</button>' +
        '<button type="button" class="btn" data-action="retention">Приложи задържането</button>' +
        '<button type="button" class="btn" data-action="mirror">Провери огледалото</button>' +
        '<button type="button" class="btn" data-action="mirrorRepair">Поправи от огледалото</button></div>';
    }
    if (id === 'backups') {
      const list = (d.backups || []).map((b) => [
        '<code>' + esc(b.name || '—') + '</code>',
        fmtBytes(b.bytes || b.size),
        esc(fmtTime(b.createdAt || b.mtime)),
      ]);
      const mirror = d.mirror ? 'Огледало: <code>' + esc(d.mirror) + '</code>' : 'Огледало не е настроено.';
      const sched = (d.schedule && d.schedule.schedule) || {};
      const next = d.schedule && d.schedule.nextRunAt;
      return '<p class="hint">' + mirror + '</p>' + table([T('th.archive'), T('th.size'), T('th.created')], list) +
        '<div class="u-row u-mt"><button type="button" class="btn btn-primary" data-action="backup">' + T('action.makeBackup') + '</button>' +
        '<button type="button" class="btn" data-action="verify">' + T('action.verifyBackups') + '</button></div>' +
        '<h3 class="u-mt">Автоматичен график</h3>' +
        '<p class="hint">Следващо копие: ' + esc(fmtTime(next)) + '</p>' +
        '<div class="u-row u-row-inline u-mt">' +
        '<label><input id="set-sched-enabled" type="checkbox"' + (sched.enabled ? ' checked' : '') + ' /> включен</label>' +
        '<input id="set-sched-interval" type="number" min="1" value="' + esc(sched.intervalMinutes != null ? sched.intervalMinutes : 1440) + '" placeholder="минути" />' +
        '<input id="set-sched-max" type="number" min="1" value="' + esc(sched.maxBackups != null ? sched.maxBackups : 7) + '" placeholder="брой" />' +
        '<button type="button" class="btn btn-primary" data-action="schedule">' + T('action.saveSchedule') + '</button></div>';
    }
    if (id === 'logs') {
      const events = (d.events || []).map((e) => [
        esc(fmtTime(e.at)),
        esc(e.level || '—'),
        esc(e.event || e.message || '—'),
        esc(e.details ? JSON.stringify(e.details).slice(0, 120) : ''),
      ]);
      const logs = d.logs || {};
      const rules = d.rules || {};
      const entries = (logs.entries || []).length;
      return '<p class="hint">Последни ' + events.length + ' записа, най-новите първи. Ниво на журнала: <code>' + esc(logs.level || '—') + '</code> · ' + entries + ' реда в паметта.</p>' +
        table([T('th.time'), T('th.level'), T('th.event'), T('th.details')], events) +
        '<div class="u-row u-row-inline u-mt">' +
        '<select id="set-log-level">' +
        ['trace', 'debug', 'info', 'warn', 'error'].map((lv) => '<option value="' + lv + '"' + (logs.level === lv ? ' selected' : '') + '>' + lv + '</option>').join('') +
        '</select>' +
        '<button type="button" class="btn btn-primary" data-action="level">Задай ниво</button>' +
        '<button type="button" class="btn" data-action="rules">Презареди правилата</button>' +
        '<button type="button" class="btn" data-action="audit">' + T('action.exportAudit') + '</button>' +
        '<button type="button" class="btn" data-action="reload">Обнови</button></div>' +
        '<p class="hint">Правила на gateway: ' + esc(rules.count != null ? rules.count + ' активни' : (rules.host || 'няма данни')) + '</p>';
    }
    return '<p class="hint">Непозната секция.</p>';
  }

  // Диагностиката на подписа: кодът от модула се превежда, а непознат код се показва
  // такъв, какъвто е — по-добре видим код, отколкото измислено обяснение.
  function cmsReason(res) {
    const code = (res && res.reason) || '';
    if (code === 'not-pdf' || code === 'no-pdf') return T('cms.errNotPdf');
    if (code === 'bad-certificate') return T('cms.errCert');
    if (code === 'bad-key') return T('cms.errKey');
    return T('cms.errGeneric') + ((res && res.error) ? ': ' + res.error : code ? ' (' + code + ')' : '');
  }

  // Действията в секциите. Патент: секция → какво прави бутонът.
  async function runAction(action) {
    const post = (path, json) => api(path, { method: 'POST', json });
    if (action === 'group') {
      const name = host.querySelector('#set-group-input').value.trim();
      if (!name) return toast('Въведи име на група', 'err');
      const r = await post('/admin/api/v2/groups', { name, description: '' });
      if (!r.ok) return toast(r.error || 'Групата не е създадена', 'err');
      toast('Групата е създадена', 'ok');
    } else if (action === 'taxonomy') {
      const name = host.querySelector('#set-tax-input').value.trim();
      const kind = host.querySelector('#set-tax-kind').value;
      if (!name) return toast('Въведи име', 'err');
      const r = await post('/admin/api/taxonomy', { kind, name });
      if (!r.ok) return toast(r.error || 'Не е добавено', 'err');
      toast('Добавено', 'ok');
    } else if (action === 'user') {
      const username = host.querySelector('#set-user-name').value.trim();
      const password = host.querySelector('#set-user-pass').value;
      if (!username || !password) return toast('Потребител и парола са задължителни', 'err');
      const r = await post('/admin/api/users', { username, password });
      if (!r.ok) return toast(r.error || 'Потребителят не е създаден', 'err');
      toast('Потребителят е създаден', 'ok');
    } else if (action === 'variable') {
      const key = host.querySelector('#set-var-key').value.trim();
      const value = host.querySelector('#set-var-value').value;
      if (!key) return toast('Въведи име на променлива', 'err');
      const r = await post('/admin/api/variables', { key, value });
      if (!r.ok) return toast(r.error || 'Променливата не е добавена', 'err');
      toast('Променливата е добавена', 'ok');
    } else if (action === 'storage') {
      const r = await post('/admin/api/storage/check', {});
      if (!r.ok) return toast(r.error || 'Проверката не мина', 'err');
      toast('Проверката приключи', 'ok');
    } else if (action === 'backup') {
      const r = await post('/admin/api/database/backup', {});
      if (!r.ok) return toast(r.error || 'Копието не е създадено', 'err');
      toast('Копието е създадено', 'ok');
    } else if (action === 'verify') {
      const r = await post('/admin/api/database/backups/verify', {});
      if (!r.ok) return toast(r.error || 'Проверката не мина', 'err');
      const d = r.data || {};
      toast('Проверени ' + (d.checked != null ? d.checked : '') + ' копия' + (d.ok === false ? ' · има проблем' : ''), d.ok === false ? 'err' : 'ok');
    } else if (action === 'schedule') {
      const enabled = Boolean(host.querySelector('#set-sched-enabled').checked);
      const intervalMinutes = Number(host.querySelector('#set-sched-interval').value);
      const maxBackups = Number(host.querySelector('#set-sched-max').value);
      if (!Number.isFinite(intervalMinutes) || intervalMinutes < 1) return toast('Интервалът е в минути, поне 1', 'err');
      if (!Number.isFinite(maxBackups) || maxBackups < 1) return toast('Броят копия е поне 1', 'err');
      const r = await api('/admin/api/database/backup-schedule', { method: 'PUT', json: { enabled, intervalMinutes, maxBackups } });
      if (!r.ok) return toast(r.error || 'Графикът не е записан', 'err');
      toast('Графикът е записан', 'ok');
    } else if (action === 'retention') {
      const r = await post('/admin/api/retention', {});
      if (!r.ok) return toast(r.error || 'Задържането не е приложено', 'err');
      const d = r.data || {};
      toast('Задържане: изтрити ' + String(d.deleted || 0) + ' · деактивирани ' + String(d.disabled || 0), 'ok');
    } else if (action === 'mirror' || action === 'mirrorRepair') {
      const r = await post('/admin/api/storage/mirror/verify', { repair: action === 'mirrorRepair' });
      if (!r.ok && r.status !== 409) return toast(r.error || 'Проверката на огледалото не мина', 'err');
      const d = r.data || {};
      toast('Огледало: проверени ' + String(d.checked || 0) + ' · проблеми ' + String(d.problems || 0) + ' · поправени ' + String(d.repaired || 0), d.problems ? 'err' : 'ok');
    } else if (action === 'level') {
      const level = host.querySelector('#set-log-level').value;
      const r = await post('/admin/api/logs/level', { level });
      if (!r.ok) return toast(r.error || 'Нивото не е зададено', 'err');
      toast('Ниво на журнала: ' + ((r.data && r.data.level) || level), 'ok');
    } else if (action === 'rules') {
      const r = await post('/admin/api/rules/reload', {});
      if (!r.ok) return toast(r.error || 'Правилата не са презаредени', 'err');
      toast('Правилата са презаредени', 'ok');
    } else if (action === 'auditVerify') {
      const r = await api('/admin/api/audit/verify');
      const ok = r.ok && !(r.data && r.data.valid === false);
      toast(ok ? 'Одитният ланец е цял (' + ((r.data && r.data.integrity) || 'valid') + ')' : 'Одитният ланец е счупен', ok ? 'ok' : 'err');
    } else if (action === 'audit') {
      const token = storedToken();
      try {
        const res = await fetch(effectiveBase() + '/admin/api/audit/export', { headers: token ? { Authorization: 'Bearer ' + token } : {} });
        if (!res.ok) return toast('Одитът не е достъпен · HTTP ' + res.status, 'err');
        const text = await res.text();
        const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hapi-audit-export.txt';
        a.click();
        URL.revokeObjectURL(url);
        toast('Одитът е изтеглен', 'ok');
      } catch (e) {
        toast('Одитът не е изтеглен: ' + e.message, 'err');
      }
      return;
    } else if (action === 'cmsSign') {
      // Подписът се издава тук, но се ПРОВЕРЯВА на сървъра: браузърът не бива да
      // „потвърждава“ собствения си подпис.
      const mod = window.HapiReportSign;
      if (!mod) return toast(T('cms.noModule'), 'err');
      const input = host.querySelector('#set-cms-file');
      const file = input && input.files && input.files[0];
      if (!file) return toast(T('cms.needFile'), 'err');
      const certPem = host.querySelector('#set-cms-cert').value;
      const keyPem = host.querySelector('#set-cms-key').value;
      if (!String(certPem).trim()) return toast(T('cms.needCert'), 'err');
      if (!String(keyPem).trim()) return toast(T('cms.needKey'), 'err');
      const out = host.querySelector('#set-cms-out');
      let pdfBytes;
      try {
        pdfBytes = new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        return toast(T('cms.signFail') + ': ' + e.message, 'err');
      }
      const res = await mod.sign({
        pdfBytes,
        certPem,
        keyPem,
        fileName: file.name,
        base: effectiveBase(),
        fetch,
        headers: storedToken() ? { Authorization: 'Bearer ' + storedToken() } : {},
      });
      if (!res.ok) {
        const why = cmsReason(res);
        if (out) out.innerHTML = '<p><span class="badge err">' + esc(T('cms.signFail')) + '</span> <span class="hint">' + esc(why) + '</span></p>';
        return toast(T('cms.signFail') + ' · ' + why, 'err');
      }
      if (out) {
        out.innerHTML =
          '<div class="field"><label>sha256 на PDF-а</label><code>' + esc(res.pdfSha256 || '—') + '</code></div>' +
          '<p class="hint">Подписът е отделен файл (' + esc(String(res.cmsBytes || 0)) + ' B). ' + esc(res.note || '') + '</p>' +
          '<div class="u-row u-row-inline"><button type="button" class="btn btn-primary" data-cms-download="1">' +
          esc(T('cms.download')) + '</button></div><pre class="tree" id="set-cms-sig-preview">' +
          esc(String(res.cmsBase64 || '').slice(0, 160)) + '…</pre>';
        // Съдържанието се пренася в полето за проверка, за да не се копира на ръка.
        const sig = host.querySelector('#set-cms-sig');
        if (sig) sig.value = res.cmsBase64 || '';
        const dl = out.querySelector('[data-cms-download]');
        if (dl) {
          dl.addEventListener('click', () => {
            const bytes = mod.fromBase64(res.cmsBase64 || '');
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pkcs7-signature' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = res.fileName || 'report.p7s';
            a.click();
            URL.revokeObjectURL(url);
          });
        }
      }
      toast(T('cms.signOk'), 'ok');
    } else if (action === 'cmsVerify') {
      const mod = window.HapiReportSign;
      if (!mod) return toast(T('cms.noModule'), 'err');
      const sigValue = host.querySelector('#set-cms-sig').value;
      if (!String(sigValue).trim()) return toast(T('cms.needCms'), 'err');
      const input = host.querySelector('#set-cms-file');
      const file = input && input.files && input.files[0];
      if (!file) return toast(T('cms.needFile'), 'err');
      const pre = host.querySelector('#set-cms-verify-out');
      let pdfBytes;
      try {
        pdfBytes = new Uint8Array(await file.arrayBuffer());
      } catch (e) {
        return toast(T('cms.verifyFail') + ': ' + e.message, 'err');
      }
      const res = await mod.verify({
        dataBytes: pdfBytes,
        cmsBase64: sigValue,
        base: effectiveBase(),
        fetch,
        headers: storedToken() ? { Authorization: 'Bearer ' + storedToken() } : {},
      });
      const verdict = res.ok ? T('cms.verifyOk') : T('cms.verifyFail');
      const details = [
        res.subject ? 'CN: ' + res.subject : '',
        res.digest ? 'sha256: ' + res.digest : '',
        res.reason ? res.reason : '',
      ].filter(Boolean);
      if (pre) pre.textContent = verdict + (details.length ? ' · ' + details.join(' · ') : '');
      toast(verdict, res.ok ? 'ok' : 'err');
    } else if (action === 'notify') {
      const service = host.querySelector('#set-notify-service').value.trim();
      const link = host.querySelector('#set-notify-link').value.trim();
      if (!service) return toast('Въведи услуга за известие', 'err');
      if (!link) return toast('Въведи връзка', 'err');
      const r = await post('/admin/api/notify/dispatch', { service, link });
      if (!r.ok) return toast(r.error || 'Известието не е изпратено', 'err');
      toast('Известието е изпратено', 'ok');
      return;
    } else if (action === 'secretCreate') {
      const share = window.HapiSecretShare;
      if (!share) return toast('Модулът за тайни връзки не е зареден', 'err');
      const text = host.querySelector('#set-secret-text').value;
      if (!text.trim()) return toast('Няма какво да се сподели', 'err');
      const kind = host.querySelector('#set-secret-kind').value;
      if (kind === 'url' && !/^(https?:\/\/|\/)/i.test(text.trim())) {
        return toast('За режим „връзка“ е нужен http(s) адрес или път', 'err');
      }
      const out = host.querySelector('#set-secret-out');
      if (out) out.textContent = 'Шифровам в браузъра…';
      const apiFetch = (path, init) => fetch(effectiveBase() + path, init);
      try {
        const created = await share.create({
          text: text.trim(),
          hint: host.querySelector('#set-secret-hint').value,
          ttlSeconds: Number(host.querySelector('#set-secret-ttl').value),
          maxViews: Number(host.querySelector('#set-secret-views').value),
          password: host.querySelector('#set-secret-password').value || '',
          base: effectiveBase(),
          fetch: apiFetch,
          headers: storedToken() ? { Authorization: 'Bearer ' + storedToken() } : {},
        });
        if (out) {
          const qr = typeof window.qrcode === 'function' ? window.qrcode(0, 'M') : null;
          let svg = '';
          if (qr) {
            qr.addData(created.link);
            qr.make();
            svg = qr.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
          }
          out.innerHTML =
            '<div class="field"><label>Линк</label><code class="secret-link">' + esc(created.link) + '</code></div>' +
            '<p class="hint">Валиден до ' + esc(fmtTime(created.expiresAt)) + ' · прегледи: ' + created.maxViews +
            (created.requiresPassword ? ' · с втора парола' : '') +
            (created.receipt ? ' · чек ' + esc(created.receipt) : '') + '</p>' +
            '<div class="u-row u-row-inline u-mt"><button type="button" class="btn" data-copy-secret="' +
            esc(created.link) + '">' + T('action.copy') + '</button></div>' +
            (svg ? '<div class="u-mt">' + svg + '</div>' : '');
          const copy = out.querySelector('[data-copy-secret]');
          if (copy) {
            copy.addEventListener('click', async () => {
              try {
                await navigator.clipboard.writeText(created.link);
                toast('Линкът е копиран', 'ok');
              } catch {
                toast('Копирането е блокирано от браузъра — маркирай линка ръчно', 'err');
              }
            });
          }
          host.querySelector('#set-secret-text').value = '';
          host.querySelector('#set-secret-password').value = '';
        }
        toast('Тайната връзка е създадена', 'ok');
        delete sectionCache.data;
      } catch (e) {
        if (out) out.textContent = 'Грешка: ' + e.message;
        return toast(e.message || 'Линкът не е създаден', 'err');
      }
      return;
    } else if (action === 'interpolate') {
      const tpl = host.querySelector('#set-tpl-input').value;
      const out = host.querySelector('#set-tpl-out');
      if (!tpl.trim()) return toast('Въведи текст с {{променлива}}', 'err');
      const r = await post('/admin/api/v2/interpolate', { template: tpl });
      if (!r.ok) return toast(r.error || 'Прегледът не мина', 'err');
      const d = r.data || {};
      if (out) {
        out.textContent =
          String(d.output || '') +
          (d.missing && d.missing.length ? '\n\nлипсват: ' + d.missing.join(', ') : '') +
          (d.cycle && d.cycle.length ? '\n\nцикли: ' + d.cycle.join(', ') : '');
      }
      toast(d.missing && d.missing.length ? 'Има липсващи променливи' : 'Готово', d.missing && d.missing.length ? 'err' : 'ok');
      return;
    } else if (action === 'search' || action === 'organization' || action === 'ingest' || action === 'merge' || action === 'conflict' || action === 'apiInfo' || action === 'htmlProjects' || action === 'htmlProject' || action === 'sends') {
      const out = host.querySelector('#set-data-out');
      const show = (payload) => { if (out) out.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2); };
      const field = (id) => { const el = host.querySelector('#set-' + id); return el ? el.value.trim() : ''; };
      const portalId = field('data-portal');
      let r;
      if (action === 'search') {
        const q = field('search-q');
        if (!q) return toast('Въведи дума за търсене', 'err');
        // Пътищата са тези, които сървърът РЕАЛНО обслужва (директорията и сливането на
        // портали живеят под `/admin/api/directory` и `/admin/api/portals`). Досега тук
        // стояха измислени `/v2/...` адреси и бутоните мълчаливо връщаха 404 (BUG-GUI-01).
        r = await api('/admin/api/v2/search?q=' + encodeURIComponent(q));
      } else if (action === 'organization') {
        const name = field('org-name');
        if (!name) return toast('Въведи име на организация', 'err');
        r = await post('/admin/api/directory/organizations', { name });
      } else if (action === 'ingest') {
        const emails = field('ingest-emails').split(',').map((s) => s.trim()).filter(Boolean);
        if (!emails.length) return toast('Въведи поне един имейл', 'err');
        r = await post('/admin/api/directory/ingest', { emails });
      } else if (action === 'merge') {
        const targetId = field('merge-target');
        const sourceIds = field('merge-sources').split(',').map((s) => s.trim()).filter(Boolean);
        if (!targetId || !sourceIds.length) return toast('Нужни са портал-получател и поне един източник', 'err');
        r = await post('/admin/api/portals/merge', { targetId, sourceIds });
      } else if (action === 'conflict') {
        const id = field('conflict-id');
        const value = field('conflict-value');
        if (!id) return toast('Въведи идентификатор на конфликта', 'err');
        r = await post('/admin/api/directory/conflicts/' + encodeURIComponent(id) + '/resolve', { value });
      } else if (action === 'apiInfo') {
        if (!portalId) return toast('Избери портал', 'err');
        r = await api('/admin/api/portals/' + encodeURIComponent(portalId) + '/api-info');
      } else if (action === 'htmlProjects') {
        if (!portalId) return toast('Избери портал', 'err');
        r = await api('/admin/api/portals/' + encodeURIComponent(portalId) + '/html-projects');
      } else if (action === 'htmlProject') {
        const folder = field('data-folder');
        const title = field('data-title');
        if (!portalId || !folder || !title) return toast('Нужни са портал, папка и заглавие', 'err');
        r = await post('/admin/api/portals/' + encodeURIComponent(portalId) + '/html-projects', { folder, title });
      } else {
        const fileId = field('data-file');
        if (!portalId || !fileId) return toast('Нужни са портал и файл', 'err');
        r = await post('/admin/api/portals/' + encodeURIComponent(portalId) + '/files/' + encodeURIComponent(fileId) + '/sends', {});
      }
      if (!r.ok) {
        show(r.error || ('HTTP ' + r.status));
        return toast(r.error || 'Действието не мина', 'err');
      }
      show(r.data);
      toast('Готово', 'ok');
      return;
    } else if (action === 'portalDeploy') {
      const r = await post('/admin/api/evidence-portal/deploy', {});
      if (!r.ok) return toast(r.error || 'Порталът не е разположен', 'err');
      toast('Порталът е разположен в ' + ((r.data && r.data.dir) || 'www/hapi/data'), 'ok');
    } else if (action === 'metricsProm') {
      const r = await api('/admin/api/sensors/prometheus', { raw: true });
      if (!r.ok) return toast(r.error || 'Метриките не са достъпни', 'err');
      const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
      window.prompt('Метрики (копирай текста):', text.slice(0, 4000));
      toast('Метриките са готови', 'ok');
      return;
    }
    // Действия, които пишат резултата СИ НА МЯСТО (в `#set-…-out` или в поле на същата
    // секция). Те НЕ бива да пре-рисуват секцията след себе си — иначе потребителят
    // вижда известие, а резултатът изчезва (така изчезваше и току-що издаденият CMS подпис).
    const IN_PLACE = new Set([
      'interpolate', 'secretCreate', 'cmsSign', 'cmsVerify', 'audit', 'metricsProm',
      'apiInfo', 'htmlProjects', 'htmlProject', 'sends', 'search', 'organization', 'ingest',
      'merge', 'conflict', 'notify', 'portalDeploy',
    ]);
    if (IN_PLACE.has(action)) return;
    delete sectionCache[state.section];
    render();
  }

  function bindSectionActions(id) {
    host.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        if (action === 'reload') {
          delete sectionCache[id];
          return render();
        }
        void runAction(action);
      });
    });
    host.querySelectorAll('[data-job]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const jobId = btn.getAttribute('data-job');
        const act = btn.getAttribute('data-job-action') || 'cancel';
        const r = await api('/admin/api/jobs/' + encodeURIComponent(jobId) + '/' + act, { method: 'POST', json: {} });
        if (!r.ok) return toast(r.error || 'Задачата не е обновена', 'err');
        toast(
          act === 'cancel' ? 'Задачата е отказана' : act === 'pause' ? 'Задачата е на пауза' : 'Задачата продължава',
          'ok',
        );
        delete sectionCache[id];
        render();
      });
    });
    host.querySelectorAll('[data-qr-revoke]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const qrId = btn.getAttribute('data-qr-revoke');
        if (!qrId || !window.confirm('Да отменя ли QR артефакт „' + qrId + '“?')) return;
        const r = await api('/admin/api/qr-artifacts/' + encodeURIComponent(qrId), { method: 'DELETE' });
        if (!r.ok) return toast(r.error || 'Артефактът не е отменен', 'err');
        toast('QR артефактът е отменен', 'ok');
        delete sectionCache[id];
        render();
      });
    });
    host.querySelectorAll('[data-record-assoc]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const recordId = btn.getAttribute('data-record-assoc');
        const select = host.querySelector('#set-record-group');
        const groupId = select ? select.value : '';
        if (!groupId) return toast('Първо създай група', 'err');
        const r = await api('/admin/api/v2/records/' + encodeURIComponent(recordId) + '/associate', { method: 'POST', json: { groupId } });
        if (!r.ok) return toast(r.error || 'Записът не е свързан', 'err');
        toast('Записът е свързан', 'ok');
        delete sectionCache[id];
        render();
      });
    });
    host.querySelectorAll('[data-record-detach]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const recordId = btn.getAttribute('data-record-detach');
        const r = await api('/admin/api/v2/records/' + encodeURIComponent(recordId) + '/detach', { method: 'POST', json: {} });
        if (!r.ok) return toast(r.error || 'Записът не е отделен', 'err');
        toast('Записът е отделен', 'ok');
        delete sectionCache[id];
        render();
      });
    });
    host.querySelectorAll('[data-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const username = btn.getAttribute('data-user');
        if (!window.confirm('Да изтрия ли потребител „' + username + '“?')) return;
        const r = await api('/admin/api/users/' + encodeURIComponent(username), { method: 'DELETE' });
        if (!r.ok) return toast(r.error || 'Потребителят не е изтрит', 'err');
        toast('Потребителят е изтрит', 'ok');
        delete sectionCache[id];
        render();
      });
    });
  }

  async function renderSection() {
    const id = state.section;
    stopJobsTimer();
    const meta = SECTIONS.find((s) => s.id === id) || { label: 'app.title' };
    host.innerHTML =
      '<div class="page-title"><h1>' + esc(T('app.title')) + ' · ' + esc(T(meta.label)) + '</h1>' +
      '<span class="badge ' + (connected() ? 'ok' : 'demo') + '">' + (connected() ? T('badge.linked') : T('badge.demo')) + '</span></div>' +
      renderTabs() +
      '<section class="panel u-mt"><div class="panel-head"><h2>' + esc(T(meta.label)) + '</h2><span class="badge">API</span></div>' +
      '<div class="panel-body" id="set-section-body"><p class="hint">Зареждам…</p></div></section>';
    bindTabs();
    const body = host.querySelector('#set-section-body');
    const res = await loadSection(id);
    if (!body) return;
    body.innerHTML = sectionBody(id, res);
    bindSectionActions(id);
    // Състоянията queued → running → done се виждат без ръчно обновяване.
    if (id === 'jobs' && connected()) {
      jobsTimer = setInterval(async () => {
        if (state.section !== 'jobs') return stopJobsTimer();
        delete sectionCache.jobs;
        const fresh = await loadSection('jobs');
        const box = host.querySelector('#set-section-body');
        if (!box || state.section !== 'jobs') return;
        box.innerHTML = sectionBody('jobs', fresh);
        bindSectionActions('jobs');
      }, 3000);
    }
  }


  function render() {
    stopJobsTimer();
    if (state.section && state.section !== 'general') return renderSection();
    const isAdmin = state.role === 'admin';
    host.innerHTML = `
      <div class="page-title">
        <h1>${esc(T('app.title'))}</h1>
        <span class="badge ${connected() ? 'ok' : 'demo'}">${esc(connected() ? T('badge.linked') : T('badge.demo'))}</span>
      </div>
      ${renderTabs()}

      <section class="panel">
        <div class="panel-head"><h2>Връзка с add-on-а</h2><span class="badge">токен</span></div>
        <div class="panel-body">
          <p class="hint" id="set-status">${statusLine()}</p>
          <div class="u-grid u-grid-fields">
            <div class="field">
              <label>Адрес на API-то</label>
              <input id="set-base" value="${esc(state.base || storedBase())}" placeholder="${esc(defaultBase() || 'http://homeassistant.local:8099')}" />
              <small class="hint">Празно = същият адрес, от който е отворен интерфейсът.</small>
            </div>
            <div class="field">
              <label>Администраторски токен</label>
              <input id="set-token" type="password" value="${esc(storedToken())}" placeholder="Bearer токен (само за тази сесия)" autocomplete="off" />
              <small class="hint">Пази се в sessionStorage — изчезва при затваряне на таба.</small>
            </div>
          </div>
          <div class="u-row u-row-3 u-mt">
            <button type="button" class="btn btn-primary" id="set-save">Запази връзката</button>
            <button type="button" class="btn" id="set-test">Провери връзката</button>
            <button type="button" class="btn" id="set-clear">Изчисти токена</button>
            <button type="button" class="btn" id="set-ingress-login">Влез през Home Assistant</button>
          </div>
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Публичен адрес за API и QR</h2><span class="badge ${state.publicBaseUrl ? 'ok' : 'demo'}">${state.publicBaseUrl ? 'зададен' : 'не е зададен'
      }</span></div>
        <div class="panel-body">
          <p class="hint">По този адрес се строят препратките в api.json, openapi.json и QR кодовете. В Home Assistant това е адресът, на който е достъпен публичният gateway (напр. <code>http://192.168.50.4:8088</code>). Ако е празно, използва се адресът на интерфейса — при Ingress той не е публично достъпен.</p>
          <div class="u-grid u-grid-fields">
            <div class="field">
              <label>Публичен адрес</label>
              <input id="set-public" value="${esc(state.publicBaseUrl)}" placeholder="http://192.168.50.4:8088" ${isAdmin ? '' : 'disabled'
      } />
              <small class="hint">${isAdmin ? 'Само http/https, до 200 знака.' : 'Само роля admin може да променя тази настройка.'
      }</small>
            </div>
          </div>
          <div class="u-row u-row-1 u-mt">
            <button type="button" class="btn btn-primary" id="set-public-save" ${isAdmin ? '' : 'disabled'}>Запази публичния адрес</button>
          </div>
        </div>
      </section>

      ${pgpSection()}

      <section class="panel u-mt">
        <div class="panel-head"><h2>Профили на настройките</h2><span class="badge ${connected() ? 'ok' : 'demo'}">${connected() ? 'снимки' : 'изисква връзка'
      }</span></div>
        <div class="panel-body">
          <p class="hint">Профилът е снимка на сървърните настройки. Може да се приложи по-късно или да се изтрие.</p>
          <div id="set-profiles"><p class="hint">${connected() ? 'Зареждам…' : 'Няма връзка — списъкът е празен.'}</p></div>
          <div class="u-row u-row-inline u-mt">
            <input id="set-profile-name" placeholder="име на профил" ${isAdmin ? '' : 'disabled'} />
            <button type="button" class="btn btn-primary" id="set-profile-save" ${isAdmin && connected() ? '' : 'disabled'}>Запази профил</button>
          </div>
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Миграция на хранилището</h2><span class="badge ${connected() ? 'ok' : 'demo'}">${connected() ? 'само при нужда' : 'изисква връзка'
      }</span></div>
        <div class="panel-body">
          <p class="hint">Анализът показва какво ще се промени, без да пипа нищо. Dry run минава през същите
            стъпки и също не записва. Реалното пускане пита за изписване на <code>MIGRATE</code>.</p>
          <div class="u-row u-row-3">
            <button type="button" class="btn" id="set-migrate-analyze" ${connected() ? '' : 'disabled'}>Анализ</button>
            <button type="button" class="btn" id="set-migrate-dry" ${connected() ? '' : 'disabled'}>Dry run</button>
            <button type="button" class="btn btn-primary" id="set-migrate-run" ${connected() ? '' : 'disabled'}>Пусни миграцията</button>
          </div>
          <pre class="tree u-mt" id="set-migrate-out" aria-live="polite">—</pre>
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Къде се пази</h2></div>
        <div class="panel-body">
          <dl class="fm-meta">
            <dt>Адрес на API-то</dt><dd><code>${esc(effectiveBase() || '—')}</code> · localStorage <code>hapi.apiBase</code></dd>
            <dt>Токен</dt><dd>${storedToken() ? 'зададен (sessionStorage)' : 'не е зададен'} · sessionStorage <code>hapiAdminToken</code></dd>
            <dt>Публичен адрес</dt><dd><code>${esc(state.publicBaseUrl || '—')}</code> · сървърна настройка <code>limits.publicBaseUrl</code></dd>
          </dl>
        </div>
      </section>`;
    wire();
  }

  function wire() {
    const q = (sel) => host.querySelector(sel);
    // Миграция: анализът е GET, dry run и реалното пускане са POST с {dryRun}.
    const migrateOut = () => q('#set-migrate-out');
    const showMigration = (payload) => {
      const out = migrateOut();
      if (!out) return;
      out.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    };
    if (q('#set-migrate-analyze')) {
      q('#set-migrate-analyze').addEventListener('click', async () => {
        showMigration('Анализирам…');
        const r = await api('/admin/api/directory/migrate');
        showMigration(r.ok ? r.data : r.error || `HTTP ${r.status}`);
      });
    }
    const runMigration = async (dryRun) => {
      showMigration(dryRun ? 'Dry run…' : 'Мигрирам…');
      const r = await api('/admin/api/directory/migrate', { method: 'POST', json: { dryRun } });
      if (!r.ok) return showMigration(r.error || `HTTP ${r.status}`);
      showMigration(r.data);
      toast(dryRun ? 'Dry run приключи — нищо не е записано' : 'Миграцията приключи', 'ok');
    };
    if (q('#set-migrate-dry')) q('#set-migrate-dry').addEventListener('click', () => void runMigration(true));
    if (q('#set-migrate-run')) {
      q('#set-migrate-run').addEventListener('click', () => {
        const answer = window.prompt('Реалната миграция променя данните. За потвърждение изпиши MIGRATE:');
        if (answer !== 'MIGRATE') return toast('Миграцията е отказана', 'err');
        void runMigration(false);
      });
    }
    q('#set-save').addEventListener('click', () => {
      const base = q('#set-base').value.trim().replace(/\/$/, '');
      const token = q('#set-token').value.trim();
      if (base) {
        if (!/^https?:\/\/[^\s]+$/i.test(base)) return toast('Адресът трябва да започва с http:// или https://', 'err');
        localStorage.setItem('hapi.apiBase', base);
      } else {
        localStorage.removeItem('hapi.apiBase');
      }
      if (token) sessionStorage.setItem('hapiAdminToken', token);
      else sessionStorage.removeItem('hapiAdminToken');
      state.base = base;
      state.health = '';
      toast('Връзката е запазена', 'ok');
      void loadConnection();
    });
    q('#set-test').addEventListener('click', async () => {
      const base = (q('#set-base').value.trim() || defaultBase()).replace(/\/$/, '');
      if (!base) return toast('Демо режим: няма адрес за проверка', '');
      try {
        const res = await fetch(`${base}/health`, { headers: storedToken() ? { Authorization: `Bearer ${storedToken()}` } : {} });
        if (!res.ok) return toast(`Сървърът отговори HTTP ${res.status}`, 'err');
        const health = await res.json().catch(() => ({}));
        toast(`Връзката работи${health.status ? ` · ${health.status}` : ''}`, 'ok');
      } catch (e) {
        toast(`Няма връзка: ${e.message}`, 'err');
      }
    });
    q('#set-clear').addEventListener('click', () => {
      sessionStorage.removeItem('hapiAdminToken');
      q('#set-token').value = '';
      state.health = '';
      toast('Токенът е изчистен', 'ok');
      render();
    });
    q('#set-public-save').addEventListener('click', async () => {
      const value = q('#set-public').value.trim().replace(/\/$/, '');
      if (value && !/^https?:\/\/[A-Za-z0-9.\-:[\]]+(\/[A-Za-z0-9._~\-/]*)?$/.test(value)) {
        return toast('Публичният адрес трябва да е http(s)://host[:port][/път]', 'err');
      }
      const r = await api('/admin/api/settings', { method: 'PATCH', json: { limits: { publicBaseUrl: value } } });
      if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
      state.publicBaseUrl = value;
      toast(value ? 'Публичният адрес е записан' : 'Публичният адрес е изчистен', 'ok');
      render();
    });
    // PGP: прикачване на ключ, автоподписване (падащо меню) и избор на ключ.
    if (q('#set-pgp-attach')) q('#set-pgp-attach').addEventListener('click', () => void attachPgpKey());
    if (q('#set-pgp-import')) q('#set-pgp-import').addEventListener('click', () => void importPgpBundle());
    if (q('#set-pgp-autosign')) {
      q('#set-pgp-autosign').addEventListener('change', (e) => void savePgpSettings({ autoSign: e.target.value === 'on' }));
    }
    if (q('#set-pgp-keyid')) {
      q('#set-pgp-keyid').addEventListener('change', (e) => void savePgpSettings({ signKeyId: e.target.value }));
    }
    host.querySelectorAll('[data-pgp-remove]').forEach((btn) => {
      btn.addEventListener('click', () => void removePgpKey(btn.getAttribute('data-pgp-remove')));
    });
    // Профили на настройките: списък · прилагане · изтриване · запис на текущото състояние.
    const renderProfiles = (list) => {
      const box = q('#set-profiles');
      if (!box) return;
      if (!list.length) {
        box.innerHTML = '<p class="hint">Няма запазени профили.</p>';
        return;
      }
      box.innerHTML = '<table class="grid"><thead><tr><th>Профил</th><th>Създаден</th><th></th></tr></thead><tbody>' +
        list.map((p) => {
          const name = typeof p === 'string' ? p : p.name || '';
          return '<tr><td><code>' + esc(name) + '</code></td><td>' + esc(fmtTime(p.createdAt || p.savedAt)) + '</td>' +
            '<td><button type="button" class="btn" data-profile-apply="' + esc(name) + '">Приложи</button> ' +
            '<button type="button" class="btn" data-profile-delete="' + esc(name) + '">Изтрий</button></td></tr>';
        }).join('') + '</tbody></table>';
      box.querySelectorAll('[data-profile-apply]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.getAttribute('data-profile-apply');
          if (!window.confirm('Да приложа ли профил „' + name + '“? Текущите настройки ще бъдат заменени.')) return;
          const r = await api('/admin/api/config-profiles/' + encodeURIComponent(name) + '/apply', { method: 'POST', json: {} });
          toast(r.ok ? 'Профилът е приложен' : r.error || 'Профилът не е приложен', r.ok ? 'ok' : 'err');
          if (r.ok) void refreshProfiles();
        });
      });
      box.querySelectorAll('[data-profile-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const name = btn.getAttribute('data-profile-delete');
          if (!window.confirm('Да изтрия ли профил „' + name + '“?')) return;
          const r = await api('/admin/api/config-profiles/' + encodeURIComponent(name), { method: 'DELETE' });
          toast(r.ok ? 'Профилът е изтрит' : r.error || 'Профилът не е изтрит', r.ok ? 'ok' : 'err');
          if (r.ok) void refreshProfiles();
        });
      });
    };
    const refreshProfiles = async () => {
      if (!connected()) return;
      const r = await api('/admin/api/config-profiles');
      if (!r.ok) return;
      renderProfiles((r.data && r.data.profiles) || []);
    };
    if (q('#set-profiles') && connected()) void refreshProfiles();
    if (q('#set-profile-save')) {
      q('#set-profile-save').addEventListener('click', async () => {
        const name = q('#set-profile-name').value.trim();
        if (!name) return toast('Въведи име на профила', 'err');
        const r = await api('/admin/api/config-profiles', { method: 'POST', json: { name } });
        if (!r.ok) return toast(r.error || 'Профилът не е записан', 'err');
        q('#set-profile-name').value = '';
        toast('Профилът е записан', 'ok');
        void refreshProfiles();
      });
    }
    if (q('#set-ingress-login')) {
      q('#set-ingress-login').addEventListener('click', async () => {
        const r = await api('/admin/api/ingress-login');
        if (!r.ok) return toast(r.error || 'Входът през Home Assistant не е възможен', 'err');
        state.role = (r.data && r.data.role) || state.role;
        state.ingress = Boolean(r.data && r.data.ingress);
        toast('Влязох през Home Assistant · роля ' + (state.role || '—'), 'ok');
        render();
      });
    }
    bindTabs();
  }

  function mount(node) {
    host = node;
    state.base = storedBase();
    state.token = storedToken();
    render();
    if (!state.loaded) void loadConnection();
  }

  window.SettingsPanel = { mount, state };
})();
