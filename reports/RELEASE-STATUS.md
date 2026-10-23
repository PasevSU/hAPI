# Състояние на изданието — hAPI Enterprise 0.69.34

Версия: **0.69.34** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **210/210** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.34 — отпечатъците се сверяват от `verify-release.cjs` |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 341 файла · 57281 реда · **0** отворени · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 337 файла · 56917 реда · critical: 0 · high: 0 · medium: 0 · low: 151 — чисто |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 области, 48 маршрута, 24 RBAC способности, 33 опции, 210 тестови файла |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.34.tar.gz` | add-on архив (138 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.34.zip` | интеграция за HACS (22 файла) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 4 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.34

Поправка на счупеното в 0.69.33: панелът се зареждаше, но **нищо в него не работеше** под
Home Assistant Ingress, а генераторът се отваряше празен.

- **Адресът на API-то идва от документа.** Всички панели строяха адреса като
  `location.origin`. Под Ingress документът живее на `/api/hassio_ingress/<token>/ui/`, а
  add-on-ът е под същия префикс — значи `https://<ha>/admin/api/…` отива в Home Assistant и
  връща 404. Сега един помощник (`ui/api-base.js`) разпознава префикса, а панелите,
  Report Studio и генераторът минават през него. Старите форми (`/app/<token>`,
  `/hapi/<token>`, `/hassio/ingress/<token>`) остават валидни, ръчно зададеният
  `hapi.apiBase` запазва предимство, а при `file://` адресът остава празен (демо режим).
- **Report Studio не беше изключение:** трите директни заявки (пакет, рендер, RFC 3161)
  ползваха абсолютни пътища и затова новият бутон „Пакет с доказателства“ не можеше да
  стигне до сървъра точно там, където се ползва.
- **Генераторът вече не е празен.** Изданието носи начални шаблони
  (`generator/templates/{blank,protocol,report}.html`) и ги копира в работната папка само
  при липсваща или празна папка; съществуващ шаблон никога не се презаписва
  (`GENERATOR_SEED=off` изключва копирането). Интерфейсът показва реалния път на папката
  (`folderPath`), за да не се гадае къде е в add-on-а.
- **Нов `tests/ingress-api-base.cjs`:** единични случаи за всички форми на префикса,
  standalone и `file://`, жива проверка, че API-то на генератора и панела отговаря под
  префикса, и правило, че в клиентския код няма абсолютни `/admin/…` заявки.
- `tests/generator-app.cjs` пази новия договор: начални шаблони, `folderPath`, без презапис,
  изключване чрез среда.
- Договори: INV-C1 в `INTEGRATION_CONTRACTS.md`, INV-G5/G6 в `DOCUMENT_GENERATOR.md`.

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
