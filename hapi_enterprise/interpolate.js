'use strict';
// Интерполация на `{{променлива}}` в текстове, които отиват към хора: име и описание на
// портал, забележки, имейл за връзка. Стойностите идват от хранилището на променливи
// (`db.variables`), а `{{year}}`/`{{month}}`/`{{day}}`/`{{date}}` са вградени — те са
// нужни, за да може име на портал да носи година, без да се пренаписва всяка година.
//
// Правила (съзнателно прости и проверими):
//   • `{{key}}` — key по правилата на картотеката: `^[a-z][a-z0-9_]{0,39}$`;
//   • непозната променлива НЕ се трие: остава както е и се връща в `missing`, за да се
//     види веднага, вместо да излезе празно място пред получателя;
//   • стойност, която сама съдържа `{{...}}`, се разгъва (до 5 нива); цикъл се отчита
//     като `cycle`, а не се зацикля;
//   • интерполация НЕ се прилага върху файлови пътища — там стойност от данни е риск за
//     обхождане на директории. Пътищата остават буквални.
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,39})\s*\}\}/g;
const MAX_DEPTH = 5;
const MAX_LENGTH = 20000;

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Имената на променливите в текста (без повтаряне, по ред на появяване). */
function placeholders(template) {
  const out = [];
  const seen = new Set();
  const text = String(template == null ? '' : template);
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      out.push(match[1]);
    }
  }
  return out;
}

/** Вградени стойности: датата се подава отвън, за да е проверимо. */
function builtins(now) {
  const date = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    year: String(date.getUTCFullYear()),
    month: pad(date.getUTCMonth() + 1),
    day: pad(date.getUTCDate()),
    date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
  };
}

/** Стойност на една променлива: вградена → от хранилището → undefined. */
function lookup(key, ctx) {
  const variables = (ctx && ctx.variables) || {};
  const entry = variables[key];
  if (entry !== undefined) {
    if (isPlainObject(entry)) return entry.value === undefined || entry.value === null ? '' : String(entry.value);
    return String(entry);
  }
  const built = (ctx && ctx.builtins) || {};
  return Object.hasOwn(built, key) ? String(built[key]) : undefined;
}

/**
 * Разгъва текста. `chain` пази кои променливи вече се разгъват по ТОЗИ път, за да се
 * хване цикъл (`a → b → a`), вместо да се разчита на брой повторения.
 * @returns {{output: string, missing: string[], cycle: string[]}}
 */
function render(template, ctx) {
  const missing = [];
  const cycle = [];
  const expand = (input, chain) =>
    String(input).replace(PLACEHOLDER, (whole, key) => {
      if (chain.includes(key)) {
        if (!cycle.includes(key)) cycle.push(key);
        return whole;
      }
      const value = lookup(key, ctx);
      if (value === undefined) {
        if (!missing.includes(key)) missing.push(key);
        return whole;
      }
      if (!value.includes('{{')) return value;
      if (chain.length >= MAX_DEPTH) {
        if (!cycle.includes(key)) cycle.push(key);
        return whole;
      }
      return expand(value, [...chain, key]);
    });
  const output = expand(String(template == null ? '' : template).slice(0, MAX_LENGTH), []);
  return { output, missing, cycle };
}

/** Само текстът — удобно за места, където липсите не се показват. */
function text(template, ctx) {
  return render(template, ctx).output;
}

/** Готов контекст от състоянието на картотеката. */
function contextFrom(variables, now) {
  return { variables: isPlainObject(variables) ? variables : {}, builtins: builtins(now) };
}

module.exports = { PLACEHOLDER, MAX_DEPTH, placeholders, builtins, render, text, contextFrom };
