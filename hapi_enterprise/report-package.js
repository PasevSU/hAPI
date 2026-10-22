'use strict';
// ПАКЕТ С ДОКАЗАТЕЛСТВА от манифест на отчет (W7).
//
// Пакетът е ZIP с точно това, което съществува — и с изричен статус какво липсва:
//   report.pdf            готовият PDF (рендиран от същия манифест или подаден от клиента)
//   manifest.json         манифестът, от който е произлязъл отчетът
//   evidence.json         статус, отпечатъци, кои артефакти липсват, произход
//   tsa/start.tsr         RFC 3161 токен за START (ако има)
//   tsa/stop.tsr          RFC 3161 токен за STOP (ако има)
//   signature.p7s         detached CMS/PKCS#7 подпис (ако има)
//   SHA256SUMS.txt        суми на всичко по-горе (за `sha256sum -c`)
//
// Статусът НЕ се закръгля нагоре:
//   READY      — има START и STOP токени (и подпис, ако е поискан);
//   INCOMPLETE — липсва поне един артефакт; липсите са изброени в `evidence.missing`;
//   DRAFT      — чернова: не се подпечатва и не се представя за завършена.
// „Доверие“ не се твърди: то зависи от TSA доставчика и от издателя на сертификата.
const crypto = require('node:crypto');
const ooxml = require('./ooxml');
const manifests = require('./report-manifest');

const FORMAT = 'hapi-evidence-v1';
const READY = 'READY';
const INCOMPLETE = 'INCOMPLETE';
const DRAFT = 'DRAFT';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function safeName(value, fallback) {
  const cleaned = String(value == null ? '' : value)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 48);
  return cleaned || fallback;
}

function stampName(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/**
 * Какво съдържа пакетът и какъв е статусът му.
 * @param {{draft?:boolean, stamps?:object|null, cms?:{requested?:boolean, p7s?:Buffer|null}|null}} input
 */
function classify({ draft, stamps, cms }) {
  if (draft) return { status: DRAFT, missing: [], note: 'Чернова: не е подпечатана и не се представя за завършена.' };
  const missing = [];
  const startToken = stamps && stamps.start && stamps.start.token ? stamps.start.token : null;
  const stopToken = stamps && stamps.stop && stamps.stop.token ? stamps.stop.token : null;
  if (!startToken) missing.push('START токен (RFC 3161)');
  if (!stopToken) missing.push('STOP токен (RFC 3161)');
  if (cms && cms.requested && !cms.p7s) missing.push('CMS подпис (PKCS#7)');
  return {
    status: missing.length ? INCOMPLETE : READY,
    missing,
    note: missing.length
      ? 'Диагностичен пакет: липсващите артефакти са изброени в missing. Не е криптографски завършен.'
      : 'START и STOP токените са налични' + (cms && cms.requested ? ', подписът също' : '') + '. Доверието зависи от TSA доставчика и издателя на сертификата.',
  };
}

/**
 * Строи ZIP пакета в паметта.
 * @returns {{zip:Buffer, name:string, evidence:object}}
 */
function build({ manifest, pdf, stamps = null, cms = null, draft = false, createdAt = null } = {}) {
  if (!pdf || !Buffer.isBuffer(pdf) || !pdf.length) throw Object.assign(new Error('липсва PDF за пакета'), { status: 400 });
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('файлът не е PDF'), { status: 400 });

  const digest = manifests.digest(manifest) || '';
  const pdfSha256 = sha256(pdf);
  const verdict = classify({ draft, stamps, cms });
  const at = createdAt || new Date().toISOString();

  const evidence = {
    format: FORMAT,
    status: verdict.status,
    missing: verdict.missing,
    note: verdict.note,
    createdAt: at,
    manifestSha256: digest,
    pdfSha256,
    tsa: {
      start: stamps && stamps.start && stamps.start.token ? { sha256: stamps.start.token.sha256 || null, genTime: stamps.start.token.genTime || null, url: stamps.start.url || '' } : null,
      stop: stamps && stamps.stop && stamps.stop.token ? { sha256: stamps.stop.token.sha256 || null, genTime: stamps.stop.token.genTime || null, url: stamps.stop.url || '' } : null,
      closingDigest: (stamps && stamps.closingDigest) || null,
    },
    cms: cms && cms.p7s ? { sha256: sha256(cms.p7s), detached: true } : null,
  };

  const entries = [
    { name: 'report.pdf', data: pdf },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
    { name: 'evidence.json', data: Buffer.from(JSON.stringify(evidence, null, 2), 'utf8') },
  ];
  const startDer = stamps && stamps.start && stamps.start.tokenDer ? Buffer.from(stamps.start.tokenDer) : null;
  const stopDer = stamps && stamps.stop && stamps.stop.tokenDer ? Buffer.from(stamps.stop.tokenDer) : null;
  if (startDer && startDer.length) entries.push({ name: 'tsa/start.tsr', data: startDer });
  if (stopDer && stopDer.length) entries.push({ name: 'tsa/stop.tsr', data: stopDer });
  if (cms && cms.p7s) entries.push({ name: 'signature.p7s', data: Buffer.from(cms.p7s) });
  const sums = entries.map((entry) => `${sha256(entry.data)}  ${entry.name}`).join('\n') + '\n';
  entries.push({ name: 'SHA256SUMS.txt', data: Buffer.from(sums, 'utf8') });

  const profile = safeName(manifest && manifest.profile, 'default');
  return {
    zip: ooxml.zip(entries),
    name: `report-${profile}-${verdict.status}-${stampName(new Date(at))}.zip`,
    evidence,
  };
}

module.exports = { build, classify, FORMAT, READY, INCOMPLETE, DRAFT };
