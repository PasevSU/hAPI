'use strict';
// Заключването на данните пише през `rename`, а на Windows `rename` пада с EPERM/EBUSY, когато
// антивирусната или индексаторът държи новия файл за миг. Затова записът има повторен опит.
//
// Тук се проверява:
//   • повторен опит СЪЩЕСТВУВА и в двата режима — изключителен (`acquire`/`heartbeat`) и
//     споделен (`joinShared`), защото старият код имаше опит само в първия, а споделеният
//     режим е този, в който НЯКОЛКО процеса пишат в една папка;
//   • опитите са ОГРАНИЧЕНИ — упорит отказ се предава нагоре, вместо да върти вечно;
//   • изчакването е истинско (спира процеса, не гори процесор), тоест между опитите минава
//     поне обещаното време, а не нула;
//   • повреден/нечетим файл на заключването не блокира старта (старото поведение се пази).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lock = require('../hapi_enterprise/instance-lock');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-lock-'));
const originalRename = fs.renameSync;
const eperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

/** Проваля `times` пъти с EPERM, после пуска истинския `rename`. */
function failTimes(times) {
  let left = times;
  fs.renameSync = (from, to) => {
    if (left > 0) { left -= 1; throw eperm() }
    return originalRename(from, to);
  };
}

try {
  // ── 1. Изключителен режим: повторният опит пази сърцебиенето ──────────────
  const first = lock.acquire({ dir: root, id: 'instance-a' });
  assert.equal(first.ok, true, 'първото заключване се взима');
  failTimes(1);
  const beat = lock.heartbeat(root, { id: 'instance-a', now: Date.now() + 5000 });
  fs.renameSync = originalRename;
  assert.equal(beat, true, 'сърцебиенето минава след един EPERM (повторен опит)');
  assert.ok(lock.inspect(root).heartbeatAt, 'сърцето е записано');

  // ── 2. Споделен режим: същият отказ не чупи регистрацията ────────────────
  // Старият код хвърляше тук, защото `writePeer` нямаше повторен опит.
  failTimes(2);
  const joined = lock.joinShared({ dir: root, id: 'peer-a' });
  fs.renameSync = originalRename;
  assert.equal(joined.ok, true, 'споделената регистрация минава след два EPERM');
  assert.ok(fs.existsSync(joined.file), 'файлът на участника е на място');
  assert.equal(JSON.parse(fs.readFileSync(joined.file, 'utf8')).id, 'peer-a', 'записът е четим и верен');
  assert.equal(lock.listShared({ dir: root }).filter((p) => p.id === 'peer-a').length, 1, 'участникът се вижда като жив');

  // ── 3. Изчакването е ИСТИНСКО, не въртене на нула милисекунди ────────────
  // Три отказа значат 15+30+45 ms изчакване; долната граница е 90 ms.
  failTimes(3);
  const startedAt = Date.now();
  const beat2 = lock.heartbeatShared({ dir: root, file: joined.file, id: 'peer-a' });
  const elapsed = Date.now() - startedAt;
  fs.renameSync = originalRename;
  assert.equal(beat2, true, 'сърцебиенето на участника минава');
  assert.ok(elapsed >= 85, `изчакването е истинско (изминали ${elapsed} ms, очаквани поне 90)`);

  // ── 4. Опитите са ограничени: упорит отказ се предава нагоре ─────────────
  failTimes(50);
  assert.throws(() => lock.joinShared({ dir: root, id: 'peer-b' }), /EPERM/, 'след изчерпани опити грешката се вижда');
  fs.renameSync = originalRename;

  // ── 5. Жив собственик заключва, мъртъв се поема ──────────────────────────
  const lockedOut = lock.acquire({ dir: root, id: 'instance-b' });
  assert.equal(lockedOut.ok, false, 'живото заключване не се дава на втори процес');
  assert.equal(lockedOut.reason, 'INSTANCE_LOCKED');
  fs.writeFileSync(lock.lockPath(root), JSON.stringify({ id: 'dead', pid: 999999, host: os.hostname(), startedAt: new Date(0).toISOString(), heartbeatAt: new Date(0).toISOString() }));
  const takeover = lock.acquire({ dir: root, id: 'instance-c' });
  assert.equal(takeover.ok, true, 'заключване на мъртъв процес се поема');
  assert.equal(takeover.tookOver, true);

  // ── 6. Нечетим файл на заключването не блокира старта ────────────────────
  fs.writeFileSync(lock.lockPath(root), '{ това не е JSON');
  const recovered = lock.acquire({ dir: root, id: 'instance-d' });
  assert.equal(recovered.ok, true, 'повредено заключване не спира старта');
  assert.equal(recovered.tookOver, true, 'поемането се отчита');

  console.log('PASS instance lock: повторен опит при EPERM и в двата режима, истинско изчакване, ограничени опити, поемане на мъртво/повредено заключване');
} finally {
  fs.renameSync = originalRename;
  fs.rmSync(root, { recursive: true, force: true });
}
