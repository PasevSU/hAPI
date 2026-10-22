'use strict';
// Един набор от ИКОНИ за целия интерфейс — вградени SVG (без шрифт-икони, без CDN).
//
// Защо SVG, а не емоджи: емоджи-шрифтът на всяка система рисува различно (на Windows
// 📥/📤/⬇️ изглеждат почти еднакво и цветно), а иконите тук трябва да са едноцветни,
// остри и еднакви по размер. Всички икони са 24×24, рисуват се с `currentColor`
// (наследяват цвета на текста) и се оразмеряват с `1em`, т.е. по размера на шрифта.
//
// Употреба: `ico('download')` → `<svg class="ui-ico">…</svg>`; списъкът е в `names`.
(function () {
  // Всяка икона е съдържание на <symbol> (пътища без fill — запълването идва от CSS).
  const P = {
    // ── Файлови действия ──────────────────────────────────────────────────
    preview: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    download: '<path d="M12 3.5v11"/><path d="M7.5 10L12 14.5 16.5 10"/><path d="M4.5 20h15"/>',
    versions: '<path d="M12 7v5.2l3.2 2"/><path d="M20.5 12a8.5 8.5 0 1 1-3.2-6.6"/><path d="M20.5 4.5v4.2h-4.2"/>',
    metadata: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.6"/>',
    rename: '<path d="M4 20h4.2L19 9.2 14.8 5 4 15.8z"/><path d="M13.6 6.2l4.2 4.2"/>',
    // `move` и `copy` бяха махнати заедно с бутоните „планирано“ — икона без действие е мъртъв код.
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5h-9a2 2 0 0 0-2 2v9"/>',
    // Достъп: ключ в хоризонтално положение (при малък размер не се бърка с лупа).
    access: '<circle cx="7.4" cy="12" r="3.4"/><path d="M10.8 12h9.4"/><path d="M16.6 12v3"/><path d="M19.8 12v2.2"/>',
    share: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.6 1.6"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.6-1.6"/>',
    delete: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l1 12.2a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5L17.5 7"/><path d="M10.5 11v6"/><path d="M13.5 11v6"/>',
    encrypt: '<rect x="4.6" y="10.6" width="14.8" height="9.4" rx="2"/><path d="M8.2 10.6V7.6a3.8 3.8 0 0 1 7.6 0v3"/><path d="M12 14v2.6"/>',
    package: '<path d="M12 3.2l7.8 4.4v8.8L12 20.8 4.2 16.4V7.6z"/><path d="M4.6 7.8L12 12l7.4-4.2"/><path d="M12 12v8.8"/>',
    note: '<path d="M6 3.5h8.4l4 4v13H6z"/><path d="M14.2 3.6v4h4"/><path d="M9 12h6"/><path d="M9 15.5h6"/>',
    // ── Типове файлове (заместват иконата на файла в картата) ─────────────
    file: '<path d="M6 3.4h8.2l3.8 3.8v13.4H6z"/><path d="M14 3.6v3.8h3.8"/>',
    fileText: '<path d="M6 3.4h8.2l3.8 3.8v13.4H6z"/><path d="M14 3.6v3.8h3.8"/><path d="M9 12h6"/><path d="M9 15.4h6"/>',
    filePdf: '<path d="M6 3.4h8.2l3.8 3.8v13.4H6z"/><path d="M14 3.6v3.8h3.8"/><path d="M9.2 17.6v-4.2h1.4a1.3 1.3 0 0 1 0 2.6H9.2"/><path d="M13.6 17.6v-4.2h1.6a2.1 2.1 0 0 1 0 4.2z"/>',
    fileSheet: '<path d="M6 3.4h8.2l3.8 3.8v13.4H6z"/><path d="M14 3.6v3.8h3.8"/><path d="M8.8 12.4h6.4v5.2H8.8z"/><path d="M8.8 15h6.4"/><path d="M12 12.4V17.6"/>',
    fileDoc: '<path d="M6 3.4h8.2l3.8 3.8v13.4H6z"/><path d="M14 3.6v3.8h3.8"/><path d="M9 12h6"/><path d="M9 15h4"/>',
    fileArchive: '<path d="M12 3.2l7.8 4.4v8.8L12 20.8 4.2 16.4V7.6z"/><path d="M4.6 7.8L12 12l7.4-4.2"/><path d="M12 12v8.8"/>',
    fileImage: '<rect x="3.6" y="4.8" width="16.8" height="14.4" rx="2"/><circle cx="8.8" cy="10.2" r="1.6"/><path d="M4.4 16.6l4.4-3.8 3.4 2.8 3-2.4 4.4 3.4"/>',
    // ── Флагове/състояния ────────────────────────────────────────────────
    lock: '<rect x="4.6" y="10.6" width="14.8" height="9.4" rx="2"/><path d="M8.2 10.6V7.6a3.8 3.8 0 0 1 7.6 0v3"/>',
    unlock: '<rect x="4.6" y="10.6" width="14.8" height="9.4" rx="2"/><path d="M8.2 10.6V7.6a3.8 3.8 0 0 1 7.2-1.6"/>',
    eye: '<path d="M2.6 12S6.2 6.2 12 6.2 21.4 12 21.4 12 17.8 17.8 12 17.8 2.6 12 2.6 12z"/><circle cx="12" cy="12" r="2.7"/>',
    eyeOff: '<path d="M4.2 8.4C3 9.7 2.6 12 2.6 12s3.6 5.8 9.4 5.8c1.6 0 3-.4 4.2-1"/><path d="M9.2 6.6A9.7 9.7 0 0 1 12 6.2c5.8 0 9.4 5.8 9.4 5.8a15 15 0 0 1-2.6 3.2"/><path d="M4 4l16 16"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.6v.6"/>',
    dot: '<circle cx="12" cy="12" r="3"/>',
    // ── Метаданни (плочки) ───────────────────────────────────────────────
    // Размер: стрелки в ъглите (не молив — моливът е за преименуване).
    size: '<path d="M4 20L20 4"/><path d="M4 13.5V20h6.5"/><path d="M20 10.5V4h-6.5"/>',
    hash: '<path d="M9.5 3.5L7.5 20.5"/><path d="M16.5 3.5l-2 17"/><path d="M4 8.5h16"/><path d="M3.2 15.5h16"/>',
    id: '<rect x="3.2" y="6" width="17.6" height="12" rx="2.2"/><circle cx="9" cy="12" r="2"/><path d="M14 10.4h4"/><path d="M14 13.6h4"/>',
    calendar: '<rect x="3.6" y="5.2" width="16.8" height="15" rx="2"/><path d="M8 3.4v3.4"/><path d="M16 3.4v3.4"/><path d="M3.8 10h16.4"/>',
    uploadArrow: '<path d="M12 20.5V8"/><path d="M7.5 12.5L12 8l4.5 4.5"/>',
    // ── Интерфейс ────────────────────────────────────────────────────────
    folder: '<path d="M3.2 6.6h6.2l2 2.2h9.4v10.6H3.2z"/>',
    dashboard: '<rect x="3.6" y="3.6" width="7" height="7" rx="1.4"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.4"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.4"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.4"/>',
    folderOpen: '<path d="M3.2 6.6h6.2l2 2.2h9.4v2.2"/><path d="M3.2 19.4V6.6"/><path d="M3.2 19.4l2.6-8.4h15l-2.6 8.4z"/>',
    attachFile: '<path d="M6 3.4h8.2l3.8 3.8v13.4H6z"/><path d="M14 3.6v3.8h3.8"/><path d="M12 11v5.6"/><path d="M9.4 13.4h5.2"/>',
    attachFolder: '<path d="M3.2 6.6h6.2l2 2.2h9.4v10.6H3.2z"/><path d="M12 12v4.6"/><path d="M9.7 14.3h4.6"/>',
    filter: '<path d="M3.5 4.8h17"/><path d="M6.2 10.2h11.6"/><path d="M9.4 15.6h5.2"/><path d="M11.2 19.4h1.6"/>',
    refresh: '<path d="M20.2 12a8.2 8.2 0 1 1-2.9-6.3"/><path d="M20.4 4.2v4.4h-4.4"/>',
    plus: '<path d="M12 4.6v14.8"/><path d="M4.6 12h14.8"/>',
    // Опции: два плъзгача (не cog — зъбчатото колело на малък размер изглежда като слънце).
    gear: '<path d="M4 7.5h5.5"/><path d="M14.5 7.5H20"/><circle cx="12" cy="7.5" r="2.3"/><path d="M4 16.5h9"/><path d="M17 16.5h3"/><circle cx="15" cy="16.5" r="2.3"/>',
    openWindow: '<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5l-7.6 7.6"/><path d="M18.5 14v4.5a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.5V7.1a1.6 1.6 0 0 1 1.6-1.6H10"/>',
    chevronRight: '<path d="M9.4 5.6l6.4 6.4-6.4 6.4"/>',
    chevronDown: '<path d="M5.6 9.4l6.4 6.4 6.4-6.4"/>',
    phone: '<path d="M6.4 3.6h3l1.6 4-2 1.4a11 11 0 0 0 5.6 5.6l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16.4 16.4 0 0 1 4.4 5.8a2 2 0 0 1 2-2.2z"/>',
    mail: '<rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2"/><path d="M3.8 6.6L12 13l8.2-6.4"/>',
    person: '<circle cx="12" cy="8.4" r="3.7"/><path d="M4.8 20.2c0-3.6 3.2-6.2 7.2-6.2s7.2 2.6 7.2 6.2"/>',
    case: '<path d="M3.4 8.2h17.2v10.4a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z"/><path d="M9 8.2V5.6a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 5.6v2.6"/><path d="M3.6 12.6h16.8"/>',
  };

  let injected = false;
  /** Вкарва спрайта веднъж в документа (скрито копие на всички символи). */
  function ensure() {
    if (injected || typeof document === 'undefined' || !document.body) return;
    injected = true;
    const holder = document.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    holder.className = 'ui-ico-sprite';
    holder.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${Object.keys(P)
      .map((k) => `<symbol id="ui-i-${k}" viewBox="0 0 24 24">${P[k]}</symbol>`)
      .join('')}</svg>`;
    document.body.insertBefore(holder, document.body.firstChild);
  }

  /**
   * Икона като SVG (наследява цвета и размера на шрифта).
   * @param {string} name ключ от набора; непознат ключ дава точка (без счупен layout).
   * @param {string} [extra] допълнителни CSS класове.
   */
  function ico(name, extra) {
    ensure();
    const key = P[name] ? name : 'dot';
    return `<svg class="ui-ico${extra ? ' ' + extra : ''}" aria-hidden="true" focusable="false"><use href="#ui-i-${key}"/></svg>`;
  }

  window.HapiIcons = { ico, names: Object.keys(P) };
})();
