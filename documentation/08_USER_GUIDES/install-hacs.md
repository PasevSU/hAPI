# Инсталиране през HACS

Интеграцията `hapi_enterprise` се разпространява като **custom repository** в HACS.
Add-on-ът е отделен продукт и се инсталира като add-on repository (виж
[`public-gateway-setup.md`](public-gateway-setup.md)).

## 1. Какво е нужно

- Home Assistant **2024.6** или по-нов.
- [HACS](https://hacs.xyz/) вече инсталиран.
- Публично GitHub хранилище: `https://github.com/PasevSU/hAPI`.

## 2. Добавяне на хранилището

1. **HACS → ⋮ (три точки) → Custom repositories**.
2. В полето за URL: `https://github.com/PasevSU/hAPI`.
3. Категория: **Integration** → **Add**.
4. Намери **hAPI Enterprise** в HACS → **Download**.
5. Рестартирай Home Assistant.

След инсталация файловете са в `/config/custom_components/hapi_enterprise/`
(`manifest.json`, `__init__.py`, `brand/icon.png`, `brand/logo.png`).

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
  backend_url: http://<адрес-на-add-on-а>:8099
```

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
