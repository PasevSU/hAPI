'use strict';
// Генерира таблицата „Настройки по подразбиране“ от `config.yaml` и преводите, вместо
// тя да се поддържа на ръка.
//
// Защо: в `hapi_enterprise/README.md` имаше четири ръчно писани таблици с опции. Две от
// тях вече не бяха верни (`db_name` беше описан като име на файла на базата, а всъщност
// именува първия портал; `backup_folder` сочеше `/config` вместо папката на данните).
// Ръчно поддържана таблица с подразбирания се разминава тихо — затова тук тя се строи
// от единствения източник (`options:` в `config.yaml`) и се проверява от тест.
//
// Всяка опция ЗАДЪЛЖИТЕЛНО има обяснение какво значи празната/нулевата ѝ стойност:
// ако се добави нова опция без обяснение, генераторът спира с грешка. Така „всички
// настройки имат подразбиране“ не е пожелание, а проверено условие.
//
//   node scripts/settings-defaults.cjs            # записва таблиците
//   node scripts/settings-defaults.cjs --check    # не пише; код 1 при разминаване
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cfgPath = path.join(root, 'hapi_enterprise', 'config.yaml');
const cfg = fs.readFileSync(cfgPath, 'utf8');
const args = new Set(process.argv.slice(2));
const check = args.has('--check');

// ── Четене на config.yaml (без зависимости) ────────────────────────────────────
function section(name) {
  const start = cfg.indexOf('\n' + name + ':\n');
  if (start < 0) throw new Error('config.yaml: липсва секция ' + name);
  const rest = cfg.slice(start + name.length + 2);
  const end = rest.search(/\n[a-z_]+:\n/);
  return rest.slice(0, end === -1 ? undefined : end);
}

function optionsOf() {
  const out = [];
  for (const line of section('options').split('\n')) {
    const m = /^ {2}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m) out.push({ key: m[1], raw: m[2].replace(/\s+#.*$/, '').trim() });
  }
  return out;
}

function schemaOf() {
  const out = {};
  for (const line of section('schema').split('\n')) {
    const m = /^ {2}([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

// ── Преводи: `configuration.<key>.name` ────────────────────────────────────────
function namesOf(lang) {
  const file = path.join(root, 'hapi_enterprise', 'translations', lang + '.yaml');
  const text = fs.readFileSync(file, 'utf8');
  const out = {};
  let key = null;
  for (const line of text.split('\n')) {
    const keyLine = /^ {2}([a-z0-9_]+):\s*$/.exec(line);
    if (keyLine) key = keyLine[1];
    const nameLine = /^ {4}name:\s*(.+)$/.exec(line);
    if (key && nameLine) out[key] = nameLine[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

// ── Какво значи подразбирането (по езици) ──────────────────────────────────────
// Всяко обяснение е проверено срещу кода; празното/нулевото НЕ значи „изключено“ навсякъде.
const MEANING = {
  username: {
    en: 'Empty: a standalone console user `api` is created on first start. Under Ingress the Home Assistant account is used.',
    bg: 'Празно: при първи старт се създава конзолен потребител `api`. През Ingress се ползва HA акаунтът.',
  },
  password: {
    en: 'Empty: a random password is generated on first start and written to `api-credentials.txt` (mode 0600).',
    bg: 'Празно: при първи старт се генерира случайна парола и се записва в `api-credentials.txt` (права 0600).',
  },
  token: {
    en: 'Empty: the add-on refuses to start (`ADMIN_TOKEN_REQUIRED`). 24+ characters, no placeholder and no repetition pattern. Set it with `!secret hapi_token` so the value stays in `secrets.yaml`. It is never printed and never written to `/data`.',
    bg: 'Празно: add-on-ът отказва старт (`ADMIN_TOKEN_REQUIRED`). 24+ знака, без шаблон и без повторение. Задава се с `!secret hapi_token`, за да стои стойността в `secrets.yaml`. Не се печата и не се записва в `/data`.',
  },
  pgp_path_public: {
    en: 'Empty: PGP is off (the server still starts). Path may point to `public.asc`, `pubring.asc` or a `_openpgpV6` file; read-only.',
    bg: 'Празно: PGP е изключен (сървърът пак стартира). Пътят може да сочи към `public.asc`, `pubring.asc` или файл от `_openpgpV6`; само за четене.',
  },
  pgp_path_secret: {
    en: 'Empty: no encryption/layer-2 keys are loaded. Read-only; the add-on never writes into this file.',
    bg: 'Празно: не се зареждат ключове за криптиране/слой 2. Само за четене; add-on-ът никога не пише в този файл.',
  },
  pgp_path_pass: {
    en: 'Empty: no passphrase file, so the `pgp_key_pass` option (or none) is used. The file is read, never written.',
    bg: 'Празно: няма файл с парола, ползва се опцията `pgp_key_pass` (или нищо). Файлът се чете, никога не се записва.',
  },
  pgp_key_pass: {
    en: 'Empty: the secret key is treated as unprotected. Prefer `!secret hapi_pgp_path_pass` pointing at a file over putting the passphrase here.',
    bg: 'Празно: секретният ключ се приема за незащитен. По-добре `!secret hapi_pgp_path_pass` към файл, отколкото паролата да стои тук.',
  },
  pgp_encrypt_paths: {
    en: '`false`: storage paths stay in plaintext in the database; `true` requires a loaded secret key or the start fails with `PGP_SECRET_KEY_REQUIRED`.',
    bg: '`false`: пътищата в базата остават в открит вид; `true` изисква зареден секретен ключ, иначе стартът пада с `PGP_SECRET_KEY_REQUIRED`.',
  },
  pgp_encrypt_workdir: {
    en: '`false`: work files are encrypted with the internal key only; `true` wraps them with the PGP key (layer 2) and needs a loaded secret key.',
    bg: '`false`: работните файлове се криптират само с вътрешния ключ; `true` ги обвива с PGP ключа (слой 2) и иска зареден секретен ключ.',
  },
  db_name: {
    en: 'Names the first portal (`Files`, slug `files`). Change it before the first start to get another name.',
    bg: 'Именува първия портал (`Files`, slug `files`). Сменя се преди първия старт, ако трябва друго име.',
  },
  backup_folder: {
    en: 'Empty: `<storage>/backups` inside the add-on data folder. A relative path resolves inside `/share`.',
    bg: 'Празно: `<хранилище>/backups` в папката на add-on-а. Относителен път се решава в `/share`.',
  },
  backup_mirror: {
    en: 'Empty: no second copy of the database backups. Every configured copy is verified with SHA-256.',
    bg: 'Празно: без второ копие на резервните копия. Всяко зададено копие се проверява с SHA-256.',
  },
  storage_mirror: {
    en: 'Empty: no second copy of uploaded files. A configured mirror is verified and repairable.',
    bg: 'Празно: без второ копие на качените файлове. Зададено огледало се проверява и възстановява.',
  },
  memory_limit_mb: {
    en: '`0` keeps the Node.js default heap. `256`-`384` is the sane range on a Raspberry Pi.',
    bg: '`0` оставя подразбирането на Node.js. `256`-`384` е разумният диапазон за Raspberry Pi.',
  },
  db_id: {
    en: '`1` is the default namespace for composite keys. Change it only for a second, independent database.',
    bg: '`1` е пространството от имена по подразбиране. Сменя се само за втора, независима база.',
  },
  profiles: {
    en: 'Empty: the built-in profile set is used. A path or JSON replaces it; invalid JSON is ignored.',
    bg: 'Празно: ползват се вградените профили. Път или JSON ги заменя; невалиден JSON се игнорира.',
  },
  public_domain: {
    en: 'Empty: relative links only — portals and QR codes work on the local network, not from the internet.',
    bg: 'Празно: само относителни адреси — порталите и QR кодовете работят в локалната мрежа, не от интернет.',
  },
  public_gateway: {
    en: '`false`: port `8088` stays unpublished. `true` opens the add-on gateway for your own reverse proxy.',
    bg: '`false`: порт `8088` остава непубликуван. `true` отваря gateway-а за собствен reverse proxy.',
  },
  public_same_origin: {
    en: '`false`: absolute URLs are built from `public_domain`. `true` emits relative URLs on the HA host and port.',
    bg: '`false`: абсолютните адреси се строят от `public_domain`. `true` дава относителни на адреса на HA.',
  },
  user_roles: {
    en: 'Empty: every Ingress user is `admin`. The map is for demotion, e.g. `{"guest": "viewer"}`.',
    bg: 'Празно: всеки Ingress потребител е `admin`. Картата е за понижаване, напр. `{"guest": "viewer"}`.',
  },
  group_roles: {
    en: 'Empty: no group mapping. Home Assistant does not send groups; a reverse proxy that adds them can.',
    bg: 'Празно: без карта на групи. HA не подава групи; reverse proxy, който ги добавя, може.',
  },
  storage_location: {
    en: '`addon_config`: documents live in the add-on folder. `media` and `share` are shared HA folders.',
    bg: '`addon_config`: документите са в папката на add-on-а. `media` и `share` са споделени HA папки.',
  },
  storage_subdirectory: {
    en: '`hapi_enterprise`: one predictable subfolder inside the chosen storage location.',
    bg: '`hapi_enterprise`: една предвидима подпапка в избраното хранилище.',
  },
  storage_mode: {
    en: '`local`: the mounted folder is used directly. `ha_network` refuses to start when the mount is inactive.',
    bg: '`local`: монтираната папка се ползва директно. `ha_network` отказва старт при неактивен mount.',
  },
  storage_mount_name: {
    en: 'Empty: only meaningful with `storage_mode: ha_network`, where the mount name is required.',
    bg: 'Празно: има значение само при `storage_mode: ha_network`, където името на mount-а е задължително.',
  },
  min_free_mb: {
    en: '`100`: startup fails below 100 MB free. Raise it to `500`+ when you scan large folders.',
    bg: '`100`: стартът се отказва под 100 MB свободни. Вдигни до `500`+ при сканиране на големи папки.',
  },
  log_level: {
    en: '`info`: no per-request lines. `debug` logs one line per HTTP request; `trace` is for deep diagnostics.',
    bg: '`info`: без ред на заявка. `debug` пише по ред на всяка заявка; `trace` е за дълбока диагностика.',
  },
  config_dir: {
    en: 'Empty: `/config/rules`, where the built-in rules are copied on first start and can be edited.',
    bg: 'Празно: `/config/rules`, където при първи старт се копират вградените правила и могат да се редактират.',
  },
  evidence_portal_deploy: {
    en: '`true`: the Evidence View page is copied to `www/hapi/data` in the Home Assistant configuration (`/config/www/hapi/data` for HA, `/homeassistant/www/hapi/data` inside the add-on) and served at `/local/hapi/data/`.',
    bg: '`true`: страницата Evidence View се копира в `www/hapi/data` от конфигурацията на HA (`/config/www/hapi/data` за HA, `/homeassistant/www/hapi/data` в контейнера на add-on-а) и се сервира на `/local/hapi/data/`.',
  },
  tsa_enabled: {
    en: '`false`: the RFC 3161 endpoints answer `409` and no tokens are created. Nothing is ever faked.',
    bg: '`false`: RFC 3161 маршрутите отговарят `409` и не се създават токени. Нищо не се преструва.',
  },
  tsa_start_url: {
    en: 'DFN timestamp service for the START boundary (the manifest digest).',
    bg: 'DFN услуга за времеви печат за START границата (отпечатъкът на манифеста).',
  },
  tsa_stop_url: {
    en: 'DigiCert timestamp service for the STOP boundary (the closing digest).',
    bg: 'DigiCert услуга за времеви печат за STOP границата (затварящият отпечатък).',
  },
  sign_packages: {
    en: '`false`: packages are not signed until a private key is attached in the console.',
    bg: '`false`: пакетите не се подписват, докато в конзолата не се прикачи частен ключ.',
  },
  signing_key: {
    en: 'Empty: signing uses the key selected in the console (Settings → PGP keys).',
    bg: 'Празно: подписването ползва избрания в конзолата ключ (Настройки → PGP ключове).',
  },
  encrypt_files: {
    en: '`false`: uploads are stored as they are; `X-File-Encrypt` still wins per request.',
    bg: '`false`: качванията се пазят както са; `X-File-Encrypt` пак решава за конкретната заявка.',
  },
  portal_folder_copy: {
    en: '`false`: a file attached to a portal stays in the add-on data — no folder is created in /share. `true` also writes a copy with the original name into the portal folder (storage_root).',
    bg: '`false`: прикаченият към портал файл остава в данните на add-on-а — в /share не се създава папка. `true` слага и копие с истинското име в папката на портала (storage_root).',
  },
  tls_cert: {
    en: 'Empty: HTTPS is off. Certificate and private key must be set together, otherwise startup fails.',
    bg: 'Празно: HTTPS е изключен. Сертификат и ключ се задават заедно, иначе стартът се отказва.',
  },
  tls_key: {
    en: 'Empty: HTTPS is off. Both `tls_cert` and `tls_key` or neither.',
    bg: 'Празно: HTTPS е изключен. Или `tls_cert` и `tls_key` заедно, или нито едно.',
  },
  visitor_ip_mode: {
    en: '`hashed`: visitor addresses are stored as SHA-256 hashes. `masked` keeps the subnet, `full` the raw address.',
    bg: '`hashed`: адресите на посетителите се пазят като SHA-256 хеш. `masked` пази подмрежата, `full` — целия адрес.',
  },
  visitor_retention_days: {
    en: '`90`: visitor records are removed after 90 days. Set `0` to inherit the runtime default.',
    bg: '`90`: записите за посещения се махат след 90 дни. `0` значи „наследи подразбирането“.',
  },
  visitor_geoip_path: {
    en: 'Empty: no offline geo database, so the country stays unknown. An absolute path enables it.',
    bg: 'Празно: без офлайн геобаза, страната остава неизвестна. Абсолютен път я включва.',
  },
};

const show = (raw) => {
  if (raw === '""' || raw === "''") return '—';
  if (/^".*"$/.test(raw) || /^'.*'$/.test(raw)) return '`' + raw.slice(1, -1) + '`';
  return '`' + raw + '`';
};

function table(lang) {
  const names = namesOf(lang);
  const options = optionsOf();
  const missing = options.filter((o) => !MEANING[o.key] || !MEANING[o.key][lang]);
  if (missing.length) {
    throw new Error(
      'Липсва обяснение за подразбирането на: ' +
      missing.map((o) => o.key).join(', ') +
      ' — добави го в MEANING (иначе README ще мълчи за нова настройка).',
    );
  }
  const head = lang === 'bg'
    ? ['| Настройка | Ключ | По подразбиране | Какво следва от него |', '| --- | --- | --- | --- |']
    : ['| Setting | Key | Default | What the default means |', '| --- | --- | --- | --- |'];
  const rows = options.map(
    (o) => `| ${names[o.key] || o.key} | \`${o.key}\` | ${show(o.raw)} | ${MEANING[o.key][lang]} |`,
  );
  return { md: [...head, ...rows].join('\n'), count: options.length, schemaKeys: Object.keys(schemaOf()) };
}

const START = '<!-- SETTINGS-DEFAULTS:START — генерира се от scripts/settings-defaults.cjs; не се редактира на ръка -->';
const END = '<!-- SETTINGS-DEFAULTS:END -->';

// ── Настройките в конзолата (записват се в config/settings.json) ────────────
// Вземат се от самия модул, а не от копие: ако DEFAULT се промени, README-то следва.
const { DEFAULT } = require('../hapi_enterprise/runtime-config');

function flattened(obj, prefix) {
  const out = [];
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? prefix + '.' + key : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...flattened(value, name));
    else out.push([name, value]);
  }
  return out;
}

function consoleTable(lang) {
  const bg = lang === 'bg';
  const heading = bg ? '### Настройки в конзолата (раздел „Настройки“)' : '### Console settings (Settings tab)';
  const intro = bg
    ? 'Записват се в `config/settings.json` още при първия старт. `—` значи „наследява от опцията на add-on-а или от вграденото подразбиране“, а не „изключено“.'
    : 'Written to `config/settings.json` on the first start. `—` means “inherits from the add-on option or the built-in default”, not “off”.';
  const head = bg
    ? ['| Настройка | По подразбиране |', '| --- | --- |']
    : ['| Setting | Default |', '| --- | --- |'];
  const rows = flattened(DEFAULT).map(([key, value]) => {
    const shown = value === null ? '—' : '`' + String(value) + '`';
    return `| \`${key}\` | ${shown} |`;
  });
  return [heading, '', intro, '', ...head, ...rows].join('\n');
}

const TARGETS = [
  { file: 'hapi_enterprise/README.md', lang: 'en' },
  { file: 'BG.md', lang: 'bg' },
];

const results = [];
for (const target of TARGETS) {
  const abs = path.join(root, target.file);
  const text = fs.readFileSync(abs, 'utf8');
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) {
    throw new Error(target.file + ': липсват маркерите SETTINGS-DEFAULTS (виж README на add-on-а)');
  }
  const { md } = table(target.lang);
  const block = md + '\n\n' + consoleTable(target.lang);
  const next = text.slice(0, start + START.length) + '\n\n' + block + '\n\n' + text.slice(end);
  results.push({ file: target.file, current: text, next });
}

if (check) {
  const stale = results.filter((r) => r.current !== r.next);
  if (!stale.length) {
    const { count } = table('en');
    console.log('settings-defaults: README-тата са актуални (' + count + ' настройки)');
    process.exit(0);
  }
  for (const r of stale) console.error('settings-defaults: остаряла таблица в ' + r.file);
  console.error('  поправка: node scripts/settings-defaults.cjs');
  process.exit(1);
}

for (const r of results) fs.writeFileSync(path.join(root, r.file), r.next);
const { count } = table('en');
console.log('settings-defaults: записани ' + results.length + ' таблици (' + count + ' настройки)');
