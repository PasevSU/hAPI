'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
// Entrypoint-ът е JavaScript (правилото на проекта: всичко се строи с JS), затова
// гейтът за Node/`node:sqlite` живее в start.js, а не в shell скрипт.
const start = fs.readFileSync(path.join(__dirname, '../hapi_enterprise/start.js'), 'utf8');
assert.match(start, /nodeMajor\s*<\s*22/, 'липсва долна граница за major версията на Node');
assert.match(start, /nodeMinor\s*<\s*13/, 'липсва долна граница за minor версията на Node (22.13)');
assert.match(start, /node:sqlite/, 'липсва проверка за node:sqlite');
assert.match(start, /requires Node\.js >=22\.13/, 'липсва ясното съобщение за изискването');
// Гейтът трябва да е ПРЕДИ старта на сървъра, иначе пада с неясна грешка.
assert.ok(start.indexOf('node:sqlite') < start.indexOf('spawn(process.execPath'), 'гейтът трябва да е преди старта на сървъра');
console.log('PASS startup Node SQLite compatibility gate contract');
