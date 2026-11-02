'use strict';
// ОБХОД НА СКРИПТОВИТЕ ФАЙЛОВЕ — търси фалшиви функции, мъртъв код, счупена логика и
// лоши практики в ЦЕЛИЯ издаван код, а не само в това, което някой е сетил да провери.
//
// Защо отделен инструмент: `bad-code-scan` гледа сигурността, `logic-audit` — покритието на
// тестове, `no-stubs` — празните тела. Никой от тях не отговаря на въпроса „има ли функция,
// която никой не вика; има ли async, който никой не изчаква; има ли експорт без клиент“.
//
// Правилата са калибрирани срещу ТОЗИ код: внеденият `qrcode.js` е изключен, генеричните
// имена на фабрики не се броят за дубликати, а тестовете се броят за клиент на експортите.
// Изходът е отчет за четене: `reports/SCRIPT-AUDIT.md` + `.json`. Кодът на изхода не е гейт.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'release', 'img', 'docs']);
const PRODUCT = ['hapi_enterprise', 'scripts', 'custom_components'];
const ENTRIES = /(?:^|\/)(?:server|start|standalone)\.js$|^scripts\//;

function walkFiles(base, exts, out = []) {
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) { walkFiles(full, exts, out); continue }
    if (exts.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const files = [];
for (const dir of PRODUCT) {
  const base = path.join(ROOT, dir);
  if (fs.existsSync(base)) walkFiles(base, ['.js', '.cjs', '.py'], files);
}
files.sort();

const contents = new Map();
let totalLines = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const raw = fs.readFileSync(file, 'utf8');
  contents.set(rel, raw);
  totalLines += raw.split(/\r?\n/).length;
}

// Текстът на тестовете: законен клиент на експортите.
let testsText = '';
{
  const dir = path.join(ROOT, 'tests');
  if (fs.existsSync(dir)) testsText = walkFiles(dir, ['.js', '.cjs', '.py', '.ps1']).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

const findings = [];
const add = (rule, sev, why, file, line, text) => findings.push({
  rule, sev, why, file, line, text: String(text || '').trim().slice(0, 160),
});

// ── Правила по един ред ────────────────────────────────────────────────────
const RULES = [
  {
    id: 'dead-branch', sev: 'high',
    re: /\bif\s*\(\s*(?:false|0)\s*\)|\|\|\s*true\s*[),;]|&&\s*false\s*[),;]/,
    why: 'клон, който никога не се изпълнява (или винаги) — кодът изглежда, че прави нещо, а не го прави',
  },
  {
    id: 'unreachable-statement', sev: 'high',
    re: /^\s*(?:return|throw)\b[^;{}]*;\s*(?:return|throw)\b[^;{}]*;?\s*$/,
    why: 'два изхода на един ред — вторият е недостижим',
  },
  {
    id: 'same-ternary', sev: 'medium',
    re: /\?\s*([A-Za-z_$][\w$.]*)\s*:\s*\1\s*(?:[),;}]|$)/,
    why: 'двата клона на тернарен оператор са еднакви — условието не влияе',
  },
  {
    id: 'async-foreach', sev: 'high',
    re: /\.forEach\(\s*async\b/,
    why: 'async във forEach не се изчаква — грешките изчезват, а редът на записа се губи',
  },
  {
    id: 'promise-async-executor', sev: 'high',
    re: /new\s+Promise\(\s*async\b/,
    why: 'async изпълнител на Promise поглъща изключенията — не се хващат от .catch',
  },
  {
    id: 'swallow-promise', sev: 'low',
    re: /\.catch\(\s*\(\s*\)\s*=>\s*(?:\{\s*\}|null|undefined|false|0)\s*\)/,
    why: 'обещание, чиято грешка се хвърля на пода — при отказ никой не разбира',
  },
  {
    id: 'loose-eq', sev: 'medium',
    re: /(?<![=!<>+\-*/%&|^])(?:==|!=)(?!=)(?![)\]])/,
    why: 'нестрого сравнение — „1“ == 1 е истина и точно това крие грешки',
    only: /\.(?:js|cjs)$/,
    skip: /==\s*null|!=\s*null|^\s*if\s+\[|^\s*re:/,
    skipFile: /qrcode\.js$|script-audit\.cjs$/, // внеден генератор + самият инструмент
  },
  {
    id: 'constant-return', sev: 'medium',
    re: /function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{\s*return\s+(?:null|true|false|undefined|\[\]|\{\})\s*;?\s*\}/,
    why: 'функция, която винаги връща едно и също — изглежда като реализация, а е заготовка',
  },
  {
    id: 'product-console', sev: 'low',
    re: /^\s*console\.(?:log|debug|info)\(/,
    why: 'изход през console вместо logger — не влиза в одита и не се филтрира',
    only: /^hapi_enterprise\//,
    skipFile: /(?:standalone|start)\.js$|\/(?:ui|portal|evidence-portal|generator)\//,
  },
  {
    id: 'sync-fs-in-request', sev: 'low',
    re: /\b(?:writeFileSync|readFileSync|mkdirSync|unlinkSync|statSync|readdirSync)\(/,
    why: 'синхронен достъп до диска в процес, който обслужва заявки — блокира ВСИЧКИ клиенти',
    only: /^hapi_enterprise\/(?:server|portal-folder|gateway-api|public-gateway|notify|send|api-registry)\.js$/,
    skip: /\breadFileSync\(path\.join\(__dirname|\brequire\(/,
  },
  {
    id: 'exit-in-library', sev: 'high',
    re: /\bprocess\.exit\(/,
    why: 'process.exit в библиотечен модул убива целия процес заради един клиент',
    only: /^hapi_enterprise\//,
    skipFile: ENTRIES,
    skip: /exit\s*=\s*\(\s*code\s*\)|require\.main === module/,
  },
  {
    id: 'foreign-absolute-path', sev: 'medium',
    re: /['"`](?:[A-Za-z]:\\\\|\/home\/(?!assistant)|\/root\/|\/Users\/)/,
    why: 'абсолютен път от чужда машина — на Home Assistant такъв път няма',
  },
  {
    id: 'secret-literal', sev: 'high',
    re: /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]([^'"]{8,})['"]\s*[,;})\]]/i,
    why: 'тайна, записана в кода — влиза в изданието и в git историята',
    skip: /process\.env|\brequire\(|encodeURIComponent/,
    check: (m) => !/^[A-Z0-9_]+$/.test(m[1]) && !/(?:changeme|change|placeholder|example|secret|smoke|test|dummy|fake)/i.test(m[1]),
  },
  {
    id: 'todo-marker', sev: 'low',
    re: /(?:\/\/|#)\s*(?:TODO|FIXME|XXX|HACK)\b/,
    why: 'обещание, оставено в кода — или се прави, или се маха',
    skipFile: /script-audit|bad-code-scan|verify-release/,
  },
];

for (const [rel, raw] of contents) {
  const lines = raw.split(/\r?\n/);
  for (const rule of RULES) {
    if (rule.only && !rule.only.test(rel)) continue;
    if (rule.skipFile && rule.skipFile.test(rel)) continue;
    lines.forEach((rawLine, i) => {
      const bare = rawLine.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
      if (!bare.trim()) return; // коментар не е нарушение
      if (rule.skip && rule.skip.test(bare)) return;
      const m = rule.re.exec(bare);
      if (!m) return;
      if (rule.check && !rule.check(m)) return;
      add(rule.id, rule.sev, rule.why, rel, i + 1, rawLine);
    });
  }
}

// ── Function, която никой не вика ─────────────────────────────────────────
// Търсят се само функции на горно ниво (без отстъп) и името им трябва да се среща само на
// мястото на дефиницията. `$` се брои отделно — не е „словесен“ знак за \b.
const declared = [];
for (const [rel, raw] of contents) {
  raw.split(/\r?\n/).forEach((line, i) => {
    const fn = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line)
      || /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/.exec(line);
    if (fn) declared.push({ rel, line: i + 1, name: fn[1] });
  });
}
const usage = [...contents.values()].join('\n') + '\n' + testsText;
const countName = (name) => {
  const escaped = name.replace(/\$/g, '\\$');
  return (usage.match(new RegExp('(?<![\\w$])' + escaped + '(?![\\w$])', 'g')) || []).length;
};
for (const fn of declared) {
  if (countName(fn.name) <= 1) {
    add('unused-function', 'medium', 'функция, която никой не вика (нито код, нито тест)', fn.rel, fn.line, `${fn.name}()`);
  }
}

// ── Async функция, извикана без await (само в собствения ѝ файл) ──────────
// Само сървърни модули: в браузърните приложения `refresh()` без await е нормална практика.
for (const [rel, raw] of contents) {
  if (!/^hapi_enterprise\//.test(rel) || !/\.(?:js|cjs)$/.test(rel)) continue;
  if (/\/(?:ui|portal|generator|evidence-portal)\//.test(rel)) continue;
  const names = new Set();
  for (const m of raw.matchAll(/^(?:async\s+function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*[({])/gm)) {
    names.add(m[1] || m[2]);
  }
  if (!names.size) continue;
  raw.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.replace(/\/\/.*$/, '');
    if (!line.trim() || /^\s*async\s/.test(line)) return; // коментар или дефиниция
    for (const name of names) {
      const re = new RegExp('(?<![\\w$.])' + name.replace(/\$/g, '\\$') + '\\s*\\(', 'g');
      let m;
      while ((m = re.exec(line)) !== null) {
        const before = line.slice(0, m.index);
        if (/(?:await|return|void|yield)\s+$/.test(before)) continue;
        if (/\.(?:then|catch|finally)\(\s*$/.test(before)) continue;
        if (/Promise\.(?:all|allSettled|race|any)\(/.test(before)) continue;
        if (/(?:async\s+)?function\s+$/.test(before)) continue;
        if (/^\s*(?:const|let|var|module\.exports)\s+/.test(line)) continue;
        // `start().catch(...)` на същия ред Е обработено обещание, не плаващо.
        if (/^\s*[)\]}]?\s*\.(?:then|catch|finally)\(/.test(line.slice(m.index + name.length + 1).replace(/^\([^)]*\)/, ''))) continue;
        add('floating-async', 'high', 'async функция се вика без await/.then — грешката ѝ не се вижда, а редът на записа не е гарантиран', rel, i + 1, rawLine);
      }
    }
  });
}

// ── Експорти, които нито код, нито тест внася ─────────────────────────────
// Ниско: името се ползва вътре в модула, но е изнесено навън без клиент — разширява
// публичния договор, който трябва да остане стабилен. Не е грешка, затова е „ниско“.
for (const [rel, raw] of contents) {
  if (!/^hapi_enterprise\//.test(rel) || !/\.(?:js|cjs)$/.test(rel)) continue;
  const exported = new Set();
  for (const m of raw.matchAll(/module\.exports\s*=\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) exported.add(name);
    }
  }
  for (const m of raw.matchAll(/module\.exports\.([A-Za-z_$][\w$]*)\s*=/g)) exported.add(m[1]);
  const others = [...contents.entries()].filter(([r]) => r !== rel).map(([, t]) => t).join('\n') + '\n' + testsText;
  for (const name of exported) {
    if (!new RegExp('(?<![\\w$])' + name.replace(/\$/g, '\\$') + '(?![\\w$])').test(others)) {
      add('unused-export', 'low', 'експорт без външен клиент (ползва се само в модула) — разширява публичния договор', rel, 1, name);
    }
  }
}

// ── Отчет: таблица за ВСЕКИ файл, не само за намерените ───────────────────
// Таблицата покрива 100% от файловете: този, за когото няма нито един сигнал, също е ред —
// иначе отчетът мълчи за половината код и „обходено“ не може да се провери.
const bySeverity = { high: 0, medium: 0, low: 0 };
for (const f of findings) bySeverity[f.sev] += 1;
const order = { high: 0, medium: 1, low: 2 };
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.file.localeCompare(b.file) || a.line - b.line);

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
const byRule = {};
for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;

// Кой файл се споменава от тест: показва дали модулът е упражняван, а не само компилиран.
const testFiles = (() => {
  const dir = path.join(ROOT, 'tests');
  if (!fs.existsSync(dir)) return new Map();
  const map = new Map();
  for (const f of walkFiles(dir, ['.cjs', '.js'])) map.set(f, fs.readFileSync(f, 'utf8'));
  return map;
})();
function testsFor(rel) {
  const base = path.basename(rel);
  const stem = base.replace(/\.(?:js|cjs|py)$/, '');
  let n = 0;
  for (const [, text] of testFiles) {
    if (text.includes(base) || new RegExp('(?<![\\w$])' + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w$])').test(text)) n += 1;
  }
  return n;
}

const segmentOf = (rel) => {
  if (/^hapi_enterprise\/routes\//.test(rel)) return 'routes';
  if (/^hapi_enterprise\/ui\//.test(rel)) return 'ui';
  if (/^hapi_enterprise\/portal\//.test(rel)) return 'portal';
  if (/^hapi_enterprise\/generator\//.test(rel)) return 'generator';
  if (/^hapi_enterprise\/evidence-portal\//.test(rel)) return 'evidence-portal';
  if (/^hapi_enterprise\/plugins\//.test(rel)) return 'plugins';
  if (/^hapi_enterprise\//.test(rel)) return 'ядро';
  if (/^scripts\//.test(rel)) return 'скриптове';
  return 'интеграция';
};

const verdictOf = (list) => {
  if (list.some((f) => f.sev === 'high')) return 'висок';
  if (list.some((f) => f.sev === 'medium')) return 'среден';
  if (list.length) return 'нисък';
  return 'чисто';
};

const segments = new Map();
for (const [rel, raw] of contents) {
  const seg = segmentOf(rel);
  if (!segments.has(seg)) segments.set(seg, { files: 0, lines: 0, findings: 0 });
  const row = segments.get(seg);
  row.files += 1;
  row.lines += raw.split(/\r?\n/).length;
  row.findings += (byFile.get(rel) || []).length;
}

const md = [];
md.push('# ОБХОД НА СКРИПТОВИТЕ ФАЙЛОВЕ — ПЪЛНА ТАБЛИЦА', '');
md.push('Генериран от `node scripts/script-audit.cjs`. Редът е за ВСЕКИ файл, включително когато');
md.push('сигналите са нула: така „обходено“ може да се провери, вместо да се вярва.', '');
md.push(`Обходени: **${files.length} файла · ${totalLines} реда**.`);
md.push(`Намерени: **${findings.length}** сигнала — високи **${bySeverity.high}** · средни ${bySeverity.medium} · ниски ${bySeverity.low}.`, '');
md.push('По правило: ' + Object.entries(byRule).map(([r, n]) => `\`${r}\` ${n}`).join(' · '), '');
md.push('## По сегмент', '');
md.push('| сегмент | файлове | редове | сигнали |');
md.push('| --- | ---: | ---: | ---: |');
for (const [seg, row] of [...segments.entries()].sort((a, b) => b[1].lines - a[1].lines)) {
  md.push(`| ${seg} | ${row.files} | ${row.lines} | ${row.findings} |`);
}
md.push('', '## По файл', '');
md.push('`тестове` = в колко тестови файла се споменава модулът (0 значи, че никой тест не го пипа).', '');
md.push('| файл | редове | тестове | сигнали | присъда |');
md.push('| --- | ---: | ---: | --- | --- |');
for (const [rel, raw] of [...contents.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const list = byFile.get(rel) || [];
  const lines = raw.split(/\r?\n/).length;
  const rules = Object.entries(list.reduce((acc, f) => { acc[f.rule] = (acc[f.rule] || 0) + 1; return acc }, {}))
    .map(([r, n]) => `${r}×${n}`).join(', ');
  md.push(`| \`${rel}\` | ${lines} | ${testsFor(rel)} | ${rules || '—'} | ${verdictOf(list)} |`);
}
md.push('', '## Сигнали по файл', '');
for (const [file, list] of [...byFile.entries()].sort((a, b) => order[a[1][0].sev] - order[b[1][0].sev] || b[1].length - a[1].length)) {
  md.push(`### ${file} — ${list.length}`, '');
  for (const f of list) md.push(`- **${f.sev}** · \`${f.rule}\` · ред ${f.line}: ${f.why}`, `  \`${f.text}\``);
  md.push('');
}
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
const filesDetail = [...contents.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([rel, raw]) => {
  const list = byFile.get(rel) || [];
  return { file: rel, segment: segmentOf(rel), lines: raw.split(/\r?\n/).length, tests: testsFor(rel), findings: list.length, rules: list.reduce((acc, f) => { acc[f.rule] = (acc[f.rule] || 0) + 1; return acc }, {}) };
});
fs.writeFileSync(path.join(ROOT, 'reports', 'SCRIPT-AUDIT.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(ROOT, 'reports', 'SCRIPT-AUDIT.json'), JSON.stringify({
  generatedAt: new Date().toISOString(), files: files.length, lines: totalLines, bySeverity, byRule,
  segments: Object.fromEntries(segments), filesDetail, findings,
}, null, 2) + '\n');

console.log(`обходени ${files.length} файла · ${totalLines} реда`);
console.log(`намерени: ${findings.length} (високи ${bySeverity.high} · средни ${bySeverity.medium} · ниски ${bySeverity.low})`);
console.log('по правило: ' + Object.entries(byRule).map(([r, n]) => `${r}=${n}`).join(' '));
console.log('отчет: reports/SCRIPT-AUDIT.md');
