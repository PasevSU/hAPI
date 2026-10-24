'use strict';
// Генерира `documentation/02_TO_BE_ARCHITECTURE/API_ENDPOINT_REFERENCE.md` ОТ КОДА.
//
// Защо от кода: документация, писана на ръка, се разминава с маршрутите за броени дни и
// тогава „документът казва“ нещо, което API-то не прави. Тук източниците са два и двата са
// живи: `admin-api-spec.js` (административните операции) и `public-route-allowlist.js`
// (какво Public Gateway изобщо пропуска). Списъкът на компонентите идва от `routes/`.
//
// Употреба:
//   node scripts/api-reference.cjs           → записва файла
//   node scripts/api-reference.cjs --check   → само проверява, че е актуален (за матрицата)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'documentation', '02_TO_BE_ARCHITECTURE', 'API_ENDPOINT_REFERENCE.md');

const spec = require(path.join(ROOT, 'hapi_enterprise', 'admin-api-spec.js'));
const allow = require(path.join(ROOT, 'hapi_enterprise', 'public-route-allowlist.js'));
const pkg = require(path.join(ROOT, 'package.json'));

const GROUP_TITLES = {
  auth: 'Идентичност и връзка',
  system: 'Система и сензори',
  logs: 'Журнал и одит',
  access: 'Достъп, ключове и права',
  rules: 'Правила за изтегляне',
  jobs: 'Фонови задачи',
  storage: 'Хранилище и проверки',
  audit: 'Одитен журнал',
  portals: 'Портали, папки, QR и файлове',
  export: 'Експорт и пакети',
  catalog: 'Каталог',
  cabinet: 'Шкаф 2D',
  v2: 'Публични тайни връзки v2',
  reports: 'Отчети (Report Studio)',
  generator: 'Генератор на документи',
  files: 'Файлове (общи операции)',
};

const rows = spec.ROUTES.map(([method, route, description, group, capability]) => ({ method, route, description, group, capability }));
const groups = [...new Set(rows.map((r) => r.group))].sort((a, b) => (GROUP_TITLES[a] || a).localeCompare(GROUP_TITLES[b] || b, 'bg'));
const routesDir = path.join(ROOT, 'hapi_enterprise', 'routes');
const components = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).sort();

/** Кодовете за грешка, които кодът РЕАЛНО връща (`fail(res, <код>`). */
function statusCodes() {
  const found = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.js')) continue;
      const text = fs.readFileSync(full, 'utf8');
      for (const m of text.matchAll(/fail\(res,\s*(\d{3})/g)) found.set(Number(m[1]), (found.get(Number(m[1])) || 0) + 1);
    }
  };
  walk(path.join(ROOT, 'hapi_enterprise'));
  return [...found.entries()].sort((a, b) => a[0] - b[0]);
}

const STATUS_MEANING = {
  400: 'Невалидна заявка/път/име — проверката е преди докосване на диска',
  401: 'Липсва или невалидна идентичност (административен токен/бисквитка)',
  403: 'Идентичността е известна, но правото липсва (напр. заключен файл, общ корен)',
  404: 'Ресурсът не съществува ИЛИ не бива да се разкрива (нарочно еднакъв отговор)',
  405: 'Методът не се поддържа за този път',
  409: 'Конфликт със състоянието (съществуващо име, прекратен QR, максимална дълбочина)',
  410: 'Ресурсът е прекратен (blok: QR е съществувал, достъпът е спрян)',
  413: 'Твърде голям payload за операцията',
  429: 'Твърде много заявки (rate limit)',
  500: 'Вътрешна грешка — подробностите са в журнала, не в отговора',
};

const lines = [];
const push = (...values) => lines.push(...values);

push('# API Endpoint Reference', '');
push('**Документ:** HAPI-ARCH-API-002 · **Приложение към** HAPI-ARCH-API-001 (API Architecture & Runtime Logic Specification)', '');
push(`**Генериран от кода на hAPI Enterprise ${pkg.version}.** Не се редактира на ръка.`, '');
push('Източници (живи, не копия):', '');
push(`- \`hapi_enterprise/admin-api-spec.js\` — ${rows.length} административни операции; същият списък се проверява от \`tests/admin-api-spec.cjs\` срещу реалния HTTP слой.`);
push(`- \`hapi_enterprise/public-route-allowlist.js\` — ${allow.RULES.length} правила за това какво Public Gateway пропуска.`);
push(`- \`hapi_enterprise/routes/\` — ${components.length} компонента на HTTP слоя.`);
push('');
push('```bash');
push('node scripts/api-reference.cjs           # записва документа');
push('node scripts/api-reference.cjs --check   # проверява, че е актуален (в матрицата)');
push('```');
push('');
push('> Правило: промяна в маршрут без повторно генериране чупи `tests/api-reference.cjs`.', '');
push('## 1. Административни операции', '');
push('Всички пътища са под `/admin` и изискват административна идентичност (`Authorization: Bearer <ADMIN_TOKEN>`; през Home Assistant — ingress сесия). Колоната „право“ е RBAC способността, с която `adminGate` решава дали ролята на клиента я има.', '');
for (const group of groups) {
  push(`### ${GROUP_TITLES[group] || group} (\`${group}\`)`, '');
  push('| Метод | Път | Описание | Право |', '| --- | --- | --- | --- |');
  for (const row of rows.filter((r) => r.group === group)) {
    push(`| ${row.method} | \`${row.route}\` | ${row.description} | \`${row.capability}\` |`);
  }
  push('');
}
push('## 2. Публична повърхност (Public Gateway)', '');
push('Правилото е allowlist: всичко, което не е изброено тук, не се обслужва на публичния слушател (включително `/admin/*`). Достъпът до разрешен път пак се решава от портала — allowlist-ът казва само „този вид заявка може да влезе“, не „този ресурс е отворен“.', '');
push('| Метод | Път (регулярен израз) | Защо е публичен |', '| --- | --- | --- |');
for (const rule of allow.RULES) push(`| ${rule.method} | \`${rule.re.source}\` | ${rule.why} |`);
push('');
push('### 2.1. Входове (HTML)', '');
push('| Адрес | Договор | Какво връща |', '| --- | --- | --- |');
push('| `/p/<portalId>[/]` | `order` | Страницата на портала (папката му по подразбиране) |');
push('| `/p/<id>?order=<път>` | `order` | Същото, с подпапка ВЪТРЕ в папката на портала |');
push('| `/portal.html?order=share/<папка>[/<подпапка>]` | `order` | Универсалният вход; `qr=<qrId>` носи идентичността на печата |');
push('| `/portal.html?folder=<slug>` | `order` (стар) | Статичната страница на папката |');
push('| `/t/<token>` | `order` | Вход по токен: издава 10-минутна бисквитка и пренасочва |');
push('| `/api/v1/p/<slug>/files/<id>/qr[.svg]` | `file` | QR към конкретен файл (без разширение → 301 към `.svg`) |');
push('| `/api/v1/p/<slug>/qr[.svg]` | `order` | QR към страницата на портала (без разширение → 301 към `.svg`) |');
push('| `/api/v1/p/<slug>/qr.json` | `order` | Публичен QR договор: активен QR, история, архиви |');
push('| `/api/v1/p/<slug>/qr/<qrId>/archive` | `order` | Сваляне на физическия архив на конкретен QR |');
push('| `/portal.html?...&qr=<прекратен>` | `blok` | **410** — печатът е прекратен, с основание, без съдържание |');
push('| `/site/<slug>/<project>/…` | `html` | Регистриран HTML проект на портала |');
push('');
push('## 3. Компоненти на HTTP слоя', '');
push('`server.js` има твърд таван от 2722 реда (`tests/server-structure.cjs`), затова всяка нова група маршрути отива в компонент с договор `create(deps)` → `handle({ req, res, url, parts, method })`, връщащ `true`, когато заявката е негова.', '');
push('| Компонент | Отговаря за |', '| --- | --- |');
const COMPONENT_OWNER = {
  'admin-docs.js': 'Административната документация и описанието на API-то',
  'folders.js': 'Папки на портала: нова, флагове (видима/медийна/заключена + основание), изтриване',
  'generator.js': 'Генератор на документи',
  'link-check.js': 'Проверка на връзки',
  'pgp-keyring.js': 'PGP ключове и миграции L1/L2',
  'portal-qr.js': 'QR ревизии: архив (физически ZIP), прекратяване, манифести',
  'portal-storage.js': 'Универсалният вход `?order=`, `blok`, изтегляне от папката, публичен QR договор',
  'portal-tokens.js': 'Токени за портал и ACL',
  'reports.js': 'Отчети (Report Studio)',
};
for (const name of components) push(`| \`routes/${name}\` | ${COMPONENT_OWNER[name] || '—'} |`);
push('');
push('## 4. Кодове за грешка', '');
push('Всеки код е използван РЕАЛНО в кода (броят е срещанията на `fail(res, <код>)`).', '');
push('| Код | Значение | Срещания |', '| --- | --- | --- |');
for (const [code, count] of statusCodes()) push(`| ${code} | ${STATUS_MEANING[code] || '—'} | ${count} |`);
push('');
push('Публичните съобщения не съдържат физически пътища, тайни или вътрешна конфигурация: при липса на право отговорът е същият като при липсващ ресурс (`404`), за да не се разкрива съществуването.', '');

const markdown = lines.join('\n') + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== markdown) {
    console.error('api-reference: документът е остарял — пусни `node scripts/api-reference.cjs`');
    process.exit(1);
  }
  console.log(`api-reference: актуален (${rows.length} операции, ${allow.RULES.length} публични правила, ${components.length} компонента)`);
  process.exit(0);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, markdown);
console.log(`api-reference: записан ${path.relative(ROOT, OUT)} (${rows.length} операции, ${allow.RULES.length} публични правила, ${components.length} компонента)`);
