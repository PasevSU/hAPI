'use strict';
// Report Studio + RFC 3161 — компонент на HTTP слоя.
//
// Извадено от `server.js` 1:1 (0.69.39): това е един завършен дял от API-то — рендер на
// отчет, пакет с доказателства, detached CMS подпис и проверката му, времеви печати.
// Сървърът остава само с рутирането и с това, което е общо за всички маршрути.
//
// Зависимостите идват отвън (`create`), за да няма скрит достъп до състоянието на
// сървъра: компонентът не знае за базата, за порталите и за файловете.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const {
    root,
    json,
    fail,
    body,
    parse,
    audit,
    log,
    cryptoOptions,
    runtime,
    reportSystemInfo,
    persistTsaRecords,
    adminGate,
    tsaKeep,
    pruneTsaRecords,
  } = deps;
  const crypto = require('node:crypto');
  const fsp = require('node:fs/promises');
  const path = require('node:path');

  async function handle({ req, res, url, parts, method }) {
    if (!(parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'v2')) return false;
    // `cms` е част от СЪЩИЯ дял: проверката на detached подписа върви по същите байтове,
    // с които отчетът е подписан. Изпусне ли се тук, маршрутът остава недостъпен — точно
    // това се случи при първото изнасяне (тестът `cms-panel` го хвана).
    if (!['reports', 'cms', 'rfc3161'].includes(parts[3])) return false;
    await route(req, res, url, parts, method);
    // Същото поведение като преди: непознат път под този дял стигаше до общото 404.
    if (!res.writableEnded) fail(res, 404, 'Not found');
    return true;
  }

  // Тялото е преместено без промени: `return` вътре приключва само този маршрут.
  async function route(req, res, url, parts, method) {
    // Report Studio (Фаза 11 / RS-03): манифест → PDF. Без фалшиви TSA токени:
    // манифест, съдържащ tsaToken/подпис/сертификат, се отхвърля от валидатора.
    if (parts[3] === 'reports' && parts[4] === 'render' && parts.length === 5 && method === 'POST') {
      let payload; try { payload = JSON.parse((await body(req, 1024 * 1024)).toString('utf8')) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
      try {
        const manifest = (payload && payload.manifest) || payload;
        const reportRender = require('../report-render');
        // RS-05: TSA обхватът е ИЗРИЧЕН (`tsa: true`) и изисква tsa_enabled. Отчетът
        // никога не звъни на TSA „ей така“ и без токен не си измисля такъв (ADR-0025, т. 5).
        const wantTsa = Boolean(payload && payload.tsa === true);
        let stamps = null;
        if (wantTsa) {
          if (!cryptoOptions.tsaEnabled) return fail(res, 409, 'RFC 3161 timestamps are disabled (tsa_enabled)');
          const reportStamp = require('../report-stamp');
          stamps = await reportStamp.stampReport(manifest, { startUrl: cryptoOptions.tsaStart, stopUrl: cryptoOptions.tsaStop || cryptoOptions.tsaStart });
          // Токените стават .tsr артефакти до останалите доказателства, за да ги покрие
          // GET/POST /rfc3161/verify — иначе отчетът щеше да твърди нещо непроверимо.
          if (stamps.ok) {
            await persistTsaRecords([stamps.start, { ...stamps.stop, closingDigest: stamps.closingDigest }]).catch((e) => log.warn('report.tsa.persist.failed', { ns: 'tsa', err: e.message }));
          }
          void audit('report.tsa.' + (stamps.ok ? 'ok' : 'fail'), { profile: (manifest && manifest.profile) || '', start: stamps.start && stamps.start.token ? stamps.start.token.sha256 : null, stop: stamps.stop && stamps.stop.token ? stamps.stop.token.sha256 : null, evidenceDigest: stamps.evidenceDigest, closingDigest: stamps.closingDigest, error: stamps.error });
        }
        // Възпроизводимост: ако клиентът подаде „дата на издаване“ (или манифестът я
        // носи), рендирането е детерминирано — същите входни данни дават същия PDF и
        // същия отпечатък. Затова стойността се уважава И се връща в заглавка.
        const issuedAt = (payload && (payload.createdAt || payload.issuedAt)) || null;
        const system = reportSystemInfo({
          issuedAt,
          tsa: wantTsa ? (stamps && stamps.ok ? 'издаден' : 'неуспешен') : cryptoOptions.tsaEnabled ? 'включен, не е поискан' : 'изключен',
        });
        const pdf = reportRender.renderPdf(manifest, { data: (payload && payload.data) || {}, hashes: (payload && payload.hashes) || {}, watermark: payload && payload.watermark, stamps, createdAt: issuedAt, system });
        const digest = require('../report-manifest').digest(manifest) || '';
        // RS-06: отпечатък на ГОТОВИЯ PDF. Не може да стои вътре в себе си, затова се връща
        // като хедър и влиза в одита — така „този файл е този отчет“ се проверява с sha256sum.
        const pdfSha256 = crypto.createHash('sha256').update(pdf).digest('hex');
        const safeName = String((manifest && manifest.profile) || 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 48);
        void audit('report.render', { profile: (manifest && manifest.profile) || '', digest, pdfSha256, tsa: wantTsa ? (stamps && stamps.ok ? 'ok' : 'fail') : 'not requested' });
        const issuedHeader = issuedAt || new Date().toISOString().slice(0, 19) + 'Z';
        const headers = { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Manifest-SHA256': digest, 'X-PDF-SHA256': pdfSha256, 'X-PDF-ISSUED-AT': issuedHeader, 'Content-Disposition': 'attachment; filename="report-' + safeName + '.pdf"' };
        if (wantTsa) {
          headers['X-TSA-Status'] = stamps && stamps.ok ? 'granted' : 'failed';
          if (stamps && stamps.evidenceDigest) headers['X-TSA-Evidence-SHA256'] = stamps.evidenceDigest;
          if (stamps && stamps.closingDigest) headers['X-TSA-Closing-SHA256'] = stamps.closingDigest;
        }
        res.writeHead(201, headers);
        return res.end(pdf);
      } catch (e) { return fail(res, e.status || 500, (e.code ? e.code + ': ' : '') + (e.message || 'Report render failed')) }
    }
    // W7: Пакет с доказателства от манифеста. Статусът не се закръгля нагоре:
    // READY само когато START и STOP токените са налични (и подписът, ако е поискан),
    // DRAFT за чернова, INCOMPLETE за диагностичен пакет с изброени липси.
    if (parts[3] === 'reports' && parts[4] === 'package' && parts.length === 5 && method === 'POST') {
      let payload; try { payload = JSON.parse((await body(req, 8 * 1024 * 1024)).toString('utf8')) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
      try {
        const manifest = (payload && payload.manifest) || payload;
        const draft = Boolean(payload && payload.draft === true);
        const wantTsa = Boolean(payload && payload.tsa === true) && !draft;
        const issuedAt = (payload && (payload.createdAt || payload.issuedAt)) || null;
        let stamps = null;
        if (wantTsa) {
          if (!cryptoOptions.tsaEnabled) return fail(res, 409, 'RFC 3161 timestamps are disabled (tsa_enabled) — пакетът не може да твърди завършеност');
          const reportStamp = require('../report-stamp');
          stamps = await reportStamp.stampReport(manifest, { startUrl: cryptoOptions.tsaStart, stopUrl: cryptoOptions.tsaStop || cryptoOptions.tsaStart });
          if (stamps.ok) await persistTsaRecords([stamps.start, { ...stamps.stop, closingDigest: stamps.closingDigest }]).catch((e) => log.warn('report.tsa.persist.failed', { ns: 'tsa', err: e.message }));
          void audit('report.tsa.' + (stamps.ok ? 'ok' : 'fail'), { profile: (manifest && manifest.profile) || '', phase: 'package', start: stamps.start && stamps.start.token ? stamps.start.token.sha256 : null, stop: stamps.stop && stamps.stop.token ? stamps.stop.token.sha256 : null, evidenceDigest: stamps.evidenceDigest, closingDigest: stamps.closingDigest, error: stamps.error });
        }
        // PDF: клиентът може да подаде ГОТОВИЯ файл (за да не се разминава с това, което
        // вече е подписано); иначе се рендира детерминирано от същия манифест.
        let pdf;
        if (payload && typeof payload.pdfBase64 === 'string' && payload.pdfBase64) {
          pdf = Buffer.from(payload.pdfBase64, 'base64');
          if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return fail(res, 400, 'pdfBase64 is not a PDF (missing %PDF- header)');
        } else {
          const readyBefore = Boolean(stamps && stamps.ok && stamps.start && stamps.start.token && stamps.stop && stamps.stop.token);
          const statusWord = draft ? 'DRAFT' : readyBefore ? null : 'INCOMPLETE';
          const watermark = payload && payload.watermark !== undefined ? payload.watermark : statusWord === null ? undefined : statusWord;
          const system = reportSystemInfo({ issuedAt, tsa: wantTsa ? (stamps && stamps.ok ? 'издаден' : 'неуспешен') : cryptoOptions.tsaEnabled ? 'включен, не е поискан' : 'изключен' });
          pdf = require('../report-render').renderPdf(manifest, { data: (payload && payload.data) || {}, hashes: (payload && payload.hashes) || {}, watermark, stamps, createdAt: issuedAt, system });
        }
        // Подпис: иска се изрично и изисква ключ в заявката, както при `/reports/sign`.
        let cms = null;
        if (payload && payload.cms && typeof payload.cms === 'object' && (payload.cms.certPem || payload.cms.keyPem)) {
          try {
            const signed = require('../cms-sign').signDetached({ data: pdf, certDer: new crypto.X509Certificate(String(payload.cms.certPem)).raw, keyPem: payload.cms.keyPem });
            cms = { requested: true, p7s: signed.cms };
            void audit('report.sign', { pdfSha256: signed.digest, profile: (manifest && manifest.profile) || '' });
          } catch (e) {
            // Ключът е сгрешен — пакетът излиза, но като INCOMPLETE с изрична липса.
            cms = { requested: true, p7s: null };
            log.warn('report.package.cms.failed', { ns: 'report', err: e.message });
          }
        }
        const pkg = require('../report-package').build({ manifest, pdf, stamps, cms, draft, createdAt: issuedAt || new Date().toISOString() });
        void audit('report.package', { profile: (manifest && manifest.profile) || '', status: pkg.evidence.status, missing: pkg.evidence.missing.length, digest: pkg.evidence.manifestSha256, pdfSha256: pkg.evidence.pdfSha256, tsa: wantTsa ? (stamps && stamps.ok ? 'ok' : 'fail') : 'not requested' });
        res.writeHead(201, {
          'Content-Type': 'application/zip',
          'Content-Length': pkg.zip.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'X-Evidence-Status': pkg.evidence.status,
          // HTTP заглавките са Latin-1: кирилицата тук убива връзката (ERR_INVALID_CHAR).
          // Затова липсите пътуват URL-кодирани, а пълният им текст е в evidence.json.
          'X-Evidence-Missing': encodeURIComponent(pkg.evidence.missing.join('|')),
          'X-Manifest-SHA256': pkg.evidence.manifestSha256,
          'X-PDF-SHA256': pkg.evidence.pdfSha256,
          'Content-Disposition': 'attachment; filename="' + pkg.name + '"',
        });
        return res.end(pkg.zip);
      } catch (e) { return fail(res, e.status || 500, (e.code ? e.code + ': ' : '') + (e.message || 'Report package failed')) }
    }
    // Detached CMS/PKCS#7 подпис на готов PDF (RS-06). Ключът идва В ЗАЯВКАТА и не се
    // пази: без тях отговорът е 400, а не „подпис по подразбиране“. Така никой не може
    // да подпише нещо, без да даде ключ, и няма фалшив сертификат в изданието.
    if (parts[3] === 'reports' && parts[4] === 'sign' && parts.length === 5 && method === 'POST') {
      let b; try { b = JSON.parse((await body(req, 8 * 1024 * 1024)).toString('utf8')) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
      const pdfBytes = typeof b.pdfBase64 === 'string' ? Buffer.from(b.pdfBase64, 'base64') : null;
      if (!pdfBytes || !pdfBytes.length) return fail(res, 400, 'pdfBase64 is required');
      if (pdfBytes.subarray(0, 5).toString('latin1') !== '%PDF-') return fail(res, 400, 'pdfBase64 is not a PDF (missing %PDF- header)');
      const certDer = typeof b.certPem === 'string' ? new crypto.X509Certificate(String(b.certPem)).raw : null;
      try {
        const signed = require('../cms-sign').signDetached({ data: pdfBytes, certDer, keyPem: b.keyPem });
        void audit('report.sign', { pdfSha256: signed.digest, subject: certDer ? new crypto.X509Certificate(certDer).subject.replace(/\n/g, ', ') : '' });
        return json(res, 200, {
          pdfSha256: signed.digest,
          cmsBase64: signed.cms.toString('base64'),
          cmsBytes: signed.cms.length,
          detached: true,
          // Честно: подписът доказва цялост и произход на ключа. Доверието в сертификата
          // зависи от това кой го е издал — това не е „удостоверен документ“.
          note: 'Detached CMS (PKCS#7, SHA-256/RSA). Доверието зависи от издателя на сертификата.',
        });
      } catch (e) { return fail(res, e.status || 400, e.message || 'Signing failed') }
    }
    // Проверка на detached CMS подпис срещу данни — със същия код, който го прави.
    if (parts[3] === 'cms' && parts[4] === 'verify' && parts.length === 5 && method === 'POST') {
      let b; try { b = JSON.parse((await body(req, 8 * 1024 * 1024)).toString('utf8')) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
      const data = typeof b.dataBase64 === 'string' ? Buffer.from(b.dataBase64, 'base64') : null;
      const cmsBytes = typeof b.cmsBase64 === 'string' ? Buffer.from(b.cmsBase64, 'base64') : null;
      if (!data || !cmsBytes) return fail(res, 400, 'dataBase64 and cmsBase64 are required');
      const verdict = require('../cms-sign').verifyDetached({ data, cms: cmsBytes });
      return json(res, verdict.ok ? 200 : 409, verdict);
    }
    // RFC 3161 TSA (порт от HASH_REPORT блок „START / STOP“): START подпечатва
    // манифеста, STOP — затварящия хеш (START digest + START токен). Токените се
    // пазят като .tsr артефакти; при отказ на TSA няма запис и няма фалшив токен.
    if (parts[3] === 'rfc3161' && parts.length === 4) {
      if (!adminGate(req, res, 'settings', method)) return;
      const tsaClient = require('../tsa-client');
      const tsaDir = path.join(root, 'tsa');
      const tsaDefaults = { start: cryptoOptions.tsaStart, stop: cryptoOptions.tsaStop };
      const readRecords = async () => {
        let names = []; try { names = (await fsp.readdir(tsaDir)).filter(n => n.endsWith('.json')).sort() } catch (e) { if (e.code !== 'ENOENT') throw e }
        const out = [];
        for (const name of names.slice(-40)) {
          try { out.push(JSON.parse(await fsp.readFile(path.join(tsaDir, name), 'utf8'))) } catch { /* повреден TSA запис се прескача, останалите се показват */ }
        }
        return out.sort((a, b) => String(b.at).localeCompare(String(a.at)))
      };
      try {
        if (method === 'GET') { const records = await readRecords(); return json(res, 200, { enabled: cryptoOptions.tsaEnabled, tsa: tsaDefaults, records, breaker: typeof tsaClient.breakerSnapshot === 'function' ? tsaClient.breakerSnapshot() : [] }) }
        if (method !== 'POST') return fail(res, 405, 'Method not allowed');
        if (!cryptoOptions.tsaEnabled) return fail(res, 409, 'RFC 3161 timestamps are disabled (tsa_enabled)');
        let payload; try { payload = await parse(req) } catch (e) { return fail(res, e.status || 400, e.status ? e.message : 'Invalid JSON') }
        const phase = String((payload && payload.phase) || '').toLowerCase();
        if (!['start', 'stop'].includes(phase)) return fail(res, 400, 'phase must be "start" or "stop"');
        let algorithm, urls;
        try { algorithm = tsaClient.normalizeAlgorithm((payload && payload.algorithm) || 'SHA256'); urls = String((payload && payload.url) || tsaDefaults[phase]).split(',').map(s => s.trim()).filter(Boolean).map(u => tsaClient.normalizeUrl(u)) }
        catch (e) { return fail(res, 400, e.message) }
        if (!urls.length) return fail(res, 400, 'No TSA URL configured');
        let digest = String((payload && payload.digest) || '').trim().toLowerCase();
        if (payload && payload.manifest && !digest) digest = require('../report-manifest').digest(payload.manifest) || '';
        let closesDigest = null;
        if (!digest && phase === 'stop') {
          const start = (await readRecords()).find(r => r.phase === 'start' && r.token && r.token.sha256);
          if (!start) return fail(res, 409, 'No START timestamp to close');
          closesDigest = { startDigest: start.digest, startTokenSha256: start.token.sha256 };
          digest = crypto.createHash('sha256').update(start.digest + '|' + start.token.sha256).digest('hex');
        }
        if (!digest) return fail(res, 400, 'digest (or manifest) is required for START');
        try { digest = tsaClient.normalizeDigest(digest, algorithm) } catch (e) { return fail(res, 400, e.message) }
        const result = await tsaClient.stamp({ url: urls, digestHex: digest, algorithm });
        if (!result.granted || !result.token) {
          log.warn('rfc3161.rejected', { ns: 'tsa', phase, url: result.url, status: result.status, statusText: result.statusText, failInfo: result.failInfo });
          return fail(res, 502, 'TSA refused the timestamp: ' + result.statusText + (result.failInfo ? ' (' + result.failInfo + ')' : ''));
        }
        await fsp.mkdir(tsaDir, { recursive: true });
        const at = new Date().toISOString(), stamp = at.replace(/[:.]/g, '-'), base = phase + '-' + stamp + '-' + digest.slice(0, 12);
        const file = base + '.tsr';
        await fsp.writeFile(path.join(tsaDir, file), result.tokenDer, { flag: 'wx', mode: 0o600 });
        const record = { phase, at, url: result.url, attempts: result.attempts, algorithm, digest, file, requestBytes: result.requestBytes, replyBytes: result.replyBytes, status: result.status, statusText: result.statusText, token: result.token, closesDigest };
        if (closesDigest) record.token.imprintMatches = result.token.imprintMatches;
        await fsp.writeFile(path.join(tsaDir, base + '.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        // Пазим последните TSA_KEEP записа (по подразбиране 200): доказателствата не бива
        // да растат безкрайно и да изпълнят диска. Старите .tsr/.json се трият по двойки.
        await pruneTsaRecords().catch(e => log.warn('tsa.prune.failed', { ns: 'tsa', err: e.message }));
        void audit('rfc3161.' + phase, { phase, url: result.url, digest, tokenSha256: result.token.sha256, genTime: result.token.genTime });
        log.info('rfc3161.created', { ns: 'tsa', phase, url: result.url, attempts: result.attempts, digest, tokenSha256: result.token.sha256, genTime: result.token.genTime, bytes: result.token.bytes });
        return json(res, 201, record);
      } catch (e) { log.warn('rfc3161.failed', { ns: 'tsa', err: e.message }); return fail(res, e.status || 502, e.message || 'TSA request failed') }
    }
    // Проверка на съхранените доказателства: преизчислява SHA-256 на всеки .tsr и го
    // сравнява с отпечатъка от записа. Така „имам токен“ е проверен факт, а подправен
    // или изчезнал файл се вижда веднага (409), вместо да мине за валиден.
    if (parts[3] === 'rfc3161' && parts.length === 5 && parts[4] === 'verify') {
      if (!adminGate(req, res, 'settings', method)) return;
      if (!['GET', 'POST'].includes(method)) return fail(res, 405, 'Method not allowed');
      const dir = path.join(root, 'tsa');
      let names = [];
      try { names = (await fsp.readdir(dir)).filter(n => n.endsWith('.json')).sort() } catch (e) { if (e.code !== 'ENOENT') throw e }
      const files = [];
      for (const name of names.slice(-tsaKeep())) {
        let record = null;
        try { record = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8')) } catch { continue }
        const expected = record && record.token && record.token.sha256 ? String(record.token.sha256) : null;
        const item = { file: record.file || '', phase: record.phase || '', digest: record.digest || '', expected, actual: null, bytes: 0, status: 'missing' };
        if (record.file) {
          try {
            const buf = await fsp.readFile(path.join(dir, record.file));
            item.actual = crypto.createHash('sha256').update(buf).digest('hex');
            item.bytes = buf.length;
            item.status = expected && item.actual === expected ? 'valid' : 'tampered';
          } catch (e) { item.status = e.code === 'ENOENT' ? 'missing' : 'unreadable'; item.error = e.code || e.message }
        }
        files.push(item);
      }
      const invalid = files.filter(f => f.status !== 'valid');
      return json(res, invalid.length ? 409 : 200, { dir, keep: tsaKeep(), checked: files.length, valid: files.length - invalid.length, invalid: invalid.length, files });
    }
  }

  return { handle };
}

module.exports = { create };
