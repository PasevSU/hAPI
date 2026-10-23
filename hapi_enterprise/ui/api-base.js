'use strict';
// Базов адрес за заявките от панела (Enterprise Control Center).
//
// Home Assistant сервира add-on-а през Ingress на `/api/hassio_ingress/<token>/…`,
// а НЕ на корена на HA. Затова `location.origin` НЕ е адресът на add-on-а: заявка
// към `https://<ha>/admin/api/…` отива в Home Assistant и връща 404 — панелът се
// зарежда (ресурсите му са относителни), но нищо в него не работи. Точно това се
// случваше, докато всеки панел строеше адреса от `location.origin`.
//
// Затова базовият адрес е `origin + ingress префикс`. Поддържат се и старите форми
// (`/app/<token>`, `/hapi/<token>`, `/hassio/ingress/<token>`), за да не се чупят
// инсталации и reverse proxy-та, които ги ползват.
//
// Ръчно зададеният `hapi.apiBase` (Настройки → Връзка) остава с предимство: така
// standalone употребата и външният адрес продължават да работят.
(function () {
  // Префиксът се разпознава САМО в началото на пътя; `[^/]+` е токенът на сесията.
  var PREFIX = /^\/(?:api\/hassio_ingress|hassio\/ingress|app|hapi)\/[A-Za-z0-9_-]+/;

  function ingressPrefix() {
    try {
      var match = PREFIX.exec(String(location.pathname || ''));
      return match ? match[0] : '';
    } catch (e) {
      return '';
    }
  }

  function stored() {
    try {
      return String(localStorage.getItem('hapi.apiBase') || '').replace(/\/+$/, '');
    } catch (e) {
      return ''; // забранен storage (private режим) — тогава се смята от адреса
    }
  }

  /** Адресът на add-on-а от гледна точка на този документ, без крайна наклонена черта. */
  function apiBase() {
    var saved = stored();
    if (saved) return saved;
    try {
      if (location.protocol === 'file:') return '';
      return (location.origin + ingressPrefix()).replace(/\/+$/, '');
    } catch (e) {
      return '';
    }
  }

  /** Пълен адрес за път от вида `/admin/api/…` — с ingress префикса, когато има такъв. */
  function apiUrl(path) {
    var p = String(path == null ? '' : path);
    if (/^https?:\/\//i.test(p)) return p;
    return apiBase() + (p.charAt(0) === '/' ? p : '/' + p);
  }

  window.hapiApiBase = apiBase;
  window.hapiIngressPrefix = ingressPrefix;
  window.hapiApiUrl = apiUrl;
})();
