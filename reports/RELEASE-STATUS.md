# Състояние на изданието — hAPI Enterprise 0.69.4

Генериран: 2026-10-22 · Версия: **0.69.4** · Клон: `main` · HEAD: `6919402`

Този отчет събира на едно място доказателствата: какво е проверено, с какво и къде е доказано.
Подробният разказ е в `documentation/07_RELEASE/AUDIT-PROTOCOL.md`.

## 1. Проверки

| Проверка | Команда | Резултат |
| --- | --- | --- |
| Тестове | `node scripts/test-matrix.cjs --attempts=1` | **159/159** за ~114 s, три последователни пуска |
| Издание | `node scripts/verify-release.cjs --with-tests` | **21/21** сценария (S01–S21), вкл. S20 = 159/159 |
| Логически одит | `node scripts/logic-audit.cjs --gate` | 280 файла · 49 249 реда · **0** critical/high · 7 с обосновка |
| Скенер за лош код | `node scripts/bad-code-scan.cjs --gate` | 262 файла · 41 681 реда · **0** critical/high · 163 `low` (прегледани) |
| Таг = версия | `node scripts/check-tag-version.cjs v0.69.4` | ✔ `config.yaml` = `manifest.json` = таг |
| Документи | `node tests/docs-consistency.cjs` | ✔ 3 документа на версия 0.69.4, без счупени връзки |
| Changelog на add-on-а | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален |
| CI / CodeQL (`main`) | GitHub Actions | ✔ / ✔ |
| Release workflow (`v0.69.4`) | GitHub Actions | ✔ |
| HACS Validate + Release | GitHub Actions | ✔ / ✔ |

## 2. Артефакти (dist/)

| Файл | Размер | SHA-256 |
| --- | --- | --- |
| `hapi_enterprise-0.69.4.tar.gz` | 112 файла | `19ee6417882361da14ca1aa5ed8255b803c5bc7ff39acf3b5f314709b14062f5` |
| `hapi_enterprise-integration-0.69.4.zip` | 22 файла | `7120c7babe97056a42049a74a725562b527eab285f4b357917d476148b39fe66` |
| `repository.yaml` | — | `7ec5d2ec55d66695b7021ab4c5ae70c2440d578ab3c9155f48c65e506e3190af` |
| `RELEASE.json` | — | `5ccb23a35d8f3ed8954e511005688c6b6ac798de09d3ddb5ea7e9fe7240db6a8` |

**Проверка на публикуваното:** `hapi_enterprise-0.69.4.tar.gz`, свален от GitHub release, съдържа
**112/112 файла, съвпадащи побайтово** с кода в `main` (при нормализирани окончания на редовете:
работното копие е с CRLF, архивът — с LF). Локалният `dist/` е с ~2 KB разлика в размера само
заради gzip/tar метаданни (времена на файловете), не заради съдържание.

## 3. Публикация

| Къде | Какво | Състояние |
| --- | --- | --- |
| GitHub release `PasevSU/hAPI` `v0.69.4` | 5 актива: add-on tar.gz, integration zip, `RELEASE.json`, `repository.yaml`, `SHA256SUMS.txt` | **Latest** |
| HACS `PasevSU/hapi-enterprise-integration` | комит + таг `v0.69.4`, `manifest.json` = 0.69.4, `hacs.json` `content_in_root:false` | публично, Validate ✔ |
| Идентичност на HACS комитите | `PasevSU <PasevSU@users.noreply.github.com>` | без личен имейл |

## 4. Какво е поправено в този цикъл

| Версия | Поправки |
| --- | --- |
| 0.69.0 | сегментен одит: `document.write`, 2 × `Invoke-Expression`, fail-closed `safeEqual` (×3), TSA отпечатък в постоянно време; white-box и black-box тестове |
| 0.69.1 | гейт OpenAPI ↔ публични маршрути (намери липсващ `/tree`), гейт „таг = версия“, noreply идентичност при публикуване |
| 0.69.2 | PGP MPI: водещи нули не чупят ключ (≈1 от 256 нови ключа не можеше да се създаде) |
| 0.69.3 | логически одит: ролите в `merge` се секат, прозорец през полунощ се отказва изрично, манифестът ползва канонични пътища, лимитът на версиите брои и текущата |
| 0.69.4 | `freePort()` не дава един и същ порт два пъти (причината за редките падове), платформено независим тест за ключалката, синхрон на add-on changelog |

## 5. Известен дълг (съзнателно оставен)

- **163 находки `low`** в скенера за лош код: 117 в `tests/`, 41 в `hapi_enterprise/`, 5 в `scripts/`.
  В издавания код те са `empty-catch` (25) и `json-parse-untrusted` (16); прегледани са ръчно —
  всички са в `try`/`catch` или с изричен резервен вариант. Намаляването им е отделна задача.
- **Исторически тагове** `v0.63.0` (сочи комит с 0.62.1) и `v0.54.0` (стара подредба) остават
  каквито са — таг с публикувано издание не се мести. Гейтът не допуска повторение.
- **Личен имейл в стари публични HACS комити** (`e1c3cf8`, `638287a`) — решение на собственика:
  включване на *Keep my email addresses private* + пренаписване на историята, или оставяне както е.
- **Версии без GitHub издание:** `0.69.2` (не е тагван) и `0.69.3` (тагът падна CI и беше сложен
  наново като 0.69.4). Записите им в `CHANGELOG.md` остават.

## 6. Възпроизвеждане

```bash
node scripts/test-matrix.cjs --attempts=1        # 159/159
node scripts/logic-audit.cjs --save --gate       # 0 critical/high + отчети
node scripts/bad-code-scan.cjs --gate            # ГЕЙТ: чисто
node scripts/check-tag-version.cjs v0.69.4       # ✔
node scripts/sync-addon-changelog.cjs --check    # ✔
node scripts/build-release.cjs --version 0.69.4  # 4 артефакта
node scripts/build-haoss.cjs                     # release/haoss в синхрон
node scripts/verify-release.cjs --with-tests     # 21/21
```
