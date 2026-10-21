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
// document.write по време на парсването запазва реда и синхронното изпълнение на
// скриптовете; файлът е външен, така че CSP-то (script-src 'self') не се нарушава.
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
  for (var i = 0; i < shared.length; i += 1) {
    document.write('<script src="' + base + shared[i] + '"><\/script>');
  }
})();
