'use strict';
// Виртуално хранилище: пътища, дърво, колизии, защита срещу изход от дървото.
const assert = require('node:assert/strict');
const vs = require('../hapi_enterprise/virtual-storage.js');

// 1. Каноничен път: topic → category → group → име.
assert.equal(
  vs.virtualPath({ name: 'protokol.pdf', topic: 'Дело 2026-114', category: 'Доказателства', group: 'Том 1' }),
  '/Дело 2026-114/Доказателства/Том 1/protokol.pdf',
);
assert.equal(vs.virtualPath({ name: 'readme.txt' }), '/readme.txt');
assert.equal(vs.virtualPath({ name: 'a.pdf', topic: '', category: 'Доказателства', group: '' }), '/Доказателства/a.pdf');

// 2. Саниране: забранени знаци, .. и празни сегменти.
assert.equal(vs.sanitizeSegment('a/b'), 'a_b');
assert.equal(vs.sanitizeSegment('..'), '');
assert.equal(vs.sanitizeSegment('  '), '');
assert.equal(vs.virtualPath({ name: 'a/../../b.pdf' }), '/a_.._.._b.pdf');
assert.equal(vs.virtualPath({ name: 'x'.repeat(200) }).length <= 122, true);

// 3. Дърво: брой папки/файлове и сортиране.
const files = [
  { id: '1', name: 'protokol.pdf', size: 100, topic: 'Дело 2026-114', category: 'Доказателства', group: 'Том 1' },
  { id: '2', name: 'protokol.pdf', size: 200, topic: 'Дело 2026-114', category: 'Доказателства', group: 'Том 1' },
  { id: '3', name: 'pokazaniya.docx', topic: 'Дело 2026-114', category: 'Показания' },
  { id: '4', name: 'root.txt' },
  { id: '5', name: 'skryt.pdf', listed: false },
];
const tree = vs.buildTree(files);
assert.equal(tree.virtual, true);
assert.equal(tree.root, '/');
assert.equal(tree.fileCount, 4, 'скритите файлове не се броят');
assert.equal(tree.folderCount, 4, 'Дело → Доказателства → Том 1, плюс Показания');
assert.equal(tree.tree.folders[0].name, 'Дело 2026-114');
assert.equal(tree.tree.files[0].name, 'root.txt');

// 4. Колизия: второто едно имено става „ (2)“.
const flat = vs.flatten(tree);
const same = flat.filter((f) => f.name.startsWith('protokol'));
assert.equal(same.length, 2);
assert.ok(same.some((f) => f.name === 'protokol (2).pdf'));
assert.deepEqual(new Set(same.map((f) => f.path)).size, 2);

// 5. resolve: папка, файл, корен.
assert.equal(vs.resolve(tree, '/').path, '/');
assert.equal(vs.resolve(tree, '/Дело 2026-114').type, 'folder');
assert.equal(vs.resolve(tree, '/Дело 2026-114/Доказателства/Том 1/protokol (2).pdf').type, 'file');
assert.equal(vs.resolve(tree, '/root.txt').name, 'root.txt');

// 6. resolve: невалидни пътища → null (без изход от дървото).
assert.equal(vs.resolve(tree, '/..'), null);
assert.equal(vs.resolve(tree, '/../../etc/passwd'), null);
assert.equal(vs.resolve(tree, '/Дело 2026-114/../../etc'), null);
assert.equal(vs.resolve(tree, 'relative/path'), null);
assert.equal(vs.resolve(tree, '//'), null);
assert.equal(vs.resolve(tree, '/Дело 2026-114/Доказателства/Том 1').type, 'folder');
assert.equal(vs.resolve(tree, '/nope'), null);

// 7. flatten: parent папка за всеки файл.
const rootFile = vs.flatten(tree).find((f) => f.name === 'root.txt');
assert.equal(rootFile.parent, '/');
const deep = vs.flatten(tree).find((f) => f.name === 'protokol.pdf');
assert.equal(deep.parent, '/Дело 2026-114/Доказателства/Том 1');

// 8. Празен вход → празно дърво.
const empty = vs.buildTree([]);
assert.equal(empty.fileCount, 0);
assert.equal(empty.folderCount, 0);
assert.equal(empty.tree.path, '/');

console.log('virtual-storage OK');
