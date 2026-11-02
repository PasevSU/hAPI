'use strict';
// Интеграцията (`custom_components/hapi_enterprise`) е PYTHON, а целият тестов пакет е JS.
// Досега нито един тест не я пипаше: счупен Python файл не се виждаше от 293-те теста —
// Home Assistant просто няма да зареди интеграцията, а изданието щеше да изглежда зелено.
//
// Тук се проверява това, което може БЕЗ инсталиран Home Assistant:
//   1. всеки `.py` се компилира (синтактична грешка = интеграцията не се зарежда);
//   2. всяко име, внесено от `.const`, съществува в `const.py` (премахната константа =
//      `ImportError` при зареждане, а не при тест);
//   3. всяка платформа от `PLATFORMS` има файл с `async_setup_entry` (иначе HA я пропуска);
//   4. `strings.json`, `translations/en.json` и `translations/bg.json` имат еднакви ключове —
//      липсващ ключ показва суров ключ в интерфейса на HA;
//   5. всяка причина за грешка, която `config_flow.py` връща, има текст в преводите, и
//      обратното: превод без код е мъртъв текст.
//
// Какво НЕ се проверява: поведение срещу истински Home Assistant (нужен е пакетът
// `homeassistant`, който не е зависимост на репото) — това остава открита граница и е
// записано в матрицата (`HA_INTEGRATION_PYTHON`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.join(__dirname, '../custom_components/hapi_enterprise');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

const pyFiles = fs.readdirSync(dir).filter((name) => name.endsWith('.py')).sort();
assert.ok(pyFiles.length >= 5, 'очакват се поне 5 Python файла, намерени: ' + pyFiles.length);
// Байткодът не бива да влиза в HACS пакета: той е артефакт от локално пускане, не изходник.
const bytecode = fs.readdirSync(dir).filter((name) => name === '__pycache__' || name.endsWith('.pyc'));
assert.deepEqual(bytecode, [], 'в папката на интеграцията има байткод (влиза в пакета): ' + bytecode.join(', '));

// ── 1. Компилация ──────────────────────────────────────────────────────────
// `compile()` в паметта, а не `py_compile`: не се пише `__pycache__` в репото.
const PY_CHECK = [
  'import sys, pathlib',
  'bad = []',
  'for p in sys.argv[1:]:',
  '    try:',
  "        compile(pathlib.Path(p).read_text(encoding='utf-8'), p, 'exec')",
  '    except SyntaxError as e:',
  '        bad.append("%s:%s: %s" % (p, e.lineno, e.msg))',
  '    except ValueError as e:',
  '        bad.append("%s: %s" % (p, e))',
  'print("\\n".join(bad))',
  'sys.exit(1 if bad else 0)',
].join('\n');

const findPython = () => {
  for (const cmd of ['python', 'py', 'python3']) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return cmd;
  }
  return '';
};

const python = findPython();
let compiled = 0;
if (!python) {
  // Без интерпретатор проверката не може да се направи — казва се, вместо да се премълчи.
  console.log('ha-integration-python: няма python — компилацията не се проверява');
} else {
  const files = pyFiles.map((name) => path.join(dir, name));
  const run = spawnSync(python, ['-c', PY_CHECK, ...files], { encoding: 'utf8' });
  assert.equal(run.status, 0, 'Python файловете не се компилират:\n' + (run.stdout || '') + (run.stderr || ''));
  compiled = files.length;
}

// ── 2. Имената от const.py ─────────────────────────────────────────────────
const constSrc = read('const.py');
const defined = new Set();
for (const m of constSrc.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=/gm)) defined.add(m[1]);
for (const m of constSrc.matchAll(/^([A-Z_][A-Z0-9_]*)\s*:\s*[^=]+=/gm)) defined.add(m[1]);
assert.ok(defined.size >= 8, 'const.py трябва да дефинира поне 8 имена, намерени: ' + defined.size);

const imported = new Map();
for (const name of pyFiles) {
  if (name === 'const.py') continue;
  const src = read(name);
  // Двата вида ред: `from .const import (\n A,\n B,\n)` и `from .const import DOMAIN`.
  const blocks = [...src.matchAll(/from\s+\.const\s+import\s+\(([^)]*)\)/g)].map((m) => m[1]);
  const single = [...src.matchAll(/from\s+\.const\s+import\s+([^\n(]+)/g)].map((m) => m[1]);
  for (const chunk of [...blocks, ...single]) {
    for (const raw of chunk.split(',')) {
      const token = raw.replace(/#.*$/, '').trim().split(/\s+as\s+/)[0];
      if (!token) continue;
      if (!imported.has(name)) imported.set(name, new Set());
      imported.get(name).add(token);
    }
  }
}
assert.ok(imported.size >= 3, 'поне три модула внасят нещо от const.py, намерени: ' + imported.size);
for (const [name, names] of imported) {
  const missing = [...names].filter((n) => !defined.has(n));
  assert.deepEqual(missing, [], `${name}: имена, които не съществуват в const.py → ${missing.join(', ')}`);
}

// ── 3. Платформите ─────────────────────────────────────────────────────────
const platformsRaw = (constSrc.match(/^PLATFORMS\s*=\s*\[([^\]]*)\]/m) || [])[1];
assert.ok(platformsRaw, 'const.py трябва да дефинира PLATFORMS');
const platforms = [...platformsRaw.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
assert.ok(platforms.length >= 2, 'очакват се поне две платформи, намерени: ' + platforms.length);
for (const platform of platforms) {
  const file = platform + '.py';
  assert.ok(pyFiles.includes(file), `PLATFORMS сочи „${platform}“, а ${file} липсва`);
  assert.match(read(file), /async def async_setup_entry\(/, `${file} няма async_setup_entry — HA няма да го зареди`);
}

// ── 4. Преводите ───────────────────────────────────────────────────────────
const flat = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, prefix + k + '.') : [prefix + k]));
const strings = JSON.parse(read('strings.json'));
const en = JSON.parse(fs.readFileSync(path.join(dir, 'translations/en.json'), 'utf8'));
const bg = JSON.parse(fs.readFileSync(path.join(dir, 'translations/bg.json'), 'utf8'));
const keys = flat(strings).sort();
assert.ok(keys.length >= 40, 'очакват се поне 40 преводни ключа, намерени: ' + keys.length);
assert.deepEqual(flat(en).sort(), keys, 'translations/en.json се разминава с strings.json');
assert.deepEqual(flat(bg).sort(), keys, 'translations/bg.json се разминава с strings.json');
// Празен превод е също толкова счупен, колкото липсващ: HA показва празен низ.
const empties = [];
const walk = (obj, prefix = '') => {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') walk(v, prefix + k + '.');
    else if (typeof v === 'string' && !v.trim()) empties.push(prefix + k);
  }
};
walk(strings);
assert.deepEqual(empties, [], 'празни преводи: ' + empties.join(', '));

// ── 5. Причините в config_flow срещу текстовете ────────────────────────────
const flow = read('config_flow.py');
const reasons = new Set();
for (const m of flow.matchAll(/errors\[[^\]]+\]\s*=\s*"([a-z][a-z0-9_]*)"/g)) reasons.add(m[1]);
for (const m of flow.matchAll(/^\s*return\s+"([a-z][a-z0-9_]+)"/gm)) reasons.add(m[1]);
assert.ok(reasons.size >= 5, 'очакват се поне 5 причини в config_flow, намерени: ' + reasons.size);

const translated = new Set([
  ...Object.keys(strings.config.error || {}),
  ...Object.keys(strings.config.abort || {}),
]);
const untranslated = [...reasons].filter((r) => !translated.has(r));
assert.deepEqual(untranslated, [], 'причини без текст (HA ще покаже суров ключ): ' + untranslated.join(', '));
const unused = [...translated].filter((t) => !reasons.has(t) && t !== 'already_configured');
assert.deepEqual(unused, [], 'преводи без код, който да ги връща: ' + unused.join(', '));

// ── 6. Allowlist-ите на моста ──────────────────────────────────────────────
// `_ALLOWED` и `_PUBLIC_TAIL` са ГРАНИЦАТА на сигурността на интеграцията: какво от
// вътрешния портал и от публичния gateway стига до браузъра през HA. Те са само регулярен
// израз в Python файл — досега нищо не ги проверяваше срещу реален списък от пътища, тоест
// разширяване на израза (или забравена котва) щеше да мине незабелязано.
// Изразът се ВЗИМА от кода, а не се преписва: иначе тестът пази копие, а не границата.
const init = read('__init__.py');
const patternOf = (name) => {
  const at = init.indexOf(name + ' = re.compile(');
  assert.ok(at >= 0, name + ' не се намира в __init__.py');
  const open = init.indexOf('(', at);
  const close = init.indexOf('\n)', open);
  assert.ok(close > open, name + ': не се намира краят на re.compile(');
  const parts = [...init.slice(open + 1, close).matchAll(/r"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  assert.ok(parts.length >= 1, name + ': няма шаблон в re.compile(');
  // Python `fullmatch` + име на група → същото в JS (`^…$`, `(?<име>…)`).
  return new RegExp(parts.join('').replace(/\(\?P</g, '(?<'));
};
const ALLOWED = patternOf('_ALLOWED');
const PUBLIC_TAIL = patternOf('_PUBLIC_TAIL');

const ALLOWED_OK = [
  ['p/demo', 'порталът'],
  ['p/demo/files', 'списъкът файлове'],
  ['p/demo/files/' + 'a1b2c3d4e5f6a1b2c3d4e5f6', 'един файл по id'],
  ['p/demo/files/' + 'a1b2c3d4e5f6a1b2c3d4e5f6' + '/download', 'изтеглянето му'],
  ['p/demo/manifest', 'манифестът на портала'],
  ['p/demo/openapi.json', 'описанието на API-то'],
  ['p/demo/qr.svg', 'QR кодът'],
  ['p/demo/storage', 'хранилището'],
];
const ALLOWED_NO = [
  ['admin/api/portals', 'административното API'],
  ['admin', 'административният корен'],
  ['p/Demo', 'главни букви не са slug'],
  ['p/demo/', 'завършваща наклонена черта'],
  ['p/demo/manifest/extra', 'излишен сегмент'],
  ['p/demo/files/' + 'a'.repeat(23), '23 знака не са 24'],
  ['p/demo/files/' + 'a'.repeat(25), '25 знака не са 24'],
  ['p/demo/files/' + 'A'.repeat(24), 'главни букви не са hex'],
  ['p/demo/images/logo.png', 'непознат подпът'],
  ['p/' + 'a'.repeat(64), 'slug над 63 знака'],
  ['p/demo/../admin/api/portals', 'обхождане нагоре'],
];
for (const [tail, why] of ALLOWED_OK) assert.match(tail, ALLOWED, `мостът трябва да пуска ${why}: ${tail}`);
for (const [tail, why] of ALLOWED_NO) assert.doesNotMatch(tail, ALLOWED, `мостът НЕ бива да пуска ${why}: ${tail}`);

const PUBLIC_OK = [
  ['portals/demo', 'порталът'],
  ['portals/demo/files', 'файловете му'],
  ['files/a1b2c3', 'файл по id'],
  ['files/a1b2c3/access', 'решението за достъп'],
  ['files/a1b2c3/download', 'изтеглянето'],
];
const PUBLIC_NO = [
  ['portals/Demo', 'главни букви'],
  ['portals/demo/extra', 'излишен сегмент'],
  ['portals/demo/files/download', 'изтегляне без id'],
  ['files/zzz', 'не е hex'],
  ['files/a1b2c3/access/extra', 'излишен сегмент'],
  ['admin/api/files', 'административен път'],
];
for (const [tail, why] of PUBLIC_OK) assert.match(tail, PUBLIC_TAIL, `публичният вход трябва да пуска ${why}: ${tail}`);
for (const [tail, why] of PUBLIC_NO) assert.doesNotMatch(tail, PUBLIC_TAIL, `публичният вход НЕ бива да пуска ${why}: ${tail}`);

// ── 8. Рекламираните публични пътища съществуват и на порта на Home Assistant ──
// Панелът пише адреси по `links.js` (`/api/v1/p/<slug>`, `/p/<id>`, `/portal.css`). Ако
// интеграцията не сервира СЪЩИТЕ пътища, адресите изглеждат правилни и отговарят
// `404: Not found` — точно това се случи на живо.
const linksSrc = fs.readFileSync(path.join(__dirname, '../hapi_enterprise/links.js'), 'utf8');
const initSrc = read('__init__.py');
const advertised = [];
for (const [pattern, why] of [
  [/return '(\/api\/v1\/p\/)'/, 'API-то на портала'],
  [/return '(\/p\/)'/, 'страницата зад QR кода'],
]) {
  const found = pattern.exec(linksSrc);
  assert.ok(found, 'links.js строи ' + why);
  const prefix = found[1];
  assert.ok(initSrc.includes('url = "' + prefix + '{tail:.*}"'), 'интеграцията сервира ' + why + ' на ' + prefix);
  advertised.push(prefix);
}
assert.match(initSrc, /_ASSETS = \("portal\.css", "portal\.js", "portal-i18n\.js"\)/, 'интеграцията сервира ресурсите на страницата от корена');
for (const name of ['PublicPortalAPI()', 'PublicPortalPage()', 'PublicPortalAsset(_asset)']) {
  assert.ok(initSrc.includes('register_view(' + name), 'изгледът е регистриран: ' + name);
}

const summary =
  `${pyFiles.length} Python файла` +
  (compiled ? ` (${compiled} компилират се)` : ' (без компилация — няма python)') +
  ` · ${[...imported.values()].reduce((n, s) => n + s.size, 0)} имена от const.py` +
  ` · платформи: ${platforms.join(', ')}` +
  ` · ${keys.length} превода в 3 файла` +
  ` · ${reasons.size} причини с текст` +
  ` · мостът пуска ${ALLOWED_OK.length} и спира ${ALLOWED_NO.length} пътя` +
  ` · публичният вход пуска ${PUBLIC_OK.length} и спира ${PUBLIC_NO.length}` +
  ` · ${advertised.length} рекламирани пътя имат изглед на порта на HA`;
console.log('PASS ha-integration-python: ' + summary);
