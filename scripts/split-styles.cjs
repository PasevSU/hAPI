'use strict';
// РАЗДЕЛЯ `ui/styles.css` на ЧЕТИРИТЕ файла от дизайн системата (план 18 §7): tokens, layout,
// components, themes.
//
// Защо скрипт, а не ръчно местене: ръчното местене на ~3000 реда е точно операцията, при която
// едно правило изчезва и никой не разбира (DOM тестовете проверяват поведение, не оформление).
// Затова разделянето е МЕХАНИЧНО и скриптът САМ доказва, че нищо не е загубено:
//   • реже по МАРКЕРИ в текста (не по номера на редове — те се местят);
//   • сглобява парчетата обратно и изисква БАЙТОВО равенство с оригинала;
//   • единствената ПРОМЯНА е, че блокът `body.light` (темата) отива в отделен файл, който се
//     зарежда ПОСЛЕДЕН — и скриптът пак изисква байтово равенство на самия блок.
// След успех оригиналът се изтрива, за да няма две истини за стиловете.
//
// Употреба: node scripts/split-styles.cjs [--check]
//   --check  не пише нищо, само казва дали разделянето е възможно и какви ще са частите
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const uiDir = path.join(root, 'hapi_enterprise', 'ui');
const source = path.join(uiDir, 'styles.css');
const PARTS = ['tokens.css', 'layout.css', 'components.css', 'themes.css'];

const check = process.argv.includes('--check');
if (!fs.existsSync(source)) {
  // Втори пуск: оригиналът вече е разделен. Това не е грешка — казва се и се излиза.
  const present = PARTS.filter((name) => fs.existsSync(path.join(uiDir, name)));
  console.log('няма styles.css за разделяне; налични части: ' + (present.join(', ') || '(никакви)'));
  process.exit(present.length === PARTS.length ? 0 : 1);
}

const css = fs.readFileSync(source, 'utf8');

// Маркерите са текстове, които съществуват в оригинала. Липсва ли някой — спираме, вместо да
// режем „по средата“ и да получим тихо счупен CSS.
const at = (needle) => {
  const i = css.indexOf(needle);
  if (i < 0) throw new Error('липсва маркер в styles.css: ' + JSON.stringify(needle));
  return i;
};
const iTheme = at('body.light {');
const iBase = at('\nhtml,');
const iComponents = at('/* ---------- Generic ---------- */');

const tokens = css.slice(0, iTheme);
const themes = css.slice(iTheme, iBase);
const layout = css.slice(iBase, iComponents);
const components = css.slice(iComponents);

// ДОКАЗАТЕЛСТВОТО: същото съдържание, в същия ред, байт по байт.
if (tokens + themes + layout + components !== css) {
  throw new Error('разделянето не е байтово равно на оригинала — спирам, преди да съм написал нещо');
}

const header = (title, note) =>
  '/* ' + title + '\n' +
  '   ' + note + '\n' +
  '   Част от дизайн системата (план 18 §7). Редът на зареждане е в `index.html`:\n' +
  '   tokens → layout → components → themes. Пази го `tests/ui-css-split.cjs`. */\n\n';

const files = {
  'tokens.css': header('Design tokens', 'Цветове, размери, шрифтове — само CSS custom properties.') + tokens,
  'layout.css': header('Layout', 'Основа на страницата, топбар и обвивка (shell).') + layout,
  'components.css': header('Components', 'Компоненти: панели, бутони, форми, таблици, Report Studio, съобщения.') + components,
  // Темата се зарежда последна НАРОЧНО: `body.light` предефинира токени и трябва да може да
  // надделее над основния слой. Съдържанието ѝ е преместено БЕЗ промяна (виж проверката горе).
  'themes.css': header('Themes', 'Тема (светла/тъмна) — предефинира токените, затова се зарежда последна.') + themes,
};

const total = Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);
console.log('части:');
for (const name of PARTS) {
  console.log('  ' + name.padEnd(16) + String(Buffer.byteLength(files[name], 'utf8')).padStart(7) + ' байта  (' + files[name].split('\n').length + ' реда)');
}
console.log('  оригиналът: ' + Buffer.byteLength(css, 'utf8') + ' байта · сглобката на частите (без добавените заглавия) е байтово равна: да');

if (check) {
  console.log('--check: нищо не е записано');
  process.exit(0);
}

for (const name of PARTS) fs.writeFileSync(path.join(uiDir, name), files[name], 'utf8');
fs.rmSync(source);
console.log('записани: ' + PARTS.join(', ') + ' · styles.css е изтрит (една истина за стиловете)');
console.log('следва: index.html да зареди четирите файла в този ред и `server.js` да ги пусне през /ui/');
void total;
