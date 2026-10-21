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
      const data = type.includes('application/json') ? await res.json() : null;
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
    render();
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
    render();
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
            ${
              keys.length > 1
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
            <textarea id="set-pgp-key" rows="6" spellcheck="false" placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----" ${
              on ? '' : 'disabled'
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
    return `<span class="state-chip ok">свързан</span> роля <code>${esc(state.role || '—')}</code>${
      state.ingress ? ' · през Home Assistant Ingress' : ''
    }`;
  }

  function render() {
    const isAdmin = state.role === 'admin';
    host.innerHTML = `
      <div class="page-title">
        <h1>Настройки</h1>
        <span class="badge ${connected() ? 'ok' : 'demo'}">${connected() ? 'връзка' : 'демо'}</span>
      </div>

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
          </div>
        </div>
      </section>

      <section class="panel u-mt">
        <div class="panel-head"><h2>Публичен адрес за API и QR</h2><span class="badge ${state.publicBaseUrl ? 'ok' : 'demo'}">${
          state.publicBaseUrl ? 'зададен' : 'не е зададен'
        }</span></div>
        <div class="panel-body">
          <p class="hint">По този адрес се строят препратките в api.json, openapi.json и QR кодовете. В Home Assistant това е адресът, на който е достъпен публичният gateway (напр. <code>http://192.168.50.4:8088</code>). Ако е празно, използва се адресът на интерфейса — при Ingress той не е публично достъпен.</p>
          <div class="u-grid u-grid-fields">
            <div class="field">
              <label>Публичен адрес</label>
              <input id="set-public" value="${esc(state.publicBaseUrl)}" placeholder="http://192.168.50.4:8088" ${
                isAdmin ? '' : 'disabled'
              } />
              <small class="hint">${
                isAdmin ? 'Само http/https, до 200 знака.' : 'Само роля admin може да променя тази настройка.'
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
