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
    const { esc, state, ICON, ico, plural, fmtSize, fmtDate, treePath, apiMenu, folderApiUrl, folderFlags } = ctx;
    const key = node.path || '';
    const level = Number(depth) || 0;
    const open = state.tree.open === key;
    const gear = state.gear !== null && state.gear === key;
    const flags = folderFlags(key);
    const files = node.files || [];
    const subs = node.folders || [];
    const count = Number.isFinite(node.fileCount) ? node.fileCount : files.length;
    const bytes = Number(node.bytes) || files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
    const head = `<div class="fm-folder-head">
        <button type="button" class="fm-folder-tog" data-folder="${esc(key)}" aria-expanded="${open}" title="${
          open ? 'Скрий' : 'Покажи'
        } съдържанието на ${esc(treePath(key))}">
          <span class="fm-folder-ico" aria-hidden="true">${ico(open ? 'folderOpen' : 'folder')}</span>
          <span class="fm-folder-name" title="${esc(treePath(key))}">${esc(key || '/ (корен)')}</span>
          <span class="chip">${esc(plural(count, 'файл', 'файла'))}</span>
          <span class="chip">${esc(fmtSize(bytes))}</span>
          ${flags.locked ? `<span class="state-chip warn" title="Заключена папка (без качване)">${ICON.locked}</span>` : ''}
          ${flags.media ? '<span class="state-chip" title="Медийна папка">медийна</span>' : ''}
          ${flags.visible ? '' : '<span class="state-chip err" title="Скрита папка">скрита</span>'}
        </button>
        <span class="fm-folder-icons">
          <button type="button" class="fm-ico-btn" data-folder-upload="${esc(key)}" title="Добави файл в ${esc(
            treePath(key),
          )}" ${flags.locked ? 'disabled' : ''}>${ico('attachFile')}</button>
          <button type="button" class="fm-ico-btn" data-folder-pkg="${esc(key)}" title="Изтегли пакета на ${esc(
            treePath(key),
          )}">${ICON.download}</button>
          <button type="button" class="fm-ico-btn" data-folder="${esc(key)}" title="${open ? 'Скрий' : 'Разгъни'} подпапките">${ico(
            open ? 'chevronDown' : 'chevronRight',
          )}</button>
          <!-- Пряк достъп до двата флага: видима/скрита и заключена/отключена. -->
          <button type="button" class="fm-ico-btn ${flags.visible ? 'on' : 'off'}" data-folder-flag-btn="visible" data-folder-flag-path="${esc(
            key,
          )}" aria-pressed="${flags.visible}" title="${
            flags.visible
              ? 'Видима в публичния API — щракни, за да я скриеш'
              : 'Скрита от публичния API — щракни, за да я покажеш'
          }">${flags.visible ? ICON.eye : ICON.eyeOff}</button>
          <button type="button" class="fm-ico-btn ${flags.locked ? 'on' : 'off'}" data-folder-flag-btn="locked" data-folder-flag-path="${esc(
            key,
          )}" aria-pressed="${flags.locked}" title="${
            flags.locked ? 'Заключена (без качване) — щракни, за да отключиш' : 'Отключена — щракни, за да заключиш'
          }">${flags.locked ? ICON.locked : ICON.unlocked}</button>
          <button type="button" class="fm-ico-btn ${gear ? 'on' : ''}" data-folder-gear="${esc(key)}" aria-expanded="${gear}" title="Опции на папката">${ico(
            'gear',
          )}</button>
        </span>
      </div>`;
    // Падащо меню ⚙ — истинско контекстно меню: текстови редове с отметка за включен флаг.
    const gearItem = (flag, label, on) =>
      `<button type="button" class="fm-gear-item ${on ? 'on' : ''}" data-folder-flag-btn="${flag}" data-folder-flag-path="${esc(
        key,
      )}" role="menuitemcheckbox" aria-checked="${on}">${label}</button>`;
    const gearMenu = !gear
      ? ''
      : `<div class="fm-gear" data-gear-for="${esc(key)}" role="menu" aria-label="Опции на папката ${esc(treePath(key))}">
          <button type="button" class="fm-gear-item" data-folder-comment-open="${esc(key)}" role="menuitem"><span class="fm-gear-ico" aria-hidden="true">${ico(
            'note',
          )}</span> коментар</button>
          <hr class="fm-gear-sep" />
          ${gearItem('visible', 'видима', flags.visible)}
          ${gearItem('media', 'медийна', flags.media)}
          ${gearItem('locked', 'заключване', flags.locked)}
        </div>`;
    if (!open) return `<div class="fm-folder" data-depth="${level}">${head}${gearMenu}</div>`;
    const summary = files.length
      ? `<p class="hint">${plural(files.length, 'файл', 'файла')} в тази папка · ${fmtSize(
          files.reduce((sum, file) => sum + (Number(file.size) || 0), 0),
        )} — показват се в „Файлове в портала“ по-долу</p>`
      : `<p class="hint">Няма файлове директно в тази папка${subs.length ? ' (виж подпапките по-долу)' : '.'}</p>`;
    const nested = subs.length
      ? `<p class="hint">${plural(subs.length, 'подпапка', 'подпапки')}: ${subs
          .map((child) => esc(child.name))
          .join(' · ')}</p>`
      : '';
    const note = state.folderNotes[treePath(key)] || null;
    return `<div class="fm-folder open" data-depth="${level}">${head}${gearMenu}
      <div class="fm-folder-body">
        ${summary}
        ${nested}
        <div class="fm-folder-comment">
          ${
            note && note.text
              ? `<p class="fm-folder-note">${ico('note')} ${esc(note.text)}<span class="hint"> · ${esc(fmtDate(note.at))}</span></p>`
              : `<p class="hint">${ico('note')} без коментар</p>`
          }
          <div class="field">
            <label for="fm-folder-comment-${esc(key || 'root')}">Коментар към папката</label>
            <textarea id="fm-folder-comment-${esc(key || 'root')}" data-folder-comment="${esc(key)}" rows="2" maxlength="1000" placeholder="Напр. какво съдържа папката">${esc(
              note && note.text ? note.text : '',
            )}</textarea>
          </div>
          <div class="u-row u-row-2">
            <button type="button" class="btn btn-sm btn-primary" data-folder-comment-save="${esc(key)}">Запази коментара</button>
            <button type="button" class="btn btn-sm" data-folder-comment-clear="${esc(key)}">Изчисти</button>
          </div>
        </div>
        <div class="fm-folder-actions">
          ${apiMenu(folderApiUrl(key), 'api.json', 'api.json')}
          <button type="button" class="btn btn-sm" data-folder-qr="${esc(key)}" title="QR код на API-то на папката">QR</button>
        </div>
      </div>
    </div>`;
  }

  /** Блок „Папки на портала“: икони в заглавната лента + скриващи се менюта. */
  function render(ctx) {
    const { esc, state, ICON, ico, plural, fmtSize, treePath, connected } = ctx;
    const t = state.tree;
    const data = t.data && t.portalId === ctx.p.id ? t.data : null;
    const root = data && data.tree ? data.tree : null;
    const empty = Boolean(root) && !(root.files || []).length && !(root.folders || []).length;
    const parent = treePath(state.tree.open || '');
    const status = !connected()
      ? 'Демо: папките са от метаданните на файловете (тема → категория → група).'
      : t.error
        ? esc(t.error)
        : data
          ? `<code>${esc(data.storageRoot || '/share')}</code> · ${plural(data.folderCount, 'папка', 'папки')} · ${plural(
              data.fileCount,
              'файл',
              'файла',
            )} · ${fmtSize(data.bytes || 0)}${data.truncated ? ' · показани са първите 2000 записа' : ''}${
              data.exists === false ? ' · <strong>папката липсва на диска</strong>' : ''
            }`
          : 'Папките не са заредени.';
    return `
      <section class="pf-block" data-block="folders">
        <div class="pf-block-head">
          <h5>${ico('folder')} Папки на портала</h5>
          <span class="fm-ico-actions">
            <button type="button" class="fm-ico-btn" data-import-folder title="Прикачи папка с файлове в ${esc(
              treePath(state.tree.open || ''),
            )}">${ico('attachFolder')}</button>
            <button type="button" class="fm-ico-btn" id="fm-new-folder" title="Създай папка в ${esc(
              treePath(state.tree.open || ''),
            )}">${ico('plus')}</button>
            <button type="button" class="fm-ico-btn" id="fm-tree-refresh" title="Прочети папката наново от диска">${
              ICON.refresh
            }</button>
          </span>
        </div>
        <div class="pf-block-body">
          <p class="hint">${status}</p>
          ${
            state.newFolder
              ? `<form class="pf-form u-mb" id="fm-new-folder-form">
                   <div class="field"><label>Име на новата папка (в <code>${esc(parent)}</code>)</label>
                     <input id="fm-new-folder-name" maxlength="100" placeholder="напр. Доказателства" autocomplete="off" />
                   </div>
                   <div class="u-row u-row-2">
                     <button type="submit" class="btn btn-sm btn-primary">Създай</button>
                     <button type="button" class="btn btn-sm" id="fm-new-folder-cancel">Отказ</button>
                   </div>
                 </form>`
              : ''
          }
          <div class="fm-folders-box">
            <div class="fm-folders">${
              !root
                ? `<p class="hint">${t.error ? 'Папките не са заредени.' : 'Зареждане на папките…'}</p>`
                : empty
                  ? `<p class="hint">${connected() ? 'Папката е празна или липсва.' : 'Няма папки в демо данните.'}</p>`
                  : folderMenus(root)
                      .map((node) => folderMenu(node, (node.path || '').split('/').filter(Boolean).length, ctx))
                      .join('')
            }</div>
          </div>
        </div>
      </section>`;
  }

  window.HapiPortalFolders = { render, folderMenus, folderMenu };
})();
