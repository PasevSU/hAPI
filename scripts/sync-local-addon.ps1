# Синхронизира add-on-а от това репо към локалната папка на Home Assistant
# (`/addons/hapi_enterprise` през SMB), за да се вижда като Local app, а не от GitHub.
#
#   npm run sync:local
#   pwsh -NoProfile -File scripts/sync-local-addon.ps1 -WhatIf        # само преглед
#   pwsh -NoProfile -File scripts/sync-local-addon.ps1 -VerifyOnly    # проверка без копиране
#   pwsh -NoProfile -File scripts/sync-local-addon.ps1 -Backup        # с backup на старата версия
#
# Защо: Supervisor показва като локален add-on всяка папка в /addons с `config.yaml`
# в корена. GitHub хранилището дава отделен add-on (0.54.0), затова за локална работа
# се ползва тази папка, а GitHub репото се маха от Add-on Store → ⋮ → Repositories.
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$Target = '\\192.168.50.4\addons\hapi_enterprise',
  [string]$IntegrationTarget = '\\192.168.50.4\config\custom_components\hapi_enterprise',
  [string]$Source,
  [switch]$Backup,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'

if (-not $Source) {
  $Source = Join-Path (Split-Path -Parent $PSScriptRoot) 'hapi_enterprise'
}
if (-not (Test-Path $Source)) { throw "Липсва изходната папка: $Source" }

# Проверява, че папката е валиден add-on и че всичко от Dockerfile COPY е налице —
# липсващ файл чува билда в Supervisor с неясна грешка.
function Assert-AddonLayout([string]$Dir) {
  $required = @('config.yaml', 'Dockerfile', 'start.js', 'server.js')
  foreach ($file in $required) {
    if (-not (Test-Path (Join-Path $Dir $file))) { throw "Липсва $file в $Dir" }
  }
  $cfg = Get-Content (Join-Path $Dir 'config.yaml') -Raw
  foreach ($key in @('name:', 'version:', 'slug:', 'arch:', 'options:', 'schema:')) {
    if ($cfg -notmatch "(?m)^$([regex]::Escape($key))") { throw "config.yaml: липсва $key" }
  }
  $dockerfile = Get-Content (Join-Path $Dir 'Dockerfile') -Raw
  foreach ($line in ($dockerfile -split "`n")) {
    if ($line -notmatch '^COPY\s') { continue }
    $parts = ($line -replace '^COPY\s+', '') -split '\s+'
    foreach ($src in $parts[0..($parts.Count - 2)]) {
      if (-not (Test-Path (Join-Path $Dir $src))) { throw "Dockerfile COPY: липсва '$src' в $Dir" }
    }
  }
  # Entrypoint-ът е чист JS (start.js), стартиран от Dockerfile с `node`.
  if ($dockerfile -notmatch 'CMD\s+\["node",\s*"/app/start\.js"\]') {
    throw 'Dockerfile: CMD трябва да е ["node", "/app/start.js"]'
  }
  $entry = Get-Content (Join-Path $Dir 'start.js') -Raw
  if ($entry -notmatch 'spawn\(process\.execPath,\s*\[SERVER\]') { throw 'start.js: липсва старт на server.js' }
  Write-Host "Layout OK: $Dir"
}

# Интеграцията се зарежда само от /config/custom_components/<domain>: името на папката
# трябва да съвпада с `domain` в manifest.json, иначе Home Assistant я игнорира тихо.
function Assert-IntegrationLayout([string]$Dir) {
  $manifestPath = Join-Path $Dir 'manifest.json'
  if (-not (Test-Path $manifestPath)) { throw "Липсва $manifestPath" }
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.domain -ne 'hapi_enterprise') { throw "manifest.domain е '$($manifest.domain)', очаквах hapi_enterprise" }
  if ($manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw "manifest.version не е SemVer: $($manifest.version)" }
  foreach ($file in @('__init__.py', 'config_flow.py', 'sensor.py', 'strings.json')) {
    if (-not (Test-Path (Join-Path $Dir $file))) { throw "Липсва $file в $Dir" }
  }
  Write-Host "Integration OK: $Dir ($($manifest.domain) $($manifest.version))"
}

$srcConfig = Join-Path $Source 'config.yaml'
if (-not (Test-Path $srcConfig)) { throw "Липсва $srcConfig — това не е add-on папка" }
$version = (Select-String -Path $srcConfig -Pattern '^version:\s*"?([0-9.]+)"?' | Select-Object -First 1).Matches[0].Groups[1].Value

Write-Host "Източник: $Source (версия $version)"
Write-Host "Цел:      $Target"

if ($VerifyOnly) {
  Assert-AddonLayout $Target
  Assert-IntegrationLayout $IntegrationTarget
  return
}

if (-not (Test-Path $Target)) {
  if ($PSCmdlet.ShouldProcess($Target, 'създаване на папката')) {
    New-Item -ItemType Directory -Path $Target | Out-Null
  }
}

# Backup на текущата локална папка — извън /addons, за да не се появи втори add-on.
if ($Backup -and (Test-Path $Target)) {
  $backupDir = Join-Path ([IO.Path]::GetTempPath()) ('hapi-local-addon-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Write-Host "Backup:   $backupDir"
  if ($PSCmdlet.ShouldProcess($backupDir, 'backup на текущия локален add-on')) {
    Copy-Item -Path $Target -Destination $backupDir -Recurse -Force
  }
}

if ($WhatIfPreference) {
  Write-Host 'WhatIf: robocopy не се изпълнява.'
  return
}

# /MIR — папката в /addons е точно копие на add-on-а (без излишни стари файлове).
$roboArgs = @(
  "`"$Source`"", "`"$Target`"",
  '/MIR', '/R:2', '/W:1',
  '/XF', '*.tmp', '*.log',
  '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
)
$proc = Start-Process -FilePath 'robocopy.exe' -ArgumentList $roboArgs -NoNewWindow -Wait -PassThru
if ($proc.ExitCode -ge 8) { throw "robocopy се провали (код $($proc.ExitCode))" }

# Проверка: версия, задължителни модули и пълен COPY списък.
$dstConfig = Join-Path $Target 'config.yaml'
if (-not (Test-Path $dstConfig)) { throw "Синхронизацията не създаде $dstConfig" }
$dstVersion = (Select-String -Path $dstConfig -Pattern '^version:\s*"?([0-9.]+)"?' | Select-Object -First 1).Matches[0].Groups[1].Value
if ($dstVersion -ne $version) { throw "Версията в целта е $dstVersion, очаквах $version" }
foreach ($file in @('Dockerfile', 'server.js', 'start.js', 'observer.js', 'instance-lock.js', 'readiness.js')) {
  if (-not (Test-Path (Join-Path $Target $file))) { throw "Липсва $file в $Target" }
}
Assert-AddonLayout $Target
$count = (Get-ChildItem $Target -Recurse -File).Count
Write-Host "Готово: $dstVersion, $count файла в $Target"

# Локална интеграция: /config/custom_components/hapi_enterprise (HACS слага файловете на
# същото място, затова след локална синхронизация HACS може да я показва като неуправлявана).
$integrationSource = Join-Path (Split-Path -Parent $PSScriptRoot) 'custom_components\hapi_enterprise'
if ($IntegrationTarget -and (Test-Path $integrationSource)) {
  $r2 = Start-Process -FilePath 'robocopy.exe' -ArgumentList @(
    "`"$integrationSource`"", "`"$IntegrationTarget`"",
    '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'
  ) -NoNewWindow -Wait -PassThru
  if ($r2.ExitCode -ge 8) { throw "robocopy (интеграция) се провали (код $($r2.ExitCode))" }
  Assert-IntegrationLayout $IntegrationTarget
}
Write-Host ''
Write-Host 'В Home Assistant:'
Write-Host '  1) Settings → Add-ons → ⋮ → Check for updates (или Reload repositories)'
Write-Host '  2) „hAPI Enterprise“ трябва да е с версията по-горе (секция Local apps)'
Write-Host '  3) Rebuild/Инсталиране; при промени — Rebuild, за да се пре-билдне образът'
Write-Host '  4) Махни GitHub репото от ⋮ → Repositories, ако не искаш дубликат (той е 0.54.0)'
