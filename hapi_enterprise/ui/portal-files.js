'use strict';
// Контейнер „Файлове в портала (N) · /път“ — филтри, карти на файловете и качване.
//
// Отделен модул: рисува САМО този блок. Данните (кои файлове влизат в папката) идват
// готови в `ctx`, за да няма втора логика за филтриране.
(function () {
  /** Карта на регистриран в портала файл (изобразяването не се променя). */
  function card(x, ctx) {
    // `chip` и `fmtSize` се ползват само от картата на файл в хранилището — тук плочките
    // с метаданни са махнати (живеят в „Пълни данни“), затова не се дърпат в този обхват.
    const { esc, state, ICON, ico, fileGlyph, stateOf, actionsPane, T } = ctx;
    const st = stateOf(x);
    const open = state.selected === x.id;
    // ⚙ е изскачащо контекстно меню (както при папките) — отворено е най-много едно.
    const gear = state.fileGear !== null && state.fileGear === x.id;
    // Табелките показват САМО включените опции: няма табелка = опцията не е активна.
    // Затова „публичен“ (по подразбиране) не се изписва, а шифрован/заключен се виждат.
    // Скритият файл носи обяснение в подсказката — иначе човек не разбира защо го няма
    // на страницата, към която води QR кодът (`portal.files.hiddenTitle`).
    const stateTitle = st.id === 'hidden' ? T('portal.files.hiddenTitle') : T('portal.fileState.title');
    const badges = [
      st.id === 'public' ? '' : `<span class="state-chip ${st.cls}" title="${esc(stateTitle)}">${esc(st.label)}</span>`,
      x.encrypted
        ? `<span class="state-chip enc" title="${esc(T('pfl.enc.title'))}">${esc(T('pfl.enc'))}</span>`
        : '',
      x.locked ? `<span class="state-chip err" title="${esc(T('pfl.locked.title'))}">${esc(T('pfl.locked'))}</span>` : '',
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
      : `<div class="fm-gear fm-file-gear" data-gear-for="${esc(x.id)}" role="menu" aria-label="${esc(
        T('pfl.gear.alt', { name: x.name }),
      )}">
          ${all.filter((a) => a.id !== 'delete').map(row).join('')}
          <hr class="fm-gear-sep" />
          ${all.filter((a) => a.id === 'delete').map(row).join('')}
        </div>`;
    // Плочките с метаданни (размер, версия, дати, хеш, ID, достъп) са махнати от реда:
    // същото стои в „Пълни данни“ на отворения файл, а тук повтаряше целия ред и избутваше
    // името. Иконата на типа е преместена вдясно, при останалите икони; изборът за групови
    // действия е обикновен чекбокс в началото на реда.
    return `<article class="fm-file ${open ? 'fm-selected' : ''}" data-id="${esc(x.id)}">
                         <div class="fm-file-head">
                           <input type="checkbox" class="fm-file-check" data-pick="${esc(x.id)}" ${state.selectedIds.has(x.id) ? 'checked' : ''
      } aria-label="${esc(T('pfl.pick.alt', { name: x.name }))}" title="${esc(T('pfl.pick.title', { name: x.name }))}" />
                           <div class="fm-file-title">
                             <button type="button" class="link-btn fm-file-name" data-open-file="${esc(x.id)}">${ico(
      open ? 'chevronDown' : 'chevronRight',
    )} ${esc(x.name)}</button>
                             <span class="fm-file-badges">${badges}</span>
                           </div>
                           <span class="fm-file-icons">
                             <span class="fm-file-ico" aria-hidden="true" title="${esc(
      T('pfl.type.title', { name: x.name }),
    )}">${fileGlyph(x)}</span>
                             ${/* „обяви“: чекбоксът обявява файла в портала — тогава той се вижда на
                                  страницата, към която води QR кодът. Същият флаг `listed`, който
                                  пази и публичният API (скрит файл → 404). */ ''}
                             <label class="fm-publish" title="${x.listed
      ? esc(T('pfl.listed.on.title'))
      : esc(T('pfl.listed.off.title'))
      }"><input type="checkbox" data-file-listed="${esc(x.id)}" ${x.listed ? 'checked' : ''
      } aria-label="${esc(T('pfl.listed.alt', { name: x.name }))}" /><span aria-hidden="true">${esc(T('pfl.listed.label'))}</span></label>
                             <button type="button" class="fm-ico-btn ${x.locked ? 'on' : 'off'}" data-file-lock="${esc(
        x.id,
      )}" aria-pressed="${Boolean(x.locked)}" title="${x.locked
        ? esc(T('pfl.lock.on.title', { by: x.lockedBy ? ` (${x.lockedBy})` : '' }))
        : esc(T('pfl.lock.off.title'))
      }">${x.locked ? ICON.locked : ICON.unlocked}</button>
                             ${/* QR за ТОЗИ файл: отваря глобалното студио направо на неговото ниво.
                                  Без записан път кодът за файл не съществува — тогава бутонът липсва. */ ''}
                             ${x.storagePath
        ? `<button type="button" class="fm-ico-btn" data-file-qr="${esc(x.storagePath)}" title="${esc(
            T('qr.perLevel'),
          )}" aria-label="${esc(T('qr.perLevelAlt', { name: x.name }))}">${ico('qr')}</button>`
        : ''
      }
                             <button type="button" class="fm-ico-btn fm-opts ${gear ? 'on' : ''}" data-file-gear="${esc(
        x.id,
      )}" title="${esc(T('pfl.gear.title'))}" aria-label="${esc(
        T('pfl.gear.alt', { name: x.name }),
      )}" aria-expanded="${gear}">${ico('gear')}</button>
                           </span>
                         </div>
                         ${menu}
                         <p class="fm-file-sub">${taxonomy.length ? `${esc(taxonomy.join(' / '))} · ` : ''
      }<span title="${esc(T('pfl.id.title'))}">${ICON.id} id: <code>${esc(x.id)}</code></span></p>
                         ${
      // Празна бележка не се изписва — редът се показва само когато има текст.
      x.notes ? `<hr class="u-divider" /><p class="fm-file-notes">${ICON.modified} ${esc(x.notes)}</p>` : ''
      }
                         ${open
        ? `<hr class="u-divider strong" />
                                <div class="fm-detail">
                                  <div class="u-row u-row-1"><button type="button" class="btn btn-sm" id="fm-back">← ${esc(T('pfl.close'))}</button></div>
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
    const { esc, ICON, chip, fmtSize, fmtDate, fileGlyph, folderFlags, T } = ctx;
    const dir = String(x.path || '').replace(/\/[^/]*$/, '');
    const flags = folderFlags(dir);
    const stamp = x.modifiedAt || x.createdAt || '';
    return `<article class="fm-file fm-file-storage">
                         <div class="fm-file-head">
                           <input type="checkbox" class="fm-file-check" data-pick-storage="${esc(x.path)}"
                             aria-label="${esc(T('portal.reg.pickAlt', { name: x.name }))}" title="${esc(T('portal.reg.pickAlt', { name: x.name }))}" />
                           <span class="fm-folder-ico" aria-hidden="true">${fileGlyph(x)}</span>
                           <div class="fm-file-title">
                             <span class="fm-file-name">${esc(x.name)}</span>
                             <span class="fm-file-badges">
                               <span class="state-chip warn" title="${esc(T('pfl.storage.chip.title'))}">${esc(T('pfl.storage.chip'))}</span>
                               <code class="fm-code" title="${esc(T('pfl.policy.title'))}">—</code>
                               ${flags.locked
        ? `<span class="fm-ico" title="${esc(T('pfl.folderLocked.title'))}"><span class="fm-ico-g" aria-hidden="true">${ICON.locked}</span><span class="fm-ico-v">${esc(T('pfl.folderLocked'))}</span></span>`
        : ''
      }
                             </span>
                           </div>
                         </div>
                         <p class="fm-file-sub">${ICON.folder} <code title="${esc(x.path)}">${esc(x.path)}</code></p>
                         <div class="fm-ico-row u-grid u-grid-chips">
                           ${chip(ICON.size, T('pfl.chip.size'), `${fmtSize(x.size)} (${x.size} B)`, fmtSize(x.size))}
                           ${chip(ICON.version, T('pfl.chip.version'), '—', '—')}
                           ${chip(ICON.hash, 'SHA-256', T('pfl.chip.sha.note'), '—')}
                           ${chip(ICON.id, T('pfl.chip.id'), '—', '—')}
                           ${chip(ICON.created, T('pfl.chip.created'), stamp || '—', fmtDate(stamp))}
                           ${chip(ICON.modified, T('pfl.chip.modified'), stamp || '—', fmtDate(stamp))}
                           ${chip(
        ICON.unlocked,
        T('pfl.chip.lock'),
        flags.locked ? T('pfl.chip.lock.folder') : T('pfl.chip.lock.off'),
        flags.locked ? T('pfl.chip.lock.locked') : T('pfl.chip.lock.free'),
      )}
                         </div>
                         <hr class="u-divider" />
                         <p class="fm-file-notes"><span class="hint">${esc(T('pfl.storageNote'))}</span></p>
                         <div class="u-row u-row-1">
                           <button type="button" class="btn btn-sm btn-primary" data-register-file="${esc(x.path)}" ${flags.locked ? 'disabled' : ''} title="${esc(T('pfl.register.title'))}">${esc(T('pfl.register'))}</button>
                         </div>
                       </article>`;
  }

  /** Блок „Файлове в портала“: заглавие с икони, панел с филтри и картите на файловете. */
  function render(ctx) {
    const { esc, state, p, files, scoped, visible, scope, ICON, ico, T } = ctx;
    const treePath = ctx.treePath;
    const uploadForm = ctx.uploadForm;
    // Блокът е СГЪНАТ по подразбиране (както всички блокове на портала).
    const open = state.filesOpen === true;
    return `
      <section class="pf-block ${open ? '' : 'pf-collapsed'}" data-block="files">
        <div class="pf-block-head">
          <h5><button type="button" class="link-btn pf-block-tog" data-pf-files-tog aria-expanded="${open}" ${open ? 'aria-controls="pf-files-body"' : ''} title="${esc(
        T('pfl.toggle.title', { action: open ? T('pfl.toggle.collapse') : T('pfl.toggle.expand') }),
      )}">${ico(open ? 'chevronDown' : 'chevronRight')} ${ico('file')} ${esc(T('pfl.title', { n: scoped.length }))} · <code>${esc(treePath(scope))}</code></button></h5>
          ${open ? `<span class="fm-ico-actions">
            <button type="button" class="fm-ico-btn" data-register-folder title="${esc(T('portal.reg.allTitle', { where: treePath(scope) }))}">${ico('file')} <span class="fm-ico-label">${esc(T('portal.reg.allLabel'))}</span></button>
            <button type="button" class="fm-ico-btn" data-import-folder title="${esc(
        T('pfl.importFolder.title', { where: treePath(scope) }),
      )}">${ico('attachFolder')} <span class="fm-ico-label">${esc(T('pfl.importFolder'))}</span></button>
            <button type="button" class="fm-ico-btn" data-attach-file title="${esc(
        T('pfl.attach.title', { where: treePath(scope) }),
      )}">${ICON.upload} <span class="fm-ico-label">${esc(T('pfl.attach'))}</span></button>
            <button type="button" class="fm-ico-btn ${state.filters ? 'on' : ''}" data-toggle-filters aria-expanded="${state.filters
        }" title="${esc(T('pfl.filters.title'))}">${ICON.filters}</button>
          </span>` : ''}
        </div>
        ${open ? `<div class="pf-block-body" id="pf-files-body">
          ${state.filters
          ? `<div class="fm-toolbar">
            <input id="fm-search" placeholder="${esc(T('pfl.search'))}" value="${esc(state.query)}" />
            <select id="fm-type">
              ${[['all', T('pfl.type.all')], ['pdf', 'PDF'], ['docx', 'DOCX'], ['xlsx', 'XLSX'], ['text', T('pfl.type.text')], ['archive', T('pfl.type.archive')], ['other', T('pfl.type.other')]]
            .map(([v, l]) => `<option value="${v}" ${state.type === v ? 'selected' : ''}>${esc(l)}</option>`)
            .join('')}
            </select>
            <select id="fm-access">
              ${[['all', T('pfl.access.all')], ['FREE', 'FREE'], ['KEY_REQUIRED', 'KEY_REQUIRED'], ['DISABLED', 'DISABLED']]
            .map(([v, l]) => `<option value="${v}" ${state.access === v ? 'selected' : ''}>${esc(l)}</option>`)
            .join('')}
            </select>
            <select id="fm-topic">
              ${['all', ...[...new Set(files.map((f) => f.topic).filter(Boolean))].sort()]
            .map((v) => `<option value="${esc(v)}" ${state.topic === v ? 'selected' : ''}>${esc(v === 'all' ? T('pfl.topic.all') : v)}</option>`)
            .join('')}
            </select>
            <select id="fm-category">
              ${['all', ...[...new Set(files.map((f) => f.category).filter(Boolean))].sort()]
            .map((v) => `<option value="${esc(v)}" ${state.category === v ? 'selected' : ''}>${esc(v === 'all' ? T('pfl.category.all') : v)}</option>`)
            .join('')}
            </select>
            <select id="fm-sort">
              ${[['name', T('pfl.sort.nameAsc')], ['-name', T('pfl.sort.nameDesc')], ['size', T('pfl.sort.sizeAsc')], ['-size', T('pfl.sort.sizeDesc')], ['-date', T('pfl.sort.dateDesc')]]
            .map(([v, l]) => `<option value="${v}" ${state.sort === v ? 'selected' : ''}>${esc(l)}</option>`)
            .join('')}
            </select>
            <button type="button" class="btn btn-sm btn-primary" id="fm-upload" title="${esc(T('pfl.upload.title'))}">${esc(T('pfl.upload'))}</button>
            ${state.selectedIds.size
            ? `<span class="fm-bulk">${esc(T('pfl.bulk.selected', { n: state.selectedIds.size }))}
                     <select id="fm-bulk-mode">
                       <option value="FREE">FREE</option>
                       <option value="KEY_REQUIRED">KEY_REQUIRED</option>
                       <option value="DISABLED">DISABLED</option>
                     </select>
                     <button type="button" class="btn btn-sm" id="fm-bulk-apply">${esc(T('pfl.bulk.apply'))}</button></span>`
            : ''
          }
          </div>`
          : ''
        }
          ${state.panel === 'upload'
          ? `<div class="pf-form u-mt">${uploadForm()}</div>`
          : `<div class="fm-files-box u-mt">${scoped.length
            ? `<div class="fm-files">${visible.map((x) => (x.storage ? storageCard(x, ctx) : card(x, ctx))).join('')}</div>`
            : `<p class="hint">${scope
              ? esc(T('pfl.empty.folder', { where: treePath(scope) }))
              : esc(T('pfl.empty.portal'))
            }</p>`
          }</div>`
        }
        </div>` : ''}
      </section>`;
  }

  window.HapiPortalFiles = { render, card, storageCard };
})();
