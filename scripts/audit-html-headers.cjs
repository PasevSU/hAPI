'use strict';
// ВСЕКИ HTML ОТГОВОР НОСИ ПЪЛНИЯ НАБОР ЗАГЛАВКИ — ЕДНО МЯСТО, КОЕТО ГО ПРОВЕРЯВА (0.69.225).
//
// Защо съществува: заглавките се пишеха на ръка във всеки `res.writeHead`. Тайната страница
// имаше `Referrer-Policy: no-referrer`, а други страници — не; при подписан адрес
// (`?expires=&sig=`) и при тайна връзка (`/t/<token>`) това значи, че адресът може да изтече
// през `Referer`. Днес класът е покрит, но никой не го пазеше: нов HTML отговор можеше да
// излезе без заглавки и нито един тест нямаше да го види. Скриптът проверява ТЯЛОТО на
// header обекта на всеки `res.writeHead(` (с балансирани скоби, за да не се хваща таблицата
// `UI_FILES`, която само споменава `text/html`).
//
//   node scripts/audit-html-headers.cjs          # отчет
//   node scripts/audit-html-headers.cjs --check  # код 1 при липсваща заглавка
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const addon = path.join(root, 'hapi_enterprise');

/** Всички заглавки, които един HTML отговор трябва да носи, и защо. */
const REQUIRED = {
  'Cache-Control': 'страница с подписан адрес не бива да остава в кеша',
  'Content-Security-Policy': 'без политика страницата пуска всичко',
  'Referrer-Policy': 'адресът с ?expires=&sig= или /t/<token> не бива да изтича през Referer',
  'X-Content-Type-Options': 'браузърът не бива да гадае типа',
};

/** Скоби от `(` до съответната `)` — за да се вземе ЦЕЛИЯТ обект на writeHead. */
function callBody(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return text.slice(openIndex);
}

/** HTML отговорите във файл: `{ line, body, missing }`. */
function auditText(text) {
  const out = [];
  const re = /res\.writeHead\s*\(/g;
  let match;
  while ((match = re.exec(text))) {
    const body = callBody(text, match.index + match[0].length - 1);
    if (!/text\/html/.test(body)) continue;
    const line = text.slice(0, match.index).split('\n').length;
    const missing = Object.keys(REQUIRED).filter((header) => !new RegExp("['\"]?" + header + "['\"]?\\s*:").test(body));
    out.push({ line, missing });
  }
  return out;
}

function files() {
  const list = [path.join(addon, 'server.js')];
  for (const dir of ['routes', 'server_module', 'core_module']) {
    const full = path.join(addon, dir);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full).filter((f) => f.endsWith('.js'))) list.push(path.join(full, name));
  }
  return list;
}

function main() {
  const check = process.argv.includes('--check');
  const rows = [];
  for (const file of files()) {
    for (const hit of auditText(fs.readFileSync(file, 'utf8'))) {
      rows.push({ where: path.relative(root, file).split(path.sep).join('/') + ':' + hit.line, missing: hit.missing });
    }
  }
  const bad = rows.filter((r) => r.missing.length);
  if (!check) {
    for (const row of rows) {
      process.stdout.write(`${row.missing.length ? '✘' : '✔'} ${row.where}${row.missing.length ? ' — липсва: ' + row.missing.join(', ') : ''}\n`);
    }
  }
  process.stdout.write(
    `audit-html-headers: ${rows.length} HTML отговора · ${rows.length - bad.length} с пълния набор · ${bad.length} без\n`,
  );
  if (bad.length) {
    for (const row of bad) process.stdout.write(`  ${row.where}: липсва ${row.missing.map((h) => h + ' (' + REQUIRED[h] + ')').join('; ')}\n`);
    if (check) return 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { auditText, REQUIRED };
