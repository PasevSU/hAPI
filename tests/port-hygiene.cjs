'use strict';
// ОРАКУЛ: нито един тест не вързва порт, който сам е избрал.
//
// Защо: Windows пази диапазони от портове за Hyper-V/WinNAT. Днес (16.11.2026) това бяха
// 18309–18508, тоест почти целият диапазон 18xxx, който тестовете ползваха. `listen` върху
// резервиран порт връща EACCES и тестът пада заради средата, не заради кода — така 34 теста
// „почервеняха“ при зелен код. Диапазоните се менят (Docker/WSL ги взимат при старт), затова
// фиксиран номер не е договор, а бомба с часовников механизъм.
//
// Правилото: порт се взима от `freePort()` в tests/helpers.cjs — тя проверява реално дали
// номерът може да се върже, пази вече дадените в процеса и избягва забранените за `fetch`.
// Единственото изключение е `'0'` (ефимерен порт от ядрото), защото той не е избор на теста.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIRS = [__dirname, path.join(__dirname, 'lib')];
const SELF = path.basename(__filename);

// Декларация на порт: `const pub = 18421`, `const PORT = 18440`, `pub=18311`, `port = 18001`
const DECL = [
  /\bconst\s+(?:PORT|port|pub|adm|mpub|publicPort|adminPort|PUB|ADM)\s*=\s*\d{2,5}\s*;/,
  /\b(?:pub|adm|mpub|port|PORT|publicPort|adminPort)\s*=\s*\d{2,5}\s*[,;]/,
  /\b(?:PORT|ADMIN_PORT|PUBLIC_GATEWAY_PORT|GATEWAY_PORT)\s*:\s*'(\d{2,5})'/,
];

const list = [];
for (const dir of DIRS) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.cjs')) continue;
    if (name === SELF) continue;
    list.push(path.join(dir, name));
  }
}
assert.ok(list.length > 300, 'намерени са само ' + list.length + ' теста — проверката гледа в грешна посока');

const findings = [];
for (const file of list) {
  const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (/^\s*\/\//.test(line)) return; // коментар
    if (/\bassert\b/.test(line)) return; // твърдение върху текст/заглавка, не вързване
    for (const re of DECL) {
      const m = re.exec(line);
      if (!m) continue;
      const number = Number(m[1] || (line.match(/=\s*(\d{2,5})\s*[,;]/) || [])[1] || 0);
      if (number === 0) continue; // '0' = ефимерен порт, избран от ядрото — позволено
      findings.push(`${rel}:${index + 1}: ${line.trim()}`);
      break;
    }
  });
}

assert.deepEqual(
  findings,
  [],
  'портът се взима от freePort(), не се изписва: ' + findings.slice(0, 6).join(' · '),
);

// Обратната посока: помощта наистина отбягва изключените диапазони на Windows.
const helpers = fs.readFileSync(path.join(__dirname, 'helpers.cjs'), 'utf8');
assert.match(helpers, /excludedportrange/, 'freePort() трябва да обяснява защо избягва изключени диапазони');
assert.match(helpers, /async function freePort\(/, 'freePort() трябва да е налична в tests/helpers.cjs');
assert.match(helpers, /handedOut/, 'freePort() пази вече дадените портове в процеса');

console.log(
  'PASS port-hygiene: ' + list.length + ' теста без изписан порт · портът идва от freePort() · изключените диапазони на Windows са отчетени',
);
