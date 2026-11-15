# Промени в hAPI Enterprise

Тази версия: **0.69.216**. Пълната история е в [CHANGELOG.md](https://github.com/PasevSU/hAPI/blob/main/CHANGELOG.md).

## 0.69.216

- **Прегледът вече не рисува документи, които изпълняват скрипт (DEF-60).** Намерено при
  сегментирания анализ на кода: `preview()` слагаше blob адрес в `<iframe>` за всеки тип,
  различен от текст. Blob адресът наследява произхода на панела — качен **SVG** (или HTML)
  със `<script>` вътре се изпълнява в същия произход и стига до `sessionStorage` с
  администраторския токен. Сървърът също сервираше `image/svg+xml` **inline без политика**.
  Сега: панелът рисува в iframe само `application/pdf` и `image/(png|jpeg|gif|webp)`
  (`SAFE_FRAME`), за останалите показва причина и предлага изтегляне; inline SVG носи
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:;
  frame-ancestors 'self'`; името в `Content-Disposition` на пакета с отчет мина на RFC 5987
  (`filename*=UTF-8''…`), защото сурово име в заглавка е Latin-1 и чупи връзката при кирилица.
- **Глобални тестери за класа, а не за случая.** `tests/render-sinks-global.cjs` минава през
  целия интерфейс и публичните страници и отказва: blob→iframe без бял списък, поле от данни
  в `innerHTML` без `esc(`, име на файл в `Content-Disposition` без процентно кодиране,
  `<script` през `innerHTML`, inline SVG без CSP. `tests/preview-unsafe-types.cjs` доказва
  поправката на живо: SVG със `<script>` → CSP без `script-src`, PNG → inline както преди,
  панелът → без iframe, със съобщение и изтегляне.
