# Приложение Б — административни маршрути

> Генерирано от `scripts/docs-manual.cjs` от `hapi_enterprise/admin-api-spec.js`;
> **не се редактира на ръка**. Всеки маршрут носи своята способност (виж
> `02_TO_BE_ARCHITECTURE/API_ARCHITECTURE_SPEC.md` за пълния договор).

Общо: **214** маршрута в **2** групи.

| Група | Маршрути |
| --- | --- |
| `/PATCH` | 1 |
| `/admin/api` | 213 |

## /PATCH

| Метод | Път | Какво прави |
| --- | --- | --- |
| POST | `PATCH` | PUT |

## /admin/api

| Метод | Път | Какво прави |
| --- | --- | --- |
| GET | `/admin/api/whoami` | Роля на текущия клиент, режим ingress и подразбираща се роля |
| GET | `/admin/api/connection` | Как панелът е свързан (адрес, ingress, публичен адрес) |
| GET | `/admin/api/ingress-login` | Вход през Home Assistant Ingress (само на административния порт) |
| GET | `/admin/api/diagnostics` | Диагностика: процес, трафик, каталог, хранилища |
| GET | `/admin/api/metrics` | Броячи на трафика и порталите |
| GET | `/admin/api/load` | Текущо натоварване и ефективен паралелизъм |
| GET | `/admin/api/sensors` | Сензори за Home Assistant (обобщение) |
| GET | `/admin/api/sensors/prometheus` | Същите сензори във формат Prometheus |
| GET | `/admin/api/sensors/visitors` | Живи данни за посетителите |
| GET | `/admin/api/sensors/visitors.csv` | Посетителите като CSV |
| POST | `/admin/api/sensors/geo` | Офлайн гео-обаждане от браузъра на посетителя |
| GET | `/admin/api/logs` | Последни редове от журнала |
| POST | `/admin/api/logs/level` | Смяна на нивото на журнала без рестарт |
| GET | `/admin/api/errors` | Дневник на грешките (отделен от журнала) |
| GET | `/admin/api/users` | Списък на административните потребители |
| POST | `/admin/api/users` | Създаване на административен потребител |
| GET | `/admin/api/settings` | Настройки на средата (без тайни) |
| PATCH | `/admin/api/settings` | Промяна на настройки |
| GET | `/admin/api/config-profiles` | Конфигурационни профили |
| POST | `/admin/api/config-profiles` | Нов/променен конфигурационен профил |
| GET | `/admin/api/rules` | Заредени правила |
| POST | `/admin/api/rules/reload` | Презареждане на правилата от диска |
| POST | `/admin/api/notify/dispatch` | Изпращане на известие по канал |
| GET | `/admin/api/webhooks` | Абонаменти за webhooks, излъчваните събития и чакащи доставки |
| POST | `/admin/api/webhooks` | Нов абонамент; отговорът носи ключа за подпис ЕДИН път |
| DELETE | `/admin/api/webhooks/{id}` | Изтриване на абонамент (чакащите му доставки падат с него) |
| POST | `/admin/api/webhooks/{id}/test` | Пробна доставка веднага — за да се види сгрешен адрес сега |
| POST | `/admin/api/webhooks/{id}/disable` | Спиране на абонамент без триене (историята остава) |
| POST | `/admin/api/webhooks/{id}/enable` | Пускане на спрян абонамент |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/exif` | EXIF/TIFF/PNG метаданни (GPS само при ?gps=1) |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/exif/compare` | Сравнение на метаданните с втори файл |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/forensic` | Анализ по съдържание: тип, ентропия, структура, находки |
| GET | `/admin/api/evidence` | Делата и порталите, които викащият вижда (съдебните роли — само своите) |
| GET | `/admin/api/evidence/assignments` | Кой потребител по кои дела е назначен |
| POST | `/admin/api/evidence/assign` | Назначаване на потребител по дела (`*` = всички) |
| GET | `/admin/api/evidence/vault` | Колко обекта и байта пази печатът на WORM (`.worm/<sha256>`) |
| GET | `/admin/api/events` | Състояние на живия поток (свързани клиенти, помнени събития) |
| GET | `/admin/api/events/stream` | Жив поток от събития (text/event-stream, сърцебиене, Last-Event-ID) |
| GET | `/admin/api/jobs` | Задачи и тяхната статистика |
| GET | `/admin/api/database/backups` | Списък на резервните копия |
| POST | `/admin/api/database/backup` | Резервно копие в момента |
| POST | `/admin/api/database/backups/verify` | Проверка на резервно копие |
| GET | `/admin/api/database/backup-schedule` | График на автоматичните копия |
| PUT | `/admin/api/database/backup-schedule` | Промяна на графика |
| GET | `/admin/api/retention` | Политика за задържане |
| POST | `/admin/api/retention` | Промяна на политиката за задържане |
| GET | `/admin/api/storage/status` | Състояние на хранилищата |
| POST | `/admin/api/storage/check` | Проверка на хранилищата в момента |
| POST | `/admin/api/storage/mirror/verify` | Сверка на огледалото с оригинала |
| GET | `/admin/api/audit` | Записи от одитната верига |
| GET | `/admin/api/audit/verify` | Проверка на хеш-веригата |
| GET | `/admin/api/audit/export` | Изтегляне на одитната верига |
| GET | `/admin/api/portals` | Всички портали |
| POST | `/admin/api/portals` | Нов портал |
| POST | `/admin/api/portals/merge` | Сливане на портали в един |
| GET | `/admin/api/taxonomy` | Категории и групи |
| POST | `/admin/api/taxonomy` | Добавяне на категория или група |
| DELETE | `/admin/api/taxonomy` | Премахване на категория или група |
| GET | `/admin/api/qr-artifacts` | Списък на QR архивите |
| POST | `/admin/api/qr-artifacts` | Създаване/обновяване на QR архив |
| DELETE | `/admin/api/qr-artifacts/{qrId}` | Изтриване на QR архив (с връщане при провал на записа) |
| POST | `/admin/api/links/check` | Проверка дали публичен адрес наистина се отваря |
| GET | `/admin/api/sensors/visitors/{visitorId}` | Профил на един посетител |
| DELETE | `/admin/api/sensors/visitors/{visitorId}` | Изтриване на посетител (GDPR, чл. 17) |
| GET | `/admin/api/evidence-portal/status` | Състояние на доказателствения портал |
| POST | `/admin/api/evidence-portal/deploy` | Публикуване на доказателствения портал |
| GET | `/admin/api/pgp/keyring` | Състояние на ключовете от pgp_path_* (без път и без парола) |
| POST | `/admin/api/pgp/keyring/reload` | Препрочитане на ключовете от диска (одитира се) |
| POST | `/admin/api/pgp/seal-paths` | Еднократна L1 миграция: откритите вътрешни пътища стават шифротекст (с копие на базата) |
| POST | `/admin/api/pgp/seal-workdir` | Еднократна L2 миграция: файловете в работните папки стават контейнери (иска ?confirm=1) |
| POST | `/admin/api/pgp/sign` | Подпис на папка и/или на много файлове с готовия ключ |
| GET | `/admin/api/pgp/signatures/{signatureId}` | ZIP с подписите и манифеста на папката |
| GET | `/admin/api/pgp/keys` | PGP ключове и настройки на пакетите |
| POST | `/admin/api/pgp/keys` | Прикачване на PGP ключ |
| POST | `/admin/api/pgp/keys/import` | Внасяне на ключове от пакет |
| DELETE | `/admin/api/pgp/keys/{keyId}` | Премахване на PGP ключ |
| GET | `/admin/api/pgp/keys/{keyId}/public` | Публичната част на ключ |
| GET | `/admin/api/packages` | Експортни пакети |
| POST | `/admin/api/packages` | Създаване на експортeн пакет |
| GET | `/admin/api/packages/{packageId}` | Метаданни на експортен пакет |
| GET | `/admin/api/packages/{packageId}/download` | Изтегляне на пакета (`?part=N` при разделен пакет) |
| POST | `/admin/api/packages/{packageId}/verify` | Проверка на подписа/целостта на пакета |
| GET | `/admin/api/packages/{packageId}/signature` | Detached подпис на пакета |
| PATCH | `/admin/api/packages/settings` | Настройки на пакетите (автоподписване, срок) |
| GET | `/admin/api/v2/export/rules` | Правила за експорт |
| POST | `/admin/api/v2/export/preflight` | Предварителна проверка на експорт |
| GET | `/admin/api/cases` | Всички дела в картотеката |
| POST | `/admin/api/cases` | Създаване на ново дело |
| PATCH | `/admin/api/cases/{caseId}` | Промяна на дело |
| DELETE | `/admin/api/cases/{caseId}` | Премахване на дело |
| GET | `/admin/api/variables` | Променливи и техните типове |
| POST | `/admin/api/variables` | Нова променлива |
| PATCH | `/admin/api/variables/{key}` | Промяна на променлива |
| DELETE | `/admin/api/variables/{key}` | Премахване на променлива |
| GET | `/admin/api/directory` | Указател: контакти и организации |
| POST | `/admin/api/directory/ingest` | Внасяне на имейли в указателя |
| POST | `/admin/api/directory/rules` | Ново правило за указателя |
| DELETE | `/admin/api/directory/rules/{ruleId}` | Премахване на правило |
| POST | `/admin/api/directory/contacts` | Нов контакт |
| PATCH | `/admin/api/directory/contacts/{contactId}` | Промяна на контакт |
| DELETE | `/admin/api/directory/contacts/{contactId}` | Премахване на контакт |
| POST | `/admin/api/directory/organizations` | Нова организация |
| PATCH | `/admin/api/directory/organizations/{orgId}` | Промяна на организация |
| DELETE | `/admin/api/directory/organizations/{orgId}` | Премахване на организация |
| POST | `/admin/api/directory/conflicts/{conflictId}/resolve` | Решаване на конфликт в указателя |
| GET | `/admin/api/cabinet/info` | Възможности на шкафа |
| GET | `/admin/api/cabinet/list` | Съдържание на папка |
| POST | `/admin/api/cabinet/folder` | Нова папка |
| POST | `/admin/api/cabinet/create` | Създаване на нов файл |
| POST | `/admin/api/cabinet/upload` | Качване на файл |
| POST | `/admin/api/cabinet/save` | Запис на текстов файл |
| GET | `/admin/api/cabinet/file` | Съдържание на файл |
| DELETE | `/admin/api/cabinet/entry` | Изтриване на файл или папка |
| POST | `/admin/api/cabinet/rename` | Преименуване |
| POST | `/admin/api/cabinet/convert` | Конвертиране на файл |
| POST | `/admin/api/cabinet/open` | Отваряне с приложение (само локално) |
| GET | `/admin/api/v2/secrets` | Тайни връзки (пликове) |
| POST | `/admin/api/v2/secrets` | Нова тайна връзка (плик от браузъра) |
| DELETE | `/admin/api/v2/secrets/{idHash}` | Отмяна на тайна връзка |
| GET | `/admin/api/v2/profiles` | Профили на документооборота |
| GET | `/admin/api/v2/groups` | Групи записи |
| POST | `/admin/api/v2/groups` | Нова група |
| GET | `/admin/api/v2/groups/{groupId}` | Група с нейните записи |
| PATCH | `/admin/api/v2/groups/{groupId}` | Промяна на група |
| DELETE | `/admin/api/v2/groups/{groupId}` | Премахване на група |
| GET | `/admin/api/v2/records` | Записи (филтър по група и префикс) |
| POST | `/admin/api/v2/records` | Създаване на нов запис |
| GET | `/admin/api/v2/records/{recordId}` | Един запис |
| PATCH | `/admin/api/v2/records/{recordId}` | Промяна на полета на запис |
| DELETE | `/admin/api/v2/records/{recordId}` | Премахване на запис |
| POST | `/admin/api/v2/records/{recordId}/associate` | Свързване на запис с група |
| POST | `/admin/api/v2/records/{recordId}/detach` | Откачане на запис от група |
| GET | `/admin/api/v2/search` | Търсене в записите |
| POST | `/admin/api/v2/interpolate` | Преглед на шаблон с променливи (нищо не се записва) |
| GET | `/admin/api/v2/migrate` | Анализ на данни за миграция |
| POST | `/admin/api/v2/migrate` | Миграция (с dryRun) |
| POST | `/admin/api/v2/reports/render` | Рендер на отчет (PDF) от манифест |
| POST | `/admin/api/v2/reports/package` | Пакет с доказателства (PDF + манифест + токени) |
| POST | `/admin/api/v2/reports/sign` | Detached CMS подпис на отчет |
| POST | `/admin/api/v2/cms/verify` | Проверка на detached CMS подпис |
| GET | `/admin/api/v2/rfc3161` | Състояние на RFC 3161 и последни токени |
| POST | `/admin/api/v2/rfc3161` | Времеви печат START/STOP |
| GET | `/admin/api/v2/rfc3161/verify` | Проверка на запазените .tsr файлове |
| POST | `/admin/api/v2/rfc3161/verify` | Проверка на запазените .tsr файлове (повторно) |
| GET | `/admin/api/generator/templates` | Списък на шаблоните |
| POST | `/admin/api/generator/templates` | Запис на шаблон |
| GET | `/admin/api/generator/templates/{name}` | Един шаблон (HTML като текст) |
| DELETE | `/admin/api/generator/templates/{name}` | Изтриване на шаблон |
| GET | `/admin/api/v2/portals/{portalId}/api` | Готов ли е публичният API на портала |
| POST | `/admin/api/v2/portals/{portalId}/api` | Генериране на API файлове и QR |
| DELETE | `/admin/api/v2/portals/{portalId}/api` | Премахване на API файловете |
| GET | `/admin/api/portals/{portalId}` | Един портал с неговите файлове |
| PATCH | `/admin/api/portals/{portalId}` | Промяна на портал |
| DELETE | `/admin/api/portals/{portalId}` | Изтриване на портал |
| GET | `/admin/api/portals/{portalId}/api-info` | Препратки към публичното API на портала |
| GET | `/admin/api/portals/{portalId}/integrity` | Проверка на целостта на файловете на портала |
| POST | `/admin/api/portals/{portalId}/integrity-jobs` | Задача за проверка на целостта (фоново) |
| GET | `/admin/api/portals/{portalId}/taxonomy` | Категории и групи, налични за портала |
| POST | `/admin/api/portals/{portalId}/signing-key` | Издаване на ключ за подписване на файловете на портала |
| GET | `/admin/api/portals/{portalId}/notes` | Бележки на портала |
| POST | `/admin/api/portals/{portalId}/notes` | Нова бележка |
| PATCH | `/admin/api/portals/{portalId}/notes/{noteId}` | Промяна на бележка |
| DELETE | `/admin/api/portals/{portalId}/notes/{noteId}` | Изтриване на бележка |
| GET | `/admin/api/portals/{portalId}/attachments` | Прикачени файлове към портала |
| POST | `/admin/api/portals/{portalId}/attachments` | Ново прикачване |
| GET | `/admin/api/portals/{portalId}/attachments/{attachmentId}/download` | Изтегляне на прикачен файл |
| GET | `/admin/api/portals/{portalId}/html-projects` | Регистрирани HTML проекти |
| POST | `/admin/api/portals/{portalId}/html-projects` | Регистриране на HTML проект |
| DELETE | `/admin/api/portals/{portalId}/html-projects/{projectId}` | Премахване на HTML проект |
| POST | `/admin/api/portals/{portalId}/html` | Публикуване на HTML към портала |
| GET | `/admin/api/portals/{portalId}/tree` | Дървото на папката на портала |
| POST | `/admin/api/portals/{portalId}/tree/folder` | Нова папка в дървото |
| PATCH | `/admin/api/portals/{portalId}/tree/folder` | Флагове на папка (видима, медийна, заключена) |
| POST | `/admin/api/portals/{portalId}/tree/upload` | Качване на файл в дървото на папката |
| POST | `/admin/api/portals/{portalId}/tree/comment` | Коментар към възел от дървото |
| POST | `/admin/api/portals/{portalId}/tree/register` | Регистриране на външен файл в дървото |
| GET | `/admin/api/portals/{portalId}/tree/api.json` | API карта на папката като JSON |
| GET | `/admin/api/portals/{portalId}/files` | Файловете на портала (страницирани) |
| POST | `/admin/api/portals/{portalId}/files` | Качване на файл в портала |
| POST | `/admin/api/portals/{portalId}/files/bulk-access` | Права за достъп на много файлове наведнъж |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}` | Промяна на име/описание на файл |
| DELETE | `/admin/api/portals/{portalId}/files/{fileId}` | Изтриване на файл |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}/access` | Политика за достъп на файл |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/access-keys` | Нов ключ за достъп до файл |
| DELETE | `/admin/api/portals/{portalId}/files/{fileId}/access-keys/{keyId}` | Отнемане на ключ за достъп |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/sends` | Ново изпращане на файл |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/sends` | Изпращанията на файла |
| DELETE | `/admin/api/portals/{portalId}/files/{fileId}/sends/{sendId}` | Отмяна на изпращане |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/signed-url` | Подписан адрес за изтегляне |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/download` | Изтегляне на файл |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/hashes` | Отпечатъци на файла |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}/metadata` | Метаданни на файла |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/transfer` | Преместване или копиране на файл в друг портал |
| PATCH | `/admin/api/portals/{portalId}/files/{fileId}/lock` | Заключване или отключване на файл |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/sign` | Електронен подпис на файл (receipt) |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/verify-signature` | Проверка на подписа на файл |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/preview` | Преглед на файла |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/thumbnail.svg` | Миниатюра на файла (SVG) |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/versions` | Версии на файла |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/versions` | Нова версия на файл |
| GET | `/admin/api/portals/{portalId}/files/{fileId}/versions/{versionId}/download` | Изтегляне на конкретна версия |
| POST | `/admin/api/portals/{portalId}/files/{fileId}/versions/{versionId}/restore` | Връщане към конкретна версия |
| GET | `/admin/api/portals/{portalId}/qr` | Активен QR, история на ревизиите и физическите архиви |
| POST | `/admin/api/portals/{portalId}/qr/archive` | Архивира: физически ZIP със SHA-256 + следващ QR |
| POST | `/admin/api/portals/{portalId}/qr/block` | Прекратява активния QR (изисква основание) |
| POST | `/admin/api/portals/{portalId}/qr/verify` | Проверява целостта на архивите сега (байтове, манифест, файлове) |
| GET | `/admin/api/portals/{portalId}/qr/{qrId}` | Ревизия, манифест и наследник на конкретен QR |
| POST | `/admin/api/portals/{portalId}/qr/{qrId}/restore` | Връща състоянието от архива (първо архивира текущото) |
| GET | `/admin/api/portals/{portalId}/qr/{qrId}/archive` | Сваляне на архивния файл на конкретен QR |
| POST | `/admin/api/portals/{portalId}/close` | Закрива портала: данните влизат в архив за съхранение (183 дни) |
| GET | `/admin/api/portals/archive` | Затворените портали с оставащи дни до изтриване |
| POST | `/admin/api/portals/archive/{portalId}/restore` | Връща закрит портал от архива с файловете и адреса му |
| GET | `/admin/api/openapi.json` | Тази спецификация |
