# Състояние на изданието — hAPI Enterprise 0.69.228

Версия: **0.69.228** · клон `main`

Този файл се **генерира**; не се редактира на ръка. Всяко число идва от отчет на инструмент,
а не от памет. Проверка: `node scripts/release-status.cjs --check`.

В отчета влиза само това, което се извежда от дървото на хранилището. Отпечатъците, обемът
и датата на архивите **не** са тук: те се сменят при всяко сглобяване и на друга платформа,
а документ, който се разминава сам със себе си, не е доказателство. Те живеят в
`dist/RELEASE.json` и в `SHA256SUMS.txt` на изданието, а `verify-release.cjs` ги сверява.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs` | **441/441** — всички тестове от `tests/` минават |
| Издание | `node scripts/build-release.cjs` + `verify-release.cjs` | `dist/RELEASE.json` за 0.69.228 — отпечатъците се сверяват от `verify-release.cjs` |
| Линт | `npx eslint . --max-warnings=0` | `npx eslint . --max-warnings=0` → 0 · потиснати **217** находки в 135 файла (най-много `no-empty` 93) |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 701 файла · 125505 реда · **0** отворени · 1 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 695 файла · 123543 реда · critical: 0 · high: 0 · medium: 0 · low: 210 — чисто · изключения: 23/23 (0 мъртви) |
| Документация | `node tests/docs-consistency.cjs` | ✔ версията е еднаква в документите, няма счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| Настройки по подразбиране | `node scripts/settings-defaults.cjs --check` | ✔ публикувани в README-тата |
| Сценарии | `node tests/scenario-matrix.cjs` | ✔ 62 курирани области, 441 правила (= тестови файлове), 45 маршрута, 27 RBAC способности, 44 опции |

## 2. Артефакти (`dist/`)

| Артефакт | Какво съдържа | Къде е отпечатъкът |
| --- | --- | --- |
| `hapi_enterprise-0.69.228.tar.gz` | add-on архив (226 файла) | `dist/RELEASE.json` |
| `hapi_enterprise-integration-0.69.228.zip` | интеграция за HACS (27 файла) | `dist/RELEASE.json` |
| `hapi-enterprise-gui-0.69.228.zip` | GUI без сървър (START_HAPI_GUI.pyw, START_HAPI_GUI.bat) | `dist/RELEASE.json` |
| `repository.yaml` + `RELEASE.json` + `SHA256SUMS.txt` | 5 артефакта | `SHA256SUMS.txt` |

## 3. Какво влезе във 0.69.228

- **`options:` и `schema:` в `config.yaml` вече се ГЕНЕРИРАТ от един дескриптор (O2).**
  `hapi_enterprise/option-spec.js` описва 44 опции на едно място (ключ · име на променлива ·
  тип · подразбиране · тайна · кой файл я чете), а `scripts/option-schema.cjs` строи двете
  секции от него и **пази коментарите** — те са единственото обяснение за човека, който отваря
  картата в Home Assistant. `--check` пада при разминаване, затова разлика между картата и кода
  вече е невъзможна; генераторът влиза в `safe-release` преди справочника на опциите.
- **Четири нови гейта за опциите.** `option-schema` пази генератора (коментари, четливо писане
  на низ/число/булево, негативна проба), `option-coverage` иска всяка опция да се чете в
  изпълнявания код (без дескриптора — име в самия дескриптор не е четене), `option-secrets`
  проверява поведенчески редакцията на тайните в двете посоки, а `option-effects` сверява
  обявения читател с файла и показва ефекта на живо за `min_free_mb`, `storage_mode` +
  `storage_mount_name` и `portal_skin`.
- **Тайните опции вече не излизат в лога (DEF-89).** Правилото за редакция матеше ТОЧНИ имена,
  тоест `pgp_key_pass`, `pgp_path_pass`, `pgp_path_secret`, `s3_secret_key`, `s3_access_key`,
  `signing_key` и `tls_key` се записваха в чист вид. Сега правилото хваща и наставки
  (`_pass`, `_secret`, `_token`, `_key`, `_signature`), а дескрипторът обявява `secret: true` за
  деветте стойности, които не бива да се логват.
- **Преводите спряха да твърдят, че `username`/`password`/`db_name` не се четат (DEF-90).**
  `firstRunSeed()` ги чете при първи старт от `/data/options.json`: първият потребител на
  конзолата, неговата парола (или генерирана в `/data/api-credentials.txt`) и адресът на първия
  портал. Трите езика го казват, а дескрипторът носи `firstRunOnly: true`; `option-effects`
  пада, ако текстът отново твърди „никой код не го чете“.
- **Живият регистър на дефектите е свит (D4).** Затворените преди последните 10 са в
  `KNOWN_DEFECTS_ARCHIVE.md`; `known-defects`, `regression-guards` и `unfinished-register` четат
  ДВАТА файла, тоест архивът остава проверен — затваряне без доказателство и без тест не минава.
- **Регистърът:** 90 реда, **83 затворени**, **6 отворени** (DEF-01 приет; DEF-06, DEF-49,
  DEF-66, DEF-67, DEF-69) — всеки с причина.

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
