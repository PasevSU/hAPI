'use strict';
// CSP за изолираните HTML проекти (`/site/<портал>/<проект>/…`).
//
// Защо съществува отделен модул: §7 от `API_ARCHITECTURE_SPEC.md` изисква недовереният HTML
// да върви в ИЗОЛИРАН контекст — с ограничения върху изпълнението на скриптове, достъпа до
// API и използването на удостоверителни данни. Досега имахме само `script-src 'self'`, тоест
// страница от `/site/…` беше СЪЩИЯТ origin като админ API-то и можеше да го извика с
// бисквитките на посетителя (управителят, който е отворил своя проект).
//
// `sandbox` БЕЗ `allow-same-origin` дава непрозрачен origin: документът няма бисквитки, няма
// общ `localStorage`/сесия с нашия origin и заявките му към нас са неудостоверени. Скриптовете
// на самия проект продължават да работят (`allow-scripts`), но `connect-src 'none'` им
// забранява fetch/XHR/WebSocket — тоест няма как да прочетат отговора на админ API дори да
// получат бисквитка по друг начин. Ресурсите се зареждат от ТОЧНИЯ origin (не `'self'`,
// защото при непрозрачен origin `'self'` не съвпада с нищо).
const SANDBOX = "sandbox allow-scripts allow-forms allow-modals; default-src 'none'; ";
const ASSET = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

const isDocument = (ext) => ext === '.html' || ext === '.htm';

/** Политиката за конкретния файл: документ → пясъчник, ресурс → обичайната за статика. */
function forFile(ext, origin) {
  if (!isDocument(ext)) return ASSET;
  const o = String(origin || '').replace(/\/+$/, '');
  return SANDBOX
    + 'img-src ' + o + " data:; style-src " + o + " 'unsafe-inline'; script-src " + o
    + '; font-src ' + o + "; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
}

module.exports = { forFile, isDocument, SANDBOX, ASSET, CODE: 'HTML_IN_SANDBOX' };
