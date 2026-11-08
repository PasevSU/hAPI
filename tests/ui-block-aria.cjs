'use strict';
// ПРЕВКЛЮЧВАТЕЛЯТ НА БЛОК КАЗВА КАКВО УПРАВЛЯВА (0.69.206).
//
// Проблемът: трите заглавия на портала („Контролен панел“, „Папки“, „Файлове“) имаха
// `aria-expanded`, но НЕ и `aria-controls`. Екранният четец съобщава „разгънат“, без да
// казва КОЕ се разгъва, а връзката „бутон → тяло“ съществува само в CSS класовете. За
// човек с мишка това е без значение; за екранен четец и за клавиатурна навигация е
// липсващата половина на договора.
//
// Договорът, който тестът пази:
//   1. разгънат блок → `aria-expanded="true"` И `aria-controls` към СЪЩЕСТВУВАЩ елемент,
//      който е тялото на ТОЗИ блок (вътре в неговата секция `[data-block]`);
//   2. сгънат блок → `aria-expanded="false"` и НЯМА `aria-controls` (сгънатото тяло не е в
//      документа, а висяща препратка е по-лоша от липсваща: четецът обявява „контролира
//      нищо“);
//   3. състоянието се сменя с щракване по самото заглавие, не през вътрешно състояние.
const assert = require('node:assert/strict');
const { startServer, mountUi, waitFor, expandPortalBlocks, PORTAL_BLOCK_TOGGLES } = require('./lib/gui-harness.cjs');

const PANEL_MODULES = [
  'data.js', 'icons.js', 'report-studio.js', 'portals.js', 'portal-control.js',
  'portal-folders.js', 'portal-files.js', 'files-manager.js', 'directory-panel.js',
  'dashboard-panel.js', 'settings-panel.js', 'export-center.js', 'public-gateway.js',
  'visitors-panel.js', 'secret-share.js', 'report-sign.js',
];

(async () => {
  const server = await startServer({ keepData: true });
  try {
    const created = await server.api('/admin/api/portals', 'POST', {
      slug: 'aria-pane',
      title: 'Панел за достъпност',
      visibility: 'public',
    });
    assert.equal(created.status, 201, 'порталът е създаден: ' + JSON.stringify(created.data));
    const portalId = created.data.id;

    const ui = mountUi(server, { modules: PANEL_MODULES });
    const host = ui.container();
    ui.window.FilesManagerPanel.state.openPortal = portalId;
    ui.window.FilesManagerPanel.mount(host);
    await waitFor(() => host.querySelector('[data-pf-control-tog]'), { label: 'картата на портала' });

    const toggleOf = (block) => host.querySelector(PORTAL_BLOCK_TOGGLES[block]);

    // В началото и трите блока са сгънати: нито едно висящо `aria-controls`.
    for (const block of Object.keys(PORTAL_BLOCK_TOGGLES)) {
      const toggle = toggleOf(block);
      assert.ok(toggle, 'има заглавие за блок „' + block + '“');
      assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'блок „' + block + '“ е сгънат в началото');
      assert.equal(
        toggle.hasAttribute('aria-controls'),
        false,
        'сгънатият блок „' + block + '“ не сочи към липсващ елемент (aria-controls = ' + toggle.getAttribute('aria-controls') + ')',
      );
    }

    // Всеки блок се разгъва с щракване и тогава сочи към СВОЕТО тяло.
    for (const block of Object.keys(PORTAL_BLOCK_TOGGLES)) {
      await expandPortalBlocks(host, { block });
      const toggle = toggleOf(block);
      assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'блок „' + block + '“ се разгъва с щракване');
      const id = toggle.getAttribute('aria-controls');
      assert.ok(id, 'разгънатият блок „' + block + '“ казва какво управлява (aria-controls)');
      const body = host.querySelector('#' + id);
      assert.ok(body, 'aria-controls на „' + block + '“ сочи съществуващ елемент: #' + id);
      const section = body.closest('[data-block]');
      assert.ok(section, 'тялото на „' + block + '“ е в секция с data-block');
      assert.equal(section.getAttribute('data-block'), block, 'aria-controls на „' + block + '“ сочи тялото на СЪЩИЯ блок');
      assert.equal(body.hidden, false, 'тялото на „' + block + '“ е видимо, когато блокът е разгънат');

      // Затваряне: състоянието се обявява и препратката изчезва заедно с тялото.
      toggle.click();
      await waitFor(() => {
        const again = toggleOf(block);
        return again && again.getAttribute('aria-expanded') === 'false';
      }, { label: 'блокът ' + block + ' да се сгъне' });
      const closed = toggleOf(block);
      assert.equal(closed.hasAttribute('aria-controls'), false, 'сгънатият блок „' + block + '“ вече не сочи никъде');
      assert.equal(host.querySelector('#' + id), null, 'сгънатото тяло на „' + block + '“ не е в документа');
    }

    console.log('PASS ui-block-aria: всеки превключвател назовава тялото си, сгънат не сочи нищо');
  } finally {
    await server.stop();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
