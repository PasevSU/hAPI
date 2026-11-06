# Състояние на изданието — hAPI Enterprise 0.69.186

Версия: **0.69.186** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **368/368** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.186 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 593 файла · 105349 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 588 файла · 104425 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 368 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.186.tar.gz` | add-on архив (200 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.186.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.186.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.186

- **„Изтегли“ в заглавната лента на панел вече тегли файла.** Бутонът се виждаше във всеки
  панел („Преглед“ го ползва за прегледаното съдържание), но за панел като „Действия“,
  „Разписка“ или „Сподели“ няма `modalBlob` и обработчикът беше `null` — тоест видим и
  мъртъв: натискане не правеше нищо. Сега `openPanelModal` го показва и го връзва към
  `download(f)`, същия администраторски път, който ползва и „Изтегли файла“ в панела.
- **Атрибутът `hidden` вече наистина скрива.** `.btn { display: inline-flex }` надвишава
  браузърното правило за `[hidden]`, затова скрит бутон оставаше на екрана. Добавено е
  `[hidden] { display: none !important; }` в `components.css`.
- **Тестовият DOM вика и `on<type>` свойствата** (`el.onclick = …`), както прави браузърът:
  дотук само `addEventListener` се задействаше, тоест тест можеше да „подмине“ мъртъв бутон,
  закачен чрез свойство.
- Проверява се от `gui-file-share.cjs` (стъпка 5: отваря се панелът „Достъп“ и се натиска
  „Изтегли“ в заглавната лента — пуска точно една заявка) и от `files-manager.cjs` (⑦).
  Дефектът е записан като **DEF-36**.

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
