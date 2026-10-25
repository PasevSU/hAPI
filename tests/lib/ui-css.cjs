'use strict';
// Дизайн системата е разделена на четири файла (план 18 §7). Тестовете, които проверяват
// ПРАВИЛА в стиловете (`.quick-grid`, `.set-tabs`, икони), не бива да знаят в кой файл живее
// правилото — иначе всяко местене чупи тест, който проверява нещо друго. Затова четат през
// този помощник: съдържанието на четирите файла в РЕДА НА ЗАРЕЖДАНЕ, както го вижда браузърът.
const fs = require('node:fs');
const path = require('node:path');

const uiDir = path.join(__dirname, '..', '..', 'hapi_enterprise', 'ui');
// Редът е нормативен: токени → оформление → компоненти → тема. Пази го `ui-css-split`.
const FILES = ['tokens.css', 'layout.css', 'components.css', 'themes.css'];

const text = () => FILES.map((name) => fs.readFileSync(path.join(uiDir, name), 'utf8')).join('\n');

/** Само един файл — за тестове, които наистина проверяват конкретен слой. */
const of = (name) => {
  if (!FILES.includes(name)) throw new Error('непознат файл от дизайн системата: ' + name);
  return fs.readFileSync(path.join(uiDir, name), 'utf8');
};

module.exports = { FILES, text, of, uiDir };
