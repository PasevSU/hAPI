<#
.SYNOPSIS
    Публикува add-on хранилището (PasevSU/hAPI) от локалното дърво — dry run по подразбиране.

.DESCRIPTION
    Add-on хранилището се разпознава от Home Assistant по `repository.yaml` + `<addon>/config.yaml`.
    Git върху `H:` (SMB) блокира дори на `git rev-parse`, затова скриптът работи така:
    клонира хранилището във `%TEMP%`, огледално копира локалното дърво върху клона
    (robocopy /MIR, без .git/.venv/node_modules/release/dist) и push-ва.
    Така GitHub получава точно това, което е на диска, с истински diff — без force push.

    Без -Execute само показва какво би направил.

.EXAMPLE
    pwsh -NoProfile -File scripts/publish-addon-repo.ps1
    Dry run.

.EXAMPLE
    pwsh -NoProfile -File scripts/publish-addon-repo.ps1 -Execute
    Реално публикуване.
#>
[CmdletBinding()]
param(
    [string]$Repo = 'PasevSU/hAPI',
    [string]$Branch = 'main',
    [switch]$SkipBuild,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repoUrl = "https://github.com/$Repo"
$mode = if ($Execute) { 'ПУБЛИКУВАНЕ' } else { 'DRY RUN (нищо не се качва)' }

# Копираме само това, което Git би проследил: без кешове, среди и артефакти.
$excludeDirs = @('.git', '.venv', 'node_modules', 'release', 'dist', '__pycache__', '.pytest_cache', 'coverage', 'PGP_CryptoSAK_keys-*')
$excludeFiles = @('*.pyc', '*.log', '*.7z', '*.zip', '*.tar.gz', 'private.asc', '*.pem', '*.pfx', 'id_rsa*')
# Изключванията се прилагат от scripts/export-tracked.cjs (.gitignore + правила за тайни),
# не от robocopy; списъците остават за справка и за пълен пропуск към стария режим.

$version = (Select-String -Path (Join-Path $root 'hapi_enterprise/config.yaml') -Pattern '^version:\s*"([^"]+)"' |
    Select-Object -First 1).Matches[0].Groups[1].Value
$workDir = Join-Path $env:TEMP "hapi-addon-repo-$version"

Write-Host ''
Write-Host "════════ Публикуване на add-on хранилището — $mode ════════" -ForegroundColor Yellow
Write-Host "  версия: $version"
Write-Host "  хранилище: $repo"
Write-Host "  локално дърво: $root"
Write-Host "  работна папка: $workDir"

# ── 1. Издателски артефакти ─────────────────────────────────────────────────
Write-Host ''
Write-Host '▸ 1/4  Издателски артефакти' -ForegroundColor Cyan
# Одитът върви ВИНАГИ, дори с -SkipBuild: той проверява какво реално би влязло в git.
Write-Host '  $ node scripts/pre-push-audit.cjs'
if ($Execute) {
    & node scripts/pre-push-audit.cjs 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) { throw 'pre-push-audit не мина (тайни/подозрителни имена/едри файлове) — спирам преди публикуване' }
}
if ($SkipBuild) {
    Write-Host '  пропуснато (-SkipBuild)'
}
else {
    Write-Host '  $ node scripts/verify-release.cjs'
    if ($Execute) {
        & node scripts/verify-release.cjs 2>&1 | Select-Object -Last 2 | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) { throw 'verify-release не мина — спирам преди публикуване' }
    }
}

# ── 2. Клон ─────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host "▸ 2/4  Клон на $Repo" -ForegroundColor Cyan
Write-Host "  `$ git clone $repoUrl $workDir"
if ($Execute) {
    if (Test-Path -LiteralPath $workDir) { Remove-Item -LiteralPath $workDir -Recurse -Force }
    & cmd /c "git clone --depth 1 --branch $Branch `"$repoUrl`" `"$workDir`" 2>&1" | Select-Object -Last 2
    if ($LASTEXITCODE -ne 0) { throw 'git clone се провали' }
}

# ── 3. Експорт на файловете, които биха влезли в git ────────────────────────
Write-Host ''
Write-Host '▸ 3/4  Експорт на проследяваното дърво (спазва .gitignore)' -ForegroundColor Cyan
# robocopy /MIR копираше и файлове, които никога не бива да напускат диска (така веднъж
# изтекоха частни PGP ключове). export-tracked обхожда спазвайки .gitignore и отказва
# подозрителни имена и файлове с тайни.
Write-Host "  $ node scripts/export-tracked.cjs --to $workDir --clean"
if ($Execute) {
    & node scripts/export-tracked.cjs --to $workDir --clean
    if ($LASTEXITCODE -ne 0) { throw "export-tracked отказа ($LASTEXITCODE) — виж списъка по-горе" }
    $touched = (git -C $workDir status --porcelain | Measure-Object -Line).Lines
    Write-Host "  променени файлове: $touched (git решава след 'git add' дали има реална промяна)"
}

# ── 4. Commit и push ────────────────────────────────────────────────────────
Write-Host ''
Write-Host '▸ 4/4  Commit и push' -ForegroundColor Cyan
Write-Host "  `$ git add -A; git commit -m 'hAPI Enterprise $version'; git push origin HEAD:$Branch"
if ($Execute) {
    git -C $workDir add -A
    $dirty = (git -C $workDir status --porcelain | Measure-Object -Line).Lines -gt 0
    if ($dirty) {
        git -C $workDir commit -m "hAPI Enterprise $version" | Select-Object -Last 2 | ForEach-Object { Write-Host "  $_" }
        git -C $workDir push origin "HEAD:$Branch" 2>&1 | Select-Object -Last 3 | ForEach-Object { Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) { throw 'git push се провали' }
    }
    else {
        Write-Host '  няма промени — нищо за качване'
    }
}

Write-Host ''
if ($Execute) {
    Write-Host "✓ Публикувано: $repoUrl" -ForegroundColor Green
    Write-Host '  В Home Assistant: Settings → Add-ons → Repositories → добави'
    Write-Host "  $repoUrl   (после Check for updates / Rebuild)"
}
else {
    Write-Host '✓ Dry run приключи. За реално публикуване добави -Execute.' -ForegroundColor Green
}
