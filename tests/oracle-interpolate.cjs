'use strict';
// ОРАКУЛ: `{{променлива}}` в текстовете — точният резултат, не „не гърми“.
//
// Сегментът е малък и чист (без файлове, без мрежа), затова очакванията тук са записани
// буквално от правилата на модула:
//   • име на променлива: `^[a-z][a-z0-9_]{0,39}$` — друго НЕ е променлива и остава буквално;
//   • непозната променлива НЕ се трие — остава в текста и се връща в `missing`;
//   • вградените дати се смятат по UTC и са с водеща нула;
//   • стойност, която съдържа `{{...}}`, се разгъва до 5 нива; цикъл се отчита, не зацикля;
//   • изрична променлива с име `year` печели пред вградената;
//   • текст над 20 000 знака се отрязва ПРЕДИ разгъването.
const assert = require('node:assert/strict');
const interp = require('../hapi_enterprise/interpolate');

const ctx = interp.contextFrom({ organizacia: { value: 'Община Тест' }, cena: '12 345,67' }, '2026-03-07T23:30:00Z');

// ── 1. Кои са променливите в текста ────────────────────────────────────────────
assert.deepEqual(interp.placeholders('Договор за {{organizacia}} от {{ year }}'), ['organizacia', 'year'], 'по ред на поява, без повторение, с допустими интервали');
assert.deepEqual(interp.placeholders('{{a}}{{a}}{{b}}'), ['a', 'b'], 'повторената се брои веднъж');
assert.deepEqual(interp.placeholders('{{9bad}} {{Bad}} {{a-b}} {{}} {{a b}}'), [], 'невалидни имена не са променливи');
assert.deepEqual(interp.placeholders('{{' + 'a'.repeat(41) + '}}'), [], 'над 40 знака не е променлива');
assert.deepEqual(interp.placeholders(null), [], 'null не гърми и няма променливи');

// ── 2. Вградените дати: UTC, с водеща нула ────────────────────────────────────
assert.deepEqual(interp.builtins('2026-03-07T23:30:00Z'), { year: '2026', month: '03', day: '07', date: '2026-03-07' }, 'UTC и водеща нула');
assert.deepEqual(interp.builtins('2029-12-31T23:59:59Z').date, '2029-12-31', 'краят на годината не прелива');
assert.equal(interp.builtins(new Date('2026-01-05T00:00:00Z')).month, '01', 'януари е 01, не 1');

// ── 3. Разгъване: точният текст ───────────────────────────────────────────────
assert.equal(interp.text('Договор за {{organizacia}} от {{year}}-{{month}}-{{day}}', ctx), 'Договор за Община Тест от 2026-03-07', 'стойност от картотеката + вградени дати');
assert.equal(interp.text('Цена: {{cena}} лв.', ctx), 'Цена: 12 345,67 лв.', 'числото е както е записано');
assert.equal(interp.text('  {{ organizacia }}  ', ctx), '  Община Тест  ', 'интервалите в текста наоколо се пазят');

// ── 4. Непозната променлива остава и се отчита ───────────────────────────────
const unknown = interp.render('Клиент: {{klient}}', ctx);
assert.equal(unknown.output, 'Клиент: {{klient}}', 'непознатата НЕ се трие');
assert.deepEqual(unknown.missing, ['klient'], 'връща се в missing');
assert.deepEqual(unknown.cycle, [], 'това не е цикъл');

// ── 5. Стойност, която сама съдържа променлива, се разгъва ────────────────────
const nested = interp.contextFrom({ a: { value: 'X {{b}}' }, b: { value: 'Y' } }, '2026-03-07T00:00:00Z');
assert.equal(interp.text('{{a}}', nested), 'X Y', 'едно ниво се разгъва');
assert.deepEqual(interp.render('{{a}}', nested).missing, [], 'нищо не липсва');

// ── 6. Цикъл: спира и се отчита, вместо да зацикли ───────────────────────────
const loop = interp.contextFrom({ a: { value: '{{b}}' }, b: { value: '{{a}}' } }, '2026-03-07T00:00:00Z');
const looped = interp.render('{{a}}', loop);
assert.equal(looped.output, '{{a}}', 'цикълът връща текста непроменен');
assert.deepEqual(looped.cycle, ['a'], 'цикълът е отчетен с точното име');

// ── 7. Дълбочина: до 5 нива, после се отчита ─────────────────────────────────
const deepVars = {};
for (let i = 0; i < 8; i++) deepVars['p' + i] = { value: i === 7 ? 'КРАЙ' : '{{p' + (i + 1) + '}}' };
const deep = interp.contextFrom(deepVars, '2026-03-07T00:00:00Z');
const deepResult = interp.render('{{p0}}', deep);
assert.ok(deepResult.cycle.length > 0, 'прекалената дълбочина се отчита, не се разгъва до безкрай');
assert.ok(deepResult.output.includes('{{'), 'остатъкът остава видим, вместо да изчезне');

// ── 8. Изрична променлива печели пред вградената ─────────────────────────────
const override = interp.contextFrom({ year: { value: '1999' } }, '2026-03-07T00:00:00Z');
assert.equal(interp.text('{{year}}', override), '1999', 'собствената стойност печели пред вградената');

// ── 9. Форма на стойностите ──────────────────────────────────────────────────
assert.equal(interp.text('{{x}}', interp.contextFrom({ x: { value: 42 } }, 0)), '42', 'число се превръща в текст');
assert.equal(interp.text('{{x}}', interp.contextFrom({ x: { value: null } }, 0)), '', 'null е празен текст');
assert.equal(interp.text('{{x}}', interp.contextFrom({ x: 'просто' }, 0)), 'просто', 'и обикновена стойност работи');

// ── 10. Дълъг текст се отрязва ПРЕДИ разгъването ────────────────────────────
const long = interp.render('я'.repeat(25000), ctx);
assert.equal(long.output.length, 20000, 'таванът е 20 000 знака');

// ── 11. Празен контекст не гърми ────────────────────────────────────────────
assert.deepEqual(Object.keys(interp.contextFrom(null, 0)), ['variables', 'builtins'], 'празният контекст има същата форма');
assert.equal(interp.text('без променливи', undefined), 'без променливи', 'текст без променливи минава непроменен');

console.log('PASS oracle-interpolate: точни имена · UTC дати с водеща нула · непозната остава с {{…}} и в missing · разгъване до 5 нива · цикъл се отчита · изричната печели пред вградената · 20 000 знака таван');
