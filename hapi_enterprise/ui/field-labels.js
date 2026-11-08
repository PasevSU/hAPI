/* Етикети на полетата — едно място, след всеки рендер (DEF-38).
 *
 * Проблемът: панелите рисуват `<div class="field"><label>Тема</label><input …></div>`.
 * Визуално е наред, но екранният четец не знае име на полето: няма `for`/`id` и няма
 * обвиващ `<label>`. Дебъгинг инструментът го показва като нарушен закон `named` (9 полета).
 *
 * Защо централизирано, а не `id` по 109 места: `id`-та трябва да са уникални в ЦЯЛАТА
 * страница, а панелите се рисуват многократно и паралелно. Затова всяко поле получава
 * генериран `id` при показване, а етикетът до него — `for` към него. Правилото се прилага
 * след всеки рендер (наблюдател в `app.js`), тоест нов панел го получава без да знае.
 *
 * Никакви зависимости: файлът се зарежда и в браузъра, и в тестовете (vm).
 */
(function (root) {
  'use strict';
  let counter = 0;

  /** Свободно `id` за поле: `fld-<n>`, което още не съществува в документа. */
  function nextId(doc) {
    let id;
    do {
      counter += 1;
      id = 'fld-' + counter;
    } while (doc && typeof doc.getElementById === 'function' && doc.getElementById(id));
    return id;
  }

  /** Има ли полето вече име за екранен четец? */
  function hasName(control) {
    if (!control.getAttribute) return true;
    if (control.getAttribute('aria-label')) return true;
    if (control.getAttribute('aria-labelledby')) return true;
    if (control.getAttribute('title')) return true;
    return false;
  }

  /**
   * Свързва етикетите с полетата в подадения корен.
   * @param {Document|Element} scope
   * @returns {{bound: number, unnamed: string[]}} колко е свързал и кои полета остават без име
   */
  function bind(scope) {
    const doc = (scope && scope.ownerDocument) || scope;
    const controls = scope && typeof scope.querySelectorAll === 'function'
      ? scope.querySelectorAll('.field input, .field select, .field textarea')
      : [];
    let bound = 0;
    const unnamed = [];
    for (const control of controls) {
      if (hasName(control)) continue;
      const wrap = typeof control.closest === 'function' ? control.closest('.field') : null;
      const label = wrap && typeof wrap.querySelector === 'function' ? wrap.querySelector('label') : null;
      // Вече свързано (втори рендер/втори пуск) — не се брои пак и не се пипа.
      if (label && control.id && label.getAttribute('for') === control.id) continue;
      if (!label) {
        // Няма етикет до полето — остава за ръчна проверка, но се връща, за да се види.
        unnamed.push(control.getAttribute('name') || control.getAttribute('id') || '(unnamed)');
        continue;
      }
      if (!control.id) control.id = nextId(doc);
      if (label.getAttribute('for') !== control.id) label.setAttribute('for', control.id);
      bound += 1;
    }
    return { bound, unnamed };
  }

  const api = { bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HapiFieldLabels = api;
})(typeof window !== 'undefined' ? window : null);
