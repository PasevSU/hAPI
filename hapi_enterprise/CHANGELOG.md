# Промени в hAPI Enterprise

Тази версия: **0.69.153**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.153

- **Картата в store-а вече има линк „Документация“.** В `config.yaml` липсваше ключът
  `documentation:` — `url:` сочи add-on-а в хранилището, не упътването, затова Supervisor
  показваше `documentation: false`. Добавен е и се пази от ново правило **HA-M13** в
  `ha-compatibility.cjs`.
- **Интеграцията пази състоянието си в `entry.runtime_data`, не в `hass.data[DOMAIN]`.**
  Дотук координаторът се слагаше в речник, индексиран по `entry_id`: работи, но при
  презареждане ключът оставаше, ако някой забрави да го изчисти, а платформите трябваше да
  знаят как е устроен речникът. `ConfigEntry.runtime_data` (HA ≥ 2024.6, колкото е и
  минимумът ни) прави същото, но животът на данните следва живота на вписването. Миграцията
  е в `__init__.py`, `sensor.py`, `binary_sensor.py`, `diagnostics.py`; пази се от нов
  `tests/integration-runtime-data.cjs`, който пада и ако някой върне `hass.data`, и ако
  минимумът на HA падне под 2024.6.
- **Готов образ на add-on-а (GHCR).** Нов workflow `.github/workflows/addon-image.yml`
  строи `ghcr.io/<owner>/{arch}-addon-hapi_enterprise` за `amd64`, `aarch64` и `armv7` при
  всеки таг и го публикува с тагове `<версия>` и `latest`. Причината: без `image:` store-ът
  строи образа на машината — измерено **127 s** на Raspberry Pi 4 за всяко обновяване.
  `image:` в `config.yaml` още НЕ е включен: първо образът трябва да е публикуван и **public**
  в GHCR, иначе Supervisor не може да го изтегли анонимно. Проверката е
  `scripts/check-addon-image.ps1 -Version 0.69.153`.
- **Обновяване на интеграцията с една команда.** `scripts/update-integration.ps1` сваля
  публикуваното издание и слага `custom_components/hapi_enterprise` на място (локално или на
  Home Assistant през SSH), без да пипа `configuration.yaml` и без да рестартира HA — рестартът
  остава решение на човека. Досега това се правеше на ръка, затова интеграцията на диска
  изоставаше от add-on-а.
