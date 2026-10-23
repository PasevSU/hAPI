'use strict';
// PasevSU DOCUMENT GENERATOR — ЖИВ ИНДЕКС, БЕЗ build-index.
//
// Правилата, които този тест пази:
//   • шаблоните се виждат веднага след качване и след ръчно копиране на диска (без рестарт
//     и без `tools/build-index.mjs`) — точно това беше ръчната стъпка, която можеше да забрави;
//   • съдържанието се сервира като `text/plain` с `nosniff`, тоест шаблон със скрипт не се
//     изпълнява от сървъра;
//   • имената са ограничени до `*.html` без наклонени черти и без водеща точка — опит за
//     излизане от папката се отказва;
//   • достъпът е само за административния listener: без токен → 401.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./lib/gui-harness.cjs');

const API = '/admin/api/generator/templates';

(async () => {
  const server = await startServer({});
  const dir = path.join(server.dir, 'generator', 'temp');
  try {
    // ── 1. Без токен няма индекс ─────────────────────────────────────────────
    const anon = await fetch(server.base + API);
    assert.equal(anon.status, 401, 'индексът иска автентикация');

    // ── 2. Началните шаблони са налице при първи старт ───────────────────────
    // Генератор без нито един шаблон е неизползваем: на add-on няма как да се сложи
    // файл в образа, затова изданието носи начални шаблони и ги копира веднъж.
    const initial = await server.api(API);
    assert.equal(initial.status, 200, 'с токен индексът се дава');
    assert.equal(initial.data.live, true, 'индексът е жив, не файл');
    const starters = initial.data.templates.map((t) => t.file).sort();
    assert.deepEqual(starters, ['blank.html', 'protocol.html', 'report.html'], 'началните шаблони се копират при първи старт');
    assert.ok(path.isAbsolute(initial.data.folderPath || ''), 'индексът показва реалния път на папката');
    assert.equal(initial.data.folderPath, dir, 'пътят сочи работната папка на генератора');

    // ── 3. Статиката на генератора се сервира с твърди заглавки ──────────────
    const page = await fetch(server.base + '/generator/');
    assert.equal(page.status, 200, 'страницата се сервира');
    const html = await page.text();
    assert.match(html, /Document Generator/, 'това е генераторът');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff', 'без MIME sniffing');
    assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/, 'скриптове само от себе си');
    const script = await fetch(server.base + '/generator/app.js');
    assert.equal(script.status, 200, 'app.js се сервира');
    assert.match(script.headers.get('content-type') || '', /javascript/, 'като JavaScript');
    const css = await fetch(server.base + '/generator/style.css');
    assert.equal(css.status, 200, 'style.css се сервира');

    // ── 4. Качване → веднага в индекса ───────────────────────────────────────
    const created = await server.api(API, 'POST', {
      name: 'dogovor.html',
      html: '<!doctype html><title>Договор за наем</title><p>Страни</p>',
    });
    assert.equal(created.status, 200, 'шаблонът се качва: ' + JSON.stringify(created.data));
    assert.equal(created.data.templates.length, starters.length + 1, 'индексът връща началните шаблони + новия');
    const uploaded = created.data.templates.find((t) => t.file === 'dogovor.html');
    assert(uploaded, 'каченият шаблон е в индекса');
    assert.equal(uploaded.title, 'Договор за наем', 'заглавието идва от <title>');

    // ── 5. Съдържанието се чете като текст, не като страница ─────────────────
    const one = await fetch(server.base + API + '/dogovor.html', {
      headers: { Authorization: 'Bearer ' + server.token },
    });
    assert.equal(one.status, 200, 'шаблонът се чете');
    assert.equal(one.headers.get('content-type'), 'text/plain; charset=utf-8', 'не се изпълнява от сървъра');
    assert.equal(one.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await one.text(), /Договор за наем/);

    // ── 6. Дубликат иска overwrite ───────────────────────────────────────────
    const duplicate = await server.api(API, 'POST', { name: 'dogovor.html', html: '<title>Друг</title>' });
    assert.equal(duplicate.status, 409, 'съществуващ шаблон не се презаписва тихо');
    const replaced = await server.api(API, 'POST', { name: 'dogovor.html', html: '<title>Ново заглавие</title>', overwrite: true });
    assert.equal(replaced.status, 200, 'с overwrite се заменя');
    assert.equal(replaced.data.templates.find((t) => t.file === 'dogovor.html').title, 'Ново заглавие');

    // ── 7. Опасни имена и не-HTML се отказват ────────────────────────────────
    for (const name of ['../izvan.html', 'podpapka/x.html', 'dokument.txt', '.skrit.html', 'x.html.exe']) {
      const bad = await server.api(API, 'POST', { name, html: '<p>x</p>' });
      assert.equal(bad.status, 400, 'името се отказва: ' + name);
    }
    const trav = await fetch(server.base + API + '/' + encodeURIComponent('../server.js'), {
      headers: { Authorization: 'Bearer ' + server.token },
    });
    assert.equal(trav.status, 400, 'път към чужд файл се отказва');

    // ── 8. Жив индекс: файл, сложен на диска, се вижда без рестарт ───────────
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'ot-disk.html'), '<title>Сложен на диска</title><p>Б</p>');
    const live = await server.api(API);
    assert.equal(live.status, 200);
    const files = live.data.templates.map((t) => t.file).sort();
    assert.deepEqual(files, [...starters, 'dogovor.html', 'ot-disk.html'].sort(), 'файлът от диска влиза в индекса веднага');
    const fromDisk = live.data.templates.find((t) => t.file === 'ot-disk.html');
    assert.equal(fromDisk.title, 'Сложен на диска', 'заглавието се чете от самия файл');

    // ── 9. Изтриване → изчезва от индекса; повторно → 404 ────────────────────
    const removed = await server.api(API + '/ot-disk.html', 'DELETE');
    assert.equal(removed.status, 200, 'шаблонът се изтрива');
    assert.deepEqual(removed.data.templates.map((t) => t.file).sort(), [...starters, 'dogovor.html'].sort(), 'след изтриване остават началните и качения');
    const again = await server.api(API + '/ot-disk.html', 'DELETE');
    assert.equal(again.status, 404, 'липсващ шаблон не се изтрива „успешно“');
    assert.equal(fs.existsSync(path.join(dir, 'ot-disk.html')), false, 'файлът е махнат от диска');

    // ── 10. Сийдът не презаписва и може да се изключи ────────────────────────
    // Редактиран шаблон не бива да се връща към фабричния при рестарт.
    const factory = require('../hapi_enterprise/generator');
    const rescanned = factory.create({ root: server.dir }).seed();
    assert.deepEqual(rescanned.copied, [], 'съществуващи шаблони не се презаписват');
    assert.equal(rescanned.skipped, true, 'при налични шаблони сийдът не прави нищо');

    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-gen-empty-'));
    process.env.GENERATOR_SEED = 'off';
    let off;
    try {
      off = factory.create({ root: emptyRoot }).seed();
    } finally {
      delete process.env.GENERATOR_SEED;
    }
    assert.equal(off.skipped, true, 'сийдът може да се изключи с GENERATOR_SEED=off');
    assert.equal(fs.existsSync(path.join(emptyRoot, 'generator', 'temp')), false, 'при изключен сийд папка не се създава');
    fs.rmSync(emptyRoot, { recursive: true, force: true });

    console.log(
      'PASS generator-app: жив индекс без build-index · качване/замяна/изтриване · text/plain + nosniff · имената и пътищата се проверяват · 401 без токен',
    );
  } finally {
    await server.stop().catch(() => { });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
