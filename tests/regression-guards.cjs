'use strict';
// РЕГРЕСИОННИ ЗАЩИТИ: всеки ЗАТВОРЕН дефект трябва да има тест, който пада, ако проблемът се
// върне — и този тест трябва наистина да върви в матрицата.
//
// Защо съществува: регистърът (`documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md`) описва
// 50+ затворени дефекта, но до 0.69.208 само 15 от редовете сочеха тест. Дефект, „затворен“ без
// проверка, се връща тихо: точно това се случи с `path.resolve('/share')` (DEF-54) — поправян
// беше и преди, но нищо не пазеше поправката.
//
// Проверки:
//   1. всеки ред със статус „Затворен“ има поне един тест в `GUARDS`;
//   2. всеки посочен тест съществува и е част от матрицата (`tests/*.cjs`, не `helpers.cjs`);
//   3. всеки посочен тест наистина проверява нещо (`assert` в кода), а не е празна обвивка;
//   4. за котвите в `ANCHORS` — конкретният текст/праг, който би изчезнал при връщане на дефекта;
//   5. няма защита за несъществуващ дефект (иначе картата се разминава с регистъра).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const TESTS = path.join(root, 'tests');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── Картата защита: дефект → тестовете, които биха паднали при връщане ─────────
const GUARDS = {
  'DEF-02': ['analysis-claims.cjs'], // печатна грешка в име на папка — пази се от проверката на твърденията
  'DEF-03': ['portal-hash-verify.cjs'], // сверка на SHA-256 в браузъра
  'DEF-04': ['tsa-client.cjs', 'rfc3161-api.cjs', 'cms-panel.cjs'], // RFC 3161 + PKCS#7
  'DEF-05': ['report-manifest.cjs', 'report-manifests.cjs'], // SHA-512 в манифеста
  'DEF-07': ['qr-leads-to-folder.cjs', 'portal-api-qr.cjs'], // QR на папката води до страницата, не до JSON
  'DEF-08': ['portal-folder-artifacts.cjs', 'portal-folder.cjs'], // portal.html изрежда РЕАЛНАТА папка
  'DEF-09': ['secret-links.cjs', 'secret-lock.cjs'], // sweep не трие нещо, което не е прочело
  'DEF-10': ['instance-lock-retry.cjs', 'instance-lock.cjs'], // повторен опит при rename
  'DEF-11': ['retention-audit-lines.cjs', 'retention-audit.cjs'], // еднакъв съд за недатируемите редове
  'DEF-12': ['core-store.cjs', 'store-accessors.cjs'], // ключ на променлива с група
  'DEF-13': ['core-store.cjs'], // разчитане на числа без „една замяна“
  'DEF-14': ['core-store.cjs'], // rekey не мести created_at
  'DEF-15': ['download-stream.cjs'], // заглавки след като файлът е отворен
  'DEF-16': ['analysis-claims.cjs'], // числа в документ, които не са измерени
  'DEF-17': ['files-manager.cjs'], // панелът на чиста инсталация
  'DEF-18': ['files-manager.cjs', 'portal-folder-refs.cjs'], // брояч на качването от папка
  'DEF-19': ['api-generation.cjs', 'portal-api-map.cjs'], // generateApi чете същите препратки
  'DEF-20': ['portal-page.cjs', 'portal-page-render.cjs'], // страницата не заковава на „Зареждане…“
  'DEF-21': ['gui-open-portal-link.cjs'], // менюто на API-то тегли от жив адрес
  'DEF-22': ['gui-csp-guard.cjs', 'gui-csp-same-origin.cjs'], // панелът се тества с истинска CSP
  'DEF-23': ['ha-portal-folder-page.cjs', 'portal-page-contract.cjs'], // адресите на портала не са 404
  'DEF-24': ['gui-only-guard.cjs', 'files-manager.cjs'], // порталът се закрива от интерфейса
  'DEF-25': ['pgp-path-encryption.cjs', 'pgp-workdir-encryption.cjs'], // без ключ → ясна грешка, не тихо
  'DEF-26': ['portal-folder-button.cjs'], // до QR кода се стига с едно действие
  'DEF-27': ['portal-folder-portal.cjs', 'portal-monitoring.cjs'], // сензорите се теглят веднъж
  'DEF-28': ['portal-i18n.cjs', 'ui-i18n.cjs'], // панелът е преведен
  'DEF-29': ['layout.cjs', 'ui-skin.cjs'], // картата не е разпръсната на три реда
  'DEF-30': ['portal-page-render.cjs', 'portal-page-lang.cjs'], // страницата е за посетителя, не за нас
  'DEF-31': ['portal-qr-badge.cjs', 'qr-dispatch.cjs'], // QR кодът е на едно място
  'DEF-32': ['portal-tokens.cjs'], // подписът се издава веднъж
  'DEF-33': ['portal-card-link.cjs'], // адресът на портала е на едно място
  'DEF-34': ['portal-no-links.cjs'], // страницата не показва QR към себе си
  'DEF-35': ['secret-panel.cjs', 'signed-url-restart.cjs'], // подписът не е страничен ефект на рисуването
  'DEF-36': ['files-manager.cjs', 'gui-sections.cjs'], // без видим и мъртъв бутон
  'DEF-37': ['ui-spacing.cjs'], // договорът за отстояния
  'DEF-39': ['runtime-config.cjs', 'data-settings.cjs'], // частичен запис не връща съседните полета
  'DEF-40': ['api-input-errors.cjs'], // тяло `null` не е 500
  'DEF-41': ['cases.cjs', 'api-robustness.cjs'], // липсваща колекция не е 500
  'DEF-42': ['ha-version-sensor.cjs'], // сензорът за версия се създава
  'DEF-43': ['pgp-unknown-subkey.cjs', 'pgp-keyflags.cjs'], // подключ с алгоритъм 36
  'DEF-44': ['storage-default-location.cjs', 'storage-check.cjs'], // политиката на пътищата
  'DEF-45': ['portal-folder-button.cjs', 'ui-shell-nav.cjs'], // картата не започва с отделен блок
  'DEF-46': ['pgp-path-encryption.cjs', 'pgp-workdir-encryption.cjs'], // опциите на инстанцията се прилагат
  'DEF-47': ['ui-block-aria.cjs', 'release-notes.cjs'], // твърдения в CHANGELOG, пазени от тест
  'DEF-48': ['ui-spacing.cjs', 'format-scope.cjs'], // правилата за оформление
  'DEF-50': ['sse-ticket.cjs', 'event-stream.cjs'], // токенът не влиза в адрес
  'DEF-51': ['live-stream-lifecycle.cjs'], // потокът се възстановява сам
  'DEF-52': ['ui-folder-note-race.cjs'], // бележката не изчезва при състезание
  'DEF-53': ['storage-roots.cjs', 'gui-journeys.cjs'], // флейкът от натрупани папки
  'DEF-54': ['storage-roots.cjs'], // логическите корени — един източник, без папка в корена на диска
};

// ── Котви: конкретният текст, който би изчезнал при връщане на дефекта ────────
// Без тях „има тест“ може да значи „има файл с име, което звучи правилно“.
const ANCHORS = {
  'DEF-03': { file: 'portal-hash-verify.cjs', contains: 'sha256Hex' },
  'DEF-07': { file: 'qr-leads-to-folder.cjs', contains: 'qrTarget' },
  'DEF-15': { file: 'download-stream.cjs', contains: "'accept-ranges'" },
  'DEF-37': { file: 'ui-spacing.cjs', contains: 'LIMIT_SPACING' },
  'DEF-48': { file: 'ui-spacing.cjs', contains: 'LIMIT_RADII' },
  'DEF-50': { file: 'sse-ticket.cjs', contains: 'ticket' },
  'DEF-53': { file: 'storage-roots.cjs', contains: 'нито един тест не строи' },
  'DEF-54': { file: 'storage-roots.cjs', contains: 'paths.existingRoot' },
};

/** Редовете на регистъра: `| DEF-xx | област | описание | тежест | състояние |`. */
function registry() {
  const rows = new Map();
  for (const line of read('documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md').split(/\r?\n/)) {
    if (!/^\|\s*DEF-\d+\s*\|/.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    rows.set(cells[1], { area: cells[2], description: cells[3], severity: cells[4], status: cells[5] });
  }
  return rows;
}

/** Тестовете, които матрицата действително пуска (без `helpers.cjs` и без `lib/`). */
function matrixTests() {
  return new Set(
    fs.readdirSync(TESTS, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.cjs$/.test(e.name) && e.name !== 'helpers.cjs')
      .map((e) => e.name),
  );
}

const rows = registry();
assert.ok(rows.size >= 50, 'регистърът не се чете правилно: ' + rows.size + ' реда');

const closed = [...rows.entries()].filter(([, r]) => /^Затворен/.test(r.status)).map(([id]) => id);
assert.ok(closed.length >= 40, 'затворените редове са необичайно малко: ' + closed.length);

const running = matrixTests();

// 1. Всеки затворен дефект има защита.
const unguarded = closed.filter((id) => !(GUARDS[id] && GUARDS[id].length));
assert.deepEqual(unguarded, [], 'затворени дефекти БЕЗ регресионна защита (добави тест в GUARDS): ' + unguarded.join(', '));

// 2. Защитата сочи съществуващ тест, който матрицата пуска.
const broken = [];
for (const [id, files] of Object.entries(GUARDS)) {
  for (const file of files) {
    if (!running.has(file)) broken.push(`${id} → ${file} (няма такъв тест в матрицата)`);
  }
}
assert.deepEqual(broken, [], 'защитите сочат тестове, които не съществуват или не се пускат:\n  ' + broken.join('\n  '));

// 3. Защитата наистина проверява нещо.
const hollow = [];
for (const [id, files] of Object.entries(GUARDS)) {
  for (const file of files) {
    const code = fs.readFileSync(path.join(TESTS, file), 'utf8');
    if (!/assert\./.test(code)) hollow.push(`${id} → ${file}`);
  }
}
assert.deepEqual(hollow, [], 'тези защити нямат нито едно `assert` (празна обвивка): ' + hollow.join(', '));

// 4. Котвите: конкретният текст е на място.
for (const [id, anchor] of Object.entries(ANCHORS)) {
  const code = fs.readFileSync(path.join(TESTS, anchor.file), 'utf8');
  assert.equal(code.includes(anchor.contains), true, `${id}: в ${anchor.file} липсва „${anchor.contains}“ — котвата на защитата е изчезнала`);
  assert.equal(GUARDS[id].includes(anchor.file), true, `${id}: котвата е в ${anchor.file}, но файлът не е в GUARDS`);
}

// 5. Няма защита за дефект, който не съществува в регистъра.
const unknown = Object.keys(GUARDS).filter((id) => !rows.has(id));
assert.deepEqual(unknown, [], 'картата на защитите сочи несъществуващи дефекти: ' + unknown.join(', '));

// Допълнително: затворен дефект, който сам сочи тест в текста си, трябва да сочи съществуващ файл.
const danglingRefs = [];
for (const [id, r] of rows.entries()) {
  for (const m of r.description.matchAll(/`(tests\/[a-z0-9-]+\.cjs)`/g)) {
    if (!running.has(path.basename(m[1]))) danglingRefs.push(`${id} → ${m[1]}`);
  }
}
assert.deepEqual(danglingRefs, [], 'редове в регистъра сочат тест, който не съществува: ' + danglingRefs.join(', '));

console.log(
  `PASS regression-guards: ${closed.length} затворени дефекта · ${Object.keys(GUARDS).length} защити · ` +
    `${new Set(Object.values(GUARDS).flat()).size} различни теста · ${Object.keys(ANCHORS).length} котви`,
);
