<#
.SYNOPSIS
  Build the PasevSU MailExtension into an .xpi and install it into the Thunderbird profile.

.DESCRIPTION
  Thunderbird memory-maps an installed .xpi, so it cannot be replaced while it runs:
  Windows answers "the requested operation cannot be performed on a file with a
  user-mapped section open". The extension is therefore only swapped when
  Thunderbird is closed, and Thunderbird must be restarted to load the new build.

  Run this with Thunderbird CLOSED.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File thunderbird-extension\tools\install.ps1
#>
[CmdletBinding()]
param(
  [string]$Profile,
  [switch]$BuildOnly
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$src = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $src 'manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$id = $manifest.browser_specific_settings.gecko.id
$version = $manifest.version
$files = @('manifest.json', 'background.js', 'options.html', 'options.js')

foreach ($f in $files) {
  if (-not (Test-Path (Join-Path $src $f))) { throw "missing $f in $src" }
}

# Package: the four files at the archive root, byte-for-byte (no rewriting).
$xpi = Join-Path ([System.IO.Path]::GetTempPath()) "$id-$version.xpi"
if (Test-Path $xpi) { Remove-Item $xpi -Force }
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('psemp-stage-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $stage $f) }
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $xpi, [System.IO.Compression.CompressionLevel]::Optimal, $false)
} finally {
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
Write-Host ('built  {0} ({1} bytes, {2} files, version {3})' -f $xpi, (Get-Item $xpi).Length, $files.Count, $version)

if ($BuildOnly) { return }

if (-not $Profile) {
  $profilesRoot = Join-Path $env:APPDATA 'Thunderbird\Profiles'
  $candidates = @(Get-ChildItem $profilesRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '*.default-esr' -or $_.Name -like '*.default' })
  if ($candidates.Count -eq 0) { throw "no Thunderbird profile found under $profilesRoot" }
  if ($candidates.Count -gt 1) {
    $default = ''
    $ini = Join-Path $env:APPDATA 'Thunderbird\profiles.ini'
    if (Test-Path $ini) {
      $m = Select-String -Path $ini -Pattern '^Default=(.+)$' | Select-Object -First 1
      if ($m) { $default = $m.Matches.Groups[1].Value.Trim() }
    }
    $picked = $candidates | Where-Object { $default -and $default.EndsWith($_.Name) } | Select-Object -First 1
    if (-not $picked) { $picked = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1 }
    $Profile = $picked.FullName
  } else {
    $Profile = $candidates[0].FullName
  }
}

$extDir = Join-Path $Profile 'extensions'
if (-not (Test-Path $extDir)) { New-Item -ItemType Directory -Path $extDir | Out-Null }
$dest = Join-Path $extDir "$id.xpi"

if (Get-Process thunderbird -ErrorAction SilentlyContinue) {
  Write-Host ''
  Write-Host 'Thunderbird is running. An installed .xpi is memory-mapped and cannot be' -ForegroundColor Yellow
  Write-Host 'replaced while it runs. Close Thunderbird completely and run this again.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host "  built for later: $xpi"
  exit 2
}

try {
  Copy-Item $xpi $dest -Force
} catch {
  throw "could not write $dest - is Thunderbird really closed? ($($_.Exception.Message))"
}

$srcHash = (Get-FileHash $xpi -Algorithm SHA256).Hash.ToLower()
$dstHash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
if ($srcHash -ne $dstHash) { throw "installed file does not match the build ($srcHash vs $dstHash)" }

Write-Host ('installed {0}' -f $dest)
Write-Host ('sha256    {0}' -f $dstHash)

$userJs = Join-Path $Profile 'user.js'
$present = if (Test-Path $userJs) { Get-Content $userJs -Raw } else { '' }
if ($present -notmatch 'extensions\.autoDisableScopes') {
  Write-Host ''
  Write-Host "WARNING: $userJs does not set extensions.autoDisableScopes." -ForegroundColor Yellow
  Write-Host 'A profile side-load is registered disabled without it. Append the shipped' -ForegroundColor Yellow
  Write-Host 'thunderbird-extension/user.js to the profile copy (append, never replace).' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "Start Thunderbird, then open the add-on options page: it must say 'Armed'." -ForegroundColor Green
