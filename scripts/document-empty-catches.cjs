'use strict';
// Еднократен инструмент: добавя КОНКРЕТНА причина във всеки празен `catch` в издавания код.
// Пуска се веднъж; остава в repo, за да е ясно как са поставени причините.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PLAN = {
  'hapi_enterprise/admin.js': {
    756: 'тялото на грешката може да не е JSON — остава HTTP кодът',
    1052: 'грешката вече се показва от action(); тук само спираме',
    1116: 'панелът е допълнителен: липсата му не е грешка',
    1117: 'диагностиката е по избор — липсва ли, KPI-тата остават',
    1177: 'localStorage може да е забранен — остава системната тема',
    1178: 'matchMedia липсва при стари браузъри — остава светла тема',
    1180: 'localStorage може да е забранен — темата не се помни',
  },
  'hapi_enterprise/cabinet.js': {
    37: 'един нечетим запис не бива да спира целия списък',
  },
  'hapi_enterprise/gateway-api.js': {
    180: 'chmod не е задължителен на всички файлови системи',
  },
  'hapi_enterprise/job-manager.js': {
    94: 'липсваща папка значи „няма запазени задачи“',
  },
  'hapi_enterprise/retention.js': {
    14: 'повреден одитен ред не се брои за изтекъл',
  },
  'hapi_enterprise/server.js': {
    392: 'файл, изчезнал между readdir и stat, се прескача',
    608: 'заглавките може вече да са изпратени — логът не бива да чупи отговора',
    617: 'логът на заявката не бива да чупи отговора',
    910: 'архив, изчезнал между readdir и stat, се прескача',
    1039: 'недостъпно за запис хранилище е валиден резултат (checks.storage=false)',
    1109: 'кандидатът просто не съществува — търсим следващия',
    1148: 'липсващ или повреден манифест значи празен обект',
    1797: 'повреден TSA запис се прескача, останалите се показват',
    2345: 'липсващ мета файл значи „няма роля“',
    2375: 'ENOENT значи „още не е стартиран“ — това е очакваното',
    2376: 'липсващи опции значат празен обект (първи старт)',
  },
  'hapi_enterprise/standalone.js': {
    89: 'унищожаването на вече затворена заявка не е грешка',
    112: 'процесът може вече да е спрял — kill хвърля',
    117: 'процесът може вече да е спрял — kill хвърля',
  },
};

const CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;

let changed = 0;
for (const [rel, lines] of Object.entries(PLAN)) {
  const file = path.join(ROOT, rel);
  const src = fs.readFileSync(file, 'utf8').split('\n');
  for (const [lineNo, reason] of Object.entries(lines)) {
    const index = Number(lineNo) - 1;
    const line = src[index];
    if (!line) throw Error(`${rel}:${lineNo} не съществува`);
    if (!CATCH.test(line)) {
      console.log(`· ${rel}:${lineNo} вече е с обяснение — пропускам`);
      continue;
    }
    src[index] = line.replace(CATCH, (m) => {
      const param = /catch\s*(\([^)]*\))/.exec(m);
      return `catch ${param ? param[1] + ' ' : ''}{ /* ${reason} */ }`;
    });
    changed++;
  }
  fs.writeFileSync(file, src.join('\n'));
  console.log(`${rel}: обновени редове ${Object.keys(lines).join(', ')}`);
}
console.log(`общо поправени празни catch-ове: ${changed}`);
