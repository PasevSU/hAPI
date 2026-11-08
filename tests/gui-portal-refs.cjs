'use strict';
// Панелът на портала показва ЕДИН адрес — портала. Техническите адреси са информация,
// която порталът извежда сам, и не бива да стоят в интерфейса като списък от препратки.
//
// Защо е тест, а не само решение: до 0.69.146 „Контролен панел на портала“ изреждаше осем
// адреса (API, Манифест, Файлове, Хранилище, OpenAPI, Адрес на портала, Папка, QR изображение).
// Човек не можеше да разбере кое се отваря, а адресът на издадения токен се показваше така,
// че приличаше на връзка. Този тест пази следното:
//   • в панела НЯМА списък с технически адреси и няма бутон „Копирай препратките“;
//   • има точно един вход — порталът: „Отвори портала“ + QR кодът, който носи същия адрес;
//   • адресът НЕ се показва и НЕ се копира като текст, а „Свали api.json“ не е в картата;
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

// ── 2. Остава ЕДИН вход: порталът — връзката върху QR кода ─────────────────
// До 0.69.199 входът беше в отделен блок с бутон „Отвори портала“ и QR код с двойно
// щракване. Блокът е махнат: кодът е бутон в главата на картата, а самият код е връзка
// (`<a href>`) към същия адрес — тоест входът е един и работи и с клавиатура.
assert.match(manager, /data-qr-portal="\$\{i\}"/, 'картата има бутон за QR кода');
assert.match(manager, /class="pf-qr-pop-link" href="\$\{esc\(qrUrl\)\}"/, 'кодът е връзка към портала');
assert.match(manager, /const qrUrl = api \? api\.folderUrl \|\| api\.landing \|\| '' : ''/, 'връзката носи адреса на портала');
assert.equal(/id="pf-open-portal"/.test(panel + manager), false, 'отделният бутон „Отвори портала“ е махнат (входът е един)');
assert.equal(/id="pf-portal-qr"/.test(panel + manager), false, 'старият QR блок е махнат');
assert.equal(/window\.location\.href = url/.test(manager), false, 'няма ръчно пренасочване — връзката върши това');
assert.equal(/id="pf-copy-portal"/.test(panel + manager), false, 'адресът не се копира — не се показва като текст');
assert.equal(/id="pf-dl-api"/.test(panel + manager), false, 'картата не сваля api.json');
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
  'PASS portal-refs: панелът дава един вход (Отвори/QR) · нула технически препратки · ' +
  'токенът е `.pf-token-value` без подчертаване · договорът refs остава в api-spec.js',
);
