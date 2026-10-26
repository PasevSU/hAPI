'use strict';
// `scripts/secret-patterns.cjs` е общото място за правилата за тайни: ползват го
// `pre-push-audit.cjs` (на `git push`) и `export-tracked.cjs` (при публикуване). Никой не
// проверяваше нито дали правилата хващат това, което обещават, нито дали гейтът е ИЗПЪЛНИМ.
// На 0.69.87 второто беше счупено: `npm run audit` падаше на три теста, които ползват
// официалния пример на AWS `AKIAIOSFODNN7EXAMPLE` — тоест проверката блокираше собствените си
// документационни стойности. Гейт, който не може да мине, се пренебрегва; затова тук се
// проверяват и двете посоки:
//   1. всяко правило хваща реалистична стойност от своя вид;
//   2. никое правило не хваща позната БЕЗОПАСНА стойност (примерът на AWS, JWT само с header,
//      изразът „PGP PRIVATE KEY BLOCK“ като текст — трите се срещат в кода и тестовете);
//   3. забранените имена на файлове се хващат (частен ключ, `.env`, `id_rsa`, `.pem`);
//   4. сканът на дървото не намира тайна извън документираните тестови ключове;
//   5. `pre-push-audit.cjs` завършва с код 0 — гейтът е изпълним днес, а не „някой ден“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SECRETS, blockingReason } = require('../scripts/secret-patterns.cjs');

const root = path.join(__dirname, '..');

// ── 1. Всяко правило хваща реалистична стойност ─────────────────────────────
// Пробите се СГЛОБЯВАТ, а не се пишат буквално: иначе този файл сам би изглеждал като теч и
// `pre-push-audit` (който сканира и него) щеше да пада заради теста на самите правила.
const B64 = (n) => 'A'.repeat(n);
const POSITIVE = [
  ['JWT с подпис', ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', B64(43)].join('.')],
  ['частен ключ', ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ')],
  ['PGP частен ключ', ['-----BEGIN PGP PRIVATE KEY BLOCK-----', '', B64(200), '-----END PGP PRIVATE KEY BLOCK-----'].join('\n')],
  ['Supervisor токен', ['SUPERVISOR', '_TOKEN=eyJhbGciOiJIUzI1NiJ9'].join('')],
  ['GitHub токен', ['gh', 'p_', B64(24)].join('')],
  ['AWS ключ', ['AKIA', 'Z7QW3RTY6UIOP2LK'].join('')],
];
for (const [label, sample] of POSITIVE) {
  const rule = SECRETS.find(([, name]) => name === label);
  assert.ok(rule, `правилото „${label}“ съществува`);
  assert.ok(rule[0].test(sample), `правилото „${label}“ трябва да хване своя пример`);
}

// ── 2. Никое правило не хваща позната безопасна стойност ────────────────────
const SAFE = [
  ['примерът на AWS от документацията', ['AKIA', 'IOSFODNN7EXAMPLE'].join('')],
  ['JWT само с header (тестов fixture)', ['eyJ', 'hbGciOiJIUzI1NiJ9'].join('')],
  ['изразът за PGP ключ като текст', ['логът пише BEGIN PGP', 'PRIVATE KEY BLOCK, но ключ няма'].join(' ')],
  ['обикновен токен в текста', 'ADMIN_TOKEN_REQUIRED'],
];
for (const [label, sample] of SAFE) {
  for (const [pattern, name] of SECRETS) {
    assert.equal(pattern.test(sample), false, `правилото „${name}“ не бива да хваща ${label}`);
  }
}

// ── 3. Забранените имена, и то НАВСЯКЪДЕ в дървото ─────────────────────────
// Правилото обещава „никога не се публикуват“; докато шаблоните бяха закотвени в началото на
// пътя, `config/.env`, `data/admin-token` и `keys/id_rsa` минаваха.
for (const name of ['id_rsa', '.env', '.env.local', 'config/.env', 'config/.env.local', 'admin-token', 'data/admin-token', 'keys/id_rsa', 'keys/id_rsa.pub']) {
  assert.ok(blockingReason(name, ''), `${name} трябва да е забранено име (и в подпапки)`);
}
for (const name of ['certs/server.pem', 'keys/private.key', 'pgp/private.asc', 'x/PGP_CryptoSAK_keys-1.asc']) {
  assert.ok(blockingReason(name, ''), `${name} трябва да е забранено име`);
}
assert.equal(blockingReason('hapi_enterprise/server.js', "'use strict';"), null, 'обикновен код не се блокира');

// ── 4. Няма тайна в дървото извън документираните тестови ключове ───────────
// `tests/fixtures/pgp/` съдържа ТЕСТОВИ ключове (gpg, RSA 2048, парола от README-то в папката)
// — те са частни по форма, но не са тайна. Изключението е тясно и вързано с README, за да не
// може да се превърне в общо „тестовете не се сканират“.
const FIXTURE_DIR = 'tests/fixtures/pgp/';
const fixtureReadme = path.join(root, FIXTURE_DIR, 'README.md');
assert.ok(fs.existsSync(fixtureReadme), 'тестовите ключове имат README, който обяснява, че са тестови');
assert.match(fs.readFileSync(fixtureReadme, 'utf8'), /тестов|test/i, 'README-то на фикстурите казва, че ключовете са тестови');

const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split(/\r?\n/)
  .filter(Boolean);
const leaks = [];
for (const rel of tracked) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const buffer = fs.readFileSync(full);
  if (buffer.includes(0)) continue; // двоично
  const reason = blockingReason(rel, buffer.toString('utf8'));
  if (!reason) continue;
  if (rel.startsWith(FIXTURE_DIR)) continue; // документираните тестови ключове
  leaks.push(reason);
}
assert.deepEqual(leaks, [], 'в проследените файлове не бива да има тайни извън тестовите ключове');

// ── 5. Гейтът е изпълним: одитът минава ────────────────────────────────────
let audit;
try {
  audit = { code: 0, out: execFileSync(process.execPath, [path.join(root, 'scripts', 'pre-push-audit.cjs')], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
} catch (err) {
  audit = { code: err.status ?? 1, out: `${err.stdout || ''}${err.stderr || ''}` };
}
const secretLine = audit.out.split(/\r?\n/).find((l) => l.includes('намерени тайни')) || '(няма ред „намерени тайни“)';
assert.equal(audit.code, 0, `pre-push-audit трябва да минава, иначе гейтът се пренебрегва — ${secretLine.trim()}`);
assert.match(secretLine, /намерени тайни: няма/, `одитът не бива да намира тайни — ${secretLine.trim()}`);

console.log(`secret-patterns: ${SECRETS.length} правила · ${POSITIVE.length} положителни · ${SAFE.length} безопасни · ${tracked.length} файла · одитът минава — наред`);
