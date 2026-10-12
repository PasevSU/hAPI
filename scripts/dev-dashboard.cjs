'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.DASH_PORT || 8787);
const HOST = process.env.DASH_HOST || '127.0.0.1';
const COMMANDS_FILE = path.join(ROOT, 'dashboard-commands.json');
const MAX_OUTPUT = 200000;

// ---------- команди (запаметявани в dashboard-commands.json) ----------
const SEED = [
  { id: '1', name: 'Всички тестове', command: 'npm test', env: '', note: '82 теста, ~35s' },
  { id: '2', name: 'Линт', command: 'npm run lint', env: '', note: '' },
  { id: '3', name: 'Формат проверка', command: 'npm run format:check', env: '', note: '' },
  { id: '4', name: 'Dev сървър', command: 'node hapi_enterprise/server.js', env: 'DATA_DIR=data ADMIN_TOKEN=dev-only-token-0123456789abcdef0123456789 PORT=8099', note: 'http://127.0.0.1:8099' },
  { id: '5', name: 'Git статус', command: 'git status --short', env: '', note: '' },
  { id: '6', name: 'Последни commit-и', command: 'git log --oneline -10', env: '', note: '' }
];
let commands = loadCommands();
function loadCommands() {
  try { const list = JSON.parse(fs.readFileSync(COMMANDS_FILE, 'utf8')); if (Array.isArray(list) && list.length) return list; } catch {}
  try { fs.writeFileSync(COMMANDS_FILE, JSON.stringify(SEED, null, 2)); } catch {}
  return JSON.parse(JSON.stringify(SEED));
}
function saveCommands() { fs.writeFileSync(COMMANDS_FILE, JSON.stringify(commands, null, 2)); }

// ---------- архитектурно дърво ----------
const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'release', 'build', 'dist', '__pycache__', '.cache']);
const DESC = {
  'hapi_enterprise': 'Core Node.js runtime (add-on)',
  'custom_components': 'Home Assistant интеграция',
  'tests': 'Интеграционни тестове',
  'scripts': 'Dev инструменти (run-tests, dashboard)',
  'docs': 'Планове и спецификации',
  'documentation': 'Governance / ADR / архитектура',
  '.dev': 'UI redesign (dev)',
  '.github': 'CI/CD (CI + CodeQL)',
  'img': 'Изображения'
};
function buildTree(dir, depth) {
  const nodes = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name, 'en'));
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('dashboard-')) continue;
    const rel = path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/');
    if (e.isDirectory()) {
      const kids = depth < 6 ? buildTree(path.join(dir, e.name), depth + 1) : [];
      nodes.push({ name: e.name, rel, dir: true, desc: DESC[e.name] || '', children: kids });
    } else if (depth < 8) {
      nodes.push({ name: e.name, rel, dir: false });
    }
  }
  return nodes;
}

// ---------- изпълнение на команди ----------
const jobs = new Map();
let seq = 0;
function parseEnv(envStr) {
  const extra = {};
  for (const tok of String(envStr || '').split(/\s+/)) {
    const i = tok.indexOf('=');
    if (i > 0) extra[tok.slice(0, i)] = tok.slice(i + 1);
  }
  return extra;
}
function runCommand(cmd, envStr) {
  const id = String(++seq);
  const job = { id, command: cmd, status: 'running', code: null, output: '', startedAt: Date.now(), child: null, spawnError: null };
  jobs.set(id, job);
  let child;
  try {
    child = spawn(cmd, { cwd: ROOT, shell: true, windowsHide: true, env: { ...process.env, ...parseEnv(envStr), FORCE_COLOR: '0' } });
  } catch (e) { job.spawnError = String((e && e.message) || e); job.status = 'fail'; job.code = -1; return id; }
  job.child = child;
  const append = (d) => { job.output = (job.output + d.toString()).slice(-MAX_OUTPUT); };
  if (child.stdout) child.stdout.on('data', append);
  if (child.stderr) child.stderr.on('data', append);
  child.on('error', (e) => { job.spawnError = String((e && e.message) || e); job.status = 'fail'; job.code = -1; append('[spawn error: ' + job.spawnError + ']\n'); });
  child.on('exit', (code) => { job.status = code === 0 ? 'ok' : 'fail'; job.code = code; append('\n[изход: ' + code + ']\n'); });
  return id;
}
function stopCommand(id) {
  const job = jobs.get(id);
  if (!job || !job.child || job.status !== 'running') return false;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { windowsHide: true });
    else { try { process.kill(-job.child.pid, 'SIGTERM'); } catch { job.child.kill(); } }
  } catch { try { job.child.kill(); } catch {} }
  return true;
}

// ---------- HTTP ----------
function json(res, code, obj) { const body = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(body); }
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
    if (u.pathname === '/api/tree') { json(res, 200, buildTree(ROOT, 0)); return; }
    if (u.pathname === '/api/commands' && req.method === 'GET') { json(res, 200, commands); return; }
    if (u.pathname === '/api/commands' && req.method === 'PUT') {
      const body = await readBody(req);
      if (!Array.isArray(body)) return json(res, 400, { error: 'bad payload' });
      commands = body.map((c, i) => ({ id: String(c.id || i), name: String(c.name || ''), command: String(c.command || ''), env: String(c.env || ''), note: String(c.note || '') }));
      saveCommands(); json(res, 200, { ok: true }); return;
    }
    if (u.pathname === '/api/run' && req.method === 'POST') {
      const body = await readBody(req);
      const cmd = String(body.command || '').trim();
      if (!cmd) return json(res, 400, { error: 'empty command' });
      json(res, 200, { id: runCommand(cmd, body.env) }); return;
    }
    const jm = u.pathname.match(/^\/api\/jobs\/(\d+)$/);
    if (jm && req.method === 'GET') {
      const job = jobs.get(jm[1]);
      if (!job) return json(res, 404, { error: 'no job' });
      json(res, 200, { id: job.id, command: job.command, status: job.status, code: job.code, output: job.output, spawnError: job.spawnError }); return;
    }
    if (jm && req.method === 'POST') { json(res, 200, { stopped: stopCommand(jm[1]) }); return; }
    json(res, 404, { error: 'not found' });
  } catch (e) { json(res, 500, { error: String((e && e.message) || e) }); }
});
server.listen(PORT, HOST, () => console.log('hAPI Dev Табло: http://' + HOST + ':' + PORT));

// ---------- страница ----------
const PAGE = `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hAPI Dev Табло</title>
<style>
:root{--bg:#0f1115;--panel:#161a22;--panel2:#1c2230;--ink:#e6e9ef;--muted:#8b93a7;--accent:#a855f7;--ok:#34d399;--err:#f87171;--run:#fbbf24;--border:#262b38}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 "Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--panel);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5}
header h1{font-size:15px;margin:0}
.dot{width:9px;height:9px;border-radius:50%;background:var(--ok);display:inline-block}
.muted{color:var(--muted);font-size:12px}
.spacer{flex:1}
button{font:inherit;background:var(--panel2);color:var(--ink);border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer}
button:hover{border-color:var(--accent)}
button.run{background:var(--accent);color:#fff;border-color:var(--accent)}
button.stop{background:var(--err);color:#fff;border-color:var(--err)}
.layout{display:grid;grid-template-columns:300px 1fr;min-height:calc(100vh - 46px)}
aside{background:var(--panel);border-right:1px solid var(--border);padding:10px;overflow:auto;max-height:calc(100vh - 46px);position:sticky;top:46px}
main{padding:16px;max-width:1050px}
.tree details{margin:2px 0}
.tree summary{cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px}
.tree summary:hover{background:var(--panel2)}
.tree .desc{color:var(--muted);font-size:11px;margin-left:6px}
.tree .leaf{font-size:12.5px;color:var(--muted);padding:1px 4px 1px 22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tree .kids{margin-left:14px;border-left:1px solid var(--border);padding-left:6px}
h2{font-size:14px;margin:18px 0 8px}
.card{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.card .nm{font-weight:600;min-width:140px}
.card .cmd{font-family:Consolas,monospace;font-size:12.5px;background:var(--panel2);padding:3px 8px;border-radius:5px;flex:1;min-width:220px;word-break:break-all}
.card .env{color:var(--muted);font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
form.add{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
form.add input{font:inherit;background:var(--panel);color:var(--ink);border:1px solid var(--border);border-radius:6px;padding:5px 8px}
form.add input.name{width:150px}
form.add input.cmd{flex:1;min-width:260px;font-family:Consolas,monospace}
form.add input.env{width:230px;font-family:Consolas,monospace;font-size:12px}
.console{background:#0a0c10;border:1px solid var(--border);border-radius:8px;margin-top:6px}
.console .bar{display:flex;gap:10px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);background:var(--panel)}
.console pre{margin:0;padding:10px 12px;max-height:400px;overflow:auto;font:12px/1.45 Consolas,monospace;white-space:pre-wrap;word-break:break-all}
.chip{padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600}
.chip.run{background:#3b2f10;color:var(--run)}
.chip.ok{background:#0d3326;color:var(--ok)}
.chip.fail{background:#3b1216;color:var(--err)}
.empty{color:var(--muted);padding:6px 2px}
</style>
</head>
<body>
<header><h1><span class="dot"></span> hAPI Dev Табло</h1><span class="muted" id="port"></span><span class="spacer"></span><span class="muted">архитектурно дърво + команди</span></header>
<div class="layout">
<aside><h2>🏗 Архитектура</h2><div class="tree" id="tree"><div class="empty">зареждане…</div></div></aside>
<main>
  <h2>⚡ Команди</h2>
  <form class="add" id="cmdForm">
    <input type="text" class="name" id="fName" placeholder="Име" required>
    <input type="text" class="cmd" id="fCmd" placeholder="Команда (напр. npm test)" required>
    <input type="text" class="env" id="fEnv" placeholder="Env: KEY=VALUE KEY2=V2 (опц.)">
    <button type="submit" id="fBtn">➕ Добави</button>
    <button type="button" id="fCancel" style="display:none">Отказ</button>
  </form>
  <div id="cmdList"></div>
  <h2>🖥 Конзола</h2>
  <div class="console" id="console"><div class="empty">Изпълнете команда — изходът ще се появи тук.</div></div>
</main>
</div>
<script>
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
let editingId = null;
let currentJob = null, pollTimer = null;
async function api(path, opts) { const r = await fetch(path, opts); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
function renderTree(nodes, root) {
  for (const n of nodes) {
    if (n.dir) {
      const d = document.createElement('details');
      const s = document.createElement('summary');
      s.textContent = '📁 ' + n.name;
      if (n.desc) { const sp = document.createElement('span'); sp.className = 'desc'; sp.textContent = '— ' + n.desc; s.appendChild(sp); }
      d.appendChild(s);
      const kids = document.createElement('div'); kids.className = 'kids';
      if (n.children) renderTree(n.children, kids);
      d.appendChild(kids); root.appendChild(d);
    } else {
      const l = document.createElement('div');
      l.className = 'leaf'; l.textContent = '· ' + n.name; l.title = n.rel;
      root.appendChild(l);
    }
  }
}
async function loadTree() { const t = await api('/api/tree'); const c = $('tree'); c.innerHTML = ''; renderTree(t, c); }
let commands = [];
function renderCommands() {
  const list = $('cmdList'); list.innerHTML = '';
  for (const c of commands) {
    const card = document.createElement('div'); card.className = 'card';
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = c.name;
    const cmd = document.createElement('div'); cmd.className = 'cmd'; cmd.textContent = c.command; cmd.title = c.command;
    const env = document.createElement('div'); env.className = 'env'; env.textContent = c.env || ''; env.title = c.env || '';
    const bRun = document.createElement('button'); bRun.className = 'run'; bRun.textContent = '▶ Изпълни'; bRun.onclick = () => runCmd(c.command, c.env);
    const bEdit = document.createElement('button'); bEdit.textContent = '✎'; bEdit.title = 'Редактирай'; bEdit.onclick = () => startEdit(c);
    const bDel = document.createElement('button'); bDel.textContent = '🗑'; bDel.title = 'Изтрий'; bDel.onclick = () => removeCmd(c.id);
    card.append(nm, cmd, env, bRun, bEdit, bDel);
    list.appendChild(card);
  }
}
async function loadCommands() { commands = await api('/api/commands'); renderCommands(); }
async function persist() { await api('/api/commands', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commands) }); }
async function addCmd(ev) {
  ev.preventDefault();
  const name = $('fName').value.trim(), command = $('fCmd').value.trim(), env = $('fEnv').value.trim();
  if (!name || !command) return;
  if (editingId) { const c = commands.find(x => x.id === editingId); c.name = name; c.command = command; c.env = env; }
  else commands.push({ id: String(Date.now()), name, command, env, note: '' });
  await persist(); resetForm(); renderCommands();
}
function startEdit(c) { editingId = c.id; $('fName').value = c.name; $('fCmd').value = c.command; $('fEnv').value = c.env || ''; $('fBtn').textContent = '💾 Запази'; $('fCancel').style.display = ''; }
function resetForm() { editingId = null; $('cmdForm').reset(); $('fBtn').textContent = '➕ Добави'; $('fCancel').style.display = 'none'; }
async function removeCmd(id) { commands = commands.filter(x => x.id !== id); await persist(); renderCommands(); }
async function runCmd(command, env) { const job = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, env }) }); showJob(job.id); }
function showJob(id) { if (pollTimer) clearInterval(pollTimer); currentJob = id; pollTimer = setInterval(poll, 500); poll(); }
async function poll() {
  if (!currentJob) return;
  const j = await api('/api/jobs/' + currentJob);
  const c = $('console');
  const chip = j.status === 'running' ? '<span class="chip run">⏳ изпълнява се</span>' : (j.status === 'ok' ? '<span class="chip ok">✅ успех</span>' : '<span class="chip fail">❌ провал (код ' + j.code + ')</span>');
  const stopBtn = j.status === 'running' ? '<button class="stop" onclick="stopJob()">■ Стоп</button>' : '';
  c.innerHTML = '<div class="bar"><span class="muted">' + esc(j.command) + '</span>' + chip + '<span class="spacer"></span>' + stopBtn + '</div><pre>' + esc(j.output || '(няма изход)') + '</pre>';
  const pre = c.querySelector('pre'); pre.scrollTop = pre.scrollHeight;
  if (j.status !== 'running') { clearInterval(pollTimer); pollTimer = null; }
}
async function stopJob() { if (!currentJob) return; await api('/api/jobs/' + currentJob + '/stop', { method: 'POST' }); }
$('cmdForm').addEventListener('submit', addCmd);
$('fCancel').onclick = resetForm;
loadTree(); loadCommands();
</script>
</body>
</html>`;
