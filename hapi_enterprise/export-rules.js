'use strict';
// File Delivery & Export Manager — правила за експорт (FD-0).
//
// Единствен източник на истина за: режимите на изтегляне, съдържанието на пакета,
// именуването, безопасните пътища и кога проверката на SHA-256 е задължителна.
// Чист JS (UMD) — ползва се от backend-а (hapi_enterprise) и от GUI-я (ui/).
// Никакви зависимости, никакъв I/O.
(function () {
  const SCHEMA_VERSION = '1.0';
  const MAX_REL_PATH = 240;
  const MAX_SEGMENT = 120;

  // ── Съдържание на пакета ───────────────────────────────────────────────────
  const CONTENTS = {
    pdf: { label: 'PDF отчет', paths: ['report/forensic_report.pdf'] },
    manifest: { label: 'JSON манифест', paths: ['manifest/input_manifest.json', 'manifest/result_manifest.json'] },
    hashes: { label: 'Пълен набор хешове', paths: ['hashes/sha256sum.txt', 'hashes/checksums.txt'] },
    timestamps: {
      label: 'RFC 3161 START / STOP',
      paths: ['timestamps/start.tsr', 'timestamps/stop.tsr'],
      evidence: true,
    },
    originals: { label: 'Оригинални файлове', paths: ['originals/'], folder: true },
    audit: { label: 'Audit / Logs', paths: ['audit/export_audit.json'] },
    certificates: { label: 'Сертификати и проверки', paths: ['certificates/'], folder: true },
    templates: { label: 'Профили и шаблони', paths: ['templates/'], folder: true },
  };
  const CONTENT_IDS = Object.keys(CONTENTS);

  // ── Режими (12) ────────────────────────────────────────────────────────────
  const MODES = [
    { id: 'single', label: 'Единичен файл', format: 'file', contents: ['originals'], permission: 'files.download' },
    { id: 'selected', label: 'Избрани файлове', format: 'zip', contents: ['originals'], permission: 'files.download' },
    {
      id: 'report',
      label: 'Пълен отчет',
      format: 'zip',
      contents: ['pdf', 'manifest'],
      permission: 'reports.export',
    },
    {
      id: 'evidence',
      label: 'Доказателствен пакет',
      format: 'zip',
      contents: ['pdf', 'manifest', 'hashes', 'timestamps', 'originals', 'audit', 'certificates'],
      permission: 'evidence.export',
      verification: 'required',
      evidence: true,
    },
    { id: 'manifest', label: 'Само манифест', format: 'json', contents: ['manifest'], permission: 'reports.export' },
    {
      id: 'certificates',
      label: 'Сертификати',
      format: 'zip',
      contents: ['certificates', 'timestamps'],
      permission: 'audit.export',
      verification: 'required',
      evidence: true,
    },
    { id: 'pdf', label: 'PDF експорт', format: 'pdf', contents: ['pdf'], permission: 'reports.export' },
    { id: 'template', label: 'Шаблон', format: 'json', contents: ['templates'], permission: 'templates.export' },
    {
      id: 'backup',
      label: 'Архив на проекта',
      format: 'zip',
      contents: ['originals', 'manifest', 'audit'],
      permission: 'backups.create',
      verification: 'required',
      evidence: true,
    },
    {
      id: 'audit',
      label: 'Одит експорт',
      format: 'json',
      contents: ['audit'],
      permission: 'audit.export',
      verification: 'required',
      evidence: true,
    },
    { id: 'bulk', label: 'Групово експортиране', format: 'zip', contents: ['originals'], permission: 'bulk.export' },
    {
      id: 'verified',
      label: 'Проверен трансфер',
      format: 'folder',
      contents: ['originals'],
      permission: 'files.download',
      verification: 'required',
      evidence: true,
    },
  ];
  const MODES_BY_ID = MODES.reduce((acc, m) => Object.assign(acc, { [m.id]: m }), {});

  const FORMATS = {
    zip: { label: 'ZIP', ext: '.zip' },
    folder: { label: 'FOLDER', ext: '' },
    pdf: { label: 'PDF', ext: '.pdf' },
    json: { label: 'JSON', ext: '.json' },
    file: { label: 'FILE', ext: '' },
  };

  const ON_CONFLICT = {
    unique: { label: 'Ново уникално име' },
    skip: { label: 'Пропусни и регистрирай' },
    abort: { label: 'Прекрати операцията' },
  };

  const LOCATIONS = {
    folder: { label: 'Локална папка', target: 'FOLDER', atomicRename: true },
    usb: { label: 'USB', target: 'USB', atomicRename: true },
    nas: { label: 'SMB / NAS', target: 'NAS', atomicRename: true },
    ha_share: { label: 'Home Assistant (share)', target: 'HA_SHARE', atomicRename: true },
    browser: { label: 'Браузър (поточно)', target: 'BROWSER', atomicRename: false },
  };

  // ── Глобални правила (огледало на config/rules/download_rules.json) ───────
  const DEFAULT_RULES = {
    schema_version: SCHEMA_VERSION,
    overwrite: false,
    on_conflict: 'unique',
    verify_sha256: true,
    read_only_attribute: false,
    temp_suffix: '.part',
    max_concurrent_downloads: 2,
    temp_retention_hours: 24,
    max_rel_path: MAX_REL_PATH,
    package: { prefix: 'RPT', case_fallback: 'CASE' },
    evidence: { verification: 'required', overwrite: 'forbidden' },
    storage: { allowed_roots: ['/data', '/share', '/media'] },
    capabilities: {
      compression: false,
      split_archive: false,
      rate_limit: false,
      parallel_transfers: false,
      encrypt_package: false,
      resume_transfer: false,
    },
  };

  const CAPABILITIES = [
    { id: 'compression', label: 'Компресия (нива)' },
    { id: 'split_archive', label: 'Разделяне на големи архиви на части' },
    { id: 'rate_limit', label: 'Ограничаване на скоростта' },
    { id: 'parallel_transfers', label: 'Паралелни трансфери' },
    { id: 'encrypt_package', label: 'Криптиране на експортния пакет' },
    { id: 'resume_transfer', label: 'Възобновяване на прекъснат трансфер' },
  ];

  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/g;

  function sanitizeSegment(value) {
    let s = String(value == null ? '' : value).replace(FORBIDDEN, '_');
    s = s.replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
    if (!s || s === '.' || s === '..') return '';
    if (RESERVED.test(s)) s = `_${s}`;
    return s.slice(0, MAX_SEGMENT);
  }

  function isReservedName(value) {
    return RESERVED.test(String(value || '').trim());
  }

  /** Валидира относителен път в пакета. Връща {ok, path, reason}. */
  function safeRelPath(relPath) {
    const raw = String(relPath == null ? '' : relPath).replace(/\\/g, '/').trim();
    if (!raw) return { ok: false, path: '', reason: 'empty' };
    if (raw.startsWith('//')) return { ok: false, path: '', reason: 'unc' };
    if (raw.startsWith('/')) return { ok: false, path: '', reason: 'absolute' };
    if (/^[A-Za-z]:/.test(raw)) return { ok: false, path: '', reason: 'drive-letter' };
    if (raw.length > MAX_REL_PATH) return { ok: false, path: '', reason: 'too-long' };
    const parts = raw.split('/');
    const clean = [];
    for (const part of parts) {
      if (!part || part === '.') return { ok: false, path: '', reason: 'empty-segment' };
      if (part === '..') return { ok: false, path: '', reason: 'traversal' };
      if (FORBIDDEN.test(part)) return { ok: false, path: '', reason: 'forbidden-char' };
      if (/[. ]$/.test(part)) return { ok: false, path: '', reason: 'trailing-dot' };
      if (RESERVED.test(part)) return { ok: false, path: '', reason: 'reserved-name' };
      FORBIDDEN.lastIndex = 0;
      clean.push(part);
    }
    return { ok: true, path: clean.join('/'), reason: '' };
  }

  /** Проверява списък от пътища: невалидни + колизии без значение от регистъра. */
  function safePaths(paths) {
    const list = Array.isArray(paths) ? paths : [];
    const errors = [];
    const seen = new Map();
    const duplicates = [];
    for (const p of list) {
      const res = safeRelPath(p);
      if (!res.ok) {
        errors.push({ path: String(p), reason: res.reason });
        continue;
      }
      const key = res.path.toLowerCase();
      if (seen.has(key)) duplicates.push([seen.get(key), res.path]);
      else seen.set(key, res.path);
    }
    return { ok: errors.length === 0 && duplicates.length === 0, errors, duplicates };
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  /** Предвидимо име на пакета: RPT-YYYYMMDD-HHMMSS-CASE001 (UTC). */
  function packageId(date, caseId) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const casePart =
      String(caseId == null ? '' : caseId)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 24) || 'CASE';
    const stamp = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
    const time = `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
    return `RPT-${stamp}-${time}-${casePart}`;
  }

  function requiresVerification(mode) {
    const def = MODES_BY_ID[mode];
    return Boolean(def && def.verification === 'required');
  }

  function isEvidenceMode(mode) {
    const def = MODES_BY_ID[mode];
    return Boolean(def && def.evidence);
  }

  function permissionFor(mode) {
    const def = MODES_BY_ID[mode];
    return (def && def.permission) || 'files.download';
  }

  function contentLabel(id) {
    return (CONTENTS[id] && CONTENTS[id].label) || String(id);
  }

  /**
   * Нормализира потребителска конфигурация за експорт.
   * Доказателствените режими ВИНАГИ получават verifySha256:true (правило 6).
   */
  function normalizeConfig(input) {
    const src = input && typeof input === 'object' ? input : {};
    const mode = MODES_BY_ID[src.mode] ? src.mode : 'evidence';
    const def = MODES_BY_ID[mode];
    let contents = Array.isArray(src.contents) ? src.contents.filter((id) => CONTENTS[id]) : [];
    if (!contents.length) contents = def.contents.slice();
    contents = [...new Set(contents)];
    const format = FORMATS[src.format] ? src.format : def.format;
    const location = LOCATIONS[src.location] ? src.location : 'folder';
    const onConflict = ON_CONFLICT[src.onConflict] ? src.onConflict : 'unique';
    const verifySha256 = requiresVerification(mode) ? true : src.verifySha256 !== false;
    return {
      schema_version: SCHEMA_VERSION,
      mode,
      contents,
      format,
      location,
      onConflict,
      verifySha256,
      readOnly: Boolean(src.readOnly),
      packageId: src.packageId ? String(src.packageId) : '',
      caseId: src.caseId ? String(src.caseId) : '',
      files: Array.isArray(src.files) ? src.files.map(String) : [],
      templates: Array.isArray(src.templates) ? src.templates.map(String) : [],
      notes: src.notes ? String(src.notes) : '',
    };
  }

  function validateConfig(config) {
    const errors = [];
    const warnings = [];
    const cfg = config && typeof config === 'object' ? config : {};
    if (!MODES_BY_ID[cfg.mode]) errors.push({ code: 'mode', message: `Непознат режим: ${cfg.mode}` });
    const contents = Array.isArray(cfg.contents) ? cfg.contents : [];
    if (!contents.length) errors.push({ code: 'contents-empty', message: 'Не е избрано съдържание на пакета' });
    for (const id of contents) {
      if (!CONTENTS[id]) errors.push({ code: 'content-unknown', message: `Непознато съдържание: ${id}` });
    }
    if (!FORMATS[cfg.format]) errors.push({ code: 'format', message: `Непознат формат: ${cfg.format}` });
    if (!LOCATIONS[cfg.location]) errors.push({ code: 'location', message: `Непознато местоназначение: ${cfg.location}` });
    if (!ON_CONFLICT[cfg.onConflict]) errors.push({ code: 'on-conflict', message: `Непозната политика: ${cfg.onConflict}` });
    if (requiresVerification(cfg.mode) && cfg.verifySha256 === false) {
      errors.push({ code: 'verify-required', message: 'За доказателствен режим проверката на SHA-256 е задължителна' });
    }
    if (isEvidenceMode(cfg.mode) && cfg.format === 'json') {
      errors.push({ code: 'format-evidence', message: 'Доказателствен пакет не може да е единичен JSON' });
    }
    if (contents.includes('timestamps') && !contents.includes('hashes')) {
      warnings.push({ code: 'timestamps-without-hashes', message: 'TSA токени без файл с хешове' });
    }
    if (cfg.packageId && !/^RPT-\d{8}-\d{6}-[A-Z0-9]{1,24}$/.test(cfg.packageId)) {
      errors.push({ code: 'package-id', message: 'Невалидно име на пакета' });
    }
    if (cfg.readOnly && cfg.location === 'browser') {
      warnings.push({ code: 'readonly-browser', message: 'Read-only атрибут не се поддържа при браузър' });
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  function uniqueName(taken, name) {
    const lower = new Set(taken.map((n) => n.toLowerCase()));
    if (!lower.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (lower.has(`${base} (${n})${ext}`.toLowerCase())) n += 1;
    return `${base} (${n})${ext}`;
  }

  /**
   * Планира съдържанието на пакета (без да пише нищо).
   * Връща { packageId, entries:[{path, content, kind}], index }.
   */
  function planPaths(config, meta) {
    const cfg = normalizeConfig(config);
    const info = meta && typeof meta === 'object' ? meta : {};
    const entries = [];
    const taken = [];
    const add = (relPath, content, kind) => {
      const res = safeRelPath(relPath);
      if (!res.ok) return;
      const folder = kind === 'folder';
      let path = res.path;
      if (!folder) path = uniqueName(taken, path);
      const key = path.toLowerCase();
      if (!folder) {
        if (taken.some((t) => t.toLowerCase() === key)) return;
        taken.push(path);
      }
      entries.push({ path, content, kind: kind || content });
    };

    for (const id of cfg.contents) {
      const def = CONTENTS[id];
      for (const p of def.paths) {
        if (p.endsWith('/')) continue; // папките се пълнят по-долу
        add(p, id);
      }
    }

    if (cfg.contents.includes('originals')) {
      const files = cfg.files.length ? cfg.files : Array.isArray(info.files) ? info.files.map(String) : [];
      for (const name of files) {
        const safe = sanitizeSegment(name) || 'file';
        add(`originals/${safe}`, 'originals');
      }
      if (!files.length) add('originals', 'originals', 'folder');
    }
    if (cfg.contents.includes('templates')) {
      const templates = cfg.templates.length
        ? cfg.templates
        : Array.isArray(info.templates)
          ? info.templates.map(String)
          : [];
      for (const name of templates) {
        const safe = sanitizeSegment(name) || 'template';
        add(`templates/${safe.replace(/\.json$/i, '')}.json`, 'templates');
      }
      if (!templates.length) add('templates', 'templates', 'folder');
    }
    if (cfg.contents.includes('certificates')) add('certificates', 'certificates', 'folder');

    entries.push({ path: 'PACKAGE_INDEX.json', content: 'index', kind: 'index' });
    const id = cfg.packageId || packageId(info.date instanceof Date ? info.date : new Date(), cfg.caseId || info.caseId);
    return { packageId: id, entries, config: cfg };
  }

  function summary(config) {
    const cfg = normalizeConfig(config);
    const target = (LOCATIONS[cfg.location] && LOCATIONS[cfg.location].target) || cfg.location.toUpperCase();
    const format = (FORMATS[cfg.format] && FORMATS[cfg.format].label) || cfg.format.toUpperCase();
    return {
      categories: cfg.contents.length,
      format,
      sha: cfg.verifySha256,
      target,
      text: `Избрани категории: ${cfg.contents.length} · Формат: ${format} · SHA-256: ${cfg.verifySha256 ? 'Включена' : 'Изключена'
        } · Цел: ${target}`,
    };
  }

  // Кое е РЕАЛНО готово. Списъкът е изричен, за да не се обявява способност за готова
  // със самата си наличност в масива: `compression` е готова от 0.69.51 (нива 0–9, 0 =
  // без компресия; виж `packager.compressionLevel`), останалите още не са.
  const READY = {
    compression: { implemented: true, status: 'ready' },
    split_archive: { implemented: true, status: 'ready' },
    rate_limit: { implemented: true, status: 'ready' },
    parallel_transfers: { implemented: true, status: 'ready' },
    encrypt_package: { implemented: true, status: 'ready' },
  };

  function capabilities() {
    return CAPABILITIES.map((c) => Object.assign({}, c, READY[c.id] || { implemented: false, status: 'planned' }));
  }

  function validateRules(rules) {
    const errors = [];
    const r = rules && typeof rules === 'object' ? rules : {};
    if (r.schema_version !== SCHEMA_VERSION) errors.push('schema_version трябва да е ' + SCHEMA_VERSION);
    if (typeof r.overwrite !== 'boolean') errors.push('overwrite трябва да е boolean');
    if (!ON_CONFLICT[r.on_conflict]) errors.push('on_conflict е невалиден');
    if (typeof r.verify_sha256 !== 'boolean') errors.push('verify_sha256 трябва да е boolean');
    if (!r.evidence || r.evidence.verification !== 'required') errors.push('evidence.verification трябва да е required');
    if (!r.evidence || r.evidence.overwrite !== 'forbidden') errors.push('evidence.overwrite трябва да е forbidden');
    if (!Array.isArray(r.storage && r.storage.allowed_roots)) errors.push('storage.allowed_roots липсва');
    if (!r.capabilities || typeof r.capabilities !== 'object') errors.push('capabilities липсва');
    else {
      for (const c of CAPABILITIES) {
        if (typeof r.capabilities[c.id] !== 'boolean') errors.push(`capabilities.${c.id} трябва да е boolean`);
      }
    }
    return { ok: errors.length === 0, errors };
  }

  const API = {
    SCHEMA_VERSION,
    MAX_REL_PATH,
    MAX_SEGMENT,
    CONTENTS,
    CONTENT_IDS,
    MODES,
    MODES_BY_ID,
    FORMATS,
    ON_CONFLICT,
    LOCATIONS,
    DEFAULT_RULES,
    CAPABILITIES,
    sanitizeSegment,
    isReservedName,
    safeRelPath,
    safePaths,
    packageId,
    requiresVerification,
    isEvidenceMode,
    permissionFor,
    contentLabel,
    normalizeConfig,
    validateConfig,
    planPaths,
    summary,
    capabilities,
    validateRules,
    uniqueName,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  globalThis.HapiExportRules = API;
})();
