'use strict';
// RS-08: последните четири обекта на Report Studio — лого, сертификат (X.509), колони и
// динамичен блок — са РЕАЛНИ, не „планирано (v2)“.
//
// Какво се мери, а не се твърди:
//   • манифестът приема четирите типа и ОТКАЗВА безсмислени стойности (лошо лого, липсващ
//     сертификат, празна колона, „сума“ без колона);
//   • сертификатът в отчета е СЪЩИЯТ, който е подаден: субектът и SHA-256 отпечатъкът се
//     сравняват с `crypto.X509Certificate`, а без сертификат блокът казва „не е предоставен“;
//   • динамичният блок СМЯТА от данните (брой/сума/средно/мин/макс) — стойностите се проверяват;
//   • логото влиза в PDF-а като истинска картинка (PNG поток) и височината му е под тавана;
//   • колоните се РИСУВАТ една до друга: в съдържанието на PDF-а се търсят два текста на
//     една и съща височина с разстояние точно колкото една колона + междина;
//   • същото се проверява и през HTTP (`POST /admin/api/v2/reports/render`), защото това
//     вижда потребителят.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const M = require('../hapi_enterprise/report-manifest.js');
const R = require('../hapi_enterprise/report-render.js');
const x509 = require('../hapi_enterprise/x509.js');
const objects = require('../hapi_enterprise/ui/report-objects.js');
const { startServer } = require('./lib/gui-harness.cjs');

const root = path.join(__dirname, '..');

// ── Помощни ─────────────────────────────────────────────────────────────────────
/** Минимален ЕДНОЦВЕТЕН PNG (без алфа) — истински IHDR/IDAT/IEND с валиден CRC. */
function tinyPng(width, height) {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // битове на канал
  ihdr[9] = 2; // RGB, без алфа
  const rows = Buffer.alloc((width * 3 + 1) * height); // всеки ред: филтър 0 + черни пиксели
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Всички потоци на PDF-а, които се разпакетират (съдържание/шрифтове) — картинките не. */
function inflateStreams(pdf) {
  const buf = Buffer.from(pdf);
  const out = [];
  let i = 0;
  while ((i = buf.indexOf('\nstream\n', i)) >= 0) {
    const start = i + 8;
    const end = buf.indexOf('\nendstream', start);
    if (end < 0) break;
    const chunk = buf.subarray(start, end);
    // Големите потоци са вградени шрифтове — не са нужни и само трупат памет.
    if (chunk.length < 200000) {
      try {
        out.push(zlib.inflateSync(chunk).toString('latin1'));
      } catch {
        /* не е zlib — пропуска се */
      }
    }
    i = end + 10;
  }
  return out.join('\n');
}

function manifestWith(blocks) {
  return {
    schemaVersion: 1,
    profile: 'rs08',
    page: { format: 'A4', orientation: 'portrait', marginsMm: [15, 15, 15, 15] },
    branding: { organization: 'hAPI Enterprise', logo: '', qr: false },
    print: { pageNumbers: true, headerFooter: false, footerNote: '' },
    blocks: [
      { id: 'start', type: M.START, locked: true, label: 'RFC 3161 START' },
      ...blocks,
      { id: 'stop', type: M.STOP, locked: true, label: 'RFC 3161 STOP' },
    ],
  };
}

(async () => {
  // ── 1. Четирите обекта са готови и са част от схемата ──────────────────────────
  const four = ['logo', 'certificate', 'columns', 'dynamic'];
  for (const type of four) {
    assert.equal(objects.isReady(type), true, `${type} трябва да е готов обект`);
    assert.ok(M.ELEMENT_TYPES.includes(type), `${type} трябва да е в схемата на манифеста`);
  }
  assert.equal(objects.planned().length, 0, 'няма останали планирани обекти');

  // ── 2. Валидация: приема смисленото, отказва безсмисленото ────────────────────
  const good = M.check(
    manifestWith([
      { id: 'logo', type: 'logo', widthMm: 40, heightMm: 18, data: 'data:image/png;base64,' + tinyPng(2, 2).toString('base64') },
      { id: 'cert', type: 'certificate', ref: 'cms' },
      { id: 'cols', type: 'columns', columns: [{ title: 'Ляво', text: 'текст' }, { title: 'Дясно', text: 'друг' }] },
      { id: 'dyn', type: 'dynamic', source: 'records:1000', aggregate: 'sum', field: 1 },
    ]),
  );
  assert.equal(good.ok, true, 'валиден манифест с четирите типа: ' + JSON.stringify(good.errors));

  const rejected = (blocks, code) => {
    const res = M.check(manifestWith(blocks));
    assert.equal(res.ok, false, `трябва да се откаже: ${code}`);
    assert.ok(res.errors.some((e) => e.code === code), `очакван код ${code}, получено ${res.errors.map((e) => e.code).join(',')}`);
  };
  rejected([{ id: 'logo', type: 'logo', data: 'data:image/gif;base64,R0lGODlh' }], 'INVALID_LOGO_DATA');
  rejected([{ id: 'logo', type: 'logo', data: 'A'.repeat(M.MAX_LOGO_CHARS + 1) }], 'LOGO_TOO_LARGE');
  rejected([{ id: 'logo', type: 'logo', widthMm: 900 }], 'INVALID_LOGO_SIZE');
  rejected([{ id: 'cert', type: 'certificate' }], 'INVALID_CERT_REF');
  rejected([{ id: 'cert', type: 'certificate', ref: 'с интервал' }], 'INVALID_CERT_REF');
  rejected([{ id: 'cols', type: 'columns', columns: [] }], 'INVALID_COLUMNS');
  rejected([{ id: 'cols', type: 'columns', columns: [{ title: 'празна', text: '   ' }] }], 'INVALID_COLUMNS');
  rejected([{ id: 'cols', type: 'columns', columns: [1, 2, 3, 4, 5].map((i) => ({ text: 'к' + i })) }], 'INVALID_COLUMNS');
  rejected([{ id: 'dyn', type: 'dynamic', source: 'друго:1' }], 'INVALID_DYNAMIC_SOURCE');
  rejected([{ id: 'dyn', type: 'dynamic', source: 'records:1', aggregate: 'median' }], 'INVALID_DYNAMIC_AGGREGATE');
  rejected([{ id: 'dyn', type: 'dynamic', source: 'records:1', aggregate: 'sum' }], 'INVALID_DYNAMIC_FIELD');

  // Сертификатът НЕ се пази в манифеста: ключът „certificate“ остава забранен.
  const smuggled = M.check(manifestWith([{ id: 'c', type: 'certificate', ref: 'cms', certificate: 'MIIB' }]));
  assert.equal(smuggled.ok, false, 'сертификат в манифеста се отказва');
  assert.ok(smuggled.errors.some((e) => e.code === 'FORBIDDEN_FIELD'), 'причината е FORBIDDEN_FIELD');

  // ── 3. Сертификат: печата се СЪЩИЯТ, който е подаден ──────────────────────────
  const identity = x509.selfSigned({ commonName: 'hAPI Report Signer', organization: 'hAPI Enterprise', country: 'BG', days: 30 });
  const real = new crypto.X509Certificate(identity.certPem);
  const certManifest = M.normalize(manifestWith([{ id: 'cert', type: 'certificate', ref: 'cms', label: 'Сертификат на подписа' }]));
  const certBlocks = R.toPdfBlocks(certManifest, { certificates: { cms: identity.certPem } });
  const certTable = certBlocks.find((b) => b.type === 'table' && b.rows && b.rows[0][0] === 'Поле' && b.rows.some((r) => r[0] === 'SHA-256 отпечатък'));
  assert.ok(certTable, 'сертификатът се превръща в таблица');
  const certRow = (name) => (certTable.rows.find((r) => r[0] === name) || [])[1];
  assert.equal(certRow('SHA-256 отпечатък'), real.fingerprint256, 'отпечатъкът е на реалния сертификат');
  assert.match(certRow('Субект'), /CN=hAPI Report Signer/, 'субектът идва от сертификата');
  assert.match(certRow('Субект'), /O=hAPI Enterprise/);
  assert.equal(certRow('Сериен номер'), real.serialNumber, 'серийният номер съвпада');
  assert.equal(certRow('Самоподписан'), 'да', 'самоподписаният сертификат е разпознат');
  assert.match(certRow('Публичен ключ'), /rsa · 2048 бита/, 'ключът се описва с реалните си параметри');

  // Без сертификат: честно изречение, никаква измислена таблица.
  const noCert = R.toPdfBlocks(certManifest, {}).filter((b) => b.type === 'p' && /не е предоставен/.test(b.text || ''));
  assert.equal(noCert.length, 1, 'без сертификат се казва „не е предоставен“');
  assert.match(noCert[0].text, /„cms“/, 'казва се КОЙ сертификат липсва');

  // ── 4. Динамичен блок: стойността се смята от данните ─────────────────────────
  const rows = [['Иван', '10'], ['Мария', '20,5'], ['Петър', '31']];
  const dynBlock = (aggregate, field) => M.normalize(manifestWith([{ id: 'dyn', type: 'dynamic', source: 'records:1000', aggregate, field }]));
  const dynRows = (aggregate, field, data) =>
    R.toPdfBlocks(dynBlock(aggregate, field), { data: data === undefined ? { 'records:1000': rows } : data })
      .find((b) => b.type === 'table' && b.rows && b.rows[0][0] === 'Показател').rows;
  const value = (aggregate, field, data) => dynRows(aggregate, field, data).find((r) => r[0] === 'Стойност')[1];
  assert.equal(value('count', 0), '3', 'броят редове е 3');
  assert.equal(value('sum', 1), '61.5', 'сумата е 10 + 20.5 + 31 = 61.5 (запетая също се разбира)');
  assert.equal(value('avg', 1), '20.5', 'средното е 61.5 / 3');
  assert.equal(value('min', 1), '10', 'минимумът');
  assert.equal(value('max', 1), '31', 'максимумът');
  assert.equal(value('sum', 1, {}), '—', 'без данни стойността е „—“ (нищо не се измисля)');
  // Нечисловата колона не се брои за число — „сума“ върху имена дава „—“.
  assert.equal(value('sum', 0), '—', 'текстовата колона не дава сума');
  const dynTable = dynRows('count', 0);
  assert.equal(dynTable.find((r) => r[0] === 'Редове в източника')[1], '3', 'редовете се виждат и отделно');
  assert.match(dynTable.find((r) => r[0] === 'Агрегат')[1], /count — брой редове/);

  // ── 5. Лого: истинска картинка в PDF-а, с таван на височината ────────────────
  const png = tinyPng(100, 400); // много висока картинка — таванът трябва да я ограничи
  const logoManifest = M.normalize(
    manifestWith([{ id: 'logo', type: 'logo', label: 'Лого', widthMm: 40, heightMm: 18, data: 'data:image/png;base64,' + png.toString('base64') }]),
  );
  const logoBlocks = R.toPdfBlocks(logoManifest, {});
  const logoImage = logoBlocks.find((b) => b.type === 'image');
  assert.ok(logoImage, 'логото става image блок');
  assert.equal(Buffer.compare(logoImage.data, png), 0, 'в PDF-а влиза СЪЩИЯТ PNG');
  const logoPdf = R.renderPdf(logoManifest, { createdAt: '2026-01-01T00:00:00Z' });
  const logoText = logoPdf.toString('latin1');
  assert.match(logoText, /\/Predictor 15/, 'PNG-то се вгражда като PNG поток (без прекодиране)');
  // Самата рисунка е в компресиран поток — там се търси поставянето на картинката.
  const placed = [...inflateStreams(logoPdf).matchAll(/q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm \/Im(\d+) Do Q/g)];
  assert.equal(placed.length, 1, 'картинката се поставя веднъж');
  const shownWidth = Number(placed[0][1]);
  const shownHeight = Number(placed[0][2]);
  assert.ok(Math.abs(shownWidth - 40 * (72 / 25.4)) < 0.5, `ширината е 40 мм (получено ${shownWidth.toFixed(2)} pt)`);
  assert.ok(shownHeight <= 18 * (72 / 25.4) + 0.5, `височината е под тавана 18 мм (получено ${shownHeight.toFixed(2)} pt)`);

  // Без изображение логото казва какво липсва; адресът не се тегли по мрежата.
  const logoEmpty = R.toPdfBlocks(M.normalize(manifestWith([{ id: 'logo', type: 'logo' }])), {});
  assert.match(logoEmpty.find((b) => b.type === 'p' && /Лого/.test(b.text || '')).text, /няма вградено изображение/);

  // ── 6. Колони: РИСУВАТ се една до друга ───────────────────────────────────────
  const colManifest = M.normalize(
    manifestWith([
      {
        id: 'cols',
        type: 'columns',
        label: 'Две колони',
        columns: [
          { title: 'Лява колона', text: 'Първи ред на лявата колона' },
          { title: 'Дясна колона', text: 'Първи ред на дясната колона' },
        ],
      },
    ]),
  );
  const colBlocks = R.toPdfBlocks(colManifest, {});
  const colBlock = colBlocks.find((b) => b.type === 'columns');
  assert.ok(colBlock, 'колоните стигат до PDF writer-а като блок „columns“');
  assert.equal(colBlock.cols.length, 2);
  const colPdf = R.renderPdf(colManifest, { createdAt: '2026-01-01T00:00:00Z' });
  const content = inflateStreams(colPdf);
  const positions = [...content.matchAll(/(-?[\d.]+) (-?[\d.]+) Td/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  assert.ok(positions.length > 0, 'PDF-ът съдържа нарисуван текст');
  const maxW = 595.28 - 56 - 56;
  const expectedGap = (maxW - 14) / 2 + 14; // ширина на колона + междина
  const sideBySide = positions.some((a) => positions.some((b) => Math.abs(a.y - b.y) < 0.01 && Math.abs(Math.abs(b.x - a.x) - expectedGap) < 1));
  assert.ok(
    sideBySide,
    `два текста стоят на една височина с разстояние ${expectedGap.toFixed(2)} pt (колона + междина) — това е „колони“`,
  );

  // ── 7. През HTTP: същият отчет се рендира от живия сървър ────────────────────
  const server = await startServer();
  try {
    const body = {
      manifest: manifestWith([
        { id: 'logo', type: 'logo', widthMm: 30, heightMm: 12, data: 'data:image/png;base64,' + tinyPng(6, 6).toString('base64') },
        { id: 'cert', type: 'certificate', ref: 'cms', label: 'Сертификат' },
        { id: 'cols', type: 'columns', columns: [{ title: 'А', text: 'ляво' }, { title: 'Б', text: 'дясно' }] },
        { id: 'dyn', type: 'dynamic', source: 'records:1000', aggregate: 'sum', field: 1, label: 'Сума' },
      ]),
      data: { 'records:1000': rows },
      certificates: { cms: identity.certPem },
      createdAt: '2026-01-01T00:00:00Z',
    };
    const res = await server.authFetch(server.base + '/admin/api/v2/reports/render', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 201, 'отчетът с четирите обекта се рендира: ' + (await res.clone().text()).slice(0, 300));
    const pdf = Buffer.from(await res.arrayBuffer());
    const text = pdf.toString('latin1');
    assert.match(text, /\/Subtype \/Image/, 'логото е в PDF-а като картинка');
    assert.match(text, /\/Predictor 15/, 'PNG потокът е вграден');
    assert.equal(res.headers.get('x-pdf-sha256'), crypto.createHash('sha256').update(pdf).digest('hex'), 'отпечатъкът е на издадения файл');
    assert.ok(pdf.length > 20000, 'PDF-ът има съдържание (' + pdf.length + ' B)');
  } finally {
    await server.stop();
  }

  // ── 8. Панелът има реални редактори за четирите обекта ───────────────────────
  const studio = fs.readFileSync(path.join(root, 'hapi_enterprise', 'ui', 'report-studio.js'), 'utf8');
  for (const marker of ['#p-logo-w', '#p-logo-h', '#p-data', '#p-ref', '#p-aggregate', '#p-field', 'data-lcol-text', '#p-addlcol']) {
    assert.ok(studio.includes(marker), `панелът трябва да има поле ${marker}`);
  }
  assert.match(studio, /item\.status === 'planned'/, 'заключването в библиотеката зависи от статуса в регистъра, не от списък на ръка');

  console.log(
    'PASS report-objects-real: лого (PNG ' +
    png.length +
    ' B, ' +
    shownWidth.toFixed(1) +
    '×' +
    shownHeight.toFixed(1) +
    ' pt, таван 18 мм) · сертификат ' +
    real.subject.replace(/\n/g, ' ') +
    ' · колони на ' +
    expectedGap.toFixed(1) +
    ' pt една от друга · динамичен блок 3 реда → сума 61.5 · HTTP 201 (' +
    logoPdf.length +
    ' B локално)',
  );
})().catch((e) => {
  console.error('FAIL report-objects-real:', e && e.message ? e.message : e);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
});
