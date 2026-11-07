'use strict';
// Договор на хранилището: потребители, сесии, портални токени/сесии, връзки и уебхукове.
// Всяка проверка твърди ОЧАКВАН РЕЗУЛТАТ (стойност/форма/брой), не „има поле“.
// Правилото на файла: нито един достъпващ метод на `open()` не остава без извикване.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { open } = require('../hapi_enterprise/sqlite-store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-store-'));
const file = path.join(dir, 'db.json');
const iso = (ms) => new Date(Date.now() + ms).toISOString();
try {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const store = open(file);
  store.load();

  // ── A. Потребители ────────────────────────────────────────────────────────
  assert.deepEqual(store.listUsers(), [], 'A01 празно хранилище: няма потребители');
  store.createUser('alice', 'hash-a', ['read']);
  store.createUser('bob', 'hash-b');
  assert.deepEqual(store.listUsers().map((u) => u.username), ['alice', 'bob'], 'A02 списъкът е подреден по име');
  assert.deepEqual(store.getUser('alice').scopes, ['read'], 'A03 скопоумите се връщат като масив');
  assert.deepEqual(store.getUser('bob').scopes, ['read', 'download'], 'A04 без скопоуми → подразбиращите се две');
  assert.equal(store.getUser('bob').active, true, 'A05 новият потребител е активен');
  assert.equal(store.getUser('nobody'), null, 'A06 липсващ потребител → null, не изключение');
  assert.equal(store.updateUser('nobody', {}), false, 'A07 обновяване на липсващ → false');
  assert.equal(store.updateUser('bob', { scopes: ['admin'] }), true, 'A08 обновяване на съществуващ → true');
  assert.deepEqual(store.getUser('bob').scopes, ['admin'], 'A09 скопоумите са сменени');
  assert.equal(store.getUser('bob').passwordHash, 'hash-b', 'A10 непоисканото поле се запазва');
  store.updateUser('bob', { active: false });
  assert.equal(store.getUser('bob').active, false, 'A11 деактивирането се записва');

  // ── B. Сесии ──────────────────────────────────────────────────────────────
  store.createSession('tok-alice', 'alice', iso(60_000));
  const s = store.getSession('tok-alice');
  assert.equal(s.username, 'alice', 'B01 сесията връща потребителя');
  assert.deepEqual(s.scopes, ['read'], 'B02 скопоумите идват от потребителя, не от сесията');
  assert.equal(store.getSession('tok-alice').tokenHash, 'tok-alice', 'B03 хешът се връща обратно');
  store.createSession('tok-bob', 'bob', iso(60_000));
  assert.equal(store.getSession('tok-bob'), null, 'B04 деактивиран потребител не получава сесия');
  store.createSession('tok-expired', 'alice', iso(-1000));
  assert.equal(store.getSession('tok-expired'), null, 'B05 изтекла сесия → null');
  assert.equal(store.getSession('tok-expired'), null, 'B06 изтеклата сесия е изтрита, не само скрита');
  store.createSession('tok-forever', 'alice', null);
  store.deleteSession('tok-forever');
  assert.equal(store.getSession('tok-forever'), null, 'B07 изтритата сесия я няма');
  assert.equal(store.deleteSession('tok-forever'), false, 'B08 повторно изтриване → false');
  store.createSession('tok-a2', 'alice', iso(-500));
  store.createSession('tok-a3', 'alice', iso(-500));
  store.purgeExpiredSessions();
  assert.equal(store.getSession('tok-a2'), null, 'B09 чистенето маха изтеклите');
  assert.equal(store.getSession('tok-alice').username, 'alice', 'B10 чистенето не пипа валидните');
  store.createSession('tok-a4', 'alice', iso(60_000));
  store.deleteUserSessions('alice');
  assert.equal(store.getSession('tok-alice'), null, 'B11 изтриването по потребител маха всичките му сесии');
  assert.equal(store.getSession('tok-a4'), null, 'B12 …и втората също');

  // ── C. Портални токени ────────────────────────────────────────────────────
  store.createPortalToken({ id: 'pt1', portalId: 'p1', tokenHash: 'h1', scopes: ['read'], label: 'етап 1', maxUses: 2 });
  const t = store.getPortalTokenByHash('h1');
  assert.equal(t.id, 'pt1', 'C01 токенът се намира по хеш');
  assert.equal(t.maxUses, 2, 'C02 лимитът се връща като число');
  assert.equal(t.uses, 0, 'C03 новият токен е с нула отваряния');
  assert.equal(t.revokedAt, null, 'C04 новият токен не е отнет');
  assert.equal(t.label, 'етап 1', 'C05 етикетът се запазва');
  assert.equal(store.usePortalToken('pt1'), true, 'C06 първо отваряне → true');
  assert.equal(store.usePortalToken('pt1'), true, 'C07 второ отваряне → true');
  assert.equal(store.usePortalToken('pt1'), false, 'C08 трето отваряне над лимита → false');
  assert.equal(store.getPortalTokenByHash('h1').uses, 2, 'C09 броячът стига точно до лимита');
  store.createPortalToken({ id: 'pt2', portalId: 'p1', tokenHash: 'h2' });
  assert.equal(store.getPortalTokenByHash('h2').maxUses, null, 'C10 без лимит → null');
  for (let i = 0; i < 5; i++) assert.equal(store.usePortalToken('pt2'), true, 'C11 без лимит отварянията не свършват');
  store.createPortalToken({ id: 'pt3', portalId: 'p1', tokenHash: 'h3' });
  store.createPortalToken({ id: 'pt4', portalId: 'p2', tokenHash: 'h4' });
  assert.deepEqual(store.listPortalTokens('p1').map((x) => x.id).sort(), ['pt1', 'pt2', 'pt3'], 'C12 списъкът е само за портала');
  assert.equal(store.getPortalTokenByHash('nope'), null, 'C13 непознат хеш → null');

  // ── D. Портални сесии и отнемане ──────────────────────────────────────────
  store.createPortalSession('ps1', { tokenId: 'pt3', portalId: 'p1', expiresAt: iso(60_000) });
  assert.equal(store.getPortalSession('ps1').portalId, 'p1', 'D01 сесията знае портала');
  assert.deepEqual(store.getPortalSession('ps1').scopes, ['read'], 'D02 скопоумите идват от токена');
  assert.equal(store.revokePortalToken('pt3'), true, 'D03 отнемането на токен → true');
  assert.equal(store.getPortalSession('ps1'), null, 'D04 отнемането убива и сесиите от него');
  assert.equal(store.revokePortalToken('pt3'), false, 'D05 повторното отнемане не променя нищо → false (моментът на отнемане не се презаписва)');
  assert.equal(store.getPortalTokenByHash('h3').revokedAt !== null, true, 'D06 отнетият токен носи момент на отнемане');
  store.createPortalToken({ id: 'pt5', portalId: 'p1', tokenHash: 'h5' });
  store.createPortalSession('ps5', { tokenId: 'pt5', portalId: 'p1', expiresAt: iso(60_000) });
  store.createPortalSession('ps5-exp', { tokenId: 'pt5', portalId: 'p1', expiresAt: iso(-1000) });
  assert.equal(store.getPortalSession('ps5-exp'), null, 'D07 изтекла портална сесия → null');
  store.createPortalSession('ps5-exp2', { tokenId: 'pt5', portalId: 'p1', expiresAt: iso(-1000) });
  store.purgeExpiredPortalAccess();
  assert.equal(store.getPortalSession('ps5-exp2'), null, 'D08 чистенето маха изтеклите сесии');
  assert.equal(store.getPortalSession('ps5').portalId, 'p1', 'D09 чистенето пази валидните');
  assert.equal(store.deletePortalSession('ps5'), true, 'D10 изтриване на сесия → true');
  assert.equal(store.deletePortalSession('ps5'), false, 'D11 повторно изтриване → false');

  // ── E. Връзки потребител ↔ портал ─────────────────────────────────────────
  assert.deepEqual(store.getUserPortals('alice'), [], 'E01 без връзки → празен списък');
  assert.deepEqual(store.setUserPortals('alice', ['p1', 'p2']), ['p1', 'p2'], 'E02 задаването връща новия списък');
  assert.deepEqual(store.getUserPortals('alice'), ['p1', 'p2'], 'E03 …и той се чете обратно');
  store.setUserPortals('alice', ['p2']);
  assert.deepEqual(store.getUserPortals('alice'), ['p2'], 'E04 задаването ЗАМЕСТВА, не добавя');
  store.setUserPortals('alice', []);
  assert.deepEqual(store.getUserPortals('alice'), [], 'E05 празен списък изчиства връзките');
  assert.deepEqual(store.getPortalUsers('p1'), [], 'E06 портал без потребители → празен списък');
  assert.deepEqual(store.setPortalUsers('p1', ['alice', 'bob']), ['alice', 'bob'], 'E07 задаването по портал връща списъка');
  store.setPortalUsers('p1', ['bob']);
  assert.deepEqual(store.getPortalUsers('p1'), ['bob'], 'E08 …и замества');

  // ── F. Уебхукове и опашка от доставки ─────────────────────────────────────
  assert.deepEqual(store.listWebhooks(), [], 'F01 без уебхукове → празен списък');
  const wh = store.createWebhook({ url: 'https://example.test/hook', events: ['release', 'error'], label: 'тест', secretHash: 'sh', secretHint: 'ab12' });
  assert.match(wh.id, /^wh_[0-9a-f]{18}$/, 'F02 идентификаторът има формата wh_ + 18 hex');
  assert.deepEqual(wh.events, ['release', 'error'], 'F03 събитията се връщат като масив');
  assert.equal(wh.disabled, false, 'F04 новият уебхук е активен');
  assert.equal(wh.failures, 0, 'F05 броячът на провалите е нула');
  assert.equal(store.getWebhook(wh.id).label, 'тест', 'F06 четенето по ид връща същия запис');
  assert.equal(store.listWebhooks().length, 1, 'F07 списъкът вижда един');
  assert.equal(store.setWebhookDisabled(wh.id, true), true, 'F08 изключването → true');
  assert.equal(store.getWebhook(wh.id).disabled, true, 'F09 флагът е записан');
  store.setWebhookDisabled(wh.id, false);
  assert.equal(store.touchWebhook(wh.id, { status: 201, failures: 3 }), true, 'F10 докосването → true');
  assert.equal(store.getWebhook(wh.id).lastStatus, 201, 'F11 последният статус е число');
  assert.equal(store.getWebhook(wh.id).failures, 3, 'F12 броячът на провалите се записва');
  const d1 = store.enqueueWebhookDelivery({ webhookId: wh.id, event: 'release', body: '{}' });
  assert.match(d1, /^wd_[0-9a-f]{18}$/, 'F13 доставката има формата wd_ + 18 hex');
  assert.equal(store.countPendingWebhookDeliveries(), 1, 'F14 една чакаща доставка');
  const due = store.dueWebhookDeliveries(iso(1000), 10);
  assert.equal(due.length, 1, 'F15 настъпилата доставка е в списъка');
  assert.equal(due[0].event, 'release', 'F16 …с правилното събитие');
  assert.equal(due[0].attempts, 0, 'F17 …и нула опита');
  assert.equal(store.completeWebhookDelivery(d1), true, 'F18 успешното приключване → true');
  assert.equal(store.countPendingWebhookDeliveries(), 0, 'F19 приключената доставка излиза от опашката');
  assert.equal(store.completeWebhookDelivery(d1), false, 'F20 повторно приключване → false');
  const d2 = store.enqueueWebhookDelivery({ webhookId: wh.id, event: 'error', body: '{"e":1}' });
  assert.equal(store.failWebhookDelivery(d2, { status: 500, error: 'timeout', attempts: 1 }), true, 'F21 провалът се записва → true');
  assert.equal(store.getWebhook(wh.id).failures, 1, 'F22 успешната доставка (F18) нулира брояча, затова провалът дава 1, не 4');
  assert.equal(store.getWebhook(wh.id).lastStatus, 500, 'F23 …и оставя статуса');
  assert.equal(store.countPendingWebhookDeliveries(), 1, 'F24 провалената, но неизчерпана доставка остава в опашката');
  assert.equal(store.purgeWebhookDeliveries(iso(1000)), 0, 'F25 чистенето не пипа неизчерпани доставки (те още се пробват)');
  assert.equal(store.countPendingWebhookDeliveries(), 1, 'F26 …и тя си стои в опашката');
  assert.equal(store.failWebhookDelivery(d2, { status: 500, error: 'timeout', attempts: 4, exhausted: true }), true, 'F27 изчерпването се записва');
  assert.equal(store.countPendingWebhookDeliveries(), 0, 'F28 изчерпаната доставка излиза от „чакащи“');
  assert.equal(store.purgeWebhookDeliveries(iso(1000)), 1, 'F29 чистенето маха изчерпаната доставка');
  assert.equal(store.getWebhook(wh.id).failures, 2, 'F30 вторият провал вдига брояча на 2');
  assert.equal(store.deleteWebhook(wh.id), true, 'F27 изтриване → true');
  assert.equal(store.getWebhook(wh.id), null, 'F28 изтритият уебхук → null');
  assert.equal(store.deleteWebhook(wh.id), false, 'F29 повторно изтриване → false');

  // ── G. Изтриване на потребител маха и сесиите му (външен ключ) ─────────────
  store.createSession('tok-del', 'alice', iso(60_000));
  assert.equal(store.deleteUser('alice'), true, 'G01 изтриване на потребител → true');
  assert.equal(store.getUser('alice'), null, 'G02 …го няма');
  assert.equal(store.getSession('tok-del'), null, 'G03 …и сесията му пада каскадно');
  assert.equal(store.deleteUser('alice'), false, 'G04 повторно изтриване → false');
  assert.equal(store.getPortalUsers('p1').includes('alice'), false, 'G05 връзките към портала също падат');

  store.close();
  console.log('PASS store-accessors: 93 твърдения върху 28 достъпващи метода · потребители, сесии, портални токени/сесии, връзки, уебхукове');
} finally {
  // Windows държи WAL файла още миг след close(); чистенето не бива да маскира провалена проверка.
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch (e) { console.error('cleanup: ' + e.code + ' ' + dir) }
}
