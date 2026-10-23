# Състояние на изданието — hAPI Enterprise 0.69.40

Версия: **0.69.40** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **211/211** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.40 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 345 файла · 57873 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 341 файла · 57509 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 211 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.40.tar.gz` | add-on архив (141 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.40.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.40

Издание за обновяване: **няма промяна в поведението**. Вдигната е само версията, за да
предложи Home Assistant (Add-on Store) и HACS ъпдейт до нея.

- Причина: версията беше вдигната в работното копие, но не беше качена — `main` в GitHub
  още носеше 0.69.39, а Supervisor строи add-on-а точно от default клона. Тоест версията
  в `hapi_enterprise/config.yaml` на `main` е единственото, което Home Assistant вижда.
- Съдържание: същият код като 0.69.39 (компоненти в `routes/`), същите тестове — 211/211.

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
