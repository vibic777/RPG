$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

function Get-NodeVersion {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { return $null }
  try {
    $value = (& $nodeCommand.Source --version 2>$null).Trim().TrimStart('v')
    return [version]$value
  } catch { return $null }
}

$nodeVersion = Get-NodeVersion
if (-not $nodeVersion -or $nodeVersion.Major -lt 18) {
  Write-Host 'Node.js 18 или новее не найден. Загружаю актуальный выпуск Node.js LTS с nodejs.org...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $releaseIndex = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 45
  $release = $releaseIndex | Where-Object { $_.lts } | Select-Object -First 1
  if (-not $release) { throw 'Не удалось определить актуальный выпуск Node.js LTS.' }
  $arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
  $msiName = "node-$($release.version)-$arch.msi"
  $msiPath = Join-Path $env:TEMP $msiName
  $msiUrl = "https://nodejs.org/dist/$($release.version)/$msiName"
  Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing -TimeoutSec 180
  Write-Host "Запускаю установщик $msiName. Windows может запросить подтверждение установки."
  $install = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"$msiPath`"", '/passive', '/norestart') -Wait -PassThru
  if ($install.ExitCode -notin @(0, 3010)) { throw "Установщик Node.js завершился с кодом $($install.ExitCode)." }
  Remove-Item -LiteralPath $msiPath -Force -ErrorAction SilentlyContinue
}

$nodePaths = @(
  (Join-Path $env:ProgramFiles 'nodejs'),
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs'),
  (Join-Path $env:APPDATA 'npm')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$env:Path = (($nodePaths -join ';') + ';' + $env:Path)
$nodeVersion = Get-NodeVersion
if (-not $nodeVersion -or $nodeVersion.Major -lt 18) { throw 'Установка завершилась, но Node.js 18+ не найден. Закройте окно и запустите install-deps.bat снова.' }
Write-Host "Node.js $nodeVersion найден."

$lockedWsVersion = (& node.exe -p "require('./package-lock.json').packages['node_modules/ws'].version").Trim()
$installedWsVersion = $null
$installedWsPackage = Join-Path $projectRoot 'node_modules\ws\package.json'
if (Test-Path -LiteralPath $installedWsPackage) {
  try { $installedWsVersion = (Get-Content -LiteralPath $installedWsPackage -Raw | ConvertFrom-Json).version } catch { $installedWsVersion = $null }
}
if ($installedWsVersion -ne $lockedWsVersion) {
  Write-Host 'Скачиваю зависимости проекта по package-lock.json...'
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci завершился с кодом $LASTEXITCODE." }
} else {
  Write-Host 'Зависимости проекта уже установлены.'
}

Write-Host 'Готово. Запустите start.bat.'
