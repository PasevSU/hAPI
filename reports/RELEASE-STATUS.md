# Състояние на изданието — hAPI Enterprise 0.69.234

Версия: **0.69.234** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **456/456** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.234 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **217** находки в 135 файла (най-много `no-empty` 93) |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 723 файла · 130255 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 716 файла · 128153 реда · critical: 0 · high: 0 · medium: 1 · low: 217 — **има необяснени** · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 456 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.234.tar.gz` | add-on архив (233 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.234.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.234.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.234

- **Нищо не се пише направо в `/share`.** Add-on-ът има СВОЯ домашна папка — `<корен>/hAPI` —
  а вътре в нея двете неща, които не бива да се смесват: `hAPI/data` (база, настройки, маркер)
  и `hAPI/portals/<slug>` (документите на всеки портал, всеки със своята папка). Подразбирането
  за вътрешните данни става `hAPI/data` — същото име, което `config.yaml` вече обявяваше, тоест
  кодът и опциите спряха да се разминават по главна буква.
- **Порталите имат фиксирана папка, независима от мястото на базата.** `paths.portalsRoot()`
  дава `/share/hAPI/portals`, а `paths.portalRootFor(slug)` — `/share/hAPI/portals/<slug>`.
  Дотук коренът на порталите следваше `storage_subdirectory`; сега преместването на базата
  (`hAPI/data` → където и да е) НЕ мести потребителските документи. Правилото живее на едно
  място и се проверява от `storage-roots` §5д.
- **Стара инсталация не се обявява за празна.** `storage-preflight.js` помни ДВЕ стари места —
  `/share/hapi/data` (0.69.87 – 0.69.233) и `<add-on config>/hapi_enterprise` (по-рано) — и ако
  там има реални данни, а новото място е празно, ползва старото и пише `STORAGE_LEGACY_LOCATION`.
  Порталите, създадени преди това, пазят своя `storage_root` в базата и продължават да работят
  на старото място; файловете им не се местят.
- Документите (`STORAGE_LAYOUT`, `SYSTEM_STATE`, `installation-layout`, README-тата на трите
  езика, преводите на add-on-а) казват новото място; `installation-layout` остава под тавана на
  `docs-size` (236 реда), защото нормата не се вдига, за да побере разказа.
- Тестове: `storage-roots` §5д (домашна папка, портали, монтаж, непознат корен, „не е общ
  корен“), `storage-default-location` §1б/1в (старото място с малка буква се спасява; при две
  стари места печели по-новото), `portal-storage-fixed`, `oracle-lifecycle` и `layout` сверяват
  новия път; `layout` чисти тестовата папка по `storage_root`, а не по твърд низ.

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S23 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
