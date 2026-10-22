'use strict';
// Няма празни или имитиращи функции в кода, който се доставя.
//
// Правилата са тесни и проверяеми:
//   • никакви TODO / FIXME / XXX / HACK — „по-късно“ не е състояние на кода;
//   • никакви „not implemented“ / „заглушка“ / „coming soon“ (думата „скоро“ се хваща
//     отделно с граница на думата, за да не съвпада в „скорост“);
//   • никакви празни тела на именувани функции: `function f() {}`;
//   • празните стрелки `=> {}` са позволени само като `.catch(() => {})` (съзнателно
//     поглъщане на грешка) или на трите изброени места с обяснение по-долу.
//
// Демо режимът на files-manager НЕ е имитация: пуска се само при липса на връзка и
// съобщава „Демо: … (само в интерфейса)“; тестът пази точно този надпис.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = [
  ...fs.readdirSync(path.join(root, 'hapi_enterprise')).filter((f) => f.endsWith('.js')).map((f) => 'hapi_enterprise/' + f),
  ...fs.readdirSync(path.join(root, 'hapi_enterprise', 'ui')).filter((f) => f.endsWith('.js')).map((f) => 'hapi_enterprise/ui/' + f),
];

// Празни тела, които са нарочни. Ключът е „файл:ред“, за да не се плъзне allowlist-ът.
const ALLOWED_EMPTY = new Map([
  ['hapi_enterprise/logger.js', 'close: () => {}'],
  ['hapi_enterprise/cabinet.js', "child.on('error'"],
  ['hapi_enterprise/ui/files-manager.js', 'demoMutate(`качен ${name}`, () => {})'],
]);

const problems = [];
let scanned = 0;
let emptyArrows = 0;

for (const rel of files) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  scanned += text.split('\n').length;

  for (const m of text.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) problems.push(`${rel}: маркер ${m[1]}`);
  for (const m of text.matchAll(/not implemented|coming soon|заглушка/gi)) problems.push(`${rel}: „${m[0]}“`);
  for (const m of text.matchAll(/\bскоро\b/gi)) problems.push(`${rel}: „${m[0]}“ (обещание вместо код)`);
  for (const m of text.matchAll(/function [A-Za-z0-9_$]+\([^)]*\)\s*\{\s*\}/g)) problems.push(`${rel}: празна функция ${m[0].slice(0, 40)}`);

  for (const m of text.matchAll(/=>\s*\{\s*\}/g)) {
    emptyArrows += 1;
    const line = text.slice(text.lastIndexOf('\n', m.index) + 1, text.indexOf('\n', m.index));
    if (/\.catch\(\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)?\s*=>\s*\{\s*\}/.test(line)) continue;
    const allowed = [...ALLOWED_EMPTY.entries()].some(([file, snippet]) => file === rel && line.includes(snippet));
    if (!allowed) problems.push(`${rel}: празна стрелка без обяснение → ${line.trim().slice(0, 80)}`);
  }
}

assert.deepEqual(problems, [], `празни или имитиращи функции:\n  ${problems.join('\n  ')}`);

// Демо режимът трябва да остане ЯВНО надписан, ако съществува.
const filesManager = fs.readFileSync(path.join(root, 'hapi_enterprise/ui/files-manager.js'), 'utf8');
if (filesManager.includes('demoMutate')) {
  assert.match(filesManager, /Демо: \$\{message\} \(само в интерфейса\)/, 'демо режимът трябва да се обявява на потребителя');
  assert.match(filesManager, /if \(!connected\(\)\)/, 'демо режимът се пуска само без връзка');
}

console.log(`PASS no-stubs: ${files.length} файла · ${scanned} реда · ${emptyArrows} празни стрелки, всичките законни`);
