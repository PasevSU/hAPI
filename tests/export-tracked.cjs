'use strict';
// Експортът за публикуване трябва да копира САМО това, което би влязло в git.
// Регресията, която пази: частни ключове и игнорирани файлове не излизат от диска.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'export-tracked-')); // играе ролята на корена на хранилището
// Дестинацията е извън обхожданото дърво, иначе експортът би я обходил.
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-tracked-out-'));

const write = (rel, body) => {
  const abs = path.join(sandbox, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
};
const list = (dir) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(dir, abs).split(path.sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
};

// Копираме скриптовете в $sandbox/scripts, за да смятат root = $sandbox.
fs.mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
for (const f of ['export-tracked.cjs', 'secret-patterns.cjs']) {
  fs.copyFileSync(path.join(__dirname, '..', 'scripts', f), path.join(sandbox, 'scripts', f));
}

write('.gitignore', 'secret-dir/\n*.log\nnode_modules/\n');
write('README.md', '# sandbox');
write('docs/notes.txt', 'обикновен текст');
write('secret-dir/private.asc', 'x');
write('noise.log', 'лог');
write('node_modules/pkg/index.js', 'module.exports = 1');

// Клонът има .git и стар файл — .git се пази, старото съдържание се маха.
fs.mkdirSync(path.join(outDir, '.git'), { recursive: true });
fs.writeFileSync(path.join(outDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.writeFileSync(path.join(outDir, 'stale.txt'), 'стар файл');

const run = () => spawnSync(process.execPath, [path.join(sandbox, 'scripts', 'export-tracked.cjs'), '--to', outDir, '--clean'], { encoding: 'utf8' });

// ── 1. Обикновен експорт: само проследяваното ────────────────────────────────
const ok = run();
assert.equal(ok.status, 0, 'експортът минава: ' + ok.stderr);
const files = list(outDir);
assert.deepEqual(
  files,
  ['.git/HEAD', '.gitignore', 'README.md', 'docs/notes.txt', 'scripts/export-tracked.cjs', 'scripts/secret-patterns.cjs'],
  'копирани са точно файловете без .gitignore-изключените: ' + files.join(', '),
);
assert.equal(fs.existsSync(path.join(outDir, 'secret-dir')), false, 'игнорираната папка с ключове не се копира');
assert.equal(fs.existsSync(path.join(outDir, 'noise.log')), false, 'игнорираният лог не се копира');
assert.equal(fs.existsSync(path.join(outDir, 'node_modules')), false, 'node_modules не се копира');
assert.equal(fs.existsSync(path.join(outDir, 'stale.txt')), false, '--clean маха старото съдържание');
assert.equal(fs.readFileSync(path.join(outDir, '.git', 'HEAD'), 'utf8').trim(), 'ref: refs/heads/main', '--clean не пипа .git');

// ── 2. Частен ключ с невинно име → отказ ────────────────────────────────────
const leaked = '-----BEGIN PGP PRIVATE KEY BLOCK-----\n\n' + 'A'.repeat(120) + '\n-----END PGP PRIVATE KEY BLOCK-----\n';
write('docs/innocent.txt', leaked);
const refused = run();
assert.equal(refused.status, 3, 'отказва експорт при намерен частен ключ');
assert.match(refused.stderr, /PGP частен ключ/, 'съобщението казва какво е намерено');
assert.equal(fs.existsSync(path.join(outDir, 'docs/innocent.txt')), false, 'нищо не се копира при отказ');

// ── 3. private.asc е забранено име дори извън игнорирана папка ───────────────
write('docs/innocent.txt', 'чисто');
write('docs/private.asc', 'x');
const byName = run();
assert.equal(byName.status, 3, 'отказва по име private.asc');
assert.match(byName.stderr, /private\.asc/, 'посочва файла');

fs.rmSync(sandbox, { recursive: true, force: true });
fs.rmSync(outDir, { recursive: true, force: true });
console.log('PASS export-tracked: спазва .gitignore, пази .git, отказва частни ключове и private.asc');
