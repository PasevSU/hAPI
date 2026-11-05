# Състояние на изданието — hAPI Enterprise 0.69.154

Версия: **0.69.154** · клон `main`

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
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.154 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 568 файла · 97177 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 563 файла · 96239 реда · critical: 0 · high: 0 · medium: 0 · low: 200 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 27 RBAC способности, 43 опции, 356 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.154.tar.gz` | add-on архив (194 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.154.zip` | интеграция за HACS (25 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.154.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.154

- **Store-ът вече ТЕГЛИ образа, вместо да го строи на машината.** В `config.yaml` е добавен
  `image: "ghcr.io/pasevsu/{arch}-addon-hapi_enterprise"` — `{arch}` се замества от
  Supervisor, а тагът идва от `version:`. Дотук всяко обновяване на Raspberry Pi 4 минаваше
  през `docker buildx build` (измерено 129 s за 0.69.153) и падаше, ако мрежата или
  toolchain-ът не са налице. Сега обновяването е дръпване на готов образ.
- **Проверката на образа беше счупена по два начина — поправена.** `check-addon-image.ps1`
  питаше `https://ghcr.io/<owner>/<repo>/manifests/<tag>` без `/v2/` (това е адрес на сайта,
  не на registry API-то) и приемаше само multi-arch index, макар нашият workflow да строи
  по една архитектура на job. И двете даваха `404` върху СЪЩЕСТВУВАЩ образ — тоест скриптът
  щеше да блокира включването на `image:` завинаги. Сега приема и четирите вида манифест и
  минава за всички архитектури (`OK` за amd64, aarch64, armv7).
- **Първият пуск на новия workflow падна с `repository name must be lowercase`.** GHCR
  изисква малки букви в името на хранилището, а login-ът е `PasevSU`. Owner-ът се сваля с
  `tr '[:upper:]' '[:lower:]'`. Пази се от ново правило **HA-M14** в `ha-compatibility.cjs`:
  то проверява едновременно формата на `image:` (малки букви, `ghcr.io/<owner>/{arch}-addon-<slug>`)
  и че workflow-ът строи ВСЯКА архитектура, обявена в `arch:` — защото липсваща архитектура
  значи обновяване, което пада само на нея.

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
