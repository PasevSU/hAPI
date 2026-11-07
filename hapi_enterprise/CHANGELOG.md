# Промени в hAPI Enterprise

Тази версия: **0.69.193**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.193

- **Интеграцията обявява `hassio` като `after_dependencies`.** `discovery.py` внася
  `homeassistant.components.hassio.handler`, а манифестът държеше празен списък — официалният
  hassfest връща `[DEPENDENCIES] Using component hassio but it's not in 'dependencies' or
  'after_dependencies'` и HACS валидаторът маркира изданието след публикуване (хванато на
  v0.69.192; HACS action мина, hassfest — не).
- Проверява се ЛОКАЛНО от `tests/hassfest-local.cjs`: всеки `homeassistant.components.<домейн>`,
  който кодът на интеграцията ползва, трябва да е в `dependencies` или `after_dependencies`.
  Платформените файлове на самата интеграция (`sensor.py`, `binary_sensor.py`) не се броят.
  Без поправката правилото връща `hassio (discovery.py)`.
