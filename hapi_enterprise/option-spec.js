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
const OPTIONS = [
  { key: 'token', env: 'ADMIN_TOKEN', type: 'password?', def: "", secret: true },
  { key: 'pgp_path_public', env: 'PGP_PATH_PUBLIC', type: 'str?', def: "" },
  { key: 'pgp_path_secret', env: 'PGP_PATH_SECRET', type: 'str?', def: "" },
  { key: 'pgp_path_pass', env: 'PGP_PATH_PASS', type: 'str?', def: "" },
  { key: 'pgp_key_pass', env: 'PGP_KEY_PASS', type: 'password?', def: "", secret: true },
  { key: 'pgp_encrypt_paths', env: 'PGP_ENCRYPT_PATHS', type: 'bool?', def: false },
  { key: 'pgp_encrypt_workdir', env: 'PGP_ENCRYPT_WORKDIR', type: 'bool?', def: false },
  { key: 'username', env: 'USERNAME', type: 'str?', def: "" },
  { key: 'password', env: 'PASSWORD', type: 'password?', def: "", secret: true },
  { key: 'db_name', env: 'DB_NAME', type: 'str?', def: "Files" },
  { key: 'backup_folder', env: 'BACKUP_DIR', type: 'str?', def: "" },
  { key: 'backup_mirror', env: 'BACKUP_MIRROR', type: 'str?', def: "" },
  { key: 'storage_mirror', env: 'STORAGE_MIRROR', type: 'str?', def: "" },
  { key: 's3_access_key', env: 'S3_ACCESS_KEY', type: 'str?', def: "" },
  { key: 's3_secret_key', env: 'S3_SECRET_KEY', type: 'password?', def: "", secret: true },
  { key: 'memory_limit_mb', env: 'MEMORY_LIMIT_MB', type: 'int(0,8192)?', def: 1024 },
  { key: 'db_id', env: 'DB_ID', type: 'str?', def: "1" },
  { key: 'profiles', env: 'PROFILES', type: 'str?', def: "" },
  { key: 'public_domain', env: 'PUBLIC_BASE_URL', type: 'str?', def: "" },
  { key: 'public_gateway', env: 'PUBLIC_GATEWAY', type: 'bool?', def: true },
  { key: 'public_same_origin', env: 'PUBLIC_SAME_ORIGIN', type: 'bool?', def: true },
  { key: 'user_roles', env: 'USER_ROLES', type: 'str?', def: '{"pasev-admin":"admin"}' },
  { key: 'group_roles', env: 'GROUP_ROLES', type: 'str?', def: "" },
  { key: 'storage_location', env: 'STORAGE_LOCATION', type: 'list(addon_config|media|share)', def: 'share' },
  { key: 'storage_subdirectory', env: 'STORAGE_SUBDIRECTORY', type: 'match(^[a-zA-Z0-9][a-zA-Z0-9_.-]*(/[a-zA-Z0-9][a-zA-Z0-9_.-]*){0,2}$)', def: 'hAPI/data' },
  { key: 'storage_mode', env: 'STORAGE_MODE', type: 'list(local|ha_network)', def: 'local' },
  { key: 'storage_mount_name', env: 'STORAGE_MOUNT_NAME', type: 'str?', def: "" },
  { key: 'min_free_mb', env: 'MIN_FREE_MB', type: 'int(0,1048576)', def: 1000 },
  { key: 'log_level', env: 'LOG_LEVEL', type: 'list(error|warn|info|debug|trace)', def: 'info' },
  { key: 'config_dir', env: 'HAPI_CONFIG_DIR', type: 'str?', def: "" },
  { key: 'evidence_portal_deploy', env: 'EVIDENCE_PORTAL_DEPLOY', type: 'bool?', def: true },
  { key: 'tsa_enabled', env: 'TSA_ENABLED', type: 'bool?', def: true },
  { key: 'tsa_start_url', env: 'TSA_START_URL', type: 'str?', def: "https://zeitstempel.dfn.de/" },
  { key: 'tsa_stop_url', env: 'TSA_STOP_URL', type: 'str?', def: "https://timestamp.digicert.com" },
  { key: 'sign_packages', env: 'SIGN_PACKAGES', type: 'bool?', def: false },
  { key: 'signing_key', env: 'SIGNING_KEY', type: 'str?', def: "" },
  { key: 'encrypt_files', env: 'ENCRYPT_FILES', type: 'bool?', def: false },
  { key: 'portal_folder_copy', env: 'PORTAL_FOLDER_COPY', type: 'bool?', def: false },
  { key: 'portal_skin', env: 'PORTAL_SKIN', type: 'list(classic|modern)', def: 'classic' },
  { key: 'tls_cert', env: 'TLS_CERT', type: 'str?', def: "" },
  { key: 'tls_key', env: 'TLS_KEY', type: 'str?', def: "" },
  { key: 'visitor_ip_mode', env: 'VISITOR_IP_MODE', type: 'match(^(hashed|masked|full)?$)?', def: 'hashed' },
  { key: 'visitor_retention_days', env: 'VISITOR_RETENTION_DAYS', type: 'int(0,3650)?', def: 90 },
  { key: 'visitor_geoip_path', env: 'GEOIP_DB_PATH', type: 'str?', def: "" },
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
