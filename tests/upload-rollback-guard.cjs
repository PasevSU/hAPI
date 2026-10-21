'use strict';
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../hapi_enterprise/server.js'), 'utf8');
// Търси се по шаблон, за да не чупи теста безобидно преформатиране на server.js.
const startMatch = source.search(/if \(parts\[4\] === 'files' && parts\.length === 5 && method === 'POST'\)/);
const endMatch = source.search(/if \(parts\[4\] === 'files' && parts\[5\]\)/);
assert(startMatch >= 0 && endMatch > startMatch, 'upload handler must exist');
const upload = source.slice(startMatch, endMatch);
assert.match(upload, /await fsp\.mkdir\(path\.join\(filesRoot, p\.id\), \{ recursive: true \}\)/, 'create portal directory');
assert.match(upload, /await fsp\.rm\(path\.join\(filesRoot, p\.id, f\.id\), \{ force: true \}\); await removeMirrored\(p\.id, f\.id\)/, 'cleanup primary and mirror if metadata save fails');
console.log('PASS: normal upload has rollback cleanup and creates its storage directory');
