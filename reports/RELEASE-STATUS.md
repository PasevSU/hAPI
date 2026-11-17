# Състояние на изданието — hAPI Enterprise 0.69.239

Версия: **0.69.239** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **466/466** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.239 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **216** находки в 135 файла (най-много `no-empty` 93) |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 737 файла · 133105 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 730 файла · 130997 реда · critical: 0 · high: 0 · medium: 0 · low: 215 — чисто · изключения: 24/24 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 466 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.239.tar.gz` | add-on архив (237 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.239.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.239.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.239

- **Адресите на портала идват от ДОГОВОРА, не се строят в панела (DEF-69).** Досега
  `generateApi` сглобяваше адресите сам през `window.HapiApiSpec.buildReferences()`, а сървърът
  издаваше същите в `contract` — две истини, които никой не сравняваше. Сега `api-spec.js` има
  `withContract(contract, built)`: когато договорът е `ready === true`, неговите `page`, `api`,
  `manifest`, `openapi` и `qr` ЗАМЕНЯТ построените, а `buildReferences` остава само за низовете,
  които договорът не дава (`filesUrl`, `storageUrl`, `qrJsonUrl`, `pingUrl`). Ключовете на
  `state.api[id]` не се променят, тоест консуматорите (`.at`, `ctx.api`, `.qrUrl`) не се пипат.
- **Подписът се слага на ЕДНО място.** `withAccessQuery(url, query)` в `ui/files-manager.js` е
  единствената функция, която добавя `?expires=…&sig=…` (преди това изразът се повтаряше в
  `qrStudioLevels` и в `generateApi`). `file.page` вече идва от шаблона на договора
  (`/file.html:{slug}/{path}`), не от твърд низ в панела.
- **Създаването на портал не строи формата наново.** `createPortal` презаписваше `state.portals`
  с ръчно копие на 13 полета, което НЕ носеше `accessQuery` — тоест точно след създаване
  адресите губеха подписа, а QR студиото показваше адрес без достъп. Сега минава през
  `portalFromApi`, единственото място за формата на портала от сървъра.
- **Мъртвият товар е махнат.** `generateApi` вече не пази `refs`, `refsQ`, `landing`, `folderUrl`
  в `state.api[id]` — никой не ги четеше, а те носеха втори език на истината.
- **Тестът пази правилото, не низовете.** `tests/gui-contract-single-source.cjs` създава частен
  портал и иска подписът да е **веднъж** в адреса на страницата и на API-то, след което подменя
  договора със sentinel и иска екранът да покаже адреса на ДОГОВОРА (котва: „адресът от
  договора печели“). Затваря и капана, че скритото QR студио остава в документа — тестът чете
  само отвореното.

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
