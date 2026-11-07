# Състояние на изданието — hAPI Enterprise 0.69.189

Версия: **0.69.189** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **369/369** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.189 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 594 файла · 105490 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 589 файла · 104566 реда · critical: 0 · high: 0 · medium: 0 · low: 201 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 369 правила (= тестови файлове), 48 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.189.tar.gz` | add-on архив (200 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.189.zip` | интеграция за HACS (26 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.189.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.189

- **Отстоянията вече са централизирана скала, не локално задание.** `components.css` имаше
  300 декларации за `padding`/`margin`/`gap` с 97 различни стойности и само 23 от променлива —
  докато шрифтовете отдавна минават през `--fs-*`. Затова главите на блоковете имаха три
  различни отстъпа (`12px 14px` · `8px 12px` · `6px`), а стойности извън 2px решетката
  (`1/3/5/7/9px`) разминаваха блокове, които изглеждат еднакви.
- В `tokens.css` има скала с име = стойност: `--sp-1` … `--sp-10` (`2px` … `20px`, стъпка 2px)
  и три нива закръгляне — `--radius-sm` `6px`, `--radius-md` `8px`, `--radius` `10px`.
- Прехвърлени на скалата: „главите“ на блоковете (`.panel-head`, `.fm-modal-head`,
  `.pf-block-head`), `.panel-body`, `.page-title`, `.badge`, `.btn`, `.fm-detail`, `.fm-bulk`
  и цялата карта на файл (`.fm-file`, `.fm-file-head`, `.fm-file-icons`, `.fm-publish`,
  `.fm-file-ico`). Литералите паднаха 277 → 257, уникалните стойности 97 → 83, а през
  променлива минават 23 → 43 отстояния.
- Договорът се пази от **`tests/ui-spacing.cjs`**: скалата с точни стойности; главите на
  блоковете без нито един `px` литерал; `mm` само в печатната част (хартията е милиметри,
  екранът — пиксели); таван на литералните стойности, който се намалява, но не се вдига.
- Измерването, таблицата „преди/след“ и какво остава са в
  `documentation/01_AS_IS_ARCHITECTURE/GUI_LAYOUT_AUDIT.md`. Дефектът е записан като **DEF-37**.

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
