$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
$src = 'c:\Users\Pasev\AppData\Local\Temp\vscode-test\User\workspaceStorage\b36e8bcee4fc570c216aa2b99af504e3\GitHub.copilot-chat\transcripts\21708fe9-2617-4299-b1e7-90944e555b1d.jsonl'
$strings = New-Object System.Collections.Generic.List[string]

function Walk($o, [int]$depth) {
  if ($null -eq $o -or $depth -gt 30) { return }
  if ($o -is [string]) { $script:strings.Add($o); return }
  if ($o -is [System.Collections.IEnumerable] -and $o -isnot [string]) {
    foreach ($i in $o) { Walk $i ($depth + 1) }
    return
  }
  if ($o -is [System.Management.Automation.PSCustomObject]) {
    foreach ($p in $o.PSObject.Properties) { Walk $p.Value ($depth + 1) }
  }
}

$lines = [IO.File]::ReadAllLines($src)
"lines: $($lines.Count)"
foreach ($line in $lines) {
  if ($line.Length -lt 40) { continue }
  if ($line -notmatch '0\.5[5-9]\.0|0\.6[01]\.0') { continue }
  try { $obj = $line | ConvertFrom-Json -Depth 60 } catch { continue }
  Walk $obj 0
}
"collected strings: $($strings.Count)"

# Секции от CHANGELOG: от '## 0.5x.0 —' до следващия '## ' (най-дългата версия печели).
$sections = @{}
foreach ($s in $strings) {
  if (-not $s.Contains('## 0.5') -and -not $s.Contains('## 0.6')) { continue }
  foreach ($m in [regex]::Matches($s, '(?ms)^## (0\.\d+\.\d+ — 2026-10-\d+)\n.*?(?=^## |\z)')) {
    $key = $m.Groups[1].Value
    $body = $m.Value
    if (-not $sections.ContainsKey($key) -or $sections[$key].Length -lt $body.Length) { $sections[$key] = $body }
  }
}
"changelog sections: $($sections.Count)"
$sections.Keys | Sort-Object -Descending | ForEach-Object { "  $_  ($($sections[$_].Length) chars)" }

$dump = ($sections.Keys | Sort-Object -Descending | ForEach-Object { $sections[$_] }) -join "`n"
[IO.File]::WriteAllText("$env:TEMP\hapi-changelog-restore.md", $dump, $enc)
"written: $env:TEMP\hapi-changelog-restore.md ($($dump.Length) chars)"
