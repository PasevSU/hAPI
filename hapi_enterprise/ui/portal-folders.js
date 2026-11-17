'use strict';
// Контейнер „Папки на портала“ — експлорер на storage_root: скриващи се менюта.
//
// Отделен модул: рисува САМО този блок. Помощните функции идват в `ctx`.
(function () {
  /** Всички папки в дървото като ПЛОСЪК списък (коренът е пръв). */
  function folderMenus(root) {
    const out = [root];
    const walk = (node) => {
      for (const child of node.folders || []) {
        out.push(child);
        walk(child);
      }
    };
    walk(root);
    return out;
  }

  /**
   * Едно скриващо се меню на папка: икона, име, брой файлове и общ обем.
   * Отворена е най-много една папка — `state.tree.open` пази нейния път.
   * Файловете вътре се изписват в „Файлове в портала“ с пълния си път.
   */
  function folderMenu(node, depth, ctx) {
    const { esc, state, ICON, ico, plural, fmtSize, fmtDate, treePath, apiMenu, folderApiUrl, folderFlags, T } = ctx;
    const key = node.path || '';
    const level = Number(depth) || 0;
    const open = state.tree.open === key;
    const gear = state.gear !== null && state.gear === key;
    const flags = folderFlags(key);
    const files = node.files || [];
    const subs = node.folders || [];
    const count = Number.isFinite(node.fileCount) ? node.fileCount : files.length;
    const bytes = Number(node.bytes) || files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    // Пътят и съществителните минават през речника: иначе преводът спира на рамката.
    const path = treePath(key);
    const filesOf = (n) => plural(n, T('noun.file.one'), T('noun.file.many'));
    const subsOf = (n) => plural(n, T('noun.subfolder.one'), T('noun.subfolder.many'));
    const head = `<div class="fm-folder-head">
        <button type="button" class="fm-folder-tog" data-folder="${esc(key)}" aria-expanded="${open}" title="${esc(
        open ? T('pf.head.hide', { path }) : T('pf.head.show', { path }),
      )}">
          <span class="fm-folder-ico" aria-hidden="true">${ico(open ? 'folderOpen' : 'folder')}</span>
          <span class="fm-folder-name" title="${esc(path)}">${esc(key || '/ (' + T('pf.root') + ')')}</span>
          <span class="chip">${esc(filesOf(count))}</span>
          <span class="chip">${esc(fmtSize(bytes))}</span>
          ${flags.locked ? `<span class="state-chip warn" title="${esc(T('pf.chip.locked'))}">${ICON.locked}</span>` : ''}
          ${flags.media ? `<span class="state-chip" title="${esc(T('pf.chip.media'))}">${esc(T('pf.media'))}</span>` : ''}
          ${flags.visible ? '' : `<span class="state-chip err" title="${esc(T('pf.chip.hidden'))}">${esc(T('pf.hidden'))}</span>`}
        </button>
        <span class="fm-folder-icons">
          <button type="button" class="fm-ico-btn" data-folder-upload="${esc(key)}" title="${esc(
        T('pf.upload', { path }),
      )}" ${flags.locked ? 'disabled' : ''}>${ico('attachFile')}</button>
          <button type="button" class="fm-ico-btn" data-folder-pkg="${esc(key)}" title="${esc(
        T('pf.package', { path }),
      )}">${ICON.download}</button>
          <button type="button" class="fm-ico-btn" data-folder-qr="${esc(key)}" title="${esc(T('qr.perLevel'))}" aria-label="${esc(
        T('qr.perLevelAlt', { name: key || T('pf.root') }),
      )}">${ico('qr')}</button>
          <button type="button" class="fm-ico-btn" data-folder="${esc(key)}" title="${esc(
        open ? T('pf.subs.collapse') : T('pf.subs.expand'),
      )}">${ico(open ? 'chevronDown' : 'chevronRight')}</button>
          <!-- Пряк достъп до двата флага: видима/скрита и заключена/отключена. -->
          <button type="button" class="fm-ico-btn ${flags.visible ? 'on' : 'off'}" data-folder-flag-btn="visible" data-folder-flag-path="${esc(
        key,
      )}" aria-pressed="${flags.visible}" title="${esc(
        flags.visible ? T('pf.visible.on') : T('pf.visible.off'),
      )}">${flags.visible ? ICON.eye : ICON.eyeOff}</button>
          <button type="button" class="fm-ico-btn ${flags.locked ? 'on' : 'off'}" data-folder-flag-btn="locked" data-folder-flag-path="${esc(
        key,
      )}" aria-pressed="${flags.locked}" title="${esc(
        flags.locked ? T('pf.lock.on') : T('pf.lock.off'),
      )}">${flags.locked ? ICON.locked : ICON.unlocked}</button>
          <button type="button" class="fm-ico-btn" data-report-folder="${esc(
        key,
      )}" title="${esc(T('pc.report.folder.title', { path }))}" aria-label="${esc(
        T('pc.report.folder.title', { path }),
      )}">${ico('download')}</button>
          <button type="button" class="fm-ico-btn ${gear ? 'on' : ''}" data-folder-gear="${esc(key)}" aria-expanded="${gear}" title="${esc(
        T('pf.gear'),
      )}">${ico('gear')}</button>
        </span>
      </div>`;
    // Падащо меню ⚙ — истинско контекстно меню: текстови редове с отметка за включен флаг.
    const gearItem = (flag, label, on) =>
      `<button type="button" class="fm-gear-item ${on ? 'on' : ''}" data-folder-flag-btn="${flag}" data-folder-flag-path="${esc(
        key,
      )}" role="menuitemcheckbox" aria-checked="${on}">${label}</button>`;
    const gearMenu = !gear
      ? ''
      : `<div class="fm-gear" data-gear-for="${esc(key)}" role="menu" aria-label="${esc(
        T('pf.gearFor', { path }),
      )}">
          <button type="button" class="fm-gear-item" data-folder-comment-open="${esc(key)}" role="menuitem"><span class="fm-gear-ico" aria-hidden="true">${ico(
        'note',
      )}</span> ${esc(T('pf.gear.comment'))}</button>
          <hr class="fm-gear-sep" />
          ${gearItem('visible', T('pf.flag.visible'), flags.visible)}
          ${gearItem('media', T('pf.flag.media'), flags.media)}
          ${gearItem('locked', T('pf.flag.locked'), flags.locked)}
          ${key
        ? `<hr class="fm-gear-sep" />
          <button type="button" class="fm-gear-item fm-gear-danger" data-folder-delete="${esc(key)}" role="menuitem"><span class="fm-gear-ico" aria-hidden="true">✕</span> ${esc(
          T('pf.delete'),
        )}</button>`
        : ''}
        </div>`;
    if (!open) return `<div class="fm-folder" data-depth="${level}">${head}${gearMenu}</div>`;
    const summary = files.length
      ? `<p class="hint">${esc(
        T('pf.filesInside', {
          count: filesOf(files.length),
          size: fmtSize(files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)),
        }),
      )}</p>`
      : `<p class="hint">${esc(subs.length ? T('pf.empty.withSubs') : T('pf.empty'))}</p>`;
    const nested = subs.length
      ? `<p class="hint">${esc(subsOf(subs.length))}: ${subs
        .map((child) => esc(child.name))
        .join(' · ')}</p>`
      : '';
    const note = state.folderNotes[treePath(key)] || null;
    return `<div class="fm-folder open" data-depth="${level}">${head}${gearMenu}
      <div class="fm-folder-body">
        ${summary}
        ${nested}
        <div class="fm-folder-comment">
          ${note && note.text
        ? `<p class="fm-folder-note">${ico('note')} ${esc(note.text)}<span class="hint"> · ${esc(fmtDate(note.at))}</span></p>`
        : `<p class="hint">${ico('note')} ${esc(T('pf.note.none'))}</p>`
      }
          <div class="field">
            <label for="fm-folder-comment-${esc(key || 'root')}">${esc(T('pf.comment.label'))}</label>
            <textarea id="fm-folder-comment-${esc(key || 'root')}" data-folder-comment="${esc(key)}" rows="2" maxlength="1000" placeholder="${esc(
        T('pf.comment.placeholder'),
      )}">${esc(
        note && note.text ? note.text : '',
      )}</textarea>
          </div>
          <div class="u-row u-row-2">
            <button type="button" class="btn btn-sm btn-primary" data-folder-comment-save="${esc(key)}">${esc(
        T('pf.comment.save'),
      )}</button>
            <button type="button" class="btn btn-sm" data-folder-comment-clear="${esc(key)}">${esc(
        T('pf.comment.clear'),
      )}</button>
          </div>
        </div>
        <div class="fm-folder-actions">
          ${apiMenu(folderApiUrl(key), 'api.json', 'api.json')}
        </div>
      </div>
    </div>`;
  }

  /** Блок „Папки на портала“: икони в заглавната лента + скриващи се менюта. */
  function render(ctx) {
    const { esc, state, ICON, ico, plural, fmtSize, treePath, connected, T } = ctx;    const t = state.tree;
    const data = t.data && t.portalId === ctx.p.id ? t.data : null;
    const root = data && data.tree ? data.tree : null;
    const empty = Boolean(root) && !(root.files || []).length && !(root.folders || []).length;
    const parent = treePath(state.tree.open || '');
    // Блокът е СГЪНАТ по подразбиране (както всички блокове на портала).
    const open = state.foldersOpen === true;
    const status = !connected()
      ? T('pf.demo')
      : t.error
        ? esc(t.error)
        : data
          ? `<code>${esc(data.storageRoot || '/share')}</code> · ${plural(
            data.folderCount,
            T('noun.folder.one'),
            T('noun.folder.many'),
          )} · ${plural(data.fileCount, T('noun.file.one'), T('noun.file.many'))} · ${fmtSize(data.bytes || 0)}${data.truncated ? esc(T('pf.truncated')) : ''
          }${data.exists === false ? ' · <strong>' + esc(T('pf.onDisk.missing').trim()) + '</strong>' : ''}`
          : T('pf.notLoaded');
    // QR кодът за всяко ниво (корен, папка, файл) вече НЕ е отделна мрежа в този блок: той
    // живее в ГЛОБАЛНОТО QR студио (`qr-studio.js`), което се отваря от брошката в главата на
    // портала — заедно с обикновения код, „само за преглед“ и временната връзка. Тук остава
    // само дървото: едно място за едно нещо (`ctx.qrLevel` се ползва от прозореца, не от блока).
    const qrMap = '';
    return `
      <section class="pf-block ${open ? '' : 'pf-collapsed'}" data-block="folders">
        <div class="pf-block-head">
          <h5><button type="button" class="link-btn pf-block-tog" data-pf-folders-tog aria-expanded="${open}" ${open ? 'aria-controls="pf-folders-body"' : ''} title="${esc(
        open ? T('pf.toggle.collapse') : T('pf.toggle.expand'),
      )}">${ico(open ? 'chevronDown' : 'chevronRight')} ${ico('folder')} ${esc(T('pf.title'))}</button></h5>
          ${open ? `<span class="fm-ico-actions">
            <button type="button" class="fm-ico-btn" data-import-folder title="${esc(
        T('pf.import', { path: treePath(state.tree.open || '') }),
      )}">${ico('attachFolder')}</button>
            <button type="button" class="fm-ico-btn" id="fm-new-folder" title="${esc(
        T('pf.newFolder', { path: treePath(state.tree.open || '') }),
      )}">${ico('plus')}</button>
            <button type="button" class="fm-ico-btn" id="fm-tree-refresh" title="${esc(T('pf.refresh'))}">${ICON.refresh
        }</button>
          </span>` : ''}
        </div>
        ${open ? `<div class="pf-block-body" id="pf-folders-body">
          <p class="hint">${status}</p>
          <label class="fm-publish" title="${esc(T('portal.upload.overwriteTitle'))}"><input type="checkbox" id="fm-overwrite" /><span aria-hidden="true">${esc(
        T('portal.upload.overwrite'),
      )}</span></label>
          ${state.newFolder
          ? `<form class="pf-form u-mb" id="fm-new-folder-form">
                   <div class="field"><label>${esc(T('pf.newFolder.label', { path: parent }))}</label>
                     <input id="fm-new-folder-name" maxlength="100" placeholder="${esc(
            T('pf.newFolder.placeholder'),
          )}" autocomplete="off" />
                   </div>
                   <div class="u-row u-row-2">
                     <button type="submit" class="btn btn-sm btn-primary">${esc(T('pf.newFolder.create'))}</button>
                     <button type="button" class="btn btn-sm" id="fm-new-folder-cancel">${esc(
            T('pf.newFolder.cancel'),
          )}</button>
                   </div>
                 </form>`
          : ''
        }
          <div class="fm-folders-box">
            ${qrMap}
            <div class="fm-folders">${!root
          ? `<p class="hint">${t.error ? esc(T('pf.notLoaded')) : esc(T('pf.loading'))}</p>`
          : empty
            ? `<p class="hint">${connected() ? esc(T('pf.emptyOrMissing')) : esc(T('pf.demo.none'))}</p>`
            : folderMenus(root)
              .map((node) => folderMenu(node, (node.path || '').split('/').filter(Boolean).length, ctx))
              .join('')
        }</div>
          </div>
        </div>` : ''}
      </section>`;
  }

  window.HapiPortalFolders = { render, folderMenus, folderMenu };
})();
