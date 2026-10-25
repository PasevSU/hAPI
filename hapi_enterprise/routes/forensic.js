'use strict';
// Forensic и метаданни — компонент на HTTP слоя (план 18, панели 07 и 08).
//
//   GET /admin/api/portals/{portalId}/files/{fileId}/exif            → метаданни
//   GET /admin/api/portals/{portalId}/files/{fileId}/forensic        → анализ по съдържание
//   POST /admin/api/portals/{portalId}/files/{fileId}/exif/compare   → сравнение с друг файл
//
// Защо съществува: виж `forensic.js` и `exif.js`. Тук е само договорът.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { json, fail, parse, audit, adminGate, fsp, path, filesRoot, getPortals } = deps;
  const exif = require('../exif');
  const forensic = require('../forensic');

  const find = (portalId, fileId) => {
    const portal = (getPortals() || []).find((p) => p.id === portalId);
    if (!portal) return { error: 404, message: 'Portal not found' };
    const file = (portal.files || []).find((f) => f.id === fileId);
    if (!file) return { error: 404, message: 'File not found' };
    return { portal, file };
  };

  // Файлът се чете с таван: анализът не бива да изяде паметта на add-on-а.
  const MAX_READ = 8 * 1024 * 1024;
  const read = async (portal, file) => {
    if (Number(file.size) > MAX_READ) {
      const err = new Error('Файлът е по-голям от ' + Math.round(MAX_READ / 1048576) + ' MB — анализът не се прави, за да не се товари add-on-ът');
      err.status = 413;
      throw err;
    }
    return fsp.readFile(path.join(filesRoot, portal.id, String(file.id)));
  };

  async function handle({ req, res, url, parts, method }) {
    // Пътят е /admin/api/portals/{id}/files/{fileId}/<exif|forensic>. Сравненията са с
    // ЛИТЕРАЛИ (`=== 'exif'`, `=== 'forensic'`), за да ги вижда `tests/admin-api-spec.cjs`:
    // маршрут, който тестът не може да намери, остава извън договора.
    if (!(parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'portals')) return false;
    if (parts[4] !== 'files') return false;
    if (parts[6] !== 'exif' && parts[6] !== 'forensic') return false;
    // Ниво на четене: анализът НЕ променя нищо.
    if (!adminGate(req, res, 'storage', method)) return true;

    const found = find(parts[3], parts[5]);
    if (found.error) return fail(res, found.error, found.message), true;

    try {
      if (parts[6] === 'exif' && parts.length === 4 + 3 && method === 'GET') {
        const buffer = await read(found.portal, found.file);
        const includeGps = url.searchParams.get('gps') === '1';
        const data = exif.extract(buffer, { includeGps });
        void audit('exif.read', { portalId: found.portal.id, fileId: found.file.id, format: data.format, fields: Object.keys(data.fields).length, gps: includeGps });
        return json(res, 200, { fileId: found.file.id, name: found.file.name, ...data }), true;
      }
      if (parts[6] === 'forensic' && parts.length === 4 + 3 && method === 'GET') {
        const buffer = await read(found.portal, found.file);
        const data = forensic.analyze(buffer, { declaredName: found.file.name, includeGps: url.searchParams.get('gps') === '1' });
        // Одитът пази ФАКТИТЕ (код + ниво), не байтовете.
        void audit('forensic.analyze', { portalId: found.portal.id, fileId: found.file.id, type: data.type ? data.type.ext : 'unknown', severity: data.severity, findings: data.findings.map((f) => f.code) });
        return json(res, 200, { fileId: found.file.id, name: found.file.name, ...data }), true;
      }
      // Сравнение: същият портал, друг файл по id в тялото.
      if (parts[6] === 'exif' && parts[7] === 'compare' && method === 'POST') {
        const body = await parse(req);
        const otherId = String((body && body.fileId) || '').trim();
        if (!otherId) return fail(res, 400, 'fileId is required'), true;
        const other = find(found.portal.id, otherId);
        if (other.error) return fail(res, other.error, other.message), true;
        const [left, right] = await Promise.all([read(found.portal, found.file), read(other.portal, other.file)]);
        const data = exif.compare(left, right, { includeGps: url.searchParams.get('gps') === '1' });
        void audit('exif.compare', { portalId: found.portal.id, a: found.file.id, b: other.file.id, different: data.different.length });
        return json(res, 200, { a: found.file.id, b: other.file.id, ...data }), true;
      }
    } catch (e) {
      return fail(res, e.status || 500, e.message || 'Analysis failed'), true;
    }
    return fail(res, 405, 'Method not allowed'), true;
  }

  return { handle };
}

module.exports = { create };
