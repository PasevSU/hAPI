'use strict';
// ИНВЕНТАРЪТ НА КОДА СЕ ГЕНЕРИРА — И ТРЯБВА ДА Е АКТУАЛЕН.
//
// `SOURCE_INVENTORY.md` беше ръчно поддържан и застина на v0.50.0, докато модулите станаха
// 99. Затова документът вече се пише от `scripts/source-inventory.cjs`, а тук се проверява,
// че (1) е актуален, (2) проверката НАИСТИНА хваща остарял документ, (3) всеки изброен файл
// съществува и (4) версията в него е текущата. Без (2) „проверката“ е декорация.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'source-inventory.cjs');
const doc = path.join(ROOT, 'documentation', '01_AS_IS_ARCHITECTURE', 'SOURCE_INVENTORY.md');

// 1. Актуален ли е спрямо диска?
execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' });

const original = fs.readFileSync(doc, 'utf8');

// 2. Хваща ли остарял документ? Ред за измислен модул трябва да провали --check.
try {
  fs.writeFileSync(doc, original + '\n| `hapi_enterprise/izmislen-modul.js` | измислен модул |\n');
  assert.throws(
    () => execFileSync(process.execPath, [script, '--check'], { stdio: 'pipe' }),
    /Command failed|status 1/,
    'проверката трябва да хване остарял документ',
  );
} finally {
  fs.writeFileSync(doc, original);
}

// 3. Всеки ред от таблицата сочи реален файл (документът не изброява призраци).
const rows = [...original.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
assert.ok(rows.length > 100, `инвентарът изброява файловете: ${rows.length}`);
const ghosts = rows.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
assert.deepEqual(ghosts, [], `инвентарът сочи липсващи файлове: ${JSON.stringify(ghosts)}`);

// 4. Не е замразен на стара версия.
const cfg = fs.readFileSync(path.join(ROOT, 'hapi_enterprise', 'config.yaml'), 'utf8');
const version = (cfg.match(/^version: "([^"]+)"/m) || [])[1];
assert.ok(original.includes(`**${version}**`), `инвентарът трябва да носи версия ${version}`);

console.log(
  `source-inventory OK: ${rows.length} файла · актуален спрямо диска · хваща измислен ред · версия ${version}`,
);
