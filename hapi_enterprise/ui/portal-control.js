'use strict';
// Контейнер „Контролен панел на портала“ — настройки на портала и API/QR.
//
// Отделен модул: рисува САМО този блок. Всичко, което му трябва, идва в `ctx`
// (състояние и помощни функции), за да не зависи от вътрешностите на files-manager.js.
(function () {
  // Текст по ключ: КАРТАТА също минава през речника (BG/EN/DE), както Настройки — иначе
  // немският потребител вижда български бутони в преведен интерфейс (стария BUG-11).
  const T = (key) => (typeof window !== 'undefined' && window.HapiI18n ? window.HapiI18n.t(key) : String(key));
  /** HTML на блока „Контролен панел на портала: <заглавие>“ + API/QR. */
  function render(ctx) {
    const { esc, state, p, api, FLAGS, ICON, ico, fmtDate, qrSvg, contactSelect, caseSelect, newContactFields, newCaseFields } = ctx;
    // Блокът се сгъва/разгъва — по подразбиране е СГЪНАТ (`controlOpen === true` го разгъва),
    // както всички блокове на портала: отвореният портал показва заглавия, не стена от текст.
    const open = state.controlOpen === true;
    // QR кодът кодира СТРАНИЦАТА на портала заедно с ПАПКАТА (`?folder=`), а НЕ адреса
    // на SVG изображението: сканиран, той трябва да отвори портала с неговите файлове.
    const qrPage = api ? api.folderUrl || api.landing || (api.refs && api.refs.landingUrl) || '' : '';
    const qr = qrSvg(qrPage);
    // Адресите се показват ВИНАГИ: за частен портал носят подписан достъп (`?expires=&sig=`),
    // който сървърът издава (portal-access.js) — иначе `/p/<id>`, API-то и QR кодът връщат 404.
    const isPublic = String(p.visibility || '') === 'public';
    // Текстът „API и QR се създават заедно с портала“ живее в речника — `portal.link.noApi`.
    const noApiHint = `<p class="hint">${T('portal.link.noApi')}</p>`;
    // ── Връзка и QR: ЕДИН адрес, показан като текст, и кодът до него ─────────────
    // Дотук адресът се виждаше само като бутон „Копирай адреса“, а QR стоеше най-долу в
    // дясната колона на СГЪНАТ блок — тоест до кода се стигаше с три действия, а адресът
    // не можеше нито да се прочете, нито да се провери. Затова този блок е ПЪРВИ и винаги
    // отворен: кодът, адресът и действията по него са на едно място.
    const link = api ? api.landing : '';
    const expiresMs = api && api.accessExpires ? Number(api.accessExpires) * 1000 : 0;
    const minutesLeft = expiresMs ? Math.round((expiresMs - Date.now()) / 60000) : 0;
    const expired = Boolean(expiresMs && minutesLeft <= 0);
    const accessable = Boolean(api && (api.accessQuery || api.tokenRequired || state.portalTokenRequired));
    const linkState = !api
      ? { text: T('portal.state.creating'), cls: '' }
      : expired
        ? { text: T('portal.state.expired'), cls: 'err' }
        : api.accessQuery
          ? {
            text: expiresMs
              ? `${T('portal.state.signed')}: ${minutesLeft} ${T('portal.state.minutesLeft')}`
              : T('portal.state.signed'),
            cls: minutesLeft <= 10 ? 'warn' : 'ok',
          }
          : (api.tokenRequired || state.portalTokenRequired)
            ? { text: T('portal.state.token'), cls: 'warn' }
            : { text: isPublic ? T('portal.state.public') : T('portal.state.private'), cls: 'ok' };
    const linkBlock = `
      <section class="pf-block pf-link" data-block="link">
        <div class="pf-block-head">
          <h5>${ico('qr')} ${T('portal.link.title')}</h5>
          <span class="pf-link-state ${linkState.cls}" id="pf-link-state">${esc(linkState.text)}</span>
        </div>
        <div class="pf-block-body pf-link-body">
          <div class="pf-link-qr">${qr ? `<div class="qf-svg" id="pf-portal-qr">${qr}</div>` : `<p class="hint">${T('portal.link.qrMissing')}</p>`}</div>
          <div class="pf-link-side">
            <label class="pf-link-label" for="pf-link-url">${T('portal.link.label')}</label>
            <div class="pf-link-field">
              <input id="pf-link-url" class="pf-link-url" readonly value="${esc(link)}" placeholder="${T('portal.link.placeholder')}" />
              <button type="button" class="btn btn-sm" id="pf-copy-portal" title="${T('portal.tip.copy')}">${ICON.copy} ${T('portal.link.copy')}</button>
            </div>
            ${api ? '' : noApiHint}
            <div class="pf-link-actions" role="toolbar" aria-label="${T('portal.link.title')}">
              <button type="button" class="btn btn-primary btn-sm" id="pf-open-portal" data-open-portal-id="${esc(p.id)}" title="${T('portal.tip.open')}" aria-label="${T('portal.link.open')}">${ico('openWindow')}<span class="btn-label">${T('portal.act.open')}</span></button>
              <button type="button" class="btn btn-sm" id="pf-refresh-access" ${accessable ? '' : 'disabled'} title="${accessable
        ? T('portal.tip.refresh')
        : T('portal.tip.refreshPublic')}" aria-label="${T('portal.link.refresh')}">${ico('refresh')}<span class="btn-label">${T('portal.act.refresh')}</span></button>
              <button type="button" class="btn btn-sm" id="pf-qr-download" title="${T('portal.tip.qrDownload')}" aria-label="${T('portal.link.qrDownload')}">${ICON.download}<span class="btn-label">${T('portal.act.qr')}</span></button>
              <button type="button" class="btn btn-sm" id="pf-qr-print" title="${T('portal.tip.qrPrint')}" aria-label="${T('portal.link.qrPrint')}">${ico('qr')}<span class="btn-label">${T('portal.act.print')}</span></button>
              <button type="button" class="btn btn-sm" id="pf-dl-api" title="${T('portal.tip.dlApi')}" aria-label="${T('portal.link.dlApi')}">${ICON.download}<span class="btn-label">${T('portal.act.api')}</span></button>
              <button type="button" class="btn btn-sm" id="pf-open-folder" data-open-folder="${esc(p.slug || '')}" title="${T('portal.tip.openFolder')}" aria-label="${T('portal.link.openFolder')}">${ICON.folder}<span class="btn-label">${T('portal.act.folder')}</span></button>
            </div>
            <p class="pf-link-note">${T('portal.link.hint1')}<br />${T('portal.link.hint2')}</p>
            <p class="pf-link-note pf-link-single">${T('portal.link.single')}</p>
            <p class="pf-link-note pf-link-crypto">${T('portal.brand')} · ${T('portal.crypto')}</p>
          </div>
        </div>
      </section>`;
    return `
      ${linkBlock}
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
              <p class="hint">Адресът и QR кодът са в блока <strong>„Връзка и QR код“</strong> най-горе на портала —
                там се копират, свалят и печатат, без да се отваря този панел.</p>
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
                <div class="u-row u-row-3">
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
              <div class="pf-security">
                <h6>${ico('lock')} Закриване на портала</h6>
                <p class="hint">Закритият портал излиза от списъка и адресът му казва „Порталът е закрит“,
                  а данните му отиват в <strong>архив за съхранение</strong> — нищо не се трие.
                  Порталите се пазят <strong>6 месеца</strong> и през цялото време се връщат с едно натискане
                  от „Затворени портали“; след срока се изтрива окончателно.</p>
                <div class="u-row u-row-1">
                  <button type="button" class="btn btn-sm" data-close-portal-submit="${esc(p.id)}" title="Премести портала в архив за съхранение">✕ Закрий портала</button>
                </div>
              </div>
              <div class="pf-security pf-danger">
                <h6>${ico('delete')} Премахване на портала (окончателно)</h6>
                <p class="hint">Това е единственото действие тук, което <strong>трие</strong>, а не архивира:
                  порталът изчезва от списъка, а папката му в хранилището, вътрешната папка с метаданни
                  и API папката се изтриват на секундата. Премахнат портал <strong>не се връща</strong> —
                  ако искаш да може да се върне, използвай „Закрий портала“.
                  Когато порталът има <strong>архивирани QR ревизии</strong>, add-on-ът отказва с
                  <code>409</code> (правилото <code>EVIDENCE_NEVER_DELETED</code>) и пита отделно дали
                  да тръгне със <code>?force=1</code> — доказателствата се трият само с изрично решение.</p>
                <div class="u-row u-row-2">
                  <input id="pf-delete-confirm" type="text" maxlength="63" autocomplete="off"
                    placeholder="Напиши slug-а (${esc(p.slug)}), за да потвърдиш" />
                  <button type="button" class="btn btn-danger btn-sm" data-delete-portal="${esc(p.id)}"
                    title="Изтрий портала и файловете му окончателно">${ico('delete')} Премахни портала</button>
                </div>
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
