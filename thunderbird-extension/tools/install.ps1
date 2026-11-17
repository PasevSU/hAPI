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
Add-Type -AssemblyName System.IO.Compression
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

# manifest.json uses __MSG_extName__ / __MSG_extDescription__ with default_locale,
# so the archive MUST carry the _locales tree. Without it the placeholders cannot be
# resolved, Thunderbird rejects the manifest and deletes the side-loaded .xpi on the
# next start (observed 2026-11-16: the add-on simply disappeared from extensions.json).
$locales = $null
if ($manifest.default_locale) {
  $locales = Join-Path $src '_locales'
  $defaultMessages = Join-Path $locales "$($manifest.default_locale)\messages.json"
  if (-not (Test-Path $defaultMessages)) {
    throw "manifest declares default_locale '$($manifest.default_locale)' but $defaultMessages is missing"
  }
}

# Package: the files at the archive root byte-for-byte (no rewriting), plus _locales.
$xpi = Join-Path ([System.IO.Path]::GetTempPath()) "$id-$version.xpi"
if (Test-Path $xpi) { Remove-Item $xpi -Force }
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('psemp-stage-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $stage $f) }
  if ($locales) { Copy-Item -Recurse -Force $locales (Join-Path $stage '_locales') }
  $packed = @(Get-ChildItem $stage -Recurse -File).Count
  # ZipFile.CreateFromDirectory writes Windows separators into nested entry names on
  # .NET Framework ("_locales\bg\messages.json"). Gecko cannot resolve that, so the
  # manifest's default_locale fails and Thunderbird silently deletes the add-on.
  # Entries are therefore written by hand with forward slashes.
  $archive = [System.IO.Compression.ZipFile]::Open($xpi, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem $stage -Recurse -File | ForEach-Object {
      $rel = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
      $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
      $out = $entry.Open()
      try {
        $in = [System.IO.File]::OpenRead($_.FullName)
        try { $in.CopyTo($out) } finally { $in.Dispose() }
      } finally { $out.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally {
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
Write-Host ('built  {0} ({1} bytes, {2} files, version {3})' -f $xpi, (Get-Item $xpi).Length, $packed, $version)

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

# Normalise BEFORE the edits below, not after. Set-PrefLine anchors on `;[ \t]*$`,
# and in multiline mode `$` matches before "\n" but not before "\r" — so on a CRLF
# file the pattern cannot match, and every pref it was asked to replace is instead
# appended as a second copy. Observed 2026-11-17: a CRLF user.js ended up with two
# `extensions.autoDisableScopes` lines, the first still 15.
$text = ($text -replace "`r`n", "`n") -replace "`r", "`n"

function Set-PrefLine([string]$body, [string]$key, [string]$line) {
  $pattern = '(?m)^[ \t]*user_pref\("' + [regex]::Escape($key) + '",[^\r\n]*\);[ \t]*$'
  if ([regex]::IsMatch($body, $pattern)) { return [regex]::Replace($body, $pattern, $line) }
  return $body.TrimEnd() + "`n" + $line
}

$composeLine = 'user_pref("mail.compose.other.header", "' + ($names -join ',') + '");'
$expandedLine = 'user_pref("mailnews.headers.extraExpandedHeaders", "' + (($names | ForEach-Object { $_.ToLower() }) -join ' ') + '");'
# These two decide whether the add-on is ARMED after a rebuild, so their values
# are enforced, not merely added:
#
#   extensions.autoDisableScopes = 0   Thunderbird's default registers an .xpi that
#       was hand-placed in <profile>\extensions\ with userDisabled: true, so the
#       add-on is installed and inert. Any non-zero mask re-disables it after every
#       rebuild, which breaks the standing requirement that the headers appear
#       without anyone touching the Add-ons Manager.
#   xpinstall.signatures.required = false   Thunderbird's factory value is already
#       false (greprefs.js), but a profile that copied a Firefox-style user.js can
#       carry `true`, and then the unsigned hand-built .xpi is refused outright.
#
# Set-PrefLine REPLACES an existing line, so a profile that says 15 (the value
# chosen for a "confirm every side-load" posture) is corrected here rather than
# left contradicting the build.
$text = Set-PrefLine $text 'mail.compose.other.header' $composeLine
$text = Set-PrefLine $text 'mailnews.headers.extraExpandedHeaders' $expandedLine
$text = Set-PrefLine $text 'extensions.autoDisableScopes' 'user_pref("extensions.autoDisableScopes", 0);'
$text = Set-PrefLine $text 'xpinstall.signatures.required' 'user_pref("xpinstall.signatures.required", false);'

# A duplicate key is not harmless: user.js is applied in file order and the LAST
# assignment wins, so a stale `autoDisableScopes = 15` earlier in the file would
# still look "fixed" while the file carries the old value too. Set-PrefLine uses
# [regex]::Replace, which rewrites every match instead of collapsing them, so the
# duplicates are removed here by keeping only the last line per key.
$lines = $text -split "`n"
$lastIndexOf = @{}
for ($i = 0; $i -lt $lines.Count; $i += 1) {
  if ($lines[$i] -match '^[ \t]*user_pref\("([^"]+)",') { $lastIndexOf[$matches[1]] = $i }
}
$kept = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $lines.Count; $i += 1) {
  if ($lines[$i] -match '^[ \t]*user_pref\("([^"]+)",' -and $lastIndexOf[$matches[1]] -ne $i) { continue }
  $kept.Add($lines[$i])
}
$text = ($kept -join "`n")

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
