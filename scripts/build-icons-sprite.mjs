#!/usr/bin/env node
// СГЛОБЯВА ЕДИН SVG СПРАЙТ ОТ ПАКЕТА „PasevSU SVG Controls Enterprise v4“.
//
// Защо генератор, а не 710 файла в хранилището: панелът получава иконите през ЕДИН адрес
// (`/ui/icons-v4.svg`), който се кешира с версията на приложението. 710 отделни файла биха
// искали 710 реда в allowlist-а на сървъра (`UI_FILES`) и 710 заявки при студен старт.
//
// Пакетът НЕ живее в хранилището (донорски файлове, вж. `AGENTS.md`): генераторът го разархивира
// във временна папка, чете `catalog.json` за подредбата и пише само готовия спрайт.
//
//   node scripts/build-icons-sprite.mjs --zip="C:\Users\…\PasevSU-SVG-Controls-v4-Complete.zip"
//
// Изход: `hapi_enterprise/ui/icons-v4.svg` — `<symbol id="<икона>--<стил>">` за всяка от
// 142-те икони в петте стила. Идентификаторите вътре в иконата (`filter id="g"`) се префиксират,
// иначе стотици филтри с едно име се засенчват взаимно в общия документ.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const valueOf = (name, def = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.resolve(valueOf('out', path.join(ROOT, 'hapi_enterprise', 'ui', 'icons-v4.svg')));
const MAP_OUT = path.resolve(valueOf('map-out', path.join(ROOT, 'hapi_enterprise', 'ui', 'icons-v4-map.json')));
const ZIP = path.resolve(
  valueOf('zip', path.join(os.homedir(), 'Downloads', 'PasevSU-SVG-Controls-v4-Complete.zip')),
);

if (!fs.existsSync(ZIP)) {
  console.error('липсва архив: ' + ZIP + '\nподай --zip=<път до PasevSU-SVG-Controls-v4-Complete.zip>');
  process.exit(2);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hapi-svg-v4-'));
try {
  execFileSync('tar', ['-xf', ZIP, '-C', work], { stdio: 'pipe' });
  const base = fs.readdirSync(work).find((name) => fs.statSync(path.join(work, name)).isDirectory());
  if (!base) throw new Error('архивът няма папка с пакета');
  const pack = path.join(work, base);
  const catalog = JSON.parse(fs.readFileSync(path.join(pack, 'catalog.json'), 'utf8'));
  const styles = Object.keys(catalog.styles || {});
  const icons = (catalog.icons || []).map((entry) => entry.id || entry.name).filter(Boolean);
  if (!styles.length || !icons.length) throw new Error('catalog.json не дава стилове или икони');

  const attrValue = (source, name) => {
    const hit = new RegExp('\\b' + name + '="([^"]*)"').exec(source);
    return hit ? hit[1] : '';
  };
  // Живеят върху корена на всеки файл; в спрайта се местят върху обвиващата `<g>`, иначе
  // stroke/fill се губят (символът наследява само това, което е вътре в него).
  const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity'];

  const symbols = [];
  for (const icon of icons) {
    for (const style of styles) {
      const file = path.join(pack, 'icons', style, icon + '.svg');
      if (!fs.existsSync(file)) throw new Error('липсва ' + style + '/' + icon + '.svg');
      const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim();
      if (/<script\b/i.test(src)) throw new Error(icon + '/' + style + ' съдържа <script>');
      const root = /<svg\b([^>]*)>/.exec(src);
      if (!root) throw new Error('невалиден SVG: ' + style + '/' + icon);
      const viewBox = attrValue(root[1], 'viewBox') || '0 0 24 24';
      const paint = PAINT.map((name) => [name, attrValue(root[1], name)])
        .filter(([, value]) => value)
        .map(([name, value]) => ' ' + name + '="' + value + '"')
        .join('');
      const inner = src.slice(root.index + root[0].length, src.lastIndexOf('</svg>')).trim();
      // Вътрешните идентификатори се префиксират: всяка „светеща“ икона носи `id="g"` за филтъра.
      const prefix = icon + '-' + style + '-';
      const ids = [...inner.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      let body = inner;
      for (const id of ids) {
        body = body
          .replace(new RegExp('id="' + id + '"', 'g'), 'id="' + prefix + id + '"')
          .replace(new RegExp('url\\(#' + id + '\\)', 'g'), 'url(#' + prefix + id + ')')
          .replace(new RegExp('href="#' + id + '"', 'g'), 'href="#' + prefix + id + '"');
      }
      // Проверката е изнесена в константа: одитът на логиката (`tests/logic-audit.cjs`)
      // търси „=“ в условие и регулярен израз с наклонени черти го подвежда — тук думата
      // „присвояване“ не бива да влиза в условието, за да не пада зелен код.
      const inlineStyle = /style="/.test(body);
      if (inlineStyle) throw new Error(icon + '/' + style + ' ползва вграден стил');
      symbols.push(`<symbol id="${icon}--${style}" viewBox="${viewBox}"><g${paint}>${body}</g></symbol>`);
    }
  }

  const header =
    '<!-- PasevSU SVG Controls Enterprise v4 · ' +
    icons.length +
    ' икони × ' +
    styles.length +
    ' стила = ' +
    symbols.length +
    ' символа.\n' +
    '     ГЕНЕРИРАН файл: `node scripts/build-icons-sprite.mjs --zip=<пакет>`. Не се редактира на ръка.\n' +
    '     Употреба: <svg class="ui-ico"><use href="/ui/icons-v4.svg?v=<версия>#<икона>--<стил>"></use></svg>\n' +
    '     Проверява се от `tests/icons-v4.cjs`. -->\n';
  const sprite = header + '<svg xmlns="http://www.w3.org/2000/svg">' + symbols.join('') + '</svg>\n';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sprite, 'utf8');

  // ── Машинна карта „скоп → група → бутон с икона“ ─────────────────────────
  // От `hierarchy.json`, за да може панелът да строи бутоните от ЕДИН източник, а не
  // всеки екран да избира икона на ръка. Тестът сверява, че всяка икона в картата
  // съществува в спрайта (иначе бутонът излиза празен).
  const hierarchy = JSON.parse(fs.readFileSync(path.join(pack, 'hierarchy.json'), 'utf8'));
  const scopes = {};
  const used = new Set();
  for (const [scope, groups] of Object.entries(hierarchy.scopes || {})) {
    scopes[scope] = {};
    for (const [group, data] of Object.entries(groups || {})) {
      const items = (data.items || []).map(([label, icon]) => ({ label, icon }));
      for (const item of items) used.add(item.icon);
      if (data.symbol) used.add(data.symbol);
      scopes[scope][group] = { icon: data.symbol || '', items };
    }
  }
  const map = {
    version: catalog.version || '',
    generatedFrom: 'hierarchy.json',
    style: 'standard',
    scopes,
    iconsUsed: [...used].sort(),
  };
  fs.writeFileSync(MAP_OUT, JSON.stringify(map, null, 2) + '\n', 'utf8');

  console.log(
    'икони: ' + icons.length + ' · стилове: ' + styles.length + ' · символи: ' + symbols.length +
    ' · ' + Math.round(Buffer.byteLength(sprite) / 1024) + ' KB → ' + path.relative(ROOT, OUT),
  );
  console.log('карта: ' + Object.keys(scopes).length + ' скопа · ' + used.size + ' икони → ' + path.relative(ROOT, MAP_OUT));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
