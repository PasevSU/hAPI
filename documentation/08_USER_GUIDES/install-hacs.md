# Инсталиране на интеграцията

От Home Assistant **2026.11** HACS е заменен от вградения **Marketplace**
(`Настройки → Marketplace`). Съществуващото HACS съдържание се прехвърля автоматично при
първия старт след обновяването, но **само хранилища с един вид съдържание продължават да
получават обновявания**. Add-on-ът е отделен продукт и се инсталира като app repository
(виж [`public-gateway-setup.md`](public-gateway-setup.md)).

## 1. Какво е нужно

- Home Assistant **2024.6** или по-нов (Marketplace — 2026.11+; при по-стар HA остава HACS).
- Публично GitHub хранилище **само с интеграцията**:
  `https://github.com/PasevSU/hapi-enterprise-integration`.

> **Какво НЕ се добавя.** `https://github.com/PasevSU/hAPI` съдържа и app-а
> (`hapi_enterprise/` + `repository.yaml`). Marketplace отказва да инсталира и обновява от
> хранилище, което съдържа apps — заради това оттам идва „няма налична актуализация“, а
> понякога и директна грешка при опит за обновяване.

## 2. Добавяне на хранилището

1. **Настройки → Marketplace → ⋮ → Add from link**.
2. `https://github.com/PasevSU/hapi-enterprise-integration`.
3. Ако типът не се разпознае: **Type → Integration**, после **Add**.
4. Отвори **hAPI Enterprise** → **Install** → рестартирай Home Assistant.

> **Настройката се попълва сама.** Когато Home Assistant има Supervisor и приложението е
> инсталирано (или инсталирано под друго име), интеграцията открива адреса и токена през
> Supervisor (`addons.list` → `addon_info`), проверява адреса с `/health` и записва
> връзката без ръчно въвеждане. Ако нещо липсва — HA без Supervisor, приложение на друг
> хост или отказан достъп до опциите — същата форма се показва с каквото е намерено, за да
> довършиш само липсващото. Токенът се чете от опциите на приложението и не се показва в
> логове; при ръчно въвеждане важат същите правила (поне 24 знака).

След инсталация файловете са в `/config/custom_components/hapi_enterprise/`
(`manifest.json`, `__init__.py`, `brand/icon.png`, `brand/logo.png`).

При стария HACS пътят е същият, но URL-то пак е интеграционното хранилище:
**HACS → ⋮ → Custom repositories** → `https://github.com/PasevSU/hapi-enterprise-integration`
→ категория **Integration**.

## 2б. Ако обновяването отказва

Провери по ред:

| Симптом                                                    | Причина                                                                                              | Решение                                                                                     |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| „Няма налична актуализация“, а има ново издание            | следено е `PasevSU/hAPI` (смесено хранилище с app)                                                    | премахни го от Marketplace, добави `PasevSU/hapi-enterprise-integration`                    |
| Показва по-стара версия от инсталираната                   | кешът на custom repository се обновява на **48 часа** (6 часа за каталожните) без GitHub връзка       | свържи GitHub в Marketplace (по-висок лимит) или премахни и добави хранилището наново        |
| Обновяването е „пропуснато“                                | `skipped_version` на update ентитета                                                                  | отвори ентитета → **Clear skipped version**, после **Install**                              |
| Инсталирано е 0.69.165, а е обявено 0.69.166               | интеграцията се обновява отделно от app-а                                                            | Marketplace → hAPI Enterprise → **Update**, после рестарт на Home Assistant                  |
| Няколко записа „hAPI Enterprise“ в Marketplace             | стар HACS запис + нов custom repository                                                               | остави само интеграционното хранилище, другото го премахни                                  |

Ако Marketplace не е опция (по-стар HA или изключен), същото обновяване се прави с
`pwsh -File scripts/update-integration.ps1 -Execute -HaHost <адрес>` — той тегли
`hapi_enterprise-integration-<версия>.zip` от интеграционното хранилище.

## 3. Настройка

Интеграцията има два канала. Можеш да ползваш който ти е нужен — или двата.

### 3а. През интерфейса (сензори за телеметрията)

**Settings → Devices & Services → Add Integration → hAPI Enterprise**, после:

| Поле            | Стойност                                            |
| --------------- | --------------------------------------------------- |
| Admin API URL   | `http://<адрес-на-add-on-а>:8098`                   |
| Admin token     | административният токен на add-on-а (поне 24 знака) |
| Update interval | 10–86400 секунди (по подразбиране 60)               |

Създават се устройство **hAPI Enterprise** и 7 сензора: посещения, изтегляния, файлове,
портали, място за файлове, размер на базата, размер на телеметрията. Стойностите се
обновяват през посочения интервал; при грешен токен интеграцията показва
„rejected the token“ в лога. Настройките се сменят през **Configure** (без преинсталация).

От 0.69.37 има и два диагностични сензора, които казват дали обновяването е стигнало и до
двете половини:

| Сензор                                  | Какво показва                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Add-on version** / Версия на add-on-а | версията, която add-on-ът **реално** работи (не инсталираната някога)                                   |
| **Add-on and integration match**        | `ok` — двете са на една версия; `mismatch` — едната е обновена, другата не; `unknown` — липсва стойност |

При `mismatch` атрибутите `addon_version` и `integration_version` показват кое е старо,
така че се вижда дали да се обнови add-on-ът от Add-on Store или интеграцията през HACS.

### 3б. През YAML (прокси на порталното API)

В `configuration.yaml` (и рестарт на Home Assistant):

```yaml
hapi_enterprise:
  backend_url: !secret hapi_backend_url
```

В `secrets.yaml` (никога не се качва в git):

```yaml
hapi_backend_url: http://<адрес-на-add-on-а>:8099
```

> **Токен в YAML не се слага.** Bridge-ът не ползва административния токен — той се
> въвежда в UI настройката (3а) и се пази от Home Assistant в `.storage`, а не в
> `configuration.yaml`. Ако друг компонент все пак иска токен в YAML, той е
> `!secret hapi_token` (стойността — в `secrets.yaml`), никога като открит текст.

- `backend_url` е единственият задължителен параметър и се проверява стриктно
  (`http(s)://host:port`); при невалидна стойност bridge-ът не се вдига, но UI
  настройката (3а) продължава да работи.
- Проксират се само пътищата на порталите: `/api/hapi_enterprise/v1/p/<id>/…`
  (`files`, `download`, `manifest`, `openapi.json`). Административните API-та не се
  проксират никога.
- Порталната страница и активите се сервират от интеграцията:
  `/api/hapi_enterprise/portal/<id>` и `/api/hapi_enterprise/assets/portal.{js,css}` —
  без значение дали е зададен `backend_url`.

Публичен канал (Public API Gateway) е достъпен на **същия адрес и порт като Home
Assistant** — без отделен порт:
`/api/hapi_enterprise/public/v1/portals/<slug>` и
`/api/hapi_enterprise/public/v1/files/<id>/download`.

Старият адрес `/api/public/v1/...` продължава да работи за вече създадени QR кодове и
връзки, но отговаря с `Deprecation` и `Link: rel="successor-version"` хедъри.

## 4. Ако искаш интеграцията да влезе в HACS по подразбиране

HACS проверява хранилището автоматично (`HACS validation` в CI). Изисквания:

- `hacs.json` в корена (налично) и `manifest.json` с `version`, `codeowners`,
  `documentation`, `issue_tracker` (налично).
- Brand изображения в `custom_components/hapi_enterprise/brand/` (налично).
- В **GitHub → Settings → Topics** добави: `home-assistant`, `hacs`, `integration`.
- Описание на хранилището в GitHub (едно изречение) и включени Issues.

### 4б. Самостоятелно HACS хранилище

`npm run release:haoss` (`scripts/build-haoss.cjs`) сглобява готово за публикуване
хранилище в `release/haoss` — точно структурата, която HACS очаква:

```
release/haoss/
  hacs.json                 само документирани ключове
  README.md  LICENSE  SECURITY.md  .gitignore
  .github/workflows/validate.yml    hassfest + HACS action (category: integration)
  custom_components/hapi_enterprise/   manifest.json, brand/icon.png, код, преводи
```

Скриптът проверява договора преди да приключи (една интеграция, `domain` = име на
папката, версия = `hapi_enterprise/config.yaml`, `brand/icon.png`, без собствени
портове, без тайни) и не пише извън `release/haoss`. За друго място: `--out <папка>`,
за друг адрес на репото: `--repo-url https://github.com/<owner>/<repo>` (преписва
`documentation` и `issue_tracker` в `manifest.json`).

`release/` е в `.gitignore` на монорепото — публикува се като отделно хранилище.
Затова има скрипт, който прави всичко с една команда и **по подразбиране не качва нищо**:

```bash
npm run publish:haoss                    # dry run — показва командите
npm run publish:haoss -- -Execute        # реално публикуване
```

`scripts/publish-haoss.ps1` минава пет стъпки: строи изданието с адреса на новото репо
(`--repo-url`), прави `git init` при нужда и commit, създава публично GitHub repo
(`gh repo create --source . --push`) или push-ва към съществуващо, задава описание +
topics + Issues, вдига таг `v<версия>` и проверява с `gh release list`. Не прави
force push и не трие нищо от GitHub; ако repo-то вече съществува, само push-ва.

Ръчният вариант остава същият:

```bash
cd release/haoss && git init && git add . && git commit -m "hAPI Enterprise integration"
```

Изданието се прави с таг: `git tag v0.61.3 && git push --tags`.
Workflow-ът `release.yml` проверява, че тагът съвпада с `manifest.json`, и създава пълно
GitHub release с генерирани бележки (HACS показва последните издания).

**Публикувано:** <https://github.com/PasevSU/hapi-enterprise-integration>

```
HACS → Integrations → ⋮ → Custom repositories
  https://github.com/PasevSU/hapi-enterprise-integration   (категория Integration)
```

### Кой адрес къде се слага

Двете части живеят в две различни хранилища и се добавят на две различни места:

| Какво                                     | Хранилище                                                | Къде                                      |
| ----------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| Add-on (сървърът, портове 8098/8099/8088) | `https://github.com/PasevSU/hAPI`                        | Settings → Add-ons → Repositories         |
| Интеграцията (сензори + мост)             | `https://github.com/PasevSU/hapi-enterprise-integration` | HACS → Integrations → Custom repositories |

Ако адресът на интеграцията се добави като add-on хранилище, Home Assistant връща
**„is not a valid app repository“** — в него няма `repository.yaml` и `config.yaml`, защото
не е add-on. Обратното също е вярно: монорепото `hAPI` работи и като HACS custom
repository, но тогава HACS взима интеграцията от подпапка `custom_components/`.

Ако `H:` е мрежов диск, `git` в него може да блокира (проверено — `git rev-parse` виси).
Затова `publish-haoss.ps1` работи върху локално копие във `%TEMP%`; с `-InPlace`
може да се работи направо в `release/haoss`.

## 5. Проверка

```bash
node tests/hacs-structure.cjs          # структурата на хранилището
node tests/haoss-release.cjs           # готовото HACS издание (release/haoss)
node scripts/verify-release.cjs        # сценарий S21 (HACS) в изданието
```

## 6. Чести проблеми

| Симптом                              | Причина                                                  | Решение                                           |
| ------------------------------------ | -------------------------------------------------------- | ------------------------------------------------- |
| HACS не показва интеграцията         | категорията при добавяне не е Integration                | добави хранилището отново с категория Integration |
| „Integration not found“ след рестарт | липсва `custom_components/hapi_enterprise/manifest.json` | преинсталирай от HACS                             |
| Интеграцията не стартира             | невалиден `backend_url`                                  | поправи адреса (`http://host:8099`, без път)      |
| 401 при порталните заявки            | липсва `X-Portal-Key`                                    | издай ключ за портала и го подай в заглавката     |
| 404 за `/admin` през интеграцията    | по дизайн — административните пътища не се проксират     | използвай панела през add-on-а (Ingress)          |
