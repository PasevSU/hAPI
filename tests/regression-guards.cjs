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
  'DEF-31': ['portal-qr-badge.cjs', 'qr-dispatch.cjs', 'portal-qr-levels.cjs'], // QR кодът е на едно място, но от 0.69.210 — код за ВСЯКО ниво, всеки към човешката страница
  'DEF-32': ['portal-tokens.cjs'], // подписът се издава веднъж
  'DEF-33': ['portal-card-link.cjs'], // адресът на портала е на едно място
  'DEF-34': ['portal-no-links.cjs', 'portal-page.cjs'], // страницата не показва QR към себе си
  'DEF-35': ['secret-panel.cjs', 'signed-url-restart.cjs'], // подписът не е страничен ефект на рисуването
  'DEF-36': ['files-manager.cjs', 'gui-sections.cjs'], // без видим и мъртъв бутон
  'DEF-37': ['ui-spacing.cjs'], // договорът за отстояния
  'DEF-38': ['ui-field-labels.cjs'], // етикетите се свързват с полетата след всеки рендер
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
  'DEF-55': ['process-guards.cjs', 'event-stream.cjs'], // спиране/старт под товар: грация ≥ 10 s и SIGKILL
  'DEF-56': ['blackbox-api.cjs'], // публичен /health не показва пътища и PID
  'DEF-57': ['problem.cjs', 'blackbox-api.cjs'], // грешката носи ok:false като успехът — ok:true
  'DEF-58': ['release-archive-ignored.cjs'], // архивът на изданието не взима игнорирани локални файлове
  'DEF-59': ['upload-sessions.cjs', 'gui-upload-progress.cjs', 'gui-upload-resume.cjs', 'gui-upload-folder.cjs'], // качването е сесия със сверка по хеш, а не една заявка
  'DEF-60': ['preview-unsafe-types.cjs', 'render-sinks-global.cjs'], // прегледът не рисува документи, които изпълняват скрипт
  'DEF-61': ['addon-image-pipeline.cjs'], // версията в config.yaml има образ — workflow-ът се пуска и на main
  'DEF-62': ['ui-inline-style-csp.cjs', 'gui-upload-progress.cjs'], // вграденият стил се блокира от style-src 'self'
  'DEF-63': ['portal-creation-contract.cjs', 'gui-portal-create-contract.cjs'], // договорът за адресите се издава при създаването
  'DEF-64': ['server-modules.cjs'], // server.js зарежда всички компоненти от server_module/
  'DEF-70': ['portal-creation-contract.cjs'], // договорът за прегледа носи СВОЙ подпис (частен портал)
  'DEF-68': ['server-modules.cjs', 'server-structure.cjs'], // бюджетът е облекчен: статичните файлове излязоха в компонент
  'DEF-71': ['docker-runtime.cjs', 'file-placement.cjs'], // динамичната папка влиза в проверките за образа и за require
  'DEF-72': ['server-modules.cjs'], // невалидно име в server_module/ спира старта
  'DEF-73': ['server-modules.cjs'], // компонент не поема /admin/api
  'DEF-74': ['core-modules.cjs'], // глобалните функции се зареждат по име и никой не заобикаля слоя
  'DEF-75': ['file-placement.cjs'], // динамичната папка трябва да има свой COPY ред в образа
  'DEF-65': ['logic-audit-fresh.cjs'], // отчетът на логическия одит се пише от гейта и не изостава
  'DEF-76': ['matrix-freshness.cjs', 'release-status.cjs'], // матрицата носи отпечатък и не се приема стара
  'DEF-77': ['addon-image-pipeline.cjs'], // CI ИЗПЪЛНЯВА образа, не само го строи
  'DEF-78': ['core-modules.cjs'], // API документът е глобална функция, един построител
  'DEF-79': ['server-modules.cjs', 'core-modules.cjs', 'docker-runtime.cjs'], // едно правило за име на файл
  'DEF-80': ['integrity-startup.cjs'], // глобалният слой е в сверката за цялост
  'DEF-81': ['core-modules.cjs'], // qrRender е задължителен и няма резервен път
  'DEF-82': ['matrix-freshness.cjs', 'release-status.cjs'], // SKIP не се брои за успех
  'DEF-83': ['core-modules.cjs'], // landingPath се ползва, не е мъртъв код
  'DEF-84': ['html-headers.cjs'], // всеки HTML отговор носи Referrer-Policy
  'DEF-85': ['addon-translations.cjs'], // опциите се превеждат на трите езика
  'DEF-86': ['evidence-portal-qr.cjs'], // копието на QR енкодера е точно копие
  'DEF-87': ['static-cache.cjs'], // статиката е immutable само с версия в адреса, нищо не е `public`
  'DEF-88': ['static-etag.cjs'], // тялото живее в паметта, а ETag дава 304 без тяло
  'DEF-89': ['option-secrets.cjs'], // тайните опции се прикриват в лога и по име на променлива
  'DEF-90': ['option-effects.cjs'], // опция „само при първи старт“ не се описва като мъртва
  'DEF-91': ['folder-delete.cjs', 'portal-card-link.cjs'], // кодът на ниво носи подписа, иначе е счупена картинка
  'DEF-92': ['dom-harness.cjs', 'gui-journeys.cjs'], // тестовият DOM: isConnected и твърдения без възли
  'DEF-93': ['ui-portal-functions.cjs'], // панелът показва броя от присъдата, не от lowercase ключове
  'DEF-94': ['check-log-integration.cjs', 'verify-verdict.cjs'], // провал на проверка не изчезва от журнала
};
// ── Котви: конкретният текст, който би изчезнал при връщане на дефекта ────────
// Без тях „има тест“ може да значи „има файл с име, което звучи правилно“.
// Правило за нова котва: низът трябва да е ЧАСТ ОТ ПРАВИЛОТО (заглавка, име на артефакт,
// име на поле, ключова дума), а не обикновена дума — иначе котвата не изчезва при връщане.
const ANCHORS = {
  'DEF-02': { file: 'analysis-claims.cjs', contains: 'проектната папка' },
  'DEF-03': { file: 'portal-hash-verify.cjs', contains: 'sha256Hex' },
  'DEF-04': { file: 'cms-panel.cjs', contains: 'договор.p7s' },
  'DEF-05': { file: 'report-manifest.cjs', contains: 'sha512' },
  'DEF-07': { file: 'qr-leads-to-folder.cjs', contains: 'qrTarget' },
  'DEF-08': { file: 'portal-folder-artifacts.cjs', contains: 'portal.html' },
  'DEF-09': { file: 'secret-links.cjs', contains: 'expired' },
  'DEF-10': { file: 'instance-lock-retry.cjs', contains: 'EBUSY' },
  'DEF-11': { file: 'retention-audit-lines.cjs', contains: 'undated' },
  'DEF-12': { file: 'core-store.cjs', contains: 'groupId' },
  'DEF-13': { file: 'core-store.cjs', contains: 'неразбираемо число е грешка на входа' },
  'DEF-14': { file: 'core-store.cjs', contains: 'created_at' },
  'DEF-15': { file: 'download-stream.cjs', contains: "'accept-ranges'" },
  'DEF-16': { file: 'analysis-claims.cjs', contains: 'измер' },
  'DEF-17': { file: 'files-manager.cjs', contains: 'Създай и генерирай API' },
  'DEF-18': { file: 'files-manager.cjs', contains: 'folder-files' },
  'DEF-19': { file: 'api-generation.cjs', contains: 'openapi' },
  'DEF-20': { file: 'portal-page-render.cjs', contains: 'id="hapi-boot"' },
  'DEF-21': { file: 'gui-open-portal-link.cjs', contains: 'openPortal' },
  'DEF-22': { file: 'gui-csp-guard.cjs', contains: 'Content-Security-Policy' },
  'DEF-23': { file: 'ha-portal-folder-page.cjs', contains: '/api/v1/p/' },
  'DEF-24': { file: 'files-manager.cjs', contains: 'data-close-portal' },
  'DEF-25': { file: 'pgp-path-encryption.cjs', contains: 'sealed' },
  'DEF-26': { file: 'portal-folder-button.cjs', contains: '#folder-open' },
  'DEF-28': { file: 'ui-i18n.cjs', contains: 'DICT' },
  'DEF-29': { file: 'ui-skin.cjs', contains: 'aria-pressed' },
  'DEF-30': { file: 'portal-page-render.cjs', contains: 'посетител' },
  'DEF-31': { file: 'portal-qr-levels.cjs', contains: 'ПУБЛИЧНАТА страница, не API-то' },
  'DEF-32': { file: 'portal-tokens.cjs', contains: 'еднократ' },
  'DEF-33': { file: 'portal-card-link.cjs', contains: 'openQrStudio' },
  'DEF-34': { file: 'portal-page.cjs', contains: 'qr-panel' },
  'DEF-35': { file: 'signed-url-restart.cjs', contains: 'restart' },
  'DEF-36': { file: 'gui-sections.cjs', contains: 'data-action' },
  'DEF-37': { file: 'ui-spacing.cjs', contains: 'LIMIT_SPACING' },
  'DEF-38': { file: 'ui-field-labels.cjs', contains: 'HapiFieldLabels' },
  'DEF-39': { file: 'runtime-config.cjs', contains: 'catalog.json' },
  'DEF-40': { file: 'api-input-errors.cjs', contains: 'RFC 9457' },
  'DEF-41': { file: 'api-robustness.cjs', contains: 'колекция' },
  'DEF-42': { file: 'ha-version-sensor.cjs', contains: 'сензора за версия' },
  'DEF-43': { file: 'pgp-keyflags.cjs', contains: 'keyflags' },
  'DEF-44': { file: 'storage-check.cjs', contains: 'STORAGE' },
  'DEF-45': { file: 'ui-shell-nav.cjs', contains: 'aria-controls' },
  'DEF-46': { file: 'pgp-workdir-encryption.cjs', contains: 'workdir' },
  'DEF-47': { file: 'ui-block-aria.cjs', contains: 'aria-controls' },
  'DEF-48': { file: 'ui-spacing.cjs', contains: 'LIMIT_RADII' },
  'DEF-50': { file: 'sse-ticket.cjs', contains: 'ticket' },
  'DEF-51': { file: 'live-stream-lifecycle.cjs', contains: 'EventSource' },
  'DEF-52': { file: 'ui-folder-note-race.cjs', contains: 'бележка' },
  'DEF-53': { file: 'storage-roots.cjs', contains: 'нито един тест не строи' },
  'DEF-54': { file: 'storage-roots.cjs', contains: 'paths.existingRoot' },
  'DEF-55': { file: 'process-guards.cjs', contains: 'DEF-55' },
  'DEF-56': { file: 'blackbox-api.cjs', contains: 'не показва файлови пътища' },
  'DEF-57': { file: 'problem.cjs', contains: 'като успехът носи' },
  'DEF-58': { file: 'release-archive-ignored.cjs', contains: 'нито един не влиза в изданието' },
  'DEF-59': { file: 'upload-sessions.cjs', contains: 'X-Chunk-Sha256' },
  'DEF-60': { file: 'render-sinks-global.cjs', contains: 'SAFE_FRAME' },
  'DEF-61': { file: 'addon-image-pipeline.cjs', contains: 'branches: [main]' },
  'DEF-62': { file: 'ui-inline-style-csp.cjs', contains: '::-webkit-progress-value' },
  'DEF-63': { file: 'gui-portal-create-contract.cjs', contains: 'qs-link-row' },
  'DEF-64': { file: 'server-modules.cjs', contains: 'server_module' },
  'DEF-70': { file: 'portal-creation-contract.cjs', contains: 'sigOf' },
  'DEF-65': { file: 'logic-audit-fresh.cjs', contains: 'if (save || gate)' },
  'DEF-74': { file: 'core-modules.cjs', contains: 'core_module' },
  'DEF-75': { file: 'file-placement.cjs', contains: 'Dockerfile не копира папката' },
  'DEF-76': { file: 'matrix-freshness.cjs', contains: 'treeHash' },
  'DEF-77': { file: 'addon-image-pipeline.cjs', contains: 'docker run --rm' },
  'DEF-78': { file: 'core-modules.cjs', contains: 'api-docs' },
  'DEF-79': { file: 'core-modules.cjs', contains: 'module-folder' },
  'DEF-80': { file: 'integrity-startup.cjs', contains: 'core_module/qr.js' },
  'DEF-81': { file: 'core-modules.cjs', contains: 'qrRender' },
  'DEF-82': { file: 'matrix-freshness.cjs', contains: 'skippedByEnv' },
  'DEF-83': { file: 'core-modules.cjs', contains: 'landingPath(' },
  'DEF-84': { file: 'html-headers.cjs', contains: 'Referrer-Policy: no-referrer' },
  'DEF-85': { file: 'addon-translations.cjs', contains: 'de.yaml' },
  'DEF-86': { file: 'evidence-portal-qr.cjs', contains: 'evidence-portal' },
  'DEF-87': { file: 'static-cache.cjs', contains: 'immutable' },
  'DEF-88': { file: 'static-etag.cjs', contains: 'If-None-Match' },
  'DEF-89': { file: 'option-secrets.cjs', contains: 'тайна опция не се прикрива в лога' },
  'DEF-90': { file: 'option-effects.cjs', contains: 'не твърди, че кодът не го чете' },
  'DEF-91': { file: 'folder-delete.cjs', contains: 'подписът влиза и в адреса на кода' },
  'DEF-92': { file: 'dom-harness.cjs', contains: 'твърденията не получават възел' },
  'DEF-93': { file: 'ui-portal-functions.cjs', contains: 'проблемни 1' },
  'DEF-94': { file: 'check-log-integration.cjs', contains: 'verdict.failed' },
};

/** Редовете на регистъра: `| DEF-xx | област | описание | тежест | състояние |`. */
function registry() {
  const rows = new Map();
  for (const line of [
  read('documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md'),
  read('documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS_ARCHIVE.md'),
].join('\n').split(/\r?\n/)) {
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
// Приемат се и трите работещи форми на проверка: `assert.` (метод), `assert(` (самият
// `node:assert` е извикваем) и собствени хвърлящи помощници (`need(`, `check(`). Дотук се
// търсеше само `assert.` — затова `ha-compatibility.cjs` (33 проверки през `need`) и
// `policy-gui.cjs` (`assert(...)`) бяха „празни обвивки“ по определение и не можеха да пазят
// нито един дефект, макар да проверяват. Формата на проверката не е свойството, което пази.
const hollow = [];
for (const [id, files] of Object.entries(GUARDS)) {
  for (const file of files) {
    const code = fs.readFileSync(path.join(TESTS, file), 'utf8');
    if (!/assert[.(]|\bneed\(|\bcheck\(/.test(code)) hollow.push(`${id} → ${file}`);
  }
}
assert.deepEqual(hollow, [], 'тези защити нямат нито една проверка (`assert`, `need` или `check`): ' + hollow.join(', '));

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
