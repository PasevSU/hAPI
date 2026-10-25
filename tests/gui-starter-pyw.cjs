'use strict';
// Стартерът за Windows: истински WebView2, а не „браузър в режим на приложение“.
//
// План 18 §7 иска WebView2 обвивка, а `START_HAPI_GUI.bat` отваря Edge с `--app=`,
// което е друг механизъм. Затова има `START_HAPI_GUI.pyw`: ако `pywebview` (и
// WebView2 runtime, който Edge носи) е налице, прозорецът е WebView2; иначе пада
// към същия Edge/Chrome `--app=` път, който вече работи. Тестът проверява
// РЕШЕНИЕТО на стартера (през `--check`/`--dry-run`), а не картинка на екран.
//
// Границата е казана на глас: `--selftest-webview2` създава обекта на прозореца,
// без да стартира цикъла на събитията — доказва, че pywebview и WebView2 приемат
// този URL, но НЕ доказва, че прозорецът изглежда добре. За последното трябва
// човек да го погледне.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'START_HAPI_GUI.pyw');
const cases = [];
const ok = (name) => { cases.push(name); console.log('  ✔ ' + name); };

const findPython = () => {
  for (const cmd of ['python', 'py']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cmd;
  }
  return '';
};

const run = (python, args) => {
  const r = spawnSync(python, [script, ...args], { encoding: 'utf8', cwd: root });
  return { status: r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
};

const isWin = process.platform === 'win32';
const python = isWin && fs.existsSync(script) ? findPython() : '';

if (!isWin) {
  console.log('PASS gui-starter-pyw: пропуснат — стартерът е за Windows (платформа: ' + process.platform + ')');
  process.exit(0);
}
if (!python) {
  console.log('PASS gui-starter-pyw: пропуснат — няма python в PATH, а стартерът е .pyw');
  process.exit(0);
}

assert.ok(fs.existsSync(script), 'START_HAPI_GUI.pyw съществува');
ok('.pyw стартерът съществува (без конзолен прозорец, за разлика от .bat)');

// ── 1. `--check`: какво е намерено, без да отваря нищо ──────────────────────
const check = run(python, ['--check']);
assert.equal(check.status, 0, '--check минава, получено: ' + check.status + ' ' + check.err);
const info = JSON.parse(check.out);
assert.equal(info.guiExists, true, 'index.html е намерен');
assert.equal(info.url, 'file:///' + info.gui.replace(/\\/g, '/'), 'URL-ът е производен на пътя (както в .bat)');
assert.ok(info.url.endsWith('/hapi_enterprise/ui/index.html'), 'URL-ът сочи към GUI-я');
assert.deepEqual(info.window, [1440, 900], 'прозорецът е със същия размер като в .bat');
ok('--check: намерени GUI, URL и размер на прозореца');

// ── 2. Резервният път е същият като .bat (иначе „работи при мен“) ───────────
{
  const bat = fs.readFileSync(path.join(root, 'START_HAPI_GUI.bat'), 'utf8');
  assert.ok(bat.includes('--window-size=1440,900'), '.bat ползва същия размер');
  const fb = run(python, ['--dry-run', '--no-webview']);
  assert.equal(fb.status, 0, 'резервният път се описва, получено: ' + fb.status);
  const plan = JSON.parse(fb.out);
  assert.equal(plan.mode, 'browser-app', 'без pywebview се пада към браузър в режим на приложение');
  assert.ok(fs.existsSync(plan.command[0]), 'браузърът съществува: ' + plan.command[0]);
  assert.equal(plan.command[1], '--app=' + info.url, 'същият --app= URL като в .bat');
  assert.equal(plan.command[2], '--window-size=1440,900', 'същият размер като в .bat');
  ok('резервният път дава същата команда като .bat (' + path.basename(plan.command[0]) + ' --app=…)');
}

// ── 3. WebView2 пътят: описан, а когато е налице — и създаден ───────────────
{
  const dr = run(python, ['--dry-run']);
  assert.equal(dr.status, 0, 'решението се описва, получено: ' + dr.status);
  const plan = JSON.parse(dr.out);
  if (info.webview2) {
    assert.equal(plan.mode, 'webview2', 'с pywebview се избира WebView2');
    assert.equal(plan.command[1], info.url, 'WebView2 получава същия URL');
    // Създава обекта на прозореца, но НЕ стартира цикъла: без прозорец на екрана.
    const self = run(python, ['--selftest-webview2']);
    assert.equal(self.status, 0, 'pywebview + WebView2 приемат URL-а, получено: ' + self.status + ' ' + self.err);
    const made = JSON.parse(self.out);
    assert.equal(made.created, true, 'прозорецът е създаден (без start())');
    ok('WebView2: режимът се избира и прозорецът се създава за ' + info.url);
  } else {
    assert.equal(plan.mode, 'browser-app', 'без pywebview режимът е резервният');
    assert.equal(info.browserExists, true, 'резервният път е възможен, защото има браузър');
    ok('WebView2 липсва на тази машина → избран е резервният път (не е грешка)');
  }
}

console.log('PASS gui-starter-pyw: ' + cases.length + ' проверки — ' + cases.join('; '));
