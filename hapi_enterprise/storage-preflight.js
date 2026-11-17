'use strict';
const fs = require('node:fs'), path = require('node:path');
const paths = require('./paths');
// Логическите корени идват от `paths.js` — един източник за целия проект (вж. `tests/storage-roots.cjs`).
// Имената в опциите (`addon_config`) не съвпадат с ключовете в `paths.LOGICAL_ROOTS` (`config`);
// превеждането живее в `paths.OPTION_ROOTS`, за да го ползва и логическият корен на порталите.
const ROOT_NAMES = paths.OPTION_ROOTS;
const roots = Object.fromEntries(Object.entries(ROOT_NAMES).map(([option, name]) => [option, paths.LOGICAL_ROOTS[name]]));
// Подразбиране от 0.69.234: `/share/hAPI/data`. Документите са на едно предвидимо място,
// видимо през Samba/File editor и извън папката на add-on-а, така че преинсталиране или
// обновяване на add-on-а да не го мести. add-on папката остава валиден избор.
const DEFAULT_LOCATION = paths.STORAGE_DEFAULTS.location, DEFAULT_SUB = paths.STORAGE_DEFAULTS.subdirectory;
// Старите подразбирания — само за да НЕ се обяви стара инсталация за празна. Редът е от
// най-новото към най-старото: първото място с РЕАЛНИ данни печели.
//   0.69.87 – 0.69.233: `/share/hapi/data` (малка буква; порталите в `data/root_storage`)
//   до 0.69.87:         `<add-on config>/hapi_enterprise`
const LEGACY_LOCATIONS = Object.freeze([
  Object.freeze({ location: 'share', sub: 'hapi/data' }),
  Object.freeze({ location: 'addon_config', sub: 'hapi_enterprise' }),
]);
// До три нива (`hAPI/data`, `documents/hapi/data`), всяко сегмент с безопасни знаци.
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
  // Пътят се взема от `paths.js`: при липсващ логически корен на ТАЗИ машина (или на
  // Windows, където `/share` е `D:\share`) резултатът е празен низ — тогава preflight-ът се
  // проваля ЗАКРИТО, вместо да създаде хранилище на чуждо място (вж. `tests/storage-roots.cjs`).
  // Override-ът е тестов механизъм и пази ИМЕТО НА ОПЦИЯТА като име на папка (`addon_config`).
  const root = env.STORAGE_ROOT_OVERRIDE ? path.resolve(env.STORAGE_ROOT_OVERRIDE, kind) : paths.existingRoot(ROOT_NAMES[kind], env);
  if (!root) throw Error('Storage root is not available on this host: ' + roots[kind]);
  const mode = options.storage_mode || 'local';
  if (!['local', 'ha_network'].includes(mode)) throw Error('Unsupported storage mode');
  let parent = root, mountName = '';
  if (mode === 'ha_network') {
    if (!['media', 'share'].includes(kind)) throw Error('Network storage requires media or share mapping');
    const mount = options.storage_mount_name || '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(mount) || mount === '.' || mount === '..') throw Error('Invalid Home Assistant network storage name');
    parent = path.join(root, mount);
    mountName = mount;
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory() || fs.lstatSync(parent).isSymbolicLink()) throw Error('Home Assistant network storage is not mounted: ' + parent);
    // Never create the mountpoint: a missing NAS must fail closed, not write to the host filesystem.
    if (env.STORAGE_ROOT_OVERRIDE === undefined && !isMounted(parent, env.MOUNTINFO_PATH || '/proc/self/mountinfo')) throw Error('Network storage mount is not active: ' + parent);
  }
  let base = path.join(parent, sub), chosenRoot = root, effectiveLocation = kind, effectiveSub = sub;
  // Миграционна защита: старото място има данни, новото е празно → ползва се СТАРОТО.
  // Иначе при обновяване „порталите изчезват“, защото add-on-ът стартира с нова празна база.
  const baseOf = (location, legacySub) => {
    const legacyRoot = env.STORAGE_ROOT_OVERRIDE
      ? path.resolve(env.STORAGE_ROOT_OVERRIDE, location)
      : paths.existingRoot(ROOT_NAMES[location], env);
    return legacyRoot ? { root: legacyRoot, base: path.join(legacyRoot, legacySub) } : null;
  };
  for (const legacy of LEGACY_LOCATIONS) {
    if (hasData(base)) break; // новото място вече има данни → няма какво да се спасява
    const candidate = baseOf(legacy.location, legacy.sub);
    if (!candidate || candidate.base === base || !hasData(candidate.base)) continue;
    console.error('STORAGE_LEGACY_LOCATION: намерени са данни в ' + candidate.base + ' — ползва се това място, за да не се създаде празна инсталация. Премести ги в ' + base + ' и рестартирай, за да минеш на новото подразбиране.');
    base = candidate.base; chosenRoot = candidate.root; effectiveLocation = legacy.location; effectiveSub = legacy.sub;
    break;
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
  // `recursive` е нужен за подпапка с повече от едно ниво (`hAPI/data`). Това НЕ създава
    // монтирането: то се проверява по-горе и липсващо монтиране е отказ, не mkdir.
    fs.mkdirSync(base, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(base, '.portal-enterprise-storage'), 'portal-enterprise-v1\n', { flag: 'wx', mode: 0o600 });
  }
  const probe = path.join(base, '.write-test-' + process.pid);
  try { fs.writeFileSync(probe, 'ok', { flag: 'wx', mode: 0o600 }); fs.unlinkSync(probe) } catch (e) { throw Error('Storage is not writable: ' + e.message) }
  if (fs.statfsSync) { const s = fs.statfsSync(base); const free = Number(s.bavail) * Number(s.bsize); if (free < Number(options.min_free_mb || 100) * 1024 * 1024) throw Error('Insufficient free storage space') }
  // Ефективният избор се записва в env: от него `paths.hapiHome()` строи домашната папка на
  // add-on-а (`/share/hAPI`), а `paths.portalsRoot()` — мястото на порталите
  // (`/share/hAPI/portals`), без втори списък с корени. `storage_subdirectory` мести САМО
  // вътрешните данни (база, настройки, маркер), не потребителските папки на порталите.
  env[paths.ENV.STORAGE_LOCATION] = effectiveLocation;
  env[paths.ENV.STORAGE_SUBDIRECTORY] = effectiveSub;
  env[paths.ENV.STORAGE_MOUNT] = mode === 'ha_network' ? mountName : '';
  return base;
}
if (require.main === module) { try { const options = JSON.parse(fs.readFileSync(process.env.OPTIONS_PATH || '/data/options.json', 'utf8')); process.stdout.write(check(options) + '\n') } catch (e) { console.error('STORAGE PREFLIGHT FAILED: ' + e.message); process.exit(1) } }
module.exports = { check, isMounted, hasData, validSub, DEFAULT_LOCATION, DEFAULT_SUB, LEGACY_LOCATIONS };
