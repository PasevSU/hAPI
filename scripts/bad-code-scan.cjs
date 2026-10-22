'use strict';
// Сегментен скан за лош код.
//
// Всеки файл се разделя на сегменти (функции, класове, секции по заглавия), за да
// може находката да се чете като „този сегмент прави това“, а не като „някъде във
// файла“. Правилата са нарочно тесни: всяко правило има обяснение защо е проблем и
// как се поправя, за да не се превръща одитът в шум.
//
//   node scripts/bad-code-scan.cjs            # отчет за хора
//   node scripts/bad-code-scan.cjs --json     # машинно четимо
//   node scripts/bad-code-scan.cjs --gate     # код 1 при critical/high без обяснение
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ARGS = new Set(process.argv.slice(2));

const DIRS = [
  ['hapi_enterprise', ['.js']],
  ['hapi_enterprise/ui', ['.js']],
  ['scripts', ['.cjs', '.ps1']],
  ['custom_components/hapi_enterprise', ['.py']],
  ['tests', ['.cjs']],
];

// ── правила ────────────────────────────────────────────────────────────────
// severity: critical (изпълним риск), high (реален дефект), medium (мирис),
//           low (стил, който пречи на прегледа).
// ext ограничава правилото до език, за да не се бърка .exec() с eval.
const RULES = [
  { id: 'eval', ext: ['.js', '.cjs'], sev: 'critical', re: /(?<![.\w])eval\s*\(|\bnew\s+Function\s*\(/, why: 'изпълнение на код от низ', fix: 'махни eval; за изрази ползвай явен parser' },
  { id: 'shell-true', ext: ['.js', '.cjs'], sev: 'critical', re: /shell\s*:\s*true/, why: 'шел за child_process → command injection', fix: 'подавай argv масив без shell' },
  { id: 'exec-string', ext: ['.js', '.cjs'], sev: 'high', re: /\b(execSync|execFileSync)\s*\(\s*`/, why: 'команда, сглобена с шаблон', fix: 'argv масив; без интерполация' },
  { id: 'html-sink', ext: [], sev: 'high', re: /(?!)/, why: 'шаблон с неекранирани данни в innerHTML → XSS', fix: 'esc() за всяка стойност' },
  { id: 'doc-write', ext: ['.js'], sev: 'high', re: /document\.write\s*\(/, why: 'document.write е блокиращ и лесно вмъква неекраниран HTML', fix: 'createElement + appendChild' },
  { id: 'md5-sha1', ext: ['.js', '.cjs'], sev: 'high', re: /createHash\(\s*['"](md5|sha1)['"]\s*\)/, why: 'счупен алгоритъм за защита', fix: 'sha256+; md5/sha1 само за контролна сума с бележка' },
  { id: 'weak-random-token', ext: ['.js', '.cjs'], sev: 'critical', re: /Math\.random\(\)[\s\S]{0,40}(token|secret|nonce|salt|apiKey)/i, why: 'Math.random не е криптографски', fix: 'crypto.randomBytes / randomUUID' },
  { id: 'token-eq', ext: ['.js', '.cjs'], sev: 'high', re: /\b(?:token|secret|digest|proof)(?!Id)\w*\s*===\s*[a-zA-Z_$]/, why: 'сравнение на тайна с === (timing)', fix: 'crypto.timingSafeEqual' },
  { id: 'empty-catch', ext: ['.js', '.cjs'], sev: 'low', re: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, why: 'погълната грешка без обяснение', fix: 'коментар защо е безопасно или лог' },
  { id: 'json-parse-untrusted', ext: ['.js', '.cjs'], sev: 'low', re: /JSON\.parse\(\s*[a-zA-Z_$][\w$.]*\s*\)/, why: 'JSON.parse без видим try → 500 при боклук', fix: 'обвий в try/catch и върни 400' },
  { id: 'groupless-mode', ext: ['.js', '.cjs'], sev: 'high', re: /mode\s*:\s*0o?[0-7][1-7][0-7]|mode\s*:\s*0o?[0-7]{2}[1-7]/, why: 'права за група или всички върху данни', fix: '0700 за папки, 0600 за тайни' },
  { id: 'chmod-777', ext: ['.js', '.cjs', '.ps1'], sev: 'critical', re: /chmod[^\n]*\b777\b|mode\s*:\s*0o?777/, why: 'световно записваем файл', fix: 'минимум права' },
  { id: 'ssrf-fetch', ext: ['.js'], sev: 'medium', re: /\bfetch\(\s*(?:target|next|callbackUrl|endpoint)\b/, why: 'заявка към адрес, който идва от конфигурация/заявка → SSRF', fix: 'валидирай схема и хост срещу allowlist' },
  { id: 'traversal-join', ext: ['.js', '.cjs'], sev: 'medium', re: /path\.(?:join|resolve)\([^)]*(?:req\.|params\.|query\.|body\.)/, why: 'път, сглобен от заявката → обход на директории', fix: 'провери с path.relative срещу корена' },
  { id: 'require-dynamic', ext: ['.js'], sev: 'high', re: /require\(\s*[a-zA-Z_$][\w$.]*\s*\)/, why: 'динамичен require', fix: 'статичен списък от разрешени модули' },
  { id: 'py-eval', ext: ['.py'], sev: 'critical', re: /(?<![.\w])(eval|exec)\s*\(/, why: 'изпълнение на код', fix: 'без eval/exec' },
  { id: 'py-subprocess', ext: ['.py'], sev: 'high', re: /subprocess\.(?:run|call|Popen)\([^)]*shell\s*=\s*True/, why: 'shell=True', fix: 'списък с аргументи' },
  { id: 'py-yaml-load', ext: ['.py'], sev: 'high', re: /yaml\.load\(/, why: 'yaml.load без SafeLoader', fix: 'yaml.safe_load' },
  { id: 'ps-invoke-expression', ext: ['.ps1'], sev: 'critical', re: /Invoke-Expression|\biex\b/, why: 'изпълнение на низ като команда', fix: 'извикай командата директно' },
  { id: 'ps-plaintext-secret', ext: ['.ps1'], sev: 'high', re: /\$(?:token|password|secret|apikey)\w*\s*=\s*['"][^'"]{8,}['"]/i, why: 'тайна в скрипта', fix: 'параметър / env / keyring' },
  { id: 'ps-elevation', ext: ['.ps1'], sev: 'medium', re: /-Verb\s+RunAs/, why: 'скриптът иска повишаване на права', fix: 'остави ръчна стъпка за потребителя' },
  { id: 'todo', ext: ['.js', '.cjs', '.py', '.ps1'], sev: 'low', re: /\b(TODO|FIXME|XXX|HACK)\b/, why: 'недовършена работа', fix: 'довърши или махни' },
];

// Вътрешен анализ на innerHTML: проверява всяка интерполация дали е екранирана.
// Това е точното правило — шаблонът сам по себе си не е проблем, проблем е
// стойност, която влиза в него без esc().
const SAFE_CALL = /^(?:esc|escAttr|encodeURIComponent|String|Number|Math\.\w+|ico|iconHtml|fmt[A-Z]\w*|bool|escHtml|safeHtml)\s*\(/;
const SAFE_COMPONENT = /^(?:filePane|cardHtml|rowHtml|pane|render\w+|listHtml|tableHtml|formHtml|detailsHtml|kvHtml|contactForm|contactCard|caseForm|caseCard|rulesSummaryHtml|preflightHtml|nodeHtml|statusLine|pgpSection|field|cellsHtml|chipsHtml|reportPreview)\s*\(/;
// Числови членове от нашия собствен API — не са вход за XSS.
const NUMERIC_MEMBER = /^[a-zA-Z_$][\w$.]*?\.(?:length|size|count|index|total|port|active|paused|disabled|ttl_hours|max_uses|[a-z]+Bytes|[a-z]+_count|version)\b(?!\s*\()/;

// Файлове, за които правилата са неприложими (внесен код / генерирано / самият скенер).
const SKIP_FILE = [
  /^hapi_enterprise\/qrcode\.js$/, // внедрена реализация на QR (чиста математика)
  /^scripts\/bad-code-scan\.cjs$/, // правилата цитират забранените модели
];

// ── сегментиране ───────────────────────────────────────────────────────────
function segmentsOf(src, ext) {
  const lines = src.split('\n');
  const marks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (ext === '.py') {
      if ((m = /^(?:async\s+)?def\s+(\w+)/.exec(line)) || (m = /^class\s+(\w+)/.exec(line))) marks.push({ line: i, name: m[1] });
    } else if (ext === '.ps1') {
      if ((m = /^(?:function|filter)\s+([\w-]+)/i.exec(line))) marks.push({ line: i, name: m[1] });
    } else {
      if ((m = /^(?:async\s+)?function\s+([\w$]+)/.exec(line))) marks.push({ line: i, name: m[1] });
      else if ((m = /^(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function|\()/.exec(line))) marks.push({ line: i, name: m[1] });
      else if ((m = /^(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?[\w$]+\s*=>/.exec(line))) marks.push({ line: i, name: m[1] });
      else if ((m = /^class\s+([\w$]+)/.exec(line))) marks.push({ line: i, name: m[1] });
      else if ((m = /^\/\/\s*[─—-]{2,}\s*(.+?)\s*[─—-]*$/.exec(line))) marks.push({ line: i, name: '«' + m[1].slice(0, 60) + '»' });
    }
  }
  if (!marks.length || marks[0].line > 0) marks.unshift({ line: 0, name: '(начало)' });
  return marks.map((mk, idx) => ({ name: mk.name, start: mk.line, end: (marks[idx + 1] ? marks[idx + 1].line : lines.length) - 1 }));
}

function walk(dir, exts, acc = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (['node_modules', '__pycache__', 'dist', 'release', '.venv'].includes(entry.name)) continue;
      walk(rel, exts, acc);
    } else if (exts.includes(path.extname(entry.name))) acc.push(rel);
  }
  return acc;
}

// Изважда шаблона след `.innerHTML =` и връща всяка интерполация с класация:
//   raw       — гола стойност (променлива/член) → реален XSS риск
//   component — извикване на вътрешна функция за разметка → приемливо, но се отчита
//   safe      — esc()/String()/число/литерал
function innerHtmlInterpolations(src) {
  const out = [];
  const tail = /\.(?:innerHTML|outerHTML)\s*=\s*/g;
  let hit;
  while ((hit = tail.exec(src)) !== null) {
    let i = hit.index + hit[0].length;
    if (src[i] !== '`') {
      // конкатенация: .innerHTML = '...' + variable
      const rest = src.slice(i, src.indexOf(';', i) + 1);
      const concat = /(['"`])\s*\+\s*([a-zA-Z_$][\w$.\[\]()'"]*)/.exec(rest);
      if (concat) out.push({ index: i, expr: concat[2], kind: 'raw', concat: true });
      continue;
    }
    i++; // след отварящата кавичка
    // Един стек за вложените шаблони: `${x ? `<b>${raw}</b>` : ''}` трябва да
    // доведе до находка за raw, а не да се загуби в тернара.
    let depth = 0;
    let buf = '';
    let inExpr = false;
    const startIdx = i;
    let nested = 0;
    const flush = () => {
      const expr = buf.trim();
      buf = '';
      const kind = SAFE_CALL.test(expr) ? 'safe'
        : SAFE_COMPONENT.test(expr) || /\.map\([^)]*\)\s*\.join\(/.test(expr) ? 'component'
          : /^['"`\d]/.test(expr) ? 'safe'
            : NUMERIC_MEMBER.test(expr) ? 'safe'
              : /^[a-zA-Z_$][\w$.]*\s*$/.test(expr) ? 'medium'
                : /\?/.test(expr) ? 'component'
                  : /^[a-zA-Z_$][\w$.]*\s*\(/.test(expr) ? 'component'
                    : 'raw';
      out.push({ index: startIdx, expr, kind, nested: nested > 0 });
    };
    for (; i < src.length; i++) {
      const ch = src[i];
      if (!inExpr) {
        if (ch === '`') {
          if (nested === 0) break; // край на външния шаблон
          nested--;
          continue;
        }
        if (ch === '\\') { i++; continue; }
        if (ch === '$' && src[i + 1] === '{') { inExpr = true; buf = ''; i++; }
        continue;
      }
      if (ch === '`') { nested++; continue; } // вложен шаблон вътре в израза
      if (ch === '{') depth++;
      if (ch === '}') {
        if (depth === 0) { inExpr = false; flush(); continue; }
        depth--;
      }
      buf += ch;
    }
    if (i >= src.length) break;
  }
  return out;
}

// ── allowlist: приети находки с писмена обосновка ──────────────────────────
const ALLOW_PATH = path.join(__dirname, 'bad-code-allowlist.json');
let ALLOW = [];
try {
  ALLOW = JSON.parse(fs.readFileSync(ALLOW_PATH, 'utf8'));
} catch {
  ALLOW = [];
}
const allowed = (f) => ALLOW.find((a) => a.file === f.file && a.rule === f.rule && (!a.line || a.line === f.line));

const findings = [];
let scanned = 0;
let totalLines = 0;
const seenFiles = new Set();
for (const [dir, exts] of DIRS) {
  let files = [];
  try { files = walk(dir, exts); } catch { continue; }
  for (const rel of files) {
    if (SKIP_FILE.some((re) => re.test(rel))) continue;
    if (seenFiles.has(rel)) continue;
    seenFiles.add(rel);
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const lines = src.split('\n');
    scanned++;
    totalLines += lines.length;
    const segs = segmentsOf(src, path.extname(rel));
    const segOf = (line) => (segs.find((s) => line >= s.start && line <= s.end) || segs[0]).name;
    for (const rule of RULES) {
      if (rule.ext && !rule.ext.includes(path.extname(rel))) continue;
      const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
      let m;
      let guard = 0;
      const local = new RegExp(re.source, re.flags);
      while ((m = local.exec(src)) !== null && guard++ < 5000) {
        if (m.index === local.lastIndex) local.lastIndex++;
        const line = src.slice(0, m.index).split('\n').length - 1;
        const raw = lines[line].trim();
        // коментарите описват забранения модел, но не го изпълняват
        if (/^(?:\/\/|#|\*|\/\*)/.test(raw)) continue;
        // Тежестта зависи от експозицията: shell в инструмент за разработка не е
        // същият риск като shell в кода, който върви в add-on-а.
        let sev = rule.sev;
        if (rule.id === 'shell-true' && rel.startsWith('scripts/')) sev = 'high';
        findings.push({ file: rel, line: line + 1, segment: segOf(line), rule: rule.id, sev, why: rule.why, fix: rule.fix, text: raw.slice(0, 140) });
      }
    }

    // точен анализ на innerHTML — интерполация по интерполация
    if (path.extname(rel) === '.js') {
      for (const item of innerHtmlInterpolations(src)) {
        if (item.kind === 'safe') continue;
        const line = src.slice(0, item.index).split('\n').length - 1;
        findings.push({
          file: rel,
          line: line + 1,
          segment: segOf(line),
          rule: 'html-sink',
          sev: item.kind === 'component' ? 'low' : 'medium',
          why: item.kind === 'component' ? 'вътрешна функция за разметка в innerHTML'
            : item.kind === 'medium' ? 'стойност от API в innerHTML без esc()'
              : 'израз с данни в innerHTML без esc()',
          fix: 'esc() около стойността',
          text: '${' + item.expr.slice(0, 80) + '}',
        });
      }
    }
  }
}

// ── отчет ──────────────────────────────────────────────────────────────────
const order = { critical: 0, high: 1, medium: 2, low: 3 };
const suppressed = [];
const active = [];
for (const f of findings) (allowed(f) ? suppressed : active).push(f);

const tally = (list) => list.reduce((acc, f) => ((acc[f.sev] = (acc[f.sev] || 0) + 1), acc), {});
const bySev = tally(active);
const byRule = active.reduce((acc, f) => ((acc[f.rule] = (acc[f.rule] || 0) + 1), acc), {});

if (ARGS.has('--json')) {
  console.log(JSON.stringify({ scanned, totalLines, bySev, byRule, findings: active, suppressed }, null, 2));
} else {
  console.log(`сканирани: ${scanned} файла · ${totalLines} реда (${active.length} находки, ${suppressed.length} приети с обосновка)`);
  console.log(`активни: critical=${bySev.critical || 0} high=${bySev.high || 0} medium=${bySev.medium || 0} low=${bySev.low || 0}`);
  const top = Object.entries(byRule).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (top.length) console.log('по правила: ' + top.map(([k, v]) => `${k}=${v}`).join(' · '));

  const byFile = {};
  for (const f of active) (byFile[f.file] = byFile[f.file] || []).push(f);
  const files = Object.entries(byFile).sort((a, b) => {
    const score = (list) => list.reduce((s, f) => s + (4 - order[f.sev]), 0);
    return score(b[1]) - score(a[1]);
  });
  for (const [file, list] of files.slice(0, 15)) {
    console.log(`\n■ ${file}  (${list.length})`);
    for (const f of list.slice(0, 12)) console.log(`   ${f.sev.padEnd(8)} ${String(f.line).padStart(5)}  ${f.segment}  · ${f.rule} — ${f.why} [${f.text.slice(0, 60)}]`);
  }
}

if (ARGS.has('--gate')) {
  const blocking = active.filter((f) => f.sev === 'critical' || f.sev === 'high');
  if (blocking.length) {
    console.error(`\nГЕЙТ: ${blocking.length} необяснени находки critical/high`);
    process.exitCode = 1;
  } else {
    console.log('\nГЕЙТ: чисто (няма необяснени critical/high)');
  }
}
