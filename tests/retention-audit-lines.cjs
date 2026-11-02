'use strict';
// Политиката за задържане трие одитни редове по възраст. Ред, който НЕ може да се прочете или
// датира, не бива да изчезва: той е следа от прекъснат запис, а не изтекъл запис — и точно
// такъв ред най-често е доказателството, че нещо се е объркало.
//
// Проверява се и че отчетът съвпада с действието: `preview` брои само датируемите изтекли
// редове, `apply` трябва да изтрие СЪЩО ТОЛКОВА. Старата реализация триеше и нечетимите и
// казваше, че са „изтекли по възраст“.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const retention = require('../hapi_enterprise/retention');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-retention-'));
const day = 86400000;
const auditPath = path.join(root, 'audit.jsonl');
const filesRoot = path.join(root, 'files');
fs.mkdirSync(filesRoot, { recursive: true });

const oldLine = JSON.stringify({ at: new Date(Date.now() - 5 * day).toISOString(), event: 'стар' });
const newLine = JSON.stringify({ at: new Date().toISOString(), event: 'нов' });
const corrupt = '{"at": "не-дата"'; // прекъснат запис (невалиден JSON)
const undated = JSON.stringify({ event: 'без дата' }); // валиден JSON, но без `at`
fs.writeFileSync(auditPath, [oldLine, newLine, corrupt, undated].join('\n') + '\n');

const mod = retention.create({
  filesRoot,
  auditPath,
  getSettings: () => ({ retention: { enabled: true, fileDays: null, auditDays: 1, fileAction: 'disable' } }),
});

(async () => {
  try {
    // 1. Отчетът брои САМО датируемия изтекъл ред.
    const preview = await mod.preview([]);
    assert.equal(preview.auditLinesExpired, 1, 'изтекъл е само старият ред');

    // 2. Действието прави същото, което отчетът казва.
    const applied = await mod.apply([]);
    assert.equal(applied.auditLinesPruned, 1, 'изтрит е само старият ред, а не три');
    assert.equal(applied.auditLinesPruned, preview.auditLinesExpired, 'отчет и действие съвпадат');

    const left = fs.readFileSync(auditPath, 'utf8').split('\n').filter(Boolean);
    assert.equal(left.length, 3, 'остават новият, повреденият и недатираният ред');
    assert.ok(left.includes(newLine), 'новият ред е на място');
    assert.ok(left.includes(corrupt), 'ПОВРЕДЕНИЯТ ред оцелява — не се трие това, което не се чете');
    assert.ok(left.includes(undated), 'редът без дата оцелява — възрастта му е неизвестна');
    assert.ok(!left.includes(oldLine), 'старият ред е изтрит');

    // 3. Нищо за триене → файлът не се пипа (без излишен запис по диска).
    const before = fs.readFileSync(auditPath, 'utf8');
    const again = await mod.apply([]);
    assert.equal(again.auditLinesPruned, 0, 'вторият опит не намира изтекли редове');
    assert.equal(fs.readFileSync(auditPath, 'utf8'), before, 'файлът остава байт-в-байт същият');

    // 4. Хеш-веригата НЕ се пипа, дори когато политиката е включена (договор на модула).
    const chainPath = path.join(root, 'audit-chain.jsonl');
    fs.writeFileSync(chainPath, '{"seq":1}\n');
    await mod.apply([]);
    assert.equal(fs.readFileSync(chainPath, 'utf8'), '{"seq":1}\n', 'веригата на одита не се съкращава');

    console.log('PASS retention audit lines: трие се само датируемият изтекъл ред, повреденият и недатираният оцеляват, отчет = действие, веригата не се пипа');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
