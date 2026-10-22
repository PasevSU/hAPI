'use strict';
// Контейнер „Файлове в портала (N) · /път“ — филтри, карти на файловете и качване.
//
// Отделен модул: рисува САМО този блок. Данните (кои файлове влизат в папката) идват
// готови в `ctx`, за да няма втора логика за филтриране.
(function () {
  /** Карта на регистриран в портала файл (изобразяването не се променя). */
  function card(x, ctx) {
    const { esc, state, ICON, ico, chip, metaChips, fmtSize, fileGlyph, stateOf, actionsPane } = ctx;
    const st = stateOf(x);
    const open = state.selected === x.id;
    // ⚙ е изскачащо контекстно меню (като при папките) — отворено е най-много едно.
    const gear = state.fileGear !== null && state.fileGear === x.id;
    // Табелките показват САМО включените опции: няма табелка = опцията не е активна.
    // Затова „публичен“ (по подразбиране) не се изписва, а шифрован/заключен се виждат.
    const badges = [
      st.id === 'public' ? '' : `<span class="state-chip ${st.cls}" title="Състояние на достъпа">${esc(st.label)}</span>`,
      x.encrypted
        ? `<span class="state-chip enc" title="Шифрован (AES-256-GCM)">шифрован</span>`
        : '',
      x.locked ? `<span class="state-chip err" title="Заключен файл (без промени)">заключен</span>` : '',
    ]
      .filter(Boolean)
      .join('');
    const taxonomy = [x.topic, x.category, x.group].filter(Boolean);
    // Всички действия в менюто имат реален backend — няма „скоро“/планирани редове.
    const row = (a) =>
      `<button type="button" class="fm-gear-item ${a.id === 'delete' ? 'danger' : ''}" data-file-act="${esc(
        a.id,
      )}" data-file-id="${esc(x.id)}" role="menuitem"><span class="fm-gear-ico" aria-hidden="true">${ico(
        a.icon,
      )}</span> ${esc(a.label)}</button>`;
    const all = ctx.ACTIONS || [];
    const menu = !gear
      ? ''
      : `<div class="fm-gear fm-file-gear" data-gear-for="${esc(x.id)}" role="menu" aria-label="Опции на файла ${esc(
        x.name,
      )}">
          ${all.filter((a) => a.id !== 'delete').map(row).join('')}
          <hr class="fm-gear-sep" />
          ${all.filter((a) => a.id === 'delete').map(row).join('')}
        </div>`;
    return `<article class="fm-file ${open ? 'fm-selected' : ''}" data-id="${esc(x.id)}">
                         <div class="fm-file-head">
                           <button type="button" class="fm-pick ${state.selectedIds.has(x.id) ? 'on' : ''}" data-pick="${esc(
      x.id,
    )}" aria-pressed="${state.selectedIds.has(x.id)}" title="Избор на файл: ${esc(x.name)}" aria-label="Избор на ${esc(
      x.name,
    )}">${fileGlyph(x)}</button>
                           <div class="fm-file-title">
                             <button type="button" class="link-btn fm-file-name" data-open-file="${esc(x.id)}">${ico(
      open ? 'chevronDown' : 'chevronRight',
    )} ${esc(x.name)}</button>
                             <span class="fm-file-badges">${badges}</span>
                           </div>
                           <span class="fm-file-icons">
                             <button type="button" class="fm-ico-btn ${x.listed ? 'on' : 'off'}" data-file-listed="${esc(
      x.id,
    )}" aria-pressed="${x.listed}" title="${x.listed
        ? 'Видим в публичния каталог — щракни, за да го скриеш'
        : 'Скрит от публичния каталог — щракни, за да го покажеш'
      }">${x.listed ? ICON.eye : ICON.eyeOff}</button>
                             <button type="button" class="fm-ico-btn ${x.locked ? 'on' : 'off'}" data-file-lock="${esc(
        x.id,
      )}" aria-pressed="${Boolean(x.locked)}" title="${x.locked
        ? `Заключен${x.lockedBy ? ` (${x.lockedBy})` : ''} — щракни, за да отключиш`
        : 'Отключен — щракни, за да заключиш (без качване и изтриване)'
      }">${x.locked ? ICON.locked : ICON.unlocked}</button>
                             <button type="button" class="fm-ico-btn fm-opts ${gear ? 'on' : ''}" data-file-gear="${esc(
        x.id,
      )}" title="Опции на файла" aria-label="Опции на ${esc(
        x.name,
      )}" aria-expanded="${gear}">${ico('gear')}</button>
                           </span>
                         </div>
                         ${menu}
                         <p class="fm-file-sub">${taxonomy.length ? `${esc(taxonomy.join(' / '))} · ` : ''
      }<span title="Уникален идентификатор на файла">${ICON.id} id: <code>${esc(x.id)}</code></span></p>
                         <div class="fm-ico-row u-grid u-grid-chips">
                           ${chip(ICON.size, 'Размер', `${fmtSize(x.size)} (${x.size} B)`, fmtSize(x.size))}
                           ${chip(ICON.version, 'Версия', `${x.version}`, `v${x.version}`)}
                           ${metaChips(x)}
                         </div>
                         ${
      // Празна бележка не се изписва — редът се показва само когато има текст.
      x.notes ? `<hr class="u-divider" /><p class="fm-file-notes">${ICON.modified} ${esc(x.notes)}</p>` : ''
      }
                         ${open
        ? `<hr class="u-divider strong" />
                                <div class="fm-detail">
                                  <div class="u-row u-row-1"><button type="button" class="btn btn-sm" id="fm-back">← Затвори панела</button></div>
                                  ${actionsPane(x)}
                                </div>`
        : ''
      }
                       </article>`;
  }

  /**
   * Карта на файл, който е само на диска в папката на портала. Изглежда като
   * останалите карти (същите плочки с метаданни), но честно показва „—“ там, където
   * няма данни, докато файлът не се регистрира в портала.
   */
  function storageCard(x, ctx) {
    const { esc, ICON, chip, fmtSize, fmtDate, fileGlyph, folderFlags } = ctx;
    const dir = String(x.path || '').replace(/\/[^/]*$/, '');
    const flags = folderFlags(dir);
    const stamp = x.modifiedAt || x.createdAt || '';
    return `<article class="fm-file fm-file-storage">
                         <div class="fm-file-head">
                           <span class="fm-folder-ico" aria-hidden="true">${fileGlyph(x)}</span>
                           <div class="fm-file-title">
                             <span class="fm-file-name">${esc(x.name)}</span>
                             <span class="fm-file-badges">
                               <span class="state-chip warn" title="Файлът е само в папката на диска и не е регистриран в портала">хранилище</span>
                               <code class="fm-code" title="Политика за достъп">—</code>
                               ${flags.locked
        ? `<span class="fm-ico" title="Папката е заключена"><span class="fm-ico-g" aria-hidden="true">${ICON.locked}</span><span class="fm-ico-v">заключване</span></span>`
        : ''
      }
                             </span>
                           </div>
                         </div>
                         <p class="fm-file-sub">${ICON.folder} <code title="${esc(x.path)}">${esc(x.path)}</code></p>
                         <div class="fm-ico-row u-grid u-grid-chips">
                           ${chip(ICON.size, 'Размер', `${fmtSize(x.size)} (${x.size} B)`, fmtSize(x.size))}
                           ${chip(ICON.version, 'Версия', '—', '—')}
                           ${chip(ICON.hash, 'SHA-256', 'изчислява се при регистриране', '—')}
                           ${chip(ICON.id, 'id на файла', '—', '—')}
                           ${chip(ICON.created, 'Създаден', stamp || '—', fmtDate(stamp))}
                           ${chip(ICON.modified, 'Последна промяна', stamp || '—', fmtDate(stamp))}
                           ${chip(
        ICON.unlocked,
        'Заключване',
        flags.locked ? 'папката е заключена' : 'не е заключен',
        flags.locked ? 'заключен' : 'свободен',
      )}
                         </div>
                         <hr class="u-divider" />
                         <p class="fm-file-notes"><span class="hint">Вижда се от папката на портала; регистрирай го, за да има id, хеш, версия, действия и API.</span></p>
                         <div class="u-row u-row-1">
                           <button type="button" class="btn btn-sm btn-primary" data-register-file="${esc(x.path)}" ${flags.locked ? 'disabled' : ''} title="Регистрирай файла в портала (копира го и добавя id, SHA-256, версия и политика)">Регистрирай в портала</button>
                         </div>
                       </article>`;
  }

  /** Блок „Файлове в портала“: заглавие с икони, панел с филтри и картите на файловете. */
  function render(ctx) {
    const { esc, state, p, files, scoped, visible, scope, ICON, ico } = ctx;
    const treePath = ctx.treePath;
    const uploadForm = ctx.uploadForm;
    return `
      <section class="pf-block" data-block="files">
        <div class="pf-block-head">
          <h5>${ico('file')} Файлове в портала (${scoped.length}) · <code>${esc(treePath(scope))}</code></h5>
          <span class="fm-ico-actions">
            <button type="button" class="fm-ico-btn" data-import-folder title="Прикачи папка с файлове в ${esc(
      treePath(scope),
    )}">${ico('attachFolder')}</button>
            <button type="button" class="fm-ico-btn" data-attach-file title="Прикачи файл в ${esc(
      treePath(scope),
    )}">${ICON.upload}</button>
            <button type="button" class="fm-ico-btn ${state.filters ? 'on' : ''}" data-toggle-filters aria-expanded="${state.filters
      }" title="Панел филтри">${ICON.filters}</button>
          </span>
        </div>
        <div class="pf-block-body">
          <input type="file" id="fm-file-input" class="u-hidden" multiple />
          <input type="file" id="fm-dir-input" class="u-hidden" webkitdirectory directory multiple />
          ${state.filters
        ? `<div class="fm-toolbar">
            <input id="fm-search" placeholder="Търси по име или тема" value="${esc(state.query)}" />
            <select id="fm-type">
              ${[['all', 'Всички типове'], ['pdf', 'PDF'], ['docx', 'DOCX'], ['xlsx', 'XLSX'], ['text', 'Текст'], ['archive', 'Архив'], ['other', 'Други']]
          .map(([v, l]) => `<option value="${v}" ${state.type === v ? 'selected' : ''}>${l}</option>`)
          .join('')}
            </select>
            <select id="fm-access">
              ${[['all', 'Всички политики'], ['FREE', 'FREE'], ['KEY_REQUIRED', 'KEY_REQUIRED'], ['DISABLED', 'DISABLED']]
          .map(([v, l]) => `<option value="${v}" ${state.access === v ? 'selected' : ''}>${l}</option>`)
          .join('')}
            </select>
            <select id="fm-topic">
              ${['all', ...[...new Set(files.map((f) => f.topic).filter(Boolean))].sort()]
          .map((v) => `<option value="${esc(v)}" ${state.topic === v ? 'selected' : ''}>${esc(v === 'all' ? 'Всички теми' : v)}</option>`)
          .join('')}
            </select>
            <select id="fm-category">
              ${['all', ...[...new Set(files.map((f) => f.category).filter(Boolean))].sort()]
          .map((v) => `<option value="${esc(v)}" ${state.category === v ? 'selected' : ''}>${esc(v === 'all' ? 'Всички категории' : v)}</option>`)
          .join('')}
            </select>
            <select id="fm-sort">
              ${[['name', 'Име ↑'], ['-name', 'Име ↓'], ['size', 'Размер ↑'], ['-size', 'Размер ↓'], ['-date', 'Дата ↓']]
          .map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${l}</option>`)
          .join('')}
            </select>
            <button type="button" class="btn btn-sm btn-primary" id="fm-upload" title="Качи регистриран файл в портала (с метаданни)">Качи файл</button>
            ${state.selectedIds.size
          ? `<span class="fm-bulk">Избрани ${state.selectedIds.size}
                     <select id="fm-bulk-mode">
                       <option value="FREE">FREE</option>
                       <option value="KEY_REQUIRED">KEY_REQUIRED</option>
                       <option value="DISABLED">DISABLED</option>
                     </select>
                     <button type="button" class="btn btn-sm" id="fm-bulk-apply">Приложи</button></span>`
          : ''
        }
          </div>`
        : ''
      }
          ${state.panel === 'upload'
        ? `<div class="pf-form u-mt">${uploadForm()}</div>`
        : `<div class="fm-files-box u-mt">${scoped.length
          ? `<div class="fm-files">${visible.map((x) => (x.storage ? storageCard(x, ctx) : card(x, ctx))).join('')}</div>`
          : `<p class="hint">${scope ? `Папката ${esc(treePath(scope))} няма файлове.` : 'Порталът няма файлове. Използвай „Качи файл“.'
          }</p>`
        }</div>`
      }
        </div>
      </section>`;
  }

  window.HapiPortalFiles = { render, card, storageCard };
})();
