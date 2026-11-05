# Състояние на изданието — hAPI Enterprise 0.69.163

Версия: **0.69.163** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **358/358** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.163 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 575 файла · 98439 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 570 файла · 97501 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 358 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 43 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.163.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.163.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.163.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.163

- **32-bit ARM отпада от `arch` — и warning-ът в лога на Supervisor изчезва.** При всяко
  зареждане на store-а Supervisor пишеше `App 'hAPI Enterprise' uses deprecated 'arch' values:
  ['armv7']`. Причината е в самия Supervisor: `ARCH_ALL = [aarch64, amd64]`, а `armv7`,
  `armhf` и `i386` са в `ARCH_DEPRECATED`; когато приложение има **само** такива, той вдига и
  repair „deprecated_arch_app“. Обещанието беше и празно — HAOS не се публикува за 32-bit
  машини, тоест никой не можеше да се възползва, а редът стигаше до всеки. Сега `arch` е
  `amd64` + `aarch64`; отпадна и job-ът `armv7` в билда на образа, и третата проверка в
  `check-addon-image.ps1`.
- **Договорът за хардуер се проверява, не се разказва.** `tests/raspberrypi-compat.cjs` вече
  изисква точно 64-битовите архитектури и **забранява** всяка deprecated стойност, а
  `HA-M04` в `tests/ha-compatibility.cjs` стана `blocker` (преди беше `info`, тоест
  забележката се виждаше, но не спираше издание). Ако някой върне `armv7`, матрицата пада.
- **Казано и в документацията:** глава 2 на ръководството обяснява защо 32-bit не се
  обещава, глава 6 добавя симптома „No update available for app hAPI Enterprise“ (остарял
  диалог след успешно обновяване — виж `version:` в Информация, не в диалога),
  `hapi_enterprise/README.md` вече не обещава 32-bit редове в таблицата с дъските, а
  `RELEASE_QUALIFICATION.md` отбелязва, че забележката е затворена.
- **Регистърът на дефектите:** нов ред `DEF-25` (Съвместимост) със затварянето и
  доказателството — за да не се върне същата стойност тихо.

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
