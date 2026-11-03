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
    // QR кодът кодира СТРАНИЦАТА на портала заедно с ПАПКАТА (`?folder=`), а НЕ адреса
    // на SVG изображението: сканиран, той трябва да отвори портала с неговите файлове.
    const qrPage = api ? api.folderUrl || api.landing || (api.refs && api.refs.landingUrl) || '' : '';
    const qr = qrSvg(qrPage);
    // Адресите се показват ВИНАГИ: за частен портал носят подписан достъп (`?expires=&sig=`),
    // който сървърът издава (portal-access.js) — иначе `/p/<id>`, API-то и QR кодът връщат 404.
    const isPublic = String(p.visibility || '') === 'public';
    const accessNote = !api
      ? ''
      : api.accessQuery
        ? `<p class="hint">Адресите носят подписан достъп — важи до ${esc(
          new Date((api.accessExpires || 0) * 1000).toLocaleString('bg-BG'),
        )}; след това се генерира нов („Създай и генерирай API + QR“).</p>`
        : (api.tokenRequired || state.portalTokenRequired)
          ? '<p class="hint">Включено е <code>require_portal_token</code>: всеки адрес иска вход в add-on-а, включително за публичен портал. За външно споделяне издай <strong>токен за портал</strong> (секция „Публичен достъп“ по-долу) — той е ключът, който получателят отваря.</p>'
          : isPublic
            ? ''
            : '<p class="hint">Порталът е частен — адресът се отваря само с ключ или сесия.</p>';
    const noApiHint = '<p class="hint">API и QR се създават заедно с портала — тук се появяват автоматично.</p>';
    return `
      <section class="pf-block ${open ? '' : 'pf-collapsed'}" data-block="control">
        <div class="pf-block-head">
          <h5><button type="button" class="link-btn pf-block-tog" data-pf-control-tog aria-expanded="${open}" title="${open ? 'Сгъни' : 'Разгъни'
      } контролния панел">${ico(open ? 'chevronDown' : 'chevronRight')} Контролен панел на портала: ${esc(
        p.title,
      )}</button></h5>
        </div>
        ${open
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
                ${api
          ? `<button type="button" class="btn btn-primary btn-sm" id="pf-open-portal" data-open-portal-id="${esc(p.id)}" title="Отваря портала в панела (същият раздел, без нов таб — под Ingress нов таб губи сесията)">${ico('openWindow')} Отвори портала</button>
                       <button type="button" class="btn btn-sm" id="pf-copy-portal" title="Копира ЕДИНСТВЕНИЯ адрес на портала">${ICON.copy} Копирай адреса</button>
                       <button type="button" class="btn btn-sm" id="pf-dl-api" title="Сваля машинното описание като файл — това НЕ е порталът">${ICON.download} Свали api.json</button>`
          : ''
        }
              </div>
              ${api
          ? `<div class="pf-qr">${qr ? `<div class="qf-svg">${qr}</div>` : '<p class="hint">QR SVG не е наличен в тази среда.</p>'
          }
                       ${accessNote}
                       <p class="hint">Порталът извежда сам цялата информация за себе си — файлове, папки, хешове,
                       достъп и машинното описание. Тук остава само адресът, с който се отваря:
                       „Отвори портала“ го отваря, „Копирай адреса“ го дава за изпращане.</p></div>`
          : noApiHint
        }
              <div class="pf-security">
                <h6>${ico('lock')} Сигурност на портала</h6>
                <p class="hint">Ключът за подпис важи за подписаните URL адреси; проверката за цялост сравнява
                  SHA-256 на всеки файл с регистрирания в портала.</p>
                <div class="u-row u-row-2">
                  <button type="button" class="btn btn-sm" id="pf-rotate-key" title="Нов ключ за подпис: старите подписани URL-и спират да важат">Обнови ключа за подпис</button>
                  <button type="button" class="btn btn-sm" id="pf-integrity" title="Провери SHA-256 на всички файлове в портала">Провери целостта</button>
                </div>
                <div class="u-row u-row-2 u-mt">
                  <button type="button" class="btn btn-sm" id="pf-integrity-job" title="Фонова проверка с прогрес">Пусни фонова проверка</button>
                </div>
                <output class="pf-security-out" id="pf-security-out" aria-live="polite"></output>
              </div>
              <div class="pf-security">
                <h6>${ico('lock')} Публичен достъп (токен за този портал)</h6>
                <p class="hint">Токенът важи <strong>само за този портал</strong> и се показва <strong>веднъж</strong> —
                  в базата остава само отпечатък. Адресът <code>/t/&lt;токен&gt;</code> издава кратка бисквитка
                  (10 мин) и отваря портала; работи и при включено <code>require_portal_token</code>, защото
                  токенът Е ключът. Отнемането спира и вече отворените сесии. Може да се зададе и
                  <strong>лимит на отварянията</strong> — тогава токенът спира след последното.</p>
                <div class="u-row u-row-2">
                  <select id="pf-token-ttl" title="Колко да важи токенът">
                    <option value="24">24 часа</option>
                    <option value="168">7 дни</option>
                    <option value="0">без срок</option>
                  </select>
                  <select id="pf-token-max" title="Колко пъти може да се отвори">
                    <option value="0">без лимит на отварянията</option>
                    <option value="1">еднократен (1 отваряне)</option>
                    <option value="3">3 отваряния</option>
                    <option value="10">10 отваряния</option>
                  </select>
                  <button type="button" class="btn btn-sm" id="pf-token-new">Издай токен за портал</button>
                </div>
                <div class="u-row u-row-2 u-mt">
                  <button type="button" class="btn btn-sm" id="pf-token-list">Покажи издадените</button>
                </div>
                <output class="pf-security-out" id="pf-token-out" aria-live="polite"></output>
              </div>
              <div class="pf-security">
                <h6>${ico('qr')} QR ревизии и архиви</h6>
                <p class="hint">Един портал — един адрес, но поредица от QR кодове: <strong>архивирането</strong>
                  прави физически ZIP на днешното съдържание и издава следващ QR, който помни предходния.
                  Максималната дълбочина е <strong>3 подпапки</strong> (ширината е свободна).</p>
                <div class="u-row u-row-2">
                  <button type="button" class="btn btn-sm" id="pf-qr-show">Покажи QR историята</button>
                  <button type="button" class="btn btn-sm" id="pf-qr-archive">Архивирай и издай нов QR</button>
                </div>
                <div class="u-row u-row-2 u-mt">
                  <input id="pf-qr-reason" type="text" maxlength="500" placeholder="Основание за прекратяване (задължително)">
                  <button type="button" class="btn btn-sm" id="pf-qr-block">Прекрати активния QR</button>
                </div>
                <div class="u-row u-row-2 u-mt">
                  <button type="button" class="btn btn-sm" id="pf-qr-verify">Провери целостта на архивите</button>
                  <span class="hint">Сверява байтовете, манифеста и файловете вътре.</span>
                </div>
                <div class="u-row u-row-2 u-mt">
                  <input id="pf-qr-restore-id" type="text" maxlength="16" placeholder="QR-001">
                  <button type="button" class="btn btn-sm" id="pf-qr-restore">Върни това състояние</button>
                </div>
                <output class="pf-security-out" id="pf-qr-out" aria-live="polite"></output>
              </div>
            </div>
          </div>
        </div>`
        : ''
      }
      </section>`;
  }

  window.HapiPortalControl = { render };
})();
