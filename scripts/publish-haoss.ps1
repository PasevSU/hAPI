<#
.SYNOPSIS
    Публикува HACS хранилището (release/haoss) в GitHub — стъпка по стъпка, с dry run по подразбиране.

.DESCRIPTION
    Без -Execute скриптът само показва какво би направил (нищо не се качва).
    С -Execute: строи изданието, прави git хранилище, създава/използва GitHub repo,
    задава описание и topics, push-ва main и вдига таг v<версия>, от който
    workflow-ът `release.yml` създава GitHub release.

    Никога не прави force push и не трие нищо от GitHub.

.EXAMPLE
    pwsh -NoProfile -File scripts/publish-haoss.ps1
    Dry run — показва командите.

.EXAMPLE
    pwsh -NoProfile -File scripts/publish-haoss.ps1 -Execute
    Реално публикуване.
#>
[CmdletBinding()]
param(
    [string]$RepoName = 'hapi-enterprise-integration',
    [string]$Description = 'Home Assistant integration for hAPI Enterprise — document vault with verifiable integrity',
    [string[]]$Topics = @('home-assistant', 'hacs', 'integration'),
    [string]$Version,
    [switch]$SkipBuild,
    [switch]$InPlace,
    [switch]$ForcePrivate,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$repoDir = Join-Path $root 'release/haoss'
$mode = if ($Execute) { 'ПУБЛИКУВАНЕ' } else { 'DRY RUN (нищо не се качва)' }

function Write-Step {
    param([string]$Text)
    Write-Host ''
    Write-Host "▸ $Text" -ForegroundColor Cyan
}

function Invoke-Command-Step {
    param([string]$Text, [string]$Exe, [string[]]$Arguments = @(), [string]$WorkDir = $root)
    Write-Host "  $ $Exe $($Arguments -join ' ')"
    if (-not $Execute) { return $null }
    Push-Location $WorkDir
    try {
        # argv, не низ: описание/име на репо с кавички или `;` остава литерал,
        # вместо да се изпълни като втора команда (Invoke-Expression правеше точно това).
        $output = & $Exe @Arguments 2>&1
        if ($LASTEXITCODE -ne 0) { throw "командата се провали ($LASTEXITCODE): $Exe $($Arguments -join ' ')`n$output" }
        return $output
    }
    finally { Pop-Location }
}

Write-Host ''
Write-Host "════════ Публикуване на HACS хранилището — $mode ════════" -ForegroundColor Yellow

# ── 0. Версия и собственик ──────────────────────────────────────────────────
if (-not $Version) {
    $configPath = Join-Path $root 'hapi_enterprise/config.yaml'
    $line = Select-String -Path $configPath -Pattern '^version:\s*"([^"]+)"' | Select-Object -First 1
    if (-not $line) { throw "не намирам version в $configPath" }
    $Version = $line.Matches[0].Groups[1].Value
}
$tag = "v$Version"

# Git върху мрежов диск (H: = SMB) виси дори на `git rev-parse` — затова по подразбиране
# публикуваме от локално копие във %TEMP%. С -InPlace работим направо в release/haoss.
$gitDir = if ($InPlace) { $repoDir } else { Join-Path $env:TEMP "haoss-publish-$Version" }

$owner = try { (gh api user --jq .login 2>$null).Trim() } catch { '' }
if (-not $owner) { $owner = '<owner>' }
$fullName = "$owner/$RepoName"
$repoUrl = "https://github.com/$fullName"

Write-Host "  версия: $Version   таг: $tag"
Write-Host "  хранилище: $fullName"
Write-Host "  локална папка: $repoDir"
if (-not $InPlace) { Write-Host "  git работна папка: $gitDir (локален диск)" }

if ($Execute) {
    Write-Step 'Проверка на GitHub автентикацията'
    Invoke-Command-Step -Text 'gh auth status' -Exe 'gh' -Arguments @('auth', 'status') | Out-Null
}

# ── 1. Издание ──────────────────────────────────────────────────────────────
Write-Step '1/5  Строене на изданието'
# При реално публикуване строим НАПРАВО в git папката (или в отделна временна), а не в
# `release/haoss`: манифестът носи адреса на ПУБЛИКУВАНОТО хранилище и ако пишехме там,
# дървото в работното копие щеше да се разминава с източника (хваща го `haoss-in-sync`).
$buildOut = if ($Execute -and -not $InPlace) { Join-Path $env:TEMP "haoss-build-$Version" } else { $repoDir }
if ($Execute -and -not $SkipBuild -and -not $InPlace) {
    if (Test-Path -LiteralPath $buildOut) { Remove-Item -LiteralPath $buildOut -Recurse -Force }
}
if ($SkipBuild) {
    Write-Host '  пропуснато (-SkipBuild)'
}
else {
    $buildArgs = @()
    if ($Execute) { $buildArgs += @('--repo-url', $repoUrl) }
    if ($Execute -and -not $InPlace) { $buildArgs += @('--out', $buildOut, '--no-versioned') }
    Invoke-Command-Step -Text 'build' -Exe 'node' -Arguments (@('scripts/build-haoss.cjs') + $buildArgs) | Out-Null
}
$sourceDir = if ($Execute -and -not $InPlace) { $buildOut } else { $repoDir }
if (-not (Test-Path (Join-Path $sourceDir 'hacs.json'))) {
    if ($Execute) { throw "липсва $sourceDir/hacs.json — изданието не е построено" }
}

# ── 2. Git хранилище ────────────────────────────────────────────────────────
Write-Step '2/5  Git хранилище'
# Ако хранилището вече е в GitHub, работим върху clone — така историята остава линейна
# и diff-ът е истински (без force push и без два независими корена на историята).
$repoProbe = gh repo view $fullName --json name 2>&1
$repoExists = ($LASTEXITCODE -eq 0)
Write-Host "  хранилището в GitHub съществува: $repoExists"

if (-not $InPlace) {
    if ($Execute) {
        if (Test-Path -LiteralPath $gitDir) { Remove-Item -LiteralPath $gitDir -Recurse -Force }
        if ($repoExists) {
            Write-Host "  $ git clone $repoUrl $gitDir"
            & cmd /c "git clone `"$repoUrl`" `"$gitDir`" 2>&1" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "git clone се провали" }
            # Махаме всичко освен .git, за да може build-ът да наложи точното съдържание.
            Get-ChildItem -LiteralPath $gitDir -Force |
            Where-Object { $_.Name -ne '.git' } |
            Remove-Item -Recurse -Force
        }
        else {
            New-Item -ItemType Directory -Path $gitDir -Force | Out-Null
        }
        Get-ChildItem -LiteralPath $sourceDir -Force |
        Where-Object { $_.Name -ne '.git' } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $gitDir -Recurse -Force }
        Write-Host ('  копирани файлове: ' + (Get-ChildItem -LiteralPath $gitDir -Recurse -File -Force).Count)
    }
}

$hasGit = Test-Path (Join-Path $gitDir '.git')
Write-Host "  .git съществува: $hasGit"
if (-not $hasGit) {
    Write-Host "  $ git init -b main"
    if ($Execute) {
        Push-Location $gitDir
        try {
            & cmd /c 'git init -b main 2>&1' | Out-Null
            $initCode = $LASTEXITCODE
        }
        finally { Pop-Location }
        if ($initCode -ne 0 -or -not (Test-Path (Join-Path $gitDir '.git/HEAD'))) {
            throw "git init не успя в $gitDir"
        }
    }
}
# Публичното репо не бива да носи личния имейл на разработчика. Задаваме локално
# noreply идентичност на собственика върху клонинга, от който публикуваме, и не пипаме
# глобалните настройки. Прави се ПРЕДИ commit-а, иначе авторът остава личният.
if ($Execute) {
    Push-Location $gitDir
    try {
        $email = git config user.email 2>$null
        $userName = git config user.name 2>$null
    }
    finally { Pop-Location }
    if ($email -ne "$owner@users.noreply.github.com" -or $userName -ne $owner) {
        if ($email) {
            Write-Host "  заменям локално идентичността $userName <$email> с $owner <$owner@users.noreply.github.com>"
        }
        else {
            Write-Host "  няма git идентичност — задавам локално $owner <$owner@users.noreply.github.com>"
        }
        Invoke-Command-Step -Text 'identity' -Exe 'git' -Arguments @('config', 'user.name', $owner) -WorkDir $gitDir | Out-Null
        Invoke-Command-Step -Text 'identity' -Exe 'git' -Arguments @('config', 'user.email', "$owner@users.noreply.github.com") -WorkDir $gitDir | Out-Null
    }
    else {
        Write-Host "  git идентичност: $userName <$email>"
    }
}
else {
    Write-Host '  git идентичност: локално се задава noreply на собственика (личният имейл не се публикува)'
}

Invoke-Command-Step -Text 'add' -Exe 'git' -Arguments @('add', '-A') -WorkDir $gitDir | Out-Null

# Празни commit-и не помагат на никого: при реално изпълнение проверяваме дали има промени.
# `git rev-parse HEAD` пада при първи commit — това е „мръсно“ по определение.
if ($Execute) {
    Push-Location $gitDir
    try {
        git rev-parse --verify HEAD 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            git diff --cached --quiet
            $dirty = ($LASTEXITCODE -ne 0)
        }
        else { $dirty = $true }
    }
    finally { Pop-Location }
    if ($dirty) {
        Invoke-Command-Step -Text 'commit' -Exe 'git' -Arguments @('commit', '-m', "hAPI Enterprise $Version — HACS integration") -WorkDir $gitDir | Out-Null
    }
    else {
        Write-Host '  няма промени — без нов commit'
    }
}
else {
    Write-Host "  `$ git commit -m 'hAPI Enterprise $Version — HACS integration'   (само ако има промени)"
}

# ── 3. GitHub repo ──────────────────────────────────────────────────────────
Write-Step '3/5  GitHub хранилище'
if (-not $repoExists) {
    Write-Host "  създава се публично хранилище $fullName"
    Invoke-Command-Step -Text 'create' -Exe 'gh' -Arguments @('repo', 'create', $fullName, '--public', '--source', '.', '--remote', 'origin', '--push', '--description', $Description) -WorkDir $gitDir | Out-Null
}
else {
    # HACS приема САМО публични хранилища: `hacs/action` отказва private с
    # „… is private, the HACS action can only validate public repositories“.
    # Без тази проверка push-ът минава, а Validate пада чак след това.
    $visibilityRaw = gh repo view $fullName --json visibility --jq '.visibility' 2>$null
    $visibility = "$visibilityRaw".Trim().ToUpperInvariant()
    if ($visibility -and $visibility -ne 'PUBLIC') {
        Write-Host "  ! хранилището е $visibility — HACS приема само PUBLIC, затова Validate ще падне" -ForegroundColor Yellow
        Write-Host "  оправи го с: gh repo edit $fullName --visibility public --accept-visibility-change-consequences" -ForegroundColor Yellow
        if ($Execute -and -not $ForcePrivate) {
            throw "HACS хранилището е $visibility. Направи го публично (или подай -ForcePrivate, ако знаеш какво правиш)."
        }
    }
    Write-Host "  хранилището съществува — push към origin (без force)"
    Invoke-Command-Step -Text 'push' -Exe 'git' -Arguments @('push', 'origin', 'HEAD:main') -WorkDir $gitDir | Out-Null
}

# Метаданни, които HACS проверява за включване в списъка по подразбиране.
$topicArgs = @($Topics | ForEach-Object { '--add-topic'; $_ })
Invoke-Command-Step -Text 'meta' -Exe 'gh' -Arguments (@('repo', 'edit', $fullName, '--description', $Description) + $topicArgs + @('--enable-issues')) -WorkDir $gitDir | Out-Null

# ── 4. Таг → release ────────────────────────────────────────────────────────
Write-Step "4/5  Таг $tag"
# Таг се вдига само веднъж за дадена версия: ако вече сочи друг commit, не го местим
# (това е подмяна на издадено издание) — вместо това се вдига версията.
$remoteTagSha = $null
if ($Execute) {
    # 404 при липсващ таг също връща текст в stdout при някои версии на gh — затова
    # гледаме кода на изхода, а не само дали има стойност.
    $probe = gh api "repos/$fullName/git/ref/tags/$tag" --jq .object.sha 2>$null
    if ($LASTEXITCODE -eq 0 -and $probe) { $remoteTagSha = ("$probe").Trim() }
}
# В dry run git папката в %TEMP% още не съществува — не влизаме в нея.
$headSha = if ($Execute) { Push-Location $gitDir; try { (git rev-parse HEAD).Trim() } finally { Pop-Location } } else { '' }

if ($Execute -and $remoteTagSha) {
    if ($remoteTagSha -eq $headSha) {
        Write-Host "  тагът вече сочи този commit — нищо за правене"
    }
    else {
        Write-Host "  ВНИМАНИЕ: тагът $tag вече сочи друг commit — не го местя." -ForegroundColor Yellow
        Write-Host '  За ново издание вдигни версията (build-release.cjs --version X) и пусни отново.'
    }
}
else {
    Invoke-Command-Step -Text 'tag' -Exe 'git' -Arguments @('tag', '-f', $tag) -WorkDir $gitDir | Out-Null
    Invoke-Command-Step -Text 'tag push' -Exe 'git' -Arguments @('push', 'origin', $tag) -WorkDir $gitDir | Out-Null
}
Write-Host '  workflow-ът release.yml създава GitHub release (сверява тага с manifest.json)'

# ── 5. Проверка ─────────────────────────────────────────────────────────────
Write-Step '5/5  Проверка'
Invoke-Command-Step -Text 'release' -Exe 'gh' -Arguments @('release', 'list', '-R', $fullName, '-L', '3') | Out-Null

Write-Host ''
if ($Execute) {
    Write-Host "✓ Публикувано: $repoUrl" -ForegroundColor Green
    Write-Host '  HACS → Integrations → ⋮ → Custom repositories → добави адреса, категория Integration.'
    Write-Host '  Validate (hassfest + HACS action) трябва да е зелено преди PR към hacs/default.'
}
else {
    Write-Host '✓ Dry run приключи. За реално публикуване добави -Execute.' -ForegroundColor Green
    Write-Host '  Стъпките 2–5 не бяха изпълнени; стъпка 1 (build) също е само показана.'
}
