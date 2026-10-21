$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
$NL = "`n"
function ReadNorm([string]$p) { [IO.File]::ReadAllText($p).Replace("`r`n", "`n") }
function WriteNorm([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t, $enc) }

'--- mtimes ---'
foreach ($f in @('README.md', 'BG.md', 'DE.md', 'CHANGELOG.md', 'hapi_enterprise/config.yaml')) {
  "{0,-28} {1}" -f $f, (Get-Item $f).LastWriteTime
}

# ── Баджове: всяка версия → 0.61.1 ───────────────────────────────────────────
foreach ($doc in @('README.md', 'BG.md', 'DE.md', 'hapi_enterprise/README.md')) {
  $p = $doc
  $t = ReadNorm $p
  $new = [regex]::Replace($t, '(img\.shields\.io/badge/version-)[0-9.]+(-)', '${1}0.61.1${2}')
  $was = ([regex]::Match($t, 'img\.shields\.io/badge/version-([0-9.]+)-')).Groups[1].Value
  if ($new -eq $t -and $was -ne '0.61.1') { throw "badge не е намерен: $doc" }
  WriteNorm $p $new
  "badge: $doc ($was -> 0.61.1)"
}

# ── CHANGELOG: запис за 0.61.1 ───────────────────────────────────────────────
$p = 'CHANGELOG.md'
$t = ReadNorm $p
if ($t.Contains('## 0.61.1')) {
  'CHANGELOG: записът вече съществува'
} else {
  $anchor = '## 0.61.0 — 2026-10-21'
  if (-not $t.Contains($anchor)) { throw 'changelog: липсва котва 0.61.0' }
  $entry = @'
## 0.61.1 — 2026-10-21

Версията в GUI-я вече идва от кода, а не от твърдо кодирани стойности.

- **Причина** — `hapi_enterprise/ui/index.html` показваше `v1.0.0`, а
  `hapi_enterprise/ui/app.js` — `v0.50.0` (бадж на панела и „Настройки → Версия“).
  Затова контролният център показваше стара версия както локално
  (`START_HAPI_GUI.bat`), така и в панела на add-on-а в Home Assistant, независимо
  коя версия е инсталирана.
- **Един източник** — `window.HAPI_VERSION` в `ui/data.js`; обвивката (`#app-version`),
  баджовете и панелите „Настройки“/„Относно“ четат само него.
- **`ui/bootstrap.js`** — зарежда споделените ядра с правилния базов път:
  `/hapi_enterprise/...` през HTTP и `../` при `file://`. Преди това
  `../hapi_enterprise/...` от диска сочеше `hapi_enterprise/hapi_enterprise/...`
  (404), т.е. `HapiReportManifest`, `HapiApiSpec`, `HapiVirtualStorage`,
  `HapiStorageTree`, `HapiExportRules`, `HapiDownloadAccess` и `HapiPublicGateway`
  липсваха в локалния GUI. `server.js` сервира и `/ui/bootstrap.js`.
- **`tests/ui-version.cjs`** — пази съответствието `ui/data.js` = `config.yaml` =
  `manifest.json` и забранява твърдо кодирани версии в `index.html`/`app.js`.
- **README бадж** — беше останал на `0.54.0` и затова хранилището изглеждаше стара
  версия; сега е синхронизиран с `config.yaml`.

'@
  $entry = $entry.Replace("`r`n", "`n")
  WriteNorm $p $t.Replace($anchor, $entry + $anchor)
  'patched: CHANGELOG.md'
}
