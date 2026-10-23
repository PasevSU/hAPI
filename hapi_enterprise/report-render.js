'use strict';
// Фаза 11 / RS-03: манифест → PDF чрез собствения pdf-writer (без външни зависимости).
//
// Правила (ADR-0025):
//  - манифестът се валидира преди рендер (заключени START/STOP, без TSA/подпис полета);
//  - блокът „Подпис“ се рендира като „не е издаден“ — никакъв фалшив сертификат;
//  - PDF writer-ът е A4/portrait; други формати се отхвърлят явно, не се премълчават.

const M = require('./report-manifest');
const pdfWriter = require('./pdf-writer');

const PLACEHOLDER = '—';
// Текстът по подразбиране за „Правна декларация“: казва каквото е вярно за всеки отчет,
// без да обещава заверка, която системата не извършва. Блокът може да се замени със свой
// текст — тогава се печата той.
const LEGAL_DEFAULT =
  'Документът е издаден от електронната система hAPI Enterprise и отразява данните към момента на издаване. ' +
  'Произходът на съдържанието се проверява по SHA-256 на манифеста, посочен в отчета. ' +
  'Заверка на самоличност и на ръчен подпис се извършва извън системата, освен ако в отчета изрично не е отбелязано друго.';

function bad(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function jpegFrom(block) {
  const raw = block && (block.data || block.dataUrl);
  if (typeof raw !== 'string' || !raw) return null;
  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  try {
    const buf = Buffer.from(base64, 'base64');
    return buf.length && buf[0] === 0xff && buf[1] === 0xd8 ? buf : null;
  } catch {
    return null;
  }
}

// Системни данни: факти, които сървърът знае за СЕБЕ СИ (версия, среда, съхранение).
// Без подадени стойности се печата „—“ — отчетът няма да измисли версия или път.
// Пътищата идват само относителни: абсолютен път не бива да изтича в документ.
function systemRows(manifest, options) {
  const s = (options && options.system) || {};
  const rows = [['Показател', 'Стойност']];
  const add = (key, value) => {
    const shown = value === null || value === undefined || value === '' ? PLACEHOLDER : String(value);
    rows.push([key, shown]);
  };
  add('Система', s.product || 'hAPI Enterprise');
  add('Версия', s.version);
  add('Схема на манифеста', `report-studio/v${manifest.schemaVersion === undefined ? 1 : manifest.schemaVersion}`);
  add('Профил', manifest.profile);
  add('Издаден', s.issuedAt);
  add('Среда', s.node);
  add('База данни', s.database);
  add('Времеви печат (TSA)', s.tsa);
  add('Блокове', Array.isArray(manifest.blocks) ? manifest.blocks.length : 0);
  return rows;
}

// data: { "records:1000": [["Иван", "..."], ...] }  (без заглавен ред)
function tableRows(block, data) {
  const columns = (Array.isArray(block.columns) ? block.columns : []).map(String);
  const source = String(block.source || '');
  const provided = data && Array.isArray(data[source]) ? data[source] : null;
  const body = provided && provided.length
    ? provided.map((row) => (Array.isArray(row) ? row.map((c) => (c == null ? '' : String(c))) : [String(row)]))
    : [columns.map(() => PLACEHOLDER)];
  return [columns.length ? columns : ['Колона'], ...body];
}

function toPdfBlocks(manifest, options = {}) {
  const data = options.data && typeof options.data === 'object' ? options.data : {};
  const hashes = options.hashes && typeof options.hashes === 'object' ? options.hashes : {};
  // RS-05: реалните RFC 3161 записи идват от `report-stamp.stampReport()`. Когато ги няма,
  // отчетът остава с честното изречение „не е издаден“ — нищо не се дописва.
  const stamps = options.stamps && typeof options.stamps === 'object' ? options.stamps : null;
  const stampRows = (phase) => {
    const section = stamps && stamps[phase];
    const fields = section && Array.isArray(section.fields) ? section.fields : null;
    return fields && fields.length ? [['Поле', 'Стойност'], ...fields.map((row) => [String(row[0]), String(row[1])])] : null;
  };
  const out = [];
  // RS-07: произходът на манифеста. Изчислява се веднъж и влиза В обхвата на отчета,
  // за да може издаденият PDF сам да каже по кой манифест е направен.
  const manifestSha256 = M.digest(manifest);
  const provenance = {
    type: 'table',
    header: true,
    rows: [
      ['Произход на манифеста', 'Стойност'],
      ['Схема', `report-studio/v${manifest.schemaVersion === undefined ? 1 : manifest.schemaVersion}`],
      ['Профил', String(manifest.profile || 'default')],
      ['Манифест SHA-256', manifestSha256],
      ['Блокове', String(Array.isArray(manifest.blocks) ? manifest.blocks.length : 0)],
    ],
  };
  const heading = (text) => {
    if (text) out.push({ type: 'h3', text: String(text) });
  };

  for (const block of manifest.blocks) {
    switch (block.type) {
      case M.START: {
        out.push(
          { type: 'h3', text: block.label || 'RFC 3161 START' },
          { type: 'p', text: 'Начало на криптографския обхват на отчета.' },
          provenance,
        );
        const startTable = stampRows('start');
        if (startTable) out.push({ type: 'table', header: true, rows: startTable });
        out.push({ type: 'hr' });
        break;
      }
      case M.STOP: {
        out.push({ type: 'hr' }, { type: 'h3', text: block.label || 'RFC 3161 STOP' });
        const stopTable = stampRows('stop');
        const stopIssued = Boolean(stamps && stamps.ok);
        out.push({
          type: 'p',
          text: stopIssued
            ? 'Край на криптографския обхват. STOP е подпечатан с времеви печат на TSA — виж таблицата по-долу.'
            : 'Край на криптографския обхват. Без реален отговор от TSA времеви печат не е издаден.',
        });
        if (stopTable) out.push({ type: 'table', header: true, rows: stopTable });
        break;
      }
      case 'title':
        if (block.value) out.push({ type: 'h1', text: String(block.value) });
        if (block.subtitle) out.push({ type: 'p', text: String(block.subtitle) });
        out.push({ type: 'hr' });
        break;
      case 'subtitle':
        // Заглавие на раздел: истинско `h2` в PDF-а, а не уголемен параграф — така
        // структурата на отчета се вижда и от програми, които четат PDF-а.
        out.push({ type: 'h2', text: String(block.value || block.label || 'Подзаглавие') });
        break;
      case 'pagebreak':
        // Ръчно прекъсване: pdf-writer започва нова страница на този блок.
        out.push({ type: 'pagebreak' });
        break;
      case 'legal':
        heading(block.label || 'Правна декларация');
        out.push({ type: 'p', text: block.value ? String(block.value) : LEGAL_DEFAULT });
        break;
      case 'data-block':
        heading(block.label || 'Системни данни');
        out.push({ type: 'table', header: true, rows: systemRows(manifest, options) });
        break;
      case 'text':
        heading(block.label);
        out.push({ type: 'p', text: block.value ? String(block.value) : '' });
        break;
      case 'metadata': {
        heading(block.label || 'Метаданни');
        const items = Array.isArray(block.items) ? block.items : [];
        out.push({
          type: 'table',
          header: true,
          rows: [['Поле', 'Стойност'], ...items.map((i) => [String(i.key || ''), String(i.value || '')])],
        });
        break;
      }
      case 'table':
        heading(block.label);
        out.push({ type: 'table', header: true, rows: tableRows(block, data) });
        break;
      case 'hash-table': {
        heading(block.label || 'Hash таблица');
        const algorithms = Array.isArray(block.algorithms) ? block.algorithms : [];
        out.push({
          type: 'table',
          header: true,
          rows: [['Алгоритъм', 'Стойност'], ...algorithms.map((a) => [String(a), hashes[a] || PLACEHOLDER])],
        });
        break;
      }
      case 'qr':
        // RS-06: истински векторен QR (pdf-writer го рисува като модули), плюс самият текст,
        // за да може отчетът да се чете и без скенер.
        heading(block.label);
        out.push({ type: 'qr', text: block.value ? String(block.value) : '', size: block.size, level: block.level });
        out.push({
          type: 'p',
          text: block.value ? `Съдържание на QR кода: ${String(block.value)}` : 'QR код: няма зададена стойност.',
        });
        break;
      case 'image': {
        const jpeg = jpegFrom(block);
        if (jpeg) out.push({ type: 'image', data: jpeg, width: block.width, height: block.height });
        else out.push({ type: 'p', text: `Изображение „${block.label || 'без етикет'}“: няма вградени JPEG данни.` });
        break;
      }
      case 'signature':
        // Без ключ няма подпис: казва се какво липсва, вместо да се рисува „подписано“.
        out.push(
          { type: 'hr' },
          { type: 'p', text: `${block.label || 'Подпис'}: не е издаден (изисква PKCS#7 ключ; виж ADR-0025, т. 7).` },
        );
        break;
      case 'separator':
        out.push({ type: 'hr' });
        break;
      default:
        break;
    }
  }
  return out;
}

function renderPdf(input, options = {}) {
  const manifest = M.assertValid(input || {});
  if (manifest.page.format !== 'A4') {
    throw bad(`PDF writer поддържа само A4 (заявен ${manifest.page.format}).`, 'UNSUPPORTED_PAGE_FORMAT');
  }
  if (manifest.page.orientation !== 'portrait') {
    throw bad('PDF writer поддържа само portrait ориентация.', 'UNSUPPORTED_ORIENTATION');
  }
  const blocks = toPdfBlocks(manifest, options);
  const watermark =
    options.watermark === undefined ? 'hAPI ENTERPRISE' : String(options.watermark).slice(0, 40);
  // PDF/A-3 (RS-06): вграденият файл отличава A-3 от A-2. По подразбиране се прикачва
  // самият манифест — така отчетът носи проверимия си произход вътре в себе си.
  const attachments = Array.isArray(options.attachments)
    ? options.attachments
    : [
      {
        name: 'report-manifest.json',
        description: 'Манифест на отчета (нормализиран, с отпечатък в XMP)',
        mime: 'application/json',
        data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      },
    ];
  // Датата на издаване е част от входа: при подадена стойност (`options.createdAt` или
  // `manifest.createdAt`/`generatedAt`) отчетът е ВЪЗПРОИЗВОДИМ — същият манифест дава
  // същия файл и същия отпечатък. Без нея се взима часовникът, както преди.
  const createdAt = options.createdAt || manifest.createdAt || manifest.generatedAt || null;
  return pdfWriter.render(blocks, {
    title: `hAPI report — ${manifest.profile}`.slice(0, 200),
    watermark,
    lang: String(options.lang || 'bg').slice(0, 8),
    attachments,
    createdAt,
  });
}

module.exports = { toPdfBlocks, renderPdf, PLACEHOLDER };
