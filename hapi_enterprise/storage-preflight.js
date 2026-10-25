'use strict';
const fs = require('node:fs'), path = require('node:path');
const roots = { addon_config: '/config', media: '/media', share: '/share' };
// Подразбиране от 0.69.87: `/share/hapi/data`. Документите са на едно предвидимо място,
// видимо през Samba/File editor и извън папката на add-on-а, така че преинсталиране или
// обновяване на add-on-а да не го мести. add-on папката остава валиден избор.
const DEFAULT_LOCATION = 'share', DEFAULT_SUB = 'hapi/data';
// Старото подразбиране — само за да НЕ се обяви стара инсталация за празна.
const LEGACY_LOCATION = 'addon_config', LEGACY_SUB = 'hapi_enterprise';
// До три нива (`hapi/data`, `documents/hapi/data`), всяко сегмент с безопасни знаци.
const SUB_OK = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*(\/[a-zA-Z0-9][a-zA-Z0-9_.-]*){0,2}$/;
function validSub(sub) { return typeof sub === 'string' && sub.length <= 160 && SUB_OK.test(sub) && !/(^|\/)\.\.?(\/|$)/.test(sub) }
/** Има ли РЕАЛНИ данни в тази папка (маркер + база/настройки), а не само празна директория. */
function hasData(dir) {
  try {
    if (!fs.existsSync(path.join(dir, '.portal-enterprise-storage'))) return false;
    return ['db.json', 'db', 'db.sqlite', 'config/settings.json'].some(rel => fs.existsSync(path.join(dir, rel)));
  } catch { return false }
}
function decodeMount(s) { return s.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))) }
function isMounted(mount, infoPath) {
  try { return fs.readFileSync(infoPath, 'utf8').split('\n').some(line => { const fields = line.split(' '); return fields.length > 4 && decodeMount(fields[4]) === mount }) } catch { return false }
}
function check(options, env = process.env) {
  const kind = options.storage_location || DEFAULT_LOCATION;
  if (!Object.hasOwn(roots, kind)) throw Error('Unsupported storage location');
  const sub = options.storage_subdirectory || DEFAULT_SUB;
  if (!validSub(sub)) throw Error('Invalid storage subdirectory');
  const root = env.STORAGE_ROOT_OVERRIDE ? path.resolve(env.STORAGE_ROOT_OVERRIDE, kind) : roots[kind];
  const mode = options.storage_mode || 'local';
  if (!['local', 'ha_network'].includes(mode)) throw Error('Unsupported storage mode');
  let parent = root;
  if (mode === 'ha_network') {
    if (!['media', 'share'].includes(kind)) throw Error('Network storage requires media or share mapping');
    const mount = options.storage_mount_name || '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(mount) || mount === '.' || mount === '..') throw Error('Invalid Home Assistant network storage name');
    parent = path.join(root, mount);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) throw Error('Home Assistant network storage is not mounted: ' + parent);
    // Never create the mountpoint: a missing NAS must fail closed, not write to the host filesystem.
    if (env.STORAGE_ROOT_OVERRIDE === undefined && !isMounted(parent, env.MOUNTINFO_PATH || '/proc/self/mountinfo')) throw Error('Network storage mount is not active: ' + parent);
  }
  let base = path.join(parent, sub), chosenRoot = root;
  // Миграционна защита: старото място има данни, новото е празно → ползва се СТАРОТО.
  // Иначе при обновяване „порталите изчезват“, защото add-on-ът стартира с нова празна база.
  const legacyRoot = env.STORAGE_ROOT_OVERRIDE ? path.resolve(env.STORAGE_ROOT_OVERRIDE, LEGACY_LOCATION) : roots[LEGACY_LOCATION];
  const legacyBase = path.join(legacyRoot, LEGACY_SUB);
  if (base !== legacyBase && hasData(legacyBase) && !hasData(base)) {
    console.error('STORAGE_LEGACY_LOCATION: намерени са данни в ' + legacyBase + ' — ползва се това място, за да не се създаде празна инсталация. Премести ги в ' + base + ' и рестартирай, за да минеш на новото подразбиране.');
    base = legacyBase; chosenRoot = legacyRoot;
  }
  if (!fs.existsSync(chosenRoot) || !fs.statSync(chosenRoot).isDirectory()) throw Error('Storage mount unavailable: ' + chosenRoot);
  if (fs.lstatSync(chosenRoot).isSymbolicLink()) throw Error('Symlink storage root refused');
  if (fs.existsSync(base)) {
    if (fs.lstatSync(base).isSymbolicLink() || !fs.statSync(base).isDirectory()) throw Error('Unsafe storage directory');
    const marker = path.join(base, '.portal-enterprise-storage');
    if (!fs.existsSync(marker)) {
      if (fs.readdirSync(base).length) throw Error('Nonempty uninitialized storage directory; refusing to overwrite');
      fs.writeFileSync(marker, 'portal-enterprise-v1\n', { flag: 'wx', mode: 0o600 });
    } else {
      const markerStat = fs.lstatSync(marker);
      if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.nlink !== 1) throw Error('Unsafe storage marker');
      if (fs.readFileSync(marker, 'utf8') !== 'portal-enterprise-v1\n') throw Error('Invalid storage marker');
    }
  } else {
    // `recursive` е нужен за подпапка с повече от едно ниво (`hapi/data`). Това НЕ създава
    // монтирането: то се проверява по-горе и липсващо монтиране е отказ, не mkdir.
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(base, '.portal-enterprise-storage'), 'portal-enterprise-v1\n', { flag: 'wx', mode: 0o600 });
  }
  const probe = path.join(base, '.write-test-' + process.pid);
  try { fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 }); fs.unlinkSync(probe) } catch (e) { throw Error('Storage is not writable: ' + e.message) }
  if (fs.statfsSync) { const s = fs.statfsSync(base); const free = Number(s.bavail) * Number(s.bsize); if (free < Number(options.min_free_mb || 100) * 1024 * 1024) throw Error('Insufficient free storage space') }
  return base;
}
if (require.main === module) { try { const options = JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')); process.stdout.write(check(options) + '\n') } catch (e) { console.error('STORAGE PREFLIGHT FAILED: ' + e.message); process.exit(1) } }
module.exports = { check, isMounted, hasData, validSub, DEFAULT_LOCATION, DEFAULT_SUB, LEGACY_LOCATION, LEGACY_SUB };
