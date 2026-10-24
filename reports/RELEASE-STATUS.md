# Състояние на изданието — hAPI Enterprise 0.69.70

Версия: **0.69.70** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **239/239** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.70 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 396 файла · 67265 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 392 файла · 66901 реда · critical: 0 · high: 0 · medium: 3 · low: 170 — **има необяснени** |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 49 маршрута, 24 RBAC способности, 40 опции, 239 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.70.tar.gz` | add-on архив (159 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.70.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.70

Издание с една поправка в адресите на публичната страница: вече и тя не строи адреси на ръка,
а получава базовия адрес и пътя на API-то от сървъра.

- **Проблемът:** `portal.js` сглобяваше адресите сам —
  `location.origin + "/p/" + key` за показвания/копирания адрес и
  `location.origin + "/files/<id>/download"` за изписания адрес на файл. `location.origin` не
  носи префикса на прокси (`https://host/hapi/p/<id>`), затова копиран линк можеше да сочи към
  грешно място. Освен това това беше единственият файл, който строи адреси извън
  `links.js` и не се проверяваше от статичния гейт.
- **Решението:** сървърът записва в `#hapi-boot` (`data-base`, `data-api`) базовия адрес от
  `baseFromRequest`/`public_base_url` и пътя на API-то от `portalApiPath`; страницата само ги
  ползва. Изписаният адрес на портала идва от `urls.landing` (по id), а адресът на файл — от
  `apiBase`; и двата са абсолютни, защото посетителят ги копира и споделя.
- **Гейтът е разширен:** `tests/links-contract.cjs` вече сканира и `hapi_enterprise/portal/**`,
  така че `+ "/p/" +` или `+ "/api/v1/p/" +` в страницата пада на теста. Поведенчески го
  проверява `tests/portal-page-render.cjs` (изписаният и копираният адрес започват с базовия).
- **Документация:** правило 7 в `LINK_AND_STORAGE_CONTRACT.md` описва как страницата получава
  адресите.
- **Тестове:** 238 тестови файла в матрицата (239 с `release-status`), 100 % успех.

## 4. Как се проверява наново

```
node scripts/test-matrix.cjs          # пълният набор, от начало, до 5 опита
node scripts/build-release.cjs        # dist/
node scripts/verify-release.cjs       # S01–S21 върху готовия архив
npm run audit:gui                     # GUI + съвместимост + изданието
node scripts/release-status.cjs       # този отчет
```

## 5. Извън локалните гейтове

CI, CodeQL, Release workflow и HACS проверките се виждат с `gh run list` — те не се
записват тук, за да не се представя чужд резултат за свой.
