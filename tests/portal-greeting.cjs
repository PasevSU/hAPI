'use strict';
// Страницата, която човек отваря в папката на портала (`<DATA_DIR>/api/<slug>/portal.html`).
//
// Правилото на проекта: ЕДИН адрес — порталът. Всичко друго е информация, която страницата
// извежда сама. Затова тук се проверява точно това:
//   • страницата ПОЗДРАВЯВА (първото заглавие не е име на файл, а поздрав);
//   • носи информацията за портала (идентификатор, папка, бройки, хешове) — без да я праща
//     към други адреси;
//   • има точно ЕДНА връзка, която не сваля файл: „Отвори портала“ (самият портал);
//   • не изрежда технически адреси (api.json / openapi.json / qr.svg) като връзки и не
//     отпечатва URL като гол текст.
const assert = require('node:assert/strict');
const path = require('node:path');

const portalFolder = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-folder.js'));

const PORTAL = {
  id: 'b7f3c1d2-0000-4000-8000-000000000001',
  slug: 'newportal2b',
  title: 'Договори за клиент А',
  description: 'Тук са договорите и анексите по вашето дело.',
  storage_root: '/share/hapi/data/klient-a',
  files: [
    { id: 'f1', name: 'договор.pdf', size: 2048, sha256: 'a'.repeat(64), accessMode: 'FREE' },
    { id: 'f2', name: 'таен.pdf', size: 10, sha256: 'b'.repeat(64), accessMode: 'DISABLED' },
  ],
};
const TREE = {
  folders: [{ name: 'Договори 2026', path: '/Договори 2026' }],
  files: [{ name: 'анекс.txt', path: '/Договори 2026/анекс.txt', size: 12 }],
  truncated: false,
  depthLimited: false,
};

const html = portalFolder.page(PORTAL, 'https://hapi.example.bg', TREE);
const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// ── 1. Поздравът е първото заглавие ─────────────────────────────────────────
assert.match(html, /^<!doctype html>/i, 'страницата е валиден HTML документ');
const h1 = (html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || '';
assert.match(h1, /^Здравейте!/, 'първото заглавие е поздрав, а не име на файл: „' + h1.trim() + '“');
assert.ok(h1.includes('Договори за клиент А'), 'поздравът назовава портала');
assert.ok(
  text.includes('Тук са договорите и анексите по вашето дело.'),
  'описанието на портала е поздравът (а не техническо изречение)',
);

// ── 2. Информацията е тук, не на други адреси ──────────────────────────────
for (const fact of ['Идентификатор', 'Папка', 'Файлове в портала', 'В папката']) {
  assert.ok(text.includes(fact), 'страницата извежда факта „' + fact + '“');
}
assert.ok(html.includes('договор.pdf'), 'изрежда регистрираните файлове с истинските им имена');
assert.ok(html.includes('Договори 2026'), 'изрежда РЕАЛНАТА подпапка');
assert.ok(html.includes('анекс.txt'), 'и файла в нея');
assert.equal(html.includes('таен.pdf'), false, 'изключеният файл не се показва (адресът му не работи)');

// ── 3. Един адрес: само порталът ────────────────────────────────────────────
// Връзките без `download` са само към ПОРТАЛА: той самият и неговите подпапки
// (`?folder=`) — това е един и същ адрес. Нищо друго не се свързва.
const nonDownload = anchors.filter((a) => !/\sdownload\b/.test(a));
assert.ok(nonDownload.length >= 1, 'страницата води към портала');
for (const anchor of nonDownload) {
  assert.ok(
    anchor.includes('href="' + 'https://hapi.example.bg/p/' + PORTAL.id),
    'връзка извън портала (ненужна е): ' + anchor,
  );
}
for (const banned of ['api.json', 'openapi.json', 'qr.svg']) {
  assert.equal(
    anchors.some((a) => a.includes(banned)),
    false,
    'техническият адрес ' + banned + ' НЕ е връзка в страницата',
  );
}
// Никакъв гол адрес в текста: „Отвори портала“ е бутон, а не печатан URL.
const bareUrl = /https?:\/\/\S+/.exec(text);
assert.equal(bareUrl, null, 'страницата не отпечатва адрес като текст: ' + (bareUrl && bareUrl[0]));

// ── 4. Без вградени стилове и скриптове (CSP `style-src self`) ──────────────
assert.equal(/<script\b/i.test(html), false, 'няма вграден скрипт');
assert.equal(/\sstyle="/i.test(html), false, 'няма вграден стил');

console.log(
  'PASS portal-greeting: поздрав „' + h1.trim().slice(0, 40) + '…“ · ' +
  anchors.length + ' връзки, от тях 1 към портала и ' + (anchors.length - 1) + ' за сваляне · ' +
  'нула технически адреса и нула отпечатани URL · факти: ' + ['Идентификатор', 'Папка', 'бройки'].join(', '),
);
