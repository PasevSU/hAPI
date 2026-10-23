# Състояние на изданието — hAPI Enterprise 0.69.42

Версия: **0.69.42** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **212/212** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.42 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 347 файла · 58285 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 343 файла · 57921 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 212 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.42.tar.gz` | add-on архив (141 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.42.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.42

Тестовете за панела вече проверяват РЕШЕНИЕТО на браузъра, а не само отговора на сървъра.

- **Защо:** дефектът от 0.69.40 (`frame-ancestors 'none'` върху UI-я) мина през цялата
  серия — документът беше 200, 23/23 ресурса се зареждаха, CSP имаше. Никой тест не
  проверяваше дали браузърът има право да покаже документа в рамка, а панелът на add-on-а
  в Home Assistant е точно рамка.
- **Нов тест `tests/panel-framing.cjs`:**
  - `tests/lib/csp-frame.cjs` — истински оценител на `frame-ancestors` по CSP3
    (`'none'`, `'self'`, `*`, схема, host, порт по подразбиране, шаблон `*.host`,
    няколко политики се налагат заедно); 15 случая.
  - статичен скенер: ВСЯКО `res.writeHead` с `text/html` в `server.js` и `routes/*.js`
    трябва да носи изрична политика с `frame-ancestors` — нова HTML повърхност без
    решение чупи теста.
  - жив сървър в ingress режим: панелът се вгражда от Home Assistant през
    `/api/hassio_ingress/<token>` И през `/app/<slug>`, не се вгражда от чужд origin;
    генераторът — същото; публичният портал — никъде.
- **Поправени пропуски, които тестът намери веднага:** три HTML отговора нямаха решение
  за вграждане — публичната начална страница (`/`) и QR-страницата вече са с
  `frame-ancestors 'none'`, прегледът на файл — с `'self'`.
- Доказано и в реален браузър: при същия origin панелът се рисува (Dashboard, 0.69.41),
  при чужд origin Chrome отказва с „violates … frame-ancestors 'self'“ и рамката остава
  празна — точно иконата, която потребителят виждаше.

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
