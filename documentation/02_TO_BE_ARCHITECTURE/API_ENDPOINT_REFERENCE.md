# API Endpoint Reference

**Документ:** HAPI-ARCH-API-002 · **Приложение към** HAPI-ARCH-API-001 (API Architecture & Runtime Logic Specification)

**Генериран от кода на hAPI Enterprise 0.69.80.** Не се редактира на ръка.

Източници (живи, не копия):

- `hapi_enterprise/admin-api-spec.js` — 184 административни операции; същият списък се проверява от `tests/admin-api-spec.cjs` срещу реалния HTTP слой.
- `hapi_enterprise/public-route-allowlist.js` — 28 правила за това какво Public Gateway пропуска.
- `hapi_enterprise/routes/` — 9 компонента на HTTP слоя.

```bash
node scripts/api-reference.cjs           # записва документа
node scripts/api-reference.cjs --check   # проверява, че е актуален (в матрицата)
```

> Правило: промяна в маршрут без повторно генериране чупи `tests/api-reference.cjs`.

## 1. Административни операции

Всички пътища са под `/admin` и изискват административна идентичност (`Authorization: Bearer <ADMIN_TOKEN>`; през Home Assistant — ingress сесия). Колоната „право“ е RBAC способността, с която `adminGate` решава дали ролята на клиента я има.

### Генератор на документи (`generator`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/generator/templates` | Списък на шаблоните | `generator` |
| POST | `/admin/api/generator/templates` | Запис на шаблон | `generator` |
| GET | `/admin/api/generator/templates/{name}` | Един шаблон (HTML като текст) | `generator` |
| DELETE | `/admin/api/generator/templates/{name}` | Изтриване на шаблон | `generator` |

### Достъп, ключове и права (`access`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/users` | Списък на административните потребители | `portals` |
| POST | `/admin/api/users` | Създаване на административен потребител | `portals` |
| GET | `/admin/api/settings` | Настройки на средата (без тайни) | `portals` |
| PATCH | `/admin/api/settings` | Промяна на настройки | `portals` |
| GET | `/admin/api/config-profiles` | Конфигурационни профили | `profiles` |
| POST | `/admin/api/config-profiles` | Нов/променен конфигурационен профил | `profiles` |

### Експорт и пакети (`export`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/pgp/keyring` | Състояние на ключовете от pgp_path_* (без път и без парола) | `pgp` |
| POST | `/admin/api/pgp/keyring/reload` | Препрочитане на ключовете от диска (одитира се) | `pgp` |
| POST | `/admin/api/pgp/seal-paths` | Еднократна L1 миграция: откритите вътрешни пътища стават шифротекст (с копие на базата) | `pgp` |
| POST | `/admin/api/pgp/seal-workdir` | Еднократна L2 миграция: файловете в работните папки стават контейнери (иска ?confirm=1) | `pgp` |
| GET | `/admin/api/pgp/keys` | PGP ключове и настройки на пакетите | `pgp` |
| POST | `/admin/api/pgp/keys` | Прикачване на PGP ключ | `pgp` |
| POST | `/admin/api/pgp/keys/import` | Внасяне на ключове от пакет | `pgp` |
| DELETE | `/admin/api/pgp/keys/{keyId}` | Премахване на PGP ключ | `pgp` |
| GET | `/admin/api/pgp/keys/{keyId}/public` | Публичната част на ключ | `pgp` |
| GET | `/admin/api/packages` | Експортни пакети | `packages` |
| POST | `/admin/api/packages` | Създаване на експортeн пакет | `packages` |
| GET | `/admin/api/packages/{packageId}/signature` | Detached подпис на пакета | `packages` |
| PATCH | `/admin/api/packages/settings` | Настройки на пакетите (автоподписване, срок) | `packages` |
| GET | `/admin/api/v2/export/rules` | Правила за експорт | `core` |
| POST | `/admin/api/v2/export/preflight` | Предварителна проверка на експорт | `core` |

### Журнал и одит (`logs`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/logs` | Последни редове от журнала | `logs` |
| POST | `/admin/api/logs/level` | Смяна на нивото на журнала без рестарт | `logs` |
| GET | `/admin/api/errors` | Дневник на грешките (отделен от журнала) | `portals` |

### Идентичност и връзка (`auth`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/whoami` | Роля на текущия клиент, режим ingress и подразбираща се роля | `whoami` |
| GET | `/admin/api/connection` | Как панелът е свързан (адрес, ingress, публичен адрес) | `portals` |
| GET | `/admin/api/ingress-login` | Вход през Home Assistant Ingress (само на административния порт) | `ingress` |

### Каталог (`catalog`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/cases` | Всички дела в картотеката | `cases` |
| POST | `/admin/api/cases` | Създаване на ново дело | `cases` |
| PATCH | `/admin/api/cases/{caseId}` | Промяна на дело | `cases` |
| DELETE | `/admin/api/cases/{caseId}` | Премахване на дело | `cases` |
| GET | `/admin/api/variables` | Променливи и техните типове | `directory` |
| POST | `/admin/api/variables` | Нова променлива | `directory` |
| PATCH | `/admin/api/variables/{key}` | Промяна на променлива | `directory` |
| DELETE | `/admin/api/variables/{key}` | Премахване на променлива | `directory` |
| GET | `/admin/api/directory` | Указател: контакти и организации | `directory` |
| POST | `/admin/api/directory/ingest` | Внасяне на имейли в указателя | `directory` |
| POST | `/admin/api/directory/rules` | Ново правило за указателя | `directory` |
| DELETE | `/admin/api/directory/rules/{ruleId}` | Премахване на правило | `directory` |
| POST | `/admin/api/directory/contacts` | Нов контакт | `directory` |
| PATCH | `/admin/api/directory/contacts/{contactId}` | Промяна на контакт | `directory` |
| DELETE | `/admin/api/directory/contacts/{contactId}` | Премахване на контакт | `directory` |
| POST | `/admin/api/directory/organizations` | Нова организация | `directory` |
| PATCH | `/admin/api/directory/organizations/{orgId}` | Промяна на организация | `directory` |
| DELETE | `/admin/api/directory/organizations/{orgId}` | Премахване на организация | `directory` |
| POST | `/admin/api/directory/conflicts/{conflictId}/resolve` | Решаване на конфликт в указателя | `directory` |

### Одитен журнал (`audit`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/audit` | Записи от одитната верига | `audit` |
| GET | `/admin/api/audit/verify` | Проверка на хеш-веригата | `audit` |
| GET | `/admin/api/audit/export` | Изтегляне на одитната верига | `audit` |

### Отчети (Report Studio) (`reports`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| POST | `/admin/api/v2/reports/render` | Рендер на отчет (PDF) от манифест | `core` |
| POST | `/admin/api/v2/reports/package` | Пакет с доказателства (PDF + манифест + токени) | `core` |
| POST | `/admin/api/v2/reports/sign` | Detached CMS подпис на отчет | `core` |
| POST | `/admin/api/v2/cms/verify` | Проверка на detached CMS подпис | `core` |
| GET | `/admin/api/v2/rfc3161` | Състояние на RFC 3161 и последни токени | `core` |
| POST | `/admin/api/v2/rfc3161` | Времеви печат START/STOP | `core` |
| GET | `/admin/api/v2/rfc3161/verify` | Проверка на запазените .tsr файлове | `core` |
| POST | `/admin/api/v2/rfc3161/verify` | Проверка на запазените .tsr файлове (повторно) | `core` |

### Портали, папки, QR и файлове (`portals`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/portals` | Всички портали | `portals` |
| POST | `/admin/api/portals` | Нов портал | `portals` |
| POST | `/admin/api/portals/merge` | Сливане на портали в един | `portals` |
| GET | `/admin/api/taxonomy` | Категории и групи | `portals` |
| POST | `/admin/api/taxonomy` | Добавяне на категория или група | `portals` |
| DELETE | `/admin/api/taxonomy` | Премахване на категория или група | `portals` |
| GET | `/admin/api/qr-artifacts` | Списък на QR архивите | `portals` |
| POST | `/admin/api/qr-artifacts` | Създаване/обновяване на QR архив | `portals` |
| GET | `/admin/api/evidence-portal/status` | Състояние на доказателствения портал | `portals` |
| POST | `/admin/api/evidence-portal/deploy` | Публикуване на доказателствения портал | `portals` |
| GET | `/admin/api/portals/{portalId}` | Един портал с неговите файлове | `portals` |
| PATCH | `/admin/api/portals/{portalId}` | Промяна на портал | `portals` |
| DELETE | `/admin/api/portals/{portalId}` | Изтриване на портал | `portals` |
| GET | `/admin/api/portals/{portalId}/api-info` | Препратки към публичното API на портала | `portals` |
| GET | `/admin/api/portals/{portalId}/integrity` | Проверка на целостта на файловете на портала | `portals` |
| POST | `/admin/api/portals/{portalId}/integrity-jobs` | Задача за проверка на целостта (фоново) | `portals` |
| GET | `/admin/api/portals/{portalId}/taxonomy` | Категории и групи, налични за портала | `portals` |
| POST | `/admin/api/portals/{portalId}/signing-key` | Издаване на ключ за подписване на файловете на портала | `portals` |
| GET | `/admin/api/portals/{portalId}/notes` | Бележки на портала | `portals` |
| POST | `/admin/api/portals/{portalId}/notes` | Нова бележка | `portals` |
| PATCH | `/admin/api/portals/{portalId}/notes/{noteId}` | Промяна на бележка | `portals` |
| DELETE | `/admin/api/portals/{portalId}/notes/{noteId}` | Изтриване на бележка | `portals` |
| GET | `/admin/api/portals/{portalId}/attachments` | Прикачени файлове към портала | `portals` |
| POST | `/admin/api/portals/{portalId}/attachments` | Ново прикачване | `portals` |
| GET | `/admin/api/portals/{portalId}/attachments/{attachmentId}/download` | Изтегляне на прикачен файл | `portals` |
| GET | `/admin/api/portals/{portalId}/html-projects` | Регистрирани HTML проекти | `portals` |
| POST | `/admin/api/portals/{portalId}/html-projects` | Регистриране на HTML проект | `portals` |
| DELETE | `/admin/api/portals/{portalId}/html-projects/{projectId}` | Премахване на HTML проект | `portals` |
| POST | `/admin/api/portals/{portalId}/html` | Публикуване на HTML към портала | `portals` |
| GET | `/admin/api/portals/{portalId}/tree` | Дървото на папката на портала | `portals` |
| POST | `/admin/api/portals/{portalId}/tree/folder` | Нова папка в дървото | `portals` |
| PATCH | `/admin/api/portals/{portalId}/tree/folder` | Флагове на папка (видима, медийна, заключена) | `portals` |
| POST | `/admin/api/portals/{portalId}/tree/upload` | Качване на файл в дървото на папката | `portals` |
| POST | `/admin/api/portals/{portalId}/tree/comment` | Коментар към възел от дървото | `portals` |
| POST | `/admin/api/portals/{portalId}/tree/register` | Регистриране на външен файл в дървото | `portals` |
| GET | `/admin/api/portals/{portalId}/tree/api.json` | API карта на папката като JSON | `portals` |
| GET | `/admin/api/portals/{portalId}/qr` | Активен QR, история на ревизиите и физическите архиви | `portals` |
| POST | `/admin/api/portals/{portalId}/qr/archive` | Архивира: физически ZIP със SHA-256 + следващ QR | `portals` |
| POST | `/admin/api/portals/{portalId}/qr/block` | Прекратява активния QR (изисква основание) | `portals` |
| POST | `/admin/api/portals/{portalId}/qr/verify` | Проверява целостта на архивите сега (байтове, манифест, файлове) | `portals` |
| GET | `/admin/api/portals/{portalId}/qr/{qrId}` | Ревизия, манифест и наследник на конкретен QR | `portals` |
| GET | `/admin/api/portals/{portalId}/qr/{qrId}/archive` | Сваляне на архивния файл на конкретен QR | `portals` |

### Правила за изтегляне (`rules`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/rules` | Заредени правила | `portals` |
| POST | `/admin/api/rules/reload` | Презареждане на правилата от диска | `portals` |
| POST | `/admin/api/notify/dispatch` | Изпращане на известие по канал | `portals` |

### Публични тайни връзки v2 (`v2`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/v2/secrets` | Тайни връзки (пликове) | `core` |
| POST | `/admin/api/v2/secrets` | Нова тайна връзка (плик от браузъра) | `core` |
| DELETE | `/admin/api/v2/secrets/{idHash}` | Отмяна на тайна връзка | `core` |
| GET | `/admin/api/v2/profiles` | Профили на документооборота | `core` |
| GET | `/admin/api/v2/groups` | Групи записи | `core` |
| POST | `/admin/api/v2/groups` | Нова група | `core` |
| GET | `/admin/api/v2/groups/{groupId}` | Група с нейните записи | `core` |
| PATCH | `/admin/api/v2/groups/{groupId}` | Промяна на група | `core` |
| DELETE | `/admin/api/v2/groups/{groupId}` | Премахване на група | `core` |
| GET | `/admin/api/v2/records` | Записи (филтър по група и префикс) | `core` |
| POST | `/admin/api/v2/records` | Създаване на нов запис | `core` |
| GET | `/admin/api/v2/records/{recordId}` | Един запис | `core` |
| PATCH | `/admin/api/v2/records/{recordId}` | Промяна на полета на запис | `core` |
| DELETE | `/admin/api/v2/records/{recordId}` | Премахване на запис | `core` |
| POST | `/admin/api/v2/records/{recordId}/associate` | Свързване на запис с група | `core` |
| POST | `/admin/api/v2/records/{recordId}/detach` | Откачане на запис от група | `core` |
| GET | `/admin/api/v2/search` | Търсене в записите | `core` |
| POST | `/admin/api/v2/interpolate` | Преглед на шаблон с променливи (нищо не се записва) | `core` |
| GET | `/admin/api/v2/migrate` | Анализ на данни за миграция | `core` |
| POST | `/admin/api/v2/migrate` | Миграция (с dryRun) | `core` |
| GET | `/admin/api/v2/portals/{portalId}/api` | Готов ли е публичният API на портала | `core` |
| POST | `/admin/api/v2/portals/{portalId}/api` | Генериране на API файлове и QR | `core` |
| DELETE | `/admin/api/v2/portals/{portalId}/api` | Премахване на API файловете | `core` |

### Система и сензори (`system`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/diagnostics` | Диагностика: процес, трафик, каталог, хранилища | `portals` |
| GET | `/admin/api/metrics` | Броячи на трафика и порталите | `metrics` |
| GET | `/admin/api/load` | Текущо натоварване и ефективен паралелизъм | `load` |
| GET | `/admin/api/sensors` | Сензори за Home Assistant (обобщение) | `sensors` |
| GET | `/admin/api/sensors/prometheus` | Същите сензори във формат Prometheus | `sensors` |
| GET | `/admin/api/sensors/visitors` | Живи данни за посетителите | `sensors` |
| GET | `/admin/api/sensors/visitors.csv` | Посетителите като CSV | `sensors` |
| POST | `/admin/api/sensors/geo` | Офлайн гео-обаждане от браузъра на посетителя | `sensors` |
| GET | `/admin/api/openapi.json` | Тази спецификация | `whoami` |

### Файлове (общи операции) (`files`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/portals/{portalId}/files` | Файловете на портала (страницирани) | `portals` |
| POST | `/admin/api/portals/{portalId}/files` | Качване на файл в портала | `portals` |
| POST | `/admin/api/portals/{portalId}/files/bulk-access` | Права за достъп на много файлове наведнъж | `portals` |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}` | Промяна на име/описание на файл | `portals` |
| DELETE | `/admin/api/portals/{portalId}/files/{fileId}` | Изтриване на файл | `portals` |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}/access` | Политика за достъп на файл | `portals` |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/access-keys` | Нов ключ за достъп до файл | `portals` |
| DELETE | `/admin/api/portals/{portalId}/files/{fileId}/access-keys/{keyId}` | Отнемане на ключ за достъп | `portals` |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/sends` | Ново изпращане на файл | `portals` |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/sends` | Изпращанията на файла | `portals` |
| DELETE | `/admin/api/portals/{portalId}/files/{fileId}/sends/{sendId}` | Отмяна на изпращане | `portals` |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/signed-url` | Подписан адрес за изтегляне | `portals` |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/download` | Изтегляне на файл | `portals` |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/hashes` | Отпечатъци на файла | `portals` |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}/metadata` | Метаданни на файла | `portals` |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}/lock` | Заключване или отключване на файл | `portals` |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/sign` | Електронен подпис на файл (receipt) | `portals` |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/verify-signature` | Проверка на подписа на файл | `portals` |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/preview` | Преглед на файла | `portals` |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/thumbnail.svg` | Миниатюра на файла (SVG) | `portals` |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/versions` | Версии на файла | `portals` |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/versions` | Нова версия на файл | `portals` |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/versions/{versionId}/download` | Изтегляне на конкретна версия | `portals` |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/versions/{versionId}/restore` | Връщане към конкретна версия | `portals` |

### Фонови задачи (`jobs`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/jobs` | Задачи и тяхната статистика | `jobs` |

### Хранилище и проверки (`storage`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/database/backups` | Списък на резервните копия | `portals` |
| POST | `/admin/api/database/backup` | Резервно копие в момента | `portals` |
| POST | `/admin/api/database/backups/verify` | Проверка на резервно копие | `portals` |
| GET | `/admin/api/database/backup-schedule` | График на автоматичните копия | `portals` |
| PUT | `/admin/api/database/backup-schedule` | Промяна на графика | `portals` |
| GET | `/admin/api/retention` | Политика за задържане | `portals` |
| POST | `/admin/api/retention` | Промяна на политиката за задържане | `portals` |
| GET | `/admin/api/storage/status` | Състояние на хранилищата | `portals` |
| POST | `/admin/api/storage/check` | Проверка на хранилищата в момента | `portals` |
| POST | `/admin/api/storage/mirror/verify` | Сверка на огледалото с оригинала | `portals` |

### Шкаф 2D (`cabinet`)

| Метод | Път | Описание | Право |
| --- | --- | --- | --- |
| GET | `/admin/api/cabinet/info` | Възможности на шкафа | `cabinet` |
| GET | `/admin/api/cabinet/list` | Съдържание на папка | `cabinet` |
| POST | `/admin/api/cabinet/folder` | Нова папка | `cabinet` |
| POST | `/admin/api/cabinet/create` | Създаване на нов файл | `cabinet` |
| POST | `/admin/api/cabinet/upload` | Качване на файл | `cabinet` |
| POST | `/admin/api/cabinet/save` | Запис на текстов файл | `cabinet` |
| GET | `/admin/api/cabinet/file` | Съдържание на файл | `cabinet` |
| DELETE | `/admin/api/cabinet/entry` | Изтриване на файл или папка | `cabinet` |
| POST | `/admin/api/cabinet/rename` | Преименуване | `cabinet` |
| POST | `/admin/api/cabinet/convert` | Конвертиране на файл | `cabinet` |
| POST | `/admin/api/cabinet/open` | Отваряне с приложение (само локално) | `cabinet` |

## 2. Публична повърхност (Public Gateway)

Правилото е allowlist: всичко, което не е изброено тук, не се обслужва на публичния слушател (включително `/admin/*`). Достъпът до разрешен път пак се решава от портала — allowlist-ът казва само „този вид заявка може да влезе“, не „този ресурс е отворен“.

| Метод | Път (регулярен израз) | Защо е публичен |
| --- | --- | --- |
| GET | `^\/$` | информационната страница с връзка към публичното API |
| GET | `^\/p\/[^/]+\/?$` | страницата на портала (там води QR кодът) |
| GET | `^\/portal\.html$` | страницата на портала за конкретна папка |
| GET | `^\/portal\.html:[A-Za-z0-9_-]{1,90}(\/[^\\]*)?$` | същата страница във вида `/portal.html:<папка>` (донорски формат, без прокси) |
| GET | `^\/portal\.js$` | скриптът на страницата |
| GET | `^\/portal\.css$` | стиловете на страницата |
| GET | `^\/portal-i18n\.js$` | речникът BG/EN/DE |
| GET | `^\/secret\/?$` | страницата на тайна връзка (ключът е само във фрагмента) |
| GET | `^\/secret-view\.js$` | декриптирането на тайната в браузъра |
| GET | `^\/qr\/[A-Za-z0-9_-]{1,64}$` | публичната страница на регистриран QR артефакт |
| GET | `^\/s\/[A-Za-z0-9_-]{1,64}$` | „Бърз линк“ към един файл |
| GET | `^\/site\/[^/]+\/[^/]+\/?[\s\S]*$` | регистриран HTML проект на портала |
| GET | `^\/t\/[A-Za-z0-9_-]{20,120}$` | вход по токен за конкретен портал |
| GET | `^\/api\/v1\/p\/[^/]+(\/[\s\S]*)?$` | публичното API на портала |
| POST | `^\/api\/v1\/p\/[^/]+\/package$` | поискване на ZIP пакет от страницата |
| POST | `^\/api\/v1\/p\/[^/]+\/files\/[^/]+\/rating$` | оценка на файл от посетител |
| GET | `^\/api\/v1\/portals$` | каталогът на публичните портали |
| POST | `^\/api\/v1\/sends\/[A-Za-z0-9_-]{1,64}\/access$` | парола/достъп до „Бърз линк“ |
| GET | `^\/api\/v1\/sends\/[A-Za-z0-9_-]{1,64}\/file$` | еднократното сваляне по билет |
| GET | `^\/api\/v2\/secrets\/[a-f0-9]{64}$` | проба колко прегледа остават (без да ги харчи) |
| POST | `^\/api\/v2\/secrets\/[a-f0-9]{64}\/reveal$` | разкриване на тайната (ключът остава в браузъра) |
| POST | `^\/api\/v1\/auth\/login$` | вход на потребител (дава сесия за портал) |
| POST | `^\/api\/v1\/auth\/logout$` | изход |
| GET | `^\/api\/v1\/auth\/me$` | коя сесия е предявена |
| GET | `^\/api\/public\/v1\/portals\/[^/]+\/?$` | изгледът на портала в публичния gateway |
| GET | `^\/api\/public\/v1\/portals\/[^/]+\/files$` | файловете в публичния gateway |
| GET | `^\/api\/public\/v1\/files\/[^/]+\/access$` | решение за достъп до файл |
| GET | `^\/api\/public\/v1\/files\/[^/]+\/download$` | сваляне през публичния gateway |

### 2.1. Входове (HTML)

| Адрес | Договор | Какво връща |
| --- | --- | --- |
| `/p/<portalId>[/]` | `order` | Страницата на портала (папката му по подразбиране) |
| `/p/<id>?order=<път>` | `order` | Същото, с подпапка ВЪТРЕ в папката на портала |
| `/portal.html?order=share/<папка>[/<подпапка>]` | `order` | Универсалният вход; `qr=<qrId>` носи идентичността на печата |
| `/portal.html?folder=<slug>` | `order` (стар) | Статичната страница на папката |
| `/t/<token>` | `order` | Вход по токен: издава 10-минутна бисквитка и пренасочва |
| `/api/v1/p/<slug>/files/<id>/qr[.svg]` | `file` | QR към конкретен файл (без разширение → 301 към `.svg`) |
| `/api/v1/p/<slug>/qr[.svg]` | `order` | QR към страницата на портала (без разширение → 301 към `.svg`) |
| `/api/v1/p/<slug>/qr.json` | `order` | Публичен QR договор: активен QR, история, архиви |
| `/api/v1/p/<slug>/qr/<qrId>/archive` | `order` | Сваляне на физическия архив на конкретен QR |
| `/portal.html?...&qr=<прекратен>` | `blok` | **410** — печатът е прекратен, с основание, без съдържание |
| `/site/<slug>/<project>/…` | `html` | Регистриран HTML проект на портала |

## 3. Компоненти на HTTP слоя

`server.js` има твърд таван от 2722 реда (`tests/server-structure.cjs`), затова всяка нова група маршрути отива в компонент с договор `create(deps)` → `handle({ req, res, url, parts, method })`, връщащ `true`, когато заявката е негова.

| Компонент | Отговаря за |
| --- | --- |
| `routes/admin-docs.js` | Административната документация и описанието на API-то |
| `routes/folders.js` | Папки на портала: нова, флагове (видима/медийна/заключена + основание), изтриване |
| `routes/generator.js` | Генератор на документи |
| `routes/link-check.js` | Проверка на връзки |
| `routes/pgp-keyring.js` | PGP ключове и миграции L1/L2 |
| `routes/portal-qr.js` | QR ревизии: архив (физически ZIP), прекратяване, манифести |
| `routes/portal-storage.js` | Универсалният вход `?order=`, `blok`, изтегляне от папката, публичен QR договор |
| `routes/portal-tokens.js` | Токени за портал и ACL |
| `routes/reports.js` | Отчети (Report Studio) |

## 4. Кодове за грешка

Всеки код е използван РЕАЛНО в кода (броят е срещанията на `fail(res, <код>)`).

| Код | Значение | Срещания |
| --- | --- | --- |
| 400 | Невалидна заявка/път/име — проверката е преди докосване на диска | 104 |
| 401 | Липсва или невалидна идентичност (административен токен/бисквитка) | 5 |
| 403 | Идентичността е известна, но правото липсва (напр. заключен файл, общ корен) | 15 |
| 404 | Ресурсът не съществува ИЛИ не бива да се разкрива (нарочно еднакъв отговор) | 143 |
| 405 | Методът не се поддържа за този път | 7 |
| 409 | Конфликт със състоянието (съществуващо име, прекратен QR, максимална дълбочина) | 22 |
| 410 | Ресурсът е прекратен (blok: QR е съществувал, достъпът е спрян) | 3 |
| 413 | Твърде голям payload за операцията | 3 |
| 415 | — | 2 |
| 422 | — | 1 |
| 429 | Твърде много заявки (rate limit) | 3 |
| 500 | Вътрешна грешка — подробностите са в журнала, не в отговора | 7 |
| 502 | — | 1 |
| 503 | — | 8 |

Публичните съобщения не съдържат физически пътища, тайни или вътрешна конфигурация: при липса на право отговорът е същият като при липсващ ресурс (`404`), за да не се разкрива съществуването.

