import { requireConsent } from './consent.js';

// Evidence View портал — дърво, информация за файловете и QR.
//
// Правила, които файлът спазва:
//   • съдържание от манифеста се рисува САМО през textContent/createElement — никъде няма
//     innerHTML, защото имената и описанията идват от пакет, който не контролираме;
//   • QR кодът кодира само навигация (адрес + folder [+ file]) и никога парола или токен;
//   • липсващо поле се показва като „няма данни“, не като измислена стойност.

const app = document.querySelector('#app');
const $ = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const state = {
  manifest: null,
  expanded: new Set(),
  selected: null,
  query: '',
  access: 'all',
  protection: 'all',
  sort: 'name',
};

function folderId() {
  const raw = decodeURIComponent(location.pathname);
  const match = raw.match(/\/portal\.html:([^/]+)$/);
  if (match) return match[1];
  return new URLSearchParams(location.search).get('folder') || 'demo-evidence';
}
const id = folderId();
if (!/^[a-zA-Z0-9_-]{1,90}$/.test(id)) throw Error('Невалиден идентификатор на пакет');

const fmtDate = (v) =>
  v
    ? new Intl.DateTimeFormat('bg-BG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(v)) + ' UTC'
    : 'няма данни';
const size = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'няма данни';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
  return n + ' B';
};
const icons = { folder: '📁', eml: '📧', pdf: '📕', png: '🖼️', jpg: '🖼️', zip: '🗜️', json: '📄', mp4: '🎞️', other: '📄' };
const iconFor = (node) => icons[node.extension] || icons[node.type] || icons.other;

// ------------------------------------------------------------------ изчисления

/** Всички файлове в манифеста, подредени както се виждат. */
function walkFiles(nodes, out = []) {
  for (const node of nodes || []) {
    if (node.type === 'folder') walkFiles(node.children, out);
    else if (node.type === 'file') out.push(node);
  }
  return out;
}

/** Обобщение за заглавната част. Сървърните `totals` имат приоритет. */
function totalsOf(manifest) {
  const files = walkFiles(manifest.items);
  const folders = [];
  const walk = (nodes) =>
    (nodes || []).forEach((n) => {
      if (n.type === 'folder') {
        folders.push(n);
        walk(n.children);
      }
    });
  walk(manifest.items);
  const computed = {
    files: files.length,
    folders: folders.length,
    bytes: files.reduce((sum, f) => sum + (Number(f.bytes) || 0), 0),
  };
  const given = manifest.totals || {};
  return {
    files: Number.isFinite(given.files) ? given.files : computed.files,
    folders: Number.isFinite(given.folders) ? given.folders : computed.folders,
    bytes: Number.isFinite(given.bytes) ? given.bytes : computed.bytes,
  };
}

function findNode(nodes, key) {
  for (const node of nodes || []) {
    if (node.id === key) return node;
    if (node.children) {
      const found = findNode(node.children, key);
      if (found) return found;
    }
  }
  return null;
}

function matches(node) {
  if (state.access !== 'all' && node.access !== state.access) return false;
  if (state.protection !== 'all' && node.protection !== state.protection) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [node.name, node.description, node.source, node.mime, ...(node.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

/** Папка се показва, ако тя или някое нейно дете минава филтъра. */
function visible(node) {
  if (node.type === 'file') return matches(node);
  return (node.children || []).some(visible);
}

// ------------------------------------------------------------------ QR

const baseUrl = () => {
  const given = state.manifest && state.manifest.package && state.manifest.package.publicUrl;
  if (typeof given === 'string' && given.trim()) return given.trim().replace(/[?#].*$/, '');
  return location.origin + location.pathname + '?folder=' + encodeURIComponent(id);
};
const packageLink = () => baseUrl();
const fileLink = (fileId) => baseUrl() + '#file=' + encodeURIComponent(fileId);

/** Матрица от вендорвания енкодер. `window.qrcode` идва от assets/qrcode.js. */
function qrMatrix(text) {
  const encoder = window.qrcode;
  if (typeof encoder !== 'function') throw Error('QR енкодерът не е зареден (assets/qrcode.js)');
  const qr = encoder(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return { count, dark: (row, col) => qr.isDark(row, col) };
}

/** SVG се строи като DOM, не като низ — така няма innerHTML и няма начин да се пръсне. */
function qrSvg(text, label) {
  const { count, dark } = qrMatrix(text);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${count} ${count}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label || 'QR код');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  let d = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (dark(row, col)) d += `M${col} ${row}h1v1h-1z`;
    }
  }
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadSvg(text, filename) {
  const svg = qrSvg(text, filename);
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  document.body.append(svg);
  const markup = new XMLSerializer().serializeToString(svg);
  svg.remove();
  download(new Blob([markup], { type: 'image/svg+xml' }), filename + '.svg');
}

function downloadPng(text, filename, scale = 8) {
  const { count, dark } = qrMatrix(text);
  const quiet = 4;
  const side = (count + quiet * 2) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = '#000';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (dark(row, col)) ctx.fillRect((col + quiet) * scale, (row + quiet) * scale, scale, scale);
    }
  }
  canvas.toBlob((blob) => blob && download(blob, filename + '.png'), 'image/png');
}

// ------------------------------------------------------------------ действия за достъп

function createButton(label, title, fn, disabled = false) {
  const b = $('button', 'act', label);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.disabled = disabled;
  if (fn) b.addEventListener('click', fn);
  return b;
}

async function requestAccess(node, action, password) {
  const r = await fetch(`/api/evidence/${encodeURIComponent(id)}/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ fileId: node.id, action, password }),
  });
  if (!r.ok) throw Error('Достъпът е отказан или сървърният API не е конфигуриран.');
  const data = await r.json();
  if (!data.url || !data.url.startsWith('/') || data.url.startsWith('//')) throw Error('Невалиден адрес за достъп');
  if (action === 'preview') window.open(data.url, '_blank', 'noopener,noreferrer');
  else location.assign(data.url);
}

function modalPassword(node, action) {
  const back = $('div', 'modalback');
  const box = $('section', 'modal');
  box.append($('h2', '', `🔐 ${node.name}`), $('p', '', 'Въведете паролата за този файл. Паролата се проверява от сървъра.'));
  const input = $('input');
  input.type = 'password';
  input.autocomplete = 'off';
  const err = $('p', 'dim', '');
  const foot = $('footer');
  const cancel = $('button', 'tool', 'Отказ');
  cancel.type = 'button';
  cancel.onclick = () => back.remove();
  const submit = $('button', 'primary', 'Продължи');
  submit.type = 'button';
  submit.onclick = async () => {
    submit.disabled = true;
    try {
      await requestAccess(node, action, input.value);
      back.remove();
    } catch (e) {
      err.textContent = e.message;
    } finally {
      submit.disabled = false;
    }
  };
  foot.append(cancel, submit);
  box.append(input, err, foot);
  back.append(box);
  document.body.append(back);
  input.focus();
}

function accessFile(node, action) {
  if (node.access === 'locked') return;
  if (node.access === 'password') return modalPassword(node, action);
  requestAccess(node, action, '').catch((e) => alert(e.message));
}

function showInfo(node) {
  const s = node.software;
  alert(
    s
      ? `Софтуер: ${s.name}\nЛиценз: ${s.license || 'непосочен'}\nВерсия: ${s.version || 'непосочена'}`
      : 'Няма предоставени данни за софтуер или лиценз.',
  );
}

// ------------------------------------------------------------------ детайлен панел

const accessText = (access) => (access === 'free' ? '🔓 Свободен' : access === 'password' ? '🔐 С парола' : '🔒 Заключен');

function detailSection(title, rows) {
  const section = $('section', 'sec');
  section.append($('h3', '', title));
  const grid = $('div', 'details-grid');
  for (const [key, value] of rows) {
    const cell = $('div', 'detail');
    cell.append($('b', '', key), $('span', '', value === undefined || value === null || value === '' ? 'няма данни' : String(value)));
    grid.append(cell);
  }
  section.append(grid);
  return section;
}

function qrBlock(text, label, filename) {
  const wrap = $('section', 'sec qr');
  wrap.append($('h3', '', 'QR код'), $('p', 'dim', 'Кодира се само връзката — без парола, без токен за достъп.'));
  const holder = $('div', 'qrbox');
  try {
    holder.append(qrSvg(text, label));
  } catch (e) {
    holder.append($('p', 'dim', e.message));
  }
  const link = $('code', 'qrlink', text);
  const actions = $('div', 'actions');
  actions.append(
    createButton('⧉', 'Копирай връзката', () => navigator.clipboard && navigator.clipboard.writeText(text)),
    createButton('SVG', 'Изтегли QR като SVG (за печат)', () => downloadSvg(text, filename)),
    createButton('PNG', 'Изтегли QR като PNG', () => downloadPng(text, filename)),
  );
  wrap.append(holder, link, actions);
  return wrap;
}

function renderDetails() {
  const old = document.querySelector('.details');
  if (old) old.remove();
  const node = findNode(state.manifest.items, state.selected);
  if (!node || node.type !== 'file') return;

  const wrap = $('aside', 'details');
  const head = $('header', 'dhead');
  head.append($('h2', '', `🔎 ${node.name}`), $('p', 'dim', `Тип: ${node.mime || node.extension || 'няма данни'} · ${accessText(node.access)}`));
  head.append(createButton('✕', 'Затвори детайлите', () => selectFile(null)));
  wrap.append(head);

  wrap.append(
    detailSection('Основни', [
      ['Идентификатор', node.id],
      ['MIME тип', node.mime],
      ['Размер', `${size(node.bytes)}${typeof node.bytes === 'number' ? ` (${node.bytes} B)` : ''}`],
      ['Етикети', (node.tags || []).join(', ')],
      ['Описание', node.description],
    ]),
  );
  wrap.append(
    detailSection('Време', [
      ['Създаден (твърдение)', fmtDate(node.created)],
      ['Променен (твърдение)', fmtDate(node.modified)],
      ['Събран', fmtDate(node.collectedAt)],
      ['Достъп до', fmtDate(node.expiresAt)],
    ]),
  );
  wrap.append(
    detailSection('Цялост', [
      ['SHA-256', node.sha256],
      ['SHA-512', node.sha512],
      ['MD5', node.md5],
      ['Проверен', node.verified && node.verified.sha256 ? `да, ${fmtDate(node.verified.checkedAt)}` : 'не е потвърдено от сървъра'],
    ]),
  );
  wrap.append(
    detailSection('Достъп и произход', [
      ['Режим', accessText(node.access)],
      ['Защита', node.protection],
      ['Източник', node.source],
      ['Софтуер', node.software && node.software.name],
      ['Лиценз', node.software && node.software.license],
    ]),
  );

  wrap.append(qrBlock(fileLink(node.id), `QR към файла ${node.name}`, `qr-${node.id}`));

  const raw = $('details', 'raw');
  raw.append($('summary', '', 'Суров JSON на файла'), $('pre', '', JSON.stringify(node, null, 2)));
  wrap.append(raw);

  document.body.append(wrap);
}

// ------------------------------------------------------------------ таблица

function fileCard(node) {
  const card = $('article', 'card');
  if (node.id === state.selected) card.classList.add('selected');
  const top = $('div', 'cardtop');
  top.append($('span', 'tile', iconFor(node)));
  const ident = $('div', 'ident');
  ident.append($('h4', 'cardname', node.name), $('p', 'dim', [node.mime || node.extension, size(node.bytes), fmtDate(node.modified)].filter(Boolean).join(' · ')));
  top.append(ident);
  const pill = $('span', 'pill ' + node.access, accessText(node.access));
  top.append(pill);
  card.append(top);

  if (node.description) card.append($('p', 'carddesc', node.description));
  const tags = (node.tags || []).slice(0, 4);
  if (tags.length) {
    const chipRow = $('div', 'tagrow');
    for (const tag of tags) chipRow.append($('span', 'tag', tag));
    card.append(chipRow);
  }

  const actions = $('div', 'cardactions');
  actions.append(
    createButton('ℹ', 'Информация за файла', () => selectFile(node.id)),
    createButton('▦', 'QR код на файла', () => { selectFile(node.id); const qr = document.querySelector('.details .qr'); if (qr) qr.scrollIntoView({ block: 'center' }) }),
    createButton('◈', 'Лицензиран софтуер: ' + ((node.software && node.software.name) || 'не е посочен'), () => showInfo(node)),
    createButton('👁', 'Преглед', () => accessFile(node, 'preview'), node.access === 'locked'),
    createButton('↓', 'Изтегляне', () => accessFile(node, 'download'), node.access === 'locked'),
    createButton('⧉', 'Копиране на SHA-256', () => navigator.clipboard && navigator.clipboard.writeText(node.sha256 || ''), !node.sha256),
  );
  card.append(actions);
  card.onclick = (e) => {
    if (e.target.closest('button')) return;
    selectFile(node.id);
  };
  return card;
}

/** Папката е секция с карти, а не ред в таблица — така изглежда като облачна папка. */
function folderBlock(node, depth) {
  const section = $('section', 'folder');
  const head = $('header', 'folderhead');
  const open = state.expanded.has(node.id);
  const toggle = $('button', 'foldertoggle', `${open ? '⌄' : '›'} ${icons.folder} ${node.name}`);
  toggle.type = 'button';
  toggle.onclick = () => {
    if (open) state.expanded.delete(node.id);
    else state.expanded.add(node.id);
    render();
  };
  head.append(toggle, $('span', 'dim', `${(node.children || []).filter(visible).length} елемента`));
  section.append(head);
  if (!open) return section;
  const grid = $('div', 'grid');
  for (const child of node.children || []) {
    if (!visible(child)) continue;
    grid.append(child.type === 'folder' ? folderBlock(child, depth + 1) : fileCard(child));
  }
  section.append(grid);
  return section;
}

/** Изборът се пази и в адреса, за да води QR кодът директно до файла. */
function selectFile(fileId) {
  state.selected = fileId;
  const url = new URL(location.href);
  url.hash = fileId ? 'file=' + encodeURIComponent(fileId) : '';
  history.replaceState(null, '', url);
  render();
}

// ------------------------------------------------------------------ изглед

function toolbar() {
  const bar = $('div', 'toolbar');

  const search = $('input', 'search');
  search.type = 'search';
  search.placeholder = 'Търсене по име, етикет или описание…';
  search.setAttribute('aria-label', 'Търсене в пакета');
  search.value = state.query;
  search.oninput = () => { state.query = search.value; render(); };
  bar.append(search);

  const access = $('select');
  access.setAttribute('aria-label', 'Филтър по достъп');
  for (const [value, label] of [['all', 'Всички достъпи'], ['free', 'Свободни'], ['password', 'С парола'], ['locked', 'Заключени']]) {
    const option = $('option', '', label);
    option.value = value;
    access.append(option);
  }
  access.value = state.access;
  access.onchange = () => { state.access = access.value; render(); };
  bar.append(access);

  const protection = $('select');
  protection.setAttribute('aria-label', 'Филтър по ниво на защита');
  const levels = new Set(walkFiles(state.manifest.items).map((f) => f.protection).filter(Boolean));
  for (const value of ['all', ...[...levels].sort()]) {
    const option = $('option', '', value === 'all' ? 'Всички нива' : value);
    option.value = value;
    protection.append(option);
  }
  protection.value = state.protection;
  protection.onchange = () => { state.protection = protection.value; render(); };
  bar.append(protection);

  const sort = $('select');
  sort.setAttribute('aria-label', 'Подреждане');
  for (const [value, label] of [['name', 'По име'], ['size', 'По размер'], ['date', 'По дата']]) {
    const option = $('option', '', label);
    option.value = value;
    sort.append(option);
  }
  sort.value = state.sort;
  sort.onchange = () => { state.sort = sort.value; render(); };
  bar.append(sort);

  const expand = $('button', 'tool', 'Разгъни всички');
  expand.type = 'button';
  expand.onclick = () => {
    const walk = (nodes) => (nodes || []).forEach((n) => { if (n.type === 'folder') { state.expanded.add(n.id); walk(n.children) } });
    walk(state.manifest.items);
    render();
  };
  bar.append(expand);
  return bar;
}

/** Децата на папка според избраното подреждане. */
function sortedChildren(node) {
  const children = [...(node.children || [])];
  if (state.sort === 'size') return children.sort((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0));
  if (state.sort === 'date') return children.sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  return children.sort((a, b) => String(a.name).localeCompare(String(b.name), 'bg'));
}

function render() {
  app.replaceChildren();
  const panel = $('section', 'panel');

  const totals = totalsOf(state.manifest);
  const head = $('header', 'head');
  const title = $('div');
  title.append($('h1', '', `📁 ${state.manifest.title}`), $('p', '', `Изолиран пакет: ${id} · Само предоставените материали`));
  const chips = $('div', 'chips');
  for (const [label, value] of [
    ['Файлове', totals.files],
    ['Папки', totals.folders],
    ['Общ размер', size(totals.bytes)],
    ['Защита', (state.manifest.package && state.manifest.package.protection) || 'няма данни'],
    ['Създаден', fmtDate(state.manifest.package && state.manifest.package.created)],
  ]) {
    const chip = $('span', 'chip');
    chip.append($('b', '', label + ': '), document.createTextNode(String(value)));
    chips.append(chip);
  }
  const tools = $('div', 'tools');
  const pkgQr = $('button', 'tool', '▦ QR на пакета');
  pkgQr.type = 'button';
  pkgQr.onclick = () => showPackageQr();
  tools.append(pkgQr);
  head.append(title, chips, tools);
  panel.append(head, toolbar());

  const content = $('div', 'content');
  const roots = sortedChildren({ children: state.manifest.items });
  const topLevel = $('div', 'grid');
  const folderSections = [];
  let shown = 0;
  for (const node of roots) {
    if (!visible(node)) continue;
    shown += 1;
    if (node.type === 'folder') folderSections.push(folderBlock(node, 0));
    else topLevel.append(fileCard(node));
  }
  if (topLevel.childNodes.length) content.append(topLevel);
  for (const section of folderSections) content.append(section);
  if (shown === 0) content.append($('p', 'message', 'Няма съвпадения за това търсене или филтър.'));
  const cloud = $('div', 'cloud');
  cloud.append(content);
  panel.append(cloud);

  const legend = $('div', 'legend');
  for (const s of ['🔓 Свободен', '🔐 С парола', '🔒 Заключен', 'ℹ Информация', '▦ QR код', '◈ Софтуер', '👁 Преглед', '↓ Изтегляне']) {
    legend.append($('span', '', s));
  }
  panel.append(legend);
  app.append(panel);

  renderDetails();
  app.append($('p', 'message', 'Демонстрационен интерфейс: действителният контрол на достъпа, паролите и файловете се осигурява от сървърния Evidence API.'));
}

function showPackageQr() {
  const back = $('div', 'modalback');
  const box = $('section', 'modal wide');
  box.append($('h2', '', '▦ QR на пакета'), $('p', 'dim', 'Сканирането отваря този пакет. Кодът не съдържа парола или токен.'));
  box.append(qrBlock(packageLink(), 'QR към пакета', 'qr-package-' + id));
  const foot = $('footer');
  const close = $('button', 'tool', 'Затвори');
  close.type = 'button';
  close.onclick = () => back.remove();
  foot.append(close);
  box.append(foot);
  back.append(box);
  document.body.append(back);
}

// ------------------------------------------------------------------ данни

/**
 * Манифестът на пакета. Редът е: сървърният API (`GET /api/evidence/<id>/manifest`), а при
 * липсващ API — демо данните от `./data/demo-evidence.json`, но САМО за демо пакета. За
 * истински пакет липсата на API е грешка и се казва с думи, вместо да се покаже чужда
 * демонстрация. Съгласието се пита ПРЕДИ това (виж `init`).
 */
async function loadManifest() {
  // Мрежова грешка се третира като „API не е налично“ — не се хвърля вътре в catch,
  // за да не се губи причината и да няма вложени опити.
  const r = await fetch(`/api/evidence/${encodeURIComponent(id)}/manifest`, { credentials: 'include', cache: 'no-store' }).catch(() => null);
  if (r && r.ok) return await r.json();
  // Демо данните са САМО за демо пакета; за истински пакет липсата на API е грешка.
  if (id !== 'demo-evidence') throw Error('API not available');
  const demo = await fetch('./data/demo-evidence.json', { cache: 'no-store' }).catch(() => null);
  if (!demo || !demo.ok) throw Error('демо данните липсват (./data/demo-evidence.json)');
  return await demo.json();
}

async function init() {
  await requireConsent();
  try {
    state.manifest = await loadManifest();
  } catch {
    app.textContent = 'Пакетът не е намерен или нямате достъп до него.';
    return;
  }
  state.expanded = new Set(state.manifest.items.filter((n) => n.type === 'folder').map((n) => n.id));
  const deep = /^#file=(.+)$/.exec(location.hash);
  if (deep) {
    const fileId = decodeURIComponent(deep[1]);
    if (findNode(state.manifest.items, fileId)) state.selected = fileId;
  }
  render();
}

init();
