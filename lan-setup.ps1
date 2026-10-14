# Настройка игры по локальной сети (Windows): спрашивает IP-адрес и порт сервера, разрешает порт в брандмауэре
# (правило «Nasledie RPG server TCP <порт>» для всех профилей сети — то же, что firewall-allow.bat) и проверяет, отвечает ли сервер.
# Запуск: lan-setup.bat [IP] [порт]   или   lan-setup.bat --help
param([string]$Ip = '', [string]$Port = '', [switch]$Help, [switch]$NoPause, [switch]$Ping)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Done([int]$code) { if (-not $NoPause) { Write-Host ''; Read-Host 'Нажмите Enter, чтобы закрыть окно' | Out-Null }; exit $code }

if ($Help -or $Ip -in @('-h', '--help', '/?')) {
  Write-Host @'
lan-setup.bat [IP] [порт] — настройка игры по локальной сети (LAN, Wi-Fi, VPN) на Windows.
  1. Показывает адреса этого ПК и тип сети (частная / общественная).
  2. Спрашивает IP-адрес сервера (Enter — предложенный) и порт (Enter — из config.json или 3333).
  3. Запрашивает права администратора (окно UAC) и добавляет правило брандмауэра
     «Nasledie RPG server TCP <порт>» для всех профилей сети (то же, что firewall-allow.bat).
  4. По желанию разрешает ping (ICMP) — чтобы проверить связь с другого ПК.
  5. Проверяет, что сервер слушает порт и отвечает по http://IP:порт/, и печатает, что делать дальше.
Примеры:
  lan-setup.bat                      — всё спросит
  lan-setup.bat 192.168.15.100 3333  — без вопросов
Убрать правило (PowerShell от администратора):
  Remove-NetFirewallRule -DisplayName "Nasledie RPG server TCP 3333"
'@
  Done 0
}

# Адреса этого ПК: IPv4 без локальных 127.* и 169.254.*, с типом сети интерфейса
$profiles = @{}
try { Get-NetConnectionProfile | ForEach-Object { $profiles[$_.InterfaceIndex] = [string]$_.NetworkCategory } } catch {}
$addrs = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | ForEach-Object {
  $cat = $profiles[$_.InterfaceIndex]; $ru = switch ($cat) { 'Private' { 'частная' } 'Public' { 'общественная' } 'DomainAuthenticated' { 'доменная' } default { 'без доступа к сети' } }
  [pscustomobject]@{ IP = $_.IPAddress; Name = $_.InterfaceAlias; Cat = $cat; Ru = $ru; Gw = [bool](Get-NetRoute -InterfaceIndex $_.InterfaceIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue) }
})
Write-Host 'Адреса этого ПК:'
foreach ($a in $addrs) { Write-Host ('  {0,-16} {1}  (сеть: {2}{3})' -f $a.IP, $a.Name, $a.Ru, $(if ($a.Gw) { ', с выходом в интернет' } else { '' })) }
$guess = ($addrs | Where-Object { $_.Gw -and $_.IP -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' } | Select-Object -First 1)
if (-not $guess) { $guess = $addrs | Select-Object -First 1 }
$defIp = if ($guess) { $guess.IP } else { '' }

$defPort = 3333
try { $cfg = Get-Content -Raw -LiteralPath (Join-Path $root 'config.json') -ErrorAction Stop | ConvertFrom-Json; if ($cfg.port) { $defPort = [int]$cfg.port } } catch {}
if ($env:PORT -match '^\d+$') { $defPort = [int]$env:PORT }

while ($true) {
  if (-not $Ip) { $Ip = Read-Host "IP-адрес сервера, по которому зайдут друзья (Enter — $defIp)"; if (-not $Ip) { $Ip = $defIp } }
  $parsed = $null
  if ([Net.IPAddress]::TryParse($Ip.Trim(), [ref]$parsed) -and $parsed.AddressFamily -eq 'InterNetwork' -and $Ip.Trim() -match '^\d+\.\d+\.\d+\.\d+$') { $Ip = $Ip.Trim(); break }
  Write-Host "Это не IPv4-адрес: «$Ip». Пример: 192.168.1.10"; $Ip = ''
}
while ($true) {
  if (-not $Port) { $Port = Read-Host "Порт сервера (Enter — $defPort)"; if (-not $Port) { $Port = "$defPort" } }
  if ($Port -match '^\d+$' -and [int]$Port -ge 1 -and [int]$Port -le 65535) { $Port = [int]$Port; break }
  Write-Host "Порт — число от 1 до 65535, а не «$Port»."; $Port = ''
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $allowPing = (Read-Host 'Разрешить и ping (ICMP) для проверки связи с другого ПК? (д/Н)') -match '^(д|y|да|yes)$'
  Write-Host 'Нужны права администратора — Windows спросит разрешение (UAC)...'
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Ip', $Ip, '-Port', "$Port")
  if ($allowPing) { $args2 += '-Ping' }
  try { Start-Process -FilePath 'powershell.exe' -ArgumentList $args2 -Verb RunAs -Wait } catch { Write-Host 'Права администратора не выданы — правило не добавлено.'; Done 1 }
  Done 0
}

# --- от администратора ---
$name = "Nasledie RPG server TCP $Port"
Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Description 'Игра «Наследие ржавчины и магии» по сети: вход для локальной сети и VPN' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain,Private,Public | Out-Null
Write-Host "Готово: брандмауэр пропускает TCP-порт $Port во всех сетях (правило «$name»)."
if ($Ping) {
  $pn = 'Nasledie RPG ping (ICMPv4)'
  Get-NetFirewallRule -DisplayName $pn -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $pn -Direction Inbound -Protocol ICMPv4 -IcmpType 8 -Action Allow -Profile Domain,Private,Public | Out-Null
  Write-Host "Ping разрешён (правило «$pn»)."
}

$mine = $addrs | Where-Object { $_.IP -eq $Ip } | Select-Object -First 1
if (-not $mine) { Write-Host "Внимание: адрес $Ip не принадлежит этому ПК. Сервер должен работать на ПК с этим адресом — запустите lan-setup.bat там." }
elseif ($mine.Cat -eq 'Public') { Write-Host "Сеть «$($mine.Name)» отмечена как общественная — правило действует и в ней." }

$listen = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($listen.Count) { Write-Host ('Порт {0} слушает: {1}' -f $Port, (($listen | ForEach-Object { $_.LocalAddress }) -join ', ')) }
if ($listen.Count -and -not ($listen | Where-Object { $_.LocalAddress -in @('0.0.0.0', '::', $Ip) })) { Write-Host 'Сервер слушает только локальный адрес — уберите "host" из config.json (по умолчанию 0.0.0.0) и перезапустите.' }
$ok = $false
try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://${Ip}:$Port/"; $ok = $r.StatusCode -eq 200 } catch {}
if ($ok) { Write-Host "Сервер отвечает: http://${Ip}:$Port/" }
else { Write-Host "Сервер не отвечает по http://${Ip}:$Port/ — запустите start.bat $Port на этом ПК и проверьте снова." }

Write-Host ''
Write-Host 'На другом ПК:'
Write-Host "  1. Откройте в браузере http://${Ip}:$Port/"
Write-Host "  2. Не открывается — в PowerShell: Test-NetConnection $Ip -Port $Port   (TcpTestSucceeded должно быть True)"
Write-Host "  3. Адрес другого ПК должен быть в той же сети (обычно совпадают первые три числа: $($Ip -replace '\.\d+$', '.x'))."
Write-Host '  4. Мешать могут: гостевая Wi-Fi или «изоляция клиентов» в роутере, включённый VPN, сторонний антивирус с брандмауэром.'
Done 0
