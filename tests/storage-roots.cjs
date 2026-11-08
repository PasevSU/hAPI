'use strict';
// ДОГОВОР ЗА ХРАНИЛИЩЕТО: ЛОГИЧЕСКИ КОРЕНИ, ЕДНО МЯСТО, БЕЗ ПАПКА В КОРЕНА НА ДИСКА.
//
// Заявка (потребител, 0.69.208): „`share` не трябва да бъде директория по подразбиране в
// проекта, където и да е… това трябва да се регламентира веднъж за винаги… добави договор
// и проверка с тест дали това го има някъде другаде“.
//
// Измереният проблем: на Windows `path.resolve('/share')` е `D:\share` — папка в корена на
// диска, създадена от тестовете (211 портала след серия пускания), без никой да я е искал.
// После тя бавеше дървото на порталите, докато един сценарий изтече като „флейк“.
//
// Тестът пази ПЕТ неща:
//   1. логическите корени и имената на променливите са в `hapi_enterprise/paths.js` и никъде
//      другаде не се решават до host път;
//   2. `resolveRoot()` никога не връща път в корена на диск, когато логическата папка липсва;
//   3. дори сървър, пуснат БЕЗ `STORAGE_ROOT_OVERRIDE` (както правят повечето тестове), НЕ
//      създава папка в корена на диска;
//   4. `storage-preflight.js` не държи втори списък с логически низове;
//   5. ГУИ средата дава на тестовете времен корен и го издава, за да не го строи тестът сам.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const paths = require('../hapi_enterprise/paths.js');
const stripCode = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function main() {
  // ── 1. Единственото място за дефинициите ─────────────────────────────────
  assert.deepEqual(
    { ...paths.LOGICAL_ROOTS },
    { share: '/share', media: '/media', config: '/config', data: '/data' },
    'логическите корени трябва да са точно тези четири',
  );
  assert.equal(Object.isFrozen(paths.LOGICAL_ROOTS), true, 'LOGICAL_ROOTS е замразен — никой не го предефинира по време на работа');
  assert.deepEqual([...paths.CONFIG_ROOTS], ['/config', '/homeassistant'], 'корените на HA конфигурацията са в paths.js, не по модулите');
  assert.equal(Object.isFrozen(paths.CONFIG_ROOTS), true, 'CONFIG_ROOTS е замразен');
  for (const name of ['STORAGE_ROOT_OVERRIDE', 'DATA_DIR', 'STORAGE_LOCATION', 'STORAGE_SUBDIRECTORY']) {
    assert.equal(Object.values(paths.ENV).includes(name), true, 'липсва име на променлива: ' + name);
  }

  // ── 2. Никой друг модул не решава логически корен до host път ────────────
  {
    const allowed = new Set(['paths.js', 'storage-preflight.js']);
    const offenders = [];
    for (const dir of ['hapi_enterprise', 'hapi_enterprise/routes']) {
      for (const file of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js'))) {
        if (allowed.has(file)) continue;
        const code = stripCode(fs.readFileSync(path.join(root, dir, file), 'utf8'));
        // `path.resolve('/share')` и подобни са точно това, което създава D:\share.
        if (/path\.resolve\(\s*'\/?(share|media|config|data)'/.test(code)) offenders.push(dir + '/' + file);
        if (/os\.tmpdir\(\),?\s*'hapi-storage'/.test(code)) offenders.push(dir + '/' + file + ' (собствен temp корен)');
      }
    }
    assert.deepEqual(offenders, [], 'тези файлове решават логически корен сами, а не през paths.js: ' + offenders.join(', '));
  }

  // ── 2б. Няма ВТОРИ списък с логически корени ─────────────────────────────
  // Дублиран списък се разминава тихо, когато `paths.js` се промени. Файловете, които са
  // UMD (работят и в браузъра) и не могат да `require`-нат `paths.js`, са изрично изброени —
  // за тях проверката е РАВЕНСТВО на стойностите, а не липса на литерали.
  {
    const umdWithPolicyList = {
      'export-rules.js': ['/data', '/share', '/media'],
      'public-gateway.js': ['/share', '/media'],
    };
    const literals = Object.values(paths.LOGICAL_ROOTS);
    /** Всички масиви в кода, които изреждат поне два логически корена. */
    const rootLists = (code) => [...code.matchAll(/\[([^[\]]*)\]/g)]
      .map((m) => m[1])
      // Само ПЛОСКИ списъци от низове (или разпръснат `...`): масив от обекти с поле
      // `storage_root` е данни, не втори списък с корени.
      .filter((t) => t.split(',').every((part) => /^\s*'\/(?:share|media|config|data)'\s*$/.test(part) || /^\s*\.\.\./.test(part)))
      .filter((t) => (t.match(/'\/(?:share|media|config|data)'/g) || []).length >= 2)
      .map((t) => [...new Set([...t.matchAll(/'(\/(?:share|media|config|data))'/g)].map((m) => m[1]))].sort());

    const offenders = [];
    for (const dir of ['hapi_enterprise', 'hapi_enterprise/routes']) {
      for (const file of fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js'))) {
        if (file === 'paths.js') continue;
        const lists = rootLists(stripCode(fs.readFileSync(path.join(root, dir, file), 'utf8')));
        if (!lists.length) continue;
        const expected = umdWithPolicyList[file];
        if (!expected) { offenders.push(dir + '/' + file); continue; }
        for (const found of lists) {
          assert.deepEqual(found, [...expected].sort(), file + ': литералите се разминават с paths.LOGICAL_ROOTS: ' + found.join(', '));
        }
      }
    }
    assert.deepEqual(offenders, [], 'тези файлове държат ВТОРИ списък с логически корени: ' + offenders.join(', '));

    // ГУИ-ят не строи host пътища, а само предлага стойности — но и те не бива да се разминават.
    for (const file of fs.readdirSync(path.join(root, 'hapi_enterprise/ui')).filter((f) => f.endsWith('.js'))) {
      for (const found of rootLists(stripCode(fs.readFileSync(path.join(root, 'hapi_enterprise/ui', file), 'utf8')))) {
        for (const value of found) assert.equal(literals.includes(value), true, file + ': „' + value + '“ не е логически корен от paths.js');
        for (const value of [paths.LOGICAL_ROOTS.share, paths.LOGICAL_ROOTS.media]) {
          assert.equal(found.includes(value), true, file + ': списъкът в интерфейса пропуска ' + value);
        }
      }
    }
  }

  // ── 3. Решаването не излиза в корена на диска ────────────────────────────
  {
    for (const name of Object.keys(paths.LOGICAL_ROOTS)) {
      const real = paths.resolveRoot(name, {});
      assert.equal(path.isAbsolute(real), true, name + ': очаква се абсолютен път, получено ' + real);
      assert.notEqual(path.dirname(real), real, name + ': резултатът е корен на диск/файлова система: ' + real);
      if (!fs.existsSync(paths.LOGICAL_ROOTS[name])) {
        assert.equal(
          real.startsWith(os.tmpdir()),
          true,
          name + ': липсващата логическа папка трябва да падне под временната, а не в корена на диска: ' + real,
        );
      }
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-roots-'));
    try {
      assert.equal(paths.resolveRoot('share', { STORAGE_ROOT_OVERRIDE: tmp }), path.join(tmp, 'share'), 'override → <override>/share');
      assert.equal(
        paths.resolveStoragePath('/share/USB', 'portal', { STORAGE_ROOT_OVERRIDE: tmp }),
        path.join(tmp, 'share', 'USB', 'portal'),
        'логическият storage_root се пренася под override, включително подпапките',
      );
      assert.equal(
        paths.resolveStoragePath('', 'portal', { STORAGE_ROOT_OVERRIDE: tmp }),
        path.join(tmp, 'share', 'portal'),
        'празен storage_root = /share',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    assert.equal(paths.isLogicalRoot('/share'), true);
    assert.equal(paths.isLogicalRoot('/share/USB'), false, 'подпапката не е логически корен');
    assert.equal(paths.isLogicalRoot(''), true, 'празно = коренът по подразбиране, тоест общ корен');
    assert.throws(() => paths.logicalRoot('nope'), /Unknown storage location/, 'непознат корен е грешка, не мълчание');
  }

  // ── 3б. Папка на портал върху общ корен не се създава и не се обявява ─────
  // `ensure()`/`folderReady()` са пътят, по който един портал би създал `<диск>:\share`
  // (при `portal_folder_copy`) и би обявил договор `/tree`, който сървърът после отказва.
  {
    const portalFolder = require('../hapi_enterprise/portal-folder.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-roots-ensure-'));
    process.env.STORAGE_ROOT_OVERRIDE = tmp;
    try {
      for (const storage_root of ['/share', '/media', '']) {
        assert.equal(await portalFolder.ensure({ id: 'x', slug: 'x', storage_root }), null,
          'общ корен „' + (storage_root || '(празен)') + '“ не се създава');
        assert.equal(await portalFolder.folderReady({ storage_root }), false,
          'общ корен „' + (storage_root || '(празен)') + '“ не се обявява като папка');
        assert.equal(fs.existsSync(path.join(tmp, 'share')), false, 'на диска не се появи общ корен');
        assert.equal(fs.existsSync(path.join(tmp, 'media')), false, 'нито /media');
      }
      // Собствена папка — създава се и се обявява (иначе горното би било „нищо не работи“).
      const own = await portalFolder.ensure({ id: 'y', slug: 'y', storage_root: '/share/y' });
      assert.equal(own, path.join(tmp, 'share', 'y'), 'собствената папка се създава под корена');
      assert.equal(await portalFolder.folderReady({ storage_root: '/share/y' }), true);
    } finally {
      delete process.env.STORAGE_ROOT_OVERRIDE;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ── 4. Сървър БЕЗ override не създава папка в корена на диска ────────────
  // Сърцето на договора: ~110 теста пускат сървъра само с `DATA_DIR`. Дотук това значеше
  // „хранилището е `/share`“, тоест на Windows `D:\share`.
  {
    const driveShare = path.resolve('/share');
    const existedBefore = fs.existsSync(driveShare);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-roots-server-'));
    const port = await freePort();
    const token = 'roots-test-token-0123456789abcdef';
    const env = { ...process.env, DATA_DIR: dataDir, PORT: String(port), PUBLIC_GATEWAY_PORT: '0', ADMIN_TOKEN: token };
    // Нарочно БЕЗ override — както го правят повечето тестове.
    delete env.STORAGE_ROOT_OVERRIDE;
    const child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const base = 'http://127.0.0.1:' + port;
    const headers = { Authorization: 'Bearer ' + token, 'content-type': 'application/json' };
    try {
      let up = false;
      for (let i = 0; i < 300 && !up; i += 1) {
        try {
          up = (await fetch(base + '/health')).status === 200;
        } catch {
          /* още не слуша */
        }
        if (!up) await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(up, 'сървърът не вдигна /health');
      const made = await fetch(base + '/admin/api/portals', {
        method: 'POST',
        headers,
        body: JSON.stringify({ slug: 'roots-probe', title: 'Коренова проба', visibility: 'public', storage_root: '/share/roots-probe' }),
      });
      const body = await made.json().catch(() => null);
      assert.equal(made.status, 201, 'порталът за пробата е създаден: ' + made.status + ' ' + JSON.stringify(body));
      const files = await fetch(base + '/admin/api/portals/' + body.id + '/files', {
        method: 'POST',
        headers: { ...headers, 'X-File-Name': 'probe.txt' },
        body: 'probe',
      });
      assert.equal(files.status, 201, 'файлът е качен: ' + files.status);
      await files.arrayBuffer();
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.on('exit', r));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    if (!existedBefore) {
      assert.equal(
        fs.existsSync(driveShare),
        false,
        'сървър без STORAGE_ROOT_OVERRIDE създаде папка в корена на диска: ' + driveShare,
      );
    }
  }

  // ── 5. Дефинициите не се разминават; ГУИ средата дава времен корен ───────
  {
    const preflight = read('hapi_enterprise/storage-preflight.js');
    assert.match(preflight, /require\('\.\/paths'\)/, 'storage-preflight ползва paths.js');
    assert.equal(
      /const roots = \{\s*addon_config: '\//.test(preflight),
      false,
      'storage-preflight не бива да държи ВТОРИ списък с низове — корените са в paths.js',
    );
    const config = read('hapi_enterprise/config.yaml');
    for (const value of ['share', 'media', 'addon_config']) {
      assert.match(config, new RegExp('storage_location[\\s\\S]{0,400}' + value), 'config.yaml не предлага „' + value + '“ сред местата');
    }
    const harness = read('tests/lib/gui-harness.cjs');
    assert.match(harness, /STORAGE_ROOT_OVERRIDE/, 'gui-harness подава STORAGE_ROOT_OVERRIDE');
    assert.equal(
      /path\.resolve\('\/share'\)/.test(stripCode(harness)),
      false,
      'gui-harness не бива да решава /share сам — ползва временната си папка',
    );
    assert.match(harness, /storageRoot: \(\) => storageRoot/, 'harness издава пътя на хранилището, за да не го строи тестът сам');
    assert.equal(
      /path\.resolve\('\/share'/.test(stripCode(read('tests/gui-journeys.cjs'))),
      false,
      'gui-journeys строи пътя през server.storageRoot(), не през /share',
    );
  }

  // ── 5б. ИНСТАЛИРАНЕТО също чете глобалните дефиниции ────────────────────
  // `/data` (данните на add-on-а) и `/config` (app_config) се срещат в entrypoint-а и в
  // правилата за gateway-я — там също не бива да има втори литерал.
  {
    const start = stripCode(read('hapi_enterprise/start.js'));
    assert.match(start, /require\('\.\/paths'\)/, 'start.js ползва paths.js');
    assert.equal(
      /HAPI_ADDON_DATA_DIR \|\| '\//.test(start),
      false,
      'start.js не бива да твърди /data сам — ползва paths.LOGICAL_ROOTS.data',
    );
    assert.match(start, /paths\.LOGICAL_ROOTS\.data/, 'entrypoint-ът взима данните на add-on-а от paths.js');
    for (const file of ['gateway-api.js', 'layout.js', 'evidence-portal.js', 'start.js']) {
      assert.match(read('hapi_enterprise/' + file), /require\('\.\/paths'\)/, file + ' ползва paths.js');
    }
    const evidence = stripCode(read('hapi_enterprise/evidence-portal.js'));
    assert.equal(
      /platform === 'win32' \? '' : '\/share'/.test(evidence),
      false,
      'evidence-portal не гадае по платформа — пита paths.existingRoot(…)',
    );
    assert.match(evidence, /paths\.existingRoot\('share'/, 'evidence-portal ползва paths.existingRoot');
    assert.match(evidence, /paths\.CONFIG_ROOTS/, 'evidence-portal ползва paths.CONFIG_ROOTS');
  }

  // ── 5в. existingRoot: път само когато папката НАИСТИНА съществува ────────
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-roots-existing-'));
    try {
      assert.equal(paths.existingRoot('share', { STORAGE_ROOT_OVERRIDE: tmp }), '', 'липсваща папка → празен низ, не нов път');
      fs.mkdirSync(path.join(tmp, 'share'), { recursive: true });
      assert.equal(paths.existingRoot('share', { STORAGE_ROOT_OVERRIDE: tmp }), path.join(tmp, 'share'), 'съществуваща → пътя');
      assert.equal(paths.existingRoot('media', { STORAGE_ROOT_OVERRIDE: tmp }), '', '/media не се подменя с /share');
      assert.throws(() => paths.existingRoot('nope', {}), /Unknown storage location/, 'непознат корен е грешка');
      if (process.platform === 'win32') {
        // Windows няма Home Assistant: `/share` там е `D:\share`. Без override отговорът е
        // „няма такова хранилище“, дори папката да е останала от предишен тест.
        assert.equal(paths.existingRoot('share', {}), '', 'на Windows без override няма /share');
        assert.equal(paths.existingRoot('config', {}), '', 'на Windows без override няма /config');
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ── 5г. Preflight-ът (инсталирането) не създава хранилище на чуждо място ─
  {
    const preflight = require('../hapi_enterprise/storage-preflight.js');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-roots-preflight-'));
    try {
      // Без override и без логически корен на машината → отказ, а не „ще си направя“.
      if (process.platform === 'win32') {
        assert.throws(() => preflight.check({}, {}), /Storage root is not available/, 'липсващ корен е отказ, не mkdir');
      }
      // С override и съществуваща папка → минава и връща базата под нея.
      fs.mkdirSync(path.join(tmp, 'share'), { recursive: true });
      const base = preflight.check({}, { STORAGE_ROOT_OVERRIDE: tmp });
      assert.equal(base, path.join(tmp, 'share', 'hapi', 'data'), 'preflight връща <override>/share/hapi/data');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ── 6. Правилото важи за ЦЕЛИЯ проект, не само за `hapi_enterprise/` ────
  // Всеки тест, който строи `<диск>:\share` сам, създава папка в корена на диска на
  // машината и подвежда следващите тестове (DEF-53/DEF-54). Затова се забранява със
  // статична проверка: логическият корен се превежда САМО през `paths.js` (в сървъра —
  // `portalAbs()`), а тестът взима готов път от `helpers.cjs#storageRoot()`.
  {
    const forbidden = [
      // `<диск>:\share` се строи и през `.root, 'share'` (вкл. `path.parse(process.cwd())`).
      { re: /\.root\s*,\s*['"]share['"]/, why: 'строи <диск>:/share от корена на диска' },
      { re: /path\.resolve\(\s*'\/?(share|media)'/, why: 'решава логически корен сам' },
      { re: /path\.join\(\s*'\/(share|media)/, why: 'сглобява host път за /share' },
    ];
    const skip = new Set(['storage-roots.cjs']); // този файл проверява точно тези низове
    // Освен тестовете се сканират и инструментите за издаване (`scripts/`) и интеграцията:
    // `artifact-smoke` строеше `/share` сам и пускаше сървъра от архива без override — точно
    // затова `D:\share` се появяваше след ГУИ одита, а не след матрицата.
    const dirs = [path.join(root, 'tests'), path.join(root, 'scripts'), path.join(root, 'custom_components')];
    const bad = [];
    while (dirs.length) {
      const dir = dirs.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // `tests/lib/` е инфраструктурата: тя ИМА право да говори за пътища (но и там
          // правилото е същото — виж проверката за gui-harness по-горе).
          if (entry.name !== 'lib') dirs.push(full);
          continue;
        }
        if (!entry.name.endsWith('.cjs') || skip.has(entry.name)) continue;
        const code = stripCode(fs.readFileSync(full, 'utf8'));
        for (const rule of forbidden) {
          if (rule.re.test(code)) bad.push(`${path.relative(root, full)} — ${rule.why}`);
        }
      }
    }
    assert.deepEqual(bad, [], 'тези тестове строят host път за /share вместо да ползват storageRoot():\n  ' + bad.join('\n  '));
  }

  console.log(
    'PASS storage-roots: един източник (paths.js) · без папка в корена на диска дори без override · ГУИ средата с времен корен · нито един тест не строи <диск>:/share',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
