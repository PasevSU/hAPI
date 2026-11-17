'use strict';
// Контейнер „Контролен панел на портала“ — настройки на портала и API/QR.
//
// Отделен модул: рисува САМО този блок. Всичко, което му трябва, идва в `ctx`
// (състояние и помощни функции), за да не зависи от вътрешностите на files-manager.js.
(function () {
  /**
   * ФУНКЦИИТЕ НА ПОРТАЛА — един обект, а не шест бутона по блокове.
   *
   * Всяка функция носи `id` (същият, който беше на бутона без `pf-`), икона от йерархията
   * (`ui/icons-v4-map.json`, спрайт v4), резервна икона от вградения набор (ако спрайтът не се
   * зареди) и област. Панелът рисува от ТОЗИ списък, а `files-manager.js` вързва обработчик по
   * същия `id` — така списък и изпълнение не се разминават.
   *
   * Всеки ред е избираем за общото изпълнение по чекбоксове. Ред, за който `files-manager.js`
   * не е вързал обработчик (`bindFn`), се показва ЗАБРАНЕН, а не мъртъв.
   */
  const FUNCTIONS = [
    // Сигурност: ключ за подпис, проверка на цялостта (синхронна и фонова).
    { id: 'rotate-key', area: 'security', label: 'pc.rotate', title: 'pc.rotate.title', icon: 'key', fallback: 'lock' },
    { id: 'integrity', area: 'security', label: 'pc.integrity', title: 'pc.integrity.title', icon: 'hash-verify', fallback: 'hash' },
    { id: 'integrity-job', area: 'security', label: 'pc.integrityJob', title: 'pc.integrityJob.title', icon: 'audit', fallback: 'shield' },
    // Достъп: издаване на връзка с токен и списък на издадените.
    { id: 'token-new', area: 'access', label: 'pc.token.new', icon: 'public', fallback: 'eye' },
    { id: 'token-list', area: 'access', label: 'pc.token.list', icon: 'history', fallback: 'clock' },
    // QR: показване, архив, сверка на архивите, прекратяване и връщане на състояние.
    { id: 'qr-show', area: 'qr', label: 'pc.qr.show', icon: 'qr', fallback: 'qr' },
    { id: 'qr-archive', area: 'qr', label: 'pc.qr.archive', icon: 'archive', fallback: 'archive' },
    { id: 'qr-verify', area: 'qr', label: 'pc.qr.verify', icon: 'archive-verify', fallback: 'hash' },
    { id: 'qr-block', area: 'qr', label: 'pc.qr.block', icon: 'qr-revoke', fallback: 'lock' },
    { id: 'qr-restore', area: 'qr', label: 'pc.qr.restore', icon: 'restore', fallback: 'refresh' },
    // Настройки: сверка на `files[]` с диска.
    { id: 'config-verify', area: 'config', label: 'pc.options.verify', icon: 'manifest', fallback: 'id' },
  ];

  /**
   * Един ред от обекта: чекбокс за общо изпълнение · място за състоянието · бутонът на самата
   * функция (икона + име) · параметър, ако функцията иска такъв.
   *
   * Защо и чекбокс, и бутон: бутонът изпълнява точно тази функция (както досега, с клавиатура и
   * Enter), а чекбоксът я включва в „Изпълни избраните“. Двете не си пречат, защото бутонът НЕ е
   * вътре в `<label>` — иначе щракването върху него би отметнало чекбокса.
   */
  function fnRow(ctx, fn, params) {
    const { esc, T, ico, ico4 } = ctx;
    const name = T(fn.label);
    const title = fn.title ? T(fn.title) : name;
    // Спрайтът v4 е първият избор (йерархията), вграденият набор е резерва: празно място не се
    // оставя, ако `/ui/icons-v4.svg` не се е заредил.
    const glyph = (typeof ico4 === 'function' && ico4(fn.icon, 'standard')) || ico(fn.fallback || 'dot');
    return `
      <div class="pf-fn" data-fn-row="${esc(fn.id)}">
        <input type="checkbox" class="pf-fn-check" data-fn-check="${esc(fn.id)}" aria-label="${esc(
      T('pc.fn.select', { name }),
    )}" />
        <span class="pf-fn-state" data-fn-state="${esc(fn.id)}" role="status" aria-live="polite"></span>
        <button type="button" class="btn btn-sm pf-fn-btn" id="pf-${esc(fn.id)}" title="${esc(title)}">${glyph}<span>${esc(name)}</span></button>
        ${params || ''}
      </div>`;
  }

  /** Редовете на една област — рисуват се от `FUNCTIONS`, не се пишат на ръка. */
  function fnRows(ctx, area, params) {
    return FUNCTIONS.filter((fn) => fn.area === area)
      .map((fn) => fnRow(ctx, fn, params && params[fn.id]))
      .join('');
  }

  /**
   * Краят на обекта: едно изпълнение за всички отметнати функции и място за обобщението.
   * Броят в етикета се обновява от `files-manager.js` при отметка.
   */
  function fnFooter(ctx) {
    const { esc, T, ico4, ico } = ctx;
    const glyph = (typeof ico4 === 'function' && ico4('check-square', 'standard')) || ico('plus');
    return `
      <div class="u-row u-row-2 u-mt">
        <button type="button" class="btn btn-sm" id="pf-fn-run" data-fn-run disabled title="${esc(T('pc.fn.run.title'))}">${glyph}<span>${esc(
      T('pc.fn.run', { count: 0 }),
    )}</span></button>
        <span class="hint">${esc(T('pc.fn.hint'))}</span>
      </div>
      <output class="pf-security-out" id="pf-fn-out" aria-live="polite"></output>`;
  }

  /** HTML на блока „Контролен панел на портала: <заглавие>“ + API/QR. */
  function render(ctx) {
    const { esc, state, p, FLAGS, ICON, ico, fmtDate, contactSelect, caseSelect, newContactFields, newCaseFields, T } = ctx;
    // Блокът се сгъва/разгъва — по подразбиране е СГЪНАТ (`controlOpen === true` го разгъва),
    // както всички блокове на портала: отвореният портал показва заглавия, не стена от текст.
    const open = state.controlOpen === true;
    // QR кодът вече е БУТОН в главата на картата (горе вдясно) — виж `portalCard` в
    // files-manager.js. Затова тук не се рисува блок „Достъп и QR код“: остана само
    // контролният панел. Причината: блокът дублираше входа към портала и изяждаше
    // половината екран с текст, който не се променя.
    return `
      <section class="pf-block ${open ? '' : 'pf-collapsed'}" data-block="control">
        <div class="pf-block-head">
          <h5><button type="button" class="link-btn pf-block-tog" data-pf-control-tog aria-expanded="${open}" ${open ? 'aria-controls="pf-control-body"' : ''} title="${esc(
        T('pc.toggle.title', { action: open ? T('pc.toggle.collapse') : T('pc.toggle.expand') }),
      )}">${ico(open ? 'chevronDown' : 'chevronRight')} ${esc(T('pc.title', { title: p.title }))}</button></h5>
        </div>
        ${open
        ? `<div class="pf-block-body" id="pf-control-body">
          <div class="two-col">
            <form id="pf-settings">
              <div class="field"><label>${esc(T('pc.field.title'))}</label><input name="title" value="${esc(p.title)}" maxlength="160" /></div>
              <div class="field"><label>slug</label><input name="slug" value="${esc(p.slug)}" maxlength="63" /></div>
              <div class="field"><label>${esc(T('pc.field.subject'))}</label><input name="subject" value="${esc(p.subject || '')}" maxlength="200" /></div>
              <div class="field"><label>${esc(T('pc.field.category'))}</label><input name="category" value="${esc(p.category || '')}" maxlength="120" list="pf-cats-set" />
                <datalist id="pf-cats-set">${[...new Set(state.portals.map((x) => x.category).filter(Boolean))]
          .sort()
          .map((c) => `<option value="${esc(c)}"></option>`)
          .join('')}</datalist></div>
              <div class="field"><label>${esc(T('pc.field.flag'))}</label>
                <select name="flag">${FLAGS.map(
            (f) => `<option value="${f.id}" ${(p.flag || 'none') === f.id ? 'selected' : ''}>${f.icon} ${esc(f.label)}</option>`,
          ).join('')}</select>
              </div>
              <div class="field"><label>${ico('person')} ${esc(T('pc.field.contact'))}</label>
                ${contactSelect(p.contactId || '')}
                ${newContactFields()}
                <small class="hint">${esc(T('pc.contact.hint'))}</small>
              </div>
              <div class="field"><label>${ico('case')} ${esc(T('pc.field.case'))}</label>
                ${caseSelect(p.caseId || '')}
                ${newCaseFields()}
                <small class="hint">${esc(T('pc.case.hint'))}</small>
              </div>
              <div class="field"><label>${ICON.folder} ${esc(T('pc.field.storage'))}</label>
                <code class="pf-fixed" data-pf-storage-root>${esc(p.storage_root || '')}</code>
                <small class="hint">${esc(T('pc.storage.hint'))}</small>
              </div>
              <div class="field"><label>${esc(T('pc.field.description'))}</label><textarea name="description" rows="2">${esc(p.description)}</textarea></div>
              <div class="field"><label>${esc(T('pc.field.notes'))}</label><textarea name="notes" rows="2" maxlength="2000">${esc(p.notes || '')}</textarea></div>
              <div class="field"><label>${esc(T('pc.field.created'))}</label><input readonly value="${esc(fmtDate(p.createdAt))}" /></div>
              <div class="field"><label>${esc(T('pc.field.visibility'))}</label>
                <select name="visibility">
                  <option value="private" ${p.visibility !== 'public' ? 'selected' : ''}>private</option>
                  <option value="public" ${p.visibility === 'public' ? 'selected' : ''}>public</option>
                </select>
              </div>
              <button type="submit" class="btn">${esc(T('pc.save'))}</button>
            </form>
            <div>
              <p class="hint">${T('pc.qrButton.hint')}</p>
              <div class="pf-security">
                <h6>${ico('lock')} ${esc(T('pc.security.title'))}</h6>
                <p class="hint">${T('pc.security.hint')}</p>
                <div class="pf-fn-list">${fnRows(ctx, 'security')}</div>
                <output class="pf-security-out" id="pf-security-out" aria-live="polite"></output>
              </div>
              <div class="pf-security">
                <h6>${ico('lock')} ${esc(T('pc.token.title'))}</h6>
                <p class="hint">${T('pc.token.hint')}</p>
                <div class="u-row u-row-2">
                  <select id="pf-token-ttl" title="${esc(T('pc.token.ttl.title'))}">
                    <option value="24">${esc(T('pc.token.ttl.24'))}</option>
                    <option value="168">${esc(T('pc.token.ttl.7d'))}</option>
                    <option value="0">${esc(T('pc.token.ttl.none'))}</option>
                  </select>
                  <select id="pf-token-max" title="${esc(T('pc.token.max.title'))}">
                    <option value="0">${esc(T('pc.token.max.none'))}</option>
                    <option value="1">${esc(T('pc.token.max.1'))}</option>
                    <option value="3">${esc(T('pc.token.max.3'))}</option>
                    <option value="10">${esc(T('pc.token.max.10'))}</option>
                  </select>
                </div>
                <div class="pf-fn-list">${fnRows(ctx, 'access')}</div>
                <output class="pf-security-out" id="pf-token-out" aria-live="polite"></output>
              </div>
              <div class="pf-security">
                <h6>${ico('qr')} ${esc(T('pc.qr.title'))}</h6>
                <p class="hint">${T('pc.qr.hint')}</p>
                <div class="pf-fn-list">${fnRows(ctx, 'qr', {
        'qr-block': `<input id="pf-qr-reason" class="pf-fn-param" type="text" maxlength="500" placeholder="${esc(T('pc.qr.reason'))}" aria-label="${esc
          (T('pc.qr.reason'))}">`,
        'qr-restore': `<input id="pf-qr-restore-id" class="pf-fn-param" type="text" maxlength="16" placeholder="QR-001" aria-label="${esc(T('pc.qr.restore'))}">`,
      })}</div>
                <p class="hint">${esc(T('pc.qr.verify.hint'))}</p>
                <output class="pf-security-out" id="pf-qr-out" aria-live="polite"></output>
              </div>
              <div class="pf-security">
                <h6>${ico('plus')} ${esc(T('pc.fn.title'))}</h6>
                <p class="hint">${esc(T('pc.fn.blockHint'))}</p>
                ${fnFooter(ctx)}
              </div>
              <div class="pf-security">
                <h6>${ico('lock')} ${esc(T('pc.close.title'))}</h6>
                <p class="hint">${T('pc.close.hint')}</p>
                <div class="u-row u-row-1">
                  <button type="button" class="btn btn-sm" data-close-portal-submit="${esc(p.id)}" title="${esc(T('pc.close.attr'))}">✕ ${esc(T('pc.close'))}</button>
                </div>
              </div>
              <div class="pf-security pf-danger">
                <h6>${ico('delete')} ${esc(T('pc.delete.title'))}</h6>
                <p class="hint">${T('pc.delete.hint')}</p>
                <div class="u-row u-row-2">
                  <input id="pf-delete-confirm" type="text" maxlength="63" autocomplete="off"
                    placeholder="${esc(T('pc.delete.confirm', { slug: p.slug }))}" />
                  <button type="button" class="btn btn-danger btn-sm" data-delete-portal="${esc(p.id)}"
                    title="${esc(T('pc.delete.attr'))}">${ico('delete')} ${esc(T('pc.delete'))}</button>
                </div>
              </div>
            </div>
          </div>
          ${optionsBlock(ctx)}
        </div>`
        : ''
      }
      </section>`;
  }

  /**
   * Блокът „Опции“ — четирите раздела на `configuration.yaml` и жива разпечатка на файла.
   * Рисува се САМО когато описанието е прочетено: иначе човек би видял полета, които още не
   * знаят стойностите си („празно“ вместо „наследено“). Текстът минава през `T()`, защото
   * таванът на този модул е 0 български стринга (DEF-49).
   */
  function optionsBlock(ctx) {
    const { esc, T, ico, config } = ctx;
    const title = `<h6>${ico('gear')} ${esc(T('pc.options.title'))}</h6>`;
    if (!config) return `<div class="pf-security">${title}<p class="hint">${esc(T('pc.options.loading'))}</p></div>`;
    if (config.error) return `<div class="pf-security">${title}<p class="hint">${esc(config.error)}</p></div>`;
    const d = config.effective || config.data || {};
    const sel = (name, value, values) =>
      `<select name="opt.${name}">${values
        .map((v) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(v === '' ? '—' : v)}</option>`)
        .join('')}</select>`;
    const check = (name, label, value) =>
      `<div class="field"><label><input type="checkbox" name="opt.${name}" ${value === true ? 'checked' : ''} /> ${esc(T(label))}</label></div>`;
    return `
      <div class="pf-security" data-pf-options>
        ${title}
        <p class="hint">${esc(T('pc.options.hint'))}</p>
        <form id="pf-config-form">
          <fieldset><legend>${esc(T('pc.options.portal'))}</legend>
            <div class="field"><label>${esc(T('pc.field.visibility'))}</label>${sel('visibility', d.visibility, ['private', 'public'])}</div>
          </fieldset>
          <fieldset><legend>${esc(T('pc.options.access'))}</legend>
            <div class="field"><label>${esc(T('pc.options.mode'))}</label>${sel('access_mode', d.access_mode, ['', 'free', 'key', 'token'])}</div>
            ${check('access_review_only', 'pc.options.review', d.access_review_only)}
            ${check('access_download_requires_key', 'pc.options.downloadKey', d.access_download_requires_key)}
            <div class="field"><label>${esc(T('pc.options.ttl'))}</label>${sel('temporary_default_ttl', d.temporary_default_ttl, ['1h', '6h', '24h'])}</div>
          </fieldset>
          <fieldset><legend>${esc(T('pc.options.qr'))}</legend>
            <div class="field"><label>${esc(T('pc.options.qrStyle'))}</label>${sel('qr_style', d.qr_style, ['frame', 'plain'])}</div>
            <div class="field"><label>${esc(T('pc.options.qrCaption'))}</label>${sel('qr_caption', d.qr_caption, ['url', 'title'])}</div>
            ${check('qr_levels_folder', 'pc.options.levelFolder', d.qr_levels_folder)}
            ${check('qr_levels_file', 'pc.options.levelFile', d.qr_levels_file)}
          </fieldset>
          <fieldset><legend>${esc(T('pc.options.interface'))}</legend>
            ${check('folders_default_visible', 'pc.options.folderVisible', d.folders_default_visible)}
            ${check('folders_default_media', 'pc.options.folderMedia', d.folders_default_media)}
            ${check('storage_copy_to_folder', 'pc.options.copy', d.storage_copy_to_folder)}
            <div class="field"><label>${esc(T('pc.options.columns'))}</label>${sel('ui_columns', d.ui_columns, ['2', '3', '4'])}</div>
            ${check('ui_show_sizes', 'pc.options.sizes', d.ui_show_sizes)}
            ${check('audit_telemetry', 'pc.options.telemetry', d.audit_telemetry)}
          </fieldset>
          <div class="u-row u-row-2">
            <button type="submit" class="btn">${esc(T('pc.options.save'))}</button>
          </div>
          <div class="pf-fn-list">${fnRows(ctx, 'config')}</div>
        </form>
        <div class="u-row u-row-2 u-mt">
          <button type="button" class="btn btn-sm" id="pf-config-show">${esc(T('pc.options.show'))}</button>
          <span class="hint">${esc(T('pc.options.hash', { hash: String(config.hash || '—').slice(0, 12) }))}</span>
        </div>
        <pre class="pf-config-file" id="pf-config-file" ${config.preview ? '' : 'hidden'}>${esc(config.preview || '')}</pre>
        <output class="pf-security-out ${config.notice ? config.notice.kind : ''}" id="pf-config-out" aria-live="polite">${config.notice ? esc(config.notice.text) : ''}</output>
      </div>`;
  }

  window.HapiPortalControl = { render, FUNCTIONS };
})();
