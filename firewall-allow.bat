@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if /i "%~1"=="-h" goto help
if /i "%~1"=="--help" goto help
if "%~1"=="/?" goto help
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3333"
echo %PORT%| findstr /R "^[0-9][0-9]*$" >nul || (echo Порт должен быть числом: %PORT% & pause & exit /b 1)

rem Нужны права администратора: если их нет — перезапуск с запросом UAC
net session >nul 2>&1
if errorlevel 1 (
  echo Нужны права администратора — Windows спросит разрешение...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%PORT%' -Verb RunAs"
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$n = 'Nasledie RPG server TCP %PORT%';" ^
  "Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue | Remove-NetFirewallRule;" ^
  "New-NetFirewallRule -DisplayName $n -Description 'Игра «Наследие ржавчины и магии»: вход друзей по локальной сети и VPN' -Direction Inbound -Protocol TCP -LocalPort %PORT% -Action Allow -Profile Domain,Private,Public | Out-Null;" ^
  "Get-NetFirewallRule -DisplayName $n | Format-Table DisplayName,Enabled,Direction,Action,Profile -AutoSize"
if errorlevel 1 (echo Не удалось добавить правило брандмауэра. & pause & exit /b 1)
echo.
echo Готово: входящие подключения на TCP-порт %PORT% разрешены (частные, общественные и доменные сети).
echo Друзья заходят по адресу http://^<IP этого компьютера^>:%PORT% — адреса печатает start.bat при запуске.
echo Убрать правило: firewall-allow.bat --help
pause
exit /b 0

:help
echo firewall-allow.bat [порт] — разрешить в брандмауэре Windows вход на порт сервера (по умолчанию 3333).
echo   Нужен, если друзья в локальной сети или VPN не могут открыть http://^<IP^>:3333,
echo   а на этом компьютере игра открывается. Запросит права администратора.
echo   Пример: firewall-allow.bat 3334
echo   Пошагово, с вопросами про IP и порт и проверкой сервера: lan-setup.bat
echo Убрать правило (PowerShell от администратора):
echo   Remove-NetFirewallRule -DisplayName "Nasledie RPG server TCP 3333"
exit /b 0
