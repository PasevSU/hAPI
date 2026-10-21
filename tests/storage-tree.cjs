'use strict';
// Дърво на папка от хранилището: нормализация на пътища, броячи, търсене и
// съвместимост с виртуалното дърво (topic → category → group).
const assert = require('node:assert/strict');
const st = require('../hapi_enterprise/storage-tree.js');
const vs = require('../hapi_enterprise/virtual-storage.js');

// 1. Нормализация на относителен път.
assert.equal(st.normRel(''), '');
assert.equal(st.normRel('/'), '');
assert.equal(st.normRel('/a/b/'), 'a/b');
assert.equal(st.normRel('a\\b'), 'a/b');
assert.equal(st.normRel('../etc'), null);
assert.equal(st.normRel('/a/../b'), null);
assert.equal(st.normRel('a//b'), null);
assert.equal(st.normRel('a\u0000b'), null);
assert.equal(st.normRel(Array.from({ length: st.MAX_DEPTH + 1 }, (_, i) => 'd' + i).join('/')), null);

// 2. Строи дърво от плоски записи.
const tree = st.build([
  { path: 'sub/deep/data.csv', size: 12 },
  { path: 'readme.txt', size: 5 },
  { path: 'sub/notes.txt', size: 7 },
  { path: '/sub/notes.txt', size: 7 }, // дубликат
  { path: '../escape.txt', size: 1 }, // невалиден
]);
assert.equal(tree.type, 'folder');
assert.equal(tree.path, '');
assert.deepEqual(tree.folders.map((f) => f.name), ['sub']);
assert.deepEqual(tree.files.map((f) => f.name), ['readme.txt']);
const sub = tree.folders[0];
assert.equal(sub.path, 'sub');
assert.equal(sub.folderCount, 1, 'една подпапка');
assert.equal(sub.fileCount, 2, 'два файла (дубликатът не се брои)');
assert.equal(sub.bytes, 19, '12 + 7');
assert.equal(sub.folders[0].path, 'sub/deep');
assert.equal(sub.folders[0].files[0].path, 'sub/deep/data.csv');
assert.equal(tree.folderCount, 2);
assert.equal(tree.fileCount, 3);
assert.equal(tree.bytes, 24);

// 3. Търсене по път.
assert.equal(st.resolve(tree, '').name, '/');
assert.equal(st.resolve(tree, '/').name, '/');
assert.equal(st.resolve(tree, 'sub').name, 'sub');
assert.equal(st.resolve(tree, '/sub/deep/data.csv').type, 'file');
assert.equal(st.resolve(tree, 'sub/deep/data.csv').size, 12);
assert.equal(st.resolve(tree, 'nope'), null);
assert.equal(st.resolve(tree, '../x'), null);
assert.equal(st.resolve(tree, 'readme.txt/sub'), null, 'файлът не е папка');

// 4. Плосък списък с дълбочина.
const flat = st.flatten(tree);
const shape = flat.map((n) => `${n.depth}:${n.type}:${n.name}`).sort();
assert.deepEqual(shape, [
  '0:folder:/',
  '1:file:readme.txt',
  '1:folder:sub',
  '2:file:notes.txt',
  '2:folder:deep',
  '3:file:data.csv',
].sort());
assert.ok(flat.some((n) => n.type === 'file' && n.path === 'sub/deep/data.csv'));

// 5. Привеждане на виртуалното дърво (метаданни) към същата форма.
const virtual = vs.buildTree([
  { id: 'f1', name: 'A.pdf', size: 10, topic: 'Тема', category: 'Категория', group: 'Група' },
  { id: 'f2', name: 'B.pdf', size: 20, topic: 'Тема', category: 'Категория' },
]);
const normalized = st.normalize(virtual.tree);
assert.equal(normalized.folderCount, 3, 'Тема → Категория → Група');
assert.equal(normalized.fileCount, 2);
assert.equal(normalized.bytes, 30);
const group = st.resolve(normalized, '/Тема/Категория/Група');
assert.equal(group.type, 'folder');
assert.equal(group.files[0].name, 'A.pdf');
assert.equal(st.resolve(normalized, '/Тема/Категория/B.pdf').size, 20);

// 6. Празен вход не чупи нищо.
const empty = st.build([]);
assert.equal(empty.folderCount, 0);
assert.equal(empty.fileCount, 0);
assert.equal(empty.bytes, 0);
assert.deepEqual(st.flatten(null), []);

console.log('storage-tree OK');
process.exit(0);
