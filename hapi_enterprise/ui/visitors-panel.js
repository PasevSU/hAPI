'use strict';
// Панел „Кой влиза“ — чете сензорите за комуникацията (visitor-intel.js) през
// администраторския API. Показва САМО това, което add-on-ът върна: ако няма връзка,
// казва го, вместо да рисува нули.
//
// Личните данни се рисуват като текст (`textContent`), не като HTML — име на файл или
// User-Agent не могат да станат разметка. Изтриването на посетител е с потвърждение и
// се отразява веднага в списъка.
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const base = () => (localStorage.getItem('hapi.apiBase') || (location.protocol === 'file:' ? '' : location.origin)).replace(/\/$/, '');
  const token = () => sessionStorage.getItem('hapiAdminToken') || '';

  async function api(path, method = 'GET') {
    const url = base();
    if (!url) return { ok: false, offline: true };
    try {
      const res = await fetch(url + path, {
        method,
        headers: token() ? { Authorization: 'Bearer ' + token() } : {},
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      return { ok: false, status: 0, error: e.message };
    }
  }

  function toast(view, message, kind) {
    // Съобщенията минават през общия `HapiUI.toast` (както при осталите панели), а ако
    // го няма — през локален възел, за да не зависи панелът от обвивката.
    if (window.HapiUI && typeof window.HapiUI.toast === 'function') return window.HapiUI.toast(message, kind);
    const node = view.ownerDocument.createElement('div');
    node.className = 'toast ' + (kind || '');
    node.setAttribute('role', 'status');
    node.textContent = message;
    view.ownerDocument.body.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  const fmtTime = (iso) => {
    if (!iso) return '—';
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : String(iso);
  };
  const fmtPlace = (geo) => (!geo ? 'неизвестно' : [geo.city, geo.country].filter(Boolean).join(', ') || geo.country || 'неизвестно');
  const shortId = (id) => String(id || '').slice(0, 10);

  function cell(doc, text, className) {
    const td = doc.createElement('td');
    if (className) td.className = className;
    td.textContent = String(text == null ? '' : text);
    return td;
  }

  function row(doc, visitor, onDelete) {
    const tr = doc.createElement('tr');
    tr.dataset.visitor = visitor.id;
    tr.appendChild(cell(doc, shortId(visitor.id), 'mono'));
    tr.appendChild(cell(doc, fmtTime(visitor.lastSeen)));
    tr.appendChild(cell(doc, visitor.visits));
    tr.appendChild(cell(doc, visitor.downloads));
    tr.appendChild(cell(doc, (visitor.ips || []).join(', ') || (visitor.geo && visitor.geo.private ? 'локален' : 'скрито'), 'mono'));
    tr.appendChild(cell(doc, fmtPlace(visitor.geo)));
    tr.appendChild(cell(doc, (visitor.agents || [])[0] ? String((visitor.agents || [])[0]).replace(/\//g, ' · ') : '—'));
    tr.appendChild(cell(doc, visitor.language || '—'));
    const actions = doc.createElement('td');
    const remove = doc.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-ghost btn-sm';
    remove.dataset.action = 'forget-visitor';
    remove.dataset.id = visitor.id;
    remove.textContent = 'Изтрий';
    remove.addEventListener('click', () => onDelete(visitor, remove));
    actions.appendChild(remove);
    tr.appendChild(actions);
    return tr;
  }

  function simpleRow(doc, values, className) {
    const tr = doc.createElement('tr');
    for (const value of values) tr.appendChild(cell(doc, value, className));
    return tr;
  }

  async function mount(view) {
    const doc = view.ownerDocument;
    view.innerHTML = `
      <div class="page-title">
        <h1>Кой влиза</h1>
        <span class="badge demo" id="v-badge">зареждане…</span>
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Комуникация</h2></div>
        <div class="panel-body">
          <div class="dash-grid" id="v-cards"></div>
          <p class="hint" id="v-privacy"></p>
          <div class="row-actions">
            <button type="button" class="btn" id="v-refresh">Обнови</button>
            <button type="button" class="btn" id="v-csv">Експорт CSV</button>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Посетители</h2></div>
        <div class="panel-body">
          <table class="table" id="v-visitors">
            <thead><tr>
              <th>Посетител</th><th>Последно видян</th><th>Посещения</th><th>Изтегляния</th>
              <th>IP</th><th>Локация</th><th>Клиент</th><th>Език</th><th></th>
            </tr></thead>
            <tbody></tbody>
          </table>
          <p class="hint" id="v-empty">Още няма посетители.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Какво се тегли</h2></div>
        <div class="panel-body">
          <table class="table" id="v-files">
            <thead><tr><th>Файл</th><th>Изтегляния</th><th>Посетители</th><th>Последно</th></tr></thead>
            <tbody></tbody>
          </table>
          <p class="hint" id="v-files-empty">Няма изтегляния.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Откъде идват</h2></div>
        <div class="panel-body">
          <table class="table" id="v-geo">
            <thead><tr><th>Държава</th><th>Посетители</th></tr></thead>
            <tbody></tbody>
          </table>
          <p class="hint" id="v-geo-empty">Локацията е неизвестна — няма офлайн база или още няма посетители.</p>
        </div>
      </section>`;

    const badge = view.querySelector('#v-badge');
    const cards = view.querySelector('#v-cards');
    const privacy = view.querySelector('#v-privacy');
    const body = view.querySelector('#v-visitors tbody');
    const empty = view.querySelector('#v-empty');
    const filesBody = view.querySelector('#v-files tbody');
    const filesEmpty = view.querySelector('#v-files-empty');
    const geoBody = view.querySelector('#v-geo tbody');
    const geoEmpty = view.querySelector('#v-geo-empty');

    const card = (label, value, note) => `
      <div class="dash-card">
        <span class="dash-label">${esc(label)}</span>
        <strong class="dash-value">${esc(value)}</strong>
        ${note ? `<small class="hint">${esc(note)}</small>` : ''}
      </div>`;

    async function forget(visitor, button) {
      const ask = typeof view.ownerDocument.defaultView?.confirm === 'function' ? view.ownerDocument.defaultView.confirm : null;
      const question = 'Да изтрия ли всички данни за този посетител? Действието не може да се отмени.';
      if (ask && !ask(question)) return;
      button.disabled = true;
      const res = await api('/admin/api/sensors/visitors/' + encodeURIComponent(visitor.id), 'DELETE');
      if (!res.ok) {
        button.disabled = false;
        toast(view, 'Изтриването не мина: ' + (res.status || 'няма връзка'), 'error');
        return;
      }
      toast(view, 'Данните на посетителя са изтрити', 'ok');
      await load();
    }

    async function exportCsv() {
      const url = base();
      if (!url) return toast(view, 'Няма връзка с add-on-а', 'error');
      try {
        const res = await fetch(url + '/admin/api/sensors/visitors.csv', { headers: token() ? { Authorization: 'Bearer ' + token() } : {} });
        if (!res.ok) return toast(view, 'Експортът не мина: ' + res.status, 'error');
        const blob = await res.blob();
        const link = doc.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'visitors.csv';
        link.click();
        toast(view, 'CSV файлът е изтеглен', 'ok');
      } catch (e) {
        toast(view, 'Експортът не мина: ' + e.message, 'error');
      }
    }

    async function load() {
      const [list, sensors] = await Promise.all([api('/admin/api/sensors/visitors?limit=50'), api('/admin/api/sensors')]);
      if (list.offline || sensors.offline) {
        badge.textContent = 'няма връзка';
        privacy.textContent = 'Няма връзка с add-on-а. Свържи го от „Настройки“ (адрес и токен).';
        cards.innerHTML = '';
        body.innerHTML = '';
        empty.textContent = 'Няма връзка с add-on-а.';
        return;
      }
      if (!list.ok || !sensors.ok) {
        badge.textContent = 'грешка ' + (list.status || sensors.status);
        privacy.textContent = list.status === 403 || sensors.status === 403
          ? 'Токенът няма право „sensors“ — сензорите се четат от администраторски токен.'
          : 'Сензорите не могат да се прочетат (' + (list.status || sensors.status) + ').';
        return;
      }

      const intel = sensors.data.visitorsIntel || {};
      const mode = list.data.ipMode || (intel.privacy && intel.privacy.ipMode) || 'hashed';
      badge.textContent = mode === 'full' ? 'пълни IP адреси' : mode === 'masked' ? 'маскирани IP' : 'само хеш (без IP)';

      cards.innerHTML = [
        card('Уникални посетители', intel.unique_visitors ?? 0, 'по хеш от IP + клиент'),
        card('Нови (24 ч)', intel.visitors_new_24h ?? 0),
        card('Теглили файл', intel.download_visitors ?? 0),
        card('Отказани достъпи', intel.denied_total ?? 0),
        card('Админ. влизания', intel.admin_logins ?? 0),
        card('Държави', intel.countries_known ?? 0),
      ].join('');

      const geoFile = (intel.privacy && intel.privacy.geoFile) || {};
      privacy.textContent =
        'Режим на IP: ' + mode + ' · срок на пазене: ' + ((intel.privacy && intel.privacy.retentionDays) || 0) + ' дни' +
        ' · външни заявки: ' + ((intel.privacy && intel.privacy.externalCalls) ? 'да' : 'не') +
        ' · офлайн база за локация: ' + (geoFile.loaded ? geoFile.ranges + ' диапазона' : 'няма' + (geoFile.error ? ' (' + geoFile.error + ')' : '')) + '.';

      body.innerHTML = '';
      const visitors = (list.data.visitors || []);
      empty.textContent = visitors.length ? '' : 'Още няма посетители.';
      for (const visitor of visitors) body.appendChild(row(doc, visitor, forget));

      filesBody.innerHTML = '';
      const files = (intel.files || []);
      filesEmpty.textContent = files.length ? '' : 'Няма изтегляния.';
      for (const file of files.slice(0, 50)) filesBody.appendChild(simpleRow(doc, [file.name || file.id, file.downloads, file.visitors, fmtTime(file.lastAt)]));

      geoBody.innerHTML = '';
      const countries = Object.entries(intel.geo ? intel.geo.countries || {} : {}).sort((a, b) => b[1] - a[1]);
      geoEmpty.textContent = countries.length ? '' : 'Локацията е неизвестна — няма офлайн база или още няма посетители.';
      for (const [country, count] of countries) geoBody.appendChild(simpleRow(doc, [country, count]));
    }

    view.querySelector('#v-refresh').addEventListener('click', () => { badge.textContent = 'обновяване…'; void load(); });
    view.querySelector('#v-csv').addEventListener('click', exportCsv);
    await load();
  }

  window.HapiVisitorsPanel = { mount };
})();
