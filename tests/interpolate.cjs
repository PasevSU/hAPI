'use strict';
// `{{променлива}}` в това, което вижда получателят (BUG-04 от плана).
//
// Проверява се и модулът, и живият сървър: име/описание/забележки на портал и имейл за
// връзка се разгъват със стойности от картотеката, вградените дати работят, липсващата
// променлива НЕ се трие (връща се като „липсва“), цикъл не зацикля, а файловите пътища
// остават буквални — там стойност от данни би била риск от обхождане на директории.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { stopChild, freePort } = require('./helpers.cjs');

const interp = require('../hapi_enterprise/interpolate.js');
const root = path.join(__dirname, '..');

// ── 1. Модулът: основни случаи ───────────────────────────────────────────────────
const ctx = interp.contextFrom(
  {
    publisher: { value: 'Община Пловдив' },
    support_email: { value: 'help@example.org' },
    chained: { value: 'Договор {{year}}' },
    loop_a: { value: '{{loop_b}}' },
    loop_b: { value: '{{loop_a}}' },
  },
  Date.UTC(2026, 9, 22),
);

const simple = interp.render('Договор {{year}} — {{publisher}}', ctx);
assert.equal(simple.output, 'Договор 2026 — Община Пловдив', 'вградена и потребителска променлива');
assert.deepEqual(simple.missing, [], 'няма липси');
assert.equal(interp.render('Дата: {{date}} ({{day}}.{{month}})', ctx).output, 'Дата: 2026-10-22 (22.10)', 'датите са с нули');

const missing = interp.render('Здравей, {{непозната}}!', ctx);
assert.equal(missing.output, 'Здравей, {{непозната}}!', 'липсващата не се трие');
assert.deepEqual(missing.missing, [], 'кирилица не е валиден ключ, значи не е „липсваща“ променлива');
const missingAscii = interp.render('Здравей, {{unknown_key}}!', ctx);
assert.equal(missingAscii.output, 'Здравей, {{unknown_key}}!');
assert.deepEqual(missingAscii.missing, ['unknown_key'], 'липсващата се отчита');

assert.equal(interp.render('{{chained}}', ctx).output, 'Договор 2026', 'стъпка в стойност се разгъва');
const cycle = interp.render('{{loop_a}}', ctx);
assert.deepEqual(cycle.cycle, ['loop_a'], 'цикълът се отчита, вместо да зацикли');

assert.deepEqual(interp.placeholders('a {{x}} b {{x}} c {{y}}'), ['x', 'y'], 'имената са без повторения');
assert.equal(interp.render('нищо за смяна', ctx).output, 'нищо за смяна', 'текст без шаблон остава същият');
assert.equal(interp.render('', ctx).output, '', 'празен текст');
assert.equal(interp.render(null, ctx).output, '', 'null не гърми');

// ── 2. Живият сървър: име, описание, забележки и имейл ─────────────────────────────
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-interp-'));
  const port = await freePort();
  const token = 'interpolate-admin-token-123456789';
  const child = spawn(process.execPath, [path.join(root, 'hapi_enterprise', 'server.js')], {
    env: { ...process.env, DATA_DIR: dir, PORT: String(port), PUBLIC_GATEWAY_PORT: '0', ADMIN_TOKEN: token },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const admin = (p, init) =>
    fetch(base + p, { ...init, headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...((init && init.headers) || {}) } });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${base}/health`)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* сървърът още стартира */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    assert(ready, 'сървърът не стартира');

    // Променливи в картотеката (през реалното API на панела).
    for (const [key, value] of [
      ['publisher', 'Община Пловдив'],
      ['support_email', 'help@example.org'],
    ]) {
      const r = await admin('/admin/api/variables', { method: 'POST', body: JSON.stringify({ key, value }) });
      assert.equal(r.status, 201, 'променливата ' + key + ' е създадена');
    }

    // Контакт с имейл-шаблон и име с променлива (по плана: имена и имейли).
    const contact = await admin('/admin/api/directory/contacts', {
      method: 'POST',
      body: JSON.stringify({ email: '{{support_email}}', fields: { name: 'Служба {{publisher}}' } }),
    });
    const contactData = await contact.json();
    assert.equal(contact.status, 201, 'контактът е създаден: ' + JSON.stringify(contactData));
    const contactId = (contactData.contact && contactData.contact.id) || contactData.id;

    // Портал с шаблони в име, описание и забележки.
    const created = await admin('/admin/api/portals', {
      method: 'POST',
      body: JSON.stringify({
        slug: 'interp-portal',
        title: 'Договор {{year}} — {{publisher}}',
        description: 'Издаден от {{publisher}} на {{date}}',
        notes: 'Пиши на {{support_email}}',
        storage_root: '/share',
        visibility: 'public',
        contactId,
      }),
    });
    const portal = await created.json();
    assert.ok([200, 201].includes(created.status), 'порталът е създаден: ' + JSON.stringify(portal));
    const p = portal.portal || portal;
    const slug = p.slug || (p.portal && p.portal.slug);
    const portalId = p.id || (p.portal && p.portal.id);

    // Публичният изглед: разгънати текстове, но БЕЗ промяна на записа.
    const publicView = await (await fetch(`${base}/api/v1/p/${portalId}`)).json();
    const year = String(new Date().getUTCFullYear());
    assert.equal(publicView.title, `Договор ${year} — Община Пловдив`, 'името на портала е разгънато');
    assert.equal(publicView.description, `Издаден от Община Пловдив на ${interp.builtins(Date.now()).date}`, 'описанието е разгънато');
    assert.equal(publicView.notes, 'Пиши на help@example.org', 'забележките са разгънати');
    assert.equal(publicView.contact.email, 'help@example.org', 'имейлът за връзка е разгънат');
    assert.equal(publicView.contact.name, 'Служба Община Пловдив', 'името на контакта е разгънато');

    // Записът пази ШАБЛОНА, а не разгънатия текст: смяната на променливата веднага
    // променя публичното име (иначе годината щеше да „замръзне“ при създаването).
    const patched = await admin('/admin/api/variables/publisher', {
      method: 'PATCH',
      body: JSON.stringify({ value: 'Община Варна' }),
    });
    assert.equal(patched.status, 200, 'променливата е обновена');
    const afterChange = await (await fetch(`${base}/api/v1/p/${portalId}`)).json();
    assert.equal(afterChange.title, `Договор ${year} — Община Варна`, 'името следва променливата');
    assert.equal(afterChange.contact.name, 'Служба Община Варна', 'и контактът следва променливата');

    // Прегледът от панела: резултат + липсващи променливи, без запис.
    const preview = await admin('/admin/api/v2/interpolate', {
      method: 'POST',
      body: JSON.stringify({ template: '{{publisher}} · {{year}} · {{nope}}' }),
    });
    assert.equal(preview.status, 200, 'прегледът работи');
    const previewData = await preview.json();
    assert.equal(previewData.output, `Община Варна · ${year} · {{nope}}`, 'прегледът ползва актуалната стойност');
    assert.deepEqual(previewData.missing, ['nope'], 'липсващата се връща към панела');
    assert.deepEqual(previewData.placeholders, ['publisher', 'year', 'nope']);
    assert.equal((await fetch(`${base}/admin/api/v2/interpolate`, { method: 'POST', body: '{}' })).status, 401, 'прегледът иска токен');
    assert.equal((await admin('/admin/api/v2/interpolate', { method: 'POST', body: '{}' })).status, 400, 'без шаблон е 400');

    // Пътищата НЕ се интерполират: стойност от данни там би била обход на директории.
    const serverSrc = fs.readFileSync(path.join(root, 'hapi_enterprise', 'server.js'), 'utf8');
    assert.match(serverSrc, /storage_root: p\.storage_root \|\| '\/share'/, 'storage_root остава буквален в публичния изглед');
    assert.equal(/withVars\(\s*p\.storage_root/.test(serverSrc), false, 'storage_root не минава през интерполация');

    console.log('PASS interpolate: {{променлива}} в име/описание/имейл · вградени дати · липси и цикли · пътищата са буквални');
  } finally {
    await stopChild(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
