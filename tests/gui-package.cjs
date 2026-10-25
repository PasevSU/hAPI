'use strict';
// САМОСТОЯТЕЛНИЯТ GUI ПАКЕТ (W8): какво има в него и дали СТАРТИРА от мястото, където е разопакован.
//
// Защо тестът строи пакета, вместо да чете `dist/`: матрицата се пуска и на чисто дърво, където
// `dist/` още няма. Затова списъкът се взима от СЪЩИЯ помощник, който ползва `build-release.cjs`
// (`lib.guiPackage`) — иначе „пакетът съдържа“ и „тестът проверява“ се разминават тихо.
//
// Проверява се поведението, не наличието: архивът се разопакова във временна папка и стартерът
// се пита оттам какво ще отвори. Ако структурата в архива е сгрешена (например `ui/` без
// `hapi_enterprise/`), стартерът няма да намери `index.html` — точно грешката, която иначе се
// вижда чак при потребителя.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const lib = require('../scripts/release-lib.cjs');

const root = path.join(__dirname, '..');
const cases = [];
const ok = (label) => cases.push(label);

const pkg = lib.guiPackage(path.join(root, lib.ADDON_DIR), root, lib.readAddonVersion(root));
const zip = lib.buildZip(lib.assertSafeEntryPaths(pkg.entries, 'gui'));
const entries = lib.readZip(zip);
const paths = new Set(entries.map((e) => e.path));
// Списъкът тук е ИЗПИСАН, а не взет от `lib.GUI_FILES`: ако allowlist-ът се чете от същия
// помощник, който строи пакета, то „добави backend файл“ би минало тихо — тестът би разрешил
// точно това, което трябва да забрани. Затова позволеното извън `ui/` е три имена, не "колкото
// каже константата".
const STARTERS = ['START_HAPI_GUI.pyw', 'START_HAPI_GUI.bat', 'START_HAPI_GUI.txt'];

// ── 1. Съдържание: интерфейсът и стартерите, без backend ────────────────────
{
  assert.ok(paths.has(lib.ADDON_DIR + '/ui/index.html'), 'има index.html');
  for (const name of ['app.js', 'styles.css', 'panel-registry.js', 'i18n.js']) {
    assert.ok(paths.has(lib.ADDON_DIR + '/ui/' + name), 'има ui/' + name + ' (иначе GUI-ят не тръгва)');
  }
  for (const name of STARTERS) assert.ok(paths.has(name), 'има стартер ' + name);
  const rootLevel = [...paths].filter((p) => !p.startsWith(lib.ADDON_DIR + '/ui/'));
  assert.deepEqual(rootLevel.sort(), [...STARTERS].sort(), 'извън ui/ има точно стартерите, получено: ' + JSON.stringify(rootLevel));
  ok('пакетът съдържа интерфейса (' + paths.size + ' файла) и трите файла на стартера');
}

// ── 2. Backend НЕ влиза — това е смисълът на отделния пакет ─────────────────
{
  for (const forbidden of ['server.js', 'start.js', 'config.yaml', 'Dockerfile', 'worm.js']) {
    assert.equal(paths.has(lib.ADDON_DIR + '/' + forbidden), false, 'backend файл в GUI пакета: ' + forbidden);
    assert.equal(paths.has(forbidden), false, 'backend файл в основата на GUI пакета: ' + forbidden);
  }
  for (const name of paths) {
    assert.ok(name.startsWith(lib.ADDON_DIR + '/ui/') || STARTERS.includes(name), 'чужд файл в пакета: ' + name);
  }
  ok('няма нито един backend файл (само ui/ + стартерите)');
}

// ── 3. Стартира от разопакованото място ────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-gui-pkg-'));
try {
  for (const entry of entries) {
    const target = path.join(dir, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
  assert.ok(fs.existsSync(path.join(dir, lib.ADDON_DIR, 'ui', 'index.html')), 'index.html е на очакваното място');

  const python = (() => {
    for (const cmd of ['python', 'py']) {
      if (spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0) return cmd;
    }
    return '';
  })();
  if (process.platform === 'win32' && python) {
    const run = (args) => spawnSync(python, [path.join(dir, 'START_HAPI_GUI.pyw'), ...args], { encoding: 'utf8', cwd: dir });
    const check = run(['--check']);
    assert.equal(check.status, 0, 'стартерът от разопакованата папка минава --check: ' + String(check.stderr || '').slice(0, 120));
    const info = JSON.parse(String(check.stdout).trim());
    assert.equal(info.guiExists, true, 'стартерът намира index.html в разопакованата папка');
    assert.equal(info.url, 'file:///' + path.join(dir, lib.ADDON_DIR, 'ui', 'index.html').replace(/\\/g, '/'),
      'URL-ът сочи в разопакованата папка, не в хранилището');
    const plan = JSON.parse(String(run(['--dry-run', '--no-webview']).stdout).trim());
    assert.equal(plan.mode, 'browser-app', 'резервният път е наличен и в пакета');
    assert.ok(String(plan.command[1]).includes(path.join(dir, lib.ADDON_DIR, 'ui', 'index.html').replace(/\\/g, '/')),
      'командата сочи същия файл');
    assert.equal(plan.command[2], '--window-size=1440,900', 'размерът на прозореца е същият');
    ok('разопакован, стартерът намира GUI-я и описва същата команда (пътят е в temp, не в репото)');
  } else {
    // Без Python частта с прозореца не може да се провери — казва се, вместо да се премълчи.
    ok('съдържанието е проверено; стартирането не се проверява (няма python/Windows)');
  }

  // ── 4. Упътването стига до потребителя ────────────────────────────────────
  const readme = fs.readFileSync(path.join(dir, 'START_HAPI_GUI.txt'), 'utf8');
  assert.ok(readme.includes('START_HAPI_GUI.pyw'), 'упътването сочи .pyw');
  assert.ok(readme.includes('START_HAPI_GUI.bat'), 'упътването сочи .bat');
  assert.ok(readme.includes('pywebview'), 'упътването казва от какво зависи WebView2 пътят');
  assert.ok(/Не е Windows инсталатор/.test(readme), 'упътването казва какво този пакет НЕ е');
  ok('упътването в пакета казва как се стартира и какво пакетът не е');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('PASS gui-package: ' + cases.length + ' проверки — ' + cases.join('; '));
