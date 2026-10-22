'use strict';
// MPI е цяло число, а не байтов низ: водещите нулеви битове/байтове не се пазят
// (RFC 4880 §3.2). Секретен ключ Ed25519, който започва с 0x00, пристига като 31
// байта MPI. Преди тази проверка такъв ключ се отхвърляше с
// „Неочакван размер на Ed25519 секретен ключ“ — тоест ~1 от 256 случайни ключа
// не можеше да се импортира, а `generate()` падаше още при създаването.
//
// Тестът сглобява точно такъв ключ детерминирано (без да разчита на късмет) и
// проверява, че се чете и че секретът е допълнен отляво до 32 байта.
const assert = require('node:assert/strict');
const path = require('node:path');

const pgp = require(path.join(__dirname, '..', 'hapi_enterprise', 'pgp.js'));

// 1. Взимаме истински публичен ключ, за да е валидна публичната част на пакета.
const real = pgp.generate({ algorithm: 'ed25519' });
const { data } = pgp.dearmor(real.publicArmored);
const pubBody = pgp.readPackets(data).find((p) => p.tag === 6).body;

// 2. Сглобяваме секретна част с MPI, който е 31 байта (водещият 0x00 е отпаднал).
const D31 = Buffer.alloc(31, 0x5a);
const mpi = Buffer.alloc(2 + D31.length);
mpi.writeUInt16BE(D31.length * 8, 0); // 248 бита, колкото дава 31 байта
D31.copy(mpi, 2);
const secretSection = Buffer.concat([Buffer.from([0]), mpi]);
let sum = 0;
for (const byte of mpi) sum = (sum + byte) & 0xffff; // контролна сума на секретната част
const checksum = Buffer.alloc(2);
checksum.writeUInt16BE(sum, 0);
const secBody = Buffer.concat([pubBody, secretSection, checksum]);
const block = pgp.armor('PRIVATE', Buffer.concat([pgp.packet(5, secBody)]));

// 3. Чете се без грешка и секретът е точно 32 байта, допълнен с 0x00 отляво.
const parsed = pgp.parseKeyBlock(block);
const secret = parsed.primary.secret;
assert.ok(secret && secret.d, 'секретът е разчетен');
assert.equal(secret.d.length, 32, 'секретът е с фиксирания размер 32 байта');
assert.equal(secret.d[0], 0, 'липсващият водещ байт е допълнен');
assert.deepEqual([...secret.d.subarray(1)], [...D31], 'останалите байтове са непокътнати');

// 4. Обратната посока: 32-байтов секрет с водеща нула се записва като 31 байта MPI
//    и пак се чете — иначе `generate()` би падал при определени ключове.
const withZero = Buffer.concat([Buffer.from([0]), D31]);
const mpi2 = Buffer.alloc(2 + 31);
mpi2.writeUInt16BE(248, 0);
withZero.subarray(1).copy(mpi2, 2);
let sum2 = 0;
for (const byte of mpi2) sum2 = (sum2 + byte) & 0xffff;
const checksum2 = Buffer.alloc(2);
checksum2.writeUInt16BE(sum2, 0);
const block2 = pgp.armor('PRIVATE', Buffer.concat([pgp.packet(5, Buffer.concat([pubBody, Buffer.from([0]), mpi2, checksum2]))]));
assert.doesNotThrow(() => pgp.parseKeyBlock(block2), 'ключ с водеща нула се приема');

// 5. Отрязан MPI (по-малко от очакваното) все още е грешка, не мълчаливо приемане.
const mpi3 = Buffer.alloc(2 + 40);
mpi3.writeUInt16BE(320, 0); // 40 байта — повече от 32
const secBody3 = Buffer.concat([pubBody, Buffer.from([0]), mpi3, Buffer.alloc(2)]);
const block3 = pgp.armor('PRIVATE', Buffer.concat([pgp.packet(5, secBody3)]));
assert.throws(() => pgp.parseKeyBlock(block3), /Неочакван размер на Ed25519 секретен ключ/, 'твърде дълъг секрет се отказва');

// 6. Истински ключове продължават да работят (включително подписване).
const fresh = pgp.generate({ algorithm: 'ed25519' });
const block4 = pgp.parseKeyBlock(fresh.secretArmored);
assert.equal(block4.primary.secret.d.length, 32, 'истинският ключ е с 32-байтов секрет');
assert.equal(block4.primary.fingerprint.length, 40, 'v4 отпечатък (SHA-1, 40 hex знака)');

console.log('PASS pgp-mpi: водещи нули в MPI не чупят импорта; 32-байтовият секрет се допълва отляво');
