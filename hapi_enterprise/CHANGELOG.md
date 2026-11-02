# Промени в hAPI Enterprise

Тази версия: **0.69.92**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.92

- **Интеграцията никога не беше ЗАРЕЖДАНА от нито един тест.** `ha-integration-python` я
  компилираше, но компилацията не хваща нито `ImportError` от сгрешено име, нито `NameError` в
  тялото, нито изглед, който изобщо не се регистрира — тоест интеграцията можеше да не се вдигне
  в истински Home Assistant, а всички проверки да са зелени. `tests/ha-integration-import.cjs`
  внася модула срещу минимални заготовки на `homeassistant`/`aiohttp`/`voluptuous` (истинските
  пакети не са зависимост на репото) и вика `async_setup` с фалшив `hass`, който записва
  регистрираните изгледи: без `backend_url` — само 2 статични изгледа (fail-closed), с
  `backend_url` — 19, включително `/hapi/{tail:.*}`, `/api/v1/p/{tail:.*}`, `/p/…`, `/s/…`,
  `/qr/…`, `/site/…`, `/t/…`, `/secret`, `/portal.js` и публичния gateway; всички без HA сесия и
  без дубликати. **Проверено обратно:** счупен `import` → „интеграцията се зарежда“ (с
  `ImportError`); махнат `register_view(HapiPrefix())` → „регистриран е изглед /hapi/{tail:.*}“.
