'use strict';
// Document Generator — компонент на HTTP слоя.
//
// Извадено от `server.js` 1:1 (0.69.39): четирите маршрута за шаблоните. Самият
// генератор живее в `generator.js`; тук е само HTTP-частта — кой път с каква
// capability се отваря и какво се одитира.
//
// Договор: `handle()` връща `true`, когато заявката е за този компонент (и е приключена),
// и `false`, когато трябва да я поеме следващият компонент.
function create(deps) {
  const { generator, adminGate, audit, json, fail, parse } = deps;

  async function handle({ req, res, parts, method }) {
    if (!(parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'generator')) return false;
    await route(req, res, parts, method);
    if (!res.writableEnded) fail(res, 404, 'Not found');
    return true;
  }

  async function route(req, res, parts, method) {
    // PasevSU Document Generator: шаблоните се четат от диска при ВСЯКА заявка, така че
    // добавяне или изтриване на *.html в `generator/temp` се вижда веднага — без
    // `tools/build-index.mjs` и без рестарт. Сървърът НЕ изпълнява шаблоните: те се
    // сервират като `text/plain` и генераторът ги почиства в браузъра.
    if (parts[0] === 'admin' && parts[1] === 'api' && parts[2] === 'generator') {
      if (parts[3] !== 'templates') return fail(res, 404, 'Not found');
      const templateName = parts.length === 5 ? (() => { try { return decodeURIComponent(parts[4]) } catch { return null } })() : null;
      if (method === 'GET' && parts.length === 4) {
        if (!adminGate(req, res, 'generator', 'GET')) return;
        return json(res, 200, generator.index());
      }
      if (method === 'GET' && parts.length === 5) {
        if (!adminGate(req, res, 'generator', 'GET')) return;
        if (!templateName) return fail(res, 400, 'Invalid template name');
        let template; try { template = generator.read(templateName) } catch (e) { return fail(res, e.status || 400, e.message) }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
        return res.end(template.html);
      }
      if (method === 'POST' && parts.length === 4) {
        if (!adminGate(req, res, 'generator', 'POST')) return;
        let body; try { body = await parse(req) } catch (e) { return fail(res, e.status || 400, e.message) }
        try {
          const out = generator.save(body && body.name, body && body.html, { overwrite: Boolean(body && body.overwrite) });
          void audit('generator.template.save', { file: out.file, bytes: out.bytes, templates: out.templates.length });
          return json(res, 200, out);
        } catch (e) { return fail(res, e.status || 400, e.message) }
      }
      if (method === 'DELETE' && parts.length === 5) {
        if (!adminGate(req, res, 'generator', 'DELETE')) return;
        if (!templateName) return fail(res, 400, 'Invalid template name');
        try {
          const out = generator.remove(templateName);
          void audit('generator.template.delete', { file: out.file, templates: out.templates.length });
          return json(res, 200, out);
        } catch (e) { return fail(res, e.status || 400, e.message) }
      }
      return fail(res, 405, 'Method not allowed');
    }
  }

  return { handle };
}

module.exports = { create };
