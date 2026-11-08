'use strict';
// Контейнер „Контролен панел на портала“ — настройки на портала и API/QR.
//
// Отделен модул: рисува САМО този блок. Всичко, което му трябва, идва в `ctx`
// (състояние и помощни функции), за да не зависи от вътрешностите на files-manager.js.
(function () {
  /** HTML на блока „Контролен панел на портала: <заглавие>“ + API/QR. */
  function render(ctx) {
    const { esc, state, p, FLAGS, ICON, ico, fmtDate, contactSelect, caseSelect, newContactFields, newCaseFields } = ctx;
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
          <h5><button type="button" class="link-btn pf-block-tog" data-pf-control-tog aria-expanded="${open}" ${open ? 'aria-controls="pf-control-body"' : ''} title="${open ? 'Сгъни' : 'Разгъни'
      } контролния панел">${ico(open ? 'chevronDown' : 'chevronRight')} Контролен панел на портала: ${esc(
        p.title,
      )}</button></h5>
        </div>
        ${open
        ? `<div class="pf-block-body" id="pf-control-body">
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
              <p class="hint">QR кодът към публичния портал е <strong>бутонът горе вдясно</strong> в заглавния ред
                на портала — отваря се на едно натискане, без да се разгъва този панел.</p>
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
