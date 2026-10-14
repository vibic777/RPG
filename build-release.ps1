$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$buildVersion = "$($package.version)-build-$stamp"
$releaseName = "RustAndMagic-v$buildVersion"
$releaseRoot = Join-Path $root 'releases'
$releaseDir = Join-Path $releaseRoot $releaseName
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$stageParent = Join-Path $tempRoot $releaseName
$stageFull = [IO.Path]::GetFullPath($stageParent)
if (-not $stageFull.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $stageFull) -ne $releaseName) {
  throw "Небезопасный временный путь сборки: $stageFull"
}
$stageRoot = Join-Path $stageParent $releaseName
$archivePath = Join-Path $releaseDir "$releaseName.zip"

if (Test-Path -LiteralPath $stageParent) { throw "Папка сборки уже существует: $stageParent" }
New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

try {
  $include = @(
    'client', 'server', 'shared', 'test',
    'package.json', 'package-lock.json', 'config.example.json',
    'README.md', 'GDD.md', 'CHANGELOG.md', 'TODO.md', '.gitignore',
    'start.bat', 'restart.bat', 'firewall-allow.bat', 'lan-setup.bat', 'lan-setup.ps1', 'install-deps.bat', 'install-deps.ps1',
    'build-release.bat', 'build-release.ps1'
  )
  foreach ($relativePath in $include) {
    $source = Join-Path $root $relativePath
    if (-not (Test-Path -LiteralPath $source)) { throw "В проекте отсутствует обязательный файл: $relativePath" }
    Copy-Item -LiteralPath $source -Destination $stageRoot -Recurse -Force
  }

  $versionFile = Join-Path $stageRoot 'BUILD_VERSION.txt'
  @(
    "Продукт: $($package.name)",
    "Версия проекта: $($package.version)",
    "Версия сборки: $buildVersion",
    "Собрано: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
    'Windows: распакуйте ZIP и запустите install-deps.bat, затем start.bat.'
  ) | Set-Content -LiteralPath $versionFile -Encoding UTF8

  $lockedWsVersion = (& node.exe -p "require('./package-lock.json').packages['node_modules/ws'].version").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $lockedWsVersion) { throw 'Не удалось прочитать зафиксированную версию ws из package-lock.json.' }
  $localWs = Join-Path $root 'node_modules\ws'
  $localWsPackage = Join-Path $localWs 'package.json'
  $wsTarget = Join-Path $stageRoot 'node_modules\ws'
  if ((Test-Path -LiteralPath $localWsPackage) -and ((Get-Content -LiteralPath $localWsPackage -Raw | ConvertFrom-Json).version -eq $lockedWsVersion)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $wsTarget) -Force | Out-Null
    Copy-Item -LiteralPath $localWs -Destination $wsTarget -Recurse -Force
  } else {
    Write-Host 'Скачиваю производственные зависимости по package-lock.json...'
    Push-Location $stageRoot
    try {
      & npm.cmd ci --omit=dev --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw "npm ci завершился с кодом $LASTEXITCODE. Установите Node.js 18+ и npm, затем повторите сборку." }
    } finally { Pop-Location }
  }

  if (Test-Path -LiteralPath $archivePath) { throw "Архив уже существует: $archivePath" }
  Compress-Archive -LiteralPath $stageRoot -DestinationPath $archivePath -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  "$hash  $releaseName.zip" | Set-Content -LiteralPath (Join-Path $releaseDir "$releaseName.zip.sha256") -Encoding ASCII
  $releaseName | Set-Content -LiteralPath (Join-Path $releaseRoot 'latest.txt') -Encoding UTF8
  Write-Host ''
  Write-Host "Версия сборки: $buildVersion"
  Write-Host "ZIP: $archivePath"
  Write-Host "SHA-256: $hash"
  Write-Host 'В архив не включены игровые данные, секреты, локальный config.json, node_modules исходной папки, временные файлы и .git.'
  try {
    $releaseRootFull = [IO.Path]::GetFullPath($releaseRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $oldReleases = Get-ChildItem -LiteralPath $releaseRoot -Directory |
      Where-Object { $_.Name -match '^RustAndMagic-v.*-build-\d{8}-\d{6}-\d{3}$' } |
      Sort-Object Name -Descending | Select-Object -Skip 3
    foreach ($old in $oldReleases) {
      $oldFull = [IO.Path]::GetFullPath($old.FullName)
      if (-not $oldFull.StartsWith($releaseRootFull, [StringComparison]::OrdinalIgnoreCase)) { throw "Отказ от удаления вне папки релизов: $oldFull" }
      Remove-Item -LiteralPath $oldFull -Recurse -Force
      Write-Host "Удалён старый релиз: $($old.Name)"
    }
  } catch {
    Write-Warning "Не удалось полностью очистить старые релизы: $($_.Exception.Message)"
  }
} finally {
  if (Test-Path -LiteralPath $stageParent) { Remove-Item -LiteralPath $stageParent -Recurse -Force }
}
