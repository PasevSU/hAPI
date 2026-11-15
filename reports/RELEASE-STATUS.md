# Състояние на изданието — hAPI Enterprise 0.69.216

Версия: **0.69.216** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **421/421** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.216 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 663 файла · 121551 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 657 файла · 119580 реда · critical: 0 · high: 0 · medium: 0 · low: 210 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 421 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.216.tar.gz` | add-on архив (213 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.216.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.216.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.216

- **Прегледът вече не рисува документи, които изпълняват скрипт (DEF-60).** Намерено при
  сегментирания анализ на кода: `preview()` слагаше blob адрес в `<iframe>` за всеки тип,
  различен от текст. Blob адресът наследява произхода на панела — качен **SVG** (или HTML)
  със `<script>` вътре се изпълнява в същия произход и стига до `sessionStorage` с
  администраторския токен. Сървърът също сервираше `image/svg+xml` **inline без политика**.
  Сега: панелът рисува в iframe само `application/pdf` и `image/(png|jpeg|gif|webp)`
  (`SAFE_FRAME`), за останалите показва причина и предлага изтегляне; inline SVG носи
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:;
  frame-ancestors 'self'`; името в `Content-Disposition` на пакета с отчет мина на RFC 5987
  (`filename*=UTF-8''…`), защото сурово име в заглавка е Latin-1 и чупи връзката при кирилица.
- **Глобални тестери за класа, а не за случая.** `tests/render-sinks-global.cjs` минава през
  целия интерфейс и публичните страници и отказва: blob→iframe без бял списък, поле от данни
  в `innerHTML` без `esc(`, име на файл в `Content-Disposition` без процентно кодиране,
  `<script` през `innerHTML`, inline SVG без CSP. `tests/preview-unsafe-types.cjs` доказва
  поправката на живо: SVG със `<script>` → CSP без `script-src`, PNG → inline както преди,
  панелът → без iframe, със съобщение и изтегляне.

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
