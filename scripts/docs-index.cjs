'use strict';
// ПЪЛНО СЪДЪРЖАНИЕ НА `documentation/` — ГЕНЕРИРАНО ОТ ДИСКА.
//
// Защо: индексът в `documentation/README.md` беше „подбрани акценти“, тоест 36 документа
// (всички ADR-та, миграционните регистри, трите ръководства за потребителя) нямаха нито една
// входяща препратка — Reachable само ако човек знае името им. Документ, който не се намира, е
// същият проблем като липсващ документ.
//
// Затова списъкът се строи от диска и се слага между два маркера в README-то. Ръчна редакция
// се губи при следващото пускане — съзнателно, както при `source-inventory.cjs` и
// `audit-events.cjs`: така списъкът не може да изостане от дървото.
//
// Употреба:
//   node scripts/docs-index.cjs               # записва блока в documentation/README.md
//   node scripts/docs-index.cjs --check       # само проверява (код 1 при разлика)
//   node scripts/docs-index.cjs --out=ПЪТ     # записва другаде (за тестове)
//   node scripts/docs-index.cjs --file=ПЪТ    # друг README (за тестове)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'documentation');
const README = path.join(DOCS, 'README.md');
const BEGIN = '<!-- doc-index:begin -->';
const END = '<!-- doc-index:end -->';
const SKIP = new Set(['README.md']);

const ARGS = process.argv.slice(2);
const argValue = (name) => {
  const hit = ARGS.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const CHECK = ARGS.includes('--check');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else if (entry.name.endsWith('.md')) out.push(abs);
  }
  return out;
}

/** Заглавието идва от самия документ: първият ред `# …`. Друго би било измислено описание. */
function titleOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const line = text.split(/\r?\n/).find((l) => /^#\s+\S/.test(l));
  return line ? line.replace(/^#\s+/, '').trim() : '_(без заглавие)_';
}

function generate() {
  const files = walk(DOCS)
    .map((abs) => path.relative(DOCS, abs).replace(/\\/g, '/'))
    .filter((rel) => !SKIP.has(rel) && rel !== '')
    .sort((a, b) => a.localeCompare(b, 'bg'));
  const rows = files.map((rel) => {
    const title = titleOf(path.join(DOCS, rel));
    return `| \`${rel}\` | ${title} |`;
  });
  return [
    BEGIN,
    `_Генериран списък: **${files.length}** документа. Пише се от \`node scripts/docs-index.cjs\`,`,
    'проверява се от `tests/docs-index.cjs`. Ръчна редакция се губи при следващото генериране._',
    '',
    '| Документ | Заглавие (първи ред от самия файл) |',
    '| -------- | --------------------------------- |',
    ...rows,
    END,
  ].join('\n');
}

function replaceBlock(text, block) {
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from === -1 || to === -1 || to < from) {
    throw new Error('В README липсват маркерите ' + BEGIN + ' / ' + END);
  }
  return text.slice(0, from) + block + text.slice(to + END.length);
}

try {
  const target = argValue('file') || README;
  const current = fs.readFileSync(target, 'utf8');
  const next = replaceBlock(current, generate());
  if (CHECK) {
    if (current !== next) {
      console.error('docs-index: списъкът е остарял — пусни `node scripts/docs-index.cjs`');
      process.exit(1);
    }
    const count = (generate().match(/^\| `/gm) || []).length;
    console.log('docs-index: актуален (' + count + ' документа, всички достъпни от индекса)');
  } else {
    const out = argValue('out') || target;
    fs.writeFileSync(out, next);
    const count = (generate().match(/^\| `/gm) || []).length;
    console.log('docs-index: записан ' + out.replace(ROOT + path.sep, '') + ' (' + count + ' документа)');
  }
} catch (e) {
  console.error('docs-index: ' + e.message);
  process.exit(1);
}
