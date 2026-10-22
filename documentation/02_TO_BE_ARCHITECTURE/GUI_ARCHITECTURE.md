# GUI Architecture — hAPI Enterprise (To-Be)

## Surfaces

| Surface | Framework | Audience |
| ------- | --------- | -------- |
| Admin console (`ui/`, Enterprise Control Center) | HTML/JS, без npm | operators/admins |
| Evidence portal (`evidence-portal/`, публикува се в `www/hapi/data`) | HTML/JS | courts/prosecutors |
| Desktop | pywebview + WebView2 (същия `ui/`) | Windows operators |
| Settings UI (секции на `ui/settings-panel.js`) | HTML/JS | admins |

## Principles

- **One data layer** — every surface calls the same versioned REST API.
- **Responsive** — HA Ingress (webview) and desktop window share admin UI.
- **Accessible** — keyboard navigation, contrast, plain-language labels (BG/DE/EN).

## Settings UI (Phase 5)

- Структуриран редактор на сървърните настройки през `PATCH /admin/api/settings` (валидация на
  сървъра) + профили на настройките (снимка → прилагане → изтриване).
- 14 секции в `ui/settings-panel.js`; всяка чете и — където има смисъл — пише през реалното API.

## Progress popup (Phase 5)

- Панел „Задачи“ показва състоянията queued → running → paused → succeeded / failed / cancelled
  с лента за напредък, пауза/продължаване/отказ и обновяване на 3 s, докато е отворен.
- Причината за грешка идва от `error-log.js` и се вижда в колоната „Бележка“.

## Тайни връзки от панела (модел като scrt.link v2)

- `ui/secret-share.js` генерира линка в браузъра: `/secret#<id><ключ>`, 65 знака във фрагмента.
  Сървърът получава само `sha256(id)` и непрозрачен плик (`{v:2, iv, ct}`), без ключ и без път
  с идентификатор.
- Шифроване AES-GCM-256; по избор втора парола → външен слой PBKDF2-SHA256 (600 000 итерации).
  `check` остава на сървъра (за да не изгаря преглед при сгрешена парола) и не се връща.
- Панелът (секция „Данни“) приема текст или връзка към панела/портал и показва линка, чека,
  срока и QR кода. Публичният адрес следва префикса на панела (вкл. HA Ingress).
- Проверява се от `tests/secret-panel.cjs` (жив сървър + истинския клиентски модул) и
  `tests/ui-settings-sections.cjs` (формата в панела).

## Evidence portal (Phase 7)

- Public, read-only, branded landing with in-browser hash/signature/timestamp verification.
- Minimal attack surface: static assets + read-only verify API.
