'use strict';
// Възобновяване на прекъснат трансфер на експортен пакет (или който и да е файл с Range).
//
//   node scripts/resume-package.cjs <url> <изходен файл> --token <токен> [--sha256 <хеш>]
//
// Как работи:
//   1. ако изходният файл вече съществува и до него има `<файл>.resume.json` със същия
//      адрес и ETag, тегленето продължава от текущия размер (`Range: bytes=N-`);
//   2. ETag се подава като `If-Range` — ако пакетът на сървъра е друг, сървърът връща
//      ЦЕЛИЯ файл (200) вместо 206 и ние започваме отначало, вместо да слепим две
//      различни съдържания;
//   3. накрая се сверява sha256 на целия файл.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function usage(message) {
  if (message) process.stderr.write(`Грешка: ${message}\n`);
  process.stderr.write('Употреба: node scripts/resume-package.cjs <url> <изходен файл> --token <токен> [--sha256 <хеш>]\n');
  process.exitCode = 2;
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : '';
}

const sidecar = (out) => `${out}.resume.json`;

function readState(out) {
  try {
    const state = JSON.parse(fs.readFileSync(sidecar(out), 'utf8'));
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null; // няма състояние → започваме отначало
  }
}

function writeState(out, state) {
  fs.writeFileSync(sidecar(out), JSON.stringify(state, null, 2), { mode: 0o600 });
}

async function main(argv) {
  const url = argv[0];
  const out = argv[1];
  if (!url || !out) return usage('липсват адрес и изходен файл');
  const token = arg(argv, 'token') || process.env.HAPI_TOKEN || '';
  const expected = (arg(argv, 'sha256') || '').toLowerCase();
  const auth = token ? { Authorization: `Bearer ${token}` } : {};

  // Колко вече имаме — САМО ако състоянието сочи същия адрес и същия ETag.
  const state = readState(out);
  const existing = fs.existsSync(out) ? fs.statSync(out).size : 0;
  let start = state && state.url === url && existing > 0 ? existing : 0;
  const knownEtag = state && state.url === url ? String(state.etag || '') : '';

  const headers = { ...auth };
  if (start > 0) {
    headers.Range = `bytes=${start}-`;
    if (knownEtag) headers['If-Range'] = knownEtag;
  }
  const res = await fetch(url, { headers });
  if (res.status !== 200 && res.status !== 206) return usage(`сървърът върна ${res.status}`);

  const etag = res.headers.get('etag') || '';
  // 200 при поискан Range значи „файлът е друг“ (If-Range не съвпада) → започваме от 0.
  const restart = start > 0 && res.status === 200;
  if (restart) start = 0;
  const total = Number((/^bytes \d+-\d+\/(\d+)$/.exec(res.headers.get('content-range') || '') || [])[1]) || start + Number(res.headers.get('content-length') || 0);

  const body = Buffer.from(await res.arrayBuffer());
  if (start > 0 && res.status === 206) fs.appendFileSync(out, body);
  else fs.writeFileSync(out, body);
  if (etag) writeState(out, { url, etag, size: total });

  const file = fs.readFileSync(out);
  const sha256 = crypto.createHash('sha256').update(file).digest('hex');
  const complete = file.length === total;
  process.stdout.write(`${JSON.stringify({ file: path.basename(out), bytes: file.length, total, resumedFrom: restart ? 0 : start, restart, etag, complete, sha256 }, null, 2)}\n`);
  if (!complete) {
    process.stderr.write('Грешка: файлът е непълен — пусни скрипта отново, за да продължи\n');
    process.exitCode = 5;
    return undefined;
  }
  if (expected && expected !== sha256) {
    process.stderr.write(`Грешка: sha256 не съвпада (очакван ${expected})\n`);
    process.exitCode = 4;
  }
  return undefined;
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`Грешка: ${e.message}\n`);
  process.exitCode = 1;
});
