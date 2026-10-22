'use strict';
// Сензори за комуникацията на портала: кой влиза, какво тегли, колко пъти, от кое IP и —
// ако администраторът е сложил офлайн база — приблизителна локация.
//
// Правила, които модулът НЕ прекрачва:
//   • никакви външни заявки. Геолокацията идва само от файл на диска (`GEOIP_DB_PATH`
//     или `<DATA_DIR>/geoip.json`). Без файл локацията е „unknown“, а не „измислена“.
//   • IP се пази според `ipMode`: `full` (по изрично искане), `masked` (последният октет
//     се нулира) или `hashed` (само HMAC; самият адрес не се записва).
//   • `X-Forwarded-For` се вярва САМО при `trustProxy` — иначе всеки би могъл да си
//     напише чужд адрес и да заблуди сензора.
//   • има срок на пазене (`retentionDays`) и право на изтриване по посетител (`forget`).
//
// Състоянието е един JSON файл (atomic запис), за да оцелее рестарт и да е лесно за
// архивиране. Всичко е с ограничен размер: до 5000 посетителя, 5000 адреса, 200 файла.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = 'visitor-intel.json';
const MAX_VISITORS = 5000, MAX_IPS = 5000, MAX_FILES = 200, MAX_LIST = 50;

// ── Разпознаване на клиента (без библиотеки) ────────────────────────────────
// Подредбата е важна: Edge съдържа „Chrome“, Chrome съдържа „Safari“, а ботовете
// често се представят за браузър — затова ботът се проверява ПЪРВИ.
const BROWSERS = [
  ['bot', /(bot|crawler|spider|crawling|preview|facebookexternalhit|slackbot|telegrambot|whatsapp|headlesschrome|curl\/|wget\/|python-requests|go-http-client|okhttp)/i],
  ['edge', /Edg(?:e|A|iOS)?\/([\d.]+)/i],
  ['opera', /(?:OPR|Opera)\/([\d.]+)/i],
  ['samsung', /SamsungBrowser\/([\d.]+)/i],
  ['firefox', /(?:Firefox|FxiOS)\/([\d.]+)/i],
  ['chrome', /(?:Chrome|CriOS)\/([\d.]+)/i],
  ['safari', /Version\/([\d.]+).*Safari/i],
];
const SYSTEMS = [
  ['android', /Android[ /]([\d.]+)/i],
  ['ios', /(?:iPhone|iPad|iPod).*?OS ([\d_]+)/i],
  ['windows', /Windows NT ([\d.]+)/i],
  ['macos', /Mac OS X ([\d_]+)/i],
  ['linux', /Linux/i],
];

function parseUserAgent(value) {
  const ua = String(value || '').slice(0, 512);
  if (!ua) return { browser: 'unknown', version: '', os: 'unknown', device: 'unknown', bot: false };
  let browser = 'other', version = '', bot = false;
  for (const [name, re] of BROWSERS) {
    const m = re.exec(ua);
    if (!m) continue;
    browser = name; version = m[1] || ''; bot = name === 'bot';
    break;
  }
  let os = 'other';
  for (const [name, re] of SYSTEMS) {
    const m = re.exec(ua);
    if (!m) continue;
    os = name; break;
  }
  const device = /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobile|iPhone|Android/i.test(ua) ? 'mobile' : bot ? 'bot' : 'desktop';
  return { browser, version: String(version).replace(/_/g, '.'), os, device, bot };
}

function parseLanguages(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((part) => {
      const [lang, q] = part.split(';').map((s) => s.trim());
      const weight = q && /^q=([\d.]+)$/i.test(q) ? Number(/^q=([\d.]+)$/i.exec(q)[1]) : 1;
      return { lang: String(lang || '').slice(0, 35).toLowerCase(), q: Number.isFinite(weight) ? weight : 1 };
    })
    .filter((entry) => entry.lang)
    .sort((a, b) => b.q - a.q);
}

const SEARCH_HOSTS = ['google.', 'bing.', 'duckduckgo.', 'yandex.', 'yahoo.', 'ecosia.', 'baidu.', 'qwant.', 'startpage.'];
const SOCIAL_HOSTS = ['facebook.', 'instagram.', 'linkedin.', 'twitter.', 'x.com', 't.me', 'telegram', 'whatsapp', 'viber', 'reddit.', 'pinterest.'];
function classifyReferer(value, ownHosts = []) {
  const raw = String(value || '').slice(0, 512);
  if (!raw) return { host: '', type: 'direct' };
  let host = '';
  try { host = new URL(raw).host.toLowerCase() } catch { return { host: '', type: 'invalid' } }
  const base = host.replace(/^www\./, '');
  if (ownHosts.some((own) => own && (base === own || base.endsWith('.' + own)))) return { host: base, type: 'internal' };
  if (SEARCH_HOSTS.some((needle) => base.includes(needle))) return { host: base, type: 'search' };
  if (SOCIAL_HOSTS.some((needle) => base.includes(needle))) return { host: base, type: 'social' };
  return { host: base, type: 'external' };
}

// ── IP: маскиране, хеширане, извличане ──────────────────────────────────────
function normalizeIp(value) {
  let ip = String(value || '').trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);          // IPv4, докарано през IPv6 сокет
  if (ip === '::1') return '127.0.0.1';
  return ip.slice(0, 45);
}
function maskIp(ip) {
  if (!ip) return '';
  if (ip.includes(':')) {
    const parts = ip.split(':').filter((p) => p !== '');
    return parts.slice(0, 4).join(':') + '::';
  }
  const v4 = ip.split('.');
  return v4.length === 4 ? `${v4[0]}.${v4[1]}.${v4[2]}.0` : ip;
}
const hashIp = (ip, salt = '') => crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 20);
const isPrivate = (ip) => Boolean(ip) && (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^127\./.test(ip) || /^169\.254\./.test(ip) || ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip));

function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const header = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const real = String(req.headers['x-real-ip'] || '').trim();
    if (header) return { ip: normalizeIp(header), source: 'x-forwarded-for' };
    if (real) return { ip: normalizeIp(real), source: 'x-real-ip' };
  }
  return { ip: normalizeIp((req.socket && req.socket.remoteAddress) || ''), source: 'socket' };
}

// ── Офлайн геолокация (без мрежа) ───────────────────────────────────────────
// Приема два формата:
//   { "ranges": [ { "cidr": "203.0.113.0/24", "country": "BG", "region": "София", "city": "София" } ] }
//   { "prefixes": { "203.0.113.": { "country": "BG" } } }
const v4ToInt = (ip) => {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = out * 256 + n;
  }
  return out;
};

function createGeo({ file } = {}) {
  let ranges = [], prefixes = [], loaded = false, error = '';
  const load = () => {
    if (!file) return;
    let raw;
    try { raw = fs.readFileSync(file, 'utf8') } catch (e) { error = e.code === 'ENOENT' ? 'not found' : e.code || 'unreadable'; return }
    let data;
    try { data = JSON.parse(raw) } catch { error = 'invalid json'; return }
    const list = Array.isArray(data && data.ranges) ? data.ranges : [];
    for (const item of list) {
      if (!item || typeof item.cidr !== 'string') continue;
      const [base, bitsRaw] = item.cidr.split('/');
      const bits = Number(bitsRaw);
      const numeric = v4ToInt(base);
      if (numeric === null || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      ranges.push({ base: (numeric & mask) >>> 0, mask, bits, country: item.country || '', region: item.region || '', city: item.city || '', asn: item.asn || '' });
    }
    ranges.sort((a, b) => b.bits - a.bits);       // най-специфичното първо
    const table = data && typeof data.prefixes === 'object' && data.prefixes ? data.prefixes : {};
    prefixes = Object.keys(table)
      .filter((key) => key && key.length <= 45)
      .sort((a, b) => b.length - a.length)        // най-дългият префикс печели
      .map((key) => ({ key, value: table[key] || {} }));
    loaded = ranges.length > 0 || prefixes.length > 0;
    if (!loaded) error = 'empty';
  };
  load();
  return {
    get status() { return { loaded, ranges: ranges.length, prefixes: prefixes.length, file: file || '', error } },
    reload() { ranges = []; prefixes = []; loaded = false; error = ''; load(); return this.status },
    lookup(ip) {
      const address = normalizeIp(ip);
      if (!address) return null;
      if (isPrivate(address)) return { country: 'LOCAL', region: '', city: '', asn: '', private: true };
      const numeric = v4ToInt(address);
      if (numeric !== null) {
        for (const range of ranges) if (((numeric & range.mask) >>> 0) === range.base) return { country: range.country, region: range.region, city: range.city, asn: range.asn, private: false };
      }
      for (const item of prefixes) if (address.startsWith(item.key)) return { country: item.value.country || '', region: item.value.region || '', city: item.value.city || '', asn: item.value.asn || '', private: false };
      return null;
    },
  };
}

// ── Състояние и агрегати ────────────────────────────────────────────────────
const emptyState = () => ({
  version: 1,
  since: new Date().toISOString(),
  totals: { events: 0, visits: 0, downloads: 0, denied: 0, adminLogins: 0, adminDenied: 0, ratings: 0 },
  byDay: {},
  portals: {},
  files: {},
  ips: {},
  geo: { countries: {}, cities: {}, unknown: 0, local: 0 },
  clients: { browsers: {}, os: {}, devices: {}, bots: 0 },
  languages: {},
  referrers: { hosts: {}, types: {} },
  hours: {},
  deniedReasons: {},
  visitors: {},
});

const bump = (bag, key, by = 1) => { if (!key) return; bag[key] = Number(bag[key] || 0) + by };
const drop = (bag, key, by = 1) => {
  if (!key || !Object.hasOwn(bag, key)) return;
  const next = Number(bag[key] || 0) - by;
  if (next > 0) bag[key] = next; else delete bag[key];
};
const trim = (map, max) => { const keys = Object.keys(map); if (keys.length <= max) return map; keys.sort((a, b) => Number(map[b].events ?? map[b].downloads ?? 0) - Number(map[a].events ?? map[a].downloads ?? 0)); for (const key of keys.slice(max)) delete map[key]; return map }
const dayOf = (iso) => iso.slice(0, 10);

function create({ dir, salt = '', ipMode = 'hashed', retentionDays = 90, geoFile = '', trustProxy = false, now = () => Date.now() } = {}) {
  const file = dir ? path.join(dir, FILE) : '';
  const geo = createGeo({ file: geoFile });
  let state = emptyState();
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved && typeof saved === 'object' && saved.totals && saved.visitors) {
        state = { ...emptyState(), ...saved };
        for (const key of Object.keys(emptyState())) if (state[key] === undefined || state[key] === null) state[key] = emptyState()[key];
      }
    } catch (e) { if (e.code !== 'ENOENT') console.error('VISITOR INTEL LOAD FAILED', e.code || e.message) }
  }
  let dirty = false, timer = null;
  const saveNow = () => {
    if (!file || !dirty) return; dirty = false;
    const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp) } catch { /* временният файл може да липсва */ }
      // Изтрита директория (спрян сървър, изчистен тест) не е грешка за сензора.
      if (e.code !== 'ENOENT') console.error('VISITOR INTEL SAVE FAILED', e.code || e.message);
    }
  };
  const touch = () => { dirty = true; if (timer) return; timer = setTimeout(() => { timer = null; saveNow() }, 1000); if (timer.unref) timer.unref() };

  const storedIp = (ip) => ipMode === 'full' ? ip : ipMode === 'masked' ? maskIp(ip) : '';

  function observe(req, { kind = 'visit', portal = null, file: asset = null, status = 0, reason = '', bytes = 0 } = {}) {
    const at = new Date(now()).toISOString();
    const peer = clientIp(req, { trustProxy });
    const ip = peer.ip;
    const ipKey = storedIp(ip);
    const ua = parseUserAgent(req.headers['user-agent']);
    const langs = parseLanguages(req.headers['accept-language']);
    const referrer = classifyReferer(req.headers.referer || req.headers.referrer, []);
    const platform = String(req.headers['sec-ch-ua-platform'] || '').replace(/"/g, '').slice(0, 32);
    const id = hashIp(ip + '|' + String(req.headers['user-agent'] || ''), salt || 'hapi');
    const known = Boolean(state.visitors[id]);
    const where = geo.lookup(ip);
    const entry = {
      at, kind, id,
      ip: ipKey, ipSource: peer.source,
      geo: where ? { country: where.country, region: where.region, city: where.city, asn: where.asn } : null,
      ua, languages: langs.map((l) => l.lang), language: langs[0] ? langs[0].lang : '',
      referrer, platform,
      dnt: req.headers.dnt === '1' || req.headers['sec-gpc'] === '1',
      portalId: portal ? portal.id : '', portalSlug: portal ? portal.slug : '', portalTitle: portal ? portal.title : '',
      fileId: asset ? asset.id : '', fileName: asset ? asset.name : '',
      status: Number(status) || 0, reason: String(reason || ''), bytes: Number(bytes) || 0,
    };

    state.totals.events++;
    if (kind === 'download') state.totals.downloads++;
    else if (kind === 'denied') state.totals.denied++;
    else if (kind === 'admin.login') state.totals.adminLogins++;
    else if (kind === 'admin.denied') state.totals.adminDenied++;
    else if (kind === 'rating') state.totals.ratings++;
    else state.totals.visits++;

    const day = dayOf(at);
    const dayBag = state.byDay[day] ??= { visits: 0, downloads: 0, denied: 0, visitors: 0 };
    if (kind === 'download') dayBag.downloads++;
    else if (kind === 'denied') dayBag.denied++;
    else dayBag.visits++;
    if (Object.keys(state.byDay).length > 400) { const oldest = Object.keys(state.byDay).sort()[0]; delete state.byDay[oldest] }

    if (entry.portalId) {
      const bag = state.portals[entry.portalId] ??= {
        slug: entry.portalSlug, title: entry.portalTitle, visits: 0, downloads: 0, denied: 0, visitors: {},
        geo: { countries: {}, cities: {}, unknown: 0, local: 0 }, browsers: {}, languages: {}, lastAt: '',
      };
      bag.slug = entry.portalSlug || bag.slug; bag.title = entry.portalTitle || bag.title;
      // Профилните измерения се броят ВЕДНЪЖ на посетител ЗА ТОЗИ ПОРТАЛ — така
      // мониторингът на портала показва собствените си данни, а не общите за инсталацията.
      const firstHere = !bag.visitors[id];
      if (kind === 'download') bag.downloads++;
      else if (kind === 'denied') bag.denied++;
      else bag.visits++;
      bag.visitors[id] = 1;
      bag.lastAt = at;
      if (firstHere) {
        if (entry.geo) {
          if (entry.geo.country === 'LOCAL') bag.geo.local++;
          else { bump(bag.geo.countries, entry.geo.country || 'unknown'); if (entry.geo.city) bump(bag.geo.cities, entry.geo.city) }
        } else bag.geo.unknown++;
        bump(bag.browsers, entry.ua.browser);
        if (entry.language) bump(bag.languages, entry.language);
      }
    }
    if (entry.fileId) {
      const bag = state.files[entry.fileId] ??= { name: entry.fileName, downloads: 0, visitors: {}, lastAt: '' };
      bag.name = entry.fileName || bag.name; bag.lastAt = at;
      if (kind === 'download') { bag.downloads++; bag.visitors[id] = Number(bag.visitors[id] || 0) + 1 }
      trim(state.files, MAX_FILES);
    }
    if (kind === 'denied' || kind === 'admin.denied') bump(state.deniedReasons, entry.reason || 'unspecified');
    if (ipKey) {
      const bag = state.ips[ipKey] ??= { events: 0, downloads: 0, visitors: {}, firstSeen: at, lastSeen: at, geo: entry.geo };
      bag.events++; if (kind === 'download') bag.downloads++;
      bag.lastSeen = at; bag.geo = bag.geo || entry.geo; bag.visitors[id] = 1;
      trim(state.ips, MAX_IPS);
    }
    if (entry.geo) {
      // Държавата се брои ВЕДНЪЖ на посетител — сензорът отговаря „откъде са
      // посетителите“, а не „колко заявки са дошли“. Иначе един активен клиент
      // изкривява картата.
      if (!known) {
        if (entry.geo.country === 'LOCAL') state.geo.local++;
        else { bump(state.geo.countries, entry.geo.country || 'unknown'); if (entry.geo.city) bump(state.geo.cities, entry.geo.city) }
      }
    } else if (!known) state.geo.unknown++;

    // Профилните измерения (клиент, език) се броят по посетител; реферерите — по
    // събитие, за да се вижда откъде идва трафикът.
    if (!known) {
      bump(state.clients.browsers, entry.ua.browser);
      bump(state.clients.os, entry.ua.os);
      bump(state.clients.devices, entry.ua.device);
      if (entry.ua.bot) state.clients.bots++;
      if (entry.language) bump(state.languages, entry.language);
    }
    bump(state.referrers.hosts, entry.referrer.host || '(direct)');
    bump(state.referrers.types, entry.referrer.type);
    bump(state.hours, String(new Date(at).getUTCHours()));

    const visitor = state.visitors[id] ??= {
      id, firstSeen: at, lastSeen: at, visits: 0, downloads: 0, denied: 0,
      ips: {}, agents: {}, languages: {}, referrers: {}, portals: {}, files: {}, geo: null, last: null,
    };
    visitor.lastSeen = at;
    if (kind === 'download') visitor.downloads++;
    else if (kind === 'denied' || kind === 'admin.denied') visitor.denied++;
    else visitor.visits++;
    if (ipKey) visitor.ips[ipKey] = (visitor.ips[ipKey] || 0) + 1;
    bump(visitor.agents, `${entry.ua.browser}/${entry.ua.os}/${entry.ua.device}`);
    if (entry.language) bump(visitor.languages, entry.language);
    bid(visitor.referrers, entry.referrer.host || '(direct)');
    if (entry.portalId) bump(visitor.portals, entry.portalId);
    if (entry.fileId) { const f = visitor.files[entry.fileId] ??= { name: entry.fileName, downloads: 0, lastAt: '' }; f.name = entry.fileName || f.name; f.lastAt = at; if (kind === 'download') f.downloads++ }
    if (entry.geo && !visitor.geo) visitor.geo = entry.geo;
    visitor.last = { at, kind, status: entry.status, reason: entry.reason, portalSlug: entry.portalSlug, fileName: entry.fileName, referrer: entry.referrer.type, browser: entry.ua.browser, os: entry.ua.os, device: entry.ua.device, language: entry.language };

    trim(state.visitors, MAX_VISITORS);
    touch();
    return entry;
  }
  // Отделен помощник за речници на посетителя (без изтриване на брояча при повторен ключ).
  function bid(bag, key) { if (key) bag[key] = Number(bag[key] || 0) + 1 }

  function prune() {
    const limit = now() - Number(retentionDays || 0) * 86400000;
    if (!Number.isFinite(limit)) return { removed: 0 };
    let removed = 0;
    for (const [id, visitor] of Object.entries(state.visitors)) {
      if (Date.parse(visitor.lastSeen) < limit) { delete state.visitors[id]; removed++ }
    }
    for (const [ip, bag] of Object.entries(state.ips)) {
      if (Date.parse(bag.lastSeen) < limit) { delete state.ips[ip]; removed++ }
    }
    for (const [day, bag] of Object.entries(state.byDay)) {
      if (Date.parse(day + 'T00:00:00.000Z') < limit) { delete state.byDay[day]; bag.removed = true }
    }
    if (removed) { touch(); saveNow() }
    return { removed, retentionDays: Number(retentionDays) || 0 };
  }

  function sensors() {
    const visitors = Object.values(state.visitors);
    const dayAgo = now() - 86400000;
    const weekAgo = now() - 7 * 86400000;
    const unique = visitors.length;
    const downloadVisitors = visitors.filter((v) => v.downloads > 0).length;
    const countries = Object.entries(state.geo.countries).sort((a, b) => b[1] - a[1]);
    const topCountry = countries.length ? countries[0][0] : '';
    const flat = {
      unique_visitors: unique,
      visitors_new_24h: visitors.filter((v) => Date.parse(v.firstSeen) >= dayAgo).length,
      visitors_new_7d: visitors.filter((v) => Date.parse(v.firstSeen) >= weekAgo).length,
      visitors_returning: visitors.filter((v) => Date.parse(v.firstSeen) < weekAgo).length,
      download_visitors: downloadVisitors,
      downloads_per_visitor: unique ? Number((state.totals.downloads / Math.max(1, downloadVisitors || unique)).toFixed(2)) : 0,
      denied_total: state.totals.denied,
      admin_logins: state.totals.adminLogins,
      countries_known: countries.length,
      country_top: topCountry,
      country_top_hits: countries.length ? countries[0][1] : 0,
    };
    const topN = (bag, n = 10) => Object.entries(bag).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, n);
    return {
      generatedAt: new Date(now()).toISOString(),
      since: state.since,
      privacy: { ipMode, retentionDays: Number(retentionDays) || 0, externalCalls: false, geoFile: geo.status },
      ...flat,
      totals: { ...state.totals },
      byDay: state.byDay,
      byHourUtc: Object.fromEntries(Object.entries(state.hours).sort((a, b) => Number(a[0]) - Number(b[0]))),
      geo: { countries: state.geo.countries, cities: state.geo.cities, unknown: state.geo.unknown, local: state.geo.local, top: topN(state.geo.countries, 10) },
      clients: { ...state.clients, topBrowsers: topN(state.clients.browsers), topSystems: topN(state.clients.os), topDevices: topN(state.clients.devices) },
      languages: { ...state.languages, top: topN(state.languages) },
      referrers: { ...state.referrers, topHosts: topN(state.referrers.hosts) },
      denied: { total: state.totals.denied, reasons: state.deniedReasons },
      portals: Object.entries(state.portals).map(([id, bag]) => ({
        id, slug: bag.slug, title: bag.title, visits: bag.visits, downloads: bag.downloads, denied: bag.denied,
        visitors: Object.keys(bag.visitors).length,
        lastAt: bag.lastAt || '',
        geo: { countries: bag.geo.countries, cities: bag.geo.cities, unknown: bag.geo.unknown, local: bag.geo.local },
        browsers: bag.browsers, languages: bag.languages,
      })).sort((a, b) => b.downloads - a.downloads),
      files: Object.entries(state.files).map(([id, bag]) => ({ id, name: bag.name, downloads: bag.downloads, visitors: Object.keys(bag.visitors).length, lastAt: bag.lastAt })).sort((a, b) => b.downloads - a.downloads),
      topIps: Object.entries(state.ips).map(([ip, bag]) => ({ ip, events: bag.events, downloads: bag.downloads, visitors: Object.keys(bag.visitors).length, country: bag.geo ? bag.geo.country : '', city: bag.geo ? bag.geo.city : '', firstSeen: bag.firstSeen, lastSeen: bag.lastSeen })).sort((a, b) => b.events - a.events).slice(0, 20),
    };
  }

  function list({ limit = MAX_LIST, sort = 'lastSeen' } = {}) {
    const all = Object.values(state.visitors).map((v) => ({
      id: v.id, firstSeen: v.firstSeen, lastSeen: v.lastSeen, visits: v.visits, downloads: v.downloads, denied: v.denied,
      ips: Object.keys(v.ips), geo: v.geo, agents: Object.keys(v.agents), language: Object.keys(v.languages)[0] || '', files: Object.values(v.files).reduce((n, f) => n + f.downloads, 0),
    }));
    const order = sort === 'downloads' ? (a, b) => b.downloads - a.downloads : sort === 'visits' ? (a, b) => b.visits - a.visits : (a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen));
    return all.sort(order).slice(0, Math.max(1, Math.min(500, Number(limit) || MAX_LIST)));
  }

  function profile(id) {
    const visitor = state.visitors[id];
    if (!visitor) return null;
    return {
      ...visitor,
      language: Object.keys(visitor.languages)[0] || '',
      agents: Object.entries(visitor.agents).map(([key, count]) => ({ key, count })),
      languages: Object.entries(visitor.languages).map(([key, count]) => ({ key, count })),
      referrers: Object.entries(visitor.referrers).map(([key, count]) => ({ key, count })),
      portals: Object.entries(visitor.portals).map(([key, count]) => ({ portalId: key, events: count })),
      files: Object.entries(visitor.files).map(([key, value]) => ({ fileId: key, ...value })),
    };
  }

  function forget(id) {
    const visitor = state.visitors[id];
    if (!visitor) return { removed: false };
    // Агрегатите, които се пълнят ВЕДНЪЖ на посетител (локация, клиент, език), се
    // намаляват — иначе изтриването на човека оставя неговата следа в картата.
    if (visitor.geo) {
      if (visitor.geo.country === 'LOCAL') state.geo.local = Math.max(0, state.geo.local - 1);
      else { drop(state.geo.countries, visitor.geo.country || 'unknown'); if (visitor.geo.city) drop(state.geo.cities, visitor.geo.city) }
    } else state.geo.unknown = Math.max(0, state.geo.unknown - 1);
    for (const agent of Object.keys(visitor.agents)) {
      const [browser, os, device] = agent.split('/');
      drop(state.clients.browsers, browser);
      drop(state.clients.os, os);
      drop(state.clients.devices, device);
      if (browser === 'bot') state.clients.bots = Math.max(0, state.clients.bots - 1);
    }
    for (const lang of Object.keys(visitor.languages)) drop(state.languages, lang);

    // Същото и за всяко място, което посетителят е докоснал: броячите там също се
    // намаляват, иначе „изтрит“ човек остава в мониторинга на портала.
    for (const portalId of Object.keys(visitor.portals)) {
      const bag = state.portals[portalId];
      if (!bag) continue;
      if (visitor.geo) {
        if (visitor.geo.country === 'LOCAL') bag.geo.local = Math.max(0, bag.geo.local - 1);
        else { drop(bag.geo.countries, visitor.geo.country || 'unknown'); if (visitor.geo.city) drop(bag.geo.cities, visitor.geo.city) }
      } else bag.geo.unknown = Math.max(0, bag.geo.unknown - 1);
      for (const agent of Object.keys(visitor.agents)) drop(bag.browsers, agent.split('/')[0]);
      for (const lang of Object.keys(visitor.languages)) drop(bag.languages, lang);
    }

    delete state.visitors[id];
    for (const bag of Object.values(state.portals)) delete bag.visitors[id];
    for (const bag of Object.values(state.files)) delete bag.visitors[id];
    for (const bag of Object.values(state.ips)) { delete bag.visitors[id]; if (!Object.keys(bag.visitors).length) delete state.ips[bagKey(bag)] }
    // Изтриването е решение на администратора — записва се ВЕДНАГА, а не след дебаунса.
    touch(); saveNow();
    return { removed: true, id };
  }
  // Намира ключа на IP кофата по референция (използва се само при изтриване).
  function bagKey(target) { for (const [key, bag] of Object.entries(state.ips)) if (bag === target) return key; return '' }

  function csv() {
    const head = ['visitor', 'firstSeen', 'lastSeen', 'visits', 'downloads', 'denied', 'country', 'city', 'browser', 'os', 'device', 'language', 'referrer'];
    const rows = Object.values(state.visitors).map((v) => {
      const agent = Object.keys(v.agents)[0] || '//';
      const [browser = '', os = '', device = ''] = agent.split('/');
      return [v.id, v.firstSeen, v.lastSeen, v.visits, v.downloads, v.denied, (v.geo && v.geo.country) || '', (v.geo && v.geo.city) || '', browser, os, device, Object.keys(v.languages)[0] || '', Object.keys(v.referrers)[0] || ''];
    });
    const esc = (value) => { const s = String(value ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s };
    return [head, ...rows].map((row) => row.map(esc).join(',')).join('\n');
  }

  function prometheus(prefix = 'hapi_visitors') {
    const s = sensors();
    const lines = [
      `# HELP ${prefix}_total Всички наблюдавани събития`,
      `# TYPE ${prefix}_total counter`,
      `${prefix}_total ${s.totals.events}`,
      `# HELP ${prefix}_unique Уникални посетители (по IP+UA)`,
      `# TYPE ${prefix}_unique gauge`,
      `${prefix}_unique ${s.unique_visitors}`,
      `# HELP ${prefix}_downloads Изтегляния`,
      `# TYPE ${prefix}_downloads counter`,
      `${prefix}_downloads ${s.totals.downloads}`,
      `# HELP ${prefix}_denied Отказани достъпи`,
      `# TYPE ${prefix}_denied counter`,
      `${prefix}_denied ${s.totals.denied}`,
      `# HELP ${prefix}_admin_logins Успешни администраторски влизания`,
      `# TYPE ${prefix}_admin_logins counter`,
      `${prefix}_admin_logins ${s.totals.adminLogins}`,
    ];
    for (const [country, count] of Object.entries(s.geo.countries)) lines.push(`${prefix}_country{country="${String(country).replace(/"/g, '')}"} ${count}`);
    // Без имена на файлове: метриките са агрегат и не носят съдържание на портала.
    return lines.join('\n') + '\n';
  }

  function flush() { if (timer) { clearTimeout(timer); timer = null } saveNow(); return Boolean(file) }
  function reset() { state = emptyState(); touch(); return true }

  return { observe, sensors, list, profile, forget, csv, prometheus, prune, flush, reset, geo, get ipMode() { return ipMode }, get state() { return state } };
}

module.exports = { create, createGeo, parseUserAgent, parseLanguages, classifyReferer, clientIp, maskIp, hashIp, normalizeIp, isPrivate };
