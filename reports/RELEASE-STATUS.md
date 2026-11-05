# Състояние на изданието — hAPI Enterprise 0.69.156

Версия: **0.69.156** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **356/356** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.156 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 569 файла · 97303 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 564 файла · 96365 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 356 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.156.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.156.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.156.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.156

- **Нов одит на `secrets.yaml` — без да печата стойности.** `scripts/audit-ha-secrets.ps1`
  сваля `/config/secrets.yaml` от инсталацията, разпознава формата на всяка стойност (HA
  long-lived token, GitHub PAT / fine-grained, AWS ключ, частен ключ, обикновен низ) и показва
  кой `!secret <име>` се ползва ЖИВО в кой YAML файл. Отпечатват се само име, форма, дължина и
  файл — никога стойността, защото изходът отива в лог или чат (точно това издаде два живи
  ключа наведнъж, когато се четеше на ръка).
  Първият пуск срещу реалната инсталация намери: **63 ключа, 3 чувствителни, 62 непотребявани** —
  в това число **жив GitHub personal access token** и **HA long-lived token**, които никой YAML
  не ползва. Тези два се махат от файла и се ОТЗОВАТ при доставчика; скриптът ги изброява с
  връзка към https://github.com/settings/tokens.
- **Защо `--include` не работи на HA:** `grep` там е BusyBox и не познава `--include`, а
  `find … -exec … \;` се чупи през `ssh`. Скриптът минава с цикъл по файловете и подминава
  закоментираните редове — иначе десетки изключени `# !secret …` се броят за употреба и одитът
  лъже, че всичко се ползва.
- `scripts/check-ps-syntax.ps1` вече проверява и четирите PowerShell скрипта.

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
