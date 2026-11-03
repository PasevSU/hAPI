'use strict';
// Панелът на портала показва ЕДИН адрес — портала. Техническите адреси са информация,
// която порталът извежда сам, и не бива да стоят в интерфейса като списък от препратки.
//
// Защо е тест, а не само решение: до 0.69.146 „Контролен панел на портала“ изреждаше осем
// адреса (API, Манифест, Файлове, Хранилище, OpenAPI, Адрес на портала, Папка, QR изображение).
// Човек не можеше да разбере кое се отваря, а адресът на издадения токен се показваше така,
// че приличаше на връзка. Този тест пази следното:
//   • в панела НЯМА списък с технически адреси и няма бутон „Копирай препратките“;
//   • има точно един адрес — порталът: „Отвори портала“ + „Копирай адреса“;
//   • машинното описание остава достъпно с бутон (файл), а не като адрес в текста;
//   • адресът на токена е в `.pf-token-value` — информация, не връзка (без подчертаване);
//   • договорът `refs` в `api-spec.js` НЕ се маха — маха се само показването му в UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const panel = read('hapi_enterprise/ui/portal-control.js');
const manager = read('hapi_enterprise/ui/files-manager.js');
const css = read('hapi_enterprise/ui/components.css');
const spec = read('hapi_enterprise/api-spec.js');

/** Правилото: низът не бива да е шаблон за показване на адрес (`<dt>Име</dt><dd>…`). */
const notPrintedAsFact = (source, label) => {
  const printed = new RegExp(`<dt>\\s*${label}\\s*</dt>`, 'i').test(source);
  assert.equal(printed, false, `техническият адрес „${label}“ вече не се показва в панела`);
};

// ── 1. Списъкът с осемте адреса е премахнат ─────────────────────────────────
for (const label of ['API', 'Манифест', 'Файлове', 'Хранилище', 'OpenAPI', 'QR изображение', 'Генерирано']) {
  notPrintedAsFact(panel, label);
}
assert.equal(/'fm-meta'/.test(panel) || /class="fm-meta"/.test(panel), false, 'таблицата с препратките е махната от панела');
assert.equal(/pf-copy-refs/.test(panel + manager), false, 'бутонът „Копирай препратките“ не съществува');
assert.equal(/pf-dl-openapi/.test(panel + manager), false, 'OpenAPI адресът не се предлага като втори файл в панела');
assert.equal(/Препратките са копирани/.test(manager), false, 'няма съобщение за копирани препратки');

// ── 2. Остава един адрес: порталът ──────────────────────────────────────────
assert.match(panel, /id="pf-open-portal"[^>]*data-open-portal-id=/, 'панелът има „Отвори портала“');
assert.match(panel, /id="pf-copy-portal"/, 'и „Копирай адреса“ — единственият адрес');
assert.match(manager, /q\('#pf-copy-portal'\)/, 'бутонът „Копирай адреса“ е свързан');
assert.match(
  manager,
  /copyText\(state\.api\[portal\(\)\.id\]\.landing/,
  'копира се адресът на портала (`landing`), а не списък с препратки',
);
assert.match(panel, /id="pf-dl-api"/, 'машинното описание се сваля като файл (бутон, не адрес в текста)');
const panelText = panel.replace(/<[^>]*>/g, ' ');
assert.equal(
  /https?:\/\/\S+/.test(panelText),
  false,
  'панелът не отпечатва адрес като текст — адресът се отваря или копира с бутон',
);

// ── 3. Адресът на токена е информация, не връзка ────────────────────────────
assert.match(manager, /class="pf-token-value"/, 'издаденият адрес се показва в `.pf-token-value`');
assert.equal(
  /<code>\$\{esc\(url\)\}<\/code>/.test(manager),
  false,
  'адресът на токена не се обгражда като код (изглеждаше като връзка)',
);
const tokenRule = (css.match(/\.pf-token-value\s*\{[\s\S]*?\}/) || [])[0] || '';
assert.ok(tokenRule, 'има правило `.pf-token-value` в `components.css`');
assert.match(tokenRule, /text-decoration:\s*none/, 'адресът не се подчертава');
assert.match(tokenRule, /user-select:\s*all/, 'адресът се избира с едно движение (за копиране)');
assert.match(tokenRule, /overflow-wrap:\s*anywhere/, 'дългият адрес не чупи оформлението');

// ── 4. Договорът остава — маха се само показването ──────────────────────────
for (const ref of ['apiUrl', 'manifestUrl', 'filesUrl', 'storageUrl', 'openapiUrl']) {
  assert.match(spec, new RegExp(`${ref}:`), 'договорът „' + ref + '“ остава в api-spec.js (машинен, не UI)');
}

console.log(
  'PASS portal-refs: панелът показва един адрес (Отвори/Копирай) · нула технически препратки · ' +
  'токенът е `.pf-token-value` без подчертаване · договорът refs остава в api-spec.js',
);
