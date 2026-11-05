# Промени в hAPI Enterprise

Тази версия: **0.69.160**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.160

- **Изданието се доставя с ТОЧНО тези настройки, с които е изпитано.** Defaults в
  `config.yaml` бяха сверени с работещата инсталация (`scripts/compare-live-options.cjs`):
  **42 от 43 опции съвпадат**, а единствената разлика е `token` — тайна, която по правило
  остава празна и се задава от човека. Променени defaults: `memory_limit_mb` 0→**1024**,
  `min_free_mb` 100→**1000**, `public_gateway` false→**true**, `public_same_origin`
  false→**true**, `storage_location` share→**addon_config**, `storage_subdirectory`
  hapi/data→**hapi_enterprise**, `tsa_enabled` false→**true**, `user_roles` ""→**{"pasev-admin":"admin"}**.
  Всяка от тях е с коментар в `config.yaml` защо е такава и какво следва от нея.
- **Видими в конфигурацията, не само в кода.** Описанията в `translations/en.yaml` и
  `translations/bg.yaml` вече казват стойността по подразбиране за всяка от тези опции, че
  публичният порт 8088 НЕ е публикуван (достъп само през reverse proxy), че TSA без интернет
  се проваля затворено и не блокира старта, и че 1024 MB може да се смъкне до 256-384 на малка
  машина. Поправен е и **дублиран `description`** при `storage_subdirectory` в двата превода —
  YAML пазеше само втория ред и дългото обяснение се губеше.
- **Таблиците с подразбирания в README-тата се преизграждат** (`scripts/settings-defaults.cjs`),
  иначе `settings-defaults` пада — това е гейтът, който хвана разминаването веднага.
- **Нов тест `tests/addon-defaults-startup.cjs` — „стартира безаварийно“ като проверка.**
  Чете опциите НАПРАВО от `config.yaml` и: (1) иска очакваните стойности, (2) иска всички
  тайни да са празни, (3) стартира entrypoint-а със самите defaults и проверява, че `/health`
  отговаря, че хранилището е създадено на `addon_config/hapi_enterprise`, че портът на
  публичния шлюз НАИСТИНА слуша и че SIGTERM води до чист изход, (4) проверява обратното —
  без `token` стартът се отказва с `ADMIN_TOKEN_REQUIRED`, вместо да тръгне с празен админ.
- `tests/raspberrypi-compat.cjs` вече не иска `memory_limit_mb: 0`, а разумен диапазон
  (0 или 256..2048) и изрично изисква препоръката 256-384 да е в преводите — така Pi-защитата
  остава, без да блокира сверените с разпределението defaults.
