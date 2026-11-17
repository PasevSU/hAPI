'use strict';
// СПРАЙТЪТ v4 Е ЕДИН ФАЙЛ И СЕ ДЪРЖИ ПО ДОГОВОРА НА ПАКЕТА.
//
// Защо има тест: 710 икони в един файл се чупят тихо — дублиран идентификатор засенчва
// следващия, `<script>` вътре в SVG е активен код, а вграден стил се блокира от CSP. Затова
// тук се проверява броят (142 × 5 = 710), уникалността, формата и че няма нищо изпълнимо.
// Самият спрайт се строи от `scripts/build-icons-sprite.mjs`; тестът не иска пакета.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ui = (name) => path.join(__dirname, '..', 'hapi_enterprise', 'ui', name);
const file = ui('icons-v4.svg');
assert.ok(fs.existsSync(file), 'липсва hapi_enterprise/ui/icons-v4.svg — пусни scripts/build-icons-sprite.mjs');

const raw = fs.readFileSync(file);
const text = raw.toString('utf8');

// ── 1. Файлът е един SVG документ и е LF/UTF-8 ─────────────────────────────
assert.equal(raw[0], 0x3c, 'файлът започва с „<“ (без BOM)');
assert.equal(raw.includes(0x0d), false, 'само LF — CRLF чупи S08/S22');
assert.match(text, /^<!--[\s\S]*?-->\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg">/, 'глава + един корен <svg>');
assert.ok(text.trimEnd().endsWith('</svg>'), 'документът е затворен');
assert.ok(raw.length <= 400 * 1024, 'спрайтът е под 400 KB (днес ~231 KB)');
assert.equal(/<!DOCTYPE/i.test(text), false, 'без DOCTYPE — това е фрагмент, не страница');

// ── 2. 142 икони × 5 стила = 710 символа, всички с един изглед ─────────────
const STYLES = ['standard', 'fine', 'bold', 'duotone', 'glow'];
const symbols = [...text.matchAll(/<symbol id="([a-z0-9][a-z0-9-]*)--(standard|fine|bold|duotone|glow)" viewBox="([^"]+)">/g)];
assert.equal(symbols.length, 710, 'точно 710 символа (днес: ' + symbols.length + ')');
assert.equal((text.match(/<\/symbol>/g) || []).length, 710, 'всеки символ е затворен');

const ids = symbols.map((m) => m[1] + '--' + m[2]);
assert.equal(new Set(ids).size, 710, 'идентификаторите са уникални — дубликат засенчва икона');
const byStyle = new Map(STYLES.map((s) => [s, 0]));
const bases = new Set();
for (const [, name, style, viewBox] of symbols) {
  byStyle.set(style, byStyle.get(style) + 1);
  bases.add(name);
  assert.equal(viewBox, '0 0 24 24', name + '--' + style + ' ползва общия изглед 24×24 (иначе размерът танцува)');
}
assert.equal(bases.size, 142, 'точно 142 икони (днес: ' + bases.size + ')');
for (const style of STYLES) {
  assert.equal(byStyle.get(style), 142, 'стилът ' + style + ' има всичките 142 икони');
}
for (const base of bases) {
  for (const style of STYLES) assert.ok(ids.includes(base + '--' + style), 'липсва ' + base + '--' + style);
}

// ── 3. Нищо изпълнимо и нищо вградено ──────────────────────────────────────
assert.equal(/<script\b/i.test(text), false, 'никакъв <script> в спрайта');
assert.equal(/\sstyle="/i.test(text), false, 'никакъв вграден стил (CSP style-src self)');
assert.equal(/\son[a-z]+\s*=/i.test(text), false, 'никакви обработчици on*= в спрайта');
assert.equal(/https?:\/\/(?!www\.w3\.org)/.test(text), false, 'никакви външни адреси — спрайтът е локален');

// ── 4. Помощникът в панела сочи точно този файл ────────────────────────────
const icons = fs.readFileSync(ui('icons.js'), 'utf8');
assert.match(icons, /SPRITE_STYLES = \['standard', 'fine', 'bold', 'duotone', 'glow'\]/, 'стиловете са обявени в панела');
assert.match(icons, /'\/ui\/icons-v4\.svg'/, 'помощникът строи адреса на спрайта');
assert.match(icons, /window\.HapiIcons = \{ ico, names: Object\.keys\(P\), sprite, SPRITE_STYLES \}/, 'спрайтът е изнесен до всички панели');

const server = fs.readFileSync(path.join(__dirname, '..', 'hapi_enterprise', 'server.js'), 'utf8');
assert.match(server, /files\['\/ui\/icons-v4\.svg'\] = \['ui\/icons-v4\.svg', 'image\/svg\+xml; charset=utf-8'\]/, 'сървърът сервира спрайта с правилния тип');

console.log(
  'PASS icons-v4: 142 × 5 = 710 символа · един изглед · уникални id · без script/style/външни адреси · помощник и сървърен адрес сочат същия файл',
);
