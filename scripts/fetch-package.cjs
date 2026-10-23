'use strict';
// Паралелно теглене на експортен пакет (или който и да е файл с Range поддръжка).
//
//   node scripts/fetch-package.cjs <url> <изходен файл> --token <токен> [--parallel 4] [--sha256 <хеш>]
//
// Защо паралелно: единствен поток е ограничен от латентността на връзката, а не от
// честотната лента. Четири Range заявки свалят едновременно различни части от файла и се
// записват на точното им място — затова паметта не расте с размера на файла.
// Ако сървърът не поддържа Range (няма `Accept-Ranges: bytes`), скриптът слиза до един поток.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_PARALLEL = 8;

function usage(message) {
  if (message) process.stderr.write(`Грешка: ${message}\n`);
  process.stderr.write('Употреба: node scripts/fetch-package.cjs <url> <изходен файл> --token <токен> [--parallel 4] [--sha256 <хеш>]\n');
  process.exitCode = 2;
}

function arg(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : '';
}

// Проба с Range 0-0 вместо HEAD: сървърът маршрутизира само GET, а частичната заявка
// дава и размера (Content-Range), и поддръжката на Range — без да тегли файла.
// Тялото се ЧЕТЕ докрай (1 байт), а не се прекратява: прекратен отговор оставя
// полуотворена връзка в пула на клиента и следващата заявка пада с „fetch failed“.
async function probe(url, token) {
  const res = await fetch(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Range: 'bytes=0-0' } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`пробата върна ${res.status}`);
  const range = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(res.headers.get('content-range') || '');
  const size = range ? Number(range[1]) : Number(res.headers.get('content-length')) || 0;
  const info = {
    size,
    ranges: res.status === 206 || (res.headers.get('accept-ranges') || '').toLowerCase().includes('bytes'),
    chunks: Number(res.headers.get('x-parallel-chunks')) || 0,
  };
  await res.arrayBuffer(); // прочитаме 1-2 байта, за да не остане висяща връзка
  return info;
}

async function fetchRange(url, token, start, end) {
  const res = await fetch(url, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Range: `bytes=${start}-${end}` } });
  if (res.status !== 206 && res.status !== 200) throw new Error(`Range ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main(argv) {
  const url = argv[0];
  const out = argv[1];
  if (!url || !out) return usage('липсват адрес и изходен файл');
  const token = arg(argv, 'token') || process.env.HAPI_TOKEN || '';
  const wanted = Number(arg(argv, 'parallel') || 4);
  const expected = (arg(argv, 'sha256') || '').toLowerCase();
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > MAX_PARALLEL) return usage(`паралелните заявки са от 1 до ${MAX_PARALLEL}`);

  const info = await probe(url, token);
  if (!info.size) return usage('сървърът не даде размер на файла');
  const parallel = info.ranges ? (info.chunks ? Math.min(wanted, info.chunks) : wanted) : 1;
  const chunk = Math.ceil(info.size / parallel);

  fs.writeFileSync(out, Buffer.alloc(0));
  const handle = fs.openSync(out, 'r+');
  let done = 0;
  const parts = [];
  try {
    fs.ftruncateSync(handle, info.size);
    for (let i = 0; i < parallel; i++) {
      const start = i * chunk;
      const end = Math.min(info.size, start + chunk) - 1;
      if (start > end) continue;
      parts.push({ i, start, end });
    }
    // Всички заявки вървят едновременно; всяка пише на своето място (не се редуват в паметта).
    // Нарочно `for … of` вместо `parts.map(async …)`: map с async не се изчаква сам и
    // грешките се губят — затова обещанията се събират изрично и се изчакват с Promise.all.
    const pending = [];
    for (const p of parts) {
      pending.push(
        fetchRange(url, token, p.start, p.end).then((buf) => {
          fs.writeSync(handle, buf, 0, buf.length, p.start);
          done += buf.length;
          return { index: p.i + 1, start: p.start, end: p.end, bytes: buf.length };
        }),
      );
    }
    const results = await Promise.all(pending);
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(out));
    const sha256 = hash.digest('hex');
    process.stdout.write(`${JSON.stringify({ file: path.basename(out), size: info.size, parallel, chunks: results, bytes: done, sha256 }, null, 2)}\n`);
    if (expected && expected !== sha256) {
      process.stderr.write(`Грешка: sha256 не съвпада (очакван ${expected})\n`);
      process.exitCode = 4;
    }
  } finally {
    fs.closeSync(handle);
  }
  return undefined;
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`Грешка: ${e.message}\n`);
  process.exitCode = 1;
});
