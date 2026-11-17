'use strict';
// ШАБЛОН ЗА ПОДРАЗБИРАНЕ И ИЗРАВНЯВАНЕ С ПАНЕЛА (план 23 §4, план 26 §1).
//
// Какво пази този тест:
//   • всяка папка на портал получава СВОЯ `configuration.yaml` още при създаването — с ВСИЧКИ
//     опции на договора, не с извадка;
//   • шаблонът е ЕДИН (`initial()` + `DEFAULTS`), а самоличността идва от портала — няма втори
//     YAML файл, който да се разминава;
//   • промяна от панела (PATCH на заглавието) стига до файла през `writeApiDir` → `syncConfig`;
//   • изтрит файл се възстановява от шаблона при следващо докосване (`ensure`).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startServer } = require('./lib/gui-harness.cjs');
const { storageRoot } = require('./helpers.cjs');
const config = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-config.js'));
const folder = require(path.join(__dirname, '..', 'hapi_enterprise', 'portal-folder.js'));

(async () => {
  const storage = storageRoot();
  const server = await startServer({ env: { ...storage.env, PORTAL_FOLDER_COPY: 'true' } });
  try {
    const created = await server.api('/admin/api/portals', 'POST', { title: 'Шаблон', slug: 'p-shablon', visibility: 'public' });
    assert.equal(created.status, 201, 'порталът се създава: ' + JSON.stringify(created.data).slice(0, 200));
    const portal = created.data.portal || created.data;
    const logical = String(portal.storage_root || '').replace(/^\/+/, '');
    const dir = path.join(storage.dir, ...logical.split('/').filter(Boolean));
    const file = path.join(dir, 'configuration.yaml');

    // ── 1. Файлът е налице ОЩЕ при създаването, не при първото качване ──────
    assert.ok(fs.existsSync(file), 'нов портал получава configuration.yaml заедно с папката: ' + file);
    const read = config.read(file, { slug: 'p-shablon' });
    assert.deepEqual(read.problems, [], 'файлът минава договора: ' + JSON.stringify(read.problems));

    // ── 2. Всяка опция е там; стойностите са шаблонните + самоличността ─────
    for (const key of config.OPTION_KEYS) {
      assert.ok(Object.prototype.hasOwnProperty.call(read.data, key), 'опцията „' + key + '“ присъства');
    }
    assert.equal(read.data.slug, 'p-shablon', 'ключът идва от портала');
    assert.equal(read.data.name, 'Шаблон', 'името идва от портала');
    assert.equal(read.data.visibility, 'public', 'видимостта идва от портала');
    assert.match(read.data.id, /^p-shablon-[a-z0-9-]+-001$/, 'идентификаторът е по шаблона: ' + read.data.id);
    assert.deepEqual(read.data.off, [], '`off:` е празен списък, не липсващ ключ');
    assert.deepEqual(read.data.folders, {}, 'регистърът на папките започва празен');
    assert.deepEqual(read.data.files, [], 'списъкът с файлове започва празен');
    // Всичко извън самоличността е точно подразбирането от шаблона.
    for (const key of config.OPTION_KEYS) {
      if (['slug', 'name', 'visibility'].includes(key)) continue;
      assert.deepEqual(read.data[key], config.DEFAULTS[key], 'стойността на „' + key + '“ е шаблонната');
    }
    // Шаблонът е ЕДИН: `initial()` дава същия набор и същата самоличност.
    const template = config.initial({ slug: 'p-shablon', title: 'Шаблон' });
    assert.equal(Object.keys(template).filter((k) => config.OPTION_KEYS.includes(k)).length, config.OPTION_KEYS.length, 'шаблонът носи всички опции');
    assert.equal(template.id, read.data.id, 'шаблонът издава същия идентификатор');

    // ── 3. Промяна от панела стига до файла (PATCH → writeApiDir → syncConfig) ─
    const patched = await server.api('/admin/api/portals/' + encodeURIComponent(portal.id), 'PATCH', { title: 'Име от панела' });
    assert.equal(patched.status, 200, 'PATCH минава: ' + JSON.stringify(patched.data).slice(0, 200));
    const afterPatch = config.read(file, { slug: 'p-shablon' });
    assert.deepEqual(afterPatch.problems, [], 'файлът остава валиден след PATCH');
    assert.equal(afterPatch.data.name, 'Име от панела', 'заглавието от панела е и `name` във файла');

    // ── 4. Изтрит файл се възстановява от шаблона при следващо докосване ────
    fs.rmSync(file, { force: true });
    assert.equal(fs.existsSync(file), false, 'файлът е изтрит за пробата');
    // `ensure` строи пътя през `paths.js` в ТОЗИ процес — временният корен трябва да е същият,
    // който сървърът ползва (иначе проверяваме друг диск, а не липсващ файл).
    const previousRoot = process.env.STORAGE_ROOT_OVERRIDE;
    process.env.STORAGE_ROOT_OVERRIDE = storage.dir;
    try {
      await folder.ensure({ ...portal, title: 'Име от панела' });
    } finally {
      if (previousRoot === undefined) delete process.env.STORAGE_ROOT_OVERRIDE;
      else process.env.STORAGE_ROOT_OVERRIDE = previousRoot;
    }
    assert.ok(fs.existsSync(file), '`ensure` връща файла от шаблона');
    const restored = config.read(file, { slug: 'p-shablon' });
    assert.deepEqual(restored.problems, [], 'възстановеният файл е валиден');
    assert.equal(restored.data.name, 'Име от панела', 'възстановеният файл носи текущото име');

    // ── 5. Нова папка от панела слага описанието в корена на портала ───────
    // С `portal_folder_copy` ИЗКЛЮЧЕНО (по подразбиране) папката на портала още я няма.
    // Щом човекът създаде папка, коренът съществува — и в него трябва да стои описанието,
    // иначе „портал с папка, но без описание“ е състояние без обяснение.
    const bare = await server.api('/admin/api/portals', 'POST', { title: 'Без папка', slug: 'p-bez-papka', visibility: 'private' });
    assert.equal(bare.status, 201, 'вторият портал се създава');
    const barePortal = bare.data.portal || bare.data;
    const bareLogical = String(barePortal.storage_root || '').replace(/^\/+/, '');
    const bareDir = path.join(storage.dir, ...bareLogical.split('/').filter(Boolean));
    const bareFile = path.join(bareDir, 'configuration.yaml');
    // Папката се маха, за да е същото състояние като при `portal_folder_copy: false` —
    // порталът съществува, а папката му още не.
    fs.rmSync(bareDir, { recursive: true, force: true });
    assert.equal(fs.existsSync(bareDir), false, 'порталът е без папка преди действието');
    const folderMade = await server.api('/admin/api/portals/' + encodeURIComponent(barePortal.id) + '/tree/folder', 'POST', { name: 'Документи' });
    assert.equal(folderMade.status, 201, 'папката се създава: ' + JSON.stringify(folderMade.data).slice(0, 200));
    assert.ok(fs.existsSync(bareFile), 'новата папка носи и описанието на портала');
    const bareRead = config.read(bareFile, { slug: 'p-bez-papka' });
    assert.deepEqual(bareRead.problems, [], 'описанието е валидно: ' + JSON.stringify(bareRead.problems));
    assert.equal(bareRead.data.name, 'Без папка', 'самоличността идва от портала');

    console.log(
      'PASS portal-config-template: файл при създаването · всички ' + config.OPTION_KEYS.length + ' опции от един шаблон · ' +
        'самоличност от портала · PATCH от панела стига до файла · изтрит файл се възстановява · нова папка носи описанието',
    );
  } finally {
    await server.stop();
    fs.rmSync(storage.dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error('FAIL portal-config-template: ' + error.message);
  process.exitCode = 1;
});
