'use strict';
// Регистър на обектите за Report Studio (Фаза 11 / обектна библиотека).
//
// 8 категории; всеки обект има статус:
//   ready   — може да се добавя (има валидация в report-manifest.js)
//   system  — START/STOP, не се добавят ръчно (заключени)
//   planned — вижда се, но е изключен (v2), за да няма фиктивни функции
//
// Чист JS (UMD) — работи в браузъра и в тестовете.
(function () {
  const CATEGORIES = [
    { id: 'text', label: 'Текст', icon: '¶' },
    { id: 'data', label: 'Данни', icon: '☰' },
    { id: 'tables', label: 'Таблици', icon: '▦' },
    { id: 'media', label: 'Медия', icon: '▣' },
    { id: 'certificate', label: 'Сертификати', icon: '✔' },
    { id: 'layout', label: 'Оформление', icon: '—' },
    { id: 'legal', label: 'Правни', icon: '§' },
    { id: 'dynamic', label: 'Динамични', icon: '⚙' },
  ];

  const OBJECTS = [
    { type: 'title', category: 'text', label: 'Заглавие & титул', icon: 'T', status: 'ready', defaults: { value: 'Заглавие на отчета' } },
    { type: 'text', category: 'text', label: 'Текст', icon: '¶', status: 'ready', defaults: { value: '' } },
    { type: 'subtitle', category: 'text', label: 'Подзаглавие', icon: 'ᴛ', status: 'planned' },
    { type: 'metadata', category: 'data', label: 'Метаданни', icon: '☰', status: 'ready', defaults: { items: [{ key: 'Ключ', value: 'Стойност' }] } },
    { type: 'data-block', category: 'data', label: 'Системни данни', icon: '▤', status: 'planned' },
    { type: 'table', category: 'tables', label: 'Таблица', icon: '▦', status: 'ready', defaults: { source: 'records:1000', columns: ['name'] } },
    { type: 'hash-table', category: 'tables', label: 'Hash таблица', icon: '#', status: 'ready', defaults: { algorithms: ['SHA256'] } },
    { type: 'image', category: 'media', label: 'Изображение', icon: '▣', status: 'ready', defaults: {} },
    { type: 'qr', category: 'media', label: 'QR код', icon: '▤', status: 'ready', defaults: { value: '' } },
    { type: 'logo', category: 'media', label: 'Лого', icon: '◉', status: 'planned' },
    { type: 'signature', category: 'certificate', label: 'Подпис', icon: '✎', status: 'ready', defaults: {} },
    { type: 'certificate', category: 'certificate', label: 'Сертификат (X.509)', icon: '✔', status: 'planned' },
    { type: 'rfc3161-start', category: 'certificate', label: 'RFC 3161 START', icon: '▶', status: 'system', locked: true },
    { type: 'rfc3161-stop', category: 'certificate', label: 'RFC 3161 STOP', icon: '■', status: 'system', locked: true },
    { type: 'separator', category: 'layout', label: 'Разделител', icon: '—', status: 'ready', defaults: {} },
    { type: 'pagebreak', category: 'layout', label: 'Нова страница', icon: '⤓', status: 'planned' },
    { type: 'columns', category: 'layout', label: 'Колони', icon: '▥', status: 'planned' },
    { type: 'legal', category: 'legal', label: 'Правна декларация', icon: '§', status: 'planned' },
    { type: 'dynamic', category: 'dynamic', label: 'Динамичен блок', icon: '⚙', status: 'planned' },
  ];

  const byType = new Map(OBJECTS.map((o) => [o.type, o]));

  function get(type) {
    return byType.get(type) || null;
  }

  function byCategory(category) {
    if (!category || category === 'all') return OBJECTS.slice();
    return OBJECTS.filter((o) => o.category === category);
  }

  function ready() {
    return OBJECTS.filter((o) => o.status === 'ready');
  }

  function system() {
    return OBJECTS.filter((o) => o.status === 'system');
  }

  function planned() {
    return OBJECTS.filter((o) => o.status === 'planned');
  }

  function isReady(type) {
    const o = get(type);
    return Boolean(o && o.status === 'ready');
  }

  function label(type) {
    const o = get(type);
    return o ? o.label : String(type);
  }

  const API = { CATEGORIES, OBJECTS, get, byCategory, ready, system, planned, isReady, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof globalThis !== 'undefined') globalThis.HapiReportObjects = API;
})();
