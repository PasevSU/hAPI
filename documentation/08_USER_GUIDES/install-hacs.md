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

| Поле | Стойност |
| ---- | -------- |
| Admin API URL | `http://<адрес-на-add-on-а>:8098` |
| Admin token | административният токен на add-on-а (поне 24 знака) |
| Update interval | 10–86400 секунди (по подразбиране 60) |

Създават се устройство **hAPI Enterprise** и 7 сензора: посещения, изтегляния, файлове,
портали, място за файлове, размер на базата, размер на телеметрията. Стойностите се
обновяват през посочения интервал; при грешен токен интеграцията показва
„rejected the token“ в лога. Настройките се сменят през **Configure** (без преинсталация).

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

Публичен канал (Public API Gateway) е достъпен на същия адрес и порт като Home
Assistant: `/api/public/v1/portals/<slug>` и `/api/public/v1/files/<id>/download`.

## 4. Ако искаш интеграцията да влезе в HACS по подразбиране

HACS проверява хранилището автоматично (`HACS validation` в CI). Изисквания:

- `hacs.json` в корена (налично) и `manifest.json` с `version`, `codeowners`,
  `documentation`, `issue_tracker` (налично).
- Brand изображения в `custom_components/hapi_enterprise/brand/` (налично).
- В **GitHub → Settings → Topics** добави: `home-assistant`, `hacs`, `integration`.
- Описание на хранилището в GitHub (едно изречение) и включени Issues.

## 5. Проверка

```bash
node tests/hacs-structure.cjs          # структурата на хранилището
node scripts/verify-release.cjs        # сценарий S21 (HACS) в изданието
```

## 6. Чести проблеми

| Симптом | Причина | Решение |
| ------- | ------- | ------- |
| HACS не показва интеграцията | категорията при добавяне не е Integration | добави хранилището отново с категория Integration |
| „Integration not found“ след рестарт | липсва `custom_components/hapi_enterprise/manifest.json` | преинсталирай от HACS |
| Интеграцията не стартира | невалиден `backend_url` | поправи адреса (`http://host:8099`, без път) |
| 401 при порталните заявки | липсва `X-Portal-Key` | издай ключ за портала и го подай в заглавката |
| 404 за `/admin` през интеграцията | по дизайн — административните пътища не се проксират | използвай панела през add-on-а (Ingress) |
