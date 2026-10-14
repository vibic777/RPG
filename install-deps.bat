@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Подготовка игры к запуску

where powershell.exe >nul 2>nul || (echo PowerShell не найден. Требуется Windows 10/11 с PowerShell. & pause & exit /b 1)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-deps.ps1"
if errorlevel 1 (
  echo.
  echo Не удалось подготовить проект. См. сообщение выше.
  pause
  exit /b 1
)
echo.
echo Подготовка завершена. Теперь запустите start.bat.
pause
exit /b 0
