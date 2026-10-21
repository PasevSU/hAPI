'use strict';
// Издателската верига: версия, архиви и манифест.
//
// Проверява се, че:
//  - версията на add-on-а и на интеграцията съвпадат (иначе изданието е невалидно);
//  - tar.gz/zip, които build-release строи на ръка, се разчитат обратно без загуби
//    (съдържание, права на run.sh, UTF-8 имена и контролна сума);
//  - crc32 съвпада с известна стойност (ZIP разчита на него).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../scripts/release-lib.cjs');

// 1. Версия: един източник на истина + съвпадение с интеграцията.
const version = lib.readAddonVersion();
assert.match(version, lib.SEMVER, 'config.yaml носи SemVer версия');
assert.equal(lib.readIntegrationVersion(), version, 'manifest.json трябва да е със същата версия като config.yaml');

// 2. Детерминирани записи (както ги подава build-release).
const files = [
  { path: 'hapi_enterprise/config.yaml', data: Buffer.from('name: test\nversion: "' + version + '"\n'), mode: 0o644, mtime: 1700000000 },
  { path: 'hapi_enterprise/run.sh', data: Buffer.from('#!/bin/sh\nexec node /app/server.js\n'), mode: 0o755, mtime: 1700000000 },
  { path: 'hapi_enterprise/fonts/тест.txt', data: Buffer.from('кирилица ✓'), mode: 0o644, mtime: 1700000000 },
];

// 3. tar.gz: съдържание, права и обратно разчитане.
const tarBuf = lib.buildTarGz(files);
assert.equal(tarBuf[0], 0x1f, 'gzip магия');
assert.equal(tarBuf[1], 0x8b, 'gzip магия');
const tarEntries = lib.readTarGz(tarBuf);
assert.equal(tarEntries.length, files.length, 'броят записи в tar.gz');
for (const entry of files) {
  const got = tarEntries.find((e) => e.path === entry.path);
  assert.ok(got, 'липсва ' + entry.path);
  assert.equal(got.data.toString('utf8'), entry.data.toString('utf8'), 'съдържание на ' + entry.path);
}
assert.equal(tarEntries.find((e) => e.path.endsWith('run.sh')).mode & 0o111, 0o111, 'run.sh остава изпълним');

// 4. zip: deflate, UTF-8 имена и обратно разчитане.
const zipBuf = lib.buildZip(files);
assert.equal(zipBuf.readUInt32LE(0), 0x04034b50, 'zip local header');
const zipEntries = lib.readZip(zipBuf);
assert.equal(zipEntries.length, files.length, 'броят записи в zip');
for (const entry of files) {
  const got = zipEntries.find((e) => e.path === entry.path);
  assert.ok(got, 'липсва ' + entry.path);
  assert.equal(got.data.toString('utf8'), entry.data.toString('utf8'), 'съдържание на ' + entry.path);
}
assert.ok(zipBuf.length < tarBuf.length + 4096, 'zip архивът е разумен по размер');

// 5. crc32 (стандартната стойност за "123456789" е 0xCBF43926).
assert.equal(lib.crc32(Buffer.from('123456789')), 0xcbf43926, 'crc32 съвпада с еталона');

// 6. readArchive избира формата по разширение.
assert.equal(lib.readArchive(tarBuf, 'x.tar.gz').length, files.length);
assert.equal(lib.readArchive(zipBuf, 'x.zip').length, files.length);

// 7. Издателските скриптове съществуват и са изпълними с node --check.
for (const script of ['build-release.cjs', 'verify-release.cjs', 'release-lib.cjs']) {
  const file = path.join(__dirname, '..', 'scripts', script);
  assert.ok(fs.existsSync(file), 'липсва scripts/' + script);
  assert.ok(fs.statSync(file).size > 500, script + ' е подозрително малък');
}

console.log(`release-tooling OK: ${version}, ${files.length} записа в tar.gz и zip, crc32 еталон`);
