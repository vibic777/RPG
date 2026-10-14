@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem Настройка игры по локальной сети: спросит IP и порт сервера, разрешит порт в брандмауэре (UAC), проверит сервер.
rem lan-setup.bat [IP] [порт]   |   lan-setup.bat --help
if /i "%~1"=="-h" goto help
if /i "%~1"=="--help" goto help
if "%~1"=="/?" goto help
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lan-setup.ps1" %*
exit /b %errorlevel%
:help
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lan-setup.ps1" -Help -NoPause
exit /b 0
