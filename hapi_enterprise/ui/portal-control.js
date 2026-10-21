'use strict';
// Контейнер „Контролен панел на портала“ — настройки на портала и API/QR.
//
// Отделен модул: рисува САМО този блок. Всичко, което му трябва, идва в `ctx`
// (състояние и помощни функции), за да не зависи от вътрешностите на files-manager.js.
(function () {
  /** HTML на блока „Контролен панел на портала: <заглавие>“ + API/QR. */
  function render(ctx) {
    const { esc, state, p, api, FLAGS, ICON, ico, fmtDate, qrSvg, contactSelect, caseSelect, newContactFields, newCaseFields } = ctx;
    // Блокът се сгъва/разгъва — по подразбиране е отворен (`controlOpen !== false`).
    const open = state.controlOpen !== false;
    return `
      <section class="pf-block ${open ? '' : 'pf-collapsed'}" data-block="control">
        <div class="pf-block-head">
          <h5><button type="button" class="link-btn pf-block-tog" data-pf-control-tog aria-expanded="${open}" title="${
            open ? 'Сгъни' : 'Разгъни'
          } контролния панел">${ico(open ? 'chevronDown' : 'chevronRight')} Контролен панел на портала: ${esc(
            p.title,
          )}</button></h5>
        </div>
        ${
          open
            ? `<div class="pf-block-body">
          <div class="two-col">
            <form id="pf-settings">
              <div class="field"><label>Заглавие</label><input name="title" value="${esc(p.title)}" maxlength="160" /></div>
              <div class="field"><label>slug</label><input name="slug" value="${esc(p.slug)}" maxlength="63" /></div>
              <div class="field"><label>Относно</label><input name="subject" value="${esc(p.subject || '')}" maxlength="200" /></div>
              <div class="field"><label>Категория</label><input name="category" value="${esc(p.category || '')}" maxlength="120" list="pf-cats-set" />
                <datalist id="pf-cats-set">${[...new Set(state.portals.map((x) => x.category).filter(Boolean))]
                  .sort()
                  .map((c) => `<option value="${esc(c)}"></option>`)
                  .join('')}</datalist></div>
              <div class="field"><label>Флаг</label>
                <select name="flag">${FLAGS.map(
                  (f) => `<option value="${f.id}" ${(p.flag || 'none') === f.id ? 'selected' : ''}>${f.icon} ${esc(f.label)}</option>`,
                ).join('')}</select>
              </div>
              <div class="field"><label>${ico('person')} Контакт</label>
                ${contactSelect(p.contactId || '')}
                ${newContactFields()}
                <small class="hint">Избери съществуващ контакт или „＋ нов контакт“ и попълни полетата.</small>
              </div>
              <div class="field"><label>${ico('case')} Дело (case)</label>
                ${caseSelect(p.caseId || '')}
                ${newCaseFields()}
                <small class="hint">Избери съществуващо дело или „＋ ново дело“ с полета по желание.</small>
              </div>
              <div class="field"><label>${ICON.folder} Папка с файлове (storage_root)</label>
                <input name="storage_root" value="${esc(p.storage_root || '/share')}" maxlength="240" list="pf-roots-set" />
                <datalist id="pf-roots-set">${[...new Set(['/share', '/media', ...state.portals.map((x) => x.storage_root || '/share')])]
                  .filter(Boolean)
                  .sort()
                  .map((r) => `<option value="${esc(r)}"></option>`)
                  .join('')}</datalist>
                <small class="hint">Само под /share или /media.</small>
              </div>
              <div class="field"><label>Описание</label><textarea name="description" rows="2">${esc(p.description)}</textarea></div>
              <div class="field"><label>Бележки</label><textarea name="notes" rows="2" maxlength="2000">${esc(p.notes || '')}</textarea></div>
              <div class="field"><label>Дата на създаване</label><input readonly value="${esc(fmtDate(p.createdAt))}" /></div>
              <div class="field"><label>Видимост</label>
                <select name="visibility">
                  <option value="private" ${p.visibility !== 'public' ? 'selected' : ''}>private</option>
                  <option value="public" ${p.visibility === 'public' ? 'selected' : ''}>public</option>
                </select>
              </div>
              <button type="submit" class="btn">Запази настройките</button>
            </form>
            <div>
              <div class="u-row u-row-3">
                ${
                  api
                    ? `<button type="button" class="btn btn-sm" id="pf-dl-api">${ICON.download} api.json</button>
                       <button type="button" class="btn btn-sm" id="pf-dl-openapi">${ICON.download} openapi.json</button>
                       <button type="button" class="btn btn-sm" id="pf-copy-refs">${ICON.copy} Копирай препратките</button>`
                    : ''
                }
              </div>
              ${
                api
                  ? `<div class="pf-qr">${
                      qrSvg(api.qrUrl) ? `<div class="qf-svg">${qrSvg(api.qrUrl)}</div>` : '<p class="hint">QR SVG не е наличен в тази среда.</p>'
                    }
                       <dl class="fm-meta">
                         <dt>API</dt><dd><code>${esc(api.refs.apiUrl || '')}</code></dd>
                         <dt>Манифест</dt><dd><code>${esc(api.refs.manifestUrl || '')}</code></dd>
                         <dt>Файлове</dt><dd><code>${esc(api.refs.filesUrl || '')}</code></dd>
                         <dt>Хранилище</dt><dd><code>${esc(api.refs.storageUrl || '')}</code></dd>
                         <dt>OpenAPI</dt><dd><code>${esc(api.refs.openapiUrl || '')}</code></dd>
                         <dt>QR адрес</dt><dd><code>${esc(api.qrUrl)}</code></dd>
                         <dt>Генерирано</dt><dd>${esc((api.at || '').slice(0, 19).replace('T', ' '))}</dd>
                         <dt>Файлове в API</dt><dd>${p.files.length}</dd>
                       </dl></div>`
                  : '<p class="hint">API и QR се създават заедно с портала — тук се появяват автоматично.</p>'
              }
            </div>
          </div>
        </div>`
            : ''
        }
      </section>`;
  }

  window.HapiPortalControl = { render };
})();
