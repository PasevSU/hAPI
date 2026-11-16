'use strict';
// ДВАТА QR ЕНКОДЕРА СА ЕДНО И СЪЩО (0.69.225).
//
// `hapi_enterprise/qrcode.js` е вендорваният енкодер на сървъра, а
// `hapi_enterprise/evidence-portal/assets/qrcode.js` е КОПИЕ за статичната страница на
// доказателствения портал (тя не може да иска файл от сървъра). Днес файловете са байт по
// байт еднакви — но никой не го проверяваше, тоест утре поправка в единия (напр. в
// `createSvgTag`) щеше да стигне само до половината кодове: порталът и панелът щяха да
// рисуват различни QR-и за един и същ адрес и никой тест нямаше да го види.
//
// Докато копието съществува, то трябва да е ТОЧНО копие. Когато копието изчезне (сборката
// го слага), тестът го отбелязва като преминат с бележка — не като счупен.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'hapi_enterprise', 'qrcode.js');
const copy = path.join(root, 'hapi_enterprise', 'evidence-portal', 'assets', 'qrcode.js');

assert.ok(fs.existsSync(source), 'сървърният енкодер съществува: hapi_enterprise/qrcode.js');

if (!fs.existsSync(copy)) {
  console.log('PASS evidence-portal-qr: копието го няма (слага се от сборката) — няма какво да се разминава');
} else {
  const a = fs.readFileSync(source);
  const b = fs.readFileSync(copy);
  assert.equal(a.length, b.length, `копието е с друг размер (${b.length} срещу ${a.length} байта) — двата QR енкодера вече се разминават`);
  assert.ok(a.equals(b), 'evidence-portal/assets/qrcode.js трябва да е байт по байт същото като qrcode.js');
  console.log(`PASS evidence-portal-qr: копието е точно копие (${a.length} байта) · един енкодер за портала и за панела`);
}
