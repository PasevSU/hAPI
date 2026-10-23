'use strict';
// Разшифроване на криптиран експортен пакет БЕЗ add-on.
//
//   node scripts/decrypt-package.cjs <файл.zip.enc> <парола> [изход.zip]
//   node scripts/decrypt-package.cjs <файл.zip.enc> --info
//
// Контейнерът е hapiPKG1 (виж hapi_enterprise/package-crypto.js): scrypt + AES-256-GCM,
// с всички параметри в собствения си хедър. Затова получателят се нуждае само от този
// скрипт и от папка hapi_enterprise/ до него — не и от работещ сървър, нито от мрежа.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const modulePath = path.join(__dirname, '..', 'hapi_enterprise', 'package-crypto.js');

function usage(message) {
  if (message) process.stderr.write(`Грешка: ${message}\n`);
  process.stderr.write('Употреба: node scripts/decrypt-package.cjs <файл.zip.enc> <парола> [изход.zip]\n');
  process.stderr.write('          node scripts/decrypt-package.cjs <файл.zip.enc> --info\n');
  process.exitCode = 2;
}

async function main(argv) {
  const input = argv[0];
  if (!input) return usage('липсва файл');
  if (!fs.existsSync(modulePath)) return usage(`липсва ${path.relative(process.cwd(), modulePath)} — скриптът работи от хранилището на add-on-а`);
  const pkg = require(modulePath);

  const buf = fs.readFileSync(input);
  if (!pkg.isContainer(buf)) return usage('файлът не е hapiPKG1 контейнер');

  if (argv[1] === '--info') {
    const info = pkg.info(buf);
    process.stdout.write(`${JSON.stringify({ file: path.basename(input), bytes: buf.length, ...info }, null, 2)}\n`);
    return undefined;
  }

  const password = argv[1];
  if (!password) return usage('липсва парола');
  const out = argv[2] || input.replace(/\.enc$/i, '') || `${input}.zip`;

  let plain;
  try {
    plain = await pkg.decrypt(buf, password);
  } catch (e) {
    process.stderr.write(`Грешка: ${e.message}\n`);
    process.exitCode = e.status === 401 ? 3 : 1;
    return undefined;
  }
  fs.writeFileSync(out, plain);
  const sha256 = crypto.createHash('sha256').update(plain).digest('hex');
  process.stdout.write(`разшифровано: ${out}\nразмер: ${plain.length} B\nsha256: ${sha256}\n`);
  process.stdout.write('Свери този sha256 с полето sha256 в PACKAGE_INDEX.json (то е хешът на ZIP-а преди криптиране).\n');
  return undefined;
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`Грешка: ${e.message}\n`);
  process.exitCode = 1;
});
