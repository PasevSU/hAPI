'use strict';
// Логически одит — търси подозрителна ЛОГИКА, не синтаксис.
//
// `node --check` и ESLint хващат счупен код. Те не хващат код, който се компилира и
// дори минава тестове, но е сгрешен по смисъл: цикъл с `<=` върху `.length`,
// сортиране с булев компаратор, `catch`, който връща `true`, сравнение на милисекунди
// със секунди. Точно такива дефекти стигат до потребителя, защото „нищо не гърми“.
//
//   node scripts/logic-audit.cjs            # кратък отчет
//   node scripts/logic-audit.cjs --verbose  # с всеки ред
//   node scripts/logic-audit.cjs --json     # машинно четим
//   node scripts/logic-audit.cjs --gate     # код 1 при critical/high без обосновка
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Само дърветата, които наистина влизат в изданието. Коренът НЕ се сканира: там няма код,
// а до 0.69.19 стоеше и мъртво копие на UI-я (`ui/` от 0.54.0), което изкривяваше бройките.
const SCAN_DIRS = ['hapi_enterprise', 'custom_components', 'scripts', 'tests'];
const SKIP_FILES = new Set([
  'hapi_enterprise/qrcode.js', // генериран библиотечен код
  'scripts/logic-audit.cjs', // собствен-orchestrator
]);
const CODE_EXT = new Set(['.js', '.cjs', '.mjs', '.py', '.ps1']);

const RULES = [
  {
    id: 'off-by-one-loop',
    sev: 'critical',
    why: 'цикъл с `<=` върху `.length` минава един елемент отвъд масива (undefined)',
    fix: 'използвай `<` пред `.length`',
    re: /\bfor\s*\([^)]*<=\s*[\w.$]+\.length\b/,
    // `slice(0, i)` в тялото значи, че `i === parts.length` е смислена итерация.
    skip: /\.slice\(0,\s*i\)|\.subarray\(0,\s*i\)|substring\(0,\s*i\)/,
  },
  {
    id: 'sort-boolean',
    sev: 'critical',
    why: 'компаратор, който връща `true`/`false`, не сортира правилно — редът е произволен',
    fix: 'върни число: `a.x - b.x` или `String(a.x).localeCompare(String(b.x))`',
    re: /\.sort\s*\(\s*(?:function\s*\([^)]*\)\s*\{|\([^)]*\)\s*=>)[^;{}]*?[^=<>!][<>][^=]/,
    skip: /localeCompare|length\s*[-+]|\.sort\s*\(\s*\)|Number\(|new Date/,
  },
  {
    id: 'parseint-radix',
    sev: 'high',
    why: '`parseInt` без основа гадае: низ с водеща 0 може да се чете като осмично, а „08“ — като 0',
    fix: 'подай втората основа: `parseInt(x, 10)`',
    re: /\bparseInt\s*\(\s*[^,()]+\)/,
  },
  {
    id: 'assign-in-condition',
    sev: 'critical',
    why: 'единично `=` в условие присвоява вместо да сравнява — условието е почти винаги истина',
    fix: 'използвай `===` (или изнеси присвояването преди `if`)',
    custom: (line) => conditionAssignments(line),
  },
  {
    id: 'ternary-bool',
    sev: 'medium',
    why: '`cond ? true : false` е самият `cond`; `cond ? false : true` е отрицание — чете се трудно и крие инверсия',
    fix: 'напиши директно `cond` / `!cond`',
    re: /\?\s*(?:true\s*:\s*false|false\s*:\s*true)\b/,
  },
  {
    id: 'catch-returns-truthy',
    sev: 'high',
    why: '`catch`, който връща `true`/обект, превръща провала в успех — точно това е тихият пропуск',
    fix: 'върни `false`/хвърли отново или обясни изрично защо провалът е успех',
    re: /\bcatch\b[^{]*\{[^}]*\breturn\s+(?:true|1|ok\b|\{\s*ok\s*:\s*true)/,
  },
  {
    id: 'ms-seconds-mix',
    sev: 'critical',
    why: '`Date.now()` е в милисекунди; делене на 1000 на същия ред е класическият 1000× бъг',
    fix: 'дръж милисекунди навсякъде или преобразувай изрично и поименно',
    // Изричното преобразуване (`Math.floor(Date.now()/1000)`) е коректно и се пропуска.
    custom: (line) => {
      if (!/Date\.now\(\)\s*\/\s*1000/.test(line)) return false;
      return !/Math\.(?:floor|round|trunc|ceil)\(\s*Date\.now\(\)\s*\/\s*1000/.test(line);
    },
  },
  {
    id: 'duplicate-condition',
    sev: 'medium',
    why: 'едно и също сравнение повторено в `||`/`&&` — второто е мъртво, вероятно е сбъркан операнд',
    fix: 'провери дали второто условие не трябва да е за друго поле',
    re: /\b([\w.$]+)\s*(===|==)\s*([\w.'"$]+)\s*(?:\|\||&&)\s*\1\s*\2\s*\3\b/,
  },
  {
    id: 'impossible-range',
    sev: 'critical',
    why: 'долна граница, по-голяма от горната — условието никога не е истина',
    re: />=\s*(\d+)\s*&&\s*[\w.$]+\s*<=\s*(\d+)/,
    check: (m) => Number(m[1]) > Number(m[2]),
    whyDetail: (m) => `долна ${m[1]} > горна ${m[2]}`,
    fix: 'размени границите или провери кой операнд е сгрешен',
  },
  {
    id: 'unreachable-code',
    sev: 'high',
    why: 'код след `return`/`throw` в същия блок никога не се изпълнява — обикновено е забравена логика',
    fix: 'махни го или го премести преди изхода',
    re: /^\s*(?:return|throw)\b[^;]*;\s*$/,
    multiline: true,
  },
  {
    id: 'async-in-sync-iteration',
    sev: 'high',
    why: '`forEach`/`map` с `async` не изчаква нищо — грешките се гулят и редът не е гарантиран',
    fix: 'използвай `for … of` с `await` или `await Promise.all(arr.map(...))`',
    re: /\.(?:forEach|map|filter)\s*\(\s*async\b/,
    skip: /Promise\.all/,
  },
  {
    id: 'success-status-on-failure',
    sev: 'critical',
    why: '`fail()` с код 2xx връща „успех“ при грешка; клиентът не разбира, че е отказано',
    fix: 'използвай `json()` за 2xx и `fail()` само за 4xx/5xx',
    re: /\bfail\s*\(\s*res\s*,\s*(2\d\d)\b/,
  },
  {
    id: 'divide-by-literally-zero',
    sev: 'critical',
    why: 'делене на литерал 0 дава `Infinity`/`NaN` и се разпространява тихо',
    fix: 'провери знаменателя или задай смислена стойност при 0',
    // Само истинско деление: лявата страна е израз, а не част от низ/регекс.
    re: /[\w$.\])\]]\s*\/\s*0(?![.\dxXoObBn])(?!\s*[),;]\s*['"`])/,
    skip: /0o[0-7]|assert[.(]|expect[.(]|['"`]|\/0\s*$|\/\/|\/\*/,
  },
  {
    id: 'reversed-slice',
    sev: 'high',
    why: '`slice(a, b)` с `a > b` връща празен масив — логиката отпада без грешка',
    re: /\.slice\(\s*(\d+)\s*,\s*(-?\d+)\s*\)/,
    check: (m) => Number(m[2]) >= 0 && Number(m[1]) > Number(m[2]),
    whyDetail: (m) => `начало ${m[1]} > край ${m[2]}`,
    fix: 'размени аргументите',
  },
  {
    id: 'boolean-as-string',
    sev: 'high',
    why: 'сравнение с `"true"`/`"false"` върху булево поле винаги е неистина (или обратното)',
    fix: 'сравнявай с `true`/`false`; ако идва от заявка, преобразувай през `=== "true"` на входа',
    re: /\b(?:enabled|disabled|visible|listed|locked|secure|allow\w*|require\w*)\s*(?:===|==|!==|!=)\s*['"]true['"]/,
  },
  {
    id: 'mutate-while-iterating',
    sev: 'high',
    why: 'промяна на масива, по който се итерира, пропуска или повтаря елементи',
    fix: 'итерирай по копие (`[...arr]`) и променяй оригинала',
    re: /for\s*\(\s*const\s+(\w+)\s+of\s+([\w.$]+)\s*\)\s*\{[^}]*\2\s*\.\s*(?:push|splice|pop|shift|unshift)\s*\(/,
  },
];

function codeFiles(dir, base = dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (['node_modules', 'dist', '.git', '__pycache__', 'archive'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...codeFiles(full, base));
    else if (CODE_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function segmentOf(lines, index) {
  for (let i = index; i >= 0; i--) {
    const m = /^\s*(?:async\s+)?function\s+([\w$]+)|^\s*const\s+([\w$]+)\s*=\s*(?:async\s*)?\(|^\s*([\w$]+)\s*\([^)]*\)\s*\{\s*$/.exec(lines[i]);
    if (m) return m[1] || m[2] || m[3];
    if (/^\s*\/\/ ──/.test(lines[i])) return lines[i].trim().replace(/\s+/g, ' ').slice(0, 60);
  }
  return '(начало)';
}

function conditionOf(line, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < line.length; i++) {
    if (line[i] === '(') depth++;
    else if (line[i] === ')') {
      depth--;
      if (depth === 0) return line.slice(openIndex + 1, i);
    }
  }
  return null; // условието продължава на следващия ред — не гадаем
}

// Присвояване (`=`, `+=`, …) ВЪТРЕ в условието на `if`/`while`.
// Гледа се само съдържанието на скобите, а не целият ред — иначе всяко
// `if (x) { y = 1 }` на един ред изглежда като дефект.
// Низовете и шаблоните в условие не са код: `if (line.startsWith('='))` не е присвояване.
function stripLiterals(text) {
  return text
    .replace(/'(?:\\.|[^'\\])*'/g, 'LIT')
    .replace(/"(?:\\.|[^"\\])*"/g, 'LIT')
    .replace(/`(?:\\.|[^`\\])*`/g, 'LIT');
}

// `while ((m = re.exec(s.toString('x'))))` — двойните скоби са утвърденият начин да се
// каже „това присвояване е нарочно“. Заменяме цялата такава група с маркер.
function stripDeliberateAssignments(cond) {
  let out = '';
  let i = 0;
  while (i < cond.length) {
    if (cond[i] === '(') {
      let depth = 0;
      let end = -1;
      for (let j = i; j < cond.length; j++) {
        if (cond[j] === '(') depth++;
        else if (cond[j] === ')') {
          depth--;
          if (!depth) {
            end = j;
            break;
          }
        }
      }
      if (end > 0) {
        const inner = cond.slice(i + 1, end).trim();
        if (/^[\w$.[\]]+\s*=(?!=)/.test(inner)) {
          out += 'ASSIGN';
          i = end + 1;
          continue;
        }
      }
    }
    out += cond[i];
    i++;
  }
  return out;
}

function conditionAssignments(line) {
  const start = /\b(?:if|while)\s*\(/.exec(line);
  if (!start) return false;
  const cond = conditionOf(line, line.indexOf('(', start.index));
  if (cond == null) return false;
  const cleaned = stripDeliberateAssignments(stripLiterals(cond)).replace(/===|!==|==|!=|<=|>=|=>/g, '  ');
  return /(?:^|[^=!<>+\-*/%&|^])=[^=]/.test(cleaned);
}

function scan() {
  const findings = [];
  const files = SCAN_DIRS.flatMap((d) => codeFiles(path.join(ROOT, d)));
  let scannedLines = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (SKIP_FILES.has(rel)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    scannedLines += lines.length;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(?:\/\/|#|\*|\/\*)/.test(line)) continue; // коментарите не са код
      for (const rule of RULES) {
        if (rule.skip && rule.skip.test(line)) continue;
        const m = rule.custom ? (rule.custom(line) ? [''] : null) : rule.re.exec(line);
        if (!m) continue;
        if (rule.check && !rule.check(m)) continue;
        if (rule.multiline) {
          // `return;` сам по себе си не е находка — находка е, ако след него в същия блок има код.
          const indent = line.match(/^\s*/)[0].length;
          let next = null;
          for (let j = i + 1; j < lines.length; j++) {
            if (!lines[j].trim()) continue;
            next = lines[j];
            break;
          }
          if (!next) continue;
          const nextIndent = next.match(/^\s*/)[0].length;
          if (nextIndent < indent || /^\s*\}/.test(next)) continue;
        }
        findings.push({
          file: rel,
          line: i + 1,
          rule: rule.id,
          sev: rule.sev,
          segment: segmentOf(lines, i),
          code: line.trim().slice(0, 160),
          why: rule.whyDetail ? rule.whyDetail(m) + ' — ' + rule.why : rule.why,
          fix: rule.fix,
        });
      }
    }
  }
  return { files: files.length, scannedLines, findings };
}

function allowlist() {
  const file = path.join(__dirname, 'logic-audit-allowlist.json');
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const entry of list) {
    if (!entry.reason || entry.reason.length < 40) throw Error(`allowlist: запис без обосновка (${entry.file}:${entry.rule})`);
    if (!fs.existsSync(path.join(ROOT, entry.file))) throw Error(`allowlist: липсва файл ${entry.file}`);
  }
  return list;
}

module.exports = { scan, allowlist, RULES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  const asJson = args.includes('--json');
  const gate = args.includes('--gate');
  const save = args.includes('--save');
  const { files, scannedLines, findings } = scan();
  const allow = allowlist();
  const isAllowed = (f) => allow.some((a) => a.file === f.file && (!a.rule || a.rule === f.rule) && (!a.line || a.line === f.line));
  const accepted = findings.filter(isAllowed);
  const open = findings.filter((f) => !isAllowed(f));
  const bySev = (sev) => open.filter((f) => f.sev === sev);

  if (save) {
    const outDir = path.join(ROOT, 'reports');
    fs.mkdirSync(outDir, { recursive: true });
    const counts = {};
    for (const f of open) counts[f.rule] = (counts[f.rule] || 0) + 1;
    fs.writeFileSync(
      path.join(outDir, 'logic-audit.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), files, scannedLines, total: findings.length, open, accepted }, null, 2) + '\n',
    );
    const lines = [
      '# Логически одит — отчет',
      '',
      `Генериран: ${new Date().toISOString()}`,
      '',
      `- сканирани: **${files} файла · ${scannedLines} реда**`,
      `- находки: **${findings.length}** (отворени ${open.length}, приети с обосновка ${accepted.length})`,
      `- по тежест: critical ${bySev('critical').length} · high ${bySev('high').length} · medium ${bySev('medium').length}`,
      '',
      '## Отворени находки',
      '',
      open.length ? '| файл:ред | правило | сегмент | код | защо е проблем |' : '_Няма отворени находки._',
      ...(open.length ? ['|---|---|---|---|---|'] : []),
      ...open.map((f) => `| \`${f.file}:${f.line}\` | ${f.rule} | ${f.segment || ''} | \`${f.code.replace(/\|/g, '\\|')}\` | ${f.why} |`),
      '',
      '## Приети с обосновка',
      '',
      accepted.length ? '| файл:ред | правило | код | обосновка |' : '_Няма._',
      ...(accepted.length ? ['|---|---|---|---|'] : []),
      ...accepted.map((f) => {
        const entry = allow.find((a) => a.file === f.file && (!a.rule || a.rule === f.rule));
        return `| \`${f.file}:${f.line}\` | ${f.rule} | \`${f.code.replace(/\|/g, '\\|')}\` | ${entry ? entry.reason : ''} |`;
      }),
      '',
      '## Правила',
      '',
      '| правило | тежест | какво хваща |',
      '|---|---|---|',
      ...RULES.map((r) => `| ${r.id} | ${r.sev} | ${r.why} |`),
      '',
    ];
    fs.writeFileSync(path.join(outDir, 'logic-audit.md'), lines.join('\n'));
    console.log(`отчет: reports/logic-audit.json · reports/logic-audit.md`);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify({ files, scannedLines, findings, accepted, open }, null, 2) + '\n');
  } else {
    console.log(`логически одит: ${files} файла · ${scannedLines} реда · ${findings.length} находки`);
    if (verbose) {
      for (const f of open) console.log(`  ${f.sev.padEnd(8)} ${f.file}:${f.line}  ${f.rule}  [${f.segment}]\n            ${f.code}\n            ${f.why}\n            → ${f.fix}`);
    }
    const counts = {};
    for (const f of open) counts[f.rule] = (counts[f.rule] || 0) + 1;
    const summary = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ');
    console.log(`  critical=${bySev('critical').length} high=${bySev('high').length} medium=${bySev('medium').length}`);
    console.log(`  разпределение: ${summary || 'няма находки'}`);
    console.log(`  приети с обосновка: ${accepted.length}`);
  }

  if (gate) {
    const blocking = [...bySev('critical'), ...bySev('high')];
    if (blocking.length) {
      console.error(`\nЛОГИЧЕСКИ ГЕЙТ: ${blocking.length} необяснени critical/high находки`);
      for (const f of blocking.slice(0, 10)) console.error(`  ${f.file}:${f.line} ${f.rule} — ${f.why}`);
      process.exitCode = 1;
    } else {
      console.log('\nЛОГИЧЕСКИ ГЕЙТ: чисто (няма необяснени critical/high)');
    }
  }
}
