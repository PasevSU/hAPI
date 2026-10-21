$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
$NL = "`n"

function ReadNorm([string]$p) { [IO.File]::ReadAllText($p).Replace("`r`n", "`n") }
function WriteNorm([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t, $enc) }
function Must([string]$t, [string]$needle, [string]$label) {
  if (-not $t.Contains($needle)) { throw "anchor missing [$label]: $($needle.Substring(0, [Math]::Min(70, $needle.Length)))" }
}

# ── 1. server.js: bootstrap.js в allowlist-а на /ui/ ─────────────────────────
$p = 'hapi_enterprise/server.js'
$t = ReadNorm $p
$old = "for(const f of ['app.js','icons.js','data.js','report-objects.js'"
Must $t $old 'server ui allowlist'
$t = $t.Replace($old, "for(const f of ['bootstrap.js','app.js','icons.js','data.js','report-objects.js'")
WriteNorm $p $t
'patched: server.js'

# ── 2. scenario-matrix: регистрирай ui-version.cjs като област ───────────────
$p = 'tests/scenario-matrix.cjs'
$t = ReadNorm $p
$anchor = "owner: 'instance-lock.cjs'"
Must $t $anchor 'scenario-matrix instance-lock area'
$lines = $t -split $NL
$out = New-Object System.Collections.Generic.List[string]
$inserted = $false
foreach ($line in $lines) {
  $out.Add($line)
  if (-not $inserted -and $line.Contains($anchor)) {
    $out.Add("  { area: 'версия в GUI-я', owner: 'ui-version.cjs', endpoints: ['HAPI_VERSION', 'ui/bootstrap.js'] },")
    $inserted = $true
  }
}
if (-not $inserted) { throw 'scenario-matrix: областта не беше вмъкната' }
WriteNorm $p (($out -join $NL))
'patched: scenario-matrix.cjs'

# ── 3. Версия 0.61.1 ─────────────────────────────────────────────────────────
$p = 'hapi_enterprise/config.yaml'
$t = ReadNorm $p
Must $t 'version: "0.61.0"' 'config version'
WriteNorm $p $t.Replace('version: "0.61.0"', 'version: "0.61.1"')
'patched: config.yaml'

$p = 'custom_components/hapi_enterprise/manifest.json'
$t = ReadNorm $p
Must $t '"version":"0.61.0"' 'manifest version'
WriteNorm $p $t.Replace('"version":"0.61.0"', '"version":"0.61.1"')
'patched: manifest.json'

foreach ($doc in @('README.md', 'BG.md', 'DE.md', 'hapi_enterprise/README.md')) {
  $p = $doc
  $t = ReadNorm $p
  $new = [regex]::Replace($t, '(img\.shields\.io/badge/version-)0\.61\.0(-)', '${1}0.61.1${2}')
  if ($new -eq $t) { throw "badge не е намерен: $doc" }
  WriteNorm $p $new
  "patched badge: $doc"
}

# ── 4. CHANGELOG: запис за 0.61.1 ────────────────────────────────────────────
$p = 'CHANGELOG.md'
$t = ReadNorm $p
$anchor = '## 0.61.0 — 2026-10-21'
Must $t $anchor 'changelog 0.61.0'
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

'@
$entry = $entry.Replace("`r`n", "`n")
WriteNorm $p $t.Replace($anchor, $entry + $anchor)
'patched: CHANGELOG.md'
