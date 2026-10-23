'use strict';
// PasevSU Document Generator — клиентската част.
//
// Шаблоните НЕ се четат от `temp/index.json`, а от hAPI: `/admin/api/generator/templates`.
// Причината е техническа — браузърът не може да изброи файловете в сървърна папка, затова
// индексът се строи на сървъра (виж `hapi_enterprise/generator.js`). Така добавянето или
// изтриването на `*.html` се вижда веднага, без `tools/build-index.mjs` и без рестарт.
//
// Сигурност: съдържанието на шаблона се сервира като `text/plain` и се почиства ТУК, преди
// да влезе в редактора — скриптове, форми, вградени рамки и `on*` атрибути се махат.
// Адресът на add-on-а не е коренът на Home Assistant: под Ingress приложението се
// сервира на `/api/hassio_ingress/<token>/generator/`, затова абсолютно
// `/admin/api/...` стига до HA и връща 404. Префиксът се взема от адреса на документа;
// старите форми (/app, /hapi, /hassio/ingress) остават поддържани.
const API = (() => {
  const match = /^\/(?:api\/hassio_ingress|hassio\/ingress|app|hapi)\/[A-Za-z0-9_-]+/.exec(String(location.pathname || ''));
  return (match ? match[0] : '') + '/admin/api/generator/templates';
})();
const ALLOWED = /^[A-Za-z0-9_.-]+\.html$/;

const $ = (selector) => document.querySelector(selector);
const editor = $('#editor');
const status = $('#status');
let catalog = [];
// Реалният път на диска идва от сървъра: така човек знае къде да сложи шаблон,
// вместо да гадае къде е DATA_DIR на add-on-а.
let folderPath = 'generator/temp';
let selectedRange = null;

const message = (text) => {
  status.textContent = text;
};

/** Една заявка към hAPI с разбираемо съобщение при отказ. */
async function request(url, options = {}) {
  const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...options });
  if (res.status === 401) throw new Error('Няма достъп — отвори генератора през панела на hAPI (Ingress)');
  if (res.status === 403) throw new Error('Ролята ти няма право да променя шаблони');
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || 'HTTP ' + res.status);
  return data;
}

async function refresh() {
  try {
    const data = await request(API);
    if (!data || !Array.isArray(data.templates)) throw new Error('Невалиден индекс от сървъра');
    catalog = data.templates.filter((item) => item && ALLOWED.test(item.file));
    folderPath = data.folderPath || data.folder || 'generator/temp';
    render();
    message(`Заредени ${catalog.length} ${catalog.length === 1 ? 'шаблон' : 'шаблона'} · папка: ${folderPath}`);
  } catch (e) {
    message('Индексът не е достъпен: ' + e.message);
  }
}

function render() {
  const query = $('#search').value.toLocaleLowerCase();
  const list = $('#templates');
  list.replaceChildren();
  const visible = catalog.filter((item) => (item.title || item.file).toLocaleLowerCase().includes(query));
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = `Няма шаблони в ${folderPath}. Качи .html файл с „＋ Шаблон“ или го копирай в тази папка.`;
    list.append(empty);
    return;
  }
  for (const item of visible) {
    const row = document.createElement('div');
    row.className = 'tpl';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'tpl-open';
    open.textContent = item.title || item.file;
    open.title = item.file;
    open.addEventListener('click', () => openTemplate(item));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tpl-remove';
    remove.textContent = '✕';
    remove.title = 'Изтрий шаблона';
    remove.addEventListener('click', () => removeTemplate(item));
    row.append(open, remove);
    list.append(row);
  }
}

/**
 * Почиства HTML преди показване: маха изпълними елементи и атрибути, оставя само
 * безопасни адреси (http(s), mailto, # и data: изображения) — същата политика като в
 * оригиналния генератор, за да не се разчита на „доверен“ шаблон.
 */
function cleanHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,link,meta,base,style,svg,math').forEach((node) => node.remove());
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
  let element;
  while ((element = walker.nextNode())) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || ['srcdoc', 'style', 'contenteditable'].includes(name)) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (['href', 'src', 'action'].includes(name)) {
        const safe = /^(https?:|mailto:|#)/i.test(value) || (name === 'src' && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value));
        if (!safe) element.removeAttribute(attribute.name);
      }
    }
  }
  return doc.body.innerHTML;
}

async function openTemplate(item) {
  if (editor.textContent.trim() && !confirm('Да заменя ли текущото съдържание?')) return;
  try {
    const res = await fetch(API + '/' + encodeURIComponent(item.file), { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    editor.innerHTML = cleanHTML(await res.text());
    message('Отворен: ' + (item.title || item.file));
  } catch (e) {
    message('Грешка: ' + e.message);
  }
}

async function removeTemplate(item) {
  if (!confirm('Да изтрия ли „' + (item.title || item.file) + '“? Това не може да се отмени.')) return;
  try {
    await request(API + '/' + encodeURIComponent(item.file), { method: 'DELETE' });
    await refresh();
    message('Изтрит: ' + item.file);
  } catch (e) {
    message('Грешка: ' + e.message);
  }
}

async function uploadTemplate(file) {
  if (!/\.html?$/i.test(file.name)) return message('Избери .html файл');
  const name = file.name.replace(/\.htm$/i, '.html');
  const html = await file.text();
  const send = (overwrite) =>
    request(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, html, overwrite }),
    });
  try {
    await send(false);
  } catch (e) {
    if (!/вече съществува/.test(e.message)) return message('Грешка: ' + e.message);
    if (!confirm('Шаблон „' + name + '“ вече съществува. Да го заменя ли?')) return;
    try {
      await send(true);
    } catch (again) {
      return message('Грешка: ' + again.message);
    }
  }
  await refresh();
  message('Качен: ' + name);
}

function command(name, value) {
  editor.focus();
  document.execCommand(name, false, value);
}

function insert(html) {
  editor.focus();
  if (selectedRange) {
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(selectedRange);
  }
  document.execCommand('insertHTML', false, html);
  selectedRange = null;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function fileRead(input, fn) {
  input.value = '';
  input.click();
  input.onchange = () => {
    const file = input.files ? input.files[0] : null;
    if (file) fn(file);
  };
}

function action(type) {
  if (type === 'bold' || type === 'italic') return command(type);
  if (type === 'ordered') return command('insertOrderedList');
  if (type === 'indent' || type === 'outdent') return command(type);
  if (type === 'table') {
    return insert('<table><tbody><tr><th>Колона 1</th><th>Колона 2</th></tr><tr><td>Текст</td><td>Текст</td></tr></tbody></table><p></p>');
  }
  if (type === 'warning') return insert('<aside class="warning"><strong>ВНИМАНИЕ</strong><p>Въведи съдържание…</p></aside><p></p>');
  // Печат: нов раздел започва на нова страница (CSS `page-break-before`), вместо да се
  // надяваме, че браузърът сам ще счупи страницата на правилното място.
  if (type === 'pagebreak') return insert('<div class="page-break" contenteditable="false"></div><p></p>');
  if (type === 'image') {
    return fileRead($('#imageInput'), (file) => {
      if (file.size > 8e6) return alert('Изображението е над 8 MB');
      const reader = new FileReader();
      reader.onload = () => insert(`<img alt="Вмъкнато изображение" src="${reader.result}"><p></p>`);
      reader.readAsDataURL(file);
    });
  }
  if (type === 'pdf') {
    return fileRead($('#pdfInput'), (file) => {
      const span = document.createElement('span');
      span.textContent = file.name;
      insert(`<div class="pdf-object" data-pdf-name="${span.innerHTML}">PDF приложение: ${span.innerHTML} (само препратка, без вграждане на страници)</div><p></p>`);
    });
  }
}

$('nav').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (button) action(button.dataset.action);
});
$('#refresh').onclick = refresh;
$('#upload').onclick = () => fileRead($('#htmlInput'), uploadTemplate);
$('#search').oninput = render;
$('#save').onclick = () =>
  download(
    'document.json',
    new Blob([JSON.stringify({ format: 'pasevsu-document-v1', html: editor.innerHTML, created: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    }),
  );
$('#load').onclick = () =>
  fileRead($('#jsonInput'), async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'pasevsu-document-v1' || typeof data.html !== 'string') throw new Error('Неподдържан формат');
      if (!confirm('Да заменя ли текущия документ?')) return;
      editor.innerHTML = cleanHTML(data.html);
    } catch (e) {
      alert(e.message);
    }
  });
$('#print').onclick = () => window.print();

editor.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  selectedRange = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0).cloneRange() : null;
  const menu = $('#menu');
  menu.hidden = false;
  menu.style.left = Math.min(event.clientX, innerWidth - 220) + 'px';
  menu.style.top = Math.min(event.clientY, innerHeight - 190) + 'px';
});
$('#menu').addEventListener('click', (event) => {
  const button = event.target.closest('[data-insert]');
  if (button) {
    $('#menu').hidden = true;
    action(button.dataset.insert);
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('#menu')) $('#menu').hidden = true;
});
editor.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && event.target.closest('li')) {
    event.preventDefault();
    command(event.shiftKey ? 'outdent' : 'indent');
  }
});

refresh();
