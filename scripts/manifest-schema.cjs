'use strict';
// `config/schemas/manifest.schema.json` — ГЕНЕРИРАН ОТ КОДА.
//
// Защо: `report-manifest.js` отдавна има `schema()`, тоест договорът съществува, но само
// като обект в паметта. План 18 §7 иска файл, който външен инструмент (редактор, валидатор,
// чужда интеграция) да може да прочете без да пуска hAPI. Файл, писан на ръка, обаче се
// разминава с `validate()` — затова тук се записва СТРАНИЧНИЯТ резултат на `schema()`, а
// `tests/manifest-schema.cjs` проверява, че файлът е байт-байт равен на него.
//
// Съзнателна граница: JSON Schema описва СТРУКТУРАТА. Пълната семантика (rfc3161-start е
// първи, rfc3161-stop е последен и заключен, уникални id, забранени TSA/подпис полета) остава
// във `validate()` — тя не се изразява с стандартни ключове и не се дублира тук, за да няма
// втори източник на истина, който да противоречи на първия.
//
// Употреба:
//   node scripts/manifest-schema.cjs            # записва файла
//   node scripts/manifest-schema.cjs --check    # само проверява (код 1 при разлика)
//   node scripts/manifest-schema.cjs --out=ПЪТ  # записва другаде (за тестове)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'config', 'schemas', 'manifest.schema.json');

const ARGS = process.argv.slice(2);
const argValue = (name) => {
  const hit = ARGS.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : '';
};
const CHECK = ARGS.includes('--check');
const OUT = argValue('out') ? path.resolve(argValue('out')) : TARGET;

// LF навсякъде: файлът се сравнява байт-байт, а CRLF би направил разликата невидима.
function render() {
  const { schema } = require(path.join(ROOT, 'hapi_enterprise', 'report-manifest.js'));
  return JSON.stringify(schema(), null, 2) + '\n';
}

function main() {
  let body;
  try {
    body = render();
  } catch (error) {
    console.error('manifest-schema: не може да се построи схема от кода — ' + error.message);
    process.exitCode = 1;
    return;
  }

  if (CHECK) {
    if (!fs.existsSync(OUT)) {
      console.error('manifest-schema: липсва ' + path.relative(ROOT, OUT) + ' — пусни без --check');
      process.exitCode = 1;
      return;
    }
    const disk = fs.readFileSync(OUT, 'utf8');
    if (disk !== body) {
      console.error('manifest-schema: ' + path.relative(ROOT, OUT) + ' се разминава с кода — пусни без --check');
      process.exitCode = 1;
      return;
    }
    console.log('manifest-schema: файлът е актуален (' + path.relative(ROOT, OUT) + ')');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body, 'utf8');
  console.log('manifest-schema: записан ' + path.relative(ROOT, OUT) + ' (' + body.length + ' знака)');
}

main();
