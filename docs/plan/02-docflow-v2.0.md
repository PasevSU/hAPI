Планова документация v2.0
Проект: PORTAL ENTERPRISE – Професионализация на адон за официални документи с QR верификация
Версия: 2.0
Дата: 2026-10-12
Статус: Draft за одобрение
База: v0.49 (съществуващ код на \\192.168.50.4\addons\portal_enterprise)
Работно копие: files\portal_enterprise-ux\

0. Изходна точка – какво вече съществува
Преди да планирам, фиксирам реалното състояние на проекта, за да не дублираме работа.

0.1 Силни страни (вече налични)
Област	Какво има
Сигурност	scrypt пароли, timing-safe сравнения, rate-limit, hash-chained audit log, CSP, symlink защита
Данни	SQLite + атомични backup-и (VACUUM INTO), signed URL-и (HMAC + expires)
Документи	pdf-writer.js, ooxml.js (docx параграфи), directory.js (променливи)
QR	qrcode.js генерира SVG (per-portal)
HA интеграция	custom_components/portal_enterprise проксира API-то
UI	admin.html + admin.js (13 панела, базова структура)
0.2 Вече реализирано в работното копие (v0.49-ux)
✅ Табло „Обзор" (KPI карти, таблица портали, системен статус)

✅ Предезирани портални карти (badge, мета, QR бутон)

✅ Таблица на файлове (вместо <pre>)

✅ fmtBytes, fmtDate, timeAgo

✅ QR модал (showQr())

✅ Тъмна тема + localStorage

Всичко останало по-долу е ново.

0.3 Известни дефицити (от анализа)
A. Документи: няма OCR, шаблоните не са свързани с генериране, DOCX/XLSX са кухи, няма цифров подпис, PDF е еднопосочен, няма full-text search, няма PDF preview в портала.

B. QR: верификацията е заглушка, QR е per-portal (не per-file), не се вгражда в документи, няма брандинг, няма expiry, audit-chain не е външно закотвен.

C. Адон: backup без файлове, config.yaml непълен, няма тестове, няма HA сензори, публичен API без rate-limit, няма trash/soft-delete, api-credentials.txt в plaintext, dev-плейсхолдъри, ratings dedup в паметта, смесен i18n.

D. UI/UX: (частично адресирано) — липсват глобално търсене, toast-ове, pagination, филтри, responsive.

1. Нова структура на проекта (цел)
Пренареждам проекта в 5 слоя, всеки със собствена отговорност. Това е скелетът, върху който ще стъпват всички бъдещи функции.

text
┌──────────────────────────────────────────────────────────────┐
│  СЛОЙ 5: ИНТЕРФЕЙС (UI/UX)                                   │
│  ├─ admin.html / admin.js  (админ панел)                     │
│  ├─ portal.html / portal.js (публичен портал)                │
│  └─ verify.html / verify.js (публична верификация) ← НОВО    │
├──────────────────────────────────────────────────────────────┤
│  СЛОЙ 4: ПРИЛОЖЕНИЕ (API + бизнес логика)                    │
│  ├─ server.js (HTTP, routing, middleware)                    │
│  ├─ services/ (portal, file, document, qr, verify, audit)    │
│  └─ jobs/ (backup, ocr, cleanup, anchor)                     │
├──────────────────────────────────────────────────────────────┤
│  СЛОЙ 3: ДОКУМЕНТИ (генерация + обработка)                   │
│  ├─ document-engine/ (шаблони + променливи)                  │
│  ├─ pdf-writer.js / ooxml.js (разширени)                     │
│  ├─ ocr.js ← НОВО                                            │
│  ├─ pdf-tools.js (merge/split/watermark) ← НОВО              │
│  └─ signature.js (SHA-256 + визуален печат) ← НОВО           │
├──────────────────────────────────────────────────────────────┤
│  СЛОЙ 2: ВЕРИФИКАЦИЯ (QR + hash + anchor)                    │
│  ├─ qrcode.js (разширен: per-file, брандинг, expiry)         │
│  ├─ verify-service.js ← НОВО                                 │
│  └─ anchor.js (външно закотвяне на audit-chain) ← НОВО       │
├──────────────────────────────────────────────────────────────┤
│  СЛОЙ 1: ДАННИ (съхранение)                                  │
│  ├─ db.sqlite (метаданни)                                    │
│  ├─ files/ (документи) ← вече backup-вано                    │
│  └─ backups/ (пълни backup-и) ← разширено                    │
└──────────────────────────────────────────────────────────────┘
2. Обхват и цели (v2.0)
2.1 Бизнес цели
Официален документ = генериран от шаблон + променливи + SHA-256 + QR + верификация

Верификация = сканираш QR → виждаш статус „верифициран/подправен" + метаданни

Проследимост = всяко действие в audit log + външен anchor

Професионален UX = обзор, таблици, филтри, търсене, toast-ове, dark mode

Надеждност = пълен backup (db + files), OCR, soft-delete

2.2 Технически цели
Разделяне на монолитния server.js на services/

Разширяване на config.yaml с пълна схема

Unit тестове за чистите функции

HA сензори + нотификации

Rate-limit на публичния API

2.3 Извън обхвата (v2.0)
Мобилно приложение

Multi-tenant

Blockchain anchor (само HA entity anchor)

3. Пътна карта – 4 фази
ФАЗА 1: Основи на професионалния UX (1–2 седмици)
Цел: Интерфейсът да не е developer-изглед.

#	Задача	Файл	Приоритет
1.1	✅ Табло „Обзор"	admin.js	Готово
1.2	✅ Предезирани портални карти	admin.js	Готово
1.3	✅ Таблица на файлове	admin.js	Готово
1.4	✅ QR модал	admin.js	Готово
1.5	✅ Dark mode	admin.html	Готово
1.6	Глобално търсене в админа	admin.js	Висока
1.7	Toast-ове вместо alert/confirm/prompt	admin.js	Висока
1.8	Pagination + филтри в jobs/storage/errors	admin.js	Висока
1.9	Responsive таблици	admin.css	Средна
1.10	Пълен i18n (bg/en/de)	i18n.js	Средна
ФАЗА 2: QR верификация + официални документи (3–4 седмици)
Цел: Ядрото на продукта.

#	Задача	Файл	Приоритет
2.1	Per-file QR (не per-portal)	qrcode.js	Критична
2.2	Публична страница /verify/:qrId	verify.html/js	Критична
2.3	Верификация: сравнява реален hash ↔ запис	verify-service.js	Критична
2.4	QR с брандинг (лого, error-correction)	qrcode.js	Висока
2.5	QR expiry + отмяна (signed URL)	qrcode.js + server.js	Висока
2.6	Вграждане на QR в PDF/DOCX	pdf-writer.js, ooxml.js	Висока
2.7	Document engine: шаблон + променливи → PDF/DOCX	document-engine/	Критична
2.8	SHA-256 на генериран документ	signature.js	Критична
2.9	Визуален печат + дата	signature.js	Средна
2.10	Audit-chain anchor в HA entity	anchor.js	Средна
ФАЗА 3: Обработка на документи (3–4 седмици)
#	Задача	Файл	Приоритет
3.1	OCR (Tesseract в Dockerfile)	ocr.js	Висока
3.2	POST /cabinet/ocr → searchable PDF	server.js	Висока
3.3	PDF tools: merge/split/reorder	pdf-tools.js	Висока
3.4	Watermark, page numbers, header/footer	pdf-writer.js	Средна
3.5	Full-text search (SQLite FTS5)	db migration	Висока
3.6	PDF preview в публичния портал	portal.js	Средна
3.7	Разширен DOCX (таблици, изображения, стилове)	ooxml.js	Средна
3.8	XLSX с реални данни	ooxml.js	Средна
3.9	CSV import/export за XLSX	ooxml.js	Ниска
ФАЗА 4: Професионализация на адона (2–3 седмици)
#	Задача	Файл	Приоритет
4.1	Backup на files/ (не само db)	backup.js	Критична
4.2	Пълна config.yaml схема	config.yaml	Висока
4.3	icon: true / logo: true	config.yaml	Ниска
4.4	Unit тестове (pdf, ooxml, qr, directory)	tests/	Висока
4.5	CI + changelog	.github/	Средна
4.6	HA сензори (downloads, storage, integrity)	custom_components	Висока
4.7	HA нотификации (нов upload, integrity fail)	custom_components	Средна
4.8	Rate-limit на публичния API	server.js	Висока
4.9	Trash / soft-delete	db + server.js	Средна
4.10	Auto-expiry на портали/файлове	jobs/cleanup.js	Средна
4.11	Премахване на api-credentials.txt	server.js	Висока
4.12	Премахване на dev-плейсхолдъри	settings.json	Висока
4.13	Persistent ratings dedup	db migration	Средна
4. Детайлна структура на папките (целева)
text
portal_enterprise/
├── config.yaml                    ← разширена схема
├── Dockerfile                     ← + tesseract-ocr, poppler-utils
├── CHANGELOG.md                   ← НОВО
├── README.md
├── icon.png / logo.png            ← вече реферирани
├── package.json
│
├── src/
│   ├── server.js                  ← HTTP + routing (разделен)
│   │
│   ├── services/                  ← НОВО (бизнес логика)
│   │   ├── portal-service.js
│   │   ├── file-service.js
│   │   ├── document-service.js
│   │   ├── qr-service.js
│   │   ├── verify-service.js      ← НОВО
│   │   ├── audit-service.js
│   │   └── backup-service.js
│   │
│   ├── document-engine/           ← НОВО
│   │   ├── index.js
│   │   ├── template.js            ← шаблон + {{variables}}
│   │   ├── variables.js           ← резолвер на променливи
│   │   └── renderers/
│   │       ├── pdf-renderer.js
│   │       └── docx-renderer.js
│   │
│   ├── lib/                       ← чисти функции
│   │   ├── pdf-writer.js          ← разширен
│   │   ├── ooxml.js               ← разширен
│   │   ├── qrcode.js              ← разширен
│   │   ├── pdf-tools.js           ← НОВО
│   │   ├── ocr.js                 ← НОВО
│   │   ├── signature.js           ← НОВО
│   │   ├── anchor.js              ← НОВО
│   │   ├── directory.js
│   │   ├── crypto.js
│   │   └── format.js              ← fmtBytes, fmtDate, timeAgo
│   │
│   ├── jobs/                      ← НОВО
│   │   ├── backup-job.js
│   │   ├── cleanup-job.js
│   │   ├── anchor-job.js
│   │   └── ocr-queue.js
│   │
│   ├── db/
│   │   ├── migrations/
│   │   │   ├── 001_init.sql
│   │   │   ├── 002_fts5.sql       ← НОВО
│   │   │   ├── 003_soft_delete.sql ← НОВО
│   │   │   ├── 004_qr_expiry.sql  ← НОВО
│   │   │   └── 005_ratings.sql    ← НОВО
│   │   └── index.js
│   │
│   └── i18n/
│       ├── bg.json
│       ├── en.json
│       └── de.json
│
├── public/
│   ├── admin.html / admin.js / admin.css
│   ├── portal.html / portal.js / portal.css
│   ├── verify.html / verify.js / verify.css  ← НОВО
│   └── assets/
│
├── tests/                         ← НОВО
│   ├── unit/
│   │   ├── pdf-writer.test.js
│   │   ├── ooxml.test.js
│   │   ├── qrcode.test.js
│   │   ├── directory.test.js
│   │   └── verify.test.js
│   └── integration/
│       ├── portal.test.js
│       └── verify.test.js
│
└── custom_components/
    └── portal_enterprise/
        ├── __init__.py
        ├── sensor.py              ← НОВО
        ├── notify.py              ← НОВО
        └── manifest.json
5. Детайлна спецификация – Фаза 1 (UI/UX)
5.1 Глобално търсене
Компонент: #global-search в горната лента.

javascript
// Търси в: портали, файлове, задачи, грешки, настройки
const searchIndex = [
  { type: 'portal', id, title, slug, tags: [...] },
  { type: 'file',   id, name, portal, tags: [...] },
  { type: 'job',    id, name, tags: [...] },
  { type: 'setting',key, label, tags: [...] }
];
UX:

Ctrl+K → отваря overlay

Fuzzy match (Fuse.js или лек собствен алгоритъм)

Групиране по тип

Enter → навигира до съответния панел + highlight

5.2 Toast-ове
Заменя всички alert()/confirm()/prompt().

javascript
// toast.js
export const toast = {
  success: (msg) => show(msg, 'success', 3000),
  error:   (msg) => show(msg, 'error', 5000),
  info:    (msg) => show(msg, 'info', 3000),
  confirm: (msg) => showModal(msg, 'confirm'), // Promise<boolean>
  prompt:  (msg, def) => showModal(msg, 'prompt') // Promise<string>
};
Правило: Никакви browser диалози в продукция.

5.3 Pagination + филтри
За jobs, storage, errors, audit:

javascript
const listView = {
  state: { page: 1, perPage: 25, filters: {}, sort: 'date:desc' },
  render(items) { /* таблица + контроли */ },
  applyFilters(items) { /* ... */ }
};
UI:

Филтри: dropdown (ниво/период/статус) + search input

Pagination: < 1 2 3 ... 10 > + „25/50/100 на страница"

Sort: клик на колона

Export CSV бутон

5.4 Responsive таблици
При < 768px → карти вместо таблица:

text
┌─────────────────────────┐
│ 📄 договор.pdf          │
│ 2.4 MB · преди 3 дни    │
│ [Изтегли] [QR] [···]    │
└─────────────────────────┘
6. Детайлна спецификация – Фаза 2 (QR + документи)
6.1 Per-file QR
Промяна в qrcode.js:

javascript
// СТАРО: един QR за портала
function writeApiDir(portal) {
  return generateQr(`${baseUrl}/api/v1/p/${portal.slug}`);
}

// НОВО: QR за всеки файл
function generateFileQr(file, options = {}) {
  const payload = {
    v: 1,                          // версия на payload
    id: file.qrId,                 // уникален ID (не file.id!)
    h: file.sha256.substring(0,16), // кратък hash за бърза проверка
    exp: options.expiresAt || null,
    sig: signPayload({id: file.qrId, h: file.sha256}, SECRET)
  };
  const url = `${baseUrl}/verify/${file.qrId}?s=${payload.sig}`;
  return {
    svg: renderQr(url, {
      logo: options.logo,
      errorCorrection: 'H',
      size: options.size || 256,
      color: options.color || '#000'
    }),
    url,
    payload
  };
}
Нови полета в DB:

sql
ALTER TABLE files ADD COLUMN qr_id TEXT UNIQUE;
ALTER TABLE files ADD COLUMN qr_expires_at TIMESTAMP NULL;
ALTER TABLE files ADD COLUMN qr_revoked_at TIMESTAMP NULL;
CREATE INDEX idx_files_qr ON files(qr_id);
6.2 Публична страница /verify/:qrId
Нов файл public/verify.html:

html
<main id="verify-root">
  <section id="verify-loading">Проверка…</section>
  <section id="verify-valid" hidden>
    <h1>✓ Документът е верифициран</h1>
    <dl>
      <dt>Файл</dt><dd id="v-name"></dd>
      <dt>Портал</dt><dd id="v-portal"></dd>
      <dt>Издаден от</dt><dd id="v-org"></dd>
      <dt>SHA-256</dt><dd><code id="v-hash"></code></dd>
      <dt>Качен на</dt><dd id="v-date"></dd>
      <dt>Валиден до</dt><dd id="v-exp"></dd>
    </dl>
  </section>
  <section id="verify-invalid" hidden>
    <h1>✗ Документът не е верифициран</h1>
    <p id="v-reason"></p>
  </section>
</main>
Endpoint GET /api/v1/verify/:qrId:

javascript
// verify-service.js
async function verifyDocument(qrId, providedSig) {
  const file = await db.getFileByQrId(qrId);
  if (!file) return { status: 'not_found' };
  if (file.qr_revoked_at) return { status: 'revoked', revokedAt: file.qr_revoked_at };
  if (file.qr_expires_at && file.qr_expires_at < now()) {
    return { status: 'expired', expiredAt: file.qr_expires_at };
  }
  if (!verifySignature({id: qrId, h: file.sha256.substring(0,16)}, providedSig)) {
    return { status: 'tampered', reason: 'invalid_signature' };
  }
  // Реална проверка на файла
  const actualHash = await hashFile(path.join(FILES_DIR, file.path));
  if (actualHash !== file.sha256) {
    return { status: 'tampered', reason: 'hash_mismatch',
             expected: file.sha256, actual: actualHash };
  }
  return {
    status: 'valid',
    file: { name: file.name, sha256: file.sha256, uploadedAt: file.uploaded_at },
    portal: { title: file.portal_title, slug: file.portal_slug },
    org: file.organization
  };
}
Отговор (JSON):

json
{
  "status": "valid",
  "file": { "name": "договор-2026.pdf", "sha256": "abc...", "uploadedAt": "..." },
  "portal": { "title": "Договори 2026", "slug": "files" },
  "org": "DEW21",
  "verifiedAt": "2026-10-12T14:30:00Z"
}
6.3 Document Engine – шаблон + променливи
Концепция:

text
ШАБЛОН (DOCX/PDF/MD)  +  ДАННИ (JSON)  →  ДОКУМЕНТ (PDF/DOCX)  +  SHA-256  +  QR
Структура на шаблон:

markdown
# УДОСТОВЕРЕНИЕ № {{document.number}}

Настоящото удостоверява, че **{{person.name}}**,
ЕГН {{person.egn}}, с адрес {{person.address}},
работи в **{{organization.name}}** на длъжност {{person.position}}.

Издадено на {{document.date}} в гр. {{organization.city}}.

_______________________
{{organization.manager}}
API:

javascript
// document-engine/index.js
async function generateDocument(templateId, data, options = {}) {
  const tpl = await db.getTemplate(templateId);
  const merged = mergeTemplate(tpl.content, data);  // замества {{...}}
  const format = options.format || tpl.defaultFormat; // 'pdf' | 'docx'
  const buffer = format === 'pdf'
    ? await renderPdf(merged, options)
    : await renderDocx(merged, options);
  const sha256 = sha256(buffer);
  const file = await saveFile({
    name: options.fileName || `${tpl.name}-${Date.now()}.${format}`,
    buffer, sha256,
    portalId: options.portalId,
    qrEnabled: options.qrEnabled !== false
  });
  if (options.qrEnabled !== false) {
    const qr = generateFileQr(file, { logo: options.logo });
    await embedQrInDocument(file, qr);
  }
  return { file, sha256, qr };
}
Вграждане на QR в PDF:

javascript
// pdf-writer.js – нова функция
function embedQr(buffer, qrSvg, position = 'bottom-right', options = {}) {
  const qrPng = svgToPng(qrSvg);
  const pdf = loadPdf(buffer);
  pdf.pages().forEach(page => {
    const { width, height } = page.size();
    const qrSize = options.size || 80;
    const margin = options.margin || 20;
    const x = position.includes('right') ? width - qrSize - margin : margin;
    const y = position.includes('bottom') ? height - qrSize - margin : margin;
    page.drawImage(qrPng, { x, y, width: qrSize, height: qrSize });
    if (options.caption) {
      page.drawText(options.caption, { x, y: y - 10, size: 6 });
    }
  });
  return pdf.save();
}
6.4 Цифров подпис (SHA-256 + визуален печат)
За v2.0 (не PKCS#7):

javascript
// signature.js
function createVisualStamp(document, options = {}) {
  return {
    sha256: document.sha256,
    shortHash: document.sha256.substring(0, 12).toUpperCase(),
    issuedAt: new Date().toISOString(),
    issuedBy: options.organization,
    qrUrl: options.qrUrl,
    // Визуален блок за PDF:
    visual: `
      ┌──────────────────────────────┐
      │ ${options.organization}      │
      │ Документ: ${document.name}   │
      │ SHA-256: ${shortHash}        │
      │ Дата: ${issuedAt}            │
      │ Верификация: [QR]            │
      └──────────────────────────────┘
    `
  };
}
За Фаза 3+: PKCS#7 (PDF digital signature) чрез node-signpdf.

6.5 Audit-chain anchor
Проблем: admin може да подправи audit log.

Решение: Периодично записваме hash(последен audit entry) в HA entity (immutable от гледна точка на адона).

javascript
// anchor.js
async function anchorAuditChain() {
  const last = await db.getLastAudit();
  const digest = sha256(JSON.stringify(last));
  await fetch(`${HA_URL}/api/states/sensor.portal_audit_anchor`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HA_TOKEN}` },
    body: JSON.stringify({
      state: digest,
      attributes: {
        last_entry_id: last.id,
        last_entry_time: last.created_at,
        anchored_at: new Date().toISOString()
      }
    })
  });
}
Job: всеки час (или при N нови записа).

7. Детайлна спецификация – Фаза 3 (Документи)
7.1 OCR
Dockerfile:

dockerfile
RUN apt-get update && apt-get install -y \
    tesseract-ocr tesseract-ocr-bul tesseract-ocr-deu \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*
ocr.js:

javascript
async function ocrFile(buffer, options = {}) {
  const lang = options.lang || 'bul+deu+eng';
  const tmpIn = writeTemp(buffer);
  const tmpOut = tmpIn + '.pdf';
  await exec(`ocrmypdf --language ${lang} --output-type pdf ${tmpIn} ${tmpOut}`);
  const result = readFile(tmpOut);
  unlink(tmpIn); unlink(tmpOut);
  return result; // searchable PDF
}
Endpoint: POST /cabinet/ocr (multipart).

7.2 Full-text search
SQLite FTS5:

sql
CREATE VIRTUAL TABLE files_fts USING fts5(
  name, extracted_text, portal_title,
  content='files', content_rowid='id'
);

CREATE TRIGGER files_ai AFTER INSERT ON files BEGIN
  INSERT INTO files_fts(rowid, name, extracted_text, portal_title)
  VALUES (new.id, new.name, new.extracted_text, new.portal_title);
END;
Търсене:

sql
SELECT f.*, snippet(files_fts, 1, '<mark>', '</mark>', '...', 32) AS snippet
FROM files_fts fts
JOIN files f ON f.id = fts.rowid
WHERE files_fts MATCH ?
ORDER BY rank LIMIT 50;
7.3 PDF tools
javascript
// pdf-tools.js
export const pdfTools = {
  async merge(buffers) { /* pdf-lib */ },
  async split(buffer, ranges) { /* → масив от PDF */ },
  async reorder(buffer, newOrder) { /* ... */ },
  async watermark(buffer, text, options) { /* ... */ },
  async addPageNumbers(buffer, options) { /* ... */ },
  async addHeaderFooter(buffer, header, footer) { /* ... */ }
};
7.4 PDF preview в портала
Промяна в portal.js:

javascript
// Вместо само <a download>, добавяме:
if (file.mimeType === 'application/pdf') {
  const btn = document.createElement('button');
  btn.textContent = 'Преглед';
  btn.onclick = () => openPdfPreview(file);
}
Preview: iframe с Content-Disposition: inline (вече има inline:true в cabinet).

8. Детайлна спецификация – Фаза 4 (Професионализация)
8.1 Backup на файлове
Промяна в backup-service.js:

javascript
async function createFullBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(BACKUP_DIR, `backup-${ts}`);
  await fs.mkdir(dir, { recursive: true });
  
  // 1. DB
  await db.exec(`VACUUM INTO '${path.join(dir, 'db.sqlite')}'`);
  
  // 2. Files (rsync-like)
  await copyDir(FILES_DIR, path.join(dir, 'files'));
  
  // 3. Manifest
  const manifest = {
    createdAt: ts,
    dbSize: statSync(path.join(dir, 'db.sqlite')).size,
    filesCount: await countFiles(FILES_DIR),
    filesSize: await dirSize(FILES_DIR),
    sha256: await hashDir(dir)  // за integrity
  };
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  
  // 4. Rotation (keep last N)
  await rotateBackups(BACKUP_DIR, 10);
  
  return dir;
}
8.2 Пълна config.yaml
yaml
name: "Portal Enterprise"
version: "2.0.0"
slug: "portal_enterprise"
description: "Професионален портал за документи с QR верификация"
arch: [amd64, aarch64, armv7]
url: "https://github.com/..."
image: "ghcr.io/.../portal-enterprise-{arch}"
icon: true
logo: true
startup: application
boot: auto
init: false

options:
  username: "admin"
  password: ""
  api_token: ""
  db_name: "portal"
  backup_folder: "/backup"
  organization: ""
  project: ""
  campaign: ""
  base_url: ""
  limits:
    max_file_size_mb: 100
    max_portals: 100
    max_files_per_portal: 1000
  backup_schedule: "0 3 * * *"
  qr:
    enabled: true
    logo: ""
    error_correction: "H"
    default_expiry_days: 0
  ocr:
    enabled: false
    languages: "bul+deu+eng"
  ha:
    url: "http://supervisor/core"
    token: ""
    notify_on_upload: true
    notify_on_integrity_fail: true
  rate_limit:
    public_per_minute: 60
    verify_per_minute: 30

schema:
  username: str
  password: password
  api_token: password
  db_name: str
  backup_folder: str
  organization: str
  project: str
  campaign: str
  base_url: str
  limits:
    max_file_size_mb: int(1,10240)
    max_portals: int(1,10000)
    max_files_per_portal: int(1,100000)
  backup_schedule: str
  qr:
    enabled: bool
    logo: str
    error_correction: list(L|M|Q|H)
    default_expiry_days: int(0,3650)
  ocr:
    enabled: bool
    languages: str
  ha:
    url: str
    token: password
    notify_on_upload: bool
    notify_on_integrity_fail: bool
  rate_limit:
    public_per_minute: int(1,10000)
    verify_per_minute: int(1,10000)
8.3 HA сензори
sensor.py:

python
SENSORS = [
    ("downloads_today", "Изтегляния днес", "mdi:download"),
    ("visits_today", "Посещения днес", "mdi:eye"),
    ("storage_bytes", "Заето пространство", "mdi:harddisk"),
    ("files_total", "Общо файлове", "mdi:file"),
    ("portals_total", "Общо портали", "mdi:folder"),
    ("integrity_failures", "Провалени проверки", "mdi:alert"),
    ("audit_anchor", "Audit anchor", "mdi:link"),
]
8.4 Rate-limit на публичния API
javascript
// server.js
const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rate_limit.public_per_minute,
  keyGenerator: (req) => req.ip,
  message: { error: 'Too many requests' }
});

app.use('/api/v1/p/', publicLimiter);
app.use('/api/v1/verify/', rateLimit({
  windowMs: 60_000,
  max: config.rate_limit.verify_per_minute
}));
8.5 Trash / soft-delete
sql
ALTER TABLE files ADD COLUMN deleted_at TIMESTAMP NULL;
ALTER TABLE portals ADD COLUMN deleted_at TIMESTAMP NULL;

-- Всички SELECT-и добавят: WHERE deleted_at IS NULL
-- Purge job изтрива записи > 30 дни
8.6 Auto-expiry
javascript
// jobs/cleanup.js
async function cleanupExpired() {
  const now = Date.now();
  // 1. Портали с expires_at < now → soft-delete
  // 2. Файлове с expires_at < now → soft-delete
  // 3. QR с qr_expires_at < now → маркирай като expired
  // 4. Purge на soft-deleted > 30 дни
}
8.7 Премахване на api-credentials.txt
СТАРО: генерираната парола се записва в plaintext файл.

НОВО:

Паролата се показва веднъж в admin UI (modal с „Копирай" + „Запазих си я")

В базата се пази само scrypt hash

Няма файл

8.8 Премахване на dev-плейсхолдъри
javascript
// settings.json – СТАРО
{ "organization": "PasevSU DEV", "campaign": "NO TRUST Cybersecurity" }

// НОВО: от config.yaml options
{ "organization": config.organization, "campaign": config.campaign }
8.9 Persistent ratings dedup
sql
CREATE TABLE ratings_dedup (
  file_id INTEGER,
  ip_hash TEXT,
  rated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (file_id, ip_hash)
);
-- Cleanup: DELETE WHERE rated_at < NOW() - INTERVAL 24 HOUR
9. Ключови потоци (Sequence Diagrams)
9.1 Генериране на официален документ с QR
text
Admin          UI              API           DocumentEngine    DB        Files
 │              │               │                  │            │          │
 │──"Нов документ"──────────────>│                  │            │          │
 │              │──GET /templates───────────────>│            │          │
 │              │<──[{шаблони}]──────────────────│            │          │
 │──избира шаблон + данни───────>│                  │            │          │
 │              │──POST /documents/generate─────>│            │          │
 │              │               │──merge(tpl, data)│            │          │
 │              │               │──renderPdf()─────│            │          │
 │              │               │──sha256(buffer)──│            │          │
 │              │               │──saveFile()──────────────────>│          │
 │              │               │<──file.id────────────────────│          │
 │              │               │──generateFileQr(file)         │          │
 │              │               │──embedQrInDocument(file, qr)  │          │
 │              │               │──saveFile(updated)───────────>│          │
 │              │               │──audit.log('DOC_CREATE')─────>│          │
 │              │<──{file, sha256, qrUrl}───────│            │          │
 │<──показва QR + линк──────────│                  │            │          │
9.2 Верификация на документ
text
Потребител      Browser         API            DB          Files
    │              │              │              │            │
    │──сканира QR──>│              │              │            │
    │              │──GET /verify/:qrId?s=sig──>│            │
    │              │              │──SELECT file─>│            │
    │              │              │<──file────────│            │
    │              │              │──verifySig()  │            │
    │              │              │──checkExpiry()│            │
    │              │              │──hashFile()────────────────>│
    │              │              │<──actualHash───────────────│
    │              │              │──compare     │            │
    │              │<──{status: valid/tampered}──│            │
    │<──показва ✓/✗─│              │              │            │
10. Тестова стратегия
10.1 Unit тестове (чисти функции)
Модул	Тестове
pdf-writer.js	генериране, merge, watermark, QR вграждане
ooxml.js	docx параграфи, таблици, xlsx с данни
qrcode.js	SVG, error-correction, брандинг, expiry
directory.js	заместване на {{variables}}, вложени
signature.js	SHA-256, визуален печат
verify-service.js	valid/tampered/expired/revoked
10.2 Integration тестове
Създаване на портал → файл → QR → верификация

Генериране на документ → SHA-256 → проверка

Backup → restore → integrity

10.3 E2E (Playwright)
Admin: създай портал, качи файл, генерирай QR

Публичен: отвори портал, изтегли файл

Verify: сканирай QR → виж статус

11. CI/CD
yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run test:integration
12. Рискове и смекчаване
Риск	Вероятност	Влияние	Смекчаване
OCR качество на български	Средна	Средно	Тест с реални документи; fallback eng
PDF signature (PKCS#7) сложност	Висока	Средно	v2.0 = само SHA-256 + визуален печат
Backup размер (files/)	Висока	Средно	Incremental backup + rotation
HA anchor зависимост	Средна	Ниска	Fallback към локален файл
FTS5 на стар SQLite	Ниска	Средно	Проверка на версията в Dockerfile
i18n обем	Средна	Ниска	Поетапно, bg първо
13. Критерии за приемане
✅ Порталите се показват като карти с QR бутон

✅ Всеки файл има собствен QR, сочещ към /verify/:qrId

✅ /verify/:qrId връща valid/tampered/expired/revoked

✅ Генериране на документ от шаблон + променливи → PDF с QR

✅ SHA-256 се изчислява и пази за всеки генериран документ

✅ Backup включва files/

✅ OCR работи за PDF и изображения

✅ Full-text search намира по съдържание

✅ Rate-limit на публичния API

✅ HA сензори са налични

✅ Unit тестове минават в CI

✅ Няма api-credentials.txt

✅ Няма dev-плейсхолдъри