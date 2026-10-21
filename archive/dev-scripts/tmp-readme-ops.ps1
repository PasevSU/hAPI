$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
$src = 'c:\Users\Pasev\AppData\Local\Temp\vscode-test\User\workspaceStorage\b36e8bcee4fc570c216aa2b99af504e3\GitHub.copilot-chat\transcripts\21708fe9-2617-4299-b1e7-90944e555b1d.jsonl'
$ops = New-Object System.Collections.Generic.List[object]
function Walk($o, [int]$depth) {
  if ($null -eq $o -or $depth -gt 30) { return }
  if ($o -is [string]) { return }
  if ($o -is [System.Collections.IEnumerable] -and $o -isnot [string]) { foreach ($i in $o) { Walk $i ($depth + 1) }; return }
  if ($o -is [System.Management.Automation.PSCustomObject]) {
    $names = $o.PSObject.Properties.Name
    if ($names -contains 'filePath') {
      $fp = [string]$o.filePath
      if ($fp -match '(?i)README\.md$') {
        $script:ops.Add([pscustomobject]@{
          file = $fp
          kind = if ($names -contains 'newString') { 'replace' } elseif ($names -contains 'content') { 'create' } else { 'other' }
          old  = if ($names -contains 'oldString') { [string]$o.oldString } else { '' }
          new  = if ($names -contains 'newString') { [string]$o.newString } elseif ($names -contains 'content') { [string]$o.content } else { '' }
        })
      }
    }
    foreach ($p in $o.PSObject.Properties) { Walk $p.Value ($depth + 1) }
  }
}
$n = 0
foreach ($line in [IO.File]::ReadAllLines($src)) {
  $n++
  if ($line.Length -lt 40) { continue }
  if ($line -notmatch 'README') { continue }
  try { $obj = $line | ConvertFrom-Json -Depth 60 } catch { continue }
  Walk $obj 0
}
"readme ops: $($ops.Count)"
$idx = 0
foreach ($op in $ops) {
  $idx++
  $o1 = ($op.old -replace "`r`n", '\n')
  $n1 = ($op.new -replace "`r`n", '\n')
  "--- #$idx [$($op.kind)] old=$($op.old.Length) new=$($op.new.Length)"
  "    OLD: " + $o1.Substring(0, [Math]::Min(110, $o1.Length))
  "    NEW: " + $n1.Substring(0, [Math]::Min(110, $n1.Length))
}
[IO.File]::WriteAllText("$env:TEMP\hapi-readme-ops.json", ($ops | ConvertTo-Json -Depth 4), $enc)
"written: $env:TEMP\hapi-readme-ops.json"
