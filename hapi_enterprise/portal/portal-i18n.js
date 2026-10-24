'use strict';
// Речник на ПУБЛИЧНАТА страница на портала (BG / EN / DE).
//
// Защо отделен файл: страницата се вижда от външни хора (сканиран QR код), а панелът
// отдавна е на три езика. Държим речника на едно място, за да не се разминават
// текстовете и за да може тестът да провери, че НЯМА ключ без превод.
//
// Правила:
//   • `{име}` е заместител; `{n}` е числото, за което се избира форма на съществителното;
//   • българският е по подразбиране и е пълният (страницата работи и без JS);
//   • никой текст не се сглобява от парчета в кода — така преводът не се чупи.
(function () {
  const LANGS = ['bg', 'en', 'de'];
  const DEFAULT_LANG = 'bg';
  const LANG_NAMES = { bg: 'Български', en: 'English', de: 'Deutsch' };
  const LOCALES = { bg: 'bg-BG', en: 'en-GB', de: 'de-DE' };

  // Съществителни по вид артефакт. `one`/`many` са за „1 файл“ / „3 файла“,
  // `capMany` — за заглавие, `for` — след предлог („Портал за документи“).
  const NOUNS = {
    bg: {
      file: { one: 'файл', many: 'файла', capMany: 'Файлове', for: 'файлове' },
      doc: { one: 'документ', many: 'документа', capMany: 'Документи', for: 'документи' },
      image: { one: 'снимка', many: 'снимки', capMany: 'Снимки', for: 'снимки' },
      media: { one: 'медиен файл', many: 'медийни файла', capMany: 'Медия', for: 'медия' },
      archive: { one: 'архив', many: 'архива', capMany: 'Архиви', for: 'архиви' },
      mixed: { one: 'файл', many: 'файла', capMany: 'Документи и снимки', for: 'документи и снимки' },
    },
    en: {
      file: { one: 'file', many: 'files', capMany: 'Files', for: 'files' },
      doc: { one: 'document', many: 'documents', capMany: 'Documents', for: 'documents' },
      image: { one: 'image', many: 'images', capMany: 'Images', for: 'images' },
      media: { one: 'media file', many: 'media files', capMany: 'Media', for: 'media' },
      archive: { one: 'archive', many: 'archives', capMany: 'Archives', for: 'archives' },
      mixed: { one: 'file', many: 'files', capMany: 'Documents and images', for: 'documents and images' },
    },
    de: {
      file: { one: 'Datei', many: 'Dateien', capMany: 'Dateien', for: 'Dateien' },
      doc: { one: 'Dokument', many: 'Dokumente', capMany: 'Dokumente', for: 'Dokumente' },
      image: { one: 'Bild', many: 'Bilder', capMany: 'Bilder', for: 'Bilder' },
      media: { one: 'Mediendatei', many: 'Mediendateien', capMany: 'Medien', for: 'Medien' },
      archive: { one: 'Archiv', many: 'Archive', capMany: 'Archive', for: 'Archive' },
      mixed: { one: 'Datei', many: 'Dateien', capMany: 'Dokumente und Bilder', for: 'Dokumente und Bilder' },
    },
  };

  const DICT = {
    bg: {
      'lang.label': 'Език',
      'doc.title': 'Портал за документи',
      'doc.loading': 'Зареждане…',
      'doc.unavailable': 'Порталът не е достъпен',
      'nav.skip.files': 'Към {what}',
      'nav.skip.content': 'Към съдържанието',
      'header.categories': 'Категории',
      'header.portalId': 'Идентификатор на портала',
      'header.copyId': 'Копирай',
      'header.copyId.title': 'Копирай идентификатора',
      'header.copyId.ok': 'Идентификаторът на портала е копиран.',
      'header.copyLink': 'Копирай адреса',
      'header.copyLink.ok': 'Адресът на портала е копиран.',
      'header.api': 'API',
      'header.manifest': 'Манифест',
      'visibility.for': 'Портал за {what}',
      'visibility.public': 'Публичен портал',
      'visibility.private': 'Портал с ограничен достъп',
      'summary.title': 'Какво съдържа този портал',
      'summary.empty': 'Този портал е {what} и още не съдържа файлове.',
      'summary.one': 'Този портал съдържа 1 {what} с общ обем {size}.',
      'summary.many': 'Този портал е цялостен набор от {n} {what} с общ обем {size}.',
      'summary.kinds': ' Вид: {kinds}.',
      'summary.allDisabled': ' Изтеглянето на всички файлове е спряно от издателя.',
      'summary.hasKey': ' Файловете с ключ се отварят само с ключа, издаден от издателя.',
      'summary.chip.files': 'Файлове: {n}',
      'summary.chip.bytes': 'Общ обем: {size}',
      'summary.chip.kinds': 'Вид: {kinds}',
      'summary.chip.updated': 'Обновено на: {date}',
      'summary.chip.access': 'Достъп: {access}',
      'access.public': 'публичен',
      'access.private': 'само с ключ',
      'files.title': 'Файлове',
      'files.title.other': 'Съдържание',
      'files.search.placeholder.tags': 'Търси по име, тема, категория или етикет',
      'files.search.placeholder.tax': 'Търси по име, тема или категория',
      'files.search.placeholder.plain': 'Търси по име',
      'files.empty.filtered': 'Няма {what}, отговарящи на търсенето.',
      'files.empty.public': 'Порталът е публичен, но издателят още не е публикувал файлове.',
      'files.empty.private': 'Издателят още не е публикувал файлове в този портал.',
      'folder.title': 'Папка {path}',
      'folder.empty': 'Тази папка е празна.',
      'files.count.of': 'от',
      'files.more': 'Показани са първите {shown} от {total} {what} — използвай търсенето или API-то за останалите.',
      'file.sha.label': 'SHA-256 {short}',
      'file.sha.title': 'SHA-256: {full}',
      'file.sha.copy': 'Копирай пълния SHA-256',
      'file.sha.copyFor': 'Копирай SHA-256 за {name}',
      'file.sha.copied': 'SHA-256 е копиран.',
      'file.link.label': 'Адрес за изтегляне',
      'file.link.labelKey': 'Адрес за изтегляне (с ключ)',
      'file.link.copy': 'Копирай адреса за изтегляне',
      'file.link.copyFor': 'Копирай адреса за изтегляне на {name}',
      'file.link.copied': 'Адресът за изтегляне е копиран.',
      'file.download': ' Изтегли',
      'file.download.key': ' Изтегли с ключ',
      'file.key.placeholder': 'Ключ за файла',
      'file.key.aria': 'Ключ за {name}',
      'file.disabled': 'Изтеглянето е забранено от издателя',
      'file.meta.key': 'нужен е ключ',
      'file.meta.encrypted': 'шифрован',
      'file.status.downloading': 'Изтегляне на „{name}“…',
      'file.status.badKey': 'Невалиден или изтекъл ключ за този файл.',
      'file.status.needKey': 'Нужен е ключ за този файл.',
      'file.status.http': 'Изтеглянето не бе успешно (HTTP {status}).',
      'file.status.missing': 'Файлът не е намерен в папката ({name}).',
      'file.status.started': 'Изтеглянето започна: {name}',
      'file.status.offline': 'Няма връзка със сървъра на портала.',
      'copy.ok': 'Копирано.',
      'copy.blocked': 'Копирането не е позволено от браузъра.',
      'qr.title': 'QR код на портала',
      'qr.alt': 'QR код към този портал',
      'qr.hint.public': 'Сканирай кода, за да отвориш портала на друго устройство.',
      'qr.hint.private': 'Сканирай кода или сподели адреса — за този портал е нужен ключ от издателя.',
      'qr.note.allHash': 'Всеки файл носи SHA-256 отпечатък — сверявай го след изтегляне.',
      'qr.note.someHash': 'Показаните отпечатъци са SHA-256 — сверявай ги след изтегляне.',
      'qr.note.hasKey': 'Файловете с ключ се отварят само с ключа, издаден от издателя.',
      'qr.note.allDisabled': 'Издателят е спрял изтеглянето на всички файлове в портала.',
      'footer.served': 'Порталът се обслужва от ',
      'footer.updated': 'обновено на {date}',
      'footer.owner': 'съдържанието е собственост на издателя',
      'package.button': 'Изтегли всички (ZIP)',
      'package.working': 'Приготвям пакета…',
      'package.error': 'Пакетът не може да се създаде.',
      'package.ready': 'Линкът е еднократен и важи до {when}.',
      'package.ready.noTime': 'Линкът е еднократен и важи няколко минути.',
      'package.skipped': ' В пакета не влизат {n} {what} (с ключ или забранени) — те са изброени в манифеста.',
      'package.starting': ' Свалянето започва…',
      'error.noPortal': 'Липсва портал в адреса.',
      'error.portal': 'Порталът не е наличен или достъпът изисква ключ.',
      'error.files': 'Списъкът с файлове не е достъпен.',
      'badge.public': 'Публичен',
      'flag.info': 'информация',
      'flag.important': 'важно',
      'flag.urgent': 'спешно',
      'flag.archive': 'архив',
    },
    en: {
      'lang.label': 'Language',
      'doc.title': 'Document portal',
      'doc.loading': 'Loading…',
      'doc.unavailable': 'The portal is not available',
      'nav.skip.files': 'Skip to {what}',
      'nav.skip.content': 'Skip to content',
      'header.categories': 'Categories',
      'header.portalId': 'Portal identifier',
      'header.copyId': 'Copy',
      'header.copyId.title': 'Copy the identifier',
      'header.copyId.ok': 'Portal identifier copied.',
      'header.copyLink': 'Copy address',
      'header.copyLink.ok': 'Portal address copied.',
      'header.api': 'API',
      'header.manifest': 'Manifest',
      'visibility.for': 'Portal for {what}',
      'visibility.public': 'Public portal',
      'visibility.private': 'Restricted portal',
      'summary.title': 'What this portal contains',
      'summary.empty': 'This portal is {what} and does not contain files yet.',
      'summary.one': 'This portal contains 1 {what} with a total size of {size}.',
      'summary.many': 'This portal is a complete set of {n} {what} with a total size of {size}.',
      'summary.kinds': ' Types: {kinds}.',
      'summary.allDisabled': ' The publisher has disabled downloads for all files.',
      'summary.hasKey': ' Files that require a key open only with the key issued by the publisher.',
      'summary.chip.files': 'Files: {n}',
      'summary.chip.bytes': 'Total size: {size}',
      'summary.chip.kinds': 'Types: {kinds}',
      'summary.chip.updated': 'Updated on: {date}',
      'summary.chip.access': 'Access: {access}',
      'access.public': 'public',
      'access.private': 'key required',
      'files.title': 'Files',
      'files.title.other': 'Contents',
      'files.search.placeholder.tags': 'Search by name, topic, category or tag',
      'files.search.placeholder.tax': 'Search by name, topic or category',
      'files.search.placeholder.plain': 'Search by name',
      'files.empty.filtered': 'No {what} match the search.',
      'files.empty.public': 'The portal is public, but the publisher has not published files yet.',
      'files.empty.private': 'The publisher has not published files in this portal yet.',
      'folder.title': 'Folder {path}',
      'folder.empty': 'This folder is empty.',
      'files.count.of': 'of',
      'files.more': 'Showing the first {shown} of {total} {what} — use the search or the API for the rest.',
      'file.sha.label': 'SHA-256 {short}',
      'file.sha.title': 'SHA-256: {full}',
      'file.sha.copy': 'Copy the full SHA-256',
      'file.sha.copyFor': 'Copy SHA-256 for {name}',
      'file.sha.copied': 'SHA-256 copied.',
      'file.link.label': 'Download address',
      'file.link.labelKey': 'Download address (with key)',
      'file.link.copy': 'Copy the download address',
      'file.link.copyFor': 'Copy the download address of {name}',
      'file.link.copied': 'Download address copied.',
      'file.download': ' Download',
      'file.download.key': ' Download with key',
      'file.key.placeholder': 'File key',
      'file.key.aria': 'Key for {name}',
      'file.disabled': 'Downloads are disabled by the publisher',
      'file.meta.key': 'key required',
      'file.meta.encrypted': 'encrypted',
      'file.status.downloading': 'Downloading “{name}”…',
      'file.status.badKey': 'Invalid or expired key for this file.',
      'file.status.needKey': 'A key is required for this file.',
      'file.status.http': 'The download failed (HTTP {status}).',
      'file.status.missing': 'The file is not in the folder ({name}).',
      'file.status.started': 'Download started: {name}',
      'file.status.offline': 'No connection to the portal server.',
      'copy.ok': 'Copied.',
      'copy.blocked': 'The browser does not allow copying.',
      'qr.title': 'Portal QR code',
      'qr.alt': 'QR code for this portal',
      'qr.hint.public': 'Scan the code to open the portal on another device.',
      'qr.hint.private': 'Scan the code or share the address — this portal needs a key from the publisher.',
      'qr.note.allHash': 'Every file carries a SHA-256 fingerprint — verify it after download.',
      'qr.note.someHash': 'The fingerprints shown are SHA-256 — verify them after download.',
      'qr.note.hasKey': 'Files that require a key open only with the key issued by the publisher.',
      'qr.note.allDisabled': 'The publisher has disabled downloads for all files in the portal.',
      'footer.served': 'Served by ',
      'footer.updated': 'updated on {date}',
      'footer.owner': 'content is owned by the publisher',
      'package.button': 'Download all (ZIP)',
      'package.working': 'Preparing the package…',
      'package.error': 'The package cannot be created.',
      'package.ready': 'The link works once and is valid until {when}.',
      'package.ready.noTime': 'The link works once and is valid for a few minutes.',
      'package.skipped': ' The package leaves out {n} {what} (key required or disabled) — they are listed in the manifest.',
      'package.starting': ' The download starts now…',
      'error.noPortal': 'No portal in the address.',
      'error.portal': 'The portal is not available or access requires a key.',
      'error.files': 'The file list is not available.',
      'badge.public': 'Public',
      'flag.info': 'information',
      'flag.important': 'important',
      'flag.urgent': 'urgent',
      'flag.archive': 'archive',
    },
    de: {
      'lang.label': 'Sprache',
      'doc.title': 'Dokumentenportal',
      'doc.loading': 'Wird geladen…',
      'doc.unavailable': 'Das Portal ist nicht erreichbar',
      'nav.skip.files': 'Zu den {what} springen',
      'nav.skip.content': 'Zum Inhalt springen',
      'header.categories': 'Kategorien',
      'header.portalId': 'Portal-Kennung',
      'header.copyId': 'Kopieren',
      'header.copyId.title': 'Kennung kopieren',
      'header.copyId.ok': 'Portal-Kennung kopiert.',
      'header.copyLink': 'Adresse kopieren',
      'header.copyLink.ok': 'Portaladresse kopiert.',
      'header.api': 'API',
      'header.manifest': 'Manifest',
      'visibility.for': 'Portal für {what}',
      'visibility.public': 'Öffentliches Portal',
      'visibility.private': 'Portal mit beschränktem Zugang',
      'summary.title': 'Was dieses Portal enthält',
      'summary.empty': 'Dieses Portal ist {what} und enthält noch keine Dateien.',
      'summary.one': 'Dieses Portal enthält 1 {what} mit einer Gesamtgröße von {size}.',
      'summary.many': 'Dieses Portal ist ein vollständiger Satz von {n} {what} mit einer Gesamtgröße von {size}.',
      'summary.kinds': ' Arten: {kinds}.',
      'summary.allDisabled': ' Der Herausgeber hat den Download aller Dateien gesperrt.',
      'summary.hasKey': ' Dateien mit Schlüssel öffnen nur mit dem vom Herausgeber ausgegebenen Schlüssel.',
      'summary.chip.files': 'Dateien: {n}',
      'summary.chip.bytes': 'Gesamtgröße: {size}',
      'summary.chip.kinds': 'Arten: {kinds}',
      'summary.chip.updated': 'Aktualisiert am: {date}',
      'summary.chip.access': 'Zugang: {access}',
      'access.public': 'öffentlich',
      'access.private': 'nur mit Schlüssel',
      'files.title': 'Dateien',
      'files.title.other': 'Inhalt',
      'files.search.placeholder.tags': 'Nach Name, Thema, Kategorie oder Tag suchen',
      'files.search.placeholder.tax': 'Nach Name, Thema oder Kategorie suchen',
      'files.search.placeholder.plain': 'Nach Name suchen',
      'files.empty.filtered': 'Keine {what} passen zur Suche.',
      'files.empty.public': 'Das Portal ist öffentlich, aber der Herausgeber hat noch keine Dateien veröffentlicht.',
      'files.empty.private': 'Der Herausgeber hat in diesem Portal noch keine Dateien veröffentlicht.',
      'folder.title': 'Ordner {path}',
      'folder.empty': 'Dieser Ordner ist leer.',
      'files.count.of': 'von',
      'files.more': 'Angezeigt werden die ersten {shown} von {total} {what} — für den Rest die Suche oder die API nutzen.',
      'file.sha.label': 'SHA-256 {short}',
      'file.sha.title': 'SHA-256: {full}',
      'file.sha.copy': 'Vollständigen SHA-256 kopieren',
      'file.sha.copyFor': 'SHA-256 für {name} kopieren',
      'file.sha.copied': 'SHA-256 kopiert.',
      'file.link.label': 'Download-Adresse',
      'file.link.labelKey': 'Download-Adresse (mit Schlüssel)',
      'file.link.copy': 'Download-Adresse kopieren',
      'file.link.copyFor': 'Download-Adresse von {name} kopieren',
      'file.link.copied': 'Download-Adresse kopiert.',
      'file.download': ' Herunterladen',
      'file.download.key': ' Mit Schlüssel herunterladen',
      'file.key.placeholder': 'Dateischlüssel',
      'file.key.aria': 'Schlüssel für {name}',
      'file.disabled': 'Der Download ist vom Herausgeber gesperrt',
      'file.meta.key': 'Schlüssel erforderlich',
      'file.meta.encrypted': 'verschlüsselt',
      'file.status.downloading': '„{name}“ wird heruntergeladen…',
      'file.status.badKey': 'Ungültiger oder abgelaufener Schlüssel für diese Datei.',
      'file.status.needKey': 'Für diese Datei ist ein Schlüssel erforderlich.',
      'file.status.http': 'Der Download ist fehlgeschlagen (HTTP {status}).',
      'file.status.missing': 'Die Datei ist nicht im Ordner ({name}).',
      'file.status.started': 'Download gestartet: {name}',
      'file.status.offline': 'Keine Verbindung zum Portalserver.',
      'copy.ok': 'Kopiert.',
      'copy.blocked': 'Der Browser erlaubt das Kopieren nicht.',
      'qr.title': 'QR-Code des Portals',
      'qr.alt': 'QR-Code zu diesem Portal',
      'qr.hint.public': 'Code scannen, um das Portal auf einem anderen Gerät zu öffnen.',
      'qr.hint.private': 'Code scannen oder Adresse teilen — für dieses Portal ist ein Schlüssel nötig.',
      'qr.note.allHash': 'Jede Datei trägt einen SHA-256-Abdruck — nach dem Download prüfen.',
      'qr.note.someHash': 'Die angezeigten Abdrücke sind SHA-256 — nach dem Download prüfen.',
      'qr.note.hasKey': 'Dateien mit Schlüssel öffnen nur mit dem vom Herausgeber ausgegebenen Schlüssel.',
      'qr.note.allDisabled': 'Der Herausgeber hat den Download aller Dateien im Portal gesperrt.',
      'footer.served': 'Bereitgestellt von ',
      'footer.updated': 'aktualisiert am {date}',
      'footer.owner': 'die Inhalte gehören dem Herausgeber',
      'package.button': 'Alle herunterladen (ZIP)',
      'package.working': 'Paket wird vorbereitet…',
      'package.error': 'Das Paket kann nicht erstellt werden.',
      'package.ready': 'Der Link gilt einmal und ist bis {when} gültig.',
      'package.ready.noTime': 'Der Link gilt einmal und ist einige Minuten gültig.',
      'package.skipped': ' Im Paket fehlen {n} {what} (Schlüssel nötig oder gesperrt) — sie stehen im Manifest.',
      'package.starting': ' Der Download beginnt…',
      'error.noPortal': 'Kein Portal in der Adresse.',
      'error.portal': 'Das Portal ist nicht erreichbar oder der Zugang erfordert einen Schlüssel.',
      'error.files': 'Die Dateiliste ist nicht erreichbar.',
      'badge.public': 'Öffentlich',
      'flag.info': 'Information',
      'flag.important': 'wichtig',
      'flag.urgent': 'dringend',
      'flag.archive': 'Archiv',
    },
  };

  const isLang = (value) => LANGS.includes(String(value || '').toLowerCase());
  const pick = (value) => (isLang(value) ? String(value).toLowerCase() : DEFAULT_LANG);
  const dictionary = (lang) => DICT[pick(lang)];
  const nouns = (lang) => NOUNS[pick(lang)];

  /** Текст по ключ със заместители `{име}`. Липсващ ключ връща ключа — видим е в теста. */
  function t(lang, key, vars) {
    const table = DICT[pick(lang)];
    const fallback = DICT[DEFAULT_LANG];
    const raw = Object.hasOwn(table, key) ? table[key] : fallback[key];
    if (raw === undefined) return key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (all, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : all));
  }

  /** Съществително за брой: 1 → `one`, иначе → `many` (български/английски/немски). */
  function count(lang, n, kind) {
    const table = nouns(lang);
    const noun = table[kind] || table.file;
    return (Number(n) === 1 ? noun.one : noun.many);
  }

  // Атрибути, които се превеждат в статичния HTML. Така страницата остава четима и
  // без JavaScript (българският е в HTML), а с JavaScript сменя езика изцяло.
  const ATTRS = [
    ['data-i18n', 'textContent'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-title', 'title'],
    ['data-i18n-aria', 'aria-label'],
    ['data-i18n-alt', 'alt'],
  ];

  /** Прилага речника върху DOM дървото (всички елементи с `data-i18n*`). */
  function apply(root, lang) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    let applied = 0;
    for (const [attribute, target] of ATTRS) {
      for (const el of root.querySelectorAll('[' + attribute + ']')) {
        const key = el.getAttribute(attribute);
        if (!key) continue;
        const value = t(lang, key);
        if (target === 'textContent') el.textContent = value;
        else el.setAttribute(target, value);
        applied++;
      }
    }
    const html = root.documentElement || (root.ownerDocument && root.ownerDocument.documentElement);
    if (html && html.setAttribute) html.setAttribute('lang', pick(lang));
    return applied;
  }

  const API = { LANGS, DEFAULT_LANG, LANG_NAMES, LOCALES, isLang, pick, dictionary, nouns, t, count, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof globalThis !== 'undefined') globalThis.HapiPortalI18n = API;
})();
