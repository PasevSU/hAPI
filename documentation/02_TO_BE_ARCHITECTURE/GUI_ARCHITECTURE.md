# GUI Architecture — hAPI Enterprise (To-Be)

> **Клас:** нормативен · **Собственик на факта:** целева архитектура

## Surfaces

| Surface                                                              | Framework                          | Audience           |
| -------------------------------------------------------------------- | ---------------------------------- | ------------------ |
| Admin console (`ui/`, Enterprise Control Center)                     | HTML/JS, без npm                   | operators/admins   |
| Evidence portal (`evidence-portal/`, публикува се в `www/hapi/data`) | HTML/JS                            | courts/prosecutors |
| Desktop                                                              | pywebview + WebView2 (същия `ui/`) | Windows operators  |
| Settings UI (секции на `ui/settings-panel.js`)                       | HTML/JS                            | admins             |

## Principles

- **One data layer** — every surface calls the same versioned REST API.
- **Responsive** — HA Ingress (webview) and desktop window share admin UI.
- **Accessible** — keyboard navigation, contrast, plain-language labels (BG/DE/EN).
- **Симетрия и логика в менюто** (закон, 0.69.208) — навигацията не е един дълъг ред от
  бутони: секциите са в **групи по смисъл**, групите са с **равен брой** секции (при
  „Настройки“ — 3 × 6), а редът вътре в групата следва работата (структура → достъп и одит →
  данни и експлоатация). Всяка група е `role="group"` с име (`aria-labelledby`), за да не е
  „осемнайсет бутона в един чувал“ за екранния четец. Пази го `tests/ui-nav-symmetry.cjs`, а
  живият екран го проверява със закона `balanced-groups` на дебъгинг системата. Същият закон
  изисква отвореното меню да се **прибира само** при клик извън него (`tests/ui-nav-outside-click.cjs`).

## Settings UI (Phase 5)

- Структуриран редактор на сървърните настройки през `PATCH /admin/api/settings` (валидация на
  сървъра) + профили на настройките (снимка → прилагане → изтриване).
- 17 секции в `ui/settings-panel.js` (плюс „Основни“), подредени в **3 групи по 6**; всяка чете
  и — където има смисъл — пише през реалното API.
- Секция „Политики“ (`policies`) е единственото място, от което се пишат четирите групи на
  `limits`/`data`/`retention`/`preview`. Преди нея тези 18 полета се задаваха само с `PATCH` по API,
  тоест съществуваха в кода и бяха недостъпни за потребителя. Пази ги `tests/settings-policies.cjs`
  (+ `gui-sections` сценария „policies“, който натиска бутона и проверява стойностите на сървъра).

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
