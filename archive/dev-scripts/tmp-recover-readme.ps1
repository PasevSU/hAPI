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

# Кандидати за пълен README (съдържат заглавието и секцията „The idea“).
$cands = @{}
$i = 0
foreach ($s in $strings) {
  $i++
  if (-not $s.Contains('hAPI Enterprise — Home Assistant add-on')) { continue }
  if (-not $s.Contains('## The idea')) { continue }
  if ($s.Length -lt 4000) { continue }
  $badge = ([regex]::Match($s, 'badge/version-([0-9.]+)-')).Groups[1].Value
  $hasLocal = $s.Contains('Local add-on and integration')
  $key = "$badge|$hasLocal|$($s.Length)"
  if (-not $cands.ContainsKey($key)) { $cands[$key] = $s }
}
"candidates: $($cands.Count)"
foreach ($k in ($cands.Keys | Sort-Object)) {
  $s = $cands[$k]
  $head = $s.Substring(0, [Math]::Min(80, $s.Length)).Replace("`n", ' \n ')
  "  $k  first80=$head"
}
# Записваме най-добрия кандидат: най-нова версия и без локалната секция (за да я добавим наново).
$best = $null
foreach ($k in $cands.Keys) {
  $parts = $k.Split('|')
  $ver = $parts[0]; $len = [int]$parts[2]
  if ($ver -eq '0.61.0' -and $parts[1] -eq 'False') {
    if (-not $best -or $cands[$k].Length -gt $best.Length) { $best = $cands[$k] }
  }
}
if ($best) {
  [IO.File]::WriteAllText("$env:TEMP\hapi-readme-0610.md", $best, $enc)
  "written base README 0.61.0: $($best.Length) chars"
} else {
  'no 0.61.0 README snapshot found'
}
