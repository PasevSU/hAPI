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

$mapped = $false
try {
  Copy-Item $xpi $dest -Force -ErrorAction Stop
} catch {
  $mapped = $true
  Write-Host ''
  Write-Host 'Could not replace the installed .xpi: Thunderbird keeps it memory-mapped.' -ForegroundColor Yellow
  Write-Host 'Close Thunderbird completely and run this again.' -ForegroundColor Yellow
  Write-Host ('  reason: {0}' -f $_.Exception.Message) -ForegroundColor Yellow
}

if (-not $mapped) {
  $srcHash = (Get-FileHash $xpi -Algorithm SHA256).Hash.ToLower()
  $dstHash = (Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()
  if ($srcHash -ne $dstHash) { throw "installed file does not match the build ($srcHash vs $dstHash)" }
  Write-Host ('installed {0}' -f $dest)
  Write-Host ('sha256    {0}' -f $dstHash)
}

# Thunderbird keeps only the custom headers whose names are registered in
# mail.compose.other.header, and the message pane shows only the ones listed in
# mailnews.headers.extraExpandedHeaders. A profile written by an older build
# carries a shorter list, so both prefs are rebuilt from background.js here:
# a new header is otherwise computed, passed to the send, and dropped on the wire.
$bgPath = Join-Path $src 'background.js'
$bgText = [IO.File]::ReadAllText($bgPath)
$names = [regex]::Matches(
  $bgText, "buildHeader\(\s*['`"](X-PasevSU-[A-Za-z0-9-]+)['`"]"
) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
if ($names.Count -eq 0) { throw "no X-PasevSU- header names found in $bgPath" }

$userJs = Join-Path $Profile 'user.js'
$hadUserJs = Test-Path $userJs
$text = if ($hadUserJs) { [IO.File]::ReadAllText($userJs) } else { '' }
if ($hadUserJs) {
  Copy-Item $userJs (Join-Path $Profile 'user.js.psemp-before-install') -Force
}

function Set-PrefLine([string]$body, [string]$key, [string]$line) {
  $pattern = '(?m)^[ \t]*user_pref\("' + [regex]::Escape($key) + '",[^\r\n]*\);[ \t]*$'
  if ([regex]::IsMatch($body, $pattern)) { return [regex]::Replace($body, $pattern, $line) }
  return $body.TrimEnd() + "`n" + $line
}

$composeLine = 'user_pref("mail.compose.other.header", "' + ($names -join ',') + '");'
$expandedLine = 'user_pref("mailnews.headers.extraExpandedHeaders", "' + (($names | ForEach-Object { $_.ToLower() }) -join ' ') + '");'
$guardLines = @()
if ($text -notmatch 'extensions\.autoDisableScopes') {
  $guardLines += '// A profile side-load is registered disabled without this.'
  $guardLines += 'user_pref("extensions.autoDisableScopes", 0);'
}

$text = Set-PrefLine $text 'mail.compose.other.header' $composeLine
$text = Set-PrefLine $text 'mailnews.headers.extraExpandedHeaders' $expandedLine
if ($guardLines.Count -gt 0) { $text = $text.TrimEnd() + "`n" + ($guardLines -join "`n") }

$text = ($text -replace "`r`n", "`n") -replace "`r", "`n"
$text = $text.TrimEnd()
if (-not $text.EndsWith(';')) { $text += ';' }
[IO.File]::WriteAllText($userJs, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ('user.js   {0} header names registered, LF, no BOM' -f $names.Count)

Write-Host ''
if ($mapped) {
  Write-Host 'The prefs above are in place; only the .xpi swap is left.' -ForegroundColor Yellow
  Write-Host 'Close Thunderbird and run this script once more.' -ForegroundColor Yellow
  exit 2
}
Write-Host "Start Thunderbird, then open the add-on options page: it must say 'Armed'." -ForegroundColor Green
