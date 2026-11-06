# Състояние на изданието — hAPI Enterprise 0.69.180

Версия: **0.69.180** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **367/367** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.180 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 592 файла · 105018 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 587 файла · 104080 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 367 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.180.tar.gz` | add-on архив (200 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.180.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.180.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.180

- **Подписът за портал се издава ВЕДНЪЖ.** `adminPortal` в `server.js` викаше
  `portalAccess.issue()` два пъти в един и същ обектен литерал — веднъж за `accessQuery`
  и веднъж за `accessExpires`. Двете извиквания четат часовника поотделно, тоест при
  смяна на секундата адресът, който панелът показва, изтичаше в един момент, а обявеният
  час сочеше друг. Сега подписът се смята веднъж и двете полета идват от един резултат.
- **По-малко работа по списъка.** `GET /admin/api/portals` връща всички портали през
  `adminPortal`; дотук всеки частен портал плащаше двойно HMAC при всяко зареждане на
  панела, а сега — едно.
- Тестове: `portal-page.cjs` сверява `expires` от адреса с `accessExpires` — и за
  `api-info`, и за списъка на порталите; `files-manager.cjs` пази, че
  `portalAccess.issue(` се среща точно веднъж в `adminPortal`.
- Дефектът е записан като **DEF-32** в `documentation/01_AS_IS_ARCHITECTURE/KNOWN_DEFECTS.md`;
  там е поправена и таблицата — редът DEF-31 беше отделен с празен ред и излизаше извън нея.

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
