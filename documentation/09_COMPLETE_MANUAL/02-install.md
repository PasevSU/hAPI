# 2. Инсталация и първи старт

## 2.1. Добавяне на хранилището

1. Home Assistant → **Настройки → Add-ons → Add-on Store**.
2. Меню (⋮) → **Repositories** → добави `https://github.com/PasevSU/hAPI`.
3. Отвори **hAPI Enterprise** → **Install**.

От 0.69.154 насам store-ът **тегли готов образ** за твоята архитектура
(`ghcr.io/pasevsu/<arch>-addon-hapi_enterprise`) — измерено 14 s вместо 129 s за build на
Raspberry Pi 4. Ако тегленето се провали, виж [диагностиката](06-troubleshooting.md).

## 2.2. Единственото задължително нещо: токенът

Отвори **Конфигурация** на add-on-а и попълни `token`:

- поне 24 знака, random, **не** парола, **не** повтарящ се шаблон;
- **не** Home Assistant long-lived access token — той отваря целия HA API, тоест един изтекъл
  hAPI токен би бил изтекъл Home Assistant (логът предупреждава с `ADMIN_TOKEN_LOOKS_LIKE_HA_LLAT`);
- `!secret` **не се разгъва** в опциите на add-on — въвежда се самата стойност.

Без токен add-on-ът **отказва да стартира** с `ADMIN_TOKEN_REQUIRED` — това е нарочно, за да не
има инсталация с празен админ. Проверено е и с тест: `tests/addon-defaults-startup.cjs`.

## 2.3. Първи старт — какво да очакваш

След **Start** в лога трябва да видиш трите listener-а и реда за старт:

```
INFO  server startup node=v22.23.2 ... dataDir=/config/hapi_enterprise ingress=true ... port=8099 adminPort=8098 tsa=true
INFO  server listening listener=public host=0.0.0.0 port=8099
INFO  server listening listener=ingress-admin host=0.0.0.0 port=8098
INFO  server listening listener=public-gateway host=0.0.0.0 port=8088
```

и в хранилището да се появи маркерът `.portal-enterprise-storage`. Ако ред `startup` липсва —
виж [глава 6](06-troubleshooting.md), там са подредени причините по симптом.

Панелът се отваря от страничната лента на Home Assistant (**hAPI Enterprise**), не през порт.

## 2.4. Интеграцията (по избор)

Два начина:

```powershell
# 1) от публикуваното издание, без HACS
pwsh -File scripts/update-integration.ps1 -Execute -HaHost <адрес-на-HA>
```

2) ръчно: свали `hapi_enterprise-integration-<версия>.zip` от Releases и го разгъни в
`/config/custom_components/`.

След това в Home Assistant: **Настройки → Устройства и услуги → Добавяне на интеграция →
hAPI Enterprise**, с адрес `http://99438e72-hapi-enterprise:8099` и същия токен.
Рестарт на HA е нужен само за да се заредят новите файлове на интеграцията.

## 2.5. Проверка за 60 секунди

| Проверка | Очакван резултат |
| --- | --- |
| Логът на add-on-а | `server startup` + три `listening` реда |
| Панелът от страничната лента | отваря се, показва версията в горния ред |
| `/config/hapi_enterprise/` | има `.portal-enterprise-storage`, `files/`, `logs/` |
| Add-on → Информация | `documentation: true` (линк към упътването), версия = последната |
| Интеграцията (ако е добавена) | device „hAPI Enterprise“ със сензори и без `проблем` |

## 2.6. Обновяване и връщане назад

```bash
ha store reload && ha apps update 99438e72_hapi_enterprise   # обновяване
ha apps stop 99438e72_hapi_enterprise                        # спиране
```

Връщане към предишна версия: Add-on → меню → **Tагове/версии** (Supervisor пази предишния
образ до следващото обновяване) или от snapshot. Данните не се пипат от обновяването — те са в
`/config/hapi_enterprise` и остават.

## 2.7. Watchdog

`watchdog:` в `config.yaml` задава адреса за проверка, но **не включва watchdog-а**. Това е
отделен ключ за всяко приложение и **по подразбиране е изключен**. Ако искаш Supervisor да
рестартира add-on-а при спиране или неуспешна проверка, отвори страницата му **Информация**,
включи превключвателя **Watchdog**, после стартирай add-on-а и потвърди, че състоянието му е
„Started“. Адресът за проверка е `/health` на порта 8099; `/health` показва, че процесът е
жив, а не че всички зависимости са готови.
