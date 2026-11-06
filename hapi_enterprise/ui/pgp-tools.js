'use strict';
// PGP инструменти — всички функции на PGPony playground, портирани в панела на add-on-а.
//
// ЗАЩО В БРАУЗЪРА, А НЕ НА СЪРВЪРА
//   1. Наборът от функции (симетрично шифроване с парола, clearsign, генератор с парола,
//      срок и сертификат за отмяна) го няма в нашия `pgp.js`. Добавянето му на сървъра е
//      нов криптокод точно по пътя на ключовете — най-скъпото място за грешка.
//   2. Така ключовете и паролите НЕ напускат компютъра на управителя: няма заявка, няма
//      запис в лога, няма одитен запис със съдържание. Панелът не вика нито един от
//      административните маршрути и не пази нищо в `localStorage`/`sessionStorage`.
//   3. Затова и входът за ключ е ПРИКАЧЕН ФАЙЛ, а не поле за поставяне: човекът избира
//      `.asc` от диска, вместо да копира ключ в уеб страница. Полетата за поставяне са
//      запазени като резервен вариант, свити под „или постави текста“ — не изчезват.
//   4. Изключение има едно и то е изрично: разделът „Ключарница“ пита публичния
//      `keys.pgpony.app` за ключ по отпечатък/имейл. Това е единственият изходящ адрес в
//      `connect-src` на панела и заявката тръгва само след натискане на „Търси“.
//
// ДВИГАТЕЛ
//   `ui/vendor/openpgp.min.js` (OpenPGP.js 6.3.1, LGPL-3.0, виж `ui/vendor/README.md`).
//   Зарежда се ПРЕДИ този файл в `index.html`; тук се ползва глобалният `openpgp`.
//   Ако библиотеката липсва, панелът го казва с текст, а не оставя празен екран.
(function () {
  const TOOLS = [
    { id: 'encrypt', label: 'Шифроване' },
    { id: 'decrypt', label: 'Разшифроване' },
    { id: 'sign', label: 'Подпис' },
    { id: 'verify', label: 'Проверка' },
    { id: 'inspect', label: 'Преглед на ключ' },
    { id: 'keyserver', label: 'Ключарница' },
    { id: 'generate', label: 'Генериране' },
  ];

  // Тавани: пазим браузъра от случайно избран гигабайтов файл. Ключ над 1 MB не съществува.
  const LIMITS = { keyBytes: 1024 * 1024, dataBytes: 64 * 1024 * 1024 };

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const engine = () => globalThis.openpgp || null;
  const toast = (m, k) => globalThis.HapiUI && globalThis.HapiUI.toast ? globalThis.HapiUI.toast(m, k) : null;

  let root = null;
  let tab = 'encrypt';
  let lastBinary = null;
  let lastBinaryName = '';
  // Смяната на таб прерисува панела. Без този кеш генериран ключ или шифрован текст изчезва,
  // преди човекът да го е копирал. Пази се само докато панелът е монтиран (`unmount` чисти).
  const outCache = Object.create(null);
  let genFprHtml = '';
  // Ключ, изтеглен от ключарницата: стои в паметта на панела и се ползва в „Шифроване“ и
  // „Проверка“ без поставяне на текст. Не се пази никъде извън този раздел на браузъра.
  let ksKey = null;
  let ksQuery = '';
  let ksReportHtml = '';
  const TAB_OUTS = {
    encrypt: ['enc'],
    decrypt: ['dec'],
    sign: ['sig'],
    verify: ['ver'],
    inspect: [],
    keyserver: ['ks'],
    generate: ['gen-public', 'gen-private', 'gen-revoke'],
  };

  // ---------------------------------------------------------------------------
  // Дребни форматиращи помощници
  // ---------------------------------------------------------------------------
  const groupFingerprint = (fpr) => String(fpr || '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

  function fmtDate(d) {
    if (d === null || d === undefined) return 'няма';
    if (d === Infinity) return 'никога';
    if (typeof d === 'string') return d;
    try {
      return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    } catch {
      return String(d);
    }
  }

  const fmtBytes = (n) => {
    const size = Number(n) || 0;
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    return (size / (1024 * 1024)).toFixed(2) + ' MB';
  };

  // Грешките на библиотеката се превеждат; суровият текст остава в скоби, за да не се губи
  // причината, когато преводът не улучи.
  function humanize(err) {
    const m = (err && err.message) ? err.message : String(err);
    const raw = ' <span class="hint">(' + esc(m) + ')</span>';
    if (/Misformed armored text|no valid armor|Unknown ASCII armor/i.test(m))
      return 'Това не изглежда като armored PGP блок. Провери, че файлът е целият, с редовете <code>-----BEGIN</code> и <code>-----END</code>.' + raw;
    if (/not.*(private|secret) key|expected.*private/i.test(m))
      return 'Тази операция иска <strong>частен</strong> ключ, а прикаченият файл е публичен ключ.' + raw;
    if (/(public key).*expected|not.*public key/i.test(m))
      return 'Тук трябва <strong>публичен</strong> ключ, а файлът съдържа друго.' + raw;
    if (/Incorrect key passphrase|passphrase/i.test(m))
      return 'Паролата не отключва този частен ключ. Провери за печатна грешка — паролите са чувствителни на регистър.' + raw;
    if (/already decrypted/i.test(m))
      return 'Този частен ключ няма парола. Остави полето за парола празно.' + raw;
    if (/Session key decryption failed|No symmetrically encrypted session key|Error decrypting message/i.test(m))
      return 'Разшифроването не мина: съобщението не е шифровано към този ключ или към тази парола.' + raw;
    if (/Signed digest did not match|digest did not match/i.test(m))
      return 'Съдържанието не пасва на подписа — променено е след подписването или това не е оригиналът.' + raw;
    if (/Could not find signing key|No signing key/i.test(m))
      return 'Подписът не е от този ключ. Провери, че публичният ключ е на подателя.' + raw;
    if (/Cleartext message/i.test(m))
      return 'Това не е clearsigned съобщение. То започва с <code>-----BEGIN PGP SIGNED MESSAGE-----</code>.' + raw;
    return 'Не се получи: <strong>' + esc(m) + '</strong>';
  }

  // ---------------------------------------------------------------------------
  // Четене на вход: прикачен файл с предимство, иначе поставен текст
  // ---------------------------------------------------------------------------
  const fileEl = (id) => root && root.querySelector('input[type="file"][data-pick="' + id + '"]');
  const textEl = (id) => root && root.querySelector('[data-text="' + id + '"]');
  const pwEl = (id) => root && root.querySelector('[data-pw="' + id + '"]');
  const pwFileEl = (id) => root && root.querySelector('input[type="file"][data-pwfile="' + id + '"]');

  function picked(id) {
    const el = fileEl(id);
    return el && el.files ? Array.from(el.files) : [];
  }

  // Байтовете се четат през `arrayBuffer`, а не през `file.text()`: така панелът работи
  // и в DOM-а на GUI тестовете, който дава само `arrayBuffer`.
  async function fileText(file) {
    return new TextDecoder('utf-8').decode(new Uint8Array(await file.arrayBuffer()));
  }

  async function readTextFile(file) {
    if (file.size > LIMITS.keyBytes && /\.(asc|pub|gpg|key|txt|sig)$/i.test(file.name)) {
      throw new Error('Файлът „' + file.name + '“ е ' + fmtBytes(file.size) + ' — това не е ключ');
    }
    return fileText(file);
  }

  /** Текстът на полето: всички прикачени файлове (слети) или поставеното в полето. */
  async function fieldText(id) {
    const files = picked(id);
    if (files.length) {
      const out = [];
      for (const f of files) out.push(await readTextFile(f));
      return out.join('\n');
    }
    const el = textEl(id);
    return el ? el.value : '';
  }

  /** Съдържание за подпис/шифроване: байтовете на файла или текстът от полето. */
  async function fieldPayload(id) {
    const files = picked(id);
    if (files.length) {
      const f = files[0];
      if (f.size > LIMITS.dataBytes) throw new Error('Файлът е ' + fmtBytes(f.size) + ' — над тавана от ' + fmtBytes(LIMITS.dataBytes));
      return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), text: null };
    }
    const el = textEl(id);
    const text = el ? el.value : '';
    return { name: '', bytes: null, text: text };
  }

  /** Парола: от файл (първият ред) или от полето. */
  async function passValue(id) {
    const pf = pwFileEl(id);
    if (pf && pf.files && pf.files[0]) {
      const t = await fileText(pf.files[0]);
      return t.replace(/\r?\n$/, '');
    }
    const el = pwEl(id);
    return el ? el.value : '';
  }

  // ---------------------------------------------------------------------------
  // Ключове
  // ---------------------------------------------------------------------------
  const ARMOR_RE = /-----BEGIN PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----[\s\S]*?-----END PGP (?:PUBLIC|PRIVATE) KEY BLOCK-----/g;

  /** Един armored блок → ключ. `readKey` отказва частни блокове, затова те се четат отделно. */
  async function readAnyKey(block) {
    const isPrivateBlock = /-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(block);
    return isPrivateBlock
      ? engine().readPrivateKey({ armoredKey: block })
      : engine().readKey({ armoredKey: block });
  }

  /** Един или няколко armored блока → публични ключове. Частните се свеждат до публични. */
  async function readPublicKeys(text) {
    const blocks = String(text || '').match(ARMOR_RE);
    if (!blocks) throw new Error('Misformed armored text');
    const keys = [];
    for (const block of blocks) {
      const key = await readAnyKey(block);
      keys.push(key.isPrivate() ? key.toPublic() : key);
    }
    return keys;
  }

  /** Частен ключ, отключен само ако има парола. */
  async function readUnlockedPrivateKey(armored, passphrase) {
    const text = String(armored || '').trim();
    const block = (text.match(/-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----/) || [text])[0];
    const key = await engine().readPrivateKey({ armoredKey: block });
    if (key.isDecrypted()) return key;
    if (!passphrase) throw new Error('Incorrect key passphrase: този ключ е с парола — прикачи файл с паролата или я въведи');
    return engine().decryptKey({ privateKey: key, passphrase: passphrase });
  }

  /** Ключовете за операция: прикачените/поставените + изтегления от ключарницата. */
  const withKsKey = (text) => {
    const base = String(text || '').trim();
    if (!ksKey) return base;
    return base ? base + '\n' + ksKey.armored : ksKey.armored;
  };

  /** Плашка „ползва се ключ от ключарницата“ в табовете, които приемат публичен ключ. */
  function ksChip() {
    if (!ksKey) return '';
    return '<div class="pg-ks-chip">' +
      '<span class="badge pg-badge-ok">ключарница</span>' +
      '<span class="hint">' + esc(ksKey.uid || '(без потребителски ID)') + '</span>' +
      '<span class="mono">' + groupFingerprint(ksKey.fpr) + '</span>' +
      '<button type="button" class="btn btn-sm" data-ks-drop="1">махни</button>' +
      '</div>';
  }

  // ---------------------------------------------------------------------------
  // Визуални блокове
  // ---------------------------------------------------------------------------
  function verdict(el, kind, html) {
    if (!el) return;
    el.className = 'pg-verdict pg-verdict-' + kind;
    el.innerHTML = html;
    el.hidden = false;
  }

  function hide(el) {
    if (el) el.hidden = true;
  }

  /** Поле за ключ: прикачане на файл (може няколко) + свит резервен вариант с поставяне. */
  function keyField(o) {
    const accept = o.accept || '.asc,.pub,.gpg,.key,.txt,application/pgp-keys,text/plain';
    return (
      '<div class="field pg-field">' +
      '<label for="pg-file-' + o.id + '">' + o.label +
      (o.hint ? ' <span class="hint">' + o.hint + '</span>' : '') + '</label>' +
      '<input type="file" id="pg-file-' + o.id + '" class="pg-file" data-pick="' + o.id + '"' +
      (o.multiple ? ' multiple' : '') + ' accept="' + accept + '">' +
      '<div class="pg-file-meta" data-meta="' + o.id + '">няма избран файл</div>' +
      '<details class="pg-paste"><summary>или постави текста</summary>' +
      '<textarea data-text="' + o.id + '" rows="' + (o.rows || 5) + '" spellcheck="false" placeholder="' +
      esc(o.placeholder || '-----BEGIN PGP PUBLIC KEY BLOCK-----') + '"></textarea></details>' +
      '</div>'
    );
  }

  /** Съдържание: прикачен файл (всякакъв) + поле за текст. */
  function dataField(o) {
    return (
      '<div class="field pg-field">' +
      '<label for="pg-file-' + o.id + '">' + o.label +
      (o.hint ? ' <span class="hint">' + o.hint + '</span>' : '') + '</label>' +
      '<input type="file" id="pg-file-' + o.id + '" class="pg-file" data-pick="' + o.id + '"' +
      (o.multiple ? ' multiple' : '') + (o.accept ? ' accept="' + o.accept + '"' : '') + '>' +
      '<div class="pg-file-meta" data-meta="' + o.id + '">няма избран файл</div>' +
      (o.textArea === false ? '' :
        '<textarea data-text="' + o.id + '" rows="' + (o.rows || 6) + '" spellcheck="false" placeholder="' +
        esc(o.placeholder || '') + '"></textarea>') +
      '</div>'
    );
  }

  /** Парола: поле + прикачване на файл с паролата (първият ред се ползва). */
  function passField(o) {
    return (
      '<div class="field pg-field">' +
      '<label for="pg-pw-' + o.id + '">' + o.label +
      (o.hint ? ' <span class="hint">' + o.hint + '</span>' : '') + '</label>' +
      '<input type="password" id="pg-pw-' + o.id + '" data-pw="' + o.id + '" autocomplete="off">' +
      '<input type="file" class="pg-file" data-pwfile="' + o.id + '" accept=".txt,.key,.pass,text/plain">' +
      '<div class="pg-file-meta" data-meta-pw="' + o.id + '">парола от файл: не</div>' +
      '</div>'
    );
  }

  function modeRadios(name, options) {
    return '<div class="pg-modes" role="radiogroup">' + options.map((o) =>
      '<label class="pg-mode"><input type="radio" name="' + name + '" value="' + o.value + '"' +
      (o.checked ? ' checked' : '') + '> ' + o.label + '</label>').join('') + '</div>';
  }

  const outBlock = (o) =>
    '<div class="pg-out" data-out="' + o.id + '" hidden>' +
    '<div class="pg-out-head"><span class="pg-out-label">' + o.label + '</span><span class="pg-out-tools">' +
    '<button type="button" class="btn btn-sm" data-copy="' + o.id + '">Копирай</button>' +
    '<button type="button" class="btn btn-sm" data-save="' + o.id + '" data-name="' + (o.name || 'pgp.asc') + '">Изтегли</button>' +
    '</span></div>' +
    '<textarea id="pg-out-' + o.id + '" class="pg-mono-out" rows="' + (o.rows || 10) + '" readonly spellcheck="false"></textarea>' +
    (o.note ? '<p class="hint">' + o.note + '</p>' : '') +
    '</div>';

  // ---------------------------------------------------------------------------
  // Табове
  // ---------------------------------------------------------------------------
  function panelEncrypt() {
    return (
      '<p class="hint">Шифроване към публични ключове или с парола. Може да се подпише със свой частен ключ. ' +
      'Всичко се случва в браузъра — нищо не се изпраща към сървъра.</p>' +
      modeRadios('enc-mode', [
        { value: 'key', label: 'към публични ключове', checked: true },
        { value: 'pass', label: 'с парола' },
      ]) +
      '<div data-mode="enc" data-modes="key">' +
      keyField({
        id: 'enc-keys', multiple: true, rows: 6,
        label: 'Публични ключове на получателите',
        hint: '(прикачи .asc — може няколко файла)',
        placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      }) +
      ksChip() +
      '</div>' +
      '<div data-mode="enc" data-modes="pass">' +
      passField({ id: 'enc-pass', label: 'Парола за шифроване', hint: '(предай я по друг канал)' }) +
      '</div>' +
      dataField({
        id: 'enc-msg', rows: 6,
        label: 'Съобщение',
        hint: '(прикачи файл или напиши текста)',
        placeholder: 'Текстът за шифроване…',
      }) +
      '<details class="pg-paste"><summary>подписване с частен ключ (по избор)</summary>' +
      keyField({
        id: 'enc-sign', rows: 5,
        label: 'Частен ключ за подпис',
        hint: '(.asc / .key)',
        placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----',
      }) +
      passField({ id: 'enc-signpass', label: 'Парола на частния ключ', hint: '(ако има)' }) +
      '</details>' +
      '<div class="pg-actions">' +
      '<button type="button" class="btn btn-primary" data-run="encrypt">Шифровай</button>' +
      '<button type="button" class="btn" data-clear="encrypt">Изчисти</button>' +
      '</div>' +
      '<div class="pg-verdict" data-verdict="encrypt" hidden></div>' +
      outBlock({ id: 'enc', label: 'Шифровано съобщение', name: 'message.asc', rows: 10,
        note: 'Прати <strong>само</strong> този блок. За двоичен резултат изтегли файла.' })
    );
  }

  // Всяко поле носи своето id; всички операции работят с id, а не с позиция в DOM.
  function panelDecrypt() {
    return (
      '<p class="hint">Разшифроване с частен ключ или с парола, с проверка на подписа на подателя.</p>' +
      modeRadios('dec-mode', [
        { value: 'key', label: 'с мой частен ключ', checked: true },
        { value: 'pass', label: 'с парола' },
      ]) +
      dataField({
        id: 'dec-msg', rows: 8,
        label: 'Шифровано съобщение',
        hint: '(прикачи .asc или постави)',
        placeholder: '-----BEGIN PGP MESSAGE-----',
      }) +
      '<div data-mode="dec" data-modes="key">' +
      keyField({
        id: 'dec-key', rows: 5,
        label: 'Мой частен ключ',
        hint: '(.asc / .key)',
        placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----',
      }) +
      passField({ id: 'dec-keypass', label: 'Парола на частния ключ', hint: '(ако има)' }) +
      '</div>' +
      '<div data-mode="dec" data-modes="pass">' +
      passField({ id: 'dec-pass', label: 'Парола на съобщението' }) +
      '</div>' +
      keyField({
        id: 'dec-verify', multiple: true, rows: 5,
        label: 'Публичен ключ на подателя',
        hint: '(по избор — за проверка на подписа)',
        placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      }) +
      '<div class="pg-actions">' +
      '<button type="button" class="btn btn-primary" data-run="decrypt">Разшифровай</button>' +
      '<button type="button" class="btn" data-clear="decrypt">Изчисти</button>' +
      '</div>' +
      '<div class="pg-verdict" data-verdict="decrypt" hidden></div>' +
      '<div class="pg-verdict" data-verdict="decrypt-sig" hidden></div>' +
      '<div class="pg-out" data-out="dec" hidden>' +
      '<div class="pg-out-head"><span class="pg-out-label">Отчетен текст</span><span class="pg-out-tools">' +
      '<button type="button" class="btn btn-sm" data-copy="dec">Копирай</button>' +
      '<button type="button" class="btn btn-sm" data-save="dec" data-name="decrypted.bin">Изтегли</button>' +
      '</span></div>' +
      '<textarea id="pg-out-dec" class="pg-mono-out" rows="8" readonly spellcheck="false"></textarea>' +
      '<p class="hint" data-dec-name></p>' +
      '</div>'
    );
  }

  function panelSign() {
    return (
      '<p class="hint">Clearsign на текст, detached подпис на текст или на файл. Файлът се хешира локално и не се качва.</p>' +
      modeRadios('sig-mode', [
        { value: 'clear', label: 'clearsign текст', checked: true },
        { value: 'detached-text', label: 'detached (текст)' },
        { value: 'detached-file', label: 'detached (файл)' },
      ]) +
      '<div data-mode="sig" data-modes="clear detached-text">' +
      dataField({ id: 'sig-text', rows: 6, label: 'Текст за подпис', placeholder: 'Текстът, който се подписва…' }) +
      '</div>' +
      '<div data-mode="sig" data-modes="detached-file">' +
      dataField({ id: 'sig-file', rows: 4, label: 'Файл за подпис', hint: '(всякакъв; хешира се локално)', textArea: false }) +
      '</div>' +
      keyField({
        id: 'sig-key', rows: 5,
        label: 'Мой частен ключ',
        hint: '(.asc / .key)',
        placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK-----',
      }) +
      passField({ id: 'sig-pass', label: 'Парола на частния ключ', hint: '(ако има)' }) +
      '<div class="pg-actions">' +
      '<button type="button" class="btn btn-primary" data-run="sign">Подпиши</button>' +
      '<button type="button" class="btn" data-clear="sign">Изчисти</button>' +
      '</div>' +
      '<div class="pg-verdict" data-verdict="sign" hidden></div>' +
      '<div class="pg-out" data-out="sig" hidden>' +
      '<div class="pg-out-head"><span class="pg-out-label" data-sig-label>Подпис</span><span class="pg-out-tools">' +
      '<button type="button" class="btn btn-sm" data-copy="sig">Копирай</button>' +
      '<button type="button" class="btn btn-sm" data-save="sig" data-name="signature.asc">Изтегли</button>' +
      '</span></div>' +
      '<textarea id="pg-out-sig" class="pg-mono-out" rows="10" readonly spellcheck="false"></textarea>' +
      '</div>'
    );
  }

  function panelVerify() {
    return (
      '<p class="hint">Проверка на clearsigned съобщение или на detached подпис върху текст/файл.</p>' +
      modeRadios('ver-mode', [
        { value: 'clear', label: 'clearsigned', checked: true },
        { value: 'detached-text', label: 'detached (текст)' },
        { value: 'detached-file', label: 'detached (файл)' },
      ]) +
      '<div data-mode="ver" data-modes="clear">' +
      dataField({
        id: 'ver-clear', rows: 8,
        label: 'Clearsigned съобщение',
        hint: '(прикачи .asc или постави)',
        placeholder: '-----BEGIN PGP SIGNED MESSAGE-----',
      }) +
      '</div>' +
      '<div data-mode="ver" data-modes="detached-text">' +
      dataField({ id: 'ver-text', rows: 5, label: 'Оригинален текст', hint: '(точно както е подписан)' }) +
      '</div>' +
      '<div data-mode="ver" data-modes="detached-file">' +
      dataField({ id: 'ver-file', rows: 4, label: 'Оригинален файл', textArea: false }) +
      '</div>' +
      '<div data-mode="ver" data-modes="detached-text detached-file">' +
      keyField({
        id: 'ver-sig', rows: 5,
        label: 'Detached подпис',
        hint: '(.asc / .sig)',
        placeholder: '-----BEGIN PGP SIGNATURE-----',
      }) +
      '</div>' +
      keyField({
        id: 'ver-key', multiple: true, rows: 5,
        label: 'Публичен ключ на подписващия',
        hint: '(.asc — може няколко)',
        placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      }) +
      ksChip() +
      '<div class="pg-actions">' +
      '<button type="button" class="btn btn-primary" data-run="verify">Провери</button>' +
      '<button type="button" class="btn" data-clear="verify">Изчисти</button>' +
      '</div>' +
      '<div class="pg-verdict" data-verdict="verify" hidden></div>' +
      '<div class="pg-out" data-out="ver" hidden>' +
      '<div class="pg-out-head"><span class="pg-out-label">Подписано съдържание</span><span class="pg-out-tools">' +
      '<button type="button" class="btn btn-sm" data-copy="ver">Копирай</button>' +
      '</span></div>' +
      '<textarea id="pg-out-ver" class="pg-mono-out" rows="6" readonly spellcheck="false"></textarea>' +
      '</div>'
    );
  }

  function panelInspect() {
    return (
      '<p class="hint">Прикачи публичен или частен ключ и виж отпечатък, алгоритъм, потребителски идентификатори, ' +
      'срок и всеки подключ с възможностите му. Частният ключ се разглежда само структурно.</p>' +
      keyField({
        id: 'ins-key', multiple: true, rows: 8,
        label: 'Ключ',
        hint: '(.asc / .pub / .key)',
        placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK-----',
      }) +
      '<div class="pg-actions">' +
      '<button type="button" class="btn btn-primary" data-run="inspect">Прегледай</button>' +
      '<button type="button" class="btn" data-clear="inspect">Изчисти</button>' +
      '</div>' +
      '<div class="pg-verdict" data-verdict="inspect" hidden></div>' +
      '<div data-out="ins" hidden></div>'
    );
  }

  function panelGenerate() {
    return (
      '<p class="hint">Нова OpenPGP двойка ключове: публичен за споделяне, частен за пазене и сертификат за отмяна. ' +
      'Генерирането е локално; ключът съществува само в този браузър, докато не го изтеглиш.</p>' +
      '<div class="pg-verdict pg-verdict-warn">' +
      '<strong>Ключ от браузър е за тест, обучение и еднократна употреба.</strong> Ключ, на който ще разчиташ с години, ' +
      'се пази на устройство или хардуерен ключ, където тайната не стои в паметта на уеб страница.</div>' +
      '<div class="grid-2">' +
      '<div class="field"><label for="pg-gen-name">Име</label><input type="text" id="pg-gen-name" autocomplete="off" placeholder="Иван Петров"></div>' +
      '<div class="field"><label for="pg-gen-email">Имейл</label><input type="text" id="pg-gen-email" autocomplete="off" placeholder="ivan@example.com"></div>' +
      '</div>' +
      passField({ id: 'gen-pass', label: 'Парола', hint: '(по избор, но препоръчително)' }) +
      '<div class="grid-2">' +
      '<div class="field"><label for="pg-gen-algo">Алгоритъм</label><select id="pg-gen-algo">' +
      '<option value="curve25519" selected>Ed25519 / Cv25519: v4, работи навсякъде (препоръчано)</option>' +
      '<option value="v6">Ed25519 / X25519: v6, RFC 9580 (иска v6-съвместим софтуер)</option>' +
      '<option value="rsa4096">RSA-4096 (съвместимост със старо)</option>' +
      '</select></div>' +
      '<div class="field"><label for="pg-gen-expiry">Срок</label><select id="pg-gen-expiry">' +
      '<option value="0" selected>без срок</option>' +
      '<option value="31536000">след 1 година</option>' +
      '<option value="63072000">след 2 години</option>' +
      '</select></div>' +
      '</div>' +
      '<div class="pg-actions">' +
      '<button type="button" class="btn btn-primary" data-run="generate">Генерирай двойка ключове</button>' +
      '<button type="button" class="btn" data-clear="generate">Изчисти</button>' +
      '</div>' +
      '<div class="pg-verdict" data-verdict="generate" hidden></div>' +
      '<div data-out="gen" hidden>' +
      '<div class="pg-out"><div class="pg-out-head"><span class="pg-out-label">Публичен ключ <span class="hint">(споделя се свободно)</span></span>' +
      '<span class="pg-out-tools"><button type="button" class="btn btn-sm" data-copy="gen-public">Копирай</button>' +
      '<button type="button" class="btn btn-sm" data-save="gen-public" data-name="public.asc">Изтегли .asc</button></span></div>' +
      '<textarea id="pg-out-gen-public" class="pg-mono-out" rows="8" readonly spellcheck="false"></textarea></div>' +
      '<div class="pg-out"><div class="pg-out-head"><span class="pg-out-label">Частен ключ <span class="pg-danger">(не се споделя)</span></span>' +
      '<span class="pg-out-tools"><button type="button" class="btn btn-sm" data-copy="gen-private">Копирай</button>' +
      '<button type="button" class="btn btn-sm" data-save="gen-private" data-name="private.asc">Изтегли .asc</button></span></div>' +
      '<textarea id="pg-out-gen-private" class="pg-mono-out" rows="8" readonly spellcheck="false"></textarea></div>' +
      '<div class="pg-out"><div class="pg-out-head"><span class="pg-out-label">Сертификат за отмяна <span class="hint">(пази се отделно; може да убие ключа)</span></span>' +
      '<span class="pg-out-tools"><button type="button" class="btn btn-sm" data-copy="gen-revoke">Копирай</button>' +
      '<button type="button" class="btn btn-sm" data-save="gen-revoke" data-name="revocation.asc">Изтегли .asc</button></span></div>' +
      '<textarea id="pg-out-gen-revoke" class="pg-mono-out" rows="6" readonly spellcheck="false"></textarea></div>' +
      '<p class="hint" data-gen-fpr></p>' +
      '</div>'
    );
  }

  function panelKeyserver() {
    return (
      '<p class="hint">Публичната ключарница <code>keys.pgpony.app</code> (VKS API — същият стандарт като ' +
      'keys.openpgp.org) се търси по отпечатък, Key ID или потвърден имейл. Това е <strong>единствената</strong> ' +
      'заявка, която панелът прави навън, и тръгва само при натискане на „Търси“. Ключът идва като файл: ' +
      'свали го, прикачи го в другите раздели, или натисни „Използвай“.</p>' +
      '<div class="field">' +
      '<label for="pg-ks-q">Отпечатък, Key ID или имейл</label>' +
      '<input type="text" id="pg-ks-q" autocomplete="off" spellcheck="false" value="' + esc(ksQuery) + '"' +
      ' placeholder="1584 71AA 4E7F ACCE … 142F 9DE6 или ime@example.com">' +
      '<div class="hint">Отпечатък: 40 hex (v4) или 64 hex (v6) · Key ID: 8 или 16 hex. Интервали, двоеточия и ' +
      '<code>0x</code> се пренебрегват.</div>' +
      '</div>' +
      '<div class="pg-actions">' +
      '<button type="button" class="btn btn-primary" data-run="keyserver">Търси</button>' +
      '<button type="button" class="btn" data-clear="keyserver">Изчисти</button>' +
      '</div>' +
      '<div class="pg-verdict" data-verdict="keyserver" hidden></div>' +
      '<div data-out="ks-report" hidden></div>' +
      outBlock({
        id: 'ks', label: 'Публичен ключ от ключарницата', rows: 8, name: 'key.asc',
        note: 'Това е целият armored ключ, както го дава сървърът. Свали го и го прикачи в „Шифроване“ или „Проверка“.',
      }) +
      '<div class="pg-actions" data-ks-actions' + (ksKey ? '' : ' hidden') + '>' +
      '<button type="button" class="btn btn-sm" data-ks-use="encrypt">Използвай в „Шифроване“</button>' +
      '<button type="button" class="btn btn-sm" data-ks-use="verify">Използвай в „Проверка“</button>' +
      '</div>'
    );
  }

  const PANELS = {
    encrypt: panelEncrypt,
    decrypt: panelDecrypt,
    sign: panelSign,
    verify: panelVerify,
    inspect: panelInspect,
    keyserver: panelKeyserver,
    generate: panelGenerate,
  };

  function render() {
    if (!root) return;
    const pgp = engine();
    const head =
      '<div class="page-title"><h1>PGP инструменти</h1>' +
      '<span class="state-chip">локално в браузъра · без заявки към add-on-а</span></div>';
    if (!pgp) {
      root.innerHTML = head +
        '<div class="pg-verdict pg-verdict-danger"><strong>OpenPGP.js не се зареди.</strong> ' +
        'Файлът <code>ui/vendor/openpgp.min.js</code> липсва или е блокиран от браузъра. ' +
        'Презареди панела; ако продължава, провери дали add-on-ът е обновен.</div>';
      return;
    }
    root.innerHTML =
      head +
      '<div class="panel"><div class="tabs" role="tablist">' +
      TOOLS.map((t) =>
        '<button type="button" role="tab" data-tab="' + t.id + '"' +
        (t.id === tab ? ' class="active" aria-selected="true"' : '') + '>' + t.label + '</button>').join('') +
      '</div><div class="panel-body" data-body>' + PANELS[tab]() + '</div></div>' +
      '<p class="hint">Ключовете, паролите и съдържанието остават в този раздел на браузъра. Панелът не ги пази ' +
      'и не ги изпраща към add-on-а — затова и няма запис в одита. Единственото изключение е „Ключарница“: ' +
      'тя пита публичния <code>keys.pgpony.app</code> за ключ по отпечатък/имейл и само при натискане на „Търси“.</p>';
    syncModes();
    syncMetas();
    restoreOuts();
  }

  // ---------------------------------------------------------------------------
  // Показване на избраните файлове + режими
  // ---------------------------------------------------------------------------
  function syncMetas() {
    if (!root) return;
    $$('input[type="file"][data-pick]', root).forEach((el) => {
      const meta = root.querySelector('[data-meta="' + el.dataset.pick + '"]');
      if (!meta) return;
      const files = el.files ? Array.from(el.files) : [];
      meta.textContent = files.length
        ? files.map((f) => f.name + ' (' + fmtBytes(f.size) + ')').join(', ')
        : 'няма избран файл';
      meta.classList.toggle('pg-file-set', files.length > 0);
    });
    $$('input[type="file"][data-pwfile]', root).forEach((el) => {
      const meta = root.querySelector('[data-meta-pw="' + el.dataset.pwfile + '"]');
      if (!meta) return;
      const files = el.files ? Array.from(el.files) : [];
      meta.textContent = files.length ? 'парола от файл: ' + files[0].name : 'парола от файл: не';
      meta.classList.toggle('pg-file-set', files.length > 0);
    });
  }

  function syncModes() {
    if (!root) return;
    ['enc', 'dec', 'sig', 'ver'].forEach((group) => {
      const checked = root.querySelector('input[name="' + group + '-mode"]:checked');
      const value = checked ? checked.value : '';
      $$('[data-mode="' + group + '"]', root).forEach((el) => {
        const modes = String(el.dataset.modes || '').split(/\s+/);
        el.hidden = modes.indexOf(value) === -1;
      });
    });
  }

  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Действия по бутоните
  // ---------------------------------------------------------------------------
  function download(name, data, mime) {
    const blob = new Blob([data], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name || 'pgp.bin';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 30000);
  }

  function fieldValue(id) {
    const el = root.querySelector('#pg-out-' + id);
    return el ? el.value : '';
  }

  function reveal(el) {
    if (!el) return;
    const block = el.closest('.pg-out');
    if (block) block.hidden = false;
    const wrap = el.closest('[data-out]');
    if (wrap) wrap.hidden = false;
  }

  function setOut(id, text) {
    outCache[id] = text;
    const el = root.querySelector('#pg-out-' + id);
    if (el) el.value = text;
    reveal(el);
  }

  function restoreOuts() {
    Object.keys(outCache).forEach((id) => {
      const el = root.querySelector('#pg-out-' + id);
      if (!el) return;
      el.value = outCache[id];
      reveal(el);
    });
    if (genFprHtml) {
      const fpr = root.querySelector('[data-gen-fpr]');
      if (fpr) fpr.innerHTML = genFprHtml;
    }
    if (ksReportHtml) {
      const box = root.querySelector('[data-out="ks-report"]');
      if (box) {
        box.innerHTML = ksReportHtml;
        box.hidden = false;
      }
    }
  }

  function clearTab(name) {
    (TAB_OUTS[name] || []).forEach((id) => { delete outCache[id]; });
    if (name === 'generate') genFprHtml = '';
    if (name === 'keyserver') {
      ksKey = null;
      ksQuery = '';
      ksReportHtml = '';
    }
    const wrap = root.querySelector('[data-body]');
    if (!wrap) return;
    wrap.innerHTML = PANELS[name]();
    syncModes();
    syncMetas();
  }

  // ---------------------------------------------------------------------------
  // ШИФРОВАНЕ
  // ---------------------------------------------------------------------------
  async function runEncrypt() {
    const pgp = engine();
    const err = root.querySelector('[data-verdict="encrypt"]');
    hide(err);
    const payload = await fieldPayload('enc-msg');
    if (!payload.text && !payload.bytes) throw new Error('Прикачи файл или напиши съобщение');
    const message = payload.bytes
      ? await pgp.createMessage({ binary: payload.bytes, filename: payload.name })
      : await pgp.createMessage({ text: payload.text });
    const mode = (root.querySelector('input[name="enc-mode"]:checked') || {}).value || 'key';
    const opts = { message: message };

    if (mode === 'key') {
      const keysText = String(await fieldText('enc-keys') || '').trim();
      if (!keysText && !ksKey) throw new Error('Прикачи поне един публичен ключ на получател');
      opts.encryptionKeys = await readPublicKeys(withKsKey(keysText));
    } else {
      const pass = await passValue('enc-pass');
      if (!pass) throw new Error('Въведи парола за шифроване или прикачи файл с нея');
      opts.passwords = [pass];
    }

    const signText = String(await fieldText('enc-sign') || '').trim();
    if (signText) opts.signingKeys = await readUnlockedPrivateKey(signText, await passValue('enc-signpass'));

    const armored = await pgp.encrypt(Object.assign({ format: 'armored' }, opts));
    setOut('enc', armored);
    toast('Шифровано локално', 'ok');
  }

  // ---------------------------------------------------------------------------
  // РАЗШИФРОВАНЕ
  // ---------------------------------------------------------------------------
  async function runDecrypt() {
    const pgp = engine();
    const err = root.querySelector('[data-verdict="decrypt"]');
    const sigBox = root.querySelector('[data-verdict="decrypt-sig"]');
    hide(err);
    hide(sigBox);
    root.querySelector('[data-out="dec"]').hidden = true;

    const payload = await fieldPayload('dec-msg');
    // Прикаченият файл може да е брониран текст (.asc) или двоично съобщение (.gpg),
    // затова се гледа съдържанието, а не само името.
    let armored = String(payload.text || '').trim();
    if (!armored && payload.bytes) {
      try { armored = new TextDecoder('utf-8', { fatal: true }).decode(payload.bytes).trim(); } catch { armored = ''; }
    }
    if (!armored && !payload.bytes) throw new Error('Прикачи шифрованото съобщение (.asc) или го постави');

    const message = armored
      ? await pgp.readMessage({ armoredMessage: armored })
      : await pgp.readMessage({ binaryMessage: payload.bytes });
    const mode = (root.querySelector('input[name="dec-mode"]:checked') || {}).value || 'key';
    const opts = { message: message };

    if (mode === 'key') {
      const keyText = String(await fieldText('dec-key') || '').trim();
      if (!keyText) throw new Error('Прикачи своя частен ключ');
      opts.decryptionKeys = await readUnlockedPrivateKey(keyText, await passValue('dec-keypass'));
    } else {
      const pass = await passValue('dec-pass');
      if (!pass) throw new Error('Въведи паролата, с която е шифровано съобщението');
      opts.passwords = [pass];
    }

    let verifyKeys = null;
    const verifyText = String(await fieldText('dec-verify') || '').trim();
    if (verifyText || ksKey) {
      verifyKeys = await readPublicKeys(withKsKey(verifyText));
      opts.verificationKeys = verifyKeys;
    }

    const result = await pgp.decrypt(opts);
    const data = result.data;
    let text;
    let bytes = null;
    if (typeof data === 'string') {
      text = data;
    } else {
      bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        text = '';
      }
    }
    lastBinary = bytes;
    lastBinaryName = result.filename || 'decrypted.bin';
    root.querySelector('[data-dec-name]').textContent = result.filename
      ? 'Разшифрован файл: ' + result.filename + (bytes ? ' · ' + fmtBytes(bytes.length) + (text ? '' : ' (двоичен — ползвай „Изтегли“)') : '')
      : (bytes ? fmtBytes(bytes.length) + ' (двоични данни)' : '');
    setOut('dec', text || (bytes ? '[' + fmtBytes(bytes.length) + ' двоични данни — ползвай „Изтегли“]' : ''));
    const saveBtn = root.querySelector('[data-save="dec"]');
    if (saveBtn) saveBtn.dataset.name = lastBinaryName;

    if (result.signatures && result.signatures.length) {
      const html = await describeSignatures(result.signatures, verifyKeys);
      if (verifyKeys) {
        const ok = /ВАЛИДЕН/.test(html) && !/НЕВАЛИДЕН/.test(html);
        verdict(sigBox, ok ? 'ok' : 'danger', 'Проверка на подписа: ' + html);
      } else {
        verdict(sigBox, 'warn',
          'Съобщението е <strong>подписано</strong> (ключ ' +
          esc(String(result.signatures[0].keyID && result.signatures[0].keyID.toHex
            ? result.signatures[0].keyID.toHex().toUpperCase()
            : 'неизвестен')) +
          '), но не е прикачен публичен ключ на подателя, затова подписът <strong>не е проверен</strong>.');
      }
    }
    toast('Разшифровано локално', 'ok');
  }

  /** Подписите се описват; при грешка се казва КОЙ подпис е невалиден. */
  async function describeSignatures(signatures, verificationKeys) {
    if (!signatures || !signatures.length) return null;
    const parts = [];
    for (const s of signatures) {
      const keyIdHex = s.keyID && s.keyID.toHex ? s.keyID.toHex().toUpperCase() : '?';
      try {
        await s.verified;
        let created = null;
        try {
          const sig = await s.signature;
          created = sig && sig.packets && sig.packets[0] ? sig.packets[0].created : null;
        } catch {
          created = null;
        }
        let who = keyIdHex;
        for (const vk of verificationKeys || []) {
          const match = vk.getKeys ? vk.getKeys(s.keyID) : null;
          if (match && match.length) {
            const uid = (vk.getUserIDs() || [])[0] || keyIdHex;
            who = esc(uid) + ' <span class="hint">[' + groupFingerprint(vk.getFingerprint()) + ']</span>';
            break;
          }
        }
        parts.push('<strong>ВАЛИДЕН</strong>: подпис от ' + who +
          (created ? ' <span class="hint">на ' + fmtDate(created) + '</span>' : ''));
      } catch (e) {
        parts.push('<strong>НЕВАЛИДЕН</strong>: подписът от ключ ' + esc(keyIdHex) +
          ' не се провери <span class="hint">(' + esc(e.message) + ')</span>');
      }
    }
    return parts.join('<br>');
  }

  // ---------------------------------------------------------------------------
  // ПОДПИС
  // ---------------------------------------------------------------------------
  async function runSign() {
    const pgp = engine();
    hide(root.querySelector('[data-verdict="sign"]'));
    const keyText = String(await fieldText('sig-key') || '').trim();
    if (!keyText) throw new Error('Прикачи своя частен ключ');
    const key = await readUnlockedPrivateKey(keyText, await passValue('sig-pass'));
    const mode = (root.querySelector('input[name="sig-mode"]:checked') || {}).value || 'clear';
    const labelEl = root.querySelector('[data-sig-label]');
    const saveBtn = root.querySelector('[data-save="sig"]');
    let out;
    let filename;

    if (mode === 'detached-file') {
      const payload = await fieldPayload('sig-file');
      if (!payload.bytes) throw new Error('Прикачи файл за подпис');
      out = await pgp.sign({
        message: await pgp.createMessage({ binary: payload.bytes, filename: payload.name }),
        signingKeys: key,
        detached: true,
        format: 'armored',
      });
      if (labelEl) labelEl.textContent = 'Detached подпис за ' + payload.name;
      filename = payload.name + '.sig';
    } else {
      const payload = await fieldPayload('sig-text');
      const text = payload.bytes ? new TextDecoder().decode(payload.bytes) : payload.text;
      if (!text) throw new Error('Прикачи файл или напиши текста за подпис');
      if (mode === 'clear') {
        out = await pgp.sign({ message: await pgp.createCleartextMessage({ text: text }), signingKeys: key, format: 'armored' });
        if (labelEl) labelEl.textContent = 'Clearsigned съобщение';
        filename = 'message.asc';
      } else {
        out = await pgp.sign({
          message: await pgp.createMessage({ text: text }),
          signingKeys: key,
          detached: true,
          format: 'armored',
        });
        if (labelEl) labelEl.textContent = 'Detached подпис: пази го до оригинала';
        filename = (payload.name ? payload.name : 'message.txt') + '.sig';
      }
    }
    if (saveBtn) saveBtn.dataset.name = filename;
    setOut('sig', out);
    toast('Подписано локално', 'ok');
  }

  // ---------------------------------------------------------------------------
  // ПРОВЕРКА
  // ---------------------------------------------------------------------------
  async function runVerify() {
    const pgp = engine();
    const box = root.querySelector('[data-verdict="verify"]');
    hide(box);
    root.querySelector('[data-out="ver"]').hidden = true;

    const keyText = String(await fieldText('ver-key') || '').trim();
    if (!keyText && !ksKey) throw new Error('Прикачи публичния ключ на подписващия');
    const keys = await readPublicKeys(withKsKey(keyText));
    const mode = (root.querySelector('input[name="ver-mode"]:checked') || {}).value || 'clear';
    let result;
    let signedContent = null;

    if (mode === 'clear') {
      const payload = await fieldPayload('ver-clear');
      const clearText = String(payload.bytes ? new TextDecoder().decode(payload.bytes) : payload.text || '').trim();
      if (!clearText) throw new Error('Прикачи или постави clearsigned съобщение');
      result = await pgp.verify({ message: await pgp.readCleartextMessage({ cleartextMessage: clearText }), verificationKeys: keys });
      signedContent = result.data;
    } else {
      const sigText = String(await fieldText('ver-sig') || '').trim();
      if (!sigText) throw new Error('Прикачи detached подписа (.asc / .sig)');
      let message;
      if (mode === 'detached-text') {
        const payload = await fieldPayload('ver-text');
        const text = payload.bytes ? new TextDecoder().decode(payload.bytes) : payload.text;
        if (!text) throw new Error('Прикачи файл или постави оригиналния текст');
        message = await pgp.createMessage({ text: text });
      } else {
        const payload = await fieldPayload('ver-file');
        if (!payload.bytes) throw new Error('Прикачи оригиналния файл');
        message = await pgp.createMessage({ binary: payload.bytes, filename: payload.name });
      }
      result = await pgp.verify({ message: message, signature: await pgp.readSignature({ armoredSignature: sigText }), verificationKeys: keys });
    }

    const html = await describeSignatures(result.signatures, keys);
    const allValid = /ВАЛИДЕН/.test(html) && !/НЕВАЛИДЕН/.test(html);
    verdict(box, allValid ? 'ok' : 'danger', html);
    if (allValid && signedContent !== null) {
      setOut('ver', signedContent);
    }
  }

  // ---------------------------------------------------------------------------
  // ПРЕГЛЕД НА КЛЮЧ
  // ---------------------------------------------------------------------------
  const ALGO_NAMES = {
    1: 'RSA', 2: 'RSA (само шифроване)', 3: 'RSA (само подпис)', 16: 'ElGamal', 17: 'DSA',
    18: 'ECDH', 19: 'ECDSA', 22: 'EdDSA (стар)', 25: 'X25519', 26: 'X448', 27: 'Ed25519',
    28: 'Ed448', 30: 'ML-DSA-65+Ed25519', 31: 'ML-DSA-87+Ed448', 32: 'SLH-DSA-SHAKE-128s',
    33: 'SLH-DSA-SHAKE-128f', 34: 'SLH-DSA-SHAKE-256s', 35: 'ML-KEM-768+X25519', 36: 'ML-KEM-1024+X448',
  };
  // Пост-квантовите алгоритми не се четат от OpenPGP.js; тук се показват направо от пакетите.
  const PQ_USE = { 30: 'подпис', 31: 'подпис', 32: 'подпис', 33: 'подпис', 34: 'подпис', 35: 'шифроване', 36: 'шифроване' };
  const KEY_FLAGS = [[0x01, 'сертифициране'], [0x02, 'подпис'], [0x04, 'шифроване'], [0x08, 'шифроване'], [0x20, 'удостоверяване']];

  const algoName = (id) => ALGO_NAMES[id] || 'алгоритъм ' + id;
  const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

  function rawPackets(bytes) {
    const out = [];
    let p = 0;
    while (p < bytes.length) {
      const c = bytes[p++];
      let tag;
      let len;
      if (!(c & 0x80)) break;
      if (c & 0x40) {
        tag = c & 0x3f;
        if (p >= bytes.length) break;
        const l0 = bytes[p];
        if (l0 < 192) {
          len = l0;
          p += 1;
        } else if (l0 < 224) {
          if (p + 1 >= bytes.length) break;
          len = ((l0 - 192) << 8) + bytes[p + 1] + 192;
          p += 2;
        } else if (l0 === 255) {
          if (p + 4 >= bytes.length) break;
          len = be32(bytes, p + 1);
          p += 5;
        } else break;
      } else {
        tag = (c >> 2) & 0x0f;
        const lt = c & 3;
        if (lt === 0) {
          len = bytes[p];
          p += 1;
        } else if (lt === 1) {
          len = (bytes[p] << 8) | bytes[p + 1];
          p += 2;
        } else if (lt === 2) {
          len = be32(bytes, p);
          p += 4;
        } else break;
      }
      if (len > bytes.length - p) break;
      out.push({ tag: tag, body: bytes.subarray(p, p + len) });
      p += len;
    }
    return out;
  }

  const hexOf = (buf) => Array.from(new Uint8Array(buf)).map((b) => ('0' + b.toString(16)).slice(-2)).join('').toUpperCase();

  function publicPart(tag, body) {
    if (tag === 6 || tag === 14) return body;
    const v = body[0];
    if ((v === 5 || v === 6) && body.length >= 10) {
      const n = be32(body, 6);
      return body.length >= 10 + n ? body.subarray(0, 10 + n) : null;
    }
    return null;
  }

  async function fingerprintOf(pub) {
    const subtle = globalThis.crypto ? globalThis.crypto.subtle : null;
    if (!pub || !subtle) return null;
    const v = pub[0];
    const n = pub.length;
    let head;
    let hash;
    if (v === 4) {
      head = [0x99, (n >> 8) & 0xff, n & 0xff];
      hash = 'SHA-1';
    } else if (v === 5 || v === 6) {
      head = [v === 6 ? 0x9b : 0x9a, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
      hash = 'SHA-256';
    } else return null;
    const data = new Uint8Array(head.length + n);
    data.set(head, 0);
    data.set(pub, head.length);
    return hexOf(await subtle.digest(hash, data));
  }

  async function scanKey(armored) {
    let bytes;
    try {
      bytes = (await engine().unarmor(armored)).data;
    } catch {
      return null;
    }
    const keys = [];
    const userIds = [];
    for (const pk of rawPackets(bytes)) {
      const b = pk.body;
      if (pk.tag === 13) {
        userIds.push(new TextDecoder().decode(b));
        continue;
      }
      if ([5, 6, 7, 14].indexOf(pk.tag) === -1 || b.length < 8) continue;
      keys.push({
        primary: pk.tag === 5 || pk.tag === 6,
        secret: pk.tag === 5 || pk.tag === 7,
        version: b[0],
        algorithm: b[0] === 3 ? b[7] : b[5],
        created: new Date(be32(b, 1) * 1000),
        fingerprint: await fingerprintOf(publicPart(pk.tag, b)),
      });
    }
    return { keys: keys, userIds: userIds };
  }

  const keyIdOf = (k) => (!k.fingerprint ? null : k.version === 4 ? k.fingerprint.slice(-16) : k.fingerprint.slice(0, 16));

  function flagsToCaps(flagBytes) {
    if (!flagBytes || !flagBytes.length) return null;
    const b = flagBytes[0];
    const caps = [];
    KEY_FLAGS.forEach((f) => {
      if ((b & f[0]) && caps.indexOf(f[1]) === -1) caps.push(f[1]);
    });
    return caps.length ? caps.join(', ') : null;
  }

  function algoLabel(info) {
    if (!info) return 'няма';
    let s = info.algorithm || '?';
    if (info.curve) s += ' (' + info.curve + ')';
    if (info.bits) s += ' ' + info.bits + '-bit';
    return s;
  }

  const row = (k, v) => '<tr><th>' + k + '</th><td>' + v + '</td></tr>';

  function uncheckedRow(k) {
    const use = PQ_USE[k.algorithm];
    return (k.fingerprint ? '<span class="mono">' + groupFingerprint(k.fingerprint) + '</span><br>' : '') +
      esc(algoName(k.algorithm)) + (use ? ' <span class="hint">[' + use + ']</span>' : '') +
      ' <span class="hint">· създаден ' + fmtDate(k.created) + '</span>' +
      ' <span class="badge pg-badge-warn">не е проверен тук</span>';
  }

  async function runInspect() {
    const err = root.querySelector('[data-verdict="inspect"]');
    hide(err);
    const box = root.querySelector('[data-out="ins"]');
    box.hidden = true;
    const armored = String(await fieldText('ins-key') || '').trim();
    if (!armored) throw new Error('Прикачи ключ за преглед');
    const scanned = await scanKey(armored);
    let key;
    try {
      key = await readAnyKey(armored);
    } catch (readErr) {
      if (!scanned || !scanned.keys.length || !scanned.keys[0].primary) throw readErr;
      box.innerHTML = rawReport(scanned, readErr);
      box.hidden = false;
      return;
    }
    box.innerHTML = await keyReportHtml(key, scanned);
    box.hidden = false;
  }

  /** Отчетът за ключ — общ за „Преглед на ключ“ и за ключарницата. */
  async function keyReportHtml(key, scanned) {
    const isPrivate = key.isPrivate();
    const fpr = key.getFingerprint().toUpperCase();
    const version = key.keyPacket.version;
    let expiry;
    try {
      expiry = await key.getExpirationTime();
    } catch {
      expiry = null;
    }
    let revoked;
    try {
      revoked = await key.isRevoked();
    } catch {
      revoked = false;
    }
    const expired = expiry !== null && expiry !== Infinity && expiry instanceof Date && expiry < new Date();

    let badges = '<span class="badge">' + (isPrivate ? 'ЧАСТЕН ключ' : 'публичен ключ') + '</span> ' +
      '<span class="badge">OpenPGP v' + version + '</span> ';
    if (revoked) badges += '<span class="badge pg-badge-danger">ОТМЕНЕН</span>';
    else if (expired) badges += '<span class="badge pg-badge-warn">ИЗТЕКЪЛ</span>';
    else badges += '<span class="badge pg-badge-ok">активен</span>';

    const uids = (key.getUserIDs() || []).map(esc).join('<br>') || '<span class="hint">(няма)</span>';
    let primaryCaps;
    try {
      const u = key.users && key.users[0];
      const cert = u && u.selfCertifications && u.selfCertifications[0];
      primaryCaps = cert ? flagsToCaps(cert.keyFlags) : null;
    } catch {
      primaryCaps = null;
    }

    let html = '<table class="grid pg-report"><tbody>';
    html += row('Състояние', badges);
    html += row('Отпечатък', '<span class="mono">' + groupFingerprint(fpr) + '</span>');
    html += row('Key ID', '<span class="mono">0x' + key.getKeyID().toHex().toUpperCase() + '</span>');
    html += row('Алгоритъм', esc(algoLabel(key.getAlgorithmInfo())) + (primaryCaps ? ' <span class="hint">[' + primaryCaps + ']</span>' : ''));
    html += row('Създаден', fmtDate(key.getCreationTime()));
    html += row('Изтича', fmtDate(expiry));
    html += row('Потребителски ID', uids);

    const subs = key.getSubkeys() || [];
    for (let i = 0; i < subs.length; i += 1) {
      const sub = subs[i];
      let caps;
      let subRevoked;
      try {
        const bind = sub.bindingSignatures && sub.bindingSignatures[sub.bindingSignatures.length - 1];
        caps = bind ? flagsToCaps(bind.keyFlags) : null;
      } catch {
        caps = null;
      }
      try {
        subRevoked = await sub.isRevoked();
      } catch {
        subRevoked = false;
      }
      const v = '<span class="mono">' + groupFingerprint(sub.getFingerprint().toUpperCase()) + '</span><br>' +
        esc(algoLabel(sub.getAlgorithmInfo())) + (caps ? ' <span class="hint">[' + caps + ']</span>' : '') +
        ' <span class="hint">· създаден ' + fmtDate(sub.getCreationTime()) + '</span>' +
        (subRevoked ? ' <span class="badge pg-badge-danger">ОТМЕНЕН</span>' : '');
      html += row('Подключ ' + (i + 1), v);
    }
    // Подключовете, които OpenPGP.js прескача, защото не познава алгоритъма им.
    const known = subs.map((s) => s.getFingerprint().toUpperCase());
    const unchecked = scanned
      ? scanned.keys.filter((k) => !k.primary && (k.fingerprint ? known.indexOf(k.fingerprint) === -1 : PQ_USE[k.algorithm] !== undefined))
      : [];
    unchecked.forEach((k, j) => {
      html += row('Подключ ' + (subs.length + j + 1), uncheckedRow(k));
    });
    html += '</tbody></table>';

    if (unchecked.length) {
      const names = [];
      unchecked.forEach((k) => {
        const n = algoName(k.algorithm);
        if (names.indexOf(n) === -1) names.push(n);
      });
      html += '<div class="pg-verdict pg-verdict-warn">OpenPGP.js не поддържа ' + esc(names.join(', ')) +
        ', затова ключовете с „не е проверен тук“ са прочетени направо от данните на ключа. ' +
        'Обвързващите им подписи не са проверени в браузъра.</div>';
    }
    if (isPrivate) {
      html += '<div class="pg-verdict pg-verdict-warn">Прикачил си <strong>частен ключ</strong>. Той е обработен локално и ' +
        'нищо не е изпратено. Въпреки това третирай машината, която е докоснала този ключ, като част от границата му на сигурност.</div>';
    }
    return html;
  }

  function rawReport(scanned, err) {
    const primary = scanned.keys[0];
    const badges = '<span class="badge">' + (primary.secret ? 'ЧАСТЕН ключ' : 'публичен ключ') + '</span> ' +
      '<span class="badge">OpenPGP v' + primary.version + '</span> ' +
      '<span class="badge pg-badge-warn">не е проверен тук</span>';
    let html = '<table class="grid pg-report"><tbody>' + row('Състояние', badges);
    if (primary.fingerprint) {
      html += row('Отпечатък', '<span class="mono">' + groupFingerprint(primary.fingerprint) + '</span>');
      html += row('Key ID', '<span class="mono">0x' + keyIdOf(primary) + '</span>');
    }
    const use = PQ_USE[primary.algorithm];
    html += row('Алгоритъм', esc(algoName(primary.algorithm)) + (use ? ' <span class="hint">[' + use + ']</span>' : ''));
    html += row('Създаден', fmtDate(primary.created));
    html += row('Потребителски ID', scanned.userIds.map(esc).join('<br>') || '<span class="hint">(няма)</span>');
    scanned.keys.slice(1).forEach((k, i) => {
      html += row('Подключ ' + (i + 1), uncheckedRow(k));
    });
    html += '</tbody></table>';
    html += '<div class="pg-verdict pg-verdict-warn">OpenPGP.js не можа да прочете този ключ, затова е показан направо от данните му. ' +
      'Нищо не е проверено: нито подписи, нито срок, нито отмяна. <span class="hint">(' +
      esc(err && err.message ? err.message : String(err)) + ')</span></div>';
    if (primary.secret) {
      html += '<div class="pg-verdict pg-verdict-warn">Прикачил си <strong>частен ключ</strong>. Той е обработен локално.</div>';
    }
    return html;
  }

  // ---------------------------------------------------------------------------
  // КЛЮЧАРНИЦА (keys.pgpony.app, VKS API)
  //   Единственият изходящ адрес на панела. Пътят се строи само от три позволени форми
  //   (отпечатък / Key ID / имейл) — не се приема произволен URL от потребителя.
  // ---------------------------------------------------------------------------
  const KS = {
    host: 'keys.pgpony.app',
    base: 'https://keys.pgpony.app/vks/v1',
    maxBytes: 1024 * 1024,
    timeoutMs: 20000,
  };

  function ksTarget(raw) {
    const q = String(raw || '').trim().replace(/^0x/i, '');
    if (!q) throw new Error('Въведи отпечатък, Key ID или имейл');
    if (q.indexOf('@') !== -1) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(q)) throw new Error('Това не изглежда като имейл адрес');
      const email = q.toLowerCase();
      return { kind: 'имейл', value: email, path: 'by-email/' + encodeURIComponent(email) };
    }
    const hex = q.replace(/[\s:]/g, '').toUpperCase();
    if (!/^[0-9A-F]+$/.test(hex)) throw new Error('Отпечатъкът съдържа само hex знаци (0-9, A-F)');
    if (hex.length === 40 || hex.length === 64) return { kind: 'отпечатък', value: hex, path: 'by-fingerprint/' + hex };
    if (hex.length === 8 || hex.length === 16 || hex.length === 32) return { kind: 'Key ID', value: hex, path: 'by-keyid/' + hex };
    throw new Error('Дължина ' + hex.length + ' hex знака — очаквам 40/64 (отпечатък v4/v6) или 8/16 (Key ID)');
  }

  async function ksFetch(target) {
    const url = KS.base + '/' + target.path;
    const hasAbort = typeof AbortController === 'function';
    const ctl = hasAbort ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), KS.timeoutMs) : null;
    let resp;
    try {
      resp = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/pgp-keys' },
        signal: ctl ? ctl.signal : undefined,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('Ключарницата не отговори до ' + Math.round(KS.timeoutMs / 1000) + ' секунди', { cause: e });
      }
      throw new Error(
        'Няма връзка с ' + KS.host + '. Провери изхода на браузъра към интернет, или прикачи .asc файл',
        { cause: e }
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (resp.status === 404) {
      throw new Error('Няма такъв ключ в ' + KS.host + '. Провери отпечатъка; имейл се намира само след като ' +
        'собственикът е потвърдил адреса си в ключарницата');
    }
    if (!resp.ok) throw new Error('Ключарницата върна ' + resp.status + (resp.statusText ? ' ' + resp.statusText : ''));
    const len = Number(resp.headers.get('content-length') || 0);
    if (len && len > KS.maxBytes) throw new Error('Отговорът е ' + fmtBytes(len) + ' — над тавана от ' + fmtBytes(KS.maxBytes));
    const armored = String(await resp.text() || '').trim();
    if (armored.length > KS.maxBytes) throw new Error('Отговорът е над тавана от ' + fmtBytes(KS.maxBytes));
    if (!/-----BEGIN PGP PUBLIC KEY BLOCK-----/.test(armored)) {
      const peek = armored.replace(/\s+/g, ' ').slice(0, 160);
      throw new Error('Отговорът не е публичен ключ' + (peek ? ': ' + peek : ' (празен)'));
    }
    return { url: url, armored: armored };
  }

  async function runKeyserver() {
    const err = root.querySelector('[data-verdict="keyserver"]');
    const report = root.querySelector('[data-out="ks-report"]');
    const actions = root.querySelector('[data-ks-actions]');
    hide(err);
    delete outCache.ks;
    ksReportHtml = '';
    if (report) {
      report.innerHTML = '';
      report.hidden = true;
    }
    if (actions) actions.hidden = true;

    const input = root.querySelector('#pg-ks-q');
    ksQuery = input ? input.value : '';
    const target = ksTarget(ksQuery);
    const got = await ksFetch(target);
    setOut('ks', got.armored);

    const scanned = await scanKey(got.armored);
    let key = null;
    let readErr = null;
    try {
      key = await readAnyKey(got.armored);
    } catch (e) {
      readErr = e;
    }
    if (!key && (!scanned || !scanned.keys.length || !scanned.keys[0].primary)) {
      throw readErr || new Error('Ключът от ключарницата не може да се прочете');
    }

    const fpr = key ? key.getFingerprint().toUpperCase() : (scanned.keys[0].fingerprint || '');
    const uids = key ? (key.getUserIDs() || []) : (scanned.userIds || []);
    // Ключът стои в паметта, за да не се налага поставяне на текст в „Шифроване“/„Проверка“.
    ksKey = { armored: got.armored, fpr: fpr, uid: uids.join(', ') };

    ksReportHtml = key ? await keyReportHtml(key, scanned) : rawReport(scanned, readErr);
    if (report) {
      report.innerHTML = ksReportHtml;
      report.hidden = false;
    }
    const saveBtn = root.querySelector('[data-save="ks"]');
    if (saveBtn) saveBtn.dataset.name = (fpr || 'key') + '.asc';
    if (actions) actions.hidden = false;

    verdict(err, 'ok',
      '<span class="badge pg-badge-ok">намерен</span> търсене по ' + esc(target.kind) + ' · ' +
      '<span class="mono">' + esc(fpr ? groupFingerprint(fpr) : '—') + '</span> · ' + fmtBytes(got.armored.length) +
      (uids.length ? '<br>' + uids.map(esc).join('<br>') : '') +
      '<br><span class="hint">Същото от терминал: <code>gpg --keyserver hkps://' + KS.host +
      ' --recv-keys ' + esc(fpr || target.value) + '</code></span>');
    toast('Ключът е изтеглен от ' + KS.host, 'ok');
  }

  // ---------------------------------------------------------------------------
  // ГЕНЕРИРАНЕ
  // ---------------------------------------------------------------------------
  async function runGenerate() {
    const pgp = engine();
    hide(root.querySelector('[data-verdict="generate"]'));
    const name = root.querySelector('#pg-gen-name').value.trim();
    const email = root.querySelector('#pg-gen-email').value.trim();
    if (!name && !email) throw new Error('Дай име, имейл или и двете');
    const algo = root.querySelector('#pg-gen-algo').value;
    const expiry = parseInt(root.querySelector('#pg-gen-expiry').value, 10) || 0;
    const pass = await passValue('gen-pass');

    const opts = { userIDs: [{ name: name || undefined, email: email || undefined }], format: 'armored' };
    if (algo === 'rsa4096') {
      opts.type = 'rsa';
      opts.rsaBits = 4096;
    } else if (algo === 'v6') {
      opts.type = 'curve25519';
    } else {
      opts.type = 'ecc';
      opts.curve = 'curve25519Legacy';
    }
    if (expiry > 0) opts.keyExpirationTime = expiry;
    if (pass) opts.passphrase = pass;

    const result = await pgp.generateKey(opts);
    setOut('gen-public', result.publicKey);
    setOut('gen-private', result.privateKey);
    setOut('gen-revoke', result.revocationCertificate);
    const pub = await pgp.readKey({ armoredKey: result.publicKey });
    genFprHtml = 'Отпечатък: <span class="mono">' +
      groupFingerprint(pub.getFingerprint().toUpperCase()) + '</span>' +
      (pass ? '' : '<br><span class="hint">Този частен ключ е без парола — всеки, който го получи, може да го ползва.</span>');
    // Изгледът може вече да е прерисован (панелът се монтира в един и същ възел); тогава
    // отпечатъкът се пази в `genFprHtml` и се връща при следващото рисуване.
    const fprBox = root.querySelector('[data-gen-fpr]');
    if (fprBox) fprBox.innerHTML = genFprHtml;
    toast('Ключовете са генерирани локално', 'ok');
  }

  // ---------------------------------------------------------------------------
  // Събития — един делегиран слушател за целия панел
  // ---------------------------------------------------------------------------
  const RUNNERS = { encrypt: runEncrypt, decrypt: runDecrypt, sign: runSign, verify: runVerify, inspect: runInspect, keyserver: runKeyserver, generate: runGenerate };

  function bind() {
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('input[type="file"]')) {
        syncMetas();
        return;
      }
      if (t.matches('input[type="radio"]')) syncModes();
    });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest ? e.target.closest('button') : null;
      // Панелът се монтира в един и същ възел при всяко отваряне; ако `root` вече е
      // освободен, закъсняло събитие не бива да пипа нищо.
      if (!btn || !root || !root.contains(btn)) return;

      if (btn.dataset.tab) {
        if (btn.dataset.tab === tab) return;
        tab = btn.dataset.tab;
        render();
        return;
      }

      if (btn.dataset.copy) {
        const src = fieldValue(btn.dataset.copy);
        if (!src) return;
        try {
          await navigator.clipboard.writeText(src);
          toast('Копирано', 'ok');
        } catch {
          const el = root.querySelector('#pg-out-' + btn.dataset.copy);
          if (el) {
            el.select();
            document.execCommand('copy');
          }
        }
        return;
      }

      if (btn.dataset.save) {
        const id = btn.dataset.save;
        // Двоичният резултат от разшифроване стои в паметта, а в полето е само описанието му.
        if (id === 'dec' && lastBinary) {
          download(btn.dataset.name || lastBinaryName, lastBinary, 'application/octet-stream');
          return;
        }
        const src = fieldValue(id);
        if (!src) return;
        download(btn.dataset.name || 'pgp.asc', src, 'application/pgp-keys');
        return;
      }

      if (btn.dataset.ksDrop) {
        ksKey = null;
        render();
        toast('Ключът от ключарницата е махнат', 'ok');
        return;
      }

      if (btn.dataset.ksUse) {
        if (ksKey && PANELS[btn.dataset.ksUse]) {
          tab = btn.dataset.ksUse;
          render();
        }
        return;
      }

      if (btn.dataset.clear) {
        clearTab(btn.dataset.clear);
        return;
      }

      if (btn.dataset.run) {
        const name = btn.dataset.run;
        const err = root.querySelector('[data-verdict="' + name + '"]');
        btn.disabled = true;
        hide(err);
        try {
          await RUNNERS[name]();
        } catch (ex) {
          verdict(err, 'danger', humanize(ex));
          if (name === 'decrypt') hide(root.querySelector('[data-verdict="decrypt-sig"]'));
        } finally {
          btn.disabled = false;
        }
      }
    });
  }

  // Последният двоичен резултат от разшифроване стои само в паметта на панела, за да не се
  // губи файлът, когато в полето има само описание. Изчиства се при смяна на таб/панел.
  const API = {
    mount(node) {
      root = node;
      tab = 'encrypt';
      render();
      // `app.js` монтира в един и същ контейнер при всяко отваряне; слушателите се слагат
      // веднъж за възела, иначе всяко връщане в панела добавя още един и действията тръгват
      // два, три… пъти (включително криптооперациите).
      if (!node.__hapiPgpBound) {
        bind();
        node.__hapiPgpBound = true;
      }
      // `app.js` приема само точно `true`; иначе изчиства изгледа и показва „не е зареден“.
      return true;
    },
    unmount() {
      // Няма слушатели извън `root` и няма пазени тайни — достатъчно е да се откажат препратките.
      root = null;
      lastBinary = null;
      lastBinaryName = '';
      ksKey = null;
      ksQuery = '';
      ksReportHtml = '';
      Object.keys(outCache).forEach((id) => { delete outCache[id]; });
    },
    LIMITS,
  };

  if (typeof window !== 'undefined') window.HapiPgpToolsPanel = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
