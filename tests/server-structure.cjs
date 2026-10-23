'use strict';
// СТРУКТУРА НА HTTP СЛОЯ: `server.js` е рутиране и общо състояние, не монолит.
//
// Защо този тест съществува: `server.js` порасна до ~3000 реда и 50 маршрута наведнъж —
// трудно за обслужване и за преглед. Затова отделните дялове се изнасят в
// `hapi_enterprise/routes/<дял>.js` с ЕДНАКЪВ договор:
//
//   module.exports = { create(deps) }  →  { handle({ req, res, url, parts, method }) }
//   handle връща true  → заявката е за този компонент и е приключена;
//   handle връща false → следващият компонент я поема.
//
// Тестът пази три неща:
//   1. всеки компонент спазва договора (иначе диспечерът мълчаливо пропуска заявки);
//   2. компонентът не влиза в съседа си (`require('./…')` от `routes/` гледа в routes/,
//      а не в hapi_enterprise/ — точно това счупи отчетите при изнасянето);
//   3. `server.js` НЕ расте обратно — таванът само се намалява.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const addon = path.join(root, 'hapi_enterprise');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── 1. Всеки компонент в routes/ спазва договора ────────────────────────────
const routesDir = path.join(addon, 'routes');
const components = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).sort();
assert.ok(components.length >= 2, 'очакват се поне два изнесени компонента, намерени: ' + components.join(', '));

for (const file of components) {
  const src = fs.readFileSync(path.join(routesDir, file), 'utf8');
  const name = 'routes/' + file;
  assert.match(src, /^'use strict';/, name + ': липсва "use strict"');
  assert.match(src, /function create\(deps\)/, name + ': няма create(deps)');
  assert.match(src, /async function handle\(\{ req, res/, name + ': няма handle({ req, res, … })');
  assert.match(src, /module\.exports = \{ create \}/, name + ': не изнася create');
  assert.match(src, /return true;/, name + ': handle не връща true при приключена заявка');
  assert.match(src, /return false;/, name + ': handle не връща false за чужда заявка');
  // Втората грешка от изнасянето: `require('./x')` от routes/ гледа в routes/.
  const wrongRequire = src.match(/require\('\.\/[^']+'\)/g) || [];
  assert.deepEqual(wrongRequire, [], name + ': require("./…") сочи в routes/, а не в hapi_enterprise/ — ползвай "../"');
}

// ── 2. Сървърът наистина ползва компонентите ────────────────────────────────
const server = read('hapi_enterprise/server.js');
for (const file of components) {
  const id = file.replace(/\.js$/, '');
  assert.ok(
    server.includes(`require('./routes/${id}')`),
    'server.js: компонентът routes/' + file + ' не се зарежда',
  );
}
assert.ok(!/parts\[3\] === 'reports'/.test(server), 'server.js: отчетите пак са в монолита — изнесени са в routes/reports.js');
assert.ok(!/parts\[2\] === 'generator'/.test(server), 'server.js: генераторът пак са в монолита — изнесен е в routes/generator.js');

// ── 2б. Всяко извикване на компонент е `await` ──────────────────────────────
// `handle` е `async` по договора, значи връща Promise, а Promise е ВИНАГИ истина.
// `if (routes.x.handle(...)) return;` без `await` поглъща заявката и не отговаря —
// клиентът виси до таймаут. Точно това се случи при 0.69.46 и се хвана само по
// 180-секундния таймаут на серията; тук се хваща за милисекунди.
const handleCalls = server
  .split('\n')
  .filter((line) => /\.handle\(/.test(line) && !/^\s*(\/\/|\*)/.test(line));
assert.ok(handleCalls.length >= 2, 'намирам извикванията на компонентите в server.js (' + handleCalls.length + ')');
const notAwaited = handleCalls.filter((line) => !/\bawait\b/.test(line));
assert.deepEqual(notAwaited, [], 'server.js: извикване на компонент без await (Promise е винаги истина)');

// ── 3. Таван на монолита: само надолу ───────────────────────────────────────
// 2971 преди изнасянето → 2727 след отчетите и генератора → 2720 след ключалката на
// тайните (`secret-lock.js`) → 2722 след диспечера на административния договор
// (`routes/admin-docs.js`): форматирането държи извикването на два реда, а самият
// маршрут е изнесен. Следващото движение тук е ИЗНАСЯНЕ на дял, не нов ред.
const MAX_SERVER_LINES = 2722;
// Броят редове се смята без заключителния нов ред — иначе всеки файл „има“ един ред
// повече и таванът се мести сам.
const lines = server.replace(/\r?\n$/, '').split(/\r?\n/).length;
assert.ok(
  lines <= MAX_SERVER_LINES,
  `server.js е ${lines} реда (таван ${MAX_SERVER_LINES}). Нов маршрут се слага в routes/<дял>.js, не тук.`,
);

// ── 4. Компонентите влизат в образа ─────────────────────────────────────────
const docker = read('hapi_enterprise/Dockerfile');
assert.match(docker, /^COPY routes \/app\/routes\/$/m, 'Dockerfile: routes/ не се копира — add-on-ът няма да стартира');

console.log(
  'PASS server-structure: ' + components.length + ' компонента (' + components.join(', ') + ') · договор create/handle · ' +
  'без require(./) в routes/ · server.js ' + lines + '/' + MAX_SERVER_LINES + ' реда · routes/ в образа',
);
