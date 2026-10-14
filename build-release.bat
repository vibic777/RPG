@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Сборка ZIP «Наследие Ржавчины и Магии»

where powershell.exe >nul 2>nul || (echo PowerShell не найден. Требуется Windows 10/11 с PowerShell. & pause & exit /b 1)
where node.exe >nul 2>nul || (echo Node.js не найден. Сначала запустите install-deps.bat. & pause & exit /b 1)
where npm.cmd >nul 2>nul || (echo npm не найден. Переустановите Node.js через install-deps.bat. & pause & exit /b 1)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-release.ps1"
if errorlevel 1 (
  echo.
  echo Сборка не завершена. Проверьте сообщение выше.
  pause
  exit /b 1
)
echo.
pause
exit /b 0
