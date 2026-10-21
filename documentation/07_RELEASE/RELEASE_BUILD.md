# Изграждане и проверка на издание (Home Assistant)

Изданието се строи и проверява с два скрипта без външни зависимости — работят еднакво
на Windows, Linux и в GitHub Actions.

```bash
node scripts/build-release.cjs            # строи dist/
node scripts/verify-release.cjs           # проверява всички сценарии
node scripts/build-release.cjs --version 0.53.0   # сменя версията и строи
node scripts/verify-release.cjs --with-tests      # + целия тестов набор
npm run release                           # двете последователно (с тестовете)
```

## Артефакти в `dist/`

| Файл                                       | Съдържание                                                  | Употреба                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `hapi_enterprise-<версия>.tar.gz`          | целият add-on (`hapi_enterprise/…`)                         | добавя се като локален add-on repository или се разархивира в `/addons`                  |
| `hapi_enterprise-integration-<версия>.zip` | `custom_components/hapi_enterprise/…` (вкл. `brand/`)       | разархивира се в `/config` и Home Assistant се рестартира; за HACS се ползва `hacs.json` |
| `repository.yaml`                          | описание на add-on repository                               | публикува се в корена на хранилището                                                     |
| `RELEASE.json`                             | версия, хеш на всеки файл, отпечатък на дървото, инструкции | машинно четимо описание на изданието                                                     |
| `SHA256SUMS.txt`                           | контролни суми на артефактите                               | проверка след трансфер                                                                   |

Версията има **един източник на истина**: `hapi_enterprise/config.yaml`. Скриптът строи
само ако `custom_components/hapi_enterprise/manifest.json` носи същата стойност.

## Сценарии на `verify-release.cjs`

| №   | Сценарий              | Какво доказва                                                                                                                      |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Версия                | config.yaml = manifest.json, SemVer (по избор `--expect-version`)                                                                  |
| S02 | Add-on схема          | задължителните полета на Supervisor, ingress, портове, `map`                                                                       |
| S03 | Файлове               | стартовите файлове, порталните активи и иконите са налице                                                                          |
| S04 | Dockerfile            | `COPY` покрива всички локални модули (транзитивно от `server.js`)                                                                  |
| S05 | JS синтаксис          | всеки `.js`/`.cjs` в add-on-а и интеграцията се компилира                                                                          |
| S06 | Python синтаксис      | `ast.parse` на `__init__.py` (или структурна проверка)                                                                             |
| S07 | Интеграция            | `manifest.json` по правилата на HA, domain = папка, `http` зависимост                                                              |
| S08 | Add-on архив          | tar.gz съдържа точно файловете от дървото, `start.js` е налице                                                                     |
| S09 | Архив на интеграцията | zip съдържа точно файловете от дървото                                                                                             |
| S10 | Манифест и суми       | `RELEASE.json` и `SHA256SUMS.txt` съвпадат с файловете                                                                             |
| S11 | Тайни                 | без частни ключове, JWT, API ключове; празни `token`/`password` по подразбиране                                                    |
| S12 | Портал                | адаптивни текстове, `textContent`, CSP за QR, маршрути по id и slug                                                                |
| S13 | `start.js`            | JS entrypoint, LF, проверка за `node:sqlite`, SIGTERM, без печат на токена                                                         |
| S14 | Опции ↔ схема         | всяка опция има схема и обратно                                                                                                    |
| S15 | `repository.yaml`     | name/url/maintainer без placeholder                                                                                                |
| S16 | Документация          | README/BG/DE/SECURITY/CONTRIBUTING/CHANGELOG + записи за версията                                                                  |
| S17 | Хигиена               | без `__pycache__`, `node_modules`, `.git`, тестове и тайни в архивите                                                              |
| S18 | Системен `tar`        | архивът се чете от стандартен инструмент (когато е наличен)                                                                        |
| S19 | Стартиране от архива  | разархивираното издание стартира сървъра, `/health` отговаря, статичните активи се сервират (`--no-boot` го пропуска)              |
| S20 | Тестове               | целият набор (`tests/*.cjs`) минава — само с `--with-tests`                                                                        |
| S21 | HACS                  | `hacs.json`, `codeowners`, GitHub `issue_tracker` и `brand/` изображения и в архива — хранилището се добавя като custom repository |

## Публикуване

1. `node scripts/build-release.cjs --version <версия>` — сменя версията навсякъде и строи.
2. Добави запис за версията в `CHANGELOG.md` (S16 го изисква).
3. `node scripts/verify-release.cjs --with-tests` — 20 сценария трябва да са зелени.
4. Таг `v<версия>` → GitHub Actions `Release` строи, проверява и качва артефактите.

> Локално не се изпълнява реална сборка на образа от Home Assistant Supervisor — това
> остава външна проверка (виж `RELEASE_CRITERIA.md`). Скриптовете доказват, че изданието
> е пълно, съгласувано и безопасно за качване.
