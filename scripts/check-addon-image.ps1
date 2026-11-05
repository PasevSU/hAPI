# Проверява дали образът на add-on-а наистина е публикуван и PUBLIC.
#
# Защо е нужен: `config.yaml` може да сочи `image:` само ако Supervisor успее да го изтегли
# АНОНИМНО. Ако пакетът в GHCR е private, обновяването на add-on-а се проваля с неясна
# грешка — затова тук се проверява преди превключването.
#
#   pwsh -File scripts/check-addon-image.ps1 -Version 0.69.153
#
# Изход: exit 0 → образът е публичен и готов; exit 1 → още не е (или е private).
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Owner = 'PasevSU',
    [string]$Slug = 'hapi_enterprise',
    [string[]]$Arch = @('amd64', 'aarch64', 'armv7')
)

$ErrorActionPreference = 'Stop'
$failed = 0

foreach ($a in $Arch) {
    $image = "ghcr.io/$($Owner.ToLower())/$a-addon-$Slug"
    # Пътят ЗАДЪЛЖИТЕЛНО минава през `/v2/`: това е адресът на registry API-то.
    # Без него `https://ghcr.io/<owner>/<repo>/manifests/<tag>` е страница на сайта и
    # отговаря 404 — образът изглежда липсващ, въпреки че е качен.
    $manifest = "https://ghcr.io/v2/$($Owner.ToLower())/$a-addon-$Slug/manifests/$Version"
    # Анонимна заявка: точно това прави Supervisor. При private пакет отговорът е 401/403.
    try {
        $token = (Invoke-RestMethod -Uri "https://ghcr.io/token?scope=repository:$($Owner.ToLower())/$a-addon-$Slug`:pull" -TimeoutSec 30).token
        # Accept трябва да изброява и ЧЕТИРИТЕ вида манифест. Нашият workflow строи с
        # buildx по една архитектура на job, тоест push-ва ОБИКНОВЕН image manifest, а не
        # multi-arch index — при Accept само на index/list GHCR отговаря 404 и образът
        # изглежда „липсва“, въпреки че е качен.
        $res = Invoke-WebRequest -Uri $manifest -Headers @{
            Authorization = "Bearer $token"
            Accept        = 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
        } -TimeoutSec 30 -UseBasicParsing
        Write-Host ("  OK   {0}:{1} · HTTP {2}" -f $image, $Version, $res.StatusCode)
    }
    catch {
        $failed++
        Write-Host ("  ЛИПСВА {0}:{1} · {2}" -f $image, $Version, $_.Exception.Message)
    }
}

if ($failed -gt 0) {
    Write-Host ''
    Write-Host "Образът още не е готов за $failed от $($Arch.Count) архитектури."
    Write-Host 'Докато не излезе зелено, `image:` в config.yaml НЕ бива да се включва — store-ът'
    Write-Host 'ще се опита да тегли несъществуващ образ и обновяването ще се провали.'
    exit 1
}

Write-Host ''
Write-Host "Образът за $Version е публичен за всички архитектури — `image:` може да се включи."
