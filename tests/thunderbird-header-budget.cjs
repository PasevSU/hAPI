'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// ОРАКУЛ: нито една заглавка, която емитерът връща, не надхвърля реда по RFC 5322 и не
// носи 8-битов знак.
//
// Дефектът (измерен на реален опит за изпращане с 14 прикачени файла): `X-PasevSU-Sha256`
// излезе 1853 знака, `X-PasevSU-Attachments-SHA256` — 1719, а `X-PasevSU-Cripto-title` —
// 2516, при таван 998 октета на ред (RFC 5322 §2.1.1). Thunderbird сам работи точно с това
// число: `MimeMessageUtils.getReferences()` реже `References` под 986 знака. Диалогът
// „Писмото не е изпратено“ не казва нито кой етап е паднал, нито защо, затова единствената
// проверима следа беше самата дължина.
//
// Затова тестът ИЗПЪЛНЯВА реалния `background.js` в `vm` с 20 прикачени файла и дълги имена,
// а не търси низове в кода: важно е какво ВРЪЩА емитерът, не как изглежда. Втората част
// пуска кирилица — 8-битова стойност в заглавка е незаконна по същото правило, а от нея
// зависи потребител, който пише име на дело на български.
// ─────────────────────────────────────────────────────────────────────────────
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'thunderbird-extension', 'background.js'),
  'utf8'
);

// Бюджетът, който емитерът обещава. RFC 5322 §2.1.1 е 998 октета за ЦЕЛИЯ ред, тоест
// стойността плюс името и двоеточието; 900 оставя място за най-дългото име.
const EMITTER_BUDGET = 900;
const RFC_LIMIT = 998;

async function runCompose(store, details) {
  let listener = null;
  const state = { details };

  const browser = {
    storage: {
      local: {
        async get(defaults) {
          if (defaults == null) return structuredClone(store);
          if (typeof defaults === 'string') {
            return defaults in store ? { [defaults]: store[defaults] } : {};
          }
          if (Array.isArray(defaults)) {
            const picked = {};
            for (const key of defaults) if (key in store) picked[key] = store[key];
            return picked;
          }
          const filled = {};
          for (const [key, fallback] of Object.entries(defaults)) {
            filled[key] = key in store ? store[key] : fallback;
          }
          return filled;
        },
        async set(patch) {
          Object.assign(store, structuredClone(patch));
        },
      },
    },
    compose: {
      onBeforeSend: {
        addListener(fn) {
          listener = fn;
        },
      },
      async getAttachmentFile(id) {
        const attachment = state.details.attachments.find((item) => item.id === id);
        if (!attachment) throw new Error(`no attachment ${id}`);
        const bytes = Buffer.from(`${attachment.name}:${attachment.id}`.repeat(8));
        return {
          name: attachment.name,
          arrayBuffer: async () =>
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      },
      async getComposeDetails() {
        return state.details;
      },
      async addAttachment() {},
      async listAttachments() {
        return state.details.attachments;
      },
    },
    runtime: { getManifest: () => ({ version: '1.9' }), id: 'pasevsu-forensic-headers@pasev.example' },
    i18n: { getMessage: (key) => key },
  };

  const context = vm.createContext({
    browser,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    File: class File {
      constructor(parts, name, options) {
        this.parts = parts;
        this.name = name;
        this.type = (options && options.type) || '';
      }
    },
    Promise,
    Date,
    Math,
    JSON,
    Uint8Array,
    Array,
    Object,
    String,
    Number,
    RegExp,
    Error,
  });

  vm.runInContext(SOURCE, context, { filename: 'background.js' });
  assert.equal(typeof listener, 'function', 'емитерът закача `onBeforeSend`');

  return listener({ id: 7 }, structuredClone(details));
}

function headersOf(result) {
  assert.deepEqual(Object.keys(result || {}), ['details'], 'отговорът е само `{ details }`');
  const changed = result.details;
  const headers = changed.customHeaders || [];
  assert.ok(headers.length >= 20, 'емитерът строи поне 20 заглавки, намерени: ' + headers.length);
  for (const header of headers) {
    assert.equal(typeof header.name, 'string', 'всяка заглавка има име');
    assert.equal(typeof header.value, 'string', 'всяка заглавка има стойност');
  }
  return { changed, headers };
}

// Правилото, наново изписано: 7-битова стойност, под бюджета, без прекъсващ ред знак.
function assertWireSafe(headers, label) {
  for (const { name, value } of headers) {
    assert.equal(
      /[\r\n]/.test(value),
      false,
      `${label}: „${name}“ носи прекъсващ ред`
    );
    assert.equal(
      /[^\x20-\x7E]/.test(value),
      false,
      `${label}: „${name}“ носи 8-битов знак — незаконно е по RFC 5322`
    );
    assert.ok(
      value.length <= EMITTER_BUDGET,
      `${label}: „${name}“ е ${value.length} знака, бюджетът на емитера е ${EMITTER_BUDGET}`
    );
    assert.ok(
      value.length <= RFC_LIMIT,
      `${label}: „${name}“ е ${value.length} знака, таванът по RFC 5322 е ${RFC_LIMIT}`
    );
  }
}

// Сглобяване: първата част е под оригиналното име, следващите — под `<име>-C2…-Cn`,
// а `<име>-Chunks` казва колко са.
function reassemble(headers, base) {
  const find = (name) => headers.filter((header) => header.name === name).map((h) => h.value);
  const count = find(`${base}-Chunks`);
  if (count.length === 0) {
    const single = find(base);
    return single.join('');
  }
  assert.equal(count.length, 1, `${base}-Chunks се среща веднъж`);
  let joined = '';
  for (let index = 1; index <= Number(count[0]); index += 1) {
    const parts = find(index === 1 ? base : `${base}-C${index}`);
    assert.equal(parts.length, 1, `липсва част ${base}-C${index}`);
    joined += parts[0];
  }
  return joined;
}

async function decryptTitle(headers, title, engine) {
  const [, iv, tag, body] = title.split('.');
  const fromBase64Url = (text) =>
    Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const keyBytes = new Uint8Array(
    await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`PasevSU-Cripto-title:v1|key|${engine}`)
    )
  );
  const key = await webcrypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'decrypt',
  ]);
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(iv), tagLength: 128 },
    key,
    Buffer.concat([fromBase64Url(body), fromBase64Url(tag)])
  );
  return Buffer.from(plain).toString('utf8');
}

const baseDetails = {
  isPlainText: false,
  body: '<html><body><p>Приложено за проверка</p></body></html>',
  plainTextBody: 'Приложено за проверка',
  subject: 'Издание 2026',
  to: ['Kristiana Belnikova <kristibelnikolova@gmail.com>'],
  cc: ['pasevdenislav@gmail.com'],
  bcc: [],
  customHeaders: [],
};

(async () => {
  // ── 1. Двадесет прикачени файла с дълги имена ─────────────────────────────
  const longNames = Array.from({ length: 20 }, (_, index) =>
    `PasevSU_Forensic_Evidence_Chain_of_Custody_Exhibit_${String(index + 1).padStart(2, '0')}` +
    '_Signed_Original_Scan_With_Handwritten_Annotation.pdf'
  );
  const bigDetails = {
    ...baseDetails,
    attachments: longNames.map((name, index) => ({
      id: index,
      name,
      size: 20480,
      contentType: 'application/pdf',
    })),
  };

  const big = await runCompose({ version: '1.9', caseId: 'CASE-2026-11', pgpFingerprint: 'ABCD' }, bigDetails);
  const { changed, headers } = headersOf(big);
  assertWireSafe(headers, '20 файла');

  const shaBlock = reassemble(headers, 'X-PasevSU-Sha256');
  const rows = shaBlock.split(',');
  assert.equal(
    rows.length,
    2 + longNames.length,
    'редовете са body + всички файлове + timestep, намерени: ' + rows.length
  );
  assert.match(rows[0], /^body - [0-9a-f]{64}$/, 'първият ред е хешът на тялото');
  assert.match(rows[rows.length - 1], /^timestep - \d{4}-\d\d-\d\dT/, 'последният ред е времевата марка');
  for (const name of longNames) {
    const row = rows.find((candidate) => candidate.startsWith(`${name} - `));
    assert.ok(row, `липсва ред за „${name}“`);
    assert.match(row, / - [0-9a-f]{64}$/, `редът на „${name}“ не завършва с SHA-256`);
  }

  const listText = reassemble(headers, 'X-PasevSU-Attachments-SHA256');
  assert.equal(
    listText.split(',').length,
    longNames.length,
    'списъкът с хешове на прикачените файлове покрива всички файлове'
  );

  const titleText = reassemble(headers, 'X-PasevSU-Cripto-title');
  const engine = headers.find((header) => header.name === 'X-PasevSU-Cripto-Engine');
  assert.ok(engine, 'има крипто-двигател');
  assert.match(engine.value, /^\d{25}$/, 'кодът на двигателя е 25 цифри');
  assert.equal(
    titleText.split('.').length,
    4,
    'шифротекстът е gcm1.<iv>.<tag>.<ciphertext> и се сглобява цял'
  );
  assert.equal(
    await decryptTitle(headers, titleText, engine.value),
    rows.join('\n'),
    'след сглобяване шифротекстът се дешифрира до СЪЩИЯ блок'
  );

  assert.ok(
    changed.subject.endsWith('{{ PasevSU-WAR }}'),
    'темата завършва с маркера: ' + JSON.stringify(changed.subject)
  );

  // ── 2. Кирилица в име на файл и в име на дело ─────────────────────────────
  const cyrillicName = 'Доказателство_№1_Разписка_на_свидетел.pdf';
  const cyrillicDetails = {
    ...baseDetails,
    attachments: [{ id: 0, name: cyrillicName, size: 1024, contentType: 'application/pdf' }],
  };
  const cyrillicStore = { version: '1.9', caseId: 'Дело № 2026-11', pgpFingerprint: '' };
  const cyrillic = await runCompose(cyrillicStore, cyrillicDetails);
  const cyrillicHeaders = headersOf(cyrillic).headers;

  // Тук е целият смисъл: 8-битова стойност НЕ бива да стига до Thunderbird.
  assertWireSafe(cyrillicHeaders, 'кирилица');

  const tokenRow = reassemble(cyrillicHeaders, 'X-PasevSU-Sha256')
    .split(',')
    .find((row) => row.startsWith('body -') === false && row.startsWith('timestep -') === false);
  assert.ok(tokenRow, 'има ред за прикачения файл');
  const token = tokenRow.slice(0, tokenRow.lastIndexOf(' - '));
  assert.equal(
    decodeURIComponent(token),
    cyrillicName,
    'процентното кодиране връща ТОЧНОНОТО име на файла, не „?“'
  );

  const caseHeader = cyrillicHeaders.find((header) => header.name === 'X-PasevSU-Case-ID');
  assert.ok(caseHeader, 'името на делото присъства');
  const encodedWord = caseHeader.value.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);
  assert.ok(encodedWord, 'името на делото е RFC 2047 encoded-word: ' + caseHeader.value);
  assert.equal(
    Buffer.from(encodedWord[1], 'base64').toString('utf8'),
    'Дело № 2026-11',
    'encoded-word-ът се декодира до написаното от потребителя'
  );

  console.log('thunderbird-header-budget: OK — 20 файла, кирилица, 0 стойности над ' + EMITTER_BUDGET);
})().catch((error) => {
  console.error('thunderbird-header-budget: FAILED');
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
