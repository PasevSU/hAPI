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
  return pdfWriter.render(blocks, { title: `hAPI report — ${manifest.profile}`.slice(0, 200), watermark });
}

module.exports = { toPdfBlocks, renderPdf, PLACEHOLDER };
