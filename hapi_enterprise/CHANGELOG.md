# Промени в hAPI Enterprise

Тази версия: **0.69.199**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.199

- **Поправен дефект DEF-42: сензорът за версията не се създаваше в Home Assistant 2026.11.**
  Открит при проверката след обновяването на живата инстанция: в лога на HA стои
  `ERROR … Error adding entity sensor.hapi_enterprise_add_on_version … ValueError: … suggesting
  precision '0' … non-numeric value: '0.69.198'`. Причината е в
  `custom_components/hapi_enterprise/sensor.py`: `PortalSensorEntityDescription` имаше
  `suggested_display_precision: int = 0` като подразбиране, тоест **всеки** сензор получаваше
  прецизия — включително текстовият „версия“ и enum-ът „синхрон“, които HA отказва. Така в
  панела липсваше точно това, което трябва да показва коя версия работи и дали съвпада с
  интеграцията. **Поправка**: подразбирането е `None`, а числовите сензори, на които им трябва
  закръгляне, задават прецизия изрично (5 сензора).
- `tests/ha-version-sensor.cjs` пази поправката: текстовият сензор и enum-ът не носят прецизия,
  числовите я задават изрично — тестът би паднал при връщане на подразбирането 0.
