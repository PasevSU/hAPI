# ОДИТ НА /config/secrets.yaml — БЕЗ ДА ПЕЧАТА СТОЙНОСТИ.
#
# Защо: в реалната инсталация се намериха два проблема наведнъж — `secrets.yaml` държеше
# жив GitHub токен (`ghp_…`) и HA long-lived token, който същевременно се ползваше като
# admin токен на hAPI. Първото е изтекъл ключ, второто е прекалено широк достъп: който има
# hAPI токена, може да вика целия Home Assistant API.
#
# Скриптът САМО чете: сваля `secrets.yaml` и проверява кой `!secret <име>` се ползва къде.
# Отпечатва ИМЕНА, форма и дължина — никога стойности, защото изходът отива в лог/чат.
#
#   pwsh -File scripts/audit-ha-secrets.ps1 -HaHost 192.168.50.4
#   pwsh -File scripts/audit-ha-secrets.ps1 -HaHost 192.168.50.4 -Gate   # exit 1 при изтекъл ключ
param(
    [Parameter(Mandatory = $true)][string]$HaHost,
    [string]$HaUser = 'root',
    [string]$ConfigDir = '/config',
    [switch]$Gate
)

$ErrorActionPreference = 'Stop'

function Get-RemoteText([string]$command, [switch]$AllowEmpty) {
    # grep връща 1, когато НЯМА съвпадение — това не е грешка за одита.
    $out = & ssh -o BatchMode=yes -o ConnectTimeout=15 "$HaUser@$HaHost" $command 2>&1
    if ($LASTEXITCODE -ne 0 -and -not $AllowEmpty) { throw "отдалечената команда се провали: $command" }
    return ($out -join "`n")
}

# Формата се разпознава по префикс/структура — без да гледаме стойността нататък.
function Get-SecretShape([string]$value) {
    $v = $value.Trim().Trim('"').Trim("'")
    if ($v -match '^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') { return 'HA long-lived token (JWT)' }
    if ($v -match '^ghp_[A-Za-z0-9]{20,}$') { return 'GitHub personal access token' }
    if ($v -match '^github_pat_') { return 'GitHub fine-grained token' }
    if ($v -match '^gh[pousr]_') { return 'GitHub token' }
    if ($v -match '^AKIA[0-9A-Z]{16}$') { return 'AWS access key' }
    if ($v -match '^sk-[A-Za-z0-9]{20,}$') { return 'API key (sk-…)' }
    if ($v -match '^xox[baprs]-') { return 'Slack token' }
    if ($v -match '-----BEGIN [A-Z ]*PRIVATE KEY-----') { return 'частен ключ' }
    if ($v.Length -ge 32 -and $v -match '^[A-Za-z0-9+/=_%.\-]+$') { return 'случаен низ (добре)' }
    if ($v.Length -eq 0) { return 'празно' }
    return 'обикновена стойност'
}

Write-Host "Одит на $HaHost`:$ConfigDir/secrets.yaml (стойности НЕ се показват)"

$secretsRaw = Get-RemoteText "cat $ConfigDir/secrets.yaml"
$entries = @()
foreach ($line in ($secretsRaw -split "`n")) {
    if ($line -match '^([A-Za-z0-9_\.\-]+):\s*(.*)$') {
        $name = $matches[1]
        $rest = $matches[2].Trim()
        # Многоредов блок (частен ключ) се маркира по първия ред, без да се чете нататък.
        $entries += [pscustomobject]@{ Name = $name; Shape = (Get-SecretShape $rest); Length = ($rest.Trim('"').Trim("'")).Length }
    }
}

if (-not $entries.Count) { Write-Host 'Няма прочетени ключове — провери пътя.'; exit 1 }

# Кой `!secret <име>` се среща ЖИВО в конфигурацията (име на файл, не стойност).
# На HA `grep` е BusyBox: НЯМА `--include`, а `find … -exec` с екранирана точка и запетая се
# чупи през ssh. Затова — цикъл по файловете, който работи и в двата свята.
$refsCommand = "for f in $ConfigDir/*.yaml; do grep -Hn secret `"`$f`"; done 2>/dev/null | grep -v 'secrets.yaml:' || true"
$refs = Get-RemoteText $refsCommand -AllowEmpty
$refMap = @{}
foreach ($line in ($refs -split "`n")) {
    if ($line -notmatch '^([^:]+):\d+:(.*)$') { continue }
    $file = Split-Path $matches[1] -Leaf
    $body = $matches[2]
    # Закоментираните редове НЕ са употреба — така се появяваха десетки фалшиви „ползва се“.
    if ($body -match '^\s*#') { continue }
    if ($body -notmatch '!secret\s+([A-Za-z0-9_\.\-]+)') { continue }
    $key = $matches[1]
    if (-not $refMap.ContainsKey($key)) { $refMap[$key] = @() }
    if ($refMap[$key] -notcontains $file) { $refMap[$key] += $file }
}

$rows = foreach ($e in $entries) {
    $used = if ($refMap.ContainsKey($e.Name)) { ($refMap[$e.Name] -join ', ') } else { '— (не се ползва)' }
    [pscustomobject]@{ Key = $e.Name; Shape = $e.Shape; Length = $e.Length; UsedIn = $used }
}

$rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

$dangerous = $rows | Where-Object { $_.Shape -match 'token|ключ|AWS|API key|Slack' }
$unused = $rows | Where-Object { $_.UsedIn -like '*не се ползва*' }
$unusedDangerous = $dangerous | Where-Object { $_.UsedIn -like '*не се ползва*' }

Write-Host ("Ключове: {0} · чувствителни: {1} · непотребявани: {2}" -f $rows.Count, $dangerous.Count, $unused.Count)
if ($unusedDangerous.Count) {
    Write-Host 'Изтекли ключове, които вече НИКОЙ не ползва — махни ги и ги ОТЗОВИ при доставчика:'
    foreach ($row in $unusedDangerous) { Write-Host ("  · {0} ({1})" -f $row.Key, $row.Shape) }
    Write-Host '  GitHub токени: https://github.com/settings/tokens'
}
if ($dangerous | Where-Object { $_.Shape -eq 'HA long-lived token (JWT)' }) {
    Write-Host 'Внимание: HA long-lived token в secrets.yaml. Ако същата стойност е и admin токенът на'
    Write-Host 'add-on, всеки клиент на hAPI може да вика целия Home Assistant API — сложи отделен'
    Write-Host 'произволен низ в Настройки → Add-ons → hAPI Enterprise → Конфигурация → token.'
}

if ($Gate -and $unusedDangerous.Count) { exit 1 }
exit 0
