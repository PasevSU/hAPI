'use strict';
// Договор за АДМИНИСТРАТИВНОТО API (OpenAPI 3.1).
//
// Защо съществува: публичното портално API имаше `api-spec.js` (договор за външни
// клиенти), а административното — с което работят панелът, интеграцията и всички
// скриптове — нямаше нищо машинно четимо. Клиентът научаваше за маршрут от 404.
//
// Как се поддържа честно: `tests/admin-api-spec.cjs` изважда от кода всеки маршрут,
// записан като `url.pathname === '/admin/api/...'`, и изисква ТОЧНО тези двойки
// метод+път да са в таблицата по-долу. Нова административна пътека без ред тук чупи
// теста; ред без пътека в кода също. Затова таблицата не може да „изостане“ тихо.
//
// Обхват: всички маршрути от първо ниво на `/admin/api/` и блоковете под
// `/admin/api/v2/` (core, export), `/pgp`, `/packages`, `/cases`, `/variables`,
// `/directory`, `/cabinet`, `/taxonomy`, `/portals`. Подресурсите на порталите и
// файловете (динамични id-та, десетки пътища) се описват на ниво блок — виж
// `documentation/02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md`.
const VERSION_SOURCE = 'hapi_enterprise/config.yaml';

// [метод, път, резюме, таг, капацитет за RBAC]
// Капацитетът е този, който `adminGate(..., capability, ...)` подава — така договорът
// казва и КОЙ има право, не само какво има.
const ROUTES = [
  // ── идентичност и готовност ────────────────────────────────────────────────
  ['GET', '/admin/api/whoami', 'Роля на текущия клиент, режим ingress и подразбираща се роля', 'auth', 'whoami'],
  ['GET', '/admin/api/connection', 'Как панелът е свързан (адрес, ingress, публичен адрес)', 'auth', 'portals'],
  ['GET', '/admin/api/ingress-login', 'Вход през Home Assistant Ingress (само на административния порт)', 'auth', 'ingress'],
  ['GET', '/admin/api/diagnostics', 'Диагностика: процес, трафик, каталог, хранилища', 'system', 'portals'],
  ['GET', '/admin/api/metrics', 'Броячи на трафика и порталите', 'system', 'metrics'],
  ['GET', '/admin/api/load', 'Текущо натоварване и ефективен паралелизъм', 'system', 'load'],
  ['GET', '/admin/api/sensors', 'Сензори за Home Assistant (обобщение)', 'system', 'sensors'],
  ['GET', '/admin/api/sensors/prometheus', 'Същите сензори във формат Prometheus', 'system', 'sensors'],
  ['GET', '/admin/api/sensors/visitors', 'Живи данни за посетителите', 'system', 'sensors'],
  ['GET', '/admin/api/sensors/visitors.csv', 'Посетителите като CSV', 'system', 'sensors'],
  ['POST', '/admin/api/sensors/geo', 'Офлайн гео-обаждане от браузъра на посетителя', 'system', 'sensors'],

  // ── журнали и грешки ───────────────────────────────────────────────────────
  ['GET', '/admin/api/logs', 'Последни редове от журнала', 'logs', 'logs'],
  ['POST', '/admin/api/logs/level', 'Смяна на нивото на журнала без рестарт', 'logs', 'logs'],
  ['GET', '/admin/api/errors', 'Дневник на грешките (отделен от журнала)', 'logs', 'portals'],

  // ── потребители, настройки, профили ────────────────────────────────────────
  ['GET', '/admin/api/users', 'Списък на административните потребители', 'access', 'portals'],
  ['POST', '/admin/api/users', 'Създаване на административен потребител', 'access', 'portals'],
  ['GET', '/admin/api/settings', 'Настройки на средата (без тайни)', 'access', 'portals'],
  ['PATCH', '/admin/api/settings', 'Промяна на настройки', 'access', 'portals'],
  ['GET', '/admin/api/config-profiles', 'Конфигурационни профили', 'access', 'profiles'],
  ['POST', '/admin/api/config-profiles', 'Нов/променен конфигурационен профил', 'access', 'profiles'],

  // ── правила и известия ─────────────────────────────────────────────────────
  ['GET', '/admin/api/rules', 'Заредени правила', 'rules', 'portals'],
  ['POST', '/admin/api/rules/reload', 'Презареждане на правилата от диска', 'rules', 'portals'],
  ['POST', '/admin/api/notify/dispatch', 'Изпращане на известие по канал', 'rules', 'portals'],

  // ── задачи и резервни копия ────────────────────────────────────────────────
  ['GET', '/admin/api/jobs', 'Задачи и тяхната статистика', 'jobs', 'jobs'],
  ['GET', '/admin/api/database/backups', 'Списък на резервните копия', 'storage', 'portals'],
  ['POST', '/admin/api/database/backup', 'Резервно копие в момента', 'storage', 'portals'],
  ['POST', '/admin/api/database/backups/verify', 'Проверка на резервно копие', 'storage', 'portals'],
  ['GET', '/admin/api/database/backup-schedule', 'График на автоматичните копия', 'storage', 'portals'],
  ['PUT', '/admin/api/database/backup-schedule', 'Промяна на графика', 'storage', 'portals'],
  ['GET', '/admin/api/retention', 'Политика за задържане', 'storage', 'portals'],
  ['POST', '/admin/api/retention', 'Промяна на политиката за задържане', 'storage', 'portals'],
  ['GET', '/admin/api/storage/status', 'Състояние на хранилищата', 'storage', 'portals'],
  ['POST', '/admin/api/storage/check', 'Проверка на хранилищата в момента', 'storage', 'portals'],
  ['POST', '/admin/api/storage/mirror/verify', 'Сверка на огледалото с оригинала', 'storage', 'portals'],

  // ── одитна верига ──────────────────────────────────────────────────────────
  ['GET', '/admin/api/audit', 'Записи от одитната верига', 'audit', 'audit'],
  ['GET', '/admin/api/audit/verify', 'Проверка на хеш-веригата', 'audit', 'audit'],
  ['GET', '/admin/api/audit/export', 'Изтегляне на одитната верига', 'audit', 'audit'],

  // ── портали (блок) ────────────────────────────────────────────────────────
  ['GET', '/admin/api/portals', 'Всички портали', 'portals', 'portals'],
  ['POST', '/admin/api/portals', 'Нов портал', 'portals', 'portals'],
  ['POST', '/admin/api/portals/merge', 'Сливане на портали в един', 'portals', 'portals'],
  ['GET', '/admin/api/taxonomy', 'Категории и групи', 'portals', 'portals'],
  ['POST', '/admin/api/taxonomy', 'Добавяне на категория или група', 'portals', 'portals'],
  ['DELETE', '/admin/api/taxonomy', 'Премахване на категория или група', 'portals', 'portals'],

  // ── QR и доказателствен портал ────────────────────────────────────────────
  ['GET', '/admin/api/qr-artifacts', 'Списък на QR архивите', 'portals', 'portals'],
  ['POST', '/admin/api/qr-artifacts', 'Създаване/обновяване на QR архив', 'portals', 'portals'],
  ['GET', '/admin/api/evidence-portal/status', 'Състояние на доказателствения портал', 'portals', 'portals'],
  ['POST', '/admin/api/evidence-portal/deploy', 'Публикуване на доказателствения портал', 'portals', 'portals'],

  // ── PGP ключове и експортни пакети ────────────────────────────────────────
  ['GET', '/admin/api/pgp/keys', 'PGP ключове и настройки на пакетите', 'export', 'pgp'],
  ['POST', '/admin/api/pgp/keys', 'Прикачване на PGP ключ', 'export', 'pgp'],
  ['POST', '/admin/api/pgp/keys/import', 'Внасяне на ключове от пакет', 'export', 'pgp'],
  ['DELETE', '/admin/api/pgp/keys/{keyId}', 'Премахване на PGP ключ', 'export', 'pgp'],
  ['GET', '/admin/api/pgp/keys/{keyId}/public', 'Публичната част на ключ', 'export', 'pgp'],
  ['GET', '/admin/api/packages', 'Експортни пакети', 'export', 'packages'],
  ['POST', '/admin/api/packages', 'Създаване на експортeн пакет', 'export', 'packages'],
  ['PATCH', '/admin/api/packages/settings', 'Настройки на пакетите (автоподписване, срок)', 'export', 'packages'],
  ['GET', '/admin/api/v2/export/rules', 'Правила за експорт', 'export', 'core'],
  ['POST', '/admin/api/v2/export/preflight', 'Предварителна проверка на експорт', 'export', 'core'],

  // ── дела, променливи, указател ────────────────────────────────────────────
  ['GET', '/admin/api/cases', 'Всички дела в картотеката', 'catalog', 'cases'],
  ['POST', '/admin/api/cases', 'Създаване на ново дело', 'catalog', 'cases'],
  ['PATCH', '/admin/api/cases/{caseId}', 'Промяна на дело', 'catalog', 'cases'],
  ['DELETE', '/admin/api/cases/{caseId}', 'Премахване на дело', 'catalog', 'cases'],
  ['GET', '/admin/api/variables', 'Променливи и техните типове', 'catalog', 'directory'],
  ['POST', '/admin/api/variables', 'Нова променлива', 'catalog', 'directory'],
  ['PATCH', '/admin/api/variables/{key}', 'Промяна на променлива', 'catalog', 'directory'],
  ['DELETE', '/admin/api/variables/{key}', 'Премахване на променлива', 'catalog', 'directory'],
  ['GET', '/admin/api/directory', 'Указател: контакти и организации', 'catalog', 'directory'],
  ['POST', '/admin/api/directory/ingest', 'Внасяне на имейли в указателя', 'catalog', 'directory'],
  ['POST', '/admin/api/directory/rules', 'Ново правило за указателя', 'catalog', 'directory'],
  ['DELETE', '/admin/api/directory/rules/{ruleId}', 'Премахване на правило', 'catalog', 'directory'],
  ['POST', '/admin/api/directory/contacts', 'Нов контакт', 'catalog', 'directory'],
  ['PATCH', '/admin/api/directory/contacts/{contactId}', 'Промяна на контакт', 'catalog', 'directory'],
  ['DELETE', '/admin/api/directory/contacts/{contactId}', 'Премахване на контакт', 'catalog', 'directory'],
  ['POST', '/admin/api/directory/organizations', 'Нова организация', 'catalog', 'directory'],
  ['PATCH', '/admin/api/directory/organizations/{orgId}', 'Промяна на организация', 'catalog', 'directory'],
  ['DELETE', '/admin/api/directory/organizations/{orgId}', 'Премахване на организация', 'catalog', 'directory'],
  ['POST', '/admin/api/directory/conflicts/{conflictId}/resolve', 'Решаване на конфликт в указателя', 'catalog', 'directory'],

  // ── шкаф (файлове на сървъра) ─────────────────────────────────────────────
  ['GET', '/admin/api/cabinet/info', 'Възможности на шкафа', 'cabinet', 'cabinet'],
  ['GET', '/admin/api/cabinet/list', 'Съдържание на папка', 'cabinet', 'cabinet'],
  ['POST', '/admin/api/cabinet/folder', 'Нова папка', 'cabinet', 'cabinet'],
  ['POST', '/admin/api/cabinet/create', 'Създаване на нов файл', 'cabinet', 'cabinet'],
  ['POST', '/admin/api/cabinet/upload', 'Качване на файл', 'cabinet', 'cabinet'],
  ['POST', '/admin/api/cabinet/save', 'Запис на текстов файл', 'cabinet', 'cabinet'],
  ['GET', '/admin/api/cabinet/file', 'Съдържание на файл', 'cabinet', 'cabinet'],
  ['DELETE', '/admin/api/cabinet/entry', 'Изтриване на файл или папка', 'cabinet', 'cabinet'],
  ['POST', '/admin/api/cabinet/rename', 'Преименуване', 'cabinet', 'cabinet'],
  ['POST', '/admin/api/cabinet/convert', 'Конвертиране на файл', 'cabinet', 'cabinet'],
  ['POST', '/admin/api/cabinet/open', 'Отваряне с приложение (само локално)', 'cabinet', 'cabinet'],

  // ── v2: тайни връзки ──────────────────────────────────────────────────────
  ['GET', '/admin/api/v2/secrets', 'Тайни връзки (пликове)', 'v2', 'core'],
  ['POST', '/admin/api/v2/secrets', 'Нова тайна връзка (плик от браузъра)', 'v2', 'core'],
  ['DELETE', '/admin/api/v2/secrets/{idHash}', 'Отмяна на тайна връзка', 'v2', 'core'],

  // ── v2: профили, групи, записи ────────────────────────────────────────────
  ['GET', '/admin/api/v2/profiles', 'Профили на документооборота', 'v2', 'core'],
  ['GET', '/admin/api/v2/groups', 'Групи записи', 'v2', 'core'],
  ['POST', '/admin/api/v2/groups', 'Нова група', 'v2', 'core'],
  ['GET', '/admin/api/v2/groups/{groupId}', 'Група с нейните записи', 'v2', 'core'],
  ['PATCH', '/admin/api/v2/groups/{groupId}', 'Промяна на група', 'v2', 'core'],
  ['DELETE', '/admin/api/v2/groups/{groupId}', 'Премахване на група', 'v2', 'core'],
  ['GET', '/admin/api/v2/records', 'Записи (филтър по група и префикс)', 'v2', 'core'],
  ['POST', '/admin/api/v2/records', 'Създаване на нов запис', 'v2', 'core'],
  ['GET', '/admin/api/v2/records/{recordId}', 'Един запис', 'v2', 'core'],
  ['PATCH', '/admin/api/v2/records/{recordId}', 'Промяна на полета на запис', 'v2', 'core'],
  ['DELETE', '/admin/api/v2/records/{recordId}', 'Премахване на запис', 'v2', 'core'],
  ['POST', '/admin/api/v2/records/{recordId}/associate', 'Свързване на запис с група', 'v2', 'core'],
  ['POST', '/admin/api/v2/records/{recordId}/detach', 'Откачане на запис от група', 'v2', 'core'],
  ['GET', '/admin/api/v2/search', 'Търсене в записите', 'v2', 'core'],
  ['POST', '/admin/api/v2/interpolate', 'Преглед на шаблон с променливи (нищо не се записва)', 'v2', 'core'],
  ['GET', '/admin/api/v2/migrate', 'Анализ на данни за миграция', 'v2', 'core'],
  ['POST', '/admin/api/v2/migrate', 'Миграция (с dryRun)', 'v2', 'core'],

  // ── v2: публично API на портал ────────────────────────────────────────────
  ['GET', '/admin/api/v2/portals/{portalId}/api', 'Готов ли е публичният API на портала', 'v2', 'core'],
  ['POST', '/admin/api/v2/portals/{portalId}/api', 'Генериране на API файлове и QR', 'v2', 'core'],
  ['DELETE', '/admin/api/v2/portals/{portalId}/api', 'Премахване на API файловете', 'v2', 'core'],

  // ── самият договор ────────────────────────────────────────────────────────
  ['GET', '/admin/api/openapi.json', 'Тази спецификация', 'system', 'whoami'],
];

const TAGS = [
  ['auth', 'Идентичност и връзка'],
  ['system', 'Състояние и сензори'],
  ['logs', 'Журнал и грешки'],
  ['access', 'Потребители и настройки'],
  ['rules', 'Правила и известия'],
  ['jobs', 'Задачи'],
  ['storage', 'Хранилище и резервни копия'],
  ['audit', 'Одитна верига'],
  ['portals', 'Портали, QR и доказателства'],
  ['export', 'Експорт, PGP и пакети'],
  ['catalog', 'Дела, променливи, указател'],
  ['cabinet', 'Шкаф (файлове на сървъра)'],
  ['v2', 'Документооборот v2 (core)'],
];

const ok = (what) => ({ description: what });

/** Параметрите по пътя: `{portalId}` → path параметър със същото име. */
function pathParams(p) {
  const out = [];
  for (const m of String(p).matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    out.push({ name: m[1], in: 'path', required: true, schema: { type: 'string' }, description: `Идентификатор: ${m[1]}` });
  }
  return out;
}

function bodyFor(method) {
  if (!['POST', 'PATCH', 'PUT'].includes(method)) return null;
  return {
    description: 'JSON тяло според документацията на маршрута (виж `documentation/` и `ui/`)',
    required: method !== 'PATCH',
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  };
}

/**
 * OpenAPI 3.1 документ.
 * @param {{baseUrl?: string, version?: string}} [options] `baseUrl` — адресът, на който
 *   клиентът стига до сървъра (при Ingress това е адресът на панела).
 */
function build(options = {}) {
  const base = String(options.baseUrl || '').replace(/\/+$/, '');
  const version = String(options.version || '').trim();
  const paths = {};
  for (const [method, p, summary, tag, capability] of ROUTES) {
    const entry = (paths[p] = paths[p] || {});
    const op = {
      summary,
      operationId: `${method.toLowerCase()}_${p.replace(/^\/admin\/api\/?/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '') || 'root'}`,
      tags: [tag],
      security: [{ adminToken: [] }],
      'x-hapi-capability': capability,
      responses: {
        200: ok('Успех (тялото зависи от маршрута)'),
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        429: { $ref: '#/components/responses/TooMany' },
      },
    };
    const params = pathParams(p);
    if (params.length) op.parameters = params;
    const body = bodyFor(method);
    if (body) op.requestBody = body;
    entry[method.toLowerCase()] = op;
  }
  const doc = {
    openapi: '3.1.0',
    info: {
      title: 'hAPI Enterprise — административно API',
      version: version || '0.0.0',
      description:
        'Договорът за административното API. Токенът се подава като `Authorization: Bearer <token>`, ' +
        'а зад Home Assistant Ingress самоличността идва от Supervisor (`X-Remote-User-*`). ' +
        'Правата се решават по роля (RBAC) за всеки маршрут — виж `x-hapi-capability`.',
    },
    servers: [{ url: base || '/', description: base ? 'Адресът на този сървър' : 'Същият origin' }],
    tags: TAGS.map(([name, description]) => ({ name, description })),
    security: [{ adminToken: [] }],
    paths,
    components: {
      securitySchemes: {
        adminToken: {
          type: 'http',
          scheme: 'bearer',
          description: 'Административен токен (генерира се при първи старт, файл с права 0600).',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: { error: { type: 'string', description: 'Съобщение за човека' } },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Липсва или е грешен токен',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Ролята няма право за този капацитет',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        TooMany: {
          description: 'Твърде много неуспешни опити за автентикация',
          headers: { 'Retry-After': { schema: { type: 'integer' } } },
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  };
  return doc;
}

/** Двойките метод+път — за сверката с кода. */
function operations() {
  return ROUTES.map(([method, p]) => `${method} ${p}`);
}

const ADMIN_API_SPEC = { build, operations, ROUTES, VERSION_SOURCE };

if (typeof module !== 'undefined' && module.exports) module.exports = ADMIN_API_SPEC;
