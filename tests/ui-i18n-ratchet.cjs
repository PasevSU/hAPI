'use strict';
// ЕЗИКЪТ НА КОНЗОЛАТА: ръстът е ЗАКЛЮЧЕН, докато преводът не стане последователен (DEF-49).
//
// Проблемът (измерен, не предположен): навигацията и „Настройки“ минават през `t()` от
// `i18n.js` (BG/EN/DE), а панелите, писани след тях, са само на български. При избран EN
// или DE интерфейс тези страници остават на български. Числата за 0.69.206 (български
// знаци в СТРИНГОВЕ, след махане на коментарите):
//
//   files-manager.js 9672 · settings-panel.js 7423 · report-studio.js 3260 ·
//   portal-control.js 2137 · export-center.js 1977 · monitoring-panel.js 1831 · …
//
// Тестът НЕ твърди, че преводът е готов — не е. Той пази две неща, които иначе се губят
// безшумно:
//   1. нито един модул не добавя НОВ български низ (таванът е измереното днес; може само
//      да пада) — иначе всеки следващ панел пак се ражда едноезичен и дългът расте;
//   2. преводната повърхност (`t(`) не се свива — изтрит превод е регресия, не поправка.
//
// Когато модул бъде преведен, числото му се СВАЛЯ в тази таблица в СЪЩИЯ комит. Таблицата е
// и списъкът на оставащата работа: всеки ред е панел, който чака ключове × 3 езика.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const uiDir = path.join(__dirname, '..', 'hapi_enterprise', 'ui');
// `i18n.js` е самият речник (BG/EN/DE) — той Е български по определение.
const DICTIONARY = 'i18n.js';

/** Маха коментарите: коментарите са на български нарочно и не са интерфейсен текст. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const measure = (name) => {
  const code = stripComments(fs.readFileSync(path.join(uiDir, name), 'utf8'));
  return {
    cyrillic: (code.match(/[\u0400-\u04FF]/g) || []).length,
    translated: (code.match(/\bt\(/g) || []).length,
  };
};

// Измерено на 0.69.206. Само надолу.
const CEILING = {
  'api-base.js': 0,
  'app.js': 490,
  'bootstrap.js': 0,
  'dashboard-panel.js': 636,
  'data.js': 726,
  'debug-objects.js': 612,
  'directory-panel.js': 989,
  'export-center.js': 1977,
  'files-manager.js': 9672,
  'icons.js': 0,
  'monitoring-panel.js': 1831,
  'panel-registry.js': 117,
  'paptresor.js': 876,
  'portal-control.js': 2137,
  'portal-files.js': 1059,
  'portal-folders.js': 957,
  'portals.js': 667,
  'public-gateway.js': 1274,
  'report-objects.js': 265,
  'report-scope.js': 812,
  'report-sign.js': 77,
  'report-studio.js': 3260,
  'secret-share.js': 84,
  'settings-panel.js': 7423,
  'visitors-panel.js': 909,
};
const TOTAL_CEILING = 36850; // сумата без речника
const TRANSLATED_FLOOR = 9; // извиквания на `t(` извън `i18n.js`

// ── 1. Всеки модул е под своя таван ─────────────────────────────────────────
let total = 0;
let translated = 0;
const modules = fs
  .readdirSync(uiDir)
  .filter((f) => f.endsWith('.js') && f !== DICTIONARY)
  .sort();
for (const name of modules) {
  const { cyrillic, translated: calls } = measure(name);
  total += cyrillic;
  translated += calls;
  if (!(name in CEILING)) {
    assert.fail(
      name +
        ' е нов модул без измерване — добави реда му в CEILING на този тест (и помисли дали текстът му не може да мине през t() от i18n.js)',
    );
  }
  assert.ok(
    cyrillic <= CEILING[name],
    name +
      ': ' +
      cyrillic +
      ' български знака в стрингове, таванът е ' +
      CEILING[name] +
      '. Нов текст на интерфейса минава през t() (DEF-49); ако си ПРЕВЕЛ модула, свали тавана в същия комит.',
  );
}

// ── 2. Общият дълг не расте ────────────────────────────────────────────────
assert.ok(total <= TOTAL_CEILING, 'общо ' + total + ' български знака в интерфейса, таванът е ' + TOTAL_CEILING);

// ── 3. Преводната повърхност не се свива ───────────────────────────────────
assert.ok(
  translated >= TRANSLATED_FLOOR,
  'извиквания на t() в интерфейса: ' +
    translated +
    ', долната граница е ' +
    TRANSLATED_FLOOR +
    ' — изтрит превод е регресия, а не поправка',
);

console.log(
  'PASS ui-i18n-ratchet: ' +
    modules.length +
    ' модула · ' +
    total +
    ' български знака (таван ' +
    TOTAL_CEILING +
    ') · ' +
    translated +
    ' извиквания на t() (под ' +
    TRANSLATED_FLOOR +
    ') · DEF-49 остава отворен, ръстът е заключен',
);
