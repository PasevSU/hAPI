# Промени в hAPI Enterprise

Тази версия: **0.69.41**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.41

Панелът в Home Assistant вече се отваря — причината беше забрана за вграждане в iframe.

- **Дефект:** всички файлове на административния UI (`/ui/*`) се сервираха с
  `Content-Security-Policy: … frame-ancestors 'none'`. Панелът на add-on-а в Home Assistant
  е iframe, тоест браузърът отказваше да покаже документа и екранът оставаше напълно
  празен (сива страница с икона, без съобщение за грешка).
- **Поправка:** `frame-ancestors 'self'` — вграждане от същия origin е разрешено (ingress
  е на адреса на Home Assistant), чужд сайт остава отказан. Публичните страници
  (`/p/<id>`, `/secret/<id>`, порталът в интеграцията) остават с `'none'`.
- Договор: INV-C2 в `documentation/02_TO_BE_ARCHITECTURE/INTEGRATION_CONTRACTS.md`.
- Тест: `tests/blackbox-security.cjs` изисква `'self'` за UI-я и `'none'` за публичните
  страници — ако някой върне забраната, тестът пада.
