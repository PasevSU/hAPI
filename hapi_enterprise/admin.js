'use strict';
/* i18n (self-contained; CSP script-src 'self' permits only this bundle). */
const ADMIN_DIC={en:{
 'Административният токен остава само в паметта на текущия раздел и не се записва в браузъра.':'The admin token stays only in memory of the current tab and is never persisted.',
 'Диагностика и натоварване':'Diagnostics & load','Фонови задачи':'Background jobs',
 'Проверките на цялост се изпълняват в опашка с прогрес и възможност за отказ.':'Integrity checks run in a queue with progress and cancellation.',
 'Резервно копие на SQLite':'SQLite backup',
 "Създава консистентно копие в защитената папка backups/ на приложението.":"Creates a consistent copy in the app's protected backups/ folder.",
 'Настройки · база данни и QR артефакти':'Settings · database & QR artifacts',
 'Промяната на името на базата изисква спиране, копиране на текущата база и рестарт. Не се извършва автоматично преместване.':'Changing the database name requires stopping, copying the current database, and restarting. No automatic migration is performed.',
 'Интелигентен контрол на натоварването':'Intelligent load control',
 'Адаптивният лимит на изтеглянията намалява натоварването при високо използване на heap или повишен процент грешки.':'The adaptive download limit reduces load under high heap usage or an elevated error rate.',
 'Централизиран журнал за грешки':'Centralized error log','Профили за конфигурация':'Configuration profiles',
 'Записвай и прилагай наименувани профили на настройките.':'Save and apply named settings profiles.',
 'Резервни копия и възстановяване':'Backups & restore','Съхранение':'Storage',
 'Проверка за наличност и възможност за запис на всяко хранилище. Автоматичната проверка се изпълнява на интервал.':'Checks availability and write access for every storage location. Automatic checks run on an interval.',
 'Създадено от PasevSU DEV · Home Assistant Projects · част от доброволческата кампания NO TRUST Cybersecurity. Лиценз: виж LICENSE файла.':'Created by PasevSU DEV · Home Assistant Projects · part of the NO TRUST Cybersecurity volunteer campaign. License: see the LICENSE file.',
 'Нов портал':'New portal','Портали':'Portals','Диагностика':'Diagnostics','Задачи':'Jobs','Резервни копия':'Backups','Журнал':'Logs','API достъп':'API access','Настройки':'Settings','Шедулер за резервни копия':'Backup scheduler',
 'Автоматични резервни копия':'Automatic backups','Интервал (минути)':'Interval (minutes)','Максимален брой':'Maximum count',
 'Запази график':'Save schedule','Зареди график':'Load schedule','Следващо изпълнение':'Next run','Графикът е запазен':'Schedule saved','Активно':'Enabled',
 'Качен на (ms)':'Uploaded (ms)','Създаден (ms)':'Created (ms)',
 'Действия':'Actions','Направи публичен':'Make public','Направи частен':'Make private','Качи файл':'Upload file','Качи HTML чрез API':'Upload HTML via API','Изтрий портал':'Delete portal','Изтрий файл':'Delete file','Публичен API':'Public API','файла':'files',
 'Публичен API токен':'Public API token','Генерирай токен':'Generate token','Етикет (по избор)':'Label (optional)','Токенът се показва само веднъж. Копирай го сега.':'The token is shown only once. Copy it now.','Копирай токен':'Copy token','Отмени':'Revoke','REST endpoint-и':'REST endpoints','Няма API ключове':'No API keys','Без срок':'No expiry','Копирай':'Copy','Пример (curl)':'Example (curl)','Списък с портали':'List portals','Метаданни на портал':'Portal metadata','Файлове':'Files','Изтегляне на файл':'Download file','OpenAPI спецификация':'OpenAPI specification',
 'Публичен API · потребители':'Public API · users',
 'Вписването издава сесиен токен за достъп до порталите и файловете, замествайки старите dp_ ключове.':'Login issues a session token for portal/file access, replacing the old dp_ keys.',
 'Потребителско име':'Username','Парола (мин. 8)':'Password (min 8)','Създай потребител':'Create user',
 'Активен':'Active','Деактивиран':'Disabled','Деактивирай':'Disable','Активирай':'Enable',
 'Смени парола':'Reset password','Нова парола (мин. 8)':'New password (min 8)','Изтрий':'Delete','Няма API потребители':'No API users',
 'Вписване (login)':'Login','Изход (logout)':'Logout','Текущ потребител (me)':'Current user (me)',
 'Административен панел':'Admin panel','Зареди портали':'Load portals','Заглавие':'Title','Създай':'Create',
 'Няма създадени портали. Създай първия портал във формуляра по-горе.':'No portals have been created. Create the first portal using the form above.',
 'Удостоверяването е успешно. Няма създадени портали.':'Authentication succeeded. No portals have been created.',
 'Удостоверяването е успешно. Заредени портали: ':'Authentication succeeded. Portals loaded: ',
 'Обнови диагностиката':'Refresh diagnostics','Обнови натоварването':'Refresh load','Обнови задачите':'Refresh jobs','Провери хранилищата':'Check storage','Създай резервно копие':'Create backup','Списък с резервни копия':'List backups','Зареди журнала':'Load log','Зареди настройки':'Load settings','Запази настройки':'Save settings','Запази профил':'Save profile','Списък':'List','Приложи':'Apply','Ниво':'Level','Всички':'All','Име':'Name','Папка за QR записи (отделна от базата)':'QR records folder (separate from database)','Папка на базата':'Database folder','Файл на базата':'Database file','Настройки (JSON, по избор)':'Settings (JSON, optional)',
 'Тема · категория · етикет · група':'Topic · category · tag · group',
 'Тема':'Topic','Категория':'Category','Етикет':'Tag','Група':'Group',
 'Извикай файловете':'Fetch files','Намерени: ':'Found: ',' · показани: ':' · shown: ',
 'Метаданни на файловете':'File metadata','Етикети, разделени със запетая':'Tags, comma-separated','Запази метаданни':'Save metadata',
 'Вътрешни бележки и приложения (само администратор)':'Internal notes & attachments (admin only)',
 'Заглавие на бележка':'Note title','Текст на бележката':'Note text','Добави бележка':'Add note','Редактирай':'Edit','Изтрий бележка':'Delete note','Качи вътрешен файл':'Upload internal file','Изтегли':'Download','Избери файл':'Choose a file',
 'Изтриване на бележката?':'Delete this note?','Изтриване на приложението?':'Delete this attachment?',
 'Права за изтегляне на файловете':'File download permissions','Показвай в каталога ':'List in catalog ','Запази права':'Save permissions',
 '24 часа':'24 hours','7 дни':'7 days','30 дни':'30 days',
 'Създай файлов ключ':'Create file key','Копирай и съхрани ключа сега: ':'Copy and store the key now: ','Копирай ключ':'Copy key','Нов ключ: ':'New key: ','Отнеми ключ':'Revoke key','Ключ ':'Key ','Отнеми':'Revoke','Отнемане на файловия ключ?':'Revoke the file key?',
 'Активни: ':'Active: ',' | В опашка: ':' | Queued: ','Няма задачи':'No jobs','Възобнови':'Resume','Пауза':'Pause','Откажи':'Cancel',
 'макс':'max','Ниво: ':'Level: ','Последно преизчисляване: ':'Last recalc: ',
 'Няма записани грешки':'No recorded errors',
 'Настройки заредени':'Settings loaded','Запазено. Изисква се ръчна миграция на DB и рестарт.':'Saved. Manual DB migration and restart required.','Настройките са запазени.':'Settings saved.',
 'HTML проекти · автоматичен index.html':'HTML projects · automatic index.html','Папка в html-projects (напр. landing)':'Folder in html-projects (e.g. landing)','Име на проекта':'Project name','Публикувай проект':'Publish project','Отвори':'Open','Премахни публикуването':'Unpublish',
 'Разрешени са .html и .htm':'Only .html and .htm are allowed','Изтриване на портал ':'Delete portal ',' и всички файлове?':' and all its files?','Изтриване на ':'Delete ',
 'HTML е съхранен. Достъп: KEY_REQUIRED; скрит от каталога. Настрой правата и ключовете преди публикуване.':'HTML saved. Access: KEY_REQUIRED; hidden from catalog. Set permissions and keys before publishing.',
 'Изтриване на потребител ':'Delete user ',
 'Невалиден JSON за настройки':'Invalid settings JSON','Запазен профил: ':'Saved profile: ',' · създаден ':' · created ','Въведи име на профил':'Enter a profile name','Приложен профил: ':'Applied profile: ',' (изисква се рестарт)':' (restart required)','Изтрит профил: ':'Deleted profile: ',
 'Няма резервни копия':'No backups','Възстанови':'Restore','Възстановяване от ':'Restore from ','? Текущите метаданни ще бъдат заменени.':'? Current metadata will be replaced.','Възстановени: ':'Restored: ',' портала, ':' portals, ',' QR артефакта (revision ':' QR artifacts (revision ','). Презареди порталите.':'). Reload the portals.',
 'Състояние: ':'Status: ','ЗДРАВО':'HEALTHY','ПРОБЛЕМ':'PROBLEM',' · проверено ':' · checked ',
 'Групово управление на достъпа':'Batch access management',
 'Без промяна на видимостта':'No visibility change','Показвай':'Show','Скрий':'Hide',
 'Прегледай промените':'Preview changes','Избери файлове':'Select files',
 '; видимост ':' ; visibility ','Приложи груповите промени за ':'Apply batch changes to ',' файла?':' files?',
 'Качи файл в ':'Upload file to ','Избери HTML за ':'Choose HTML for ','Режим на ':'Mode for ','Показвай ':'Show ','Валидност на ключ за ':'Key validity for ','Избери ':'Select ',
 'Работно време: ':'Uptime: ','сек.':'sec.','RAM RSS: ':'RAM RSS: ','Heap: ':'Heap: ','Изтегляния: ':'Downloads: ',
 'Завършени: ':'Completed: ','Натоварване: ':'Load: ','Ефективен лимит: ':'Effective limit: ','Съотношение heap: ':'Heap ratio: ',
 'Последни грешки: ':'Recent errors: ','Заявки: ':'Requests: ','Грешки: ':'Errors: ','Портали: ':'Portals: ','Файлове: ':'Files: ',
 'Налично':'available','Липсва':'missing','Записваемо':'writable','Само за четене':'read-only','минимум':'min','прозорец':'window','ниво':'level','ефективно':'effective',
 'Проверка на hash-chain':'Hash-chain verification',
 'Проверява непрекъснатостта и целостта на одитния журнал. Открива промени в записите, но не е външно закотвен (не защитава срещу администратор, който пренаписва цялата верига).':'Verifies continuity and integrity of the audit journal. Detects tampering but is not externally anchored (does not protect against an admin who rewrites the whole chain).',
 'Провери целостта':'Verify integrity','Статус: ':'Status: ','ВАЛИДНА':'VALID','НАРУШЕНА':'BROKEN','Записи: ':'Records: ','Последен hash: ':'Last hash: ','Причина: ':'Reason: '
},de:{
 'Административният токен остава само в паметта на текущия раздел и не се записва в браузъра.':'Das Admin-Token bleibt nur im Speicher des aktuellen Tabs und wird nie gespeichert.',
 'Диагностика и натоварване':'Diagnose & Auslastung','Фонови задачи':'Hintergrundaufgaben',
 'Проверките на цялост се изпълняват в опашка с прогрес и възможност за отказ.':'Integritätsprüfungen laufen in einer Warteschlange mit Fortschritt und Abbruch.',
 'Резервно копие на SQLite':'SQLite-Backup',
 "Създава консистентно копие в защитената папка backups/ на приложението.":'Erstellt eine konsistente Kopie im geschützten backups/-Ordner der Anwendung.',
 'Настройки · база данни и QR артефакти':'Einstellungen · Datenbank & QR-Artefakte',
 'Промяната на името на базата изисква спиране, копиране на текущата база и рестарт. Не се извършва автоматично преместване.':'Das Ändern des Datenbanknamens erfordert Anhalten, Kopieren der aktuellen Datenbank und Neustart. Es erfolgt keine automatische Migration.',
 'Интелигентен контрол на натоварването':'Intelligente Laststeuerung',
 'Адаптивният лимит на изтеглянията намалява натоварването при високо използване на heap или повишен процент грешки.':'Das adaptive Download-Limit senkt die Last bei hoher Heap-Auslastung oder erhöhter Fehlerquote.',
 'Централизиран журнал за грешки':'Zentrales Fehlerprotokoll','Профили за конфигурация':'Konfigurationsprofile',
 'Записвай и прилагай наименувани профили на настройките.':'Benannte Einstellungsprofile speichern und anwenden.',
 'Резервни копия и възстановяване':'Backups & Wiederherstellung','Съхранение':'Speicher',
 'Проверка за наличност и възможност за запис на всяко хранилище. Автоматичната проверка се изпълнява на интервал.':'Prüft Verfügbarkeit und Schreibzugriff für jeden Speicherort. Automatische Prüfungen laufen in Intervallen.',
 'Създадено от PasevSU DEV · Home Assistant Projects · част от доброволческата кампания NO TRUST Cybersecurity. Лиценз: виж LICENSE файла.':'Erstellt von PasevSU DEV · Home Assistant Projects · Teil der Freiwilligenkampagne NO TRUST Cybersecurity. Lizenz: siehe LICENSE-Datei.',
 'Нов портал':'Neues Portal','Портали':'Portale','Диагностика':'Diagnose','Задачи':'Aufgaben','Резервни копия':'Backups','Журнал':'Protokoll','API достъп':'API-Zugriff','Настройки':'Einstellungen','Шедулер за резервни копия':'Backup-Planer',
 'Автоматични резервни копия':'Automatische Backups','Интервал (минути)':'Intervall (Minuten)','Максимален брой':'Maximale Anzahl',
 'Запази график':'Zeitplan speichern','Зареди график':'Zeitplan laden','Следващо изпълнение':'Nächste Ausführung','Графикът е запазен':'Zeitplan gespeichert','Активно':'Aktiviert',
 'Качен на (ms)':'Hochgeladen (ms)','Създаден (ms)':'Erstellt (ms)',
 'Действия':'Aktionen','Направи публичен':'Öffentlich machen','Направи частен':'Privat machen','Качи файл':'Datei hochladen','Качи HTML чрез API':'HTML über API hochladen','Изтрий портал':'Portal löschen','Изтрий файл':'Datei löschen','Публичен API':'Öffentliche API','файла':'Dateien',
 'Публичен API токен':'Öffentliches API-Token','Генерирай токен':'Token generieren','Етикет (по избор)':'Beschriftung (optional)','Токенът се показва само веднъж. Копирай го сега.':'Das Token wird nur einmal angezeigt. Jetzt kopieren.','Копирай токен':'Token kopieren','Отмени':'Widerrufen','REST endpoint-и':'REST-Endpunkte','Няма API ключове':'Keine API-Schlüssel','Без срок':'Ohne Ablauf','Копирай':'Kopieren','Пример (curl)':'Beispiel (curl)','Списък с портали':'Portale auflisten','Метаданни на портал':'Portal-Metadaten','Файлове':'Dateien','Изтегляне на файл':'Datei herunterladen','OpenAPI спецификация':'OpenAPI-Spezifikation',
 'Публичен API · потребители':'Öffentliche API · Benutzer',
 'Вписването издава сесиен токен за достъп до порталите и файловете, замествайки старите dp_ ключове.':'Die Anmeldung stellt ein Sitzungs-Token für Portal-/Dateizugriff aus und ersetzt die alten dp_-Schlüssel.',
 'Потребителско име':'Benutzername','Парола (мин. 8)':'Passwort (min. 8)','Създай потребител':'Benutzer erstellen',
 'Активен':'Aktiv','Деактивиран':'Deaktiviert','Деактивирай':'Deaktivieren','Активирай':'Aktivieren',
 'Смени парола':'Passwort zurücksetzen','Нова парола (мин. 8)':'Neues Passwort (min. 8)','Изтрий':'Löschen','Няма API потребители':'Keine API-Benutzer',
 'Вписване (login)':'Anmelden','Изход (logout)':'Abmelden','Текущ потребител (me)':'Aktueller Benutzer (me)',
 'Административен панел':'Admin-Bereich','Зареди портали':'Portale laden','Заглавие':'Titel','Създай':'Erstellen',
 'Няма създадени портали. Създай първия портал във формуляра по-горе.':'Es wurden noch keine Portale erstellt. Erstelle das erste Portal mit dem Formular oben.',
 'Удостоверяването е успешно. Няма създадени портали.':'Authentifizierung erfolgreich. Es wurden noch keine Portale erstellt.',
 'Удостоверяването е успешно. Заредени портали: ':'Authentifizierung erfolgreich. Geladene Portale: ',
 'Обнови диагностиката':'Diagnose aktualisieren','Обнови натоварването':'Last aktualisieren','Обнови задачите':'Aufgaben aktualisieren','Провери хранилищата':'Speicher prüfen','Създай резервно копие':'Backup erstellen','Списък с резервни копия':'Backups auflisten','Зареди журнала':'Protokoll laden','Зареди настройки':'Einstellungen laden','Запази настройки':'Einstellungen speichern','Запази профил':'Profil speichern','Списък':'Liste','Приложи':'Anwenden','Ниво':'Stufe','Всички':'Alle','Име':'Name','Папка за QR записи (отделна от базата)':'QR-Aufzeichnungsordner (getrennt von der Datenbank)','Папка на базата':'Datenbankordner','Файл на базата':'Datenbankdatei','Настройки (JSON, по избор)':'Einstellungen (JSON, optional)',
 'Тема · категория · етикет · група':'Thema · Kategorie · Tag · Gruppe',
 'Тема':'Thema','Категория':'Kategorie','Етикет':'Tag','Група':'Gruppe',
 'Извикай файловете':'Dateien abrufen','Намерени: ':'Gefunden: ',' · показани: ':' · angezeigt: ',
 'Метаданни на файловете':'Datei-Metadaten','Етикети, разделени със запетая':'Tags, kommagetrennt','Запази метаданни':'Metadaten speichern',
 'Вътрешни бележки и приложения (само администратор)':'Interne Notizen & Anhänge (nur Admin)',
 'Заглавие на бележка':'Notiztitel','Текст на бележката':'Notiztext','Добави бележка':'Notiz hinzufügen','Редактирай':'Bearbeiten','Изтрий бележка':'Notiz löschen','Качи вътрешен файл':'Interne Datei hochladen','Изтегли':'Herunterladen','Избери файл':'Datei auswählen',
 'Изтриване на бележката?':'Diese Notiz löschen?','Изтриване на приложението?':'Diesen Anhang löschen?',
 'Права за изтегляне на файловете':'Datei-Downloadberechtigungen','Показвай в каталога ':'Im Katalog anzeigen ','Запази права':'Berechtigungen speichern',
 '24 часа':'24 Stunden','7 дни':'7 Tage','30 дни':'30 Tage',
 'Създай файлов ключ':'Dateischlüssel erstellen','Копирай и съхрани ключа сега: ':'Schlüssel jetzt kopieren und speichern: ','Копирай ключ':'Schlüssel kopieren','Нов ключ: ':'Neuer Schlüssel: ','Отнеми ключ':'Schlüssel widerrufen','Ключ ':'Schlüssel ','Отнеми':'Widerrufen','Отнемане на файловия ключ?':'Dateischlüssel widerrufen?',
 'Активни: ':'Aktiv: ',' | В опашка: ':' | In Warteschlange: ','Няма задачи':'Keine Aufgaben','Възобнови':'Fortsetzen','Пауза':'Pause','Откажи':'Abbrechen',
 'макс':'max','Ниво: ':'Niveau: ','Последно преизчисляване: ':'Letzte Neuberechnung: ',
 'Няма записани грешки':'Keine aufgezeichneten Fehler',
 'Настройки заредени':'Einstellungen geladen','Запазено. Изисква се ръчна миграция на DB и рестарт.':'Gespeichert. Manuelle DB-Migration und Neustart erforderlich.','Настройките са запазени.':'Einstellungen gespeichert.',
 'HTML проекти · автоматичен index.html':'HTML-Projekte · automatische index.html','Папка в html-projects (напр. landing)':'Ordner in html-projects (z. B. landing)','Име на проекта':'Projektname','Публикувай проект':'Projekt veröffentlichen','Отвори':'Öffnen','Премахни публикуването':'Veröffentlichung aufheben',
 'Разрешени са .html и .htm':'Nur .html und .htm sind erlaubt','Изтриване на портал ':'Portal löschen ',' и всички файлове?':' und alle Dateien?','Изтриване на ':'Löschen ',
 'HTML е съхранен. Достъп: KEY_REQUIRED; скрит от каталога. Настрой правата и ключовете преди публикуване.':'HTML gespeichert. Zugriff: KEY_REQUIRED; im Katalog ausgeblendet. Berechtigungen und Schlüssel vor Veröffentlichung setzen.',
 'Изтриване на потребител ':'Benutzer löschen ',
 'Невалиден JSON за настройки':'Ungültiges JSON für Einstellungen','Запазен профил: ':'Profil gespeichert: ',' · създаден ':' · erstellt ','Въведи име на профил':'Profilnamen eingeben','Приложен профил: ':'Profil angewendet: ',' (изисква се рестарт)':' (Neustart erforderlich)','Изтрит профил: ':'Profil gelöscht: ',
 'Няма резервни копия':'Keine Backups','Възстанови':'Wiederherstellen','Възстановяване от ':'Wiederherstellen von ','? Текущите метаданни ще бъдат заменени.':'? Aktuelle Metadaten werden ersetzt.','Възстановени: ':'Wiederhergestellt: ',' портала, ':' Portale, ',' QR артефакта (revision ':' QR-Artefakte (Revision ','). Презареди порталите.':'). Portale neu laden.',
 'Състояние: ':'Status: ','ЗДРАВО':'GESUND','ПРОБЛЕМ':'PROBLEM',' · проверено ':' · geprüft ',
 'Групово управление на достъпа':'Stapel-Zugriffsverwaltung',
 'Без промяна на видимостта':'Keine Sichtbarkeitsänderung','Показвай':'Anzeigen','Скрий':'Ausblenden',
 'Прегледай промените':'Änderungen vorschauen','Избери файлове':'Dateien auswählen',
 '; видимост ':' ; Sichtbarkeit ','Приложи груповите промени за ':'Stapeländerungen anwenden für ',' файла?':' Dateien?',
 'Качи файл в ':'Datei hochladen in ','Избери HTML за ':'HTML wählen für ','Режим на ':'Modus für ','Показвай ':'Anzeigen ','Валидност на ключ за ':'Schlüsselgültigkeit für ','Избери ':'Auswählen ',
 'Работно време: ':'Laufzeit: ','сек.':'Sek.','RAM RSS: ':'RAM-RSS: ','Heap: ':'Heap: ','Изтегляния: ':'Downloads: ',
 'Завършени: ':'Abgeschlossen: ','Натоварване: ':'Auslastung: ','Ефективен лимит: ':'Effektives Limit: ','Съотношение heap: ':'Heap-Verhältnis: ',
 'Последни грешки: ':'Letzte Fehler: ','Заявки: ':'Anfragen: ','Грешки: ':'Fehler: ','Портали: ':'Portale: ','Файлове: ':'Dateien: ',
 'Налично':'verfügbar','Липсва':'fehlt','Записваемо':'beschreibbar','Само за четене':'schreibgeschützt','минимум':'min.','прозорец':'Fenster','ниво':'Stufe','ефективно':'effektiv',
 'Проверка на hash-chain':'Hash-Chain-Prüfung',
 'Проверява непрекъснатостта и целостта на одитния журнал. Открива промени в записите, но не е външно закотвен (не защитава срещу администратор, който пренаписва цялата верига).':'Prüft Kontinuität und Integrität des Audit-Journals. Erkennt Manipulationen, ist aber nicht extern verankert (schützt nicht gegen einen Admin, der die gesamte Kette neu schreibt).',
 'Провери целостта':'Integrität prüfen','Статус: ':'Status: ','ВАЛИДНА':'GÜLTIG','НАРУШЕНА':'GEBROCHEN','Записи: ':'Datensätze: ','Последен hash: ':'Letzter Hash: ','Причина: ':'Grund: '
}};
let adminLang='en';
function t(s){const d=ADMIN_DIC[adminLang]||{};return d[s]||s}
const _languageRefreshers=[];
function refreshOnLanguageChange(buttonId,resultId,render){
 const result=$(resultId);
 const refresh=async()=>{await render();result.dataset.languageLoaded='true'};
 $(buttonId).addEventListener('click',()=>action(refresh));
 _languageRefreshers.push(async()=>{if(result.dataset.languageLoaded==='true')await refresh()});
}
function setAdminLang(l){if(['bg','en','de'].includes(l))adminLang=l;applyAdminLang();if($('token').value)action(async()=>{await load();for(const refresh of _languageRefreshers)await refresh()})}
function applyAdminLang(){document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.getAttribute('data-i18n'))});const sel=document.getElementById('admin-lang');if(sel)sel.value=adminLang}
const $=id=>document.getElementById(id);
const ingressBase=(()=>{const p=location.pathname;return p.endsWith('/admin')?p.slice(0,-6):p.endsWith('/')?p.slice(0,-1):''})();
const adminPath=p=>ingressBase+p;
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e};
async function api(path,method='GET',value,extra={}){const headers={Authorization:'Bearer '+$('token').value,...extra};let body;if(value!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(value)}const r=await fetch(adminPath(path),{method,headers,body});const data=await r.json();if(!r.ok)throw Error(data.error||`HTTP ${r.status}`);return data}
async function action(fn){try{$('status').textContent='';await fn()}catch(e){$('status').textContent=e.message}}
const closeMenus=()=>document.querySelectorAll('.menu').forEach(m=>m.hidden=true);
document.addEventListener('click',closeMenus);
const menu=(label,items)=>{const wrap=node('span','');wrap.className='menu-wrap';const btn=node('button',label);btn.type='button';const list=node('div','');list.className='menu';list.hidden=true;for(const it of items){const b=node('button',it.label);b.type='button';if(it.danger)b.className='danger';b.onclick=e=>{e.stopPropagation();closeMenus();action(it.run)};list.append(b)}btn.onclick=e=>{e.stopPropagation();const show=list.hidden;closeMenus();list.hidden=!show};wrap.append(btn,list);return wrap};
async function load(){const data=await api('/admin/api/portals');const holder=$('portals');holder.replaceChildren();if(!data.portals.length){holder.append(node('p',t('Няма създадени портали. Създай първия портал във формуляра по-горе.')));$('status').textContent=t('Удостоверяването е успешно. Няма създадени портали.');return}for(const p of data.portals){const box=node('article','');const publicUrl='/api/v1/p/'+encodeURIComponent(p.slug);
 const head=node('h3','');head.append(node('span',p.title));const slug=node('span',' '+p.slug);slug.className='muted';slug.style.fontSize='12px';head.append(slug);
 const pill=document.createElement('span');pill.className='pill '+(p.visibility==='public'?'public':'private');pill.textContent=p.visibility==='public'?t('Публичен'):t('Частен');head.append(pill);box.append(head);
 const meta=document.createElement('div');meta.className='meta-line';
 meta.append(node('span',p.files.length+' '+t('файла')),node('span',fmtBytes(p.files.reduce((n,f)=>n+f.size,0))),node('span',t('Създаден')+': '+fmtDate(p.createdAt)),node('code',publicUrl));
 const copyLink=node('button',t('Копирай линк'));copyLink.type='button';copyLink.onclick=()=>action(async()=>{const info=await api('/admin/api/portals/'+p.id+'/api-info');await copyText(info.apiUrl)});meta.append(copyLink);
 const qr=node('button',t('QR код'));qr.type='button';qr.className='btn-primary';qr.onclick=()=>action(async()=>{const info=await api('/admin/api/portals/'+p.id+'/api-info');showQr(info,p)});meta.append(qr);box.append(meta);
 const fileInput=document.createElement('input');fileInput.type='file';fileInput.hidden=true;fileInput.setAttribute('aria-label',t('Качи файл в ')+p.title);
 const htmlInput=document.createElement('input');htmlInput.type='file';htmlInput.accept='.html,.htm,text/html';htmlInput.hidden=true;htmlInput.setAttribute('aria-label',t('Избери HTML за ')+p.title);
 box.append(fileInput,htmlInput,menu(t('Действия'),[
  {label:t(p.visibility==='public'?'Направи частен':'Направи публичен'),run:async()=>{await api('/admin/api/portals/'+p.id,'PATCH',{visibility:p.visibility==='public'?'private':'public'});await load()}},
  {label:t('Качи файл'),run:()=>{fileInput.click()}},
  {label:t('Качи HTML чрез API'),run:()=>{htmlInput.click()}},
  {label:t('Изтрий портал'),danger:true,run:async()=>{if(!confirm(t('Изтриване на портал ')+p.title+t(' и всички файлове?')))return;await api('/admin/api/portals/'+p.id,'DELETE');await load()}}
 ]));
 fileInput.onchange=()=>action(async()=>{const f=fileInput.files[0];if(!f)return;const r=await fetch(adminPath('/admin/api/portals/'+p.id+'/files'),{method:'POST',headers:{Authorization:'Bearer '+$('token').value,'X-File-Name':f.name},body:f});if(!r.ok)throw Error((await r.json()).error);await load()});
 htmlInput.onchange=()=>action(async()=>{const f=htmlInput.files[0];if(!f)return;if(!/\.html?$/i.test(f.name))throw Error(t('Разрешени са .html и .htm'));const r=await fetch(adminPath('/admin/api/portals/'+p.id+'/html'),{method:'POST',headers:{Authorization:'Bearer '+$('token').value,'X-File-Name':f.name,'Content-Type':'text/html'},body:f});const d=await r.json();if(!r.ok)throw Error(d.error||'HTTP '+r.status);toast(t('HTML е съхранен. Достъп: KEY_REQUIRED; скрит от каталога. Настрой правата и ключовете преди публикуване.'),'success');await load()});
 const table=document.createElement('div');table.className='data-table-wrap';const tbl=document.createElement('table');tbl.className='data-table';
 const thead=document.createElement('thead');const hr=document.createElement('tr');for(const label of [t('Файл'),t('Размер'),t('Качен'),t('SHA-256'),t('Действия')]){const th=document.createElement('th');th.textContent=label;hr.append(th)}thead.append(hr);tbl.append(thead);
 const tbody=document.createElement('tbody');
 if(!p.files.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.className='empty';td.textContent=t('Няма файлове');tr.append(td);tbody.append(tr)}
 for(const f of p.files){const tr=document.createElement('tr');tr.dataset.fileId=f.id;tr.dataset.portalId=p.id;
  const nameTd=document.createElement('td');nameTd.append(node('strong',f.name));const sub=document.createElement('div');sub.className='muted';sub.textContent=(f.accessMode||'FREE')+(f.listed===false?' · '+t('скрит'):'');nameTd.append(sub);
  const sizeTd=document.createElement('td');sizeTd.className='num';sizeTd.textContent=fmtSize(f.size);
  const dateTd=document.createElement('td');dateTd.textContent=timeAgo(f.uploadedAt||f.createdAt);dateTd.title=fmtDate(f.uploadedAt||f.createdAt);
  const shaTd=document.createElement('td');const sha=document.createElement('code');sha.className='mono';sha.textContent=(f.sha256||'').slice(0,12)+'…';sha.title=f.sha256||'';shaTd.append(sha);
  const actTd=document.createElement('td');const link=node('button',t('Линк'));link.type='button';link.onclick=()=>copyText(publicUrl+'/files/'+encodeURIComponent(f.id)+'/download');const del=node('button',t('Изтрий'));del.type='button';del.className='danger';del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на ')+f.name+'?'))return;await api('/admin/api/portals/'+p.id+'/files/'+f.id,'DELETE');await load()});actTd.append(link,del);
  tr.append(nameTd,sizeTd,dateTd,shaTd,actTd);tbody.append(tr)}
 tbl.append(tbody);table.append(tbl);box.append(table);
 holder.append(box)}$('status').textContent=t('Удостоверяването е успешно. Заредени портали: ')+data.portals.length}
$('load').onclick=()=>action(load);$('token').addEventListener('keydown',event=>{if(event.key==='Enter')action(load)});$('create').onclick=()=>action(async()=>{await api('/admin/api/portals','POST',{slug:$('slug').value,title:$('title').value});await load()});

// Taxonomy controls are added after each portal list render, without changing legacy actions.
let taxCache={categories:[],groups:[]};
const taxSelect=(kind,current,label)=>{const list=kind==='category'?taxCache.categories:taxCache.groups;const s=document.createElement('select');s.setAttribute('aria-label',label);const none=document.createElement('option');none.value='';none.textContent='— '+label+' —';s.append(none);const vals=[...list];if(current&&!vals.includes(current))vals.push(current);for(const v of vals){const o=document.createElement('option');o.value=v;o.textContent=v;s.append(o)}s.value=current||'';return s};
const originalLoad=load;
load=async function(){await originalLoad();taxCache=await api('/admin/api/taxonomy').catch(()=>taxCache);const data=await api('/admin/api/portals');const articles=[...$('portals').querySelectorAll('article')];for(let i=0;i<data.portals.length;i++){
 const p=data.portals[i],box=articles[i];if(!box)continue;
 const section=node('div','');section.append(node('h4',t('Тема · категория · етикет · група')));
 const controls={};for(const key of ['topic','category','tag','group']){
  const lbl=({topic:t('Тема'),category:t('Категория'),tag:t('Етикет'),group:t('Група')})[key];let input;if(key==='category'||key==='group')input=taxSelect(key,'',lbl);else{input=node('input','');input.placeholder=lbl;input.setAttribute('aria-label',lbl)}controls[key]=input;section.append(input);
 }
 const results=node('div','');const search=node('button',t('Извикай файловете'));search.onclick=()=>action(async()=>{
  const qs=new URLSearchParams({limit:'500'});for(const [key,input]of Object.entries(controls))if(input.value.trim())qs.set(key,input.value.trim());
  const page=await api('/admin/api/portals/'+p.id+'/files?'+qs);results.replaceChildren(node('p',`${t('Намерени: ')}${page.total}${t(' · показани: ')}${page.files.length}`));
  for(const f of page.files)results.append(node('p',`${f.name} · ${f.topic||'—'} / ${f.category||'—'} / ${(f.tags||[]).join(', ')||'—'} / ${f.group||'—'}`));
 });section.append(search,results);
 const heading=node('h4',t('Метаданни на файловете'));section.append(heading);
 for(const f of p.files){const line=node('div','');line.append(node('strong',f.name+' '));const fields={};for(const key of ['topic','category','tags','group']){
  let input;if(key==='category'||key==='group')input=taxSelect(key,f[key]||'',key==='category'?t('Категория'):t('Група'));else{input=node('input','');input.placeholder=key==='tags'?t('Етикети, разделени със запетая'):t('Тема');input.value=key==='tags'?(f.tags||[]).join(', '):f[key]||''}input.setAttribute('aria-label',key+' за '+f.name);fields[key]=input;line.append(input);
 }
 const save=node('button',t('Запази метаданни'));save.onclick=()=>action(async()=>{await api('/admin/api/portals/'+p.id+'/files/'+f.id+'/metadata','PATCH',{
  topic:fields.topic.value,category:fields.category.value,group:fields.group.value,tags:fields.tags.value.split(',').map(x=>x.trim()).filter(Boolean)
 });await load()});line.append(save);section.append(line);
 }
 box.append(section);
 }};

// Admin-only notes and internal attachments; never exposed by the public portal API.
const taxonomyLoad=load;
load=async function(){await taxonomyLoad();const {portals}=await api('/admin/api/portals');const articles=[...$('portals').querySelectorAll('article')];for(let i=0;i<portals.length;i++){
 const p=portals[i],box=articles[i];if(!box)continue;const base='/admin/api/portals/'+p.id;
 const section=node('section','');section.append(node('h4',t('Вътрешни бележки и приложения (само администратор)')));
 const title=node('input','');title.placeholder=t('Заглавие на бележка');const content=node('textarea','');content.placeholder=t('Текст на бележката');
 const add=node('button',t('Добави бележка'));add.onclick=()=>action(async()=>{await api(base+'/notes','POST',{title:title.value,content:content.value});await load()});section.append(title,content,add);
 const notes=await api(base+'/notes');for(const n of notes.notes){const line=node('div','');line.append(node('strong',n.title),node('p',n.content));const edit=node('button',t('Редактирай'));edit.onclick=()=>action(async()=>{const newTitle=prompt(t('Заглавие'),n.title);if(newTitle===null)return;const newContent=prompt(t('Бележка'),n.content);if(newContent===null)return;await api(base+'/notes/'+n.id,'PATCH',{title:newTitle,content:newContent});await load()});const del=node('button',t('Изтрий бележка'));del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на бележката?')))return;await api(base+'/notes/'+n.id,'DELETE');await load()});line.append(edit,del);section.append(line)}
 const fileInput=node('input','');fileInput.type='file';const upload=node('button',t('Качи вътрешен файл'));upload.onclick=()=>action(async()=>{const f=fileInput.files[0];if(!f)throw Error(t('Избери файл'));const r=await fetch(adminPath(base+'/attachments'),{method:'POST',headers:{Authorization:'Bearer '+$('token').value,'X-File-Name':f.name},body:f});if(!r.ok)throw Error((await r.json()).error);await load()});section.append(fileInput,upload);
 const attachments=await api(base+'/attachments');for(const f of attachments.attachments){const line=node('div',f.name+' ('+f.size+' bytes) ');const download=node('button',t('Изтегли'));download.onclick=()=>action(async()=>{const r=await fetch(adminPath(base+'/attachments/'+f.id+'/download'),{headers:{Authorization:'Bearer '+$('token').value}});if(!r.ok)throw Error('Download failed');const blob=await r.blob(),u=URL.createObjectURL(blob),link=document.createElement('a');link.href=u;link.download=f.name;link.click();setTimeout(()=>URL.revokeObjectURL(u),1000)});const del=node('button',t('Изтрий'));del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на приложението?')))return;await api(base+'/attachments/'+f.id,'DELETE');await load()});line.append(download,del);section.append(line)}box.append(section);
 }};

// Per-file access policies. Secrets are shown once and are never written to localStorage.
const previousLoad=load;
load=async function(){await previousLoad();const {portals}=await api('/admin/api/portals');const articles=[...$('portals').querySelectorAll('article')];for(let i=0;i<portals.length;i++){
 const p=portals[i],box=articles[i];if(!box)continue;
 const section=node('section','');section.append(node('h4',t('Права за изтегляне на файловете')));
 for(const f of p.files){
  const line=node('div','');line.className='file-policy';line.append(node('strong',f.name+' '));
  const mode=node('select','');mode.setAttribute('aria-label',t('Режим на ')+f.name);
  for(const value of ['FREE','KEY_REQUIRED','DISABLED']){const option=node('option',value);option.value=value;mode.append(option)}mode.value=f.accessMode||'FREE';
  const listed=node('input','');listed.type='checkbox';listed.checked=f.listed!==false;listed.setAttribute('aria-label',t('Показвай ')+f.name);
  const save=node('button',t('Запази права'));save.onclick=()=>action(async()=>{await api(`/admin/api/portals/${p.id}/files/${f.id}/access`,'PATCH',{mode:mode.value,listed:listed.checked});await load()});
  line.append(mode,node('label',t('Показвай в каталога ')),listed,save);
  const validity=node('select','');validity.setAttribute('aria-label',t('Валидност на ключ за ')+f.name);
  for(const [value,label] of [['never',t('Без срок')],['24h',t('24 часа')],['7d',t('7 дни')],['30d',t('30 дни')]]){const o=node('option',label);o.value=value;validity.append(o)}
  const secret=node('output','');secret.className='secret-output';secret.setAttribute('aria-live','polite');
  const create=node('button',t('Създай файлов ключ'));create.onclick=()=>action(async()=>{
   const expiresAt=validity.value==='never'?null:new Date(Date.now()+({'24h':1,'7d':7,'30d':30}[validity.value])*86400000).toISOString();
   const result=await api(`/admin/api/portals/${p.id}/files/${f.id}/access-keys`,'POST',{expiresAt});
   secret.replaceChildren(node('span',t('Копирай и съхрани ключа сега: ')),node('code',result.key));
   const copy=node('button',t('Копирай ключ'));copy.onclick=()=>navigator.clipboard?.writeText(result.key).catch(()=>{});secret.append(copy);
   const keyList=node('div',`${t('Нов ключ: ')}${result.id} `);const revoke=node('button',t('Отнеми ключ'));revoke.onclick=()=>action(async()=>{await api(`/admin/api/portals/${p.id}/files/${f.id}/access-keys/${result.id}`,'DELETE');await load()});keyList.append(revoke);line.append(keyList);
  });line.append(node('p',''),validity,create,secret);
  for(const key of f.accessKeys||[]){const kline=node('div',`${t('Ключ ')}${key.id} · ${key.expiresAt||t('Без срок')} `);const revoke=node('button',t('Отнеми'));revoke.onclick=()=>action(async()=>{if(!confirm(t('Отнемане на файловия ключ?')))return;await api(`/admin/api/portals/${p.id}/files/${f.id}/access-keys/${key.id}`,'DELETE');await load()});kline.append(revoke);line.append(kline)}
  section.append(line);
 }
 box.append(section);
 }};

// On-demand diagnostics: no background polling, no persisted credentials.
refreshOnLanguageChange('jobs-refresh','jobs-result',async()=>{
 const d=await api('/admin/api/jobs');
 const holder=document.getElementById('jobs-result');holder.replaceChildren();
 holder.append(node('p',`${t('Активни: ')}${d.running}/${d.concurrency}${t(' | В опашка: ')}${d.queued}`));
 if(!d.jobs.length){holder.append(node('p',t('Няма задачи')));return}
 for(const j of d.jobs){
  const line=node('div','');line.append(node('span',`${j.id.slice(0,8)} · ${j.type} · ${j.status} · ${j.progress.done}/${j.progress.total} `));
  if(['queued','running','paused'].includes(j.status)){
   const pause=node('button',t(j.status==='paused'?'Възобнови':'Пауза'));pause.onclick=()=>action(async()=>{await api(`/admin/api/jobs/${j.id}/${j.status==='paused'?'resume':'pause'}`,'POST');document.getElementById('jobs-refresh').click()});line.append(pause);
   const cancel=node('button',t('Откажи'));cancel.className='danger';cancel.onclick=()=>action(async()=>{await api(`/admin/api/jobs/${j.id}/cancel`,'POST');document.getElementById('jobs-refresh').click()});line.append(cancel);
  }
  holder.append(line);
 }
});
refreshOnLanguageChange('diagnostics-refresh','diagnostics-result',async()=>{
 const d=await api('/admin/api/diagnostics');
 document.getElementById('diagnostics-result').textContent=[
  `${t('Работно време: ')}${d.uptimeSeconds} ${t('сек.')} | Node.js ${d.runtime.node}`,
  `${t('RAM RSS: ')}${(d.runtime.rssBytes/1048576).toFixed(1)} MiB | ${t('Heap: ')}${(d.runtime.heapUsedBytes/1048576).toFixed(1)} MiB`,
  `${t('Изтегляния: ')}${d.traffic.activeDownloadStreams}/${d.traffic.effectiveDownloadStreams} (${t('макс')} ${d.traffic.maxDownloadStreams}) | ${t('Завършени: ')}${d.traffic.downloads}`,
  `${t('Натоварване: ')}${d.traffic.load.level} | ${t('Ефективен лимит: ')}${d.traffic.load.effective} | ${t('Съотношение heap: ')}${d.traffic.load.heapRatio.toFixed(2)} | ${t('Последни грешки: ')}${d.traffic.load.recentErrors}`,
  `${t('Заявки: ')}${d.traffic.requests} | ${t('Грешки: ')}${d.traffic.errors}`,
  `${t('Портали: ')}${d.catalog.portals} | ${t('Файлове: ')}${d.catalog.files}`,
  ...d.storage.map(x=>`${x.name}: ${t(x.available?'Налично':'Липсва')}, ${t(x.writable?'Записваемо':'Само за четене')}`)
 ].join('\n');
});
refreshOnLanguageChange('audit-verify','audit-verify-result',async()=>{
 const v=await api('/admin/api/audit/verify');
 document.getElementById('audit-verify-result').textContent=[
  `${t('Статус: ')}${v.valid?t('ВАЛИДНА'):t('НАРУШЕНА')} | ${t('Записи: ')}${v.count}`,
  `${t('Последен hash: ')}${v.lastHash||''}`,
  ...(v.valid?[]:[`${t('Причина: ')}${v.reason||'UNKNOWN'}`])
 ].join('\n');
});

// Batch policy editor with explicit preview and confirmation.
const bulkPreviousLoad=load;
load=async function(){await bulkPreviousLoad();const {portals}=await api('/admin/api/portals');const articles=[...$('portals').querySelectorAll('article')];for(let i=0;i<portals.length;i++){
 const p=portals[i],box=articles[i];if(!box||!p.files.length)continue;
 const section=node('section','');section.append(node('h4',t('Групово управление на достъпа')));
 const choices=[];for(const f of p.files){const label=node('label','');const check=node('input','');check.type='checkbox';check.setAttribute('aria-label',t('Избери ')+f.name);label.append(check,node('span',' '+f.name));section.append(label);choices.push({check,id:f.id})}
 const mode=node('select','');for(const m of ['FREE','KEY_REQUIRED','DISABLED']){const o=node('option',m);o.value=m;mode.append(o)}
 const listed=node('select','');for(const [value,text] of [['keep',t('Без промяна на видимостта')],['yes',t('Показвай')],['no',t('Скрий')]]){const o=node('option',text);o.value=value;listed.append(o)}
 const preview=node('pre','');const button=node('button',t('Прегледай промените'));
 button.onclick=()=>action(async()=>{const fileIds=choices.filter(x=>x.check.checked).map(x=>x.id);if(!fileIds.length)throw Error(t('Избери файлове'));const payload={fileIds,mode:mode.value,dryRun:true};if(listed.value!=='keep')payload.listed=listed.value==='yes';const base='/admin/api/portals/'+p.id+'/files/bulk-access';const plan=await api(base,'POST',payload);preview.textContent=plan.changes.map(x=>`${x.name}: ${x.before.mode} → ${x.after.mode}${t('; видимост ')}${x.before.listed} → ${x.after.listed}`).join('\n');if(!confirm(t('Приложи груповите промени за ')+plan.count+t(' файла?')))return;await api(base,'POST',{...payload,dryRun:false});await load()});
 section.append(mode,listed,button,preview);box.append(section);
}};

// Runtime settings are stored in config/settings.json, not configuration.yaml.
const LIM={'lim-upload':['maxUploadMb',e=>Math.round(e.maxUploadBytes/1048576)],'lim-streams':['maxDownloadStreams',e=>e.maxDownloadStreams],'lim-jobs':['maxJobs',e=>e.maxJobs],'lim-check':['storageCheckMinutes',e=>Math.round(e.storageCheckIntervalMs/60000)],'lim-url':['publicBaseUrl',e=>e.publicBaseUrl],'lim-cors':['corsOrigin',e=>e.corsOrigin]};
function fillLimits(r){const l=r.settings.limits||{},e=r.effective||{};for(const [id,[k,f]] of Object.entries(LIM)){const el=$(id);el.value=l[k]===null||l[k]===undefined?'':l[k];el.placeholder=e&&e.maxUploadBytes!==undefined?String(f(e)):el.placeholder}for(const [id,k] of [['lim-token','requirePortalToken'],['lim-ip','storeRawIp']])$(id).value=l[k]===null||l[k]===undefined?'':String(l[k])}
function readLimits(){const o={};for(const [id,[k]] of Object.entries(LIM)){const v=$(id).value.trim();o[k]=v===''?(k==='publicBaseUrl'||k==='corsOrigin'?'':null):(k==='publicBaseUrl'||k==='corsOrigin'?v:Number(v))}for(const [id,k] of [['lim-token','requirePortalToken'],['lim-ip','storeRawIp']]){const v=$(id).value;o[k]=v===''?null:v==='true'}return o}
$('settings-load').onclick=()=>action(async()=>{const r=await api('/admin/api/settings');$('artifact-directory').value=r.settings.artifactDirectory;$('database-file').value=r.settings.databaseFile;$('database-directory').value=r.settings.databaseDirectory||'.';fillLimits(r);$('settings-status').textContent=t('Настройки заредени')});
$('settings-save').onclick=()=>action(async()=>{const r=await api('/admin/api/settings','PATCH',{artifactDirectory:$('artifact-directory').value,databaseFile:$('database-file').value,databaseDirectory:$('database-directory').value,limits:readLimits()});fillLimits(r);$('settings-status').textContent=r.restartRequired?t('Запазено. Някои промени се прилагат след рестарт на add-on-а.'):t('Настройките са запазени.')});

// HTML projects are registered from DATA_DIR/html-projects/<folder> with index.html.
const htmlProjectLoad=load;
load=async function(){await htmlProjectLoad();const {portals}=await api('/admin/api/portals');const articles=[...$('portals').querySelectorAll('article')];for(let i=0;i<portals.length;i++){const p=portals[i],box=articles[i];if(!box)continue;const section=node('section','');section.append(node('h4',t('HTML проекти · автоматичен index.html')));const folder=node('input','');folder.placeholder=t('Папка в html-projects (напр. landing)');const title=node('input','');title.placeholder=t('Име на проекта');const add=node('button',t('Публикувай проект'));add.onclick=()=>action(async()=>{await api('/admin/api/portals/'+p.id+'/html-projects','POST',{folder:folder.value,title:title.value});await load()});section.append(folder,title,add);for(const pr of p.htmlProjects||[]){const line=node('p',pr.title+' · '+pr.folder+' ');const link=node('a',t('Отвори'));link.href=adminPath('/site/'+encodeURIComponent(p.slug)+'/'+pr.id+'/');link.target='_blank';link.rel='noopener';const del=node('button',t('Премахни публикуването'));del.onclick=()=>action(async()=>{await api('/admin/api/portals/'+p.id+'/html-projects/'+pr.id,'DELETE');await load()});line.append(link,del);section.append(line)}box.append(section)}};

// API users + REST endpoints for external access (e.g. Home Assistant).
const apiAccessLoad=load;
load=async function(){await apiAccessLoad();const pub='http://<host>:8099';
 let box=$('api-users');
 if(!box){box=node('section','');box.id='api-users';const portals=$('portals');portals.insertBefore(box,portals.firstChild)}
 box.replaceChildren();
 box.append(node('h4',t('Публичен API · потребители')));
 box.append(node('p',t('Вписването издава сесиен токен за достъп до порталите и файловете, замествайки старите dp_ ключове.')));
 const create=node('div','');create.className='api-user-create';
 const uInput=node('input','');uInput.placeholder=t('Потребителско име');uInput.setAttribute('aria-label','username');
 const pInput=node('input','');pInput.type='password';pInput.placeholder=t('Парола (мин. 8)');pInput.setAttribute('aria-label','password');
 const scopes=node('div','');const scopeChecks={};for(const s of ['read','download']){const c=node('input','');c.type='checkbox';c.value=s;c.checked=s==='read';scopeChecks[s]=c;const lbl=node('label','');lbl.append(c,' '+s+' ');scopes.append(lbl)}
 const add=node('button',t('Създай потребител'));
 add.onclick=()=>action(async()=>{
  const sc=Object.keys(scopeChecks).filter(k=>scopeChecks[k].checked);
  await api('/admin/api/users','POST',{username:uInput.value.trim(),password:pInput.value,scopes:sc});
  uInput.value='';pInput.value='';await load();
 });
 create.append(uInput,pInput,scopes,add);box.append(create);
 const users=node('div','');
 const {users:list}=await api('/admin/api/users');
 for(const u of list){
  const line=node('div','');line.append(node('code',u.username+' · '+(u.scopes||[]).join(', ')+' · '+(u.active?t('Активен'):t('Деактивиран'))+' · '+new Date(u.createdAt).toLocaleString()+' '));
  const toggle=node('button',u.active?t('Деактивирай'):t('Активирай'));toggle.onclick=()=>action(async()=>{await api('/admin/api/users/'+encodeURIComponent(u.username),'PATCH',{active:!u.active});await load()});
  const reset=node('button',t('Смени парола'));reset.onclick=()=>action(async()=>{const pw=prompt(t('Нова парола (мин. 8)'));if(!pw)return;await api('/admin/api/users/'+encodeURIComponent(u.username),'PATCH',{password:pw});alert('OK')});
  const del=node('button',t('Изтрий'));del.className='danger';del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на потребител ')+u.username+'?'))return;await api('/admin/api/users/'+encodeURIComponent(u.username),'DELETE');await load()});
  line.append(toggle,reset,del);users.append(line)
 }
 if(!list.length)users.append(node('p',t('Няма API потребители')));
 box.append(users);
 const endpoints=[
  ['POST '+t('Вписване (login)'),pub+'/api/v1/auth/login'],
  ['POST '+t('Изход (logout)'),pub+'/api/v1/auth/logout'],
  ['GET '+t('Текущ потребител (me)'),pub+'/api/v1/auth/me'],
  ['GET '+t('Списък с портали'),pub+'/api/v1/portals'],
  ['GET '+t('Метаданни на портал'),pub+'/api/v1/p/{slug}'],
  ['GET '+t('Файлове'),pub+'/api/v1/p/{slug}/files'],
  ['GET '+t('Изтегляне на файл'),pub+'/api/v1/p/{slug}/files/{fileId}/download'],
  ['GET '+t('OpenAPI спецификация'),pub+'/api/v1/p/{slug}/openapi.json']
 ];
 box.append(node('p',t('REST endpoint-и')));
 const epList=node('div','');for(const [name,url] of endpoints){const line=node('div','');line.append(node('code',name+'  '+url+' '));const copy=node('button',t('Копирай'));copy.onclick=()=>navigator.clipboard?.writeText(url);line.append(copy);epList.append(line)}
 box.append(epList);
 const curl=node('pre','TOKEN=$(curl -s -X POST -H "Content-Type: application/json" -d \'{"username":"user","password":"pass"}\' "'+(pub||'')+'/api/v1/auth/login")\ncurl -H "Authorization: Bearer $TOKEN" "'+(pub||'')+'/api/v1/portals"');
 box.append(node('p',t('Пример (curl)')),curl);
};

// Consistent SQLite backup, admin-only and on demand.
document.getElementById('database-backup').addEventListener('click',()=>action(async()=>{
 const result=await api('/admin/api/database/backup','POST');
 const b=result.backup;
 document.getElementById('database-backup-status').textContent=`${b.name}\n${b.bytes} bytes\nSHA-256: ${b.sha256}`;
}));

// Intelligent load control snapshot.
refreshOnLanguageChange('load-refresh','load-result',async()=>{
 const d=await api('/admin/api/load');
 document.getElementById('load-result').textContent=[
  `${t('Ниво: ')}${d.level} | ${t('Ефективен лимит: ')}${d.effective}/${d.base} (${t('минимум')} ${d.min})`,
  `${t('Съотношение heap: ')}${d.heapRatio.toFixed(2)} | ${t('Последни грешки: ')}${d.recentErrors} (${t('прозорец')} ${d.errorWindowMs} ms)`,
  d.lastRecalc?`${t('Последно преизчисляване: ')}${d.lastRecalc.at} · ${t('ниво')} ${d.lastRecalc.level} · ${t('ефективно')} ${d.lastRecalc.effective}`:''
 ].join('\n');
});

// Centralized error log, newest first, with optional level filter.
refreshOnLanguageChange('errors-refresh','errors-result',async()=>{
 const level=document.getElementById('error-level').value;
 const qs=level?`?level=${encodeURIComponent(level)}`:'';
 const d=await api('/admin/api/errors'+qs);
 document.getElementById('errors-result').textContent=d.events.length
  ? d.events.map(e=>`${e.at} [${e.level}] ${e.source}: ${e.message}`).join('\n')
  : t('Няма записани грешки');
});

// Named configuration profiles: save / list / apply / delete.
document.getElementById('profile-save').addEventListener('click',()=>action(async()=>{
 const name=document.getElementById('profile-name').value.trim();
 const raw=document.getElementById('profile-settings').value.trim();
 let settings;if(raw){try{settings=JSON.parse(raw)}catch{throw Error(t('Невалиден JSON за настройки'))}}
 const payload={name};if(settings)payload.settings=settings;
 const r=await api('/admin/api/config-profiles','POST',payload);
 document.getElementById('profiles-result').textContent=`${t('Запазен профил: ')}${r.profile.name}`;
}));
refreshOnLanguageChange('profile-list','profiles-result',async()=>{
 const d=await api('/admin/api/config-profiles');
 document.getElementById('profiles-result').replaceChildren(
  ...d.profiles.map(p=>{const line=node('p',`${p.name}${t(' · създаден ')}${p.createdAt} · org: ${p.settings.organization||'—'}`);return line})
 );
});
document.getElementById('profile-apply').addEventListener('click',()=>action(async()=>{
 const name=document.getElementById('profile-name').value.trim();if(!name)throw Error(t('Въведи име на профил'));
 const r=await api(`/admin/api/config-profiles/${encodeURIComponent(name)}/apply`,'POST');
 document.getElementById('profiles-result').textContent=`${t('Приложен профил: ')}${r.profile}${r.restartRequired?t(' (изисква се рестарт)'):''}`;
}));
document.getElementById('profile-delete').addEventListener('click',()=>action(async()=>{
 const name=document.getElementById('profile-name').value.trim();if(!name)throw Error(t('Въведи име на профил'));
 await api(`/admin/api/config-profiles/${encodeURIComponent(name)}`,'DELETE');
 document.getElementById('profiles-result').textContent=`${t('Изтрит профил: ')}${name}`;
}));

// Backup listing with one-click restore (transactional round-trip).
refreshOnLanguageChange('backup-list','backup-list-result',async()=>{
 const d=await api('/admin/api/database/backups');
 const holder=document.getElementById('backup-list-result');holder.replaceChildren();
 if(!d.backups.length){holder.textContent=t('Няма резервни копия');return}
 for(const b of d.backups){
  const line=node('p',`${b.name} · ${b.bytes} bytes · ${b.createdAt} `);
  const restore=node('button',t('Възстанови'));restore.className='danger';
  restore.onclick=()=>action(async()=>{
   if(!confirm(`${t('Възстановяване от ')}${b.name}${t('? Текущите метаданни ще бъдат заменени.')}`))return;
   const r=await api(`/admin/api/database/backups/${encodeURIComponent(b.name)}/restore`,'POST');
   holder.replaceChildren(node('p',`${t('Възстановени: ')}${r.restored.portals}${t(' портала, ')}${r.restored.qrArtifacts}${t(' QR артефакта (revision ')}${r.restored.revision}${t('). Презареди порталите.')}`));
  });
  line.append(restore);holder.append(line);
 }
});

// On-demand storage health check; the server also runs this automatically on an interval.
document.getElementById('storage-check').addEventListener('click',()=>action(async()=>{
 const d=await api('/admin/api/storage/check','POST');
 document.getElementById('storage-result').textContent=[
  `${t('Състояние: ')}${d.healthy?t('ЗДРАВО'):t('ПРОБЛЕМ')}${t(' · проверено ')}${d.checkedAt}`,
  ...d.locations.map(x=>`${x.name}: ${x.available?'available':'missing'}, ${x.writable?'writable':'NOT writable'}${x.error?' ('+x.error+')':''}`)
 ].join('\n');
}));

// Backup scheduler (GET/PUT /admin/api/database/backup-schedule).
const _schedEnabled=$('sched-enabled'),_schedInterval=$('sched-interval'),_schedMax=$('sched-max'),_schedNext=$('sched-next');
const loadSchedule=async()=>{try{const d=await api('/admin/api/database/backup-schedule','GET');const s=d.schedule||{};_schedEnabled.checked=!!s.enabled;_schedInterval.value=s.intervalMinutes??1440;_schedMax.value=s.maxBackups??10;_schedNext.textContent=t('Следващо изпълнение')+': '+(d.nextRunAt||'—')}catch(e){_schedNext.textContent='⚠ '+(e&&e.message?e.message:e)}};
$('sched-load').addEventListener('click',()=>action(loadSchedule));
$('sched-save').addEventListener('click',()=>action(async()=>{
 const intervalMinutes=Math.max(5,parseInt(_schedInterval.value,10)||1440);
 const maxBackups=Math.max(1,parseInt(_schedMax.value,10)||10);
 const d=await api('/admin/api/database/backup-schedule','PUT',{enabled:_schedEnabled.checked,intervalMinutes,maxBackups});
 _schedNext.textContent=t('Следващо изпълнение')+': '+(d.nextRunAt||'—');
 $('status').textContent=t('Графикът е запазен');
}));
{const previousLoad=load;load=async function(){await previousLoad();await loadSchedule()}}

Object.assign(ADMIN_DIC.en,{'Опции':'Options','Качи':'Upload','Преглед':'Review','Скрий прегледа':'Hide review','Обедини с други портали…':'Merge with other portals…','API адрес и QR код':'API address and QR code','Обединяване на портали':'Merge portals','Избери порталите, които да се вмъкнат в':'Select the portals to merge into','Файловете, приложенията и бележките им се преместват тук. Техните API-та и директории се изтриват.':'Their files, attachments and notes move here. Their APIs and directories are deleted.','Няма други портали.':'There are no other portals.','Обедини':'Merge','Затвори':'Close','Обединено. Преместени портали: ':'Merged. Portals moved: ','Копирай':'Copy','Директория':'Directory','Картотека':'Filing cabinet','Категории и групи':'Categories and groups','Категории':'Categories','Групи':'Groups','Добави':'Add','Изтрий':'Delete','Създай ги тук веднъж, после ги избираш от падащо меню при всеки файл.':'Create them here once, then pick them from a dropdown on every file.','Нова папка':'New folder','Създай':'Create','Word документ':'Word document','Excel таблица':'Excel spreadsheet','Текстов файл':'Text file','Markdown файл':'Markdown file','Име':'Name','Преименувай':'Rename','Изтегли':'Download','Отвори':'Open','Отвори на компютъра':'Open on this computer','Преобразувай в PDF':'Convert to PDF','Папката е празна.':'This folder is empty.','Запази':'Save','Запазено.':'Saved.','Преобразувано: ':'Converted: ','Изтриване на ':'Delete ','Затвори прегледа':'Close preview','Файлът няма преглед. Изтегли го или го отвори на компютъра.':'No preview for this file. Download it or open it on this computer.','Категория':'Category','Група':'Group'});
Object.assign(ADMIN_DIC.de,{'Опции':'Optionen','Качи':'Hochladen','Преглед':'Übersicht','Скрий прегледа':'Übersicht ausblenden','Обедини с други портали…':'Mit anderen Portalen zusammenführen…','API адрес и QR код':'API-Adresse und QR-Code','Обединяване на портали':'Portale zusammenführen','Избери порталите, които да се вмъкнат в':'Portale wählen, die zusammengeführt werden in','Файловете, приложенията и бележките им се преместват тук. Техните API-та и директории се изтриват.':'Ihre Dateien, Anhänge und Notizen werden hierher verschoben. Ihre APIs und Verzeichnisse werden gelöscht.','Няма други портали.':'Keine anderen Portale.','Обедини':'Zusammenführen','Затвори':'Schließen','Обединено. Преместени портали: ':'Zusammengeführt. Portale: ','Копирай':'Kopieren','Директория':'Verzeichnis','Картотека':'Ablage','Категории и групи':'Kategorien und Gruppen','Категории':'Kategorien','Групи':'Gruppen','Добави':'Hinzufügen','Изтрий':'Löschen','Създай ги тук веднъж, после ги избираш от падащо меню при всеки файл.':'Hier einmal anlegen, dann bei jeder Datei per Dropdown wählen.','Нова папка':'Neuer Ordner','Създай':'Erstellen','Word документ':'Word-Dokument','Excel таблица':'Excel-Tabelle','Текстов файл':'Textdatei','Markdown файл':'Markdown-Datei','Име':'Name','Преименувай':'Umbenennen','Изтегли':'Herunterladen','Отвори':'Öffnen','Отвори на компютъра':'Auf diesem Computer öffnen','Преобразувай в PDF':'In PDF umwandeln','Папката е празна.':'Dieser Ordner ist leer.','Запази':'Speichern','Запазено.':'Gespeichert.','Преобразувано: ':'Umgewandelt: ','Изтриване на ':'Löschen: ','Затвори прегледа':'Vorschau schließen','Файлът няма преглед. Изтегли го или го отвори на компютъра.':'Keine Vorschau. Herunterladen oder auf diesem Computer öffnen.','Категория':'Kategorie','Група':'Gruppe'});

const authHeader=()=>({Authorization:'Bearer '+$('token').value});
const dialog=(title,content,buttons=[])=>{const d=document.createElement('dialog');d.style.cssText='background:var(--surface);color:var(--text);border:1px solid var(--border-strong);border-radius:10px;padding:20px;max-width:min(92vw,520px)';const h=node('h3',title);h.style.marginTop='0';const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:16px';for(const b of buttons)row.append(b);const close=node('button',t('Затвори'));close.type='button';close.onclick=()=>d.close();row.append(close);d.append(h,content,row);d.addEventListener('close',()=>d.remove());document.body.append(d);d.showModal();return d};
const fmtSize=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB';
const fmtBytes=n=>{n=Number(n)||0;if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';if(n<1073741824)return (n/1048576).toFixed(1)+' MB';return (n/1073741824).toFixed(2)+' GB'};
const fmtDate=s=>{const ms=Date.parse(s);return Number.isFinite(ms)?new Date(ms).toLocaleString():'—'};
const timeAgo=s=>{const ms=Date.parse(s);if(!Number.isFinite(ms))return '—';const sec=Math.floor((Date.now()-ms)/1000);if(sec<60)return t('току-що');if(sec<3600)return Math.floor(sec/60)+' '+t('мин');if(sec<86400)return Math.floor(sec/3600)+' '+t('ч');if(sec<2592000)return Math.floor(sec/86400)+' '+t('дни');return fmtDate(s)};
const toast=(msg,type='info')=>{let stack=$('toast-stack');if(!stack){stack=document.createElement('div');stack.id='toast-stack';document.body.append(stack)}const el=document.createElement('div');el.className='toast'+(type==='error'?' toast-error':type==='success'?' toast-success':'');el.append(node('span',msg));const close=node('button','×');close.className='toast-close';close.type='button';close.onclick=()=>el.remove();el.append(close);stack.append(el);setTimeout(()=>el.remove(),4200)};
const copyText=async text=>{const done=()=>toast(t('Копирано в клипборда'),'success');try{await navigator.clipboard.writeText(text);done()}catch{try{const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();done()}catch{toast(t('Копирането не успя'),'error')}}};

// Categories and groups: created once here, chosen from dropdowns elsewhere.
async function loadTaxonomy(){
 taxCache=await api('/admin/api/taxonomy');
 for(const kind of ['category','group']){
  const ul=$('tax-list-'+kind);ul.replaceChildren();
  for(const name of taxCache[kind==='category'?'categories':'groups']){const li=document.createElement('li');li.append(node('span',name));const del=node('button',t('Изтрий'));del.type='button';del.className='danger';del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на ')+name+'?'))return;await api('/admin/api/taxonomy?kind='+kind+'&name='+encodeURIComponent(name),'DELETE');await loadTaxonomy()});li.append(del);ul.append(li)}
 }
}
for(const kind of ['category','group'])$('tax-form-'+kind).addEventListener('submit',e=>{e.preventDefault();action(async()=>{const input=$('tax-new-'+kind);if(!input.value.trim())return;await api('/admin/api/taxonomy','POST',{kind,name:input.value});input.value='';await loadTaxonomy()})});

// Portal card: Options · Upload · Review.
{const previous=load;const openReviews=new Set();
load=async function(){await previous();await loadTaxonomy().catch(()=>{});
 const {portals}=await api('/admin/api/portals');const articles=[...$('portals').querySelectorAll('article')];
 portals.forEach((p,i)=>{const box=articles[i];if(!box)return;
  const wrap=box.querySelector(':scope > .menu-wrap'),fileInput=box.querySelector(':scope > input[type=file]:not([accept])');if(!wrap||!fileInput)return;
  const list=wrap.querySelector('.menu');wrap.querySelector('button').textContent=t('Опции');
  for(const b of [...list.children])if(b.textContent===t('Качи файл'))b.remove();
  const addItem=(label,fn,danger)=>{const b=node('button',label);b.type='button';if(danger)b.className='danger';b.onclick=e=>{e.stopPropagation();closeMenus();action(fn)};list.insertBefore(b,list.querySelector('.danger'))};
  addItem(t('Обедини с други портали…'),async()=>{
   const others=portals.filter(x=>x.id!==p.id),body=document.createElement('div');
   body.append(node('p',t('Избери порталите, които да се вмъкнат в')+' „'+p.title+'“'));
   if(!others.length)body.append(node('p',t('Няма други портали.')));
   const boxes=others.map(o=>{const l=document.createElement('label');l.style.cssText='display:flex;gap:8px;align-items:center;margin:6px 0';const c=document.createElement('input');c.type='checkbox';c.value=o.id;l.append(c,node('span',o.title+' ('+o.slug+') · '+o.files.length));body.append(l);return c});
   body.append(node('small',t('Файловете, приложенията и бележките им се преместват тук. Техните API-та и директории се изтриват.')));
   const go=node('button',t('Обедини'));go.type='button';go.className='btn-primary';go.disabled=!others.length;
   const d=dialog(t('Обединяване на портали'),body,[go]);
   go.onclick=()=>action(async()=>{const ids=boxes.filter(c=>c.checked).map(c=>c.value);if(!ids.length)return;await api('/admin/api/portals/merge','POST',{targetId:p.id,sourceIds:ids});d.close();await load();$('status').textContent=t('Обединено. Преместени портали: ')+ids.length})});
  addItem(t('API адрес и QR код'),async()=>{
   const info=await api('/admin/api/portals/'+p.id+'/api-info'),body=document.createElement('div');
   const img=document.createElement('img');const url=URL.createObjectURL(new Blob([info.qr],{type:'image/svg+xml'}));img.src=url;img.alt='QR';img.style.cssText='width:200px;height:200px;background:#fff;padding:8px;border-radius:6px';
   const code=node('code',info.apiUrl);code.style.wordBreak='break-all';
   const copy=node('button',t('Копирай'));copy.type='button';copy.onclick=()=>navigator.clipboard&&navigator.clipboard.writeText(info.apiUrl).catch(()=>{});
   body.append(img,node('p',''),code,node('p',t('Директория')+': '+info.directory));const d=dialog('API · '+p.title,body,[copy]);d.addEventListener('close',()=>URL.revokeObjectURL(url))});
  const up=node('button',t('Качи'));up.type='button';up.className='btn-primary';up.onclick=()=>fileInput.click();
  const rev=node('button',t('Преглед'));rev.type='button';
  const actions=document.createElement('div');actions.className='portal-actions';box.insertBefore(actions,wrap);actions.append(wrap,up,rev);
  const review=document.createElement('div');review.className='review';review.hidden=!openReviews.has(p.id);
  while(actions.nextSibling)review.append(actions.nextSibling);
  const sync=()=>{review.hidden=!openReviews.has(p.id);rev.textContent=openReviews.has(p.id)?t('Скрий прегледа'):t('Преглед');rev.setAttribute('aria-expanded',String(!review.hidden))};
  rev.onclick=()=>{openReviews.has(p.id)?openReviews.delete(p.id):openReviews.add(p.id);sync()};sync();
  box.append(review);
 });
};}

// Filing cabinet: separate document store with folders, previews, editing and conversion.
const cab={path:'',info:{createTypes:[],convert:{},localOpen:false},url:null,current:null};
const cabRel=n=>cab.path?cab.path+'/'+n:n;
const cabFetch=async(act,{query='',method='GET',json,body,headers={}}={})=>{const h={...authHeader(),...headers};let b=body;if(json!==undefined){h['Content-Type']='application/json';b=JSON.stringify(json)}const r=await fetch(adminPath('/admin/api/cabinet/'+act+query),{method,headers:h,body:b});if(!r.ok){let m='HTTP '+r.status;try{m=(await r.json()).error||m}catch{}throw Error(m)}return r};
const cabJson=async(...a)=>(await cabFetch(...a)).json();
const cabQ=p=>'?path='+encodeURIComponent(p);
const cabExt=n=>{const i=n.lastIndexOf('.');return i<0?'':n.slice(i+1).toLowerCase()};
function cabCloseViewer(){if(cab.url){URL.revokeObjectURL(cab.url);cab.url=null}cab.current=null;const v=$('cab-viewer');v.hidden=true;v.replaceChildren();document.querySelector('.cab-split').classList.remove('has-viewer')}
async function cabOpen(item){
 const rel=cabRel(item.name),e=item.ext;
 if(!['pdf','png','jpg','jpeg','gif','webp','txt','md','csv','json'].includes(e)){
  if(cab.info.localOpen){await cabJson('open',{method:'POST',json:{path:rel}});return}
  return cabDownload(item)}
 cabCloseViewer();const r=await cabFetch('file',{query:cabQ(rel)});const blob=await r.blob();
 const v=$('cab-viewer');v.replaceChildren();v.hidden=false;document.querySelector('.cab-split').classList.add('has-viewer');cab.current=rel;
 const head=document.createElement('div');head.style.cssText='display:flex;justify-content:space-between;align-items:center;gap:8px';head.append(node('strong',item.name));
 const close=node('button',t('Затвори прегледа'));close.type='button';close.onclick=cabCloseViewer;head.append(close);v.append(head);
 if(e==='pdf'){cab.url=URL.createObjectURL(new Blob([blob],{type:'application/pdf'}));const f=document.createElement('iframe');f.src=cab.url;f.title=item.name;v.append(f)}
 else if(['png','jpg','jpeg','gif','webp'].includes(e)){cab.url=URL.createObjectURL(blob);const img=document.createElement('img');img.src=cab.url;img.alt=item.name;v.append(img)}
 else{const ta=document.createElement('textarea');ta.value=await blob.text();ta.setAttribute('aria-label',item.name);const save=node('button',t('Запази'));save.type='button';save.className='btn-primary';save.onclick=()=>action(async()=>{await cabJson('save',{method:'POST',query:cabQ(rel),body:ta.value,headers:{'Content-Type':'text/plain'}});$('status').textContent=t('Запазено.');await cabList()});v.append(ta,save)}
}
async function cabDownload(item){const r=await cabFetch('file',{query:cabQ(cabRel(item.name))});const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=item.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
async function cabList(){
 const data=await cabJson('list',{query:cabQ(cab.path)});cab.path=data.path;
 const crumbs=$('cab-crumbs');crumbs.replaceChildren();const segs=cab.path?cab.path.split('/'):[];
 const go=p=>()=>{cab.path=p;cabCloseViewer();action(cabList)};
 const root=node('button',t('Картотека'));root.type='button';root.onclick=go('');crumbs.append(root);
 segs.forEach((s,i)=>{crumbs.append(node('span','/'));const b=node('button',s);b.type='button';b.onclick=go(segs.slice(0,i+1).join('/'));crumbs.append(b)});
 const list=$('cab-list');list.replaceChildren();
 if(!data.items.length){const e=node('p',t('Папката е празна.'));e.className='cab-empty';list.append(e)}
 for(const it of data.items){
  const row=document.createElement('div');row.className='cab-row';
  const name=node('button',(it.type==='folder'?'▸ ':'')+it.name);name.type='button';name.className='cab-name';name.title=it.name;
  name.onclick=()=>action(async()=>{if(it.type==='folder'){cab.path=cabRel(it.name);cabCloseViewer();await cabList()}else await cabOpen(it)});
  row.append(name,node('span',it.type==='folder'?'':fmtSize(it.size)));row.lastChild.className='cab-meta';
  const items=[];
  if(it.type==='file'){items.push({label:t('Отвори'),run:()=>cabOpen(it)});
   if(cab.info.localOpen)items.push({label:t('Отвори на компютъра'),run:()=>cabJson('open',{method:'POST',json:{path:cabRel(it.name)}})});
   if((cab.info.convert[it.ext]||[]).includes('pdf'))items.push({label:t('Преобразувай в PDF'),run:async()=>{const o=await cabJson('convert',{method:'POST',json:{path:cabRel(it.name),to:'pdf'}});await cabList();$('status').textContent=t('Преобразувано: ')+o.name}});
   items.push({label:t('Изтегли'),run:()=>cabDownload(it)})}
  items.push({label:t('Преименувай'),run:async()=>{const n=prompt(t('Име'),it.name);if(!n||n===it.name)return;await cabJson('rename',{method:'POST',json:{path:cabRel(it.name),name:n}});cabCloseViewer();await cabList()}});
  items.push({label:t('Изтрий'),danger:true,run:async()=>{if(!confirm(t('Изтриване на ')+it.name+'?'))return;await cabJson('entry',{method:'DELETE',query:cabQ(cabRel(it.name))});cabCloseViewer();await cabList()}});
  row.append(menu(t('Опции'),items));list.append(row);
 }
}
function cabBuildTools(){
 const tools=$('cab-tools');tools.replaceChildren();
 const folder=node('button',t('Нова папка'));folder.type='button';folder.onclick=()=>action(async()=>{const n=prompt(t('Име'));if(!n)return;await cabJson('folder',{method:'POST',json:{path:cab.path,name:n}});await cabList()});
 const up=node('button',t('Качи'));up.type='button';up.className='btn-primary';up.onclick=()=>$('cab-file').click();
 const labels={docx:t('Word документ'),xlsx:t('Excel таблица'),txt:t('Текстов файл'),md:t('Markdown файл')};
 const create=menu(t('Създай'),cab.info.createTypes.map(type=>({label:labels[type]||type,run:async()=>{const n=prompt(t('Име'));if(!n)return;await cabJson('create',{method:'POST',json:{path:cab.path,name:n,type}});await cabList()}})));
 tools.append(up,folder,create);
}
$('cab-file').onchange=()=>action(async()=>{for(const f of [...$('cab-file').files])await cabFetch('upload',{method:'POST',query:cabQ(cab.path),body:f,headers:{'X-File-Name':encodeURIComponent(f.name)}});$('cab-file').value='';await cabList()});
async function cabInit(){cab.info=await cabJson('info');cabBuildTools();await cabList()}
{const previous=load;load=async function(){await previous();await cabInit()}}

Object.assign(ADMIN_DIC.en,{'Указател':'Directory','Променливи':'Variables','Конфликти':'Conflicts','Данните не съвпадат. Избери стойност или въведи своя.':'The data does not match. Pick a value or enter your own.','Добави имейл адреси':'Add email addresses','Въведи един или повече адреса. Останалото се попълва от правилата за домейни.':'Enter one or more addresses. The rest is filled from the domain rules.','Правила за домейни':'Domain rules','Въвеждаш данните веднъж за домейн, напр. @martinswerk.de. Можеш да ползваш {{променлива}}.':'Enter the data once per domain, e.g. @martinswerk.de. You can use {{variable}}.','Добави правило':'Add rule','Контакти':'Contacts','Всеки вид данни е променлива. Липсваща се създава тук и веднага се появява в указателя.':'Every kind of data is a variable. A missing one is created here and appears in the directory at once.','Етикет':'Label','Поле на контакт':'Contact field','Няма контакти.':'No contacts.','Няма правила.':'No rules.','Реши':'Resolve','Своя стойност':'Custom value','Създадени: ':'Created: ','Неразпознати домейни: ':'Domains without a rule: ','Невалидни: ':'Invalid: ','Конфликти: ':'Conflicts: ','Приложено към контакти: ':'Applied to contacts: ','Стойност':'Value','Запази':'Save','Липсва правило за домейна':'No rule for this domain','Тест':'Test'});
Object.assign(ADMIN_DIC.de,{'Указател':'Verzeichnis','Променливи':'Variablen','Конфликти':'Konflikte','Данните не съвпадат. Избери стойност или въведи своя.':'Die Daten stimmen nicht überein. Wert wählen oder eigenen eingeben.','Добави имейл адреси':'E-Mail-Adressen hinzufügen','Въведи един или повече адреса. Останалото се попълва от правилата за домейни.':'Eine oder mehrere Adressen eingeben. Der Rest wird aus den Domain-Regeln gefüllt.','Правила за домейни':'Domain-Regeln','Въвеждаш данните веднъж за домейн, напр. @martinswerk.de. Можеш да ползваш {{променлива}}.':'Daten einmal pro Domain eingeben, z. B. @martinswerk.de. {{Variable}} möglich.','Добави правило':'Regel hinzufügen','Контакти':'Kontakte','Всеки вид данни е променлива. Липсваща се създава тук и веднага се появява в указателя.':'Jede Datenart ist eine Variable. Fehlende werden hier angelegt und erscheinen sofort im Verzeichnis.','Етикет':'Bezeichnung','Поле на контакт':'Kontaktfeld','Няма контакти.':'Keine Kontakte.','Няма правила.':'Keine Regeln.','Реши':'Lösen','Своя стойност':'Eigener Wert','Създадени: ':'Erstellt: ','Неразпознати домейни: ':'Domains ohne Regel: ','Невалидни: ':'Ungültig: ','Конфликти: ':'Konflikte: ','Приложено към контакти: ':'Auf Kontakte angewendet: ','Стойност':'Wert','Запази':'Speichern','Липсва правило за домейна':'Keine Regel für diese Domain','Тест':'Test'});

// Variables registry and contact directory.
const dirState={fields:[],variables:[],types:[]};
async function loadVariables(){
 const d=await api('/admin/api/variables');dirState.variables=d.variables;dirState.types=d.types;
 const sel=$('var-type');if(!sel.options.length)for(const ty of d.types){const o=document.createElement('option');o.value=ty;o.textContent=ty;sel.append(o)}
 const list=$('var-list');list.replaceChildren();
 for(const v of d.variables){
  const row=document.createElement('div');row.className='var-row';
  const input=document.createElement('input');input.value=v.value||'';input.placeholder=t('Стойност');input.setAttribute('aria-label',v.key);
  const save=node('button',t('Запази'));save.type='button';save.onclick=()=>action(async()=>{await api('/admin/api/variables/'+v.key,'PATCH',{value:input.value});await loadVariables();$('status').textContent=t('Запазено.')});
  row.append(node('code','{{'+v.key+'}}'),node('span',v.label+' · '+v.type+(v.field?' · '+t('Поле на контакт'):'')),input,save);
  if(!v.system){const del=node('button',t('Изтрий'));del.type='button';del.className='danger';del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на ')+v.key+'?'))return;await api('/admin/api/variables/'+v.key,'DELETE');await loadVariables();await loadDirectory()});row.append(del)}
  list.append(row);
 }
}
$('var-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{await api('/admin/api/variables','POST',{key:$('var-key').value,label:$('var-label').value,type:$('var-type').value,field:$('var-field').checked});$('var-key').value='';$('var-label').value='';await loadVariables();await loadDirectory()})});
async function loadDirectory(){
 const d=await api('/admin/api/directory');dirState.fields=d.fields;
 const badge=$('dir-badge');badge.hidden=!d.conflicts.length;badge.textContent=d.conflicts.length;
 $('dir-conflicts-card').hidden=!d.conflicts.length;const cbox=$('dir-conflicts');cbox.replaceChildren();
 const label=k=>(d.fields.find(f=>f.key===k)||{label:k}).label;
 for(const c of d.conflicts){
  const el=document.createElement('div');el.className='conf';el.append(node('strong',c.email+' · '+label(c.field)));
  const opts=document.createElement('div');opts.className='opts';
  const resolve=value=>action(async()=>{await api('/admin/api/directory/conflicts/'+c.id+'/resolve','POST',{value});await loadDirectory()});
  for(const o of c.candidates){const b=node('button',o.value+' ('+o.source+')');b.type='button';b.onclick=()=>resolve(o.value);opts.append(b)}
  const own=document.createElement('input');own.placeholder=t('Своя стойност');const ok=node('button',t('Реши'));ok.type='button';ok.className='btn-primary';ok.onclick=()=>own.value.trim()&&resolve(own.value);opts.append(own,ok);el.append(opts);cbox.append(el);
 }
 const rules=$('dir-rules');rules.replaceChildren();if(!d.rules.length)rules.append(node('p',t('Няма правила.')));
 for(const r of d.rules){const row=document.createElement('div');row.className='dir-row';row.append(node('strong',r.pattern),node('span',Object.entries(r.defaults).map(([k,v])=>label(k)+': '+v).join(' · ')));
  const del=node('button',t('Изтрий'));del.type='button';del.className='danger';del.onclick=()=>action(async()=>{await api('/admin/api/directory/rules/'+r.id,'DELETE');await loadDirectory()});row.append(del);rules.append(row)}
 const rf=$('dir-rule-fields');if(rf.dataset.n!==String(d.fields.length)){rf.replaceChildren();rf.dataset.n=d.fields.length;for(const f of d.fields){if(f.key==='name')continue;const i=document.createElement('input');i.dataset.key=f.key;i.placeholder=f.label;i.setAttribute('aria-label',f.label);rf.append(i)}}
 const box=$('dir-contacts');box.replaceChildren();if(!d.contacts.length)box.append(node('p',t('Няма контакти.')));
 for(const c of d.contacts){
  const row=document.createElement('div');row.className='dir-row';row.append(node('strong',(c.fields.name||'—')+' '),node('code',c.email));
  const info=Object.entries(c.fields).filter(([k])=>k!=='name').map(([k,v])=>label(k)+': '+v).join(' · ');row.append(node('span',info));
  const edit=node('button',t('Редактирай'));edit.type='button';edit.onclick=()=>{const body=document.createElement('div');const ins={};for(const f of d.fields){const l=document.createElement('label');l.style.cssText='display:block;margin:6px 0';l.append(node('span',f.label+' '));const i=document.createElement('input');i.value=c.fields[f.key]||'';ins[f.key]=i;l.append(i);body.append(l)}
   const sv=node('button',t('Запази'));sv.type='button';sv.className='btn-primary';const dlg=dialog(c.email,body,[sv]);sv.onclick=()=>action(async()=>{const fields={};for(const [k,i] of Object.entries(ins))if(i.value!==(c.fields[k]||''))fields[k]=i.value;if(Object.keys(fields).length)await api('/admin/api/directory/contacts/'+c.id,'PATCH',{fields});dlg.close();await loadDirectory()})};
  const del=node('button',t('Изтрий'));del.type='button';del.className='danger';del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на ')+c.email+'?'))return;await api('/admin/api/directory/contacts/'+c.id,'DELETE');await loadDirectory()});
  row.append(edit,del);box.append(row);
 }
}
$('dir-ingest').addEventListener('submit',e=>{e.preventDefault();action(async()=>{const r=await api('/admin/api/directory/ingest','POST',{emails:$('dir-emails').value});$('dir-emails').value='';
 $('dir-result').textContent=[t('Създадени: ')+r.created.length,r.conflicts?t('Конфликти: ')+r.conflicts:'',r.unmatched.length?t('Неразпознати домейни: ')+[...new Set(r.unmatched.map(x=>x.split('@')[1]))].join(', '):'',r.invalid.length?t('Невалидни: ')+r.invalid.join(', '):''].filter(Boolean).join(' · ');await loadDirectory()})});
$('dir-rule-form').addEventListener('submit',e=>{e.preventDefault();action(async()=>{const defaults={};for(const i of $('dir-rule-fields').querySelectorAll('input'))if(i.value.trim())defaults[i.dataset.key]=i.value.trim();
 const r=await api('/admin/api/directory/rules','POST',{pattern:$('dir-rule-pattern').value,defaults});$('dir-rule-pattern').value='';for(const i of $('dir-rule-fields').querySelectorAll('input'))i.value='';$('status').textContent=t('Приложено към контакти: ')+r.applied;await loadDirectory()})});
{const previous=load;load=async function(){await previous();await loadVariables();await loadDirectory()}}

// Language switcher + initial translation.
const _langSel=document.getElementById('admin-lang');
if(_langSel){_langSel.value=adminLang;_langSel.addEventListener('change',()=>setAdminLang(_langSel.value))}
applyAdminLang();

// Sidebar navigation (panel switching) for the redesigned layout.
const _navItems=[...document.querySelectorAll('.nav-item[data-panel]')];
let _currentPanel='overview';
const _topbarTitle=document.getElementById('topbar-title');
const _navLabelKey=item=>{const s=item.querySelector('[data-i18n]');return s?s.getAttribute('data-i18n'):item.textContent.trim()};
const _setPanel=name=>{
  _currentPanel=name;
  for(const item of _navItems){
    const active=item.getAttribute('data-panel')===name;
    item.classList.toggle('active',active);
    const panel=document.getElementById('panel-'+item.getAttribute('data-panel'));
    if(panel)panel.classList.toggle('active',active);
  }
  const activeItem=_navItems.find(i=>i.getAttribute('data-panel')===name);
  if(_topbarTitle&&activeItem)_topbarTitle.textContent=t(_navLabelKey(activeItem));
  document.body.classList.remove('sidebar-open');
};
for(const item of _navItems)item.addEventListener('click',()=>_setPanel(item.getAttribute('data-panel')));
const _navToggle=document.getElementById('nav-toggle');
if(_navToggle)_navToggle.addEventListener('click',()=>document.body.classList.toggle('sidebar-open'));
const _applyAdminLangOriginal=applyAdminLang;
applyAdminLang=function(){
  _applyAdminLangOriginal();
  const activeItem=_navItems.find(i=>i.getAttribute('data-panel')===_currentPanel);
  if(_topbarTitle&&activeItem)_topbarTitle.textContent=t(_navLabelKey(activeItem));
};
_setPanel(_currentPanel);

// Auto-login: the Home Assistant Ingress session (or loopback standalone) already authenticates the operator.
(async()=>{try{const r=await fetch(adminPath('/admin/api/ingress-login'),{cache:'no-store'});if(!r.ok)return;const d=await r.json();if(d&&d.token&&!$('token').value){$('token').value=d.token;$('token').type='password';await action(load);await action(loadOverview)}}catch{}})();

Object.assign(ADMIN_DIC.en,{'Лимити и достъп':'Limits and access','Празно поле = автоматична стойност по подразбиране (в полето е показана текущата).':'Empty field = automatic default (the current value is shown in the field).','Макс. размер на качване (MB)':'Max upload size (MB)','Едновременни изтегляния':'Concurrent downloads','Паралелни задачи':'Parallel jobs','Проверка на хранилищата (мин, 0 = изкл.)':'Storage check (min, 0 = off)','Публичен адрес':'Public address','CORS адрес':'CORS origin','Ключ за портал':'Portal key','Пълен IP в телеметрията':'Full IP in telemetry','Автоматично':'Automatic','Задължителен':'Required','Не е задължителен':'Not required','Не (препоръчително)':'No (recommended)','Да':'Yes','Запазено. Някои промени се прилагат след рестарт на add-on-а.':'Saved. Some changes apply after the add-on restarts.'});
Object.assign(ADMIN_DIC.de,{'Лимити и достъп':'Limits und Zugriff','Празно поле = автоматична стойност по подразбиране (в полето е показана текущата).':'Leeres Feld = automatischer Standard (aktueller Wert im Feld).','Макс. размер на качване (MB)':'Max. Upload-Größe (MB)','Едновременни изтегляния':'Gleichzeitige Downloads','Паралелни задачи':'Parallele Jobs','Проверка на хранилищата (мин, 0 = изкл.)':'Speicherprüfung (Min., 0 = aus)','Публичен адрес':'Öffentliche Adresse','CORS адрес':'CORS-Origin','Ключ за портал':'Portalschlüssel','Пълен IP в телеметрията':'Volle IP in Telemetrie','Автоматично':'Automatisch','Задължителен':'Erforderlich','Не е задължителен':'Nicht erforderlich','Не (препоръчително)':'Nein (empfohlen)','Да':'Ja','Запазено. Някои промени се прилагат след рестарт на add-on-а.':'Gespeichert. Einige Änderungen gelten nach Neustart des Add-ons.'});
applyAdminLang();

// ===== UX redesign: QR modal, dashboard, theme, i18n =====
function showQr(info,p){
 const body=document.createElement('div');
 const img=document.createElement('img');const url=URL.createObjectURL(new Blob([info.qr],{type:'image/svg+xml'}));img.src=url;img.alt='QR';img.style.cssText='width:220px;height:220px;background:#fff;padding:8px;border-radius:8px;display:block;margin:0 auto 12px';
 const code=node('code',info.apiUrl);code.style.wordBreak='break-all';
 const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;margin:8px 0;flex-wrap:wrap';
 const copy=node('button',t('Копирай'));copy.type='button';copy.onclick=()=>copyText(info.apiUrl);
 const dl=node('button',t('Изтегли QR'));dl.type='button';dl.onclick=()=>{const a=document.createElement('a');a.href=url;a.download=(p.slug||'portal')+'-qr.svg';a.click()};
 row.append(copy,dl);
 body.append(img,node('p',''),code,node('p',t('Директория')+': '+info.directory),row);
 const d=dialog('QR · '+(p.title||p.slug),body);d.addEventListener('close',()=>URL.revokeObjectURL(url));
}
const kpi=(label,value,sub)=>{const el=document.createElement('div');el.className='kpi';const l=document.createElement('div');l.className='kpi-label';l.textContent=label;const v=document.createElement('div');v.className='kpi-value';v.textContent=value;el.append(l,v);if(sub){const s=document.createElement('div');s.className='kpi-sub';s.textContent=sub;el.append(s)}return el};
const fmtUptime=s=>{s=Number(s)||0;const d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);return (d?d+'д ':'')+h+'ч '+m+'мин'};
const kvRows=rows=>{const wrap=document.createElement('div');wrap.className='data-table-wrap';const tbl=document.createElement('table');tbl.className='data-table';const tb=document.createElement('tbody');for(const r of rows){const tr=document.createElement('tr');const td1=document.createElement('td');td1.className='muted';td1.textContent=r[0];const td2=document.createElement('td');if(r[1] instanceof Node)td2.append(r[1]);else td2.textContent=String(r[1]);if(r[2])td2.className=r[2];tr.append(td1,td2);tb.append(tr)}tbl.append(tb);wrap.append(tbl);return wrap};
async function loadOverview(){
 const kpis=$('overview-kpis'),ports=$('overview-portals'),sys=$('overview-system');
 if(!kpis)return;
 let sensors=null,diag=null;
 try{sensors=await api('/admin/api/sensors')}catch{}
 try{diag=await api('/admin/api/diagnostics')}catch{}
 const pc=sensors&&Array.isArray(sensors.portals)?sensors.portals.length:(diag&&diag.catalog?diag.catalog.portals:0);
 const fc=sensors&&sensors.files!=null?sensors.files:(diag&&diag.catalog?diag.catalog.files:0);
 const fb=sensors&&sensors.fileBytes!=null?sensors.fileBytes:0;
 const visits=sensors&&sensors.visits!=null?sensors.visits:0;
 const downloads=sensors&&sensors.downloads!=null?sensors.downloads:0;
 const dbBytes=sensors&&sensors.databaseBytes!=null?sensors.databaseBytes:0;
 const teleBytes=sensors&&sensors.telemetryBytes!=null?sensors.telemetryBytes:0;
 kpis.replaceChildren();
 kpis.append(
  kpi(t('Портали'),String(pc)),
  kpi(t('Файлове'),String(fc),fmtBytes(fb)),
  kpi(t('Посещения'),String(visits)),
  kpi(t('Изтегляния'),String(downloads)),
  kpi(t('База данни'),fmtBytes(dbBytes)),
  kpi(t('Телеметрия'),fmtBytes(teleBytes))
 );
 ports.replaceChildren();
 const pwrap=document.createElement('div');pwrap.className='data-table-wrap';
 const pt=document.createElement('table');pt.className='data-table';
 const thead=document.createElement('thead');const htr=document.createElement('tr');
 for(const h of [t('Портал'),t('Файлове'),t('Посещения'),t('Изтегляния'),t('Данни')]){const th=document.createElement('th');th.textContent=h;htr.append(th)}
 thead.append(htr);pt.append(thead);
 const tbody=document.createElement('tbody');
 const sp=sensors&&Array.isArray(sensors.portals)?sensors.portals:[];
 if(!sp.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=5;td.className='empty';td.textContent=t('Няма данни');tr.append(td);tbody.append(tr)}
 for(const p of sp){const tr=document.createElement('tr');
  const t1=document.createElement('td');t1.append(node('strong',p.slug));
  const t2=document.createElement('td');t2.className='num';t2.textContent=String(p.files||0);
  const t3=document.createElement('td');t3.className='num';t3.textContent=String(p.visits||0);
  const t4=document.createElement('td');t4.className='num';t4.textContent=String(p.downloads||0);
  const t5=document.createElement('td');t5.className='num';t5.textContent=fmtBytes(p.bytes||0);
  tr.append(t1,t2,t3,t4,t5);tbody.append(tr)}
 pt.append(tbody);pwrap.append(pt);ports.append(pwrap);
 sys.replaceChildren();
 const rows=[];
 if(diag){
  rows.push([t('Node.js'),diag.runtime&&diag.runtime.node?diag.runtime.node:'—']);
  rows.push([t('Време на работа'),fmtUptime(diag.uptimeSeconds)]);
  rows.push([t('Памет (RSS)'),fmtBytes(diag.runtime&&diag.runtime.rssBytes)]);
  rows.push([t('Памет (Heap)'),(diag.runtime?fmtBytes(diag.runtime.heapUsedBytes)+' / '+fmtBytes(diag.runtime.heapTotalBytes):'—')]);
  const tr=diag.traffic||{};
  rows.push([t('Заявки'),String(tr.requests!=null?tr.requests:'—')]);
  rows.push([t('Изтегляния'),String(tr.downloads!=null?tr.downloads:'—')]);
  rows.push([t('Активни изтегляния'),String(tr.activeDownloadStreams!=null?tr.activeDownloadStreams:'—')]);
  if(diag.storage&&Array.isArray(diag.storage)){for(const st of diag.storage){const badge=document.createElement('span');badge.className='pill '+(st.available&&st.writable?'public':'private');badge.textContent=st.available?(st.writable?t('Достъпно'):t('Само за четене')):t('Недостъпно');rows.push([t('Хранилище')+' · '+st.name,badge])}}
 } else {
  rows.push([t('Състояние'),t('Няма данни')]);
 }
 if(sensors)rows.push([t('Режим на IP'),sensors.ipMode==='raw'?t('Пълен'):t('Хеширан')]);
 sys.append(kvRows(rows));
}
const _overviewItem=_navItems.find(i=>i.getAttribute('data-panel')==='overview');
if(_overviewItem)_overviewItem.addEventListener('click',()=>action(loadOverview));
const _overviewRefresh=$('overview-refresh');
if(_overviewRefresh)_overviewRefresh.onclick=()=>action(loadOverview);

const _themeToggle=$('theme-toggle');
const _applyTheme=()=>{let dark=false;try{dark=localStorage.getItem('portal-theme')==='dark'}catch{}document.documentElement.setAttribute('data-theme',dark?'dark':'light');if(_themeToggle)_themeToggle.setAttribute('aria-pressed',String(dark))};
try{if(localStorage.getItem('portal-theme')==null)localStorage.setItem('portal-theme',(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light')}catch{}
_applyTheme();
if(_themeToggle)_themeToggle.onclick=()=>{try{localStorage.setItem('portal-theme',localStorage.getItem('portal-theme')==='dark'?'light':'dark')}catch{}_applyTheme()};

Object.assign(ADMIN_DIC.en,{'Обзор':'Overview','Портали накратко':'Portals at a glance','Обнови':'Refresh','Състояние на системата':'System status','Публичен':'Public','Частен':'Private','Копирай линк':'Copy link','QR код':'QR code','Копирай':'Copy','Изтегли QR':'Download QR','Директория':'Directory','Линк':'Link','Изтрий':'Delete','скрит':'hidden','Няма файлове':'No files','Файл':'File','Размер':'Size','Качен':'Uploaded','Действия':'Actions','Файлове':'Files','Посещения':'Visits','Изтегляния':'Downloads','База данни':'Database','Телеметрия':'Telemetry','Време на работа':'Uptime','Памет (RSS)':'Memory (RSS)','Памет (Heap)':'Memory (Heap)','Заявки':'Requests','Активни изтегляния':'Active downloads','Хранилище':'Storage','Достъпно':'Available','Само за четене':'Read-only','Недостъпно':'Unavailable','Режим на IP':'IP mode','Пълен':'Full','Хеширан':'Hashed','Няма данни':'No data','Копирано в клипборда':'Copied to clipboard','Копирането не успя':'Copy failed','току-що':'just now','мин':'min','ч':'h','дни':'days','Създаден':'Created','файла':'files','Състояние':'Status','Портал':'Portal','Данни':'Data'});
Object.assign(ADMIN_DIC.de,{'Обзор':'Übersicht','Портали накратко':'Portale im Überblick','Обнови':'Aktualisieren','Състояние на системата':'Systemstatus','Публичен':'Öffentlich','Частен':'Privat','Копирай линк':'Link kopieren','QR код':'QR-Code','Копирай':'Kopieren','Изтегли QR':'QR herunterladen','Директория':'Verzeichnis','Линк':'Link','Изтрий':'Löschen','скрит':'versteckt','Няма файлове':'Keine Dateien','Файл':'Datei','Размер':'Größe','Качен':'Hochgeladen','Действия':'Aktionen','Файлове':'Dateien','Посещения':'Besuche','Изтегляния':'Downloads','База данни':'Datenbank','Телеметрия':'Telemetrie','Време на работа':'Laufzeit','Памет (RSS)':'Speicher (RSS)','Памет (Heap)':'Speicher (Heap)','Заявки':'Anfragen','Активни изтегляния':'Aktive Downloads','Хранилище':'Speicher','Достъпно':'Verfügbar','Само за четене':'Schreibgeschützt','Недостъпно':'Nicht verfügbar','Режим на IP':'IP-Modus','Пълен':'Voll','Хеширан':'Gehasht','Няма данни':'Keine Daten','Копирано в клипборда':'In die Zwischenablage kopiert','Копирането не успя':'Kopieren fehlgeschlagen','току-що':'gerade eben','мин':'Min','ч':'Std','дни':'Tage','Създаден':'Erstellt','файла':'Dateien','Състояние':'Status','Портал':'Portal','Данни':'Daten'});
/* ---------- DOCFLOW hierarchy panel ---------- */
let _hierProfiles=[];
let _hierGroupId=null;
const _hierPrefixLabel=prefix=>{const p=_hierProfiles.find(x=>x.prefix===prefix);return p?((p.label&&p.label[adminLang])||(p.label&&p.label.bg)||prefix):prefix};

async function _loadHierProfiles(){
  const d=await api('/admin/api/v2/profiles');
  _hierProfiles=Array.isArray(d.profiles)?d.profiles:[];
  const box=$('hier-profiles');box.replaceChildren();
  if(!_hierProfiles.length){box.append(node('p',t('Няма профили')));return}
  const wrap=document.createElement('div');wrap.className='data-table-wrap';
  const tbl=document.createElement('table');tbl.className='data-table';
  const thead=document.createElement('thead');const htr=document.createElement('tr');
  for(const h of [t('Префикс'),t('Профил'),t('Полета')]){const th=document.createElement('th');th.textContent=h;htr.append(th)}
  thead.append(htr);tbl.append(thead);
  const tbody=document.createElement('tbody');
  for(const p of _hierProfiles){
    const tr=document.createElement('tr');
    const t1=document.createElement('td');t1.append(node('code',p.prefix));
    const t2=document.createElement('td');t2.append(node('strong',_hierPrefixLabel(p.prefix)));
    const t3=document.createElement('td');t3.textContent=p.fields.map(f=>f.name+':'+f.type+(f.required?' *':'')).join(', ');
    tr.append(t1,t2,t3);tbody.append(tr);
  }
  tbl.append(tbody);wrap.append(tbl);box.append(wrap);
}

async function _loadHierGroups(){
  const d=await api('/admin/api/v2/groups');
  const groups=Array.isArray(d.groups)?d.groups:[];
  const box=$('hier-groups');box.replaceChildren();
  if(!groups.length){box.append(node('p',t('Няма групи')));return}
  const wrap=document.createElement('div');wrap.className='data-table-wrap';
  const tbl=document.createElement('table');tbl.className='data-table';
  const thead=document.createElement('thead');const htr=document.createElement('tr');
  for(const h of [t('Група'),t('Записи'),t('Описание'),t('Действия')]){const th=document.createElement('th');th.textContent=h;htr.append(th)}
  thead.append(htr);tbl.append(thead);
  const tbody=document.createElement('tbody');
  for(const g of groups){
    const tr=document.createElement('tr');
    const t1=document.createElement('td');t1.append(node('strong',g.name||'—'));
    const t2=document.createElement('td');t2.className='num';t2.textContent=String(g.recordCount||0);
    const t3=document.createElement('td');t3.textContent=g.description||'';
    const t4=document.createElement('td');
    const open=node('button',t('Записи'));open.type='button';open.onclick=()=>action(async()=>{_hierGroupId=g.id;$('hier-records-card').hidden=false;$('hier-records-title').textContent=t('Записи')+' · '+(g.name||g.id);await _loadHierRecords()});
    const ren=node('button',t('Преименувай'));ren.type='button';ren.onclick=()=>action(async()=>{const nm=prompt(t('Ново име'),g.name);if(nm==null)return;await api('/admin/api/v2/groups/'+g.id,'PATCH',{name:nm});await _loadHierGroups()});
    const del=node('button',t('Изтрий'));del.type='button';del.className='danger';del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на ')+(g.name||g.id)+'?'))return;await api('/admin/api/v2/groups/'+g.id,'DELETE');if(_hierGroupId===g.id){_hierGroupId=null;$('hier-records-card').hidden=true}await _loadHierGroups()});
    t4.append(open,ren,del);tr.append(t1,t2,t3,t4);tbody.append(tr);
  }
  tbl.append(tbody);wrap.append(tbl);box.append(wrap);
}

async function _loadHierRecords(){
  if(!_hierGroupId)return;
  const d=await api('/admin/api/v2/records?group_id='+encodeURIComponent(_hierGroupId));
  const recs=Array.isArray(d.records)?d.records:[];
  const box=$('hier-records');const tools=$('hier-records-tools');
  box.replaceChildren();tools.replaceChildren();
  const add=node('button',t('Нов запис'));add.type='button';add.className='btn-primary';add.onclick=()=>_openHierRecordEditor(null);tools.append(add);
  if(!recs.length){box.append(node('p',t('Няма записи')));return}
  const wrap=document.createElement('div');wrap.className='data-table-wrap';
  const tbl=document.createElement('table');tbl.className='data-table';
  const thead=document.createElement('thead');const htr=document.createElement('tr');
  for(const h of [t('Профил'),t('ID'),t('Полета'),t('Действия')]){const th=document.createElement('th');th.textContent=h;htr.append(th)}
  thead.append(htr);tbl.append(thead);
  const tbody=document.createElement('tbody');
  for(const r of recs){
    const tr=document.createElement('tr');
    const t1=document.createElement('td');t1.append(node('strong',_hierPrefixLabel(r.prefix)));
    const t2=document.createElement('td');t2.append(node('code',String(r.id).slice(0,8)));
    const t3=document.createElement('td');t3.textContent=Object.entries(r.fields||{}).map(([k,v])=>k+': '+String(v)).join(' · ')||'—';
    const t4=document.createElement('td');
    const ed=node('button',t('Редактирай'));ed.type='button';ed.onclick=()=>_openHierRecordEditor(r);
    const del=node('button',t('Изтрий'));del.type='button';del.className='danger';del.onclick=()=>action(async()=>{if(!confirm(t('Изтриване на запис ')+r.id+'?'))return;await api('/admin/api/v2/records/'+r.id,'DELETE');await _loadHierRecords()});
    t4.append(ed,del);tr.append(t1,t2,t3,t4);tbody.append(tr);
  }
  tbl.append(tbody);wrap.append(tbl);box.append(wrap);
}

function _openHierRecordEditor(rec){
  if(!_hierProfiles.length){toast(t('Няма профили'),'error');return}
  const isNew=!rec;
  let prefix=rec?rec.prefix:_hierProfiles[0].prefix;
  const body=document.createElement('div');body.style.cssText='display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto';
  const profSel=document.createElement('select');
  for(const p of _hierProfiles){const o=document.createElement('option');o.value=p.prefix;o.textContent=_hierPrefixLabel(p.prefix)+' ('+p.prefix+')';if(p.prefix===prefix)o.selected=true;profSel.append(o)}
  body.append(profSel);
  const ins={};
  const renderFields=()=>{
    for(const el of [...body.children]){if(el.dataset&&el.dataset.field)el.remove()}
    for(const k of Object.keys(ins))delete ins[k];
    const p=_hierProfiles.find(x=>x.prefix===prefix);
    for(const f of (p&&p.fields)||[]){
      const val=rec&&rec.fields?rec.fields[f.name]:'';
      if(f.type==='bool'){
        const lab=document.createElement('label');lab.className='field-check';lab.dataset.field='1';
        const cb=document.createElement('input');cb.type='checkbox';cb.checked=!!val;ins[f.name]=cb;
        lab.append(cb,node('span',' '+f.name));body.append(lab);continue;
      }
      const lab=document.createElement('label');lab.dataset.field='1';lab.style.cssText='display:flex;flex-direction:column;gap:4px';
      lab.append(node('span',f.name+(f.required?' *':'')));
      if(f.type==='text'){const ta=document.createElement('textarea');ta.rows=3;ta.value=val==null?'':String(val);ins[f.name]=ta;lab.append(ta)}
      else{const i=document.createElement('input');i.value=(f.type==='list'&&Array.isArray(val))?val.join(', '):(val==null?'':String(val));if(f.type==='number')i.type='number';if(f.type==='date')i.type='date';if(f.type==='url')i.type='url';if(f.type==='email')i.type='email';ins[f.name]=i;lab.append(i)}
      body.append(lab);
    }
  };
  renderFields();
  profSel.onchange=()=>{prefix=profSel.value;renderFields()};
  const save=node('button',t('Запази'));save.type='button';save.className='btn-primary';
  const dlg=dialog(isNew?t('Нов запис'):t('Редактиране на запис'),body,[save]);
  save.onclick=()=>action(async()=>{
    const fields={};
    for(const [k,i] of Object.entries(ins))fields[k]=(i.type==='checkbox')?i.checked:i.value;
    if(isNew)await api('/admin/api/v2/records','POST',{prefix,group_id:_hierGroupId,fields});
    else await api('/admin/api/v2/records/'+rec.id,'PATCH',{fields});
    dlg.close();await _loadHierRecords();
  });
}

async function _loadHierSearch(q){
  const box=$('hier-search-results');
  if(!q){box.replaceChildren();return}
  const d=await api('/admin/api/v2/search?q='+encodeURIComponent(q));
  const res=Array.isArray(d.results)?d.results:[];
  box.replaceChildren();
  if(!res.length){box.append(node('p',t('Няма резултати')));return}
  const wrap=document.createElement('div');wrap.className='data-table-wrap';
  const tbl=document.createElement('table');tbl.className='data-table';
  const thead=document.createElement('thead');const htr=document.createElement('tr');
  for(const h of [t('Профил'),t('Съвпадение')]){const th=document.createElement('th');th.textContent=h;htr.append(th)}
  thead.append(htr);tbl.append(thead);
  const tbody=document.createElement('tbody');
  for(const r of res){
    const tr=document.createElement('tr');
    const t1=document.createElement('td');t1.append(node('strong',_hierPrefixLabel(r.prefix)));
    const t2=document.createElement('td');t2.textContent=Object.entries(r.fields||{}).map(([k,v])=>k+': '+String(v)).join(' · ')||String(r.id);
    tr.append(t1,t2);tbody.append(tr);
  }
  tbl.append(tbody);wrap.append(tbl);box.append(wrap);
}

async function loadHierarchy(){
  await _loadHierProfiles();
  await _loadHierGroups();
  if(_hierGroupId){$('hier-records-card').hidden=false;await _loadHierRecords()}
}

const _hierItem=_navItems.find(i=>i.getAttribute('data-panel')==='hierarchy');
if(_hierItem)_hierItem.addEventListener('click',()=>action(loadHierarchy));
const _hierGroupForm=$('hier-group-form');
if(_hierGroupForm)_hierGroupForm.onsubmit=e=>{e.preventDefault();action(async()=>{const name=$('hier-group-name').value.trim();if(!name)return;const description=$('hier-group-desc').value.trim();$('hier-group-name').value='';$('hier-group-desc').value='';await api('/admin/api/v2/groups','POST',{name,description});await _loadHierGroups()})};
const _hierSearch=$('hier-search');
if(_hierSearch){let tm;_hierSearch.oninput=()=>{clearTimeout(tm);tm=setTimeout(()=>action(()=>_loadHierSearch(_hierSearch.value.trim())),250)}}
_languageRefreshers.push(async()=>{if(_currentPanel==='hierarchy')await loadHierarchy()});

Object.assign(ADMIN_DIC.en,{'Йерархия':'Hierarchy','Търсене':'Search','Групи (йерархия)':'Groups (hierarchy)','Профили (схема)':'Profiles (schema)','Създай група':'Create group','Няма профили':'No profiles','Няма групи':'No groups','Няма записи':'No records','Няма резултати':'No results','Префикс':'Prefix','Профил':'Profile','Полета':'Fields','Група':'Group','Записи':'Records','Описание':'Description','Действия':'Actions','Преименувай':'Rename','Ново име':'New name','Изтриване на ':'Delete ','Нов запис':'New record','ID':'ID','Редактирай':'Edit','Изтриване на запис ':'Delete record ','Запази':'Save','Редактиране на запис':'Edit record','Съвпадение':'Match'});
Object.assign(ADMIN_DIC.de,{'Йерархия':'Hierarchie','Търсене':'Suche','Групи (йерархия)':'Gruppen (Hierarchie)','Профили (схема)':'Profile (Schema)','Създай група':'Gruppe erstellen','Няма профили':'Keine Profile','Няма групи':'Keine Gruppen','Няма записи':'Keine Einträge','Няма резултати':'Keine Ergebnisse','Префикс':'Präfix','Профил':'Profil','Полета':'Felder','Група':'Gruppe','Записи':'Einträge','Описание':'Beschreibung','Действия':'Aktionen','Преименувай':'Umbenennen','Ново име':'Neuer Name','Изтриване на ':'Löschen ','Нов запис':'Neuer Eintrag','ID':'ID','Редактирай':'Bearbeiten','Изтриване на запис ':'Eintrag löschen ','Запази':'Speichern','Редактиране на запис':'Eintrag bearbeiten','Съвпадение':'Treffer'});
applyAdminLang();
action(loadOverview);
