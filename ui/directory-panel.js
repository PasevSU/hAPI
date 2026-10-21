'use strict';
// Контакти и дела (самостоятелни панели). Ползват същите административни API-та
// като порталите: /admin/api/directory и /admin/api/cases.
//
// И двата панела следват стандарта: полета по 2 на ред, бутони на собствен ред
// (1 → четвърт вдясно, 2 → половинки), табелки с ясен контраст.
(function () {
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => window.HapiUI && window.HapiUI.toast(m, k);
  const iso = (v) => {
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 16).replace('T', ' ') : '—';
  };
  const shortId = (v) => String(v || '').slice(0, 10);

  let host = null;
  const state = { contacts: [], cases: [], fields: [], query: '', error: '', editing: null, contactsLoaded: false, casesLoaded: false };

  const el = (s) => (location.protocol === 'file:' ? '' : location.origin);
  const base = () => (localStorage.getItem('hapi.apiBase') || el()).replace(/\/$/, '');
  const token = () => sessionStorage.getItem('hapiAdminToken') || '';
  const connected = () => Boolean(base());

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {});
    if (token()) headers.Authorization = `Bearer ${token()}`;
    if (o.json !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(base() + path, {
        method: o.method || 'GET',
        headers,
        body: o.json !== undefined ? JSON.stringify(o.json) : undefined,
      });
      const type = res.headers.get('Content-Type') || '';
      const data = type.includes('application/json') ? await res.json() : null;
      return { ok: res.ok, status: res.status, error: res.ok ? '' : (data && data.error) || `HTTP ${res.status}`, data };
    } catch (e) {
      return { ok: false, status: 0, error: e.message, data: null };
    }
  }

  const contactName = (c) => (c && (c.name || (c.fields && c.fields.name) || c.email)) || 'без име';
  const contactOf = (id) => state.contacts.find((c) => c.id === id) || null;
  const extrasOf = (x) => (Array.isArray(x && x.extras) ? x.extras : []).filter((e) => e && e.key);

  // ── Контакти ───────────────────────────────────────────────────────────────
  const Contacts = {
    async load() {
      if (!connected()) {
        state.contactsLoaded = true;
        return renderContacts();
      }
      const r = await api('/admin/api/directory');
      if (r.ok && r.data) {
        state.contacts = (r.data.contacts || []).map((c) => ({ ...c, name: (c.fields && c.fields.name) || '' }));
        state.fields = r.data.fields || [];
        state.error = '';
      } else {
        state.error = r.error || `HTTP ${r.status}`;
      }
      state.contactsLoaded = true;
      renderContacts();
    },

    async save(form) {
      const value = (name) => {
        const input = form.querySelector(`[name="${name}"]`);
        return input ? input.value.trim() : '';
      };
      const email = value('email');
      if (!/^[^\s@<>"]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,}$/i.test(email)) return toast('Невалиден имейл', 'err');
      const fields = {};
      for (const f of state.fields) {
        const v = value(`f_${f.key}`);
        if (v) fields[f.key] = v;
      }
      if (value('f_name')) fields.name = value('f_name');
      const extras = [];
      form.querySelectorAll('[data-extra-key]').forEach((input) => {
        const row = input.closest('.pf-extra-row');
        const val = row ? row.querySelector('[data-extra-value]') : null;
        if (input.value.trim()) extras.push({ key: input.value.trim(), value: val ? val.value.trim() : '' });
      });
      const editing = state.editing;
      const r = editing
        ? await api(`/admin/api/directory/contacts/${encodeURIComponent(editing)}`, { method: 'PATCH', json: { fields, extras } })
        : await api('/admin/api/directory/contacts', { method: 'POST', json: { email, fields, extras } });
      if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
      state.editing = null;
      toast(editing ? 'Контактът е обновен' : 'Контактът е добавен', 'ok');
      await Contacts.load();
    },

    async remove(c) {
      if (!window.confirm(`Изтриване на контакта „${contactName(c)}“?`)) return;
      const r = await api(`/admin/api/directory/contacts/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
      toast('Контактът е изтрит', 'ok');
      await Contacts.load();
    },
  };

  function extrasEditor(list) {
    const rows = (list && list.length ? list : [{ key: '', value: '' }])
      .map(
        (x) => `<div class="pf-extra-row">
          <input data-extra-key value="${esc(x.key || '')}" placeholder="поле (напр. Роля)" maxlength="60" />
          <input data-extra-value value="${esc(x.value || '')}" placeholder="стойност" maxlength="500" />
          <button type="button" class="btn btn-sm" data-extra-remove title="Премахни полето">✕</button>
        </div>`,
      )
      .join('');
    return `<div class="pf-extras">
      <div class="pf-extras-rows">${rows}</div>
      <div class="u-row u-row-1"><button type="button" class="btn btn-sm" data-extra-add>＋ добави поле по желание</button></div>
    </div>`;
  }

  function contactForm() {
    const editing = state.editing ? state.contacts.find((c) => c.id === state.editing) : null;
    const fields = editing ? { ...(editing.fields || {}) } : {};
    const known = new Set(['name', 'phone', 'organization', 'department', 'city', 'country']);
    const extraKeys = state.fields.filter((f) => !known.has(f.key));
    return `<form id="ct-form" class="pf-form">
      <h4>${editing ? 'Редактиране на контакт' : 'Нов контакт'}</h4>
      <div class="u-grid u-grid-fields">
        <div class="field"><label>Име</label><input name="f_name" value="${esc(fields.name || '')}" maxlength="120" placeholder="Мария Иванова" /></div>
        <div class="field"><label>Имейл (задължителен)</label><input name="email" value="${esc(editing ? editing.email : '')}" maxlength="190" placeholder="name@example.com" ${
          editing ? 'readonly' : ''
        } /></div>
        <div class="field"><label>Телефон</label><input name="f_phone" value="${esc(fields.phone || '')}" maxlength="25" placeholder="+359 88 123 4567" /></div>
        <div class="field"><label>Организация</label><input name="f_organization" value="${esc(fields.organization || '')}" maxlength="120" /></div>
        ${extraKeys
          .slice(0, 4)
          .map(
            (f) =>
              `<div class="field"><label>${esc(f.label || f.key)}</label><input name="f_${esc(f.key)}" value="${esc(
                fields[f.key] || '',
              )}" maxlength="120" /></div>`,
          )
          .join('')}
      </div>
      <p class="hint">Полета по желание:</p>
      ${extrasEditor(extrasOf(editing))}
      <div class="u-row u-row-2 u-mt">
        <button type="submit" class="btn btn-primary">${editing ? 'Запази промените' : 'Добави контакта'}</button>
        <button type="button" class="btn" id="ct-reset">${editing ? 'Отказ' : 'Изчисти'}</button>
      </div>
    </form>`;
  }

  function contactCard(c) {
    const fields = c.fields || {};
    const extras = extrasOf(c);
    const meta = [fields.phone, fields.organization, fields.department, fields.city].filter(Boolean);
    return `<article class="pf-portal" data-contact="${esc(c.id)}">
      <div class="pf-portal-head">
        <span class="pf-portal-name">${esc(contactName(c))}</span>
        <span class="chip">✉ ${esc(c.email || '—')}</span>
        ${meta.map((m) => `<span class="chip">${esc(m)}</span>`).join('')}
        <span class="state-chip ok">контакт</span>
      </div>
      ${
        extras.length
          ? `<div class="fm-ico-row u-grid u-grid-chips">${extras
              .map(
                (x) =>
                  `<span class="fm-ico" title="${esc(`${x.key}: ${x.value}`)}"><span class="fm-ico-g">•</span><span class="fm-ico-v">${esc(
                    `${x.key}: ${x.value}`,
                  )}</span></span>`,
              )
              .join('')}</div>`
          : '<p class="fm-file-sub">няма полета по желание</p>'
      }
      <p class="fm-file-sub">id: <code>${esc(shortId(c.id))}</code> · създаден ${esc(iso(c.createdAt))}</p>
      <div class="u-row u-row-2 u-mt">
        <button type="button" class="btn btn-sm" data-edit-contact="${esc(c.id)}">Редактирай</button>
        <button type="button" class="btn btn-sm" data-del-contact="${esc(c.id)}">Изтрий</button>
      </div>
    </article>`;
  }

  function renderContacts() {
    const list = state.contacts
      .filter((c) => {
        const q = state.query.toLowerCase();
        if (!q) return true;
        return [contactName(c), c.email, (c.fields || {}).organization, (c.fields || {}).phone]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => contactName(a).localeCompare(contactName(b)));

    host.innerHTML = `
      <div class="page-title">
        <h1>Контакти</h1>
        <span class="badge ${connected() ? 'ok' : 'demo'}">${connected() ? `${state.contacts.length} контакта` : 'демо'}</span>
      </div>
      ${
        connected()
          ? ''
          : '<section class="panel"><div class="panel-body"><p class="hint">Демо режим: списъкът с контакти се зарежда от add-on-а. Задай адрес и токен в „Настройки“.</p></div></section>'
      }
      <section class="panel">
        <div class="panel-head"><h2>${state.editing ? 'Редакция' : 'Нов контакт'}</h2><span class="badge">контакти</span></div>
        <div class="panel-body">${contactForm()}</div>
      </section>
      <section class="panel u-mt">
        <div class="panel-head"><h2>Списък (${list.length})</h2><span class="badge">директория</span></div>
        <div class="panel-body">
          <div class="fm-toolbar">
            <input id="ct-search" placeholder="Търси по име, имейл, организация" value="${esc(state.query)}" />
          </div>
          ${state.error ? `<p class="err-list">${esc(state.error)}</p>` : ''}
          <div class="pf-portals u-mt">${list.map(contactCard).join('') || '<p class="hint">Няма контакти.</p>'}</div>
        </div>
      </section>`;
    wireContacts();
  }

  function wireContacts() {
    const q = (sel) => host.querySelector(sel);
    const form = q('#ct-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void Contacts.save(form);
    });
    q('#ct-reset').addEventListener('click', () => {
      state.editing = null;
      renderContacts();
    });
    q('#ct-search').addEventListener('input', (e) => {
      state.query = e.target.value;
      const value = state.query;
      renderContacts();
      const input = host.querySelector('#ct-search');
      if (input) {
        input.focus();
        input.setSelectionRange(value.length, value.length);
      }
    });
    form.addEventListener('click', (e) => {
      const add = e.target.closest('[data-extra-add]');
      if (add) {
        const rows = form.querySelector('.pf-extras-rows');
        const row = document.createElement('div');
        row.className = 'pf-extra-row';
        row.innerHTML =
          '<input data-extra-key placeholder="поле" maxlength="60" /><input data-extra-value placeholder="стойност" maxlength="500" /><button type="button" class="btn btn-sm" data-extra-remove title="Премахни полето">✕</button>';
        rows.appendChild(row);
        return;
      }
      const remove = e.target.closest('[data-extra-remove]');
      if (remove) {
        const row = remove.closest('.pf-extra-row');
        if (row) row.remove();
      }
    });
    host.querySelectorAll('[data-edit-contact]').forEach((b) =>
      b.addEventListener('click', () => {
        state.editing = b.dataset.editContact;
        renderContacts();
        host.querySelector('#ct-form').scrollIntoView({ block: 'center' });
      }),
    );
    host.querySelectorAll('[data-del-contact]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = state.contacts.find((x) => x.id === b.dataset.delContact);
        if (c) void Contacts.remove(c);
      }),
    );
  }

  // ── Дела ───────────────────────────────────────────────────────────────────
  const Cases = {
    async load() {
      if (!connected()) {
        state.casesLoaded = true;
        return renderCases();
      }
      const [cases, dir] = await Promise.all([api('/admin/api/cases'), api('/admin/api/directory')]);
      if (cases.ok && cases.data) state.cases = cases.data.cases || [];
      else state.error = cases.error || `HTTP ${cases.status}`;
      if (dir.ok && dir.data) state.contacts = dir.data.contacts || [];
      state.casesLoaded = true;
      renderCases();
    },

    async save(form) {
      const value = (name) => {
        const input = form.querySelector(`[name="${name}"]`);
        return input ? input.value.trim() : '';
      };
      const body = {
        number: value('number'),
        title: value('title'),
        category: value('category'),
        subject: value('subject'),
        contactId: value('contactId'),
      };
      if (!body.number) return toast('Номерът на делото е задължителен', 'err');
      const extras = [];
      form.querySelectorAll('[data-extra-key]').forEach((input) => {
        const row = input.closest('.pf-extra-row');
        const val = row ? row.querySelector('[data-extra-value]') : null;
        if (input.value.trim()) extras.push({ key: input.value.trim(), value: val ? val.value.trim() : '' });
      });
      body.extras = extras;
      const editing = state.editing;
      const r = editing
        ? await api(`/admin/api/cases/${encodeURIComponent(editing)}`, { method: 'PATCH', json: body })
        : await api('/admin/api/cases', { method: 'POST', json: body });
      if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
      state.editing = null;
      toast(editing ? 'Делото е обновено' : 'Делото е добавено', 'ok');
      await Cases.load();
    },

    async remove(c) {
      if (!window.confirm(`Изтриване на дело „${c.number}“?`)) return;
      const r = await api(`/admin/api/cases/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
      if (!r.ok) return toast(r.error || `HTTP ${r.status}`, 'err');
      toast('Делото е изтрито', 'ok');
      await Cases.load();
    },
  };

  function caseForm() {
    const editing = state.editing ? state.cases.find((c) => c.id === state.editing) : null;
    const c = editing || {};
    return `<form id="cs-form" class="pf-form">
      <h4>${editing ? 'Редактиране на дело' : 'Ново дело'}</h4>
      <div class="u-grid u-grid-fields">
        <div class="field"><label>Номер (задължителен)</label><input name="number" value="${esc(c.number || '')}" maxlength="80" placeholder="2026-114" /></div>
        <div class="field"><label>Заглавие</label><input name="title" value="${esc(c.title || '')}" maxlength="160" placeholder="Дело 2026-114 — доказателства" /></div>
        <div class="field"><label>Категория</label><input name="category" value="${esc(c.category || '')}" maxlength="120" placeholder="Правни дела" /></div>
        <div class="field"><label>Относно</label><input name="subject" value="${esc(c.subject || '')}" maxlength="200" placeholder="посещение на лице" /></div>
        <div class="field"><label>Контакт</label>
          <select name="contactId">
            <option value="">— без контакт —</option>
            ${state.contacts
              .map(
                (x) =>
                  `<option value="${esc(x.id)}" ${c.contactId === x.id ? 'selected' : ''}>${esc(contactName(x))}${
                    x.email ? ` — ${esc(x.email)}` : ''
                  }</option>`,
              )
              .join('')}
          </select>
        </div>
      </div>
      <p class="hint">Полета по желание:</p>
      ${extrasEditor(extrasOf(editing))}
      <div class="u-row u-row-2 u-mt">
        <button type="submit" class="btn btn-primary">${editing ? 'Запази промените' : 'Добави делото'}</button>
        <button type="button" class="btn" id="cs-reset">${editing ? 'Отказ' : 'Изчисти'}</button>
      </div>
    </form>`;
  }

  function caseCard(c) {
    const contact = contactOf(c.contactId);
    const extras = extrasOf(c);
    return `<article class="pf-portal" data-case="${esc(c.id)}">
      <div class="pf-portal-head">
        <span class="pf-portal-name">${esc(c.number)} — ${esc(c.title || 'без заглавие')}</span>
        ${c.category ? `<span class="chip">🏷 ${esc(c.category)}</span>` : ''}
        ${c.subject ? `<span class="chip">ℹ ${esc(c.subject)}</span>` : ''}
        <span class="state-chip ${contact ? 'ok' : 'warn'}">${contact ? esc(contactName(contact)) : 'без контакт'}</span>
      </div>
      ${
        extras.length
          ? `<div class="fm-ico-row u-grid u-grid-chips">${extras
              .map(
                (x) =>
                  `<span class="fm-ico" title="${esc(`${x.key}: ${x.value}`)}"><span class="fm-ico-g">•</span><span class="fm-ico-v">${esc(
                    `${x.key}: ${x.value}`,
                  )}</span></span>`,
              )
              .join('')}</div>`
          : ''
      }
      <p class="fm-file-sub">id: <code>${esc(shortId(c.id))}</code> · създадено ${esc(iso(c.createdAt))}</p>
      <div class="u-row u-row-2 u-mt">
        <button type="button" class="btn btn-sm" data-edit-case="${esc(c.id)}">Редактирай</button>
        <button type="button" class="btn btn-sm" data-del-case="${esc(c.id)}">Изтрий</button>
      </div>
    </article>`;
  }

  function renderCases() {
    const list = state.cases
      .filter((c) => {
        const q = state.query.toLowerCase();
        if (!q) return true;
        return [c.number, c.title, c.category, c.subject].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    host.innerHTML = `
      <div class="page-title">
        <h1>Дела</h1>
        <span class="badge ${connected() ? 'ok' : 'demo'}">${connected() ? `${state.cases.length} дела` : 'демо'}</span>
      </div>
      ${
        connected()
          ? ''
          : '<section class="panel"><div class="panel-body"><p class="hint">Демо режим: делата се зареждат от add-on-а. Задай адрес и токен в „Настройки“.</p></div></section>'
      }
      <section class="panel">
        <div class="panel-head"><h2>${state.editing ? 'Редакция' : 'Ново дело'}</h2><span class="badge">дела</span></div>
        <div class="panel-body">${caseForm()}</div>
      </section>
      <section class="panel u-mt">
        <div class="panel-head"><h2>Списък (${list.length})</h2><span class="badge">дела</span></div>
        <div class="panel-body">
          <div class="fm-toolbar">
            <input id="cs-search" placeholder="Търси по номер, заглавие, категория" value="${esc(state.query)}" />
          </div>
          ${state.error ? `<p class="err-list">${esc(state.error)}</p>` : ''}
          <div class="pf-portals u-mt">${list.map(caseCard).join('') || '<p class="hint">Няма дела.</p>'}</div>
        </div>
      </section>`;
    wireCases();
  }

  function wireCases() {
    const q = (sel) => host.querySelector(sel);
    const form = q('#cs-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void Cases.save(form);
    });
    q('#cs-reset').addEventListener('click', () => {
      state.editing = null;
      renderCases();
    });
    q('#cs-search').addEventListener('input', (e) => {
      state.query = e.target.value;
      const value = state.query;
      renderCases();
      const input = host.querySelector('#cs-search');
      if (input) {
        input.focus();
        input.setSelectionRange(value.length, value.length);
      }
    });
    form.addEventListener('click', (e) => {
      const add = e.target.closest('[data-extra-add]');
      if (add) {
        const rows = form.querySelector('.pf-extras-rows');
        const row = document.createElement('div');
        row.className = 'pf-extra-row';
        row.innerHTML =
          '<input data-extra-key placeholder="поле" maxlength="60" /><input data-extra-value placeholder="стойност" maxlength="500" /><button type="button" class="btn btn-sm" data-extra-remove title="Премахни полето">✕</button>';
        rows.appendChild(row);
        return;
      }
      const remove = e.target.closest('[data-extra-remove]');
      if (remove) {
        const row = remove.closest('.pf-extra-row');
        if (row) row.remove();
      }
    });
    host.querySelectorAll('[data-edit-case]').forEach((b) =>
      b.addEventListener('click', () => {
        state.editing = b.dataset.editCase;
        renderCases();
        host.querySelector('#cs-form').scrollIntoView({ block: 'center' });
      }),
    );
    host.querySelectorAll('[data-del-case]').forEach((b) =>
      b.addEventListener('click', () => {
        const c = state.cases.find((x) => x.id === b.dataset.delCase);
        if (c) void Cases.remove(c);
      }),
    );
  }

  function mountContacts(node) {
    host = node;
    state.query = '';
    state.editing = null;
    renderContacts();
    if (!state.contactsLoaded) void Contacts.load();
  }

  function mountCases(node) {
    host = node;
    state.query = '';
    state.editing = null;
    renderCases();
    if (!state.casesLoaded) void Cases.load();
  }

  window.ContactsPanel = { mount: mountContacts, Contacts };
  window.CasesPanel = { mount: mountCases, Cases };
})();
