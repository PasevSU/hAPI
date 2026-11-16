'use strict';
// ДЕСКРИПТОР НА ГЛОБАЛНИТЕ ОПЦИИ — ЕДНО МЯСТО ЗА ЕДНА ОПЦИЯ (O-01 от
// `documentation/02_TO_BE_ARCHITECTURE/DOCS_AND_OPTIONS_STRUCTURE.md`).
//
// Защо съществува: 44 опции се описваха на пет места — `options:` и `schema:` в `config.yaml`,
// три превода, четири различни стила за `option → env` в `start.js`, README-то и панела.
// Затова не можеше да се напише проверка „всяка опция се чете“: преименуванията
// (`backup_folder → BACKUP_DIR`) не се знаят от никого извън кода.
//
// Тук всяка опция е ЕДИН запис с това, което днес е разпръснато: ключ, име на променливата, тип
// от `schema:` и стойност по подразбиране от `options:`. Още НЕ съдържа група, собственик и
// обяснение на празната стойност — те идват с O2/O3 и не бива да се измислят, за да изглежда
// дескрипторът пълен.
//
// Договорът се проверява от `tests/option-spec.cjs`: дескрипторът и `config.yaml` трябва да
// съвпадат по ключове, типове и подразбирания, а `env` да е `UPPER(ключ)` или едно от
// изрично изброените преименувания. Ново преименуване без ред тук = паднал тест.
//
// `secret: true` значи едно нещо: стойността не бива да излиза в чист вид в лог, отчет или
// диагностичен пакет (`tests/option-secrets.cjs`). То НЕ значи, че полето се маскира в картата
// на add-on-а — това решава `type: password` в `schema:`. Затова `tls_key` е тайна по смисъл
// (път до ключ), но остава `str?` в картата: потребителят трябва да го вижда, за да го поправи.
// Липсата на флаг тук при име, което правилото за редакция хваща, е дефект в двете посоки.
// `readBy` е ЧИТАТЕЛЯТ, а не списък със съвпадения на думата. Всяка опция има поне един файл
// (път от `hapi_enterprise/`), за който `tests/option-effects.cjs` проверява, че наистина чете
// стойността — по име на променлива (`\bENV\b`) или по достъп до ключа (`.key`, `['key']`).
// Така „описана, но мъртва“ опция пада, а „спомената в коментар“ не минава за читател.
//
// `firstRunOnly: true` значи, че стойността се чете ВЕДНЪЖ, при първи старт, от
// `/data/options.json` (Home Assistant го пише от картата на add-on-а) и след това смяната ѝ не
// прави нищо. Трите такива опции не бива да се описват като „никой не ги чете“ — точно това
// твърдяха преводите до 0.69.228 (DEF-90).
const OPTIONS = [
  { key: 'token', env: 'ADMIN_TOKEN', type: 'password?', def: "", secret: true, readBy: ['start.js', 'server.js'] },
  { key: 'pgp_path_public', env: 'PGP_PATH_PUBLIC', type: 'str?', def: "", readBy: ['start.js', 'path-crypto.js'] },
  { key: 'pgp_path_secret', env: 'PGP_PATH_SECRET', type: 'str?', def: "", secret: true, readBy: ['start.js', 'path-crypto.js'] },
  { key: 'pgp_path_pass', env: 'PGP_PATH_PASS', type: 'str?', def: "", secret: true, readBy: ['start.js', 'path-crypto.js'] },
  { key: 'pgp_key_pass', env: 'PGP_KEY_PASS', type: 'password?', def: "", secret: true, readBy: ['start.js', 'path-crypto.js', 'pgp.js'] },
  { key: 'pgp_encrypt_paths', env: 'PGP_ENCRYPT_PATHS', type: 'bool?', def: false, readBy: ['start.js', 'path-crypto.js'] },
  { key: 'pgp_encrypt_workdir', env: 'PGP_ENCRYPT_WORKDIR', type: 'bool?', def: false, readBy: ['start.js', 'path-crypto.js'] },
  { key: 'username', env: 'USERNAME', type: 'str?', def: "", readBy: ['server.js'], firstRunOnly: true },
  { key: 'password', env: 'PASSWORD', type: 'password?', def: "", secret: true, readBy: ['server.js'], firstRunOnly: true },
  { key: 'db_name', env: 'DB_NAME', type: 'str?', def: "Files", readBy: ['server.js'], firstRunOnly: true },
  { key: 'backup_folder', env: 'BACKUP_DIR', type: 'str?', def: "", readBy: ['start.js', 'server.js'] },
  { key: 'backup_mirror', env: 'BACKUP_MIRROR', type: 'str?', def: "", readBy: ['start.js', 'server.js'] },
  { key: 'storage_mirror', env: 'STORAGE_MIRROR', type: 'str?', def: "", readBy: ['start.js', 'server.js', 'mirror-target.js'] },
  { key: 's3_access_key', env: 'S3_ACCESS_KEY', type: 'str?', def: "", secret: true, readBy: ['start.js', 'server.js', 'mirror-target.js'] },
  { key: 's3_secret_key', env: 'S3_SECRET_KEY', type: 'password?', def: "", secret: true, readBy: ['start.js', 'server.js', 'mirror-target.js'] },
  { key: 'memory_limit_mb', env: 'MEMORY_LIMIT_MB', type: 'int(0,8192)?', def: 1024, readBy: ['start.js'] },
  { key: 'db_id', env: 'DB_ID', type: 'str?', def: "1", readBy: ['server.js'] },
  { key: 'profiles', env: 'PROFILES', type: 'str?', def: "", readBy: ['server.js', 'config-profiles.js'] },
  { key: 'public_domain', env: 'PUBLIC_BASE_URL', type: 'str?', def: "", readBy: ['start.js', 'runtime-config.js'] },
  { key: 'public_gateway', env: 'PUBLIC_GATEWAY', type: 'bool?', def: true, readBy: ['gateway-api.js'] },
  { key: 'public_same_origin', env: 'PUBLIC_SAME_ORIGIN', type: 'bool?', def: true, readBy: ['gateway-api.js'] },
  { key: 'user_roles', env: 'USER_ROLES', type: 'str?', def: '{"pasev-admin":"admin"}', readBy: ['server.js'] },
  { key: 'group_roles', env: 'GROUP_ROLES', type: 'str?', def: "", readBy: ['server.js'] },
  { key: 'storage_location', env: 'STORAGE_LOCATION', type: 'list(addon_config|media|share)', def: 'share', readBy: ['paths.js', 'storage-preflight.js'] },
  { key: 'storage_subdirectory', env: 'STORAGE_SUBDIRECTORY', type: 'match(^[a-zA-Z0-9][a-zA-Z0-9_.-]*(/[a-zA-Z0-9][a-zA-Z0-9_.-]*){0,2}$)', def: 'hAPI/data', readBy: ['paths.js', 'storage-preflight.js'] },
  { key: 'storage_mode', env: 'STORAGE_MODE', type: 'list(local|ha_network)', def: 'local', readBy: ['storage-preflight.js'] },
  { key: 'storage_mount_name', env: 'STORAGE_MOUNT_NAME', type: 'str?', def: "", readBy: ['paths.js', 'storage-preflight.js'] },
  { key: 'min_free_mb', env: 'MIN_FREE_MB', type: 'int(0,1048576)', def: 1000, readBy: ['storage-preflight.js'] },
  { key: 'log_level', env: 'LOG_LEVEL', type: 'list(error|warn|info|debug|trace)', def: 'info', readBy: ['server.js'] },
  { key: 'config_dir', env: 'HAPI_CONFIG_DIR', type: 'str?', def: "", readBy: ['start.js', 'gateway-api.js'] },
  { key: 'evidence_portal_deploy', env: 'EVIDENCE_PORTAL_DEPLOY', type: 'bool?', def: true, readBy: ['server.js'] },
  { key: 'tsa_enabled', env: 'TSA_ENABLED', type: 'bool?', def: true, readBy: ['start.js', 'crypto-options.js'] },
  { key: 'tsa_start_url', env: 'TSA_START_URL', type: 'str?', def: "https://zeitstempel.dfn.de/", readBy: ['start.js', 'crypto-options.js'] },
  { key: 'tsa_stop_url', env: 'TSA_STOP_URL', type: 'str?', def: "https://timestamp.digicert.com", readBy: ['start.js', 'crypto-options.js'] },
  { key: 'sign_packages', env: 'SIGN_PACKAGES', type: 'bool?', def: false, readBy: ['start.js', 'crypto-options.js'] },
  { key: 'signing_key', env: 'SIGNING_KEY', type: 'str?', def: "", secret: true, readBy: ['start.js', 'crypto-options.js'] },
  { key: 'encrypt_files', env: 'ENCRYPT_FILES', type: 'bool?', def: false, readBy: ['start.js', 'crypto-options.js'] },
  { key: 'portal_folder_copy', env: 'PORTAL_FOLDER_COPY', type: 'bool?', def: false, readBy: ['start.js', 'server.js'] },
  { key: 'portal_skin', env: 'PORTAL_SKIN', type: 'list(classic|modern)', def: 'classic', readBy: ['start.js', 'portal-skin.js'] },
  { key: 'tls_cert', env: 'TLS_CERT', type: 'str?', def: "", readBy: ['start.js', 'crypto-options.js'] },
  { key: 'tls_key', env: 'TLS_KEY', type: 'str?', def: "", secret: true, readBy: ['start.js', 'crypto-options.js'] },
  { key: 'visitor_ip_mode', env: 'VISITOR_IP_MODE', type: 'match(^(hashed|masked|full)?$)?', def: 'hashed', readBy: ['start.js', 'runtime-config.js'] },
  { key: 'visitor_retention_days', env: 'VISITOR_RETENTION_DAYS', type: 'int(0,3650)?', def: 90, readBy: ['start.js', 'runtime-config.js'] },
  { key: 'visitor_geoip_path', env: 'GEOIP_DB_PATH', type: 'str?', def: "", readBy: ['start.js', 'runtime-config.js'] },
];

// Преименувания: правилото е `UPPER(ключ)`; всяко изключение има причина и се вижда в
// справочника (`OPTIONS_REFERENCE.md` §3), за да не е скрит дълг.
const RENAMED = {
  token: 'вътрешен мастер ключ: различен живот от опцията, не се показва',
  backup_folder: 'историческо име, пазено за съвместимост',
  public_domain: 'минава през валидация и нормализация към PUBLIC_BASE_URL',
  config_dir: 'вътрешно име с префикс HAPI_',
  visitor_geoip_path: 'модулът е споделен с edge режима',
};

/** Записът за опция по ключ (или `null`). */
function byKey(key) {
  return OPTIONS.find((o) => o.key === key) || null;
}

/** Името на променливата: `env` от записа, иначе `UPPER(ключ)`. */
function envOf(key) {
  const entry = byKey(key);
  return entry ? entry.env : String(key).toUpperCase();
}

module.exports = { OPTIONS, RENAMED, byKey, envOf };
