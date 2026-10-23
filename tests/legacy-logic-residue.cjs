'use strict';
// Търсач на остатъци от СТАРАТА логика (0.69.67).
//
// Идеята: преди да се строи новата логика, трябва да се вижда какво още стои от старата.
// Затова всяко правило носи фаза (бач от `PLAN-0.69.67-LINKS-AND-FILES.md`) и флаг
// `enforced`:
//   • `enforced: true`  → правилото е ГЕЙТ: попадение = провал (бачът е завършен, значи
//     остатък няма право да съществува);
//   • `enforced: false` → ИНВЕНТАР: попаденията се показват с брой, но не провалят нищо,
//     защото бачът още не е започнал. Така „предстои“ не се бърка с „готово“.
//
// Скенерът е текстов и съзнателно НЕ проверява неща, които се доказват само с поведение
// (криптирана работна папка, публикуване на Evidence View) — те имат собствени тестове.
// Всяко изключение се записва в ALLOW с причина; мълчаливи изключения няма.
//
// Пускане: `node tests/legacy-logic-residue.cjs` (или `--verbose` за всеки ред).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP_DIRS = ['hapi_enterprise', 'custom_components'];
const SCAN_EXT = new Set(['.js', '.cjs', '.mjs', '.html', '.yaml', '.json']);
const SKIP_DIRS = new Set(['node_modules', 'fonts', 'translations']);

// ── Правила ──────────────────────────────────────────────────────────────────
// `files` ограничава обхвата; без `files` правилото важи за всички приложни файлове.
const RULES = [
  {
    id: 'W1-token-generated',
    batch: 'B1',
    enforced: true,
    files: ['hapi_enterprise/start.js'],
    re: /\brandomBytes\b|\brandomUUID\b/,
    why: 'стартът генерираше админ токен, когато липсва — тихо скриване на липсваща конфигурация',
    fix: 'токенът идва само от опция `token` (или от вече записан /data/admin-token); нов не се създава',
  },
  {
    id: 'W1-token-persisted',
    batch: 'B1',
    enforced: true,
    files: ['hapi_enterprise/start.js'],
    re: /writeFileSync\([^)]*admin-token/,
    why: 'стартът записваше токен в /data/admin-token',
    fix: 'файлът само се чете (обратна съвместимост), никога не се пише',
  },
  {
    id: 'W1-placeholder-default',
    batch: 'B1',
    enforced: true,
    files: ['hapi_enterprise/config.yaml'],
    re: /token:\s*"?(CHANGE_TO_RANDOM|changeme|secret)/i,
    why: 'опцията `token` имаше стойност-заглушка, която изглежда като работеща',
    fix: 'по подразбиране е празно, а празно = отказ при старт с ADMIN_TOKEN_REQUIRED',
  },
  {
    id: 'W7-invented-address',
    batch: 'W7 (0.69.66)',
    enforced: true,
    re: /portal\.example\.com/,
    why: 'панелът чертаеше измислен публичен адрес — връзките никога не се отваряха',
    fix: 'ползва се `linkBase()`: публичният адрес, ако е зададен, иначе адресът на панела',
  },
  {
    id: 'W7-link-from-browser-origin',
    batch: 'W7 (0.69.66)',
    enforced: true,
    files: ['hapi_enterprise/ui'],
    // Двете посоки на грешката: „location.origin … signed/share/link“ и обратното.
    // Заявките към API-то законно ползват `location.origin` през `apiBase()` — това не е W7.
    re: /location\.origin[^\n]{0,60}(signed|share|link)|(signed|share|link)[A-Za-z]*[^\n]{0,60}location\.origin/i,
    why: 'под Ingress `location.origin` е адресът на Home Assistant, не на add-on-а → 401/404',
    fix: 'адресът на споделените/подписани връзки идва от `linkBase()`; заявките ползват `apiBase()`',
  },
  {
    id: 'W8-encrypted-key-refused',
    batch: 'W8',
    enforced: true,
    files: ['hapi_enterprise/pgp.js'],
    re: /ENCRYPTED_KEY/,
    why: 'двигателят отказваше ключ с парола, а всеки реален ключ е с парола',
    fix: 'S2K тип 0/1/3 се разчита; грешката е PASSPHRASE_REQUIRED / PASSPHRASE_WRONG',
  },
  {
    id: 'W2-key-folder-guess',
    batch: 'B2',
    enforced: true,
    re: /pgp_keys_dir|PGP_KEYS_DIR/,
    why: 'ключовете се търсеха по „папка“ с предположение за /config, което в контейнера е друго',
    fix: 'три пълни пътя: `pgp_path_public`, `pgp_path_secret`, `pgp_path_pass`',
  },
  {
    id: 'W3-plaintext-storage-path',
    batch: 'B3',
    enforced: false,
    re: /\bstoragePath\s*:\s/,
    why: 'вътрешният път стои в открит вид в db.json (полетата `storagePath`)',
    fix: '`storagePathEnc` (PGP съобщение); откритият път съществува само в паметта',
  },
];

// ── Изключения (всяко с причина) ─────────────────────────────────────────────
const ALLOW = [
  {
    file: 'hapi_enterprise/standalone.js',
    rule: 'W1-token-generated',
    reason:
      'настолният Windows пакет (портативен старт на 127.0.0.1) си прави токен за СЕСИЯТА — това не е ' +
      'конфигурацията на add-on-а и не се пази на диск; правилото W1 важи за add-on старта',
  },
  {
    file: 'hapi_enterprise/ui/public-gateway.js',
    rule: 'W7-invented-address',
    reason:
      'това е `placeholder` в полето за домейн — подсказка как изглежда домейн, не адрес в резултат; ' +
      'изходът на `publicBase()` вече не измисля хост',
  },
];

/** Всички приложни файлове за сканиране (без тестове, без документация). */
function collectFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (SCAN_EXT.has(path.extname(entry.name))) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  for (const dir of APP_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const allowed = (file, ruleId) => ALLOW.some((a) => a.file === file && a.rule === ruleId);

function run() {
  const files = collectFiles();
  assert.ok(files.length > 100, 'скенерът трябва да вижда приложните файлове (намерени: ' + files.length + ')');

  const hits = [];
  for (const rule of RULES) {
    const targets = rule.files
      ? files.filter((f) =>
        rule.files.some((prefix) => {
          const r = rel(f);
          return r === prefix || r.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
        })
      )
      : files;
    for (const file of targets) {
      const name = rel(file);
      if (allowed(name, rule.id)) continue;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (rule.re.test(lines[i])) {
          hits.push({ rule, file: name, line: i + 1, code: lines[i].trim().slice(0, 140) });
        }
      }
    }
  }

  const enforced = RULES.filter((r) => r.enforced);
  const pending = RULES.filter((r) => !r.enforced);
  const gateHits = hits.filter((h) => h.rule.enforced);
  const invHits = hits.filter((h) => !h.rule.enforced);
  const verbose = process.argv.includes('--verbose');

  // Инвентар: какво още чака своя бач (не е провал, но се вижда).
  if (invHits.length) {
    const byRule = new Map();
    for (const h of invHits) byRule.set(h.rule.id, (byRule.get(h.rule.id) || 0) + 1);
    console.log('Инвентар (предстоящи бачове, НЕ е гейт):');
    for (const rule of pending) {
      const count = byRule.get(rule.id) || 0;
      console.log(`  · ${rule.id} (${rule.batch}): ${count} попадения — ${rule.why}`);
      if (verbose || count) {
        for (const h of invHits.filter((x) => x.rule.id === rule.id)) {
          console.log(`      ${h.file}:${h.line}  ${h.code}`);
        }
      }
    }
  }

  if (gateHits.length) {
    console.log('ОСТАТЪЦИ ОТ СТАРАТА ЛОГИКА (гейт):');
    for (const h of gateHits) {
      console.log(`  ✖ ${h.rule.id} (${h.rule.batch}) ${h.file}:${h.line}`);
      console.log(`      код: ${h.code}`);
      console.log(`      защо е грешно: ${h.rule.why}`);
      console.log(`      какво трябва: ${h.rule.fix}`);
    }
    throw new Error(
      `остатъци от старата логика: ${gateHits.length} попадения в ${enforced.length} правила, които вече са гейт`
    );
  }

  console.log(
    `PASS legacy-logic-residue: ${files.length} приложни файла · ${RULES.length} правила ` +
    `(${enforced.length} в сила, ${pending.length} инвентар) · 0 остатъка от старата логика` +
    (invHits.length ? ` · ${invHits.length} попадения чакат своя бач` : '')
  );
}

try {
  run();
} catch (err) {
  console.error('FAIL legacy-logic-residue: ' + (err && err.message ? err.message : err));
  process.exit(1);
}
