'use strict';
// ФУНКЦИИТЕ НА ПОРТАЛА КАТО ЕДИН ОБЕКТ С ЧЕКБОКСОВЕ.
//
// Докладван проблем: шест блока в контролния панел, всеки с по няколко бутона без икони, а
// една и съща проверка се натиска на три места. Решението: ЕДИН обект с функции — икона от
// йерархията на спрайта v4 (`ui/icons-v4-map.json`), чекбокс за общо изпълнение и място за
// състоянието на всяка функция.
//
// Този тест пада, ако:
//   • ред от обекта няма икона, която съществува в йерархията на спрайта (празна икона);
//   • ред от обекта няма текст на ТРИТЕ езика (BG/EN/DE);
//   • ред от обекта няма обработчик в `files-manager.js` (мъртъв бутон);
//   • чекбоксът не включва функцията в общото изпълнение или общият бутон не брои избраните;
//   • общото изпълнение не минава през същите функции и не оставя състояние на реда;
//   • грешка в една функция спира останалите (тогава „изпълни избраните“ лъже).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { startServer, mountUi, waitFor, expandPortalBlocks } = require('./lib/gui-harness.cjs');
const { storageRoot } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PANEL_MODULES = [
  'data.js', 'icons.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-report-sign.js', 'report-sign.js', 'secret-share.js',
].filter((f) => f !== 'secret-report-sign.js');

/** Обектът се взима от САМИЯ модул — иначе тестът би описвал копие на договора. */
function loadRegistry() {
  // Модулът е IIFE за браузър и пише на `window`, затова се пуска в собствен контекст с
  // подправен `window` (не през `new Function`, което `tests/bad-code.cjs` забранява).
  const win = {};
  const sandbox = vm.createContext({ window: win });
  vm.runInContext(read('hapi_enterprise/ui/portal-control.js'), sandbox, { filename: 'portal-control.js' });
  assert.ok(win.HapiPortalControl, 'portal-control.js се зарежда');
  return win.HapiPortalControl.FUNCTIONS;
}

const iconsSrc = JSON.parse(read('hapi_enterprise/ui/icons-v4-map.json'));
const HIERARCHY = new Set();
(function walk(node) {
  if (Array.isArray(node)) return node.forEach(walk);
  if (node && typeof node === 'object') return Object.values(node).forEach(walk);
  if (typeof node === 'string') HIERARCHY.add(node);
})(iconsSrc.scopes);
for (const name of iconsSrc.iconsUsed || []) HIERARCHY.add(name);

const i18nSrc = read('hapi_enterprise/ui/i18n.js');

(async () => {
  const FUNCTIONS = loadRegistry();

  // ── 1. Обектът: идентификатори, икони от йерархията, три езика ─────────────
  assert.ok(FUNCTIONS.length >= 10, 'обектът съдържа функциите на панела: ' + FUNCTIONS.length);
  const ids = FUNCTIONS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'идентификаторите са уникални: ' + ids.join(', '));
  for (const fn of FUNCTIONS) {
    assert.ok(fn.icon && HIERARCHY.has(fn.icon), 'иконата „' + fn.icon + '“ на „' + fn.id + '“ е в йерархията на спрайта');
    assert.ok(fn.fallback, '„' + fn.id + '“ има резервна икона от вградения набор');
    assert.ok(['security', 'access', 'qr', 'config', 'report'].includes(fn.area), '„' + fn.id + '“ е в позната област');
    // Всеки текст се среща в BG, EN и DE речника — иначе немският панел показва ключ.
    const occurrences = i18nSrc.split("'" + fn.label + "':").length - 1;
    assert.equal(occurrences, 3, 'текстът на „' + fn.id + '“ (' + fn.label + ') е на трите езика: ' + occurrences);
  }
  for (const key of ['pc.fn.title', 'pc.fn.run', 'pc.fn.select', 'pc.fn.summary', 'pc.fn.nothing']) {
    assert.equal(i18nSrc.split("'" + key + "':").length - 1, 3, 'ключът ' + key + ' е на трите езика');
  }

  // ── 2. Всеки ред има обработчик, всеки обработчик — ред ────────────────────
  const managerSrc = read('hapi_enterprise/ui/files-manager.js');
  for (const id of ids) {
    assert.equal(managerSrc.includes("bindFn('" + id + "'"), true, '„' + id + '“ има обработчик в files-manager.js');
  }
  const bound = [...managerSrc.matchAll(/bindFn\('([a-z-]+)'/g)].map((m) => m[1]);
  const orphans = bound.filter((id) => !ids.includes(id));
  assert.deepEqual(orphans, [], 'няма обработчик без ред в обекта: ' + orphans.join(', '));

  // ── 3. Живият панел: редове, чекбоксове, брой избрани ────────────────────
  const storage = storageRoot();
  // Собствена папка за данните: вътрешното копие, което проверката за цялост чете, е
  // `<dataDir>/files/<portalId>/<fileId>` — то се подменя в §7.
  const dataDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ui-fn-data-'));
  const server = await startServer({ dataDir, env: { ...storage.env, PORTAL_FOLDER_COPY: 'true' } });
  try {
    const created = await server.api('/admin/api/portals', 'POST', { title: 'Портал с функции', slug: 'p-ui-funkcii', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const portal = created.data.portal || created.data;

    // Файл в портала: без него проверката за цялост няма какво да сверява и §7 би минал
    // „защото няма файлове“, а не защото панелът чете присъдата.
    const upload = await fetch(server.base + '/admin/api/portals/' + encodeURIComponent(portal.id) + '/files', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + server.token, 'x-file-name': encodeURIComponent('dokaz.txt') },
      body: 'байтове за проверка',
    });
    assert.ok(upload.status === 201 || upload.status === 200, 'файлът се качва: ' + upload.status);
    const file = await upload.json();
    assert.ok(file && file.id, 'качването връща id: ' + JSON.stringify(file).slice(0, 160));

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portal.id;
    ui.window.FilesManagerPanel.mount(host);
    await expandPortalBlocks(host, { block: 'control' });

    await waitFor(() => host.querySelector('#pf-fn-run'), { label: 'общият бутон на функциите' });
    const rows = [...host.querySelectorAll('[data-fn-row]')];
    assert.equal(rows.length, ids.length, 'всеки ред от обекта е на екрана: ' + rows.length);

    // Чекбоксът носи ИМЕТО на функцията за екранен четец, а не „чекбокс 3“.
    for (const fn of FUNCTIONS) {
      const box = host.querySelector('[data-fn-check="' + fn.id + '"]');
      assert.ok(box, 'има чекбокс за „' + fn.id + '“');
      const label = box.getAttribute('aria-label') || '';
      const name = ui.window.HapiI18n.t(fn.label);
      assert.ok(label.includes(name), 'чекбоксът на „' + fn.id + '“ назовава функцията: ' + label);
    }

    const runBtn = host.querySelector('#pf-fn-run');
    assert.equal(runBtn.disabled, true, 'без избрани функции общият бутон е изключен');
    assert.match(runBtn.textContent, /0/, 'етикетът брои избраните: ' + runBtn.textContent);

    // Две функции: проверка на цялостта и списък с токени.
    const tick = (id) => {
      const box = host.querySelector('[data-fn-check="' + id + '"]');
      box.checked = true;
      box.dispatch('change');
    };
    tick('integrity');
    tick('token-list');
    assert.equal(host.querySelector('#pf-fn-run').disabled, false, 'с две избрани бутонът е активен');
    assert.match(host.querySelector('#pf-fn-run').textContent, /2/, 'етикетът казва две: ' + host.querySelector('#pf-fn-run').textContent);

    // ── 4. Общо изпълнение: същите функции, състояние по редове ────────────
    host.querySelector('#pf-fn-run').click();
    const stateOf = (id) => {
      const cell = host.querySelector('[data-fn-state="' + id + '"]');
      return cell ? cell.dataset.state : null;
    };
    await waitFor(() => stateOf('integrity') === 'ok' && stateOf('token-list') === 'ok', {
      label: 'състоянието на двата реда',
      timeout: 20000,
    });
    // Изпълнението мина през СЪРВЪРА, а не през копие в панела: отговорът се вижда в изхода,
    // а проверката оставя и следа в дневника (`check.integrity`).
    assert.match(host.querySelector('#pf-security-out').textContent || '', /Проверени/, 'проверката на цялостта е изпълнена');
    assert.match(host.querySelector('#pf-token-out').textContent || '', /издадени|Готово/i, 'списъкът с токени е прочетен');
    const summary = host.querySelector('#pf-fn-out').textContent || '';
    assert.match(summary, /2/, 'обобщението казва колко са минали: ' + summary);
    const log = await server.api('/admin/api/logs?limit=200');
    assert.equal(log.status, 200, 'дневникът се чете');
    assert.equal(
      (log.data.entries || []).some((e) => e.msg === 'check.integrity'),
      true,
      'общото изпълнение оставя следа в дневника: ' + JSON.stringify((log.data.entries || []).map((e) => e.msg).slice(0, 12)),
    );

    // ── 5. Грешка в една функция не спира останалите ───────────────────────
    // `qr-block` без основание отказва ЛОКАЛНО (без заявка) — точният случай за „счупена
    // функция в средата на списъка“. След нея `qr-show` трябва пак да мине.
    for (const box of host.querySelectorAll('[data-fn-check]')) box.checked = false;
    tick('qr-block');
    tick('qr-show');
    host.querySelector('#pf-fn-run').click();
    await waitFor(() => stateOf('qr-block') === 'fail' && stateOf('qr-show') === 'ok', {
      label: 'провалът на едната и успехът на другата',
      timeout: 20000,
    });
    assert.match(host.querySelector('#pf-qr-out').textContent, /основание/i, 'панелът казва защо е отказал');
    assert.match(host.querySelector('#pf-fn-out').textContent, /2/, 'обобщението брои и двете');

    // ── 6. Един ред може да се изпълни и сам (бутонът пази клавиатурата) ────
    for (const box of host.querySelectorAll('[data-fn-check]')) box.checked = false;
    host.querySelector('#pf-integrity').click();
    await waitFor(() => stateOf('integrity') === 'ok', { label: 'състоянието след единично изпълнение' });

    // ── 7. Подмяна на файл: панелът чете ПРИСЪДАТА, а не брои сам ───────────
    // Преди 0.69.237 редът четеше `summary.ok/mismatch/missing` (малки букви), докато сървърът
    // дава `MISMATCH` — при подмяна панелът пишеше „разминават се 0“ точно когато имаше
    // подмяна. Затова тук се подменя ВЪТРЕШНОТО копие и се иска числото 1, а не 0.
    const internal = path.join(dataDir, 'files', portal.id, file.id);
    assert.ok(fs.existsSync(internal), 'вътрешното копие е на място: ' + internal);
    fs.writeFileSync(internal, 'подменени байтове', 'utf8');
    host.querySelector('#pf-integrity').click();
    await waitFor(() => stateOf('integrity') === 'fail', { label: 'провалът на проверката за цялост', timeout: 20000 });
    const verdictText = host.querySelector('#pf-security-out').textContent || '';
    assert.match(verdictText, /проблемни 1\b/, 'броят на проблемните идва от присъдата: ' + verdictText);
    assert.match(host.querySelector('#pf-security-out').className, /err/, 'провалът е червен, не „готово“');
    assert.equal(managerSrc.includes('r.data.verdict'), true, 'числата се взимат от `verdict` на сървъра, не от `summary`');

    console.log(
      'PASS ui-portal-functions: ' + FUNCTIONS.length + ' функции от един обект · икони от йерархията на спрайта v4 · ' +
        'три езика · чекбокс за общо изпълнение с брояч · състояние по редове (успех/грешка) · ' +
        'грешка в една не спира останалите · единично изпълнение от реда · ' +
        'подмяна се показва като „проблемни 1“ от присъдата',
    );
  } finally {
    await server.stop();
    fs.rmSync(storage.dir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL ui-portal-functions: ' + error.message);
  process.exitCode = 1;
});
