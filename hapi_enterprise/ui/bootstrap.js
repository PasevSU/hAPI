'use strict';
// Зарежда споделените ядра (същите файлове, които ползва backend-ът) с правилния
// базов път:
//
//   * през HTTP (add-on-ът, ingress) сървърът ги сервира на /hapi_enterprise/...;
//   * при отваряне от диска (file://, START_HAPI_GUI.bat) те са в родителската
//     папка на ui/ — преди това index.html ползваше ../hapi_enterprise/..., което
//     от диска сочи hapi_enterprise/hapi_enterprise/... и мълчаливо дава 404,
//     т.е. HapiReportManifest/HapiApiSpec/... липсват и панелите не работят.
//
// Скриптовете се добавят като елементи, не с document.write: браузърът ги
// изпълнява в реда на добавяне (без async), а страницата не се презаписва.
(function () {
  var shared = [
    'report-manifest.js',
    'api-spec.js',
    'virtual-storage.js',
    'storage-tree.js',
    'export-rules.js',
    'export-manager.js',
    'download-access.js',
    'public-gateway.js',
    'qrcode.js',
  ];
  var base = location.protocol === 'file:' ? '../' : '../hapi_enterprise/';
  // СКРИПТОВЕТЕ СЕ ЗАРЕЖДАТ ЕДИН СЛЕД ДРУГ (onload → next), а не наведнъж.
  // Динамично добавен `script` е `async` по подразбиране: при девет едновременни
  // заявки редът на изпълнение не е гарантиран и панел, който ползва ядрото още
  // при дефиниране (report-studio), гърмеше с TypeError и оставаше празен екран.
  var index = 0;
  function next() {
    if (index >= shared.length) {
      window.HAPI_SHARED_READY = true;
      try {
        document.dispatchEvent(new Event('hapi:shared-ready'));
      } catch (e) {
        /* стар браузър без Event — флагът window.HAPI_SHARED_READY стига */
      }
      return;
    }
    var el = document.createElement('script');
    el.src = base + shared[index];
    index += 1;
    el.async = false;
    el.onload = next;
    // Липсващ модул не бива да блокира останалите: панелите казват какво им липсва.
    el.onerror = next;
    document.head.appendChild(el);
  }
  next();
})();
