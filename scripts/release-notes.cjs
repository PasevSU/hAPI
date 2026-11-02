'use strict';
// 0.69.98 — Бележките на изданието се ВЗИМАТ от CHANGELOG-а, а не се пишат на ръка.
//
// Защо: тагването създаваше release с ПРАЗНО тяло. Всеки път бележките се слагаха после на ръка
// (`gh release edit --notes-file`), тоест едно забравено копиране оставяше изданието без обяснение
// какво съдържа — точно това се случи с v0.69.95 и v0.69.96 (тяло с дължина 0).
//
// Употреба:
//   node scripts/release-notes.cjs                     # версия от config.yaml → dist/RELEASE-NOTES.md
//   node scripts/release-notes.cjs --version 0.69.98 --out notes.md
//   node scripts/release-notes.cjs --check             # само проверява, нищо не пише (за CI/гейт)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const CHANGELOG = path.join(root, 'CHANGELOG.md');

/** Текущата версия: един източник на истина е `hapi_enterprise/config.yaml`. */
function currentVersion() {
  const text = fs.readFileSync(path.join(root, 'hapi_enterprise', 'config.yaml'), 'utf8');
  const match = /^version:\s*"([^"]+)"/m.exec(text);
  if (!match) throw new Error('липсва version в hapi_enterprise/config.yaml');
  return match[1];
}

/**
 * Издърпва секцията `## <version>` от CHANGELOG-а — до следващия `## `, без да го включва.
 * Връща `{ found, body }`, за да може викащият да реши дали липсата е грешка.
 */
function extract(changelogText, version) {
  const lines = changelogText.split('\n');
  const start = lines.findIndex((line) => line.trim() === '## ' + version);
  if (start < 0) return { found: false, body: '' };
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return { found: true, body };
}

/** Бележките, както ги очаква GitHub: секцията за версията + ред за проверките. */
function buildNotes(changelogText, version) {
  const { found, body } = extract(changelogText, version);
  if (!found) return { ok: false, reason: 'в CHANGELOG.md няма секция „## ' + version + '“' };
  if (!body) return { ok: false, reason: 'секцията „## ' + version + '“ е празна' };
  return { ok: true, notes: body + '\n' };
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : '';
  };
  const version = arg('version') || currentVersion();
  const out = arg('out') || path.join(root, 'dist', 'RELEASE-NOTES.md');
  const checkOnly = argv.includes('--check');

  const changelog = fs.readFileSync(CHANGELOG, 'utf8');
  const result = buildNotes(changelog, version);
  if (!result.ok) {
    console.error('release-notes: ' + result.reason);
    return 1;
  }
  if (checkOnly) {
    console.log('release-notes: OK — секцията за ' + version + ' съществува (' + result.notes.length + ' знака)');
    return 0;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, result.notes);
  console.log('release-notes: записан ' + path.relative(root, out) + ' за ' + version + ' (' + result.notes.length + ' знака)');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { currentVersion, extract, buildNotes };
