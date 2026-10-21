$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
$cur = [IO.File]::ReadAllText('README.md').Replace("`r`n", "`n")
$opsPath = "$env:TEMP\hapi-readme-ops.json"
$ops = Get-Content $opsPath -Raw | ConvertFrom-Json

"current README: $($cur.Length) chars, $((($cur -split "`n").Count)) lines"
$badge = ([regex]::Match($cur, 'badge/version-([0-9.]+)-')).Groups[1].Value
"current badge: $badge"
"has local section: $($cur.Contains('Local add-on and integration'))"
"has 118 scenario row: $($cur.Contains('118 scenario files'))"
"has 'armv6': $($cur.Contains('armv6'))"
''
$i = 0
foreach ($op in $ops) {
  $i++
  $n = ([string]$op.new).Replace("`r`n", "`n")
  if ($n.Length -eq 0) { continue }
  $present = $cur.Contains($n)
  $first = ($n -split "`n")[0]
  if ($first.Length -gt 90) { $first = $first.Substring(0, 90) }
  "{0,3}  {1,-8} {2}" -f $i, ($(if ($present) { 'PRESENT' } else { 'MISSING' })), $first
}
