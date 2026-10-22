# Състояние на изданието — hAPI Enterprise 0.69.5

Генериран: 2026-10-22 · Версия: **0.69.5** · Клон: `main`

Този отчет събира на едно място доказателствата: какво е проверено, с какво и къде е доказано.
Подробният разказ е в `documentation/07_RELEASE/AUDIT-PROTOCOL.md`.

## 1. Проверки

| Проверка                     | Команда                                         | Резултат                                                               |
| ---------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Тестове                      | `node scripts/test-matrix.cjs --attempts=1`     | **160/160** за ~123 s (един опит)                                      |
| Издание                      | `node scripts/verify-release.cjs --with-tests`  | **21/21** сценария (S01–S21), вкл. S20 = 160/160                       |
| Логически одит               | `node scripts/logic-audit.cjs --gate`           | 282 файла · 49 442 реда · **0** critical/high · 7 с обосновка          |
| Скенер за лош код            | `node scripts/bad-code-scan.cjs --gate`         | 264 файла · 41 860 реда · **0** critical/high · 138 `low` · 239 приети |
| Таг = версия                 | `node scripts/check-tag-version.cjs v0.69.5`    | ✔ `config.yaml` = `manifest.json` = таг                                |
| Документи                    | `node tests/docs-consistency.cjs`               | ✔ 3 документа на версия 0.69.5, без счупени връзки                     |
| Changelog на add-on-а        | `node scripts/sync-addon-changelog.cjs --check` | ✔ актуален                                                             |
| CI / CodeQL (`main`)         | GitHub Actions                                  | ✔ / ✔                                                                  |
| Release workflow (`v0.69.5`) | GitHub Actions                                  | виж `gh run list --repo PasevSU/hAPI`                                  |
| HACS Validate + Release      | GitHub Actions                                  | виж `gh run list --repo PasevSU/hapi-enterprise-integration`           |

## 2. Артефакти (dist/)

| Файл                                     | Размер      | SHA-256                                                            |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `hapi_enterprise-0.69.5.tar.gz`          | 1 485 132 B | `815eb43f9d89cc1725f10a08f6139ffbc7b6fc5ddb112a6c3c5fa20c97c4c7b3` |
| `hapi_enterprise-integration-0.69.5.zip` | 226 124 B   | `1fb78d7c8f8421c1b83129d2d8afb74bd86c9b3586ff94babd7704df3d28a9ab` |
| `repository.yaml`                        | —           | `7ec5d2ec55d66695b7021ab4c5ae70c2440d578ab3c9155f48c65e506e3190af` |
| `RELEASE.json`                           | —           | `939cfd789160245325a40c32a46062465fc56df1cc90ba9dd50ccd0b8583b2c0` |

**Проверка на публикуваното:** за 0.69.4 артефактът, свален от GitHub, съдържаше **112/112 файла,
съвпадащи побайтово** с кода (при нормализирани окончания на редовете). Разликата в размера
(~2 KB) е от gzip/tar метаданни, не от съдържание; затова проверката е по хеш, не по размер.

## 3. Публикация

| Къде                                       | Какво                                                                                | Състояние            |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------- |
| GitHub release `PasevSU/hAPI` `v0.69.5`    | add-on tar.gz, integration zip, `RELEASE.json`, `repository.yaml`, `SHA256SUMS.txt`  | **Latest**           |
| HACS `PasevSU/hapi-enterprise-integration` | комит + таг `v0.69.5`, `manifest.json` = 0.69.5, `hacs.json` `content_in_root:false` | публично, Validate ✔ |
| Идентичност на HACS комитите               | `PasevSU <PasevSU@users.noreply.github.com>`                                         | без личен имейл      |

## 4. Какво е поправено в този цикъл

| Версия | Поправки                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.69.0 | сегментен одит: `document.write`, 2 × `Invoke-Expression`, fail-closed `safeEqual` (×3), TSA отпечатък в постоянно време; white-box и black-box тестове                         |
| 0.69.1 | гейт OpenAPI ↔ публични маршрути (намери липсващ `/tree`), гейт „таг = версия“, noreply идентичност при публикуване                                                             |
| 0.69.2 | PGP MPI: водещи нули не чупят ключ (≈1 от 256 нови ключа не можеше да се създаде)                                                                                               |
| 0.69.3 | логически одит: ролите в `merge` се секат, прозорец през полунощ се отказва изрично, манифестът ползва канонични пътища, лимитът на версиите брои и текущата                    |
| 0.69.4 | `freePort()` не дава един и същ порт два пъти, платформено независим тест за ключалката, синхрон на add-on changelog                                                            |
| 0.69.5 | 25 празни `catch` с конкретна причина (скенерът приема само документирани), `CORRUPT_METADATA` вместо `SyntaxError`, устойчив `rename` при миграция, портове с резерв под 65535 |

## 5. Известен дълг (съзнателно оставен)

- **138 находки `low`** в скенера за лош код: `empty-catch` 90, `json-parse-untrusted` 37, `todo` 11
  (повечето в `tests/`). В издавания код остават **16** `json-parse`, всички в `try`/`catch`
  или с изричен резервен вариант — прегледани ръчно.
- **Исторически тагове** `v0.63.0` (сочи комит с 0.62.1) и `v0.54.0` (стара подредба) остават
  каквито са — таг с публикувано издание не се мести. Гейтът не допуска повторение.
- **Личен имейл в стари публични HACS комити** (`e1c3cf8`, `638287a`) — решение на собственика.
- **Версии без GitHub издание:** `0.69.2` (не е тагван) и `0.69.3` (тагът падна CI и беше сложен
  наново като 0.69.4). Записите им в `CHANGELOG.md` остават.
- **Локални пускове на Windows**: при пуснат GUI или антивирусна защита рядко един тест пада за
  ~100 ms (заключен файл в `%TEMP%`). Авторитетният гейт е CI на Linux; локално помага
  `--attempts=2`, който отчита дали е имало флейк.

## 6. Възпроизвеждане

```bash
node scripts/test-matrix.cjs --attempts=1        # 160/160
node scripts/logic-audit.cjs --save --gate       # 0 critical/high + отчети
node scripts/bad-code-scan.cjs --gate            # ГЕЙТ: чисто
node scripts/check-tag-version.cjs v0.69.5       # ✔
node scripts/sync-addon-changelog.cjs --check    # ✔
node scripts/build-release.cjs --version 0.69.5  # 4 артефакта
node scripts/build-haoss.cjs                     # release/haoss в синхрон
node scripts/verify-release.cjs --with-tests     # 21/21
```
