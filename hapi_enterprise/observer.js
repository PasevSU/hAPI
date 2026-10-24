'use strict';
// Наблюдение (сензори) без зависимости: комуникация, файлове, извиквания, изтегляния,
// посещения. Всичко е агрегат — без IP адреси, токени и имена на файлове, така че
// snapshot-ът е безопасен за показване и за експорт към мониторинг.
//
//   • http      — заявки по listener (public/admin/gateway), клас на статуса, байтове,
//                 латентност (p50/p95/max от последните N извадки);
//   • routes    — „METHOD /шаблон/път“ (24-hex id, uuid и slug-ове се нормализират),
//                 за да не расте кардиналността; ограничен брой маршрути;
//   • files     — качвания/изтривания и байтове, шифровани качвания;
//   • downloads — успешни/отказани и байтове;
//   • visits    — отваряния на портал и QR сканирания;
//   • system    — рестарти, старт, ъптайм.
//
// Състоянието се записва периодично в `<dir>/sensors.json` (atomic tmp+rename), за да
// оцелее рестарт; `restarts` се увеличава при всяко стартиране.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = 'sensors.json';

function emptyState() {
  return {
    version: 1,
    restarts: 0,
    startedAt: new Date().toISOString(),
    http: {
      total: 0,
      byListener: {},
      byStatus: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
      bytesIn: 0,
      bytesOut: 0,
      latency: { count: 0, sumMs: 0, maxMs: 0, samples: [] },
    },
    routes: {},
    files: { uploaded: 0, uploadBytes: 0, deleted: 0, deleteBytes: 0, encrypted: 0, mirrorFailed: 0 },
    downloads: { ok: 0, denied: 0, bytes: 0 },
    visits: { page: 0, qr: 0, portals: {} },
    system: { lastObservedAt: null },
  };
}

function normalizePath(pathname) {
  const raw = String(pathname || '/').split('?')[0];
  const out = raw
    .replace(/\/[0-9a-f]{24}(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/g, '/:uuid')
    .replace(/\/[A-Za-z0-9_-]{1,80}\.(?:tsr|json|sqlite|zip)(?=\/|$)/g, '/:file')
    .replace(/^\/api\/v1\/p\/[^/]+/, '/api/v1/p/:slug')
    .replace(/^\/qr\/[^/]+/, '/qr/:slug')
    .replace(/^\/p\/[^/]+/, '/p/:slug')
    .replace(/^\/site\/[^/]+\/[^/]+/, '/site/:portal/:project')
    // `/t/<token>` е ПУБЛИЧЕН вход по токен. Без това токенът отиваше в името на
    // маршрута и оттам в `sensors.json` и в `/admin/api/sensors` — точно това, което
    // Stage D забранява. Нормализира се ПРЕДИ всичко останало по пътя.
    .replace(/^\/t\/[^/]+/, '/t/:token')
    .replace(/^\/admin\/api\/portals\/[^/]+/, '/admin/api/portals/:id')
    .replace(/^\/admin\/api\/packages\/[^/]+/, '/admin/api/packages/:id')
    .replace(/^\/admin\/api\/pgp\/keys\/[^/]+/, '/admin/api/pgp/keys/:id');
  return out.length > 160 ? `${out.slice(0, 160)}…` : out;
}

const statusClass = (status) => {
  const s = Number(status) || 0;
  if (s >= 500) return '5xx';
  if (s >= 400) return '4xx';
  if (s >= 300) return '3xx';
  if (s >= 200) return '2xx';
  return 'other';
};

function create({ dir, flushMs = 5000, maxRoutes = 200, sampleSize = 512 } = {}) {
  const file = dir ? path.join(dir, FILE) : null;
  let state = emptyState();

  // Зареждане: броячите оцеляват рестарт, restarts се увеличава.
  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved && typeof saved === 'object' && saved.http && saved.routes) {
        state = { ...emptyState(), ...saved };
        state.http.latency = { ...emptyState().http.latency, ...(saved.http.latency || {}) };
        state.files = { ...emptyState().files, ...(saved.files || {}) };
        state.downloads = { ...emptyState().downloads, ...(saved.downloads || {}) };
        state.visits = { ...emptyState().visits, ...(saved.visits || {}) };
        state.visits.portals = { ...((saved.visits && saved.visits.portals) || {}) };
        // Стар запис може да носи токен в името на маршрута (преди нормализацията на
        // `/t/<token>`). Такъв ключ се изтрива, за да не остане тайна на диска.
        for (const key of Object.keys(saved.routes || {})) {
          if (/\/(pt_|ps_|pu_|fk_)[A-Za-z0-9_-]{8,}/.test(key)) delete saved.routes[key];
        }
      }
    } catch {
      /* първи старт или повреден файл: започваме чисто */
    }
  }
  state.restarts = (Number(state.restarts) || 0) + 1;
  state.startedAt = new Date().toISOString();
  state.http.latency.samples = [];
  state.http.latency.count = Number(state.http.latency.count) || 0;
  state.http.latency.sumMs = Number(state.http.latency.sumMs) || 0;
  state.http.latency.maxMs = Number(state.http.latency.maxMs) || 0;

  let dirty = true;
  let timer = null;
  let closed = false;

  function writeAtomic() {
    if (!file || !dirty) return;
    dirty = false;
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      dirty = true;
    }
  }

  if (file) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore: диагностиката не бива да спира add-on-а */
    }
    timer = setInterval(writeAtomic, Math.max(1000, flushMs));
    if (typeof timer.unref === 'function') timer.unref();
  }

  function observe({ method = 'GET', path: pathname = '/', status = 200, ms = 0, bytesIn = 0, bytesOut = 0, listener = 'public' } = {}) {
    const elapsed = Number.isFinite(Number(ms)) ? Math.max(0, Number(ms)) : 0;
    const http = state.http;
    http.total += 1;
    http.byListener[listener] = (http.byListener[listener] || 0) + 1;
    const cls = statusClass(status);
    http.byStatus[cls] = (http.byStatus[cls] || 0) + 1;
    http.bytesIn += Math.max(0, Number(bytesIn) || 0);
    http.bytesOut += Math.max(0, Number(bytesOut) || 0);
    http.latency.count += 1;
    http.latency.sumMs += elapsed;
    if (elapsed > http.latency.maxMs) http.latency.maxMs = elapsed;
    http.latency.samples.push(Math.round(elapsed * 10) / 10);
    if (http.latency.samples.length > sampleSize) http.latency.samples.shift();

    const key = `${String(method).toUpperCase()} ${normalizePath(pathname)}`;
    const routes = state.routes;
    let bucket = routes[key];
    if (!bucket) {
      if (Object.keys(routes).length >= maxRoutes) {
        const overflow = `${String(method).toUpperCase()} other`;
        bucket = routes[overflow] || (routes[overflow] = { count: 0, errors: 0, sumMs: 0, maxMs: 0, bytesOut: 0 });
      } else {
        bucket = routes[key] = { count: 0, errors: 0, sumMs: 0, maxMs: 0, bytesOut: 0 };
      }
    }
    bucket.count += 1;
    if (Number(status) >= 400) bucket.errors += 1;
    bucket.sumMs += elapsed;
    if (elapsed > bucket.maxMs) bucket.maxMs = elapsed;
    bucket.bytesOut += Math.max(0, Number(bytesOut) || 0);

    state.system.lastObservedAt = new Date().toISOString();
    dirty = true;
  }

  const fileUpload = ({ bytes = 0, encrypted = false } = {}) => {
    state.files.uploaded += 1;
    state.files.uploadBytes += Math.max(0, Number(bytes) || 0);
    if (encrypted) state.files.encrypted += 1;
    dirty = true;
  };
  const fileDelete = ({ bytes = 0 } = {}) => {
    state.files.deleted += 1;
    state.files.deleteBytes += Math.max(0, Number(bytes) || 0);
    dirty = true;
  };
  const mirrorFailed = () => {
    state.files.mirrorFailed += 1;
    dirty = true;
  };
  const download = ({ ok = true, bytes = 0 } = {}) => {
    if (ok) {
      state.downloads.ok += 1;
      state.downloads.bytes += Math.max(0, Number(bytes) || 0);
    } else {
      state.downloads.denied += 1;
    }
    dirty = true;
  };
  const visit = ({ portalId = '', qr = false } = {}) => {
    if (qr) state.visits.qr += 1;
    else state.visits.page += 1;
    if (portalId) state.visits.portals[portalId] = (state.visits.portals[portalId] || 0) + 1;
    dirty = true;
  };

  function percentile(sample, q) {
    if (!sample.length) return 0;
    const sorted = [...sample].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[index];
  }

  function snapshot() {
    const http = state.http;
    const samples = http.latency.samples;
    return {
      version: state.version,
      generatedAt: new Date().toISOString(),
      restarts: state.restarts,
      startedAt: state.startedAt,
      uptimeSeconds: Math.round((Date.now() - Date.parse(state.startedAt)) / 1000),
      http: {
        total: http.total,
        byListener: { ...http.byListener },
        byStatus: { ...http.byStatus },
        bytesIn: http.bytesIn,
        bytesOut: http.bytesOut,
        latencyMs: {
          count: http.latency.count,
          avg: http.latency.count ? Math.round((http.latency.sumMs / http.latency.count) * 10) / 10 : 0,
          p50: percentile(samples, 0.5),
          p95: percentile(samples, 0.95),
          max: http.latency.maxMs,
          sampled: samples.length,
        },
      },
      routes: Object.fromEntries(
        Object.entries(state.routes).map(([key, value]) => [
          key,
          {
            count: value.count,
            errors: value.errors,
            avgMs: value.count ? Math.round((value.sumMs / value.count) * 10) / 10 : 0,
            maxMs: value.maxMs,
            bytesOut: value.bytesOut,
          },
        ]),
      ),
      files: { ...state.files },
      downloads: { ...state.downloads },
      visits: { page: state.visits.page, qr: state.visits.qr, portals: state.visits.portals },
      lastObservedAt: state.system.lastObservedAt,
    };
  }

  const esc = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

  function prometheus() {
    const snap = snapshot();
    const lines = [];
    const metric = (name, help, type, samples) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const s of samples) lines.push(`${name}${s.labels ? `{${s.labels}}` : ''} ${s.value}`);
    };
    metric('hapi_up', 'Add-on is answering metrics requests', 'gauge', [{ value: 1 }]);
    metric('hapi_restarts_total', 'Process starts over the lifetime of the data directory', 'counter', [
      { value: snap.restarts },
    ]);
    metric(
      'hapi_http_requests_total',
      'HTTP requests by listener and status class',
      'counter',
      Object.entries(snap.http.byListener).flatMap(([listener, value]) => {
        const classes = Object.entries(snap.http.byStatus).filter(([cls]) => cls !== 'other');
        if (!classes.length) return [{ labels: `listener="${esc(listener)}"`, value }];
        return [{ labels: `listener="${esc(listener)}"`, value }];
      }),
    );
    metric(
      'hapi_http_status_total',
      'HTTP responses by status class',
      'counter',
      Object.entries(snap.http.byStatus).map(([cls, value]) => ({ labels: `class="${esc(cls)}"`, value })),
    );
    metric('hapi_http_bytes_in_total', 'Request body bytes observed', 'counter', [{ value: snap.http.bytesIn }]);
    metric('hapi_http_bytes_out_total', 'Response body bytes observed', 'counter', [{ value: snap.http.bytesOut }]);
    metric(
      'hapi_http_request_duration_ms',
      'Request latency: average and quantiles',
      'gauge',
      [
        { labels: 'quantile="0.5"', value: snap.http.latencyMs.p50 },
        { labels: 'quantile="0.95"', value: snap.http.latencyMs.p95 },
        { labels: 'quantile="max"', value: snap.http.latencyMs.max },
      ],
    );
    metric(
      'hapi_route_requests_total',
      'Requests per route template',
      'counter',
      Object.entries(snap.routes).map(([route, value]) => ({ labels: `route="${esc(route)}"`, value: value.count })),
    );
    metric(
      'hapi_route_errors_total',
      'Responses with status >= 400 per route template',
      'counter',
      Object.entries(snap.routes)
        .filter(([, value]) => value.errors)
        .map(([route, value]) => ({ labels: `route="${esc(route)}"`, value: value.errors })),
    );
    metric('hapi_files_uploaded_total', 'Uploaded files', 'counter', [{ value: snap.files.uploaded }]);
    metric('hapi_files_uploaded_bytes_total', 'Uploaded bytes', 'counter', [{ value: snap.files.uploadBytes }]);
    metric('hapi_files_encrypted_total', 'Uploads stored encrypted', 'counter', [{ value: snap.files.encrypted }]);
    metric('hapi_files_deleted_total', 'Deleted files', 'counter', [{ value: snap.files.deleted }]);
    metric('hapi_files_mirror_failed_total', 'Mirror writes that failed verification', 'counter', [
      { value: snap.files.mirrorFailed },
    ]);
    metric('hapi_downloads_total', 'Downloads by result', 'counter', [
      { labels: 'result="ok"', value: snap.downloads.ok },
      { labels: 'result="denied"', value: snap.downloads.denied },
    ]);
    metric('hapi_download_bytes_total', 'Downloaded bytes', 'counter', [{ value: snap.downloads.bytes }]);
    metric('hapi_visits_total', 'Portal page visits and QR scans', 'counter', [
      { labels: 'kind="page"', value: snap.visits.page },
      { labels: 'kind="qr"', value: snap.visits.qr },
    ]);
    return `${lines.join('\n')}\n`;
  }

  async function flush() {
    writeAtomic();
    return true;
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    writeAtomic();
  }

  return { observe, fileUpload, fileDelete, mirrorFailed, download, visit, snapshot, prometheus, flush, close, normalizePath };
}

module.exports = { create, normalizePath, statusClass, FILE };
