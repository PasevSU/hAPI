#requires -Version 7.0
<#
.SYNOPSIS
    Обновява съдържанието на GitHub хранилището от работното копие — интерактивно, с dry run по подразбиране.

.DESCRIPTION
    Качва това, което реално би влязло в git (през `scripts/export-tracked.cjs`, който спазва
    `.gitignore` и отказва тайни), в избраното хранилище. Устроен е на слоеве и пита на всяка
    крачка, вместо да реши сам:

      0. Среда      — PowerShell 7, git, node, gh, автентикация, достъп и права.
      0б. Хранилище — в кое хранилище и в кой клон.
      1. Обхват     — какво влиза (експорт по .gitignore) + одит преди качване (тайни, едри файлове).
      2. Клон       — работим върху локално копие във %TEMP%, защото `git` на мрежов диск (H:) виси.
      3. Разлики    — нови/променени/изтрити, с избор какво да се направи с изтритите.
      4. Съобщение  — предложено, от CHANGELOG, от файл, ръчно или в Notepad.
      5. Преглед    — какво точно ще се качи и потвърждение чрез изписване на клона.
      6. Пуш        — add/commit/push с повторни опити; при „rejected“ предлага rebase и повторен опит.
      7. Проверка   — последният commit в GitHub, URL, отваряне.

    Скриптът НИКОГА не прави force push и не трие нищо от GitHub. Без -Execute не пише в GitHub.

.PARAMETER Repo
    Хранилище (owner/name). По подразбиране PasevSU/hAPI. При интерактивен режим се пита.

.PARAMETER Branch
    Клон, в който се качва (по подразбиране main).

.PARAMETER Message
    Съобщение на commit-а. Ако липсва, скриптът предлага такова.

.PARAMETER Execute
    Реално качване. Без него — само проверки, разлики и показване на командата.

.PARAMETER Yes
    Неинтерактивен режим: приема безопасните подразбирания. Изтриване на файлове от хранилището
    остава изключено, освен ако не е разрешено изрично с -AllowDelete.

.PARAMETER AllowDelete
    Позволява на неинтерактивния режим да изтрива от хранилището файлове, които вече не съществуват.

.PARAMETER Reuse
    Преизползва вече клонираното копие във %TEMP%, вместо да го клонира наново.

.PARAMETER Retries
    Колко пъти да се повтори провалена git/gh команда, преди да попита (по подразбиране 3).

.PARAMETER LogFile
    Път до лог файл. По подразбиране — временен файл, който се показва накрая.

.EXAMPLE
    pwsh -File scripts/update-repo.ps1
    Интерактивно: избираш хранилище и клон, виждаш разликите, потвърждаваш (dry run).

.EXAMPLE
    pwsh -File scripts/update-repo.ps1 -Execute
    Качва промените в main след потвърждение.

.EXAMPLE
    pwsh -File scripts/update-repo.ps1 -Message "Описание на промяната" -Yes -Execute
    Неинтерактивно качване с готово съобщение.
#>
[CmdletBinding()]
param(
    [string]$Repo = 'PasevSU/hAPI',
    [string]$Branch = 'main',
    [string]$Message,
    [switch]$Execute,
    [switch]$Yes,
    [switch]$AllowDelete,
    [switch]$Reuse,
    [int]$Retries = 3,
    [string]$LogFile
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$Changelog = Join-Path $Root 'CHANGELOG.md'

$script:NonInteractive = [bool]$Yes
$script:RetryLimit = [Math]::Max(1, $Retries)
$script:LogPath = $null
$script:Repo = $Repo
$script:Branch = $Branch
$script:Message = $Message
$script:WorkDir = $null
$script:ExportDir = $null
$script:GhReady = $false
$script:GitReady = $false
# Git стартира от локален диск: на мрежов диск (H:) дори `git config --global` виси.
$script:GitCwd = $env:TEMP
$script:Added = @()
$script:Modified = @()
$script:Deleted = @()
$script:DeleteApproved = $false
$script:MessageOrigin = ''

# ── Изход и лог ────────────────────────────────────────────────────────────
function Write-Step([string]$Text) {
    Write-Host "`n▸ $Text" -ForegroundColor Cyan
    Write-Log "== $Text"
}
function Write-Ok([string]$Text) {
    Write-Host "  ✔ $Text" -ForegroundColor Green
    Write-Log "OK  $Text"
}
function Write-Warn2([string]$Text) {
    Write-Host "  ! $Text" -ForegroundColor Yellow
    Write-Log "WARN $Text"
}
function Write-Info([string]$Text) {
    Write-Host "  · $Text" -ForegroundColor DarkGray
    Write-Log "    $Text"
}
function Write-Log([string]$Text) {
    if (-not $script:LogPath) { return }
    try { Add-Content -LiteralPath $script:LogPath -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Text) -Encoding utf8 }
    catch { $script:LogPath = $null }
}
function Stop-WithError([string]$Text) {
    Write-Host "`n✗ $Text" -ForegroundColor Red
    Write-Log "FATAL $Text"
    if ($script:LogPath) { Write-Host "  лог: $script:LogPath" -ForegroundColor DarkGray }
    exit 1
}
function Stop-Gracefully([string]$Text) {
    Write-Host "`n▸ $Text" -ForegroundColor DarkYellow
    Write-Log "STOP $Text"
    if ($script:LogPath) { Write-Host "  лог: $script:LogPath" -ForegroundColor DarkGray }
    exit 0
}

# ── Вход ───────────────────────────────────────────────────────────────────
function Ask-Choice {
    param(
        [Parameter(Mandatory)][string]$Question,
        [Parameter(Mandatory)][System.Collections.Specialized.OrderedDictionary]$Choices,
        [string]$Default = '',
        [switch]$AllowQuit,
        [string]$Help = ''
    )
    if ($script:NonInteractive -and $Default) {
        Write-Info "автоматичен избор '$Default' (-Yes)"
        return $Default
    }
    if ($script:NonInteractive -and -not $Default) {
        Stop-WithError "Не мога да реша сам: $Question (нужен е интерактивен режим)."
    }
    while ($true) {
        Write-Host ''
        Write-Host "  $Question" -ForegroundColor White
        foreach ($key in $Choices.Keys) {
            $mark = if ("$key" -eq $Default) { '*' } else { ' ' }
            Write-Host ("  {0}[{1}] {2}" -f $mark, $key, $Choices[$key]) -ForegroundColor Gray
        }
        if ($AllowQuit) { Write-Host '    [q] отказ' -ForegroundColor DarkGray }
        if ($Help) { Write-Host '    [?] повече пояснения' -ForegroundColor DarkGray }
        $hint = if ($Default) { " (Enter = $Default)" } else { '' }
        $answer = Read-Host "  Избор$hint"
        $answer = "$answer".Trim().ToLowerInvariant()
        if ($answer -eq '' -and $Default) { return $Default }
        if ($answer -eq 'q' -and $AllowQuit) { Stop-Gracefully 'Отказано от потребителя.' }
        if ($answer -eq '?' -and $Help) { Write-Host "`n$Help" -ForegroundColor DarkCyan; continue }
        foreach ($key in $Choices.Keys) {
            if ($answer -eq "$key".ToLowerInvariant()) { return "$key" }
        }
        Write-Warn2 "Невалиден избор: '$answer'. Опитай пак."
    }
}

function Ask-Text {
    param(
        [Parameter(Mandatory)][string]$Question,
        [string]$Default = '',
        [scriptblock]$Validate,
        [string]$Help = ''
    )
    if ($script:NonInteractive -and $Default) { return $Default }
    while ($true) {
        $hint = if ($Default) { " (Enter = $Default)" } else { '' }
        if ($Help) { Write-Host "  $Help" -ForegroundColor DarkGray }
        $answer = Read-Host "  $Question$hint"
        if ([string]::IsNullOrWhiteSpace($answer)) {
            if ($Default) { return $Default }
            Write-Warn2 'Нужна е стойност.'
            continue
        }
        $answer = "$answer".Trim()
        if ($Validate) {
            $problem = & $Validate $answer
            if ($problem) { Write-Warn2 $problem; continue }
        }
        return $answer
    }
}

function Confirm-Strict {
    param(
        [Parameter(Mandatory)][string]$Question,
        [Parameter(Mandatory)][string]$Expected,
        [int]$Attempts = 2
    )
    if ($script:NonInteractive) { Write-Warn2 "$Question → отказано (неинтерактивен режим)"; return $false }
    for ($i = 1; $i -le $Attempts; $i++) {
        $answer = Read-Host "  $Question (напиши '$Expected' за потвърждение, Enter = отказ)"
        $trimmed = "$answer".Trim()
        if ($trimmed -eq '') {
            Write-Warn2 'получих празен ред — приемам го като отказ, нищо не е направено'
            return $false
        }
        if ($trimmed -eq $Expected) { return $true }
        if ($trimmed -in @('q', 'quit', 'exit', 'не', 'no')) { return $false }
        Write-Warn2 "'$trimmed' не съвпада с '$Expected' — опитай пак"
    }
    return $false
}

function Read-MultilineText([string]$Hint) {
    Write-Host "  $Hint" -ForegroundColor DarkGray
    Write-Host '  (завърши с ред, съдържащ само точка: .)' -ForegroundColor DarkGray
    $lines = [System.Collections.Generic.List[string]]::new()
    while ($true) {
        $line = Read-Host
        if ($null -eq $line) { break }
        if ("$line".Trim() -eq '.') { break }
        $lines.Add("$line")
    }
    return (($lines -join "`n").Trim())
}

# ── Външни команди ─────────────────────────────────────────────────────────
function Invoke-Git {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$What = 'git',
        [switch]$AllowFailure
    )
    if (-not $script:GitReady) {
        return [pscustomobject]@{ Ok = $false; ExitCode = 127; Text = 'git не е наличен'; Skipped = $true }
    }
    # -C винаги: иначе git прави discovery в текущата папка и блокира на SMB дела.
    $effective = if ($Arguments[0] -eq '-C') { $Arguments } else { @('-C', $script:GitCwd) + $Arguments }
    $attempt = 0
    while ($true) {
        $attempt++
        $raw = & git @effective 2>&1
        $code = $LASTEXITCODE
        $text = (($raw | ForEach-Object { "$_" }) -join "`n").Trim()
        if ($code -eq 0) {
            Write-Log "$What → OK"
            return [pscustomobject]@{ Ok = $true; ExitCode = 0; Text = $text; Skipped = $false }
        }
        Write-Log "$What → код $code · $text"
        if ($AllowFailure) { return [pscustomobject]@{ Ok = $false; ExitCode = $code; Text = $text; Skipped = $false } }
        if ($script:NonInteractive) { Stop-WithError "$What се провали (код $code): $text" }
        if ($attempt -lt $script:RetryLimit) {
            Write-Warn2 "$What се провали (опит $attempt/$($script:RetryLimit)) — пробвам пак"
            Start-Sleep -Seconds ([Math]::Min(8, 2 * $attempt))
            continue
        }
        Write-Warn2 "$What се провали след $attempt опита:"
        Write-Host "    $text" -ForegroundColor DarkRed
        $choice = Ask-Choice -Question 'Как да продължа?' -AllowQuit -Choices ([ordered]@{
                'r' = 'опитай още веднъж'
                'm' = 'покажи командата, за да я пусна ръчно'
                's' = 'пропусни стъпката и продължи'
            }) -Default 'r'
        if ($choice -eq 'r') { $attempt = 0; continue }
        if ($choice -eq 'm') {
            Write-Host "`n  git $($Arguments -join ' ')" -ForegroundColor Yellow
            $null = Read-Host '  Натисни Enter, за да продължа'
            continue
        }
        return [pscustomobject]@{ Ok = $false; ExitCode = $code; Text = $text; Skipped = $true }
    }
}

function Invoke-Gh {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [string]$What = 'gh',
        [switch]$AllowFailure
    )
    if (-not $script:GhReady) {
        return [pscustomobject]@{ Ok = $false; ExitCode = 127; Text = 'gh не е наличен'; Skipped = $true }
    }
    $attempt = 0
    while ($true) {
        $attempt++
        $raw = & gh @Arguments 2>&1
        $code = $LASTEXITCODE
        $text = (($raw | ForEach-Object { "$_" }) -join "`n").Trim()
        if ($code -eq 0) {
            Write-Log "$What → OK"
            return [pscustomobject]@{ Ok = $true; ExitCode = 0; Text = $text; Skipped = $false }
        }
        Write-Log "$What → код $code · $text"
        if ($AllowFailure) { return [pscustomobject]@{ Ok = $false; ExitCode = $code; Text = $text; Skipped = $false } }
        if ($attempt -lt $script:RetryLimit) {
            Write-Warn2 "$What се провали (опит $attempt/$($script:RetryLimit)) — пробвам пак"
            Start-Sleep -Seconds ([Math]::Min(8, 2 * $attempt))
            continue
        }
        Write-Warn2 "$What се провали: $text"
        return [pscustomobject]@{ Ok = $false; ExitCode = $code; Text = $text; Skipped = $true }
    }
}

# ── Слой 0 · Среда ─────────────────────────────────────────────────────────
function Test-Environment {
    Write-Step 'Слой 0 · Среда'

    if ($PSVersionTable.PSVersion.Major -lt 7) { Stop-WithError 'Нужен е PowerShell 7 или по-нов.' }
    Write-Ok "PowerShell $($PSVersionTable.PSVersion)"

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Warn2 'липсва git'
        $guess = @(
            (Join-Path $env:ProgramFiles 'Git\cmd\git.exe'),
            (Join-Path ${env:ProgramFiles(x86)} 'Git\cmd\git.exe'),
            (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
        ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
        if ($guess) {
            Write-Info "намерих го тук: $guess"
            $env:PATH = "$(Split-Path -Parent $guess);$env:PATH"
        }
    }
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $script:GitReady = $true
        $version = Invoke-Git -Arguments @('--version') -AllowFailure -What 'git --version'
        if ($version.Ok) { Write-Ok $version.Text } else { Write-Ok 'git е наличен' }
    }
    else {
        Stop-WithError 'Липсва git. Инсталирай го (winget install Git.Git) — без него няма как да се качи нищо.'
    }

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Stop-WithError 'Липсва Node.js — нужен е за експорта на файловете (scripts/export-tracked.cjs).'
    }
    Write-Ok ("node " + (& node --version 2>&1 | Select-Object -First 1))

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Warn2 'липсва GitHub CLI — без него няма проверка на хранилището и на последния commit'
        if (-not $script:NonInteractive) {
            $choice = Ask-Choice -Question 'Как да продължа без gh?' -AllowQuit -Choices ([ordered]@{
                    'w' = 'инсталирай с winget (winget install GitHub.cli)'
                    'c' = 'провери пак'
                    'x' = 'продължи без gh (по-малко проверки)'
                }) -Default 'c'
            if ($choice -eq 'w') {
                & winget install --id GitHub.cli --accept-source-agreements --accept-package-agreements
                if (Get-Command gh -ErrorAction SilentlyContinue) { $script:GhReady = $true }
            }
        }
    }
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $auth = & gh auth status --hostname github.com 2>&1
        if ($LASTEXITCODE -eq 0) {
            $script:GhReady = $true
            Write-Ok 'автентикация: ok'
        }
        else {
            Write-Warn2 'gh не е автентикиран'
            Write-Log "auth: $(($auth | ForEach-Object { "$_" }) -join ' | ')"
            if (-not $script:NonInteractive) {
                $choice = Ask-Choice -Question 'Как да продължа?' -AllowQuit -Choices ([ordered]@{
                        'l' = 'пусни "gh auth login" сега'
                        'c' = 'провери пак'
                        'x' = 'продължи без gh'
                    }) -Default 'l'
                if ($choice -eq 'l') { & gh auth login --hostname github.com --web --git-protocol https }
                if (Get-Command gh -ErrorAction SilentlyContinue) {
                    & gh auth status --hostname github.com *> $null
                    $script:GhReady = ($LASTEXITCODE -eq 0)
                }
            }
        }
    }

    if ($script:GhReady) {
        $view = Invoke-Gh -Arguments @('repo', 'view', $script:Repo, '--json', 'nameWithOwner,visibility,viewerPermission,defaultBranchRef') -AllowFailure -What 'gh repo view'
        if (-not $view.Ok) {
            Write-Warn2 "няма достъп до $($script:Repo)"
            if (-not $script:NonInteractive) {
                $script:Repo = Ask-Text -Question 'Хранилище (owner/name)' -Default $script:Repo -Validate {
                    param($value)
                    if ($value -notmatch '^[\w.-]+/[\w.-]+$') { return 'Очаквам формат owner/name.' }
                    return $null
                }
            }
        }
        else {
            $info = $null
            try { $info = $view.Text | ConvertFrom-Json } catch { $info = $null }
            if ($info) {
                $perm = [string]$info.viewerPermission
                Write-Ok "$($info.nameWithOwner) · $($info.visibility) · права: $perm"
                if ($perm -notin @('ADMIN', 'MAINTAIN', 'WRITE')) {
                    Write-Warn2 "правата ($perm) не позволяват push"
                    if (-not $script:NonInteractive) {
                        $choice = Ask-Choice -Question 'Правата не стигат. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                                'c' = 'друго хранилище'
                                'x' = 'продължи (push-ът вероятно ще се провали)'
                            }) -Default 'c'
                        if ($choice -eq 'c') {
                            $script:Repo = Ask-Text -Question 'Хранилище (owner/name)' -Default $script:Repo
                        }
                    }
                }
                if ($info.PSObject.Properties['defaultBranchRef'] -and $info.defaultBranchRef) {
                    $defaultBranch = [string]$info.defaultBranchRef.name
                    if ($defaultBranch) { Write-Info "клон по подразбиране: $defaultBranch" }
                }
            }
        }
    }

    # Самоличност за commit — без нея git отказва. Четем през Invoke-Git, за да не виси на H:.
    $gitName = ''
    $gitMail = ''
    $nameResult = Invoke-Git -Arguments @('config', '--global', 'user.name') -AllowFailure -What 'git config user.name'
    if ($nameResult.Ok) { $gitName = $nameResult.Text }
    $mailResult = Invoke-Git -Arguments @('config', '--global', 'user.email') -AllowFailure -What 'git config user.email'
    if ($mailResult.Ok) { $gitMail = $mailResult.Text }
    if (-not $gitName) {
        Write-Warn2 'git няма зададено user.name'
        if (-not $script:NonInteractive) {
            $value = Ask-Text -Question 'Име за commit-ите'
            $null = Invoke-Git -Arguments @('config', '--global', 'user.name', $value) -What 'git config user.name (запис)'
        }
        else { Write-Warn2 'неинтерактивен режим: commit-ът може да се провали без user.name' }
    }
    else { Write-Info "git автор: $gitName" }
    if (-not $gitMail) {
        Write-Warn2 'git няма зададено user.email'
        if (-not $script:NonInteractive) {
            $value = Ask-Text -Question 'Имейл за commit-ите'
            $null = Invoke-Git -Arguments @('config', '--global', 'user.email', $value) -What 'git config user.email (запис)'
        }
        else { Write-Warn2 'неинтерактивен режим: commit-ът може да се провали без user.email' }
    }
}

# ── Слой 0б · Хранилище и клон ─────────────────────────────────────────────
function Get-RepoCandidates {
    $result = [System.Collections.Generic.List[object]]::new()
    if (-not $script:GhReady) { return $result }
    $list = Invoke-Gh -Arguments @('repo', 'list', '--limit', '40', '--json', 'nameWithOwner,visibility,pushedAt') -AllowFailure -What 'gh repo list'
    if (-not $list.Ok -or -not $list.Text) { return $result }
    $items = @()
    try { $items = @($list.Text | ConvertFrom-Json) } catch { return $result }
    foreach ($item in $items) {
        $pushed = [datetime]::MinValue
        if ($item.PSObject.Properties['pushedAt'] -and $item.pushedAt) {
            try { $pushed = [datetime]$item.pushedAt } catch { $pushed = [datetime]::MinValue }
        }
        $visibility = ''
        if ($item.PSObject.Properties['visibility'] -and $item.visibility) { $visibility = [string]$item.visibility }
        $result.Add([pscustomobject]@{
                FullName = [string]$item.nameWithOwner
                Note     = "$visibility · последно: $($pushed.ToString('yyyy-MM-dd'))"
                Score    = if ([string]$item.nameWithOwner -match 'hapi') { 0 } else { 1 }
                Pushed   = $pushed
            })
    }
    return @($result | Sort-Object -Property @{ Expression = 'Score'; Ascending = $true }, @{ Expression = 'Pushed'; Descending = $true })
}

function Select-Target {
    Write-Step 'Слой 0б · Кое хранилище и кой клон'
    if ($script:NonInteractive) {
        Write-Info "хранилище: $($script:Repo) · клон: $($script:Branch) (-Yes не пита)"
        return
    }
    Write-Info "текущо: $($script:Repo)"

    $choice = Ask-Choice -Question 'Къде качваме?' -Choices ([ordered]@{
            'k' = "остави $($script:Repo)"
            'm' = 'друго (owner/name)'
            'l' = 'покажи списък от GitHub'
        }) -Default 'k' -AllowQuit
    if ($choice -eq 'l') {
        $repos = @(Get-RepoCandidates)
        if (-not $repos.Count) { Write-Warn2 'не мога да извадя списък — избери "m" и го напиши' }
        else {
            $list = [ordered]@{}
            for ($i = 0; $i -lt $repos.Count; $i++) {
                $list["$($i + 1)"] = "$($repos[$i].FullName)  —  $($repos[$i].Note)"
                if ($repos[$i].FullName -eq $script:Repo) { $list["$($i + 1)"] = $list["$($i + 1)"] + '   (текущо)' }
            }
            $pick = Ask-Choice -Question 'Кое хранилище?' -Choices $list -Default '1' -AllowQuit
            $index = [int]$pick - 1
            $script:Repo = [string]$repos[$index].FullName
        }
    }
    elseif ($choice -eq 'm') {
        $script:Repo = Ask-Text -Question 'Хранилище (owner/name)' -Default $script:Repo -Validate {
            param($value)
            if ($value -notmatch '^[\w.-]+/[\w.-]+$') { return 'Очаквам формат owner/name (напр. PasevSU/hAPI).' }
            return $null
        }
    }

    $script:Branch = Ask-Text -Question 'Клон' -Default $script:Branch -Validate {
        param($value)
        if ($value -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]*$') { return 'Невалидно име на клон.' }
        return $null
    }
    Write-Ok "$($script:Repo) · клон $($script:Branch)"
}

# ── Слой 1 · Какво влиза ───────────────────────────────────────────────────
function Convert-ExportToLf([string]$Directory) {
    # `.gitattributes` иска LF (`* text=auto eol=lf`), а работното копие е с CRLF.
    # Без тази стъпка git брои стотици файлове за „променени“, макар съдържанието да е същото.
    # Latin1 запазва байтовете едно към едно, така че UTF-8 кирилица не се пипа.
    $latin1 = [Text.Encoding]::Latin1
    $converted = 0
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Recurse -File -Force) {
        $bytes = [IO.File]::ReadAllBytes($file.FullName)
        if ($bytes.Length -lt 2) { continue }
        $limit = [Math]::Min($bytes.Length, 8000)
        $isBinary = $false
        for ($i = 0; $i -lt $limit; $i++) { if ($bytes[$i] -eq 0) { $isBinary = $true; break } }
        if ($isBinary) { continue }
        $text = $latin1.GetString($bytes)
        if (-not $text.Contains("`r`n")) { continue }
        $normalized = $text.Replace("`r`n", "`n")
        # Копието от мрежов диск може да носи read-only/hidden атрибут, а WriteAllBytes
        # отказва запис върху такъв файл (проверено на .dockerignore). Махаме ги.
        $file.Attributes = [IO.FileAttributes]::Archive
        [IO.File]::WriteAllBytes($file.FullName, $latin1.GetBytes($normalized))
        $converted++
    }
    return $converted
}

function Step-Export {
    Write-Step 'Слой 1 · Какво влиза в хранилището'
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $script:ExportDir = Join-Path ([IO.Path]::GetTempPath()) "hapi-export-$stamp"
    $exportScript = Join-Path $Root 'scripts/export-tracked.cjs'
    if (-not (Test-Path -LiteralPath $exportScript)) { Stop-WithError "липсва $exportScript" }

    $raw = & node $exportScript --to $script:ExportDir --clean 2>&1
    $code = $LASTEXITCODE
    $text = (($raw | ForEach-Object { "$_" }) -join "`n").Trim()
    Write-Log "export-tracked → код $code · $text"
    if ($code -ne 0) {
        Write-Warn2 'експортът спря:'
        Write-Host "    $text" -ForegroundColor DarkRed
        if ($script:NonInteractive) { Stop-WithError 'Експортът се провали — нищо не е качено.' }
        $choice = Ask-Choice -Question 'Експортът отказа (вероятно тайна или подозрително име).' -AllowQuit -Choices ([ordered]@{
                'r' = 'опитай пак'
                'q' = 'прекрати'
            }) -Default 'q' -Help 'Това е защита: файловете, които излизат, минават през проверка за тайни. Ако е фалшива тревога, коригирай файла, не заобикаляй проверката.'
        if ($choice -eq 'r') { return (Step-Export) }
        Stop-Gracefully 'Спряно преди качване.'
    }

    $files = @(Get-ChildItem -LiteralPath $script:ExportDir -Recurse -File -Force)
    if (-not $files.Count) { Stop-WithError 'Експортът е празен — няма какво да се качи.' }
    $converted = Convert-ExportToLf $script:ExportDir
    if ($converted -gt 0) { Write-Info "нормализирани към LF: $converted файла (изискване на .gitattributes)" }
    $sizeMb = [math]::Round((($files | Measure-Object -Property Length -Sum).Sum) / 1MB, 2)
    Write-Ok "подготвени $($files.Count) файла · $sizeMb MB"
    Write-Info "временна папка: $($script:ExportDir)"
}

function Step-Audit {
    Write-Step 'Слой 1б · Одит преди качване'
    $auditScript = Join-Path $Root 'scripts/pre-push-audit.cjs'
    if (-not (Test-Path -LiteralPath $auditScript)) {
        Write-Warn2 "липсва $auditScript — пропускам одита"
        return
    }
    $raw = & node $auditScript 2>&1
    $code = $LASTEXITCODE
    $text = (($raw | ForEach-Object { "$_" }) -join "`n").Trim()
    Write-Log "pre-push-audit → код $code"
    if ($code -eq 0) {
        Write-Ok 'одитът мина (без тайни и едри файлове)'
        return
    }
    Write-Warn2 'одитът намери проблем:'
    Write-Host $text -ForegroundColor DarkRed
    if ($script:NonInteractive) { Stop-WithError 'Одитът не мина — качването е спряно.' }
    $choice = Ask-Choice -Question 'Одитът не мина. Какво да правим?' -AllowQuit -Choices ([ordered]@{
            'q' = 'прекрати и оправи файловете'
            'x' = 'продължи въпреки това (изрично потвърждение)'
            'r' = 'пусни одита пак'
        }) -Default 'q' -Help 'Одитът пази срещу качване на тайни и на едри артефакти. Заобикалянето му е рядко оправдано.'
    if ($choice -eq 'r') { return (Step-Audit) }
    if ($choice -eq 'x') {
        if (Confirm-Strict -Question 'Да продължа ли въпреки забележките на одита?' -Expected 'да') { return }
    }
    Stop-Gracefully 'Спряно от одита.'
}

# ── Слой 2 · Клон ──────────────────────────────────────────────────────────
function Get-RepoSlug {
    return (($script:Repo -replace '[^\w.-]', '-'))
}

function Step-Clone {
    Write-Step 'Слой 2 · Локално копие (git работи във %TEMP%, не на H:)'
    $slug = Get-RepoSlug
    $script:WorkDir = Join-Path ([IO.Path]::GetTempPath()) "hapi-sync-$slug"
    Write-Info "работна папка: $($script:WorkDir)"

    $repoUrl = "https://github.com/$($script:Repo)"
    $exists = Test-Path -LiteralPath (Join-Path $script:WorkDir '.git')

    if ($exists -and -not $Reuse -and -not $script:NonInteractive) {
        $choice = Ask-Choice -Question 'Вече има клонирано копие. Какво да правим?' -Choices ([ordered]@{
                'u' = 'обнови го (fetch + checkout на клона)'
                'n' = 'изтрий го и клонирай наново'
                'd' = 'остави го както е (без fetch)'
            }) -Default 'u' -Help 'Обновяването е по-бързо; новото клониране е по-чисто, ако копието е разбъркано.'
        if ($choice -eq 'n') {
            Remove-Item -LiteralPath $script:WorkDir -Recurse -Force -ErrorAction SilentlyContinue
            $exists = $false
        }
        if ($choice -eq 'd') { $Reuse = $true }
    }
    if ($exists -and $script:NonInteractive -and -not $Reuse) { $Reuse = $true }

    if (-not $exists) {
        Write-Info "клонирам $repoUrl"
        $clone = Invoke-Git -Arguments @('clone', $repoUrl, $script:WorkDir) -What 'git clone' -AllowFailure
        if (-not $clone.Ok) {
            Write-Warn2 "клонирането се провали: $($clone.Text)"
            if ($script:NonInteractive) { Stop-WithError 'Няма как да продължа без копие на хранилището.' }
            $choice = Ask-Choice -Question 'Клонирането се провали. Какво да правим?' -AllowQuit -Choices ([ordered]@{
                    'r' = 'опитай пак'
                    'm' = 'покажи командата за ръчно клониране'
                    'q' = 'прекрати'
                }) -Default 'r'
            if ($choice -eq 'm') {
                Write-Host "`n  git clone $repoUrl `"$($script:WorkDir)`"" -ForegroundColor Yellow
                $null = Read-Host '  Натисни Enter, за да продължа'
            }
            if ($choice -eq 'q') { Stop-Gracefully 'Спряно.' }
            return (Step-Clone)
        }
        Write-Ok 'клонирано'
    }
    else {
        Write-Info 'преизползвам съществуващото копие'
        $fetch = Invoke-Git -Arguments @('-C', $script:WorkDir, 'fetch', '--prune', 'origin') -What 'git fetch' -AllowFailure
        if ($fetch.Ok) { Write-Ok 'fetch: ok' } else { Write-Warn2 "fetch: $($fetch.Text)" }
    }

    # Клонът може да не съществува още (ново хранилище).
    $remoteBranch = Invoke-Git -Arguments @('-C', $script:WorkDir, 'rev-parse', '--verify', "origin/$($script:Branch)") -What 'git rev-parse' -AllowFailure
    if ($remoteBranch.Ok) {
        $null = Invoke-Git -Arguments @('-C', $script:WorkDir, 'checkout', '-B', $script:Branch, "origin/$($script:Branch)") -What 'git checkout'
        Write-Ok "работя върху клон '$($script:Branch)'"
        $behind = Invoke-Git -Arguments @('-C', $script:WorkDir, 'rev-list', '--count', "HEAD..origin/$($script:Branch)") -What 'git rev-list' -AllowFailure
        if ($behind.Ok -and $behind.Text -match '^\d+$' -and [int]$behind.Text -gt 0) {
            Write-Warn2 "клонът в GitHub има $($behind.Text) нови commit-а, които липсват тук"
        }
    }
    else {
        $null = Invoke-Git -Arguments @('-C', $script:WorkDir, 'checkout', '-B', $script:Branch) -What 'git checkout -B'
        Write-Warn2 "клонът '$($script:Branch)' още не съществува в GitHub — ще бъде създаден при push"
    }
}

# ── Слой 3 · Разлики ───────────────────────────────────────────────────────
function Get-ExportFiles {
    $map = @{}
    foreach ($file in Get-ChildItem -LiteralPath $script:ExportDir -Recurse -File -Force) {
        $relative = $file.FullName.Substring($script:ExportDir.Length).TrimStart('\', '/').Replace('\', '/')
        $map[$relative] = $file.FullName
    }
    return $map
}

function Step-Diff {
    Write-Step 'Слой 3 · Разлики с хранилището'
    $export = Get-ExportFiles

    # Копираме експорта върху клона; git сам преценява какво е ново и какво е променено.
    $copied = 0
    foreach ($relative in $export.Keys) {
        $destination = Join-Path $script:WorkDir $relative
        $parent = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $export[$relative] -Destination $destination -Force
        $copied++
    }
    Write-Info "копирани $copied файла върху клона"

    $status = Invoke-Git -Arguments @('-C', $script:WorkDir, 'status', '--porcelain=v1', '--untracked-files=all') -What 'git status'
    $added = [System.Collections.Generic.List[string]]::new()
    $modified = [System.Collections.Generic.List[string]]::new()
    foreach ($line in ($status.Text -split "`n")) {
        if (-not $line.Trim()) { continue }
        $code = $line.Substring(0, 2)
        $path = $line.Substring(3).Trim().Trim('"')
        if ($code -eq '??') { $added.Add($path) } else { $modified.Add($path) }
    }
    $script:Added = @($added)
    $script:Modified = @($modified)

    # Изтрити: файлове, които git следи, но вече ги няма в експорта.
    $tracked = Invoke-Git -Arguments @('-C', $script:WorkDir, 'ls-files') -What 'git ls-files' -AllowFailure
    $deleted = [System.Collections.Generic.List[string]]::new()
    if ($tracked.Ok) {
        foreach ($path in ($tracked.Text -split "`n")) {
            $clean = $path.Trim()
            if (-not $clean) { continue }
            if (-not $export.ContainsKey($clean)) { $deleted.Add($clean) }
        }
    }

    Write-Ok "нови: $($script:Added.Count) · променени: $($script:Modified.Count) · изчезнали от източника: $($deleted.Count)"
    if ($script:Added.Count) {
        Write-Host '  нови:' -ForegroundColor DarkGray
        foreach ($item in ($script:Added | Select-Object -First 15)) { Write-Host "    + $item" -ForegroundColor DarkGray }
        if ($script:Added.Count -gt 15) { Write-Host "    … и още $($script:Added.Count - 15)" -ForegroundColor DarkGray }
    }
    if ($script:Modified.Count) {
        Write-Host '  променени:' -ForegroundColor DarkGray
        foreach ($item in ($script:Modified | Select-Object -First 15)) { Write-Host "    ~ $item" -ForegroundColor DarkGray }
        if ($script:Modified.Count -gt 15) { Write-Host "    … и още $($script:Modified.Count - 15)" -ForegroundColor DarkGray }
    }

    $script:Deleted = @($deleted)
    if ($script:Deleted.Count) {
        Write-Warn2 "тези файлове са в хранилището, но вече ги няма в източника:"
        foreach ($item in ($script:Deleted | Select-Object -First 15)) { Write-Host "    - $item" -ForegroundColor DarkGray }
        if ($script:Deleted.Count -gt 15) { Write-Host "    … и още $($script:Deleted.Count - 15)" -ForegroundColor DarkGray }
        if ($script:NonInteractive) {
            if ($AllowDelete) { $script:DeleteApproved = $true; Write-Warn2 'изтривам ги (-AllowDelete)' }
            else { Write-Info 'оставям ги в хранилището (за изтриване: -AllowDelete)' }
        }
        else {
            $choice = Ask-Choice -Question 'Какво да правим с тях?' -Choices ([ordered]@{
                    'k' = 'запази ги в хранилището (нищо не се трие)'
                    'd' = 'изтрий ги и от хранилището'
                    'v' = 'покажи пълния списък'
                }) -Default 'k' -Help 'Изтриването се вижда в историята на git и е обратимо, но е единственото разрушително действие тук.'
            if ($choice -eq 'v') {
                foreach ($item in $script:Deleted) { Write-Host "    - $item" -ForegroundColor DarkGray }
                $choice = Ask-Choice -Question 'Какво да правим с тях?' -Choices ([ordered]@{
                        'k' = 'запази ги'
                        'd' = 'изтрий ги'
                    }) -Default 'k'
            }
            if ($choice -eq 'd') {
                if (Confirm-Strict -Question "Да изтрия ли $($script:Deleted.Count) файла от хранилището?" -Expected 'да') {
                    $script:DeleteApproved = $true
                }
            }
        }
        if ($script:DeleteApproved) {
            foreach ($item in $script:Deleted) {
                $target = Join-Path $script:WorkDir $item
                if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
            }
            Write-Ok "изтрити $($script:Deleted.Count) файла от клона"
        }
    }

    if (-not $script:Added.Count -and -not $script:Modified.Count -and -not ($script:DeleteApproved -and $script:Deleted.Count)) {
        Write-Ok 'няма разлики — хранилището вече е актуално'
        if ($script:NonInteractive) { Stop-Gracefully 'Нищо за качване.' }
        $choice = Ask-Choice -Question 'Няма какво да се качи. Какво да правим?' -Choices ([ordered]@{
                'e' = 'край'
                'r' = 'презареди (fetch + ново сравнение)'
                'v' = 'покажи git status в клона'
            }) -Default 'e'
        if ($choice -eq 'v') {
            Write-Host $status.Text -ForegroundColor DarkGray
            return (Step-Diff)
        }
        if ($choice -eq 'r') {
            $null = Invoke-Git -Arguments @('-C', $script:WorkDir, 'checkout', '--', '.') -What 'git checkout --' -AllowFailure
            return (Step-Diff)
        }
        Stop-Gracefully 'Нищо за качване.'
    }
}

# ── Слой 4 · Съобщение ─────────────────────────────────────────────────────
function Get-ChangelogHeadline {
    if (-not (Test-Path -LiteralPath $Changelog)) { return '' }
    $lines = Get-Content -LiteralPath $Changelog
    $collected = @()
    foreach ($line in $lines) {
        if ($line -match '^#{1,3}\s' -and $collected.Count -gt 0) { break }
        if ($line -match '^#{1,3}\s') { continue }
        if (-not $line.Trim()) { continue }
        $collected += ($line.Trim() -replace '^[-*]\s+', '')
        if ($collected.Count -ge 5) { break }
    }
    if (-not $collected.Count) { return '' }
    return ($collected[0] -replace '\*\*', '' -replace '`', '')
}

function New-DefaultMessage {
    $parts = [System.Collections.Generic.List[string]]::new()
    if ($script:Added.Count) { $parts.Add("+$($script:Added.Count)") }
    if ($script:Modified.Count) { $parts.Add("~$($script:Modified.Count)") }
    if ($script:DeleteApproved -and $script:Deleted.Count) { $parts.Add("-$($script:Deleted.Count)") }
    $summary = if ($parts.Count) { $parts -join ' ' } else { 'без промени' }
    $headline = Get-ChangelogHeadline
    if (-not $headline) { return "Обновяване на съдържанието ($summary)" }
    if ($headline.Length -gt 60) { $headline = $headline.Substring(0, 57).TrimEnd() + '...' }
    return "$headline ($summary)"
}

function Step-Message {
    Write-Step 'Слой 4 · Съобщение на commit-а'
    if (-not $script:Message) {
        $script:Message = New-DefaultMessage
        $script:MessageOrigin = 'предложено'
    }
    else {
        $script:MessageOrigin = 'от параметъра'
    }

    while ($true) {
        Write-Host ''
        Write-Host "  ── съобщение ($($script:MessageOrigin)) ──" -ForegroundColor DarkCyan
        Write-Host "  $($script:Message)" -ForegroundColor Gray
        Write-Host '  ── край ──' -ForegroundColor DarkCyan
        if ($script:Message.Length -lt 8) { Write-Warn2 'съобщението е много кратко' }

        if ($script:NonInteractive) { return }
        $choice = Ask-Choice -Question 'Приемаш ли това съобщение?' -Choices ([ordered]@{
                'c' = 'приемам'
                'n' = 'напиши ново (един ред)'
                'm' = 'напиши ново (няколко реда)'
                'e' = 'редактирай в Notepad'
                'g' = 'вземи от CHANGELOG'
                'd' = 'върни предложеното'
            }) -Default 'c' -AllowQuit
        if ($choice -eq 'c') { return }
        if ($choice -eq 'n') {
            $script:Message = Ask-Text -Question 'Съобщение'
            $script:MessageOrigin = 'ръчно'
            continue
        }
        if ($choice -eq 'm') {
            $text = Read-MultilineText 'Въведи съобщението:'
            if ($text) { $script:Message = $text; $script:MessageOrigin = 'ръчно (многоредово)' }
            continue
        }
        if ($choice -eq 'e') {
            $editor = Join-Path ([IO.Path]::GetTempPath()) 'hapi-commit-message.txt'
            Set-Content -LiteralPath $editor -Value $script:Message -Encoding utf8
            Start-Process -FilePath 'notepad.exe' -ArgumentList "`"$editor`"" -Wait
            $script:Message = (Get-Content -LiteralPath $editor -Raw).Trim()
            $script:MessageOrigin = 'Notepad'
            continue
        }
        if ($choice -eq 'g') {
            $headline = Get-ChangelogHeadline
            if (-not $headline) { Write-Warn2 'CHANGELOG.md е празен или липсва'; continue }
            $script:Message = $headline
            $script:MessageOrigin = 'CHANGELOG'
            continue
        }
        if ($choice -eq 'd') {
            $script:Message = New-DefaultMessage
            $script:MessageOrigin = 'предложено'
            continue
        }
    }
}

# ── Слой 5 · Преглед ───────────────────────────────────────────────────────
function Show-Summary {
    Write-Step 'Слой 5 · Какво ще се качи'
    Write-Info "хранилище: $($script:Repo)"
    Write-Info "клон:      $($script:Branch)"
    Write-Info "работна:   $($script:WorkDir)"
    Write-Info "нови:      $($script:Added.Count)"
    Write-Info "променени: $($script:Modified.Count)"
    if ($script:DeleteApproved) { Write-Info "изтрити:   $($script:Deleted.Count)" } else { Write-Info "изтрити:   0 (запазват се)" }
    Write-Info "съобщение: $($script:Message)"
    $total = $script:Added.Count + $script:Modified.Count
    if ($total -gt 0) {
        $stat = Invoke-Git -Arguments @('-C', $script:WorkDir, '--no-pager', 'diff', '--stat', 'HEAD') -What 'git diff --stat' -AllowFailure
        if ($stat.Ok -and $stat.Text) {
            Write-Host ''
            foreach ($line in ($stat.Text -split "`n" | Select-Object -Last 6)) { Write-Host "  $line" -ForegroundColor DarkGray }
        }
    }
}

# ── Слой 6 · Пуш ───────────────────────────────────────────────────────────
function Invoke-Push {
    Write-Step 'Слой 6 · Качване'
    $add = Invoke-Git -Arguments @('-C', $script:WorkDir, 'add', '-A') -What 'git add'
    Write-Ok 'промените са добавени в индекса'

    $commit = Invoke-Git -Arguments @('-C', $script:WorkDir, 'commit', '-m', $script:Message) -AllowFailure -What 'git commit'
    if (-not $commit.Ok) {
        if ($commit.Text -match 'nothing to commit') {
            Write-Warn2 'няма какво да се commit-не'
            Stop-Gracefully 'Нищо за качване.'
        }
        Stop-WithError "commit-ът се провали: $($commit.Text)"
    }
    Write-Ok 'commit е направен'

    $pushed = Invoke-Git -Arguments @('-C', $script:WorkDir, 'push', '-u', 'origin', $script:Branch) -AllowFailure -What 'git push'
    if ($pushed.Ok) {
        Write-Ok "качено в $($script:Repo):$($script:Branch)"
        return
    }

    if ($pushed.Text -match 'rejected|non-fast-forward|fetch first') {
        Write-Warn2 'клонът в GitHub е напреднал — push-ът е отказан'
        if ($script:NonInteractive) { Stop-WithError 'Някой друг е push-нал преди теб. Пусни скрипта пак с -Reuse, за да обнови.' }
        $choice = Ask-Choice -Question 'Как да продължа?' -AllowQuit -Choices ([ordered]@{
                'r' = 'изтегли с rebase и опитай пак'
                'm' = 'покажи командите за ръчно сливане'
                'q' = 'прекрати'
            }) -Default 'r' -Help 'Правим rebase на твоя commit върху актуалния клон. Ако има конфликт, rebase-ът се отменя и нищо не се губи.'
        if ($choice -eq 'm') {
            Write-Host "`n  git -C `"$($script:WorkDir)`" pull --rebase origin $($script:Branch)" -ForegroundColor Yellow
            Write-Host "  git -C `"$($script:WorkDir)`" push origin $($script:Branch)" -ForegroundColor Yellow
            $null = Read-Host '  Натисни Enter, за да продължа'
            Stop-Gracefully 'Спряно за ръчно сливане.'
        }
        if ($choice -eq 'q') { Stop-Gracefully 'Спряно.' }

        $pull = Invoke-Git -Arguments @('-C', $script:WorkDir, 'pull', '--rebase', 'origin', $script:Branch) -AllowFailure -What 'git pull --rebase'
        if (-not $pull.Ok) {
            Write-Warn2 "rebase-ът не мина: $($pull.Text)"
            $null = Invoke-Git -Arguments @('-C', $script:WorkDir, 'rebase', '--abort') -AllowFailure -What 'git rebase --abort'
            Stop-WithError 'Има конфликт. Нищо не е качено — оправи го ръчно в клона и пусни скрипта пак.'
        }
        $retry = Invoke-Git -Arguments @('-C', $script:WorkDir, 'push', '-u', 'origin', $script:Branch) -AllowFailure -What 'git push (след rebase)'
        if (-not $retry.Ok) { Stop-WithError "push-ът пак се провали: $($retry.Text)" }
        Write-Ok "качено след rebase в $($script:Repo):$($script:Branch)"
        return
    }

    Stop-WithError "push-ът се провали: $($pushed.Text)"
}

# ── Слой 7 · Проверка ──────────────────────────────────────────────────────
function Test-Pushed {
    Write-Step 'Слой 7 · Проверка'
    $log = Invoke-Git -Arguments @('-C', $script:WorkDir, 'log', '-1', '--pretty=format:%h %s (%an, %ar)') -AllowFailure -What 'git log -1'
    if ($log.Ok -and $log.Text) { Write-Ok "локално: $($log.Text)" }

    if ($script:GhReady) {
        $remote = Invoke-Gh -Arguments @('api', "repos/$($script:Repo)/commits/$($script:Branch)", '--jq', '.sha[0:7] + "  " + (.commit.message | split("\n")[0])') -AllowFailure -What 'gh api commit'
        if ($remote.Ok -and $remote.Text) { Write-Ok "в GitHub: $($remote.Text)" }
        else { Write-Warn2 "не мога да прочета последния commit от GitHub: $($remote.Text)" }
        Write-Info "https://github.com/$($script:Repo)/commits/$($script:Branch)"
    }

    if ($script:NonInteractive) { return }
    while ($true) {
        $choice = Ask-Choice -Question 'Какво следва?' -Choices ([ordered]@{
                'e' = 'край'
                'o' = 'отвори клона в браузър'
                'l' = 'покажи последните 5 commit-а'
                'd' = 'покажи пълния diff на последния commit'
            }) -Default 'e'
        if ($choice -eq 'e') { return }
        if ($choice -eq 'o') { Start-Process "https://github.com/$($script:Repo)/commits/$($script:Branch)"; continue }
        if ($choice -eq 'l') {
            $last = Invoke-Git -Arguments @('-C', $script:WorkDir, 'log', '-5', '--oneline', '--decorate') -AllowFailure -What 'git log'
            Write-Host $last.Text -ForegroundColor DarkGray
            continue
        }
        if ($choice -eq 'd') {
            $diff = Invoke-Git -Arguments @('-C', $script:WorkDir, '--no-pager', 'show', '--stat', 'HEAD') -AllowFailure -What 'git show'
            Write-Host $diff.Text -ForegroundColor DarkGray
            continue
        }
    }
}

# ── Главен поток ───────────────────────────────────────────────────────────
if (-not $LogFile) {
    $LogFile = Join-Path ([IO.Path]::GetTempPath()) ("hapi-update-repo-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
}
try { Set-Content -LiteralPath $LogFile -Value "hAPI update-repo · $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -Encoding utf8; $script:LogPath = $LogFile }
catch { $script:LogPath = $null }

Write-Host ''
Write-Host '  hAPI Enterprise - обновяване на хранилището' -ForegroundColor Cyan
Write-Host "  хранилище: $Repo · режим: $(if ($Execute) { 'РЕАЛНО КАЧВАНЕ' } else { 'dry run (нищо не се качва)' })" -ForegroundColor DarkGray

Test-Environment
Select-Target
Step-Export
Step-Audit
Step-Clone
Step-Diff
Step-Message
Show-Summary

if (-not $Execute) {
    Write-Step 'Dry run — нищо не се качва'
    Write-Host "  git -C `"$($script:WorkDir)`" add -A" -ForegroundColor White
    Write-Host "  git -C `"$($script:WorkDir)`" commit -m `"$($script:Message)`"" -ForegroundColor White
    Write-Host "  git -C `"$($script:WorkDir)`" push -u origin $($script:Branch)" -ForegroundColor White
    Write-Host ''
    Write-Host '  За реално качване добави -Execute.' -ForegroundColor Yellow
    Write-Info "клонът остава в $($script:WorkDir) — при следващо пускане избери „обнови го“, за да не се клонира наново"
    if ($script:LogPath) { Write-Host "  лог: $($script:LogPath)" -ForegroundColor DarkGray }
    exit 0
}

Write-Step 'Потвърждение'
Write-Info "предстои: commit и push в $($script:Repo):$($script:Branch)"
if (-not (Confirm-Strict -Question 'Потвърждаваш ли качването?' -Expected $script:Branch)) {
    Stop-Gracefully 'Потвърждението не съвпадна — нищо не е качено.'
}

$script:Execute = $true
Invoke-Push
Test-Pushed

Write-Host ''
Write-Host "  Провери: gh repo view $($script:Repo) --web" -ForegroundColor DarkGray
if ($script:LogPath) { Write-Host "  лог: $($script:LogPath)" -ForegroundColor DarkGray }
