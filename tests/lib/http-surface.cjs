'use strict';
// HTTP повърхност на add-on-а: `server.js` + компонентите в `hapi_enterprise/routes/`.
//
// Защо: тестовете, които проверяват „сървърът има маршрут X“, четяха само монолита.
// След като дяловете се изнесоха в `routes/`, такава проверка би „открила“ загубен
// маршрут, който всъщност работи — или, по-лошо, би минала, без да види новия файл.
// Затова четенето минава оттук: един източник за „целия HTTP слой“.
const fs = require('node:fs');
const path = require('node:path');

/** Пътищата на файловете, които образуват HTTP слоя (монолитът е първи). */
function files(root = path.join(__dirname, '..', '..')) {
  const dir = path.join(root, 'hapi_enterprise');
  const routesDir = path.join(dir, 'routes');
  let routes = [];
  try {
    routes = fs
      .readdirSync(routesDir)
      .filter((file) => file.endsWith('.js'))
      .sort()
      .map((file) => path.join(routesDir, file));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e; // без routes/ има само монолитът
  }
  return [path.join(dir, 'server.js'), ...routes];
}

/** Целият код на HTTP слоя като един текст — за статични проверки на маршрути. */
function source(root) {
  return files(root)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
}

module.exports = { files, source };
