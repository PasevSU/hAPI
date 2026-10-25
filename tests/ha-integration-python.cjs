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

const summary =
  `${pyFiles.length} Python файла` +
  (compiled ? ` (${compiled} компилират се)` : ' (без компилация — няма python)') +
  ` · ${[...imported.values()].reduce((n, s) => n + s.size, 0)} имена от const.py` +
  ` · платформи: ${platforms.join(', ')}` +
  ` · ${keys.length} превода в 3 файла` +
  ` · ${reasons.size} причини с текст`;
console.log('PASS ha-integration-python: ' + summary);
