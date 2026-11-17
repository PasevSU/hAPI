# Състояние на изданието — hAPI Enterprise 0.69.238

Версия: **0.69.238** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **465/465** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.238 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **217** находки в 135 файла (най-много `no-empty` 93) |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 736 файла · 132886 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 729 файла · 130778 реда · critical: 0 · high: 0 · medium: 0 · low: 215 — чисто · изключения: 24/24 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 465 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.238.tar.gz` | add-on архив (237 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.238.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.238.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.238

- **Скенерът за лош код вече сочи ВЕРНИЯ ред (DEF-95).** `innerHtmlInterpolations` пазеше
  началото на шаблона (`startIdx`), затова всички находки от един `.innerHTML = \`…\`` излизаха на
  реда на присвояването — отчетът беше непроверим на ръка (една находка в `qr-studio.js` сочеше
  ред 458, а изразите са на 436, 471, 522). Сега позицията се вдига при всяко `${` (`at`), а
  находките на `html-sink` носят и поле `concat` — така се различава интерполация от конкатенация.
- **Гейтът блокира и средна тежест.** `bad-code-scan --gate` пада при `critical`, `high` и
  `medium`; днес дървото е 0 · 0 · 0. Дотогава medium минаваше, а единствената такава находка
  стоеше в отчета като „за сведение“.
- **Записът в allowlist-а е с обосновка, не с мълчание.** `${i}` в `ui/qr-studio.js` е числов
  индекс от `.map()`, отива само във `value=` и `data-` атрибут — затова получава обоснован запис
  (24 записа, 24/24 пазят находка, 0 мъртви), а не промяна в кода.
- **Тестът пази реда, не само броя.** `tests/bad-code.cjs` проверява, че всяка находка на
  `html-sink` без `concat` сочи ред със `${` (котва: „находката сочи реда с интерполацията“) и че
  `medium` е 0. [`AUDIT-PROTOCOL.md`](documentation/07_RELEASE/AUDIT-PROTOCOL.md) §4 описва това
  като част от договора на скенера.

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
