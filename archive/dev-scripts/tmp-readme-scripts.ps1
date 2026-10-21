$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
$src = 'c:\Users\Pasev\AppData\Local\Temp\vscode-test\User\workspaceStorage\b36e8bcee4fc570c216aa2b99af504e3\GitHub.copilot-chat\transcripts\21708fe9-2617-4299-b1e7-90944e555b1d.jsonl'
$strings = New-Object System.Collections.Generic.List[string]
function Walk($o, [int]$depth) {
  if ($null -eq $o -or $depth -gt 30) { return }
  if ($o -is [string]) { $script:strings.Add($o); return }
  if ($o -is [System.Collections.IEnumerable] -and $o -isnot [string]) { foreach ($i in $o) { Walk $i ($depth + 1) }; return }
  if ($o -is [System.Management.Automation.PSCustomObject]) { foreach ($p in $o.PSObject.Properties) { Walk $p.Value ($depth + 1) } }
}
foreach ($line in [IO.File]::ReadAllLines($src)) {
  if ($line.Length -lt 40) { continue }
  try { $obj = $line | ConvertFrom-Json -Depth 60 } catch { continue }
  Walk $obj 0
}

# PS скриптове, които пачват README.md (here-string модели).
$scripts = @()
$seen = @{}
foreach ($s in $strings) {
  if (-not $s.Contains("README.md' @'")) { continue }
  $h = ($s.Length.ToString() + ':' + ($s.GetHashCode()))
  if ($seen.ContainsKey($h)) { continue }
  $seen[$h] = 1
  $scripts += $s
}
"patch scripts touching README: $($scripts.Count)"
$i = 0
foreach ($s in $scripts) {
  $i++
  "=== script #$i  ($($s.Length) chars)"
  # Покажи само редовете с версия/бадж, за да преценим обхвата.
  ($s -split "`n") | Where-Object { $_ -match 'version-|## |README|Patch ' } | Select-Object -First 12 | ForEach-Object { '    ' + $_.Substring(0, [Math]::Min(140, $_.Length)) }
}
[IO.File]::WriteAllText("$env:TEMP\hapi-readme-scripts.txt", ($scripts -join "`n`n##########`n`n"), $enc)
"written: $env:TEMP\hapi-readme-scripts.txt"
