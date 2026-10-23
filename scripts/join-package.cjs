'use strict';
// Слепване на разделен експортен пакет БЕЗ add-on.
//
//   node scripts/join-package.cjs <първа част | папка> [изходен файл] [--sha256 <хеш>]
//
// Частите са `<име>.part001`, `<име>.part002`, … и се разпознават по име, не по ред в
// списъка на папката — иначе „part10“ може да влезе преди „part2“. След слепването
// скриптът отпечатва sha256; с `--sha256` го сверява с очаквания (от `split.parts[]` в
// метаданните). Ако пакетът е и криптиран, следва да се пусне и decrypt-package.cjs.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function usage(message) {
  if (message) process.stderr.write(`Грешка: ${message}\n`);
  process.stderr.write('Употреба: node scripts/join-package.cjs <първа част | папка> [изходен файл] [--sha256 <хеш>]\n');
  process.exitCode = 2;
}

/** Частите, подредени по номера от името им. */
function collect(target) {
  const dir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
  const base = fs.statSync(target).isDirectory() ? null : path.basename(target).replace(/\.part\d+$/i, '');
  const names = fs.readdirSync(dir).filter((n) => (base ? n.startsWith(`${base}.part`) : /\.part\d+$/i.test(n)));
  const parts = names
    .map((name) => {
      const m = /\.part(\d+)$/i.exec(name);
      return m ? { name, index: Number(m[1]), file: path.join(dir, name) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
  // Липсваща част не се подменя мълчаливо: по-добре грешка, отколкото тихо счупен файл.
  parts.forEach((p, i) => {
    if (p.index !== i + 1) throw new Error(`липсва част ${i + 1} (намерена е ${p.name})`);
  });
  return parts;
}

function main(argv) {
  const args = argv.filter((a) => a !== '--sha256' && !/^--sha256=/.test(a));
  const expectFlag = argv.findIndex((a) => a === '--sha256');
  const expectInline = argv.find((a) => /^--sha256=/.test(a));
  const expected = (expectFlag >= 0 ? argv[expectFlag + 1] : expectInline ? expectInline.split('=')[1] : '').toLowerCase();
  const target = args[0];
  if (!target) return usage('липсва първа част или папка');
  if (!fs.existsSync(target)) return usage(`няма такъв файл или папка: ${target}`);

  const parts = collect(target);
  if (!parts.length) return usage('не са намерени части (.part001, .part002, …)');
  const out = args[1] || path.join(path.dirname(parts[0].file), path.basename(parts[0].file).replace(/\.part\d+$/i, ''));

  const outFile = fs.openSync(out, 'w');
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    for (const part of parts) {
      const buf = fs.readFileSync(part.file);
      fs.writeSync(outFile, buf);
      hash.update(buf);
      bytes += buf.length;
    }
  } finally {
    fs.closeSync(outFile);
  }

  const sha256 = hash.digest('hex');
  process.stdout.write(`слепени: ${parts.length} части → ${out}\nразмер: ${bytes} B\nsha256: ${sha256}\n`);
  if (expected && expected !== sha256) {
    process.stderr.write(`Грешка: sha256 не съвпада (очакван ${expected})\n`);
    process.exitCode = 4;
    return undefined;
  }
  if (expected) process.stdout.write('sha256 съвпада с очаквания.\n');
  return undefined;
}

try {
  main(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`Грешка: ${e.message}\n`);
  process.exitCode = 1;
}
