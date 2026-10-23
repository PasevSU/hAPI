'use strict';
// Одит на всички издания: какво е имало и вече го няма.
//
// Защо: „липсват цели компоненти и функции“ се проверява само с факли. Този скрипт
// сравнява ВСЕКИ таг с текущото дърво по четири неща, които не бива да изчезват тихо:
//   1. файлове (модули, UI панели, компоненти на HTTP слоя);
//   2. функции по модул (`function name(` / `const name = (`);
//   3. секции в навигацията на панела (`{ id: 'x'` в `ui/app.js`);
//   4. опции на add-on-а (`options:` в `config.yaml`).
//
// Изход: таблица в конзолата + `reports/RELEASE-AUDIT.md` (файлът е за хора, не гейт).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

const tags = git(['tag', '--sort=creatordate']).split('\n').filter(Boolean);
const head = git(['rev-parse', '--short', 'HEAD']);

/** Файловете на даден таг под двата корена, за които следим. */
function filesOf(ref) {
  const out = git(['ls-tree', '-r', '--name-only', ref]);
  return new Set(
    out
      .split('\n')
      .filter((f) => /^(hapi_enterprise|custom_components)\//.test(f))
      .filter((f) => /\.(js|cjs|mjs|py|html|css|yaml|json)$/.test(f) || /\/Dockerfile$/.test(f))
  );
}

/** Имената на функциите в един файл (само дефиниции, не извиквания). */
function functionsOf(source) {
  const names = new Set();
  for (const m of source.matchAll(/^(?: {0,4})?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1]);
  for (const m of source.matchAll(/^(?: {0,4})?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/gm)) names.add(m[1]);
  return names;
}

const uiSections = (src) => new Set([...src.matchAll(/\{\s*id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]));
const optionNames = (yaml) => {
  const block = (/options:([\s\S]*?)\nschema:/.exec(yaml) || ['', ''])[1];
  return new Set([...block.matchAll(/^ {2}([a-z0-9_]+):/gm)].map((m) => m[1]));
};

function snapshot(ref) {
  const files = filesOf(ref);
  const fns = new Map(); // file → Set(names)
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    let src;
    try {
      src = git(['show', `${ref}:${file}`]);
    } catch {
      continue;
    }
    fns.set(file, functionsOf(src));
  }
  let sections = new Set();
  let options = new Set();
  try {
    sections = uiSections(git(['show', `${ref}:hapi_enterprise/ui/app.js`]));
  } catch {
    /* няма панел в този таг */
  }
  try {
    options = optionNames(git(['show', `${ref}:hapi_enterprise/config.yaml`]));
  } catch {
    /* няма add-on в този таг */
  }
  return { files, fns, sections, options };
}

const now = snapshot('HEAD');
const rows = [];
const missingFiles = new Map(); // file → първият таг, в който го е имало
const missingFns = new Map(); // file:fn → последен таг
const missingSections = new Set();
const missingOptions = new Set();

for (const tag of tags) {
  const snap = snapshot(tag);
  for (const file of snap.files) if (!now.files.has(file)) missingFiles.set(file, missingFiles.get(file) || tag);
  for (const [file, fns] of snap.fns) {
    const current = now.fns.get(file);
    if (!current) continue; // файлът е изчезнал — отчита се горе
    for (const fn of fns) if (!current.has(fn)) missingFns.set(file + ':' + fn, tag);
  }
  for (const s of snap.sections) if (!now.sections.has(s)) missingSections.add(s);
  for (const o of snap.options) if (!now.options.has(o)) missingOptions.add(o);
  rows.push({ tag, files: snap.files.size, fns: [...snap.fns.values()].reduce((n, s) => n + s.size, 0), sections: snap.sections.size, options: snap.options.size });
}

// ── Отчет ───────────────────────────────────────────────────────────────────
const nowFns = [...now.fns.values()].reduce((n, s) => n + s.size, 0);
const lines = [];
lines.push('# Одит на изданията — какво е имало и го няма');
lines.push('');
lines.push(`Сравнение на всички тагове (${tags.length}) с \`HEAD\` (${head}).`);
lines.push('');
lines.push('| Таг | файлове | функции | секции в панела | опции |');
lines.push('| --- | --- | --- | --- | --- |');
for (const r of rows.slice(-12)) lines.push(`| ${r.tag} | ${r.files} | ${r.fns} | ${r.sections} | ${r.options} |`);
lines.push(`| **HEAD** | **${now.files.size}** | **${nowFns}** | **${now.sections.size}** | **${now.options.size}** |`);
lines.push('');
lines.push('## Изчезнали файлове');
lines.push(missingFiles.size ? [...missingFiles].map(([f, t]) => `- \`${f}\` (имаше го в ${t})`).join('\n') : '- няма');
lines.push('');
lines.push('## Изчезнали функции (файлът съществува, функцията — не)');
lines.push(missingFns.size ? [...missingFns].map(([f, t]) => `- \`${f}\` (имаше я в ${t})`).join('\n') : '- няма');
lines.push('');
lines.push('## Изчезнали секции в панела');
lines.push(missingSections.size ? [...missingSections].map((s) => '- `' + s + '`').join('\n') : '- няма');
lines.push('');
lines.push('## Изчезнали опции на add-on-а');
lines.push(missingOptions.size ? [...missingOptions].map((s) => '- `' + s + '`').join('\n') : '- няма');
lines.push('');

// ── Б. Спецификация срещу код ────────────────────────────────────────────────
// Кодът сам казва какво още не е направено (`status: 'planned'`). Това се чете от
// източниците, за да не се поддържа втори списък на ръка.
function plannedExportCapabilities() {
  const src = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'export-rules.js'), 'utf8');
  const block = (/const CAPABILITIES = \[([\s\S]*?)\n {2}\];/.exec(src) || ['', ''])[1];
  // Готовите се обявяват в `READY` — иначе отчетът би твърдял „планирано“ за нещо, което
  // работи. Точно тази разлика беше поправена в 0.69.51 (компресия).
  const readyBlock = (/const READY = \{([\s\S]*?)\n {2}\};/.exec(src) || ['', ''])[1];
  const ready = new Set([...readyBlock.matchAll(/([a-z_]+):\s*\{\s*implemented:\s*true/g)].map((m) => m[1]));
  return [...block.matchAll(/\{\s*id:\s*'([a-z_]+)',\s*label:\s*'([^']+)'/g)]
    .map((m) => ({ id: m[1], label: m[2] }))
    .filter((c) => !ready.has(c.id));
}

function plannedReportObjects() {
  const src = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'ui', 'report-objects.js'), 'utf8');
  return [...src.matchAll(/\{\s*type:\s*'([a-z_]+)',[^}]*label:\s*'([^']+)'[^}]*status:\s*'planned'/g)].map((m) => ({ type: m[1], label: m[2] }));
}

// Документирани в `documentation/`, но нереализирани. Проверява се, че ги няма в кода.
const DOCUMENTED_GAPS = [
  // Проверката гледа КОД, не етикети: `export-rules.js` има цел „SMB / NAS“, но това е
  // име на местоназначение, не адаптер. Затова се търси реалният клиент.
  { id: 'FD-7', what: 'адаптер за мрежово (SMB) хранилище', code: 'smbclient|smbmount|cifs' },
  { id: 'FD-8', what: 'адаптер за USB хранилище', code: 'usbStorage|usb-storage' },
  { id: 'FD-9', what: '„Save Template“ в Document Generator', code: 'saveTemplate' },
  { id: 'RS-06', what: 'валидация на PDF/A-3 с veraPDF', code: 'verapdf' },
  { id: 'W8/F9', what: 'Windows Edition и опаковане', code: 'windows-edition|Windows Edition' },
];

const allSource = (() => {
  // Коментарите се махат: „само валидатор като veraPDF“ е ОПИСАНИЕ на липсата, не
  // реализация. Затова проверката гледа само код.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.(js|cjs|mjs|py|yaml|json)$/.test(entry.name)) out.push(stripComments(fs.readFileSync(full, 'utf8')));
    }
  };
  walk(path.join(ROOT, 'hapi_enterprise'));
  walk(path.join(ROOT, 'custom_components'));
  return out.join('\n');
})();
const stillMissing = DOCUMENTED_GAPS.filter((g) => !new RegExp(g.code, 'i').test(allSource));

lines.push('## Б. Спецификация срещу код — какво е обещано и го няма');
lines.push('');
lines.push('### Б.1 Експортни способности (`export-rules.js`) — обявени за „планирано“');
lines.push('');
const caps = plannedExportCapabilities();
lines.push(caps.length ? '| id | Какво липсва |\n| --- | --- |\n' + caps.map((c) => `| \`${c.id}\` | ${c.label} |`).join('\n') : '- няма (всички са реализирани)');
lines.push('');
lines.push('### Б.2 Report Studio (`ui/report-objects.js`) — изключени типове');
lines.push('');
const objs = plannedReportObjects();
lines.push(objs.length ? '| тип | Обект |\n| --- | --- |\n' + objs.map((o) => `| \`${o.type}\` | ${o.label} |`).join('\n') : '- няма');
lines.push('');
lines.push('### Б.3 Документирани, но нереализирани функции');
lines.push('');
lines.push(stillMissing.length ? '| Идентификатор | Какво е |\n| --- | --- |\n' + stillMissing.map((g) => `| ${g.id} | ${g.what} |`).join('\n') : '- няма (всички са намерени в кода)');
lines.push('');
lines.push('### Б.4 Проверено и НЕ е липса');
lines.push('');
lines.push('| Изчезнало | Защо не е проблем |');
lines.push('| --- | --- |');
lines.push('| `custom_components/portal_enterprise/*` | преименувано на `hapi_enterprise`; същите файлове съществуват под новото име |');
lines.push('| `admin.js`, `admin.html` | старият панел, премахнат съзнателно в 0.69.8; заместен от `ui/` |');
lines.push('| `server.js:loginGate` | входът с парола не съществува; ограничението на опитите е по самоличност (`adminGate`) |');
lines.push('| `server.js:withSecretLock` | изнесено в `secret-lock.js` (0.69.43), с тест |');
lines.push('| `shared-data.js:merge/mergeLists/equal/giveUp` | заменени от `reconcile()` + `clone()`, покрити от 6 теста |');
lines.push('| `ooxml.js:t`, `pdf-writer.js:rows`, `preview.js:rows`, `ui/app.js:statsHtml/tableHtml` | локални помощни функции, преименувани/инлайн |');
lines.push('| опция `visitor_trust_proxy` | премахната съзнателно в 0.69.27; живее в конзолата и като `TRUST_PROXY` |');
lines.push('');

fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports', 'RELEASE-AUDIT.md'), lines.join('\n') + '\n');

process.stdout.write(lines.join('\n') + '\n');
process.stdout.write(
  `\nОБОБЩЕНИЕ: файлове ${now.files.size} · функции ${nowFns} · секции ${now.sections.size} · опции ${now.options.size}\n` +
  `липсващи: файлове ${missingFiles.size} · функции ${missingFns.size} · секции ${missingSections.size} · опции ${missingOptions.size}\n` +
  'отчет: reports/RELEASE-AUDIT.md\n'
);
