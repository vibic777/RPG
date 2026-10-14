@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Nasledie Rzhavchiny i Magii - server

if /i "%~1"=="-h" goto help
if /i "%~1"=="--help" goto help
if "%~1"=="/?" goto help

where node >nul 2>nul
if errorlevel 1 (
  if not exist "%~dp0install-deps.bat" (echo Node.js не найден. Запустите install-deps.bat или установите Node.js 18+ с https://nodejs.org & pause & exit /b 1)
  call "%~dp0install-deps.bat"
  set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
)
where node >nul 2>nul || (echo Node.js 18+ не найден. Запустите install-deps.bat или установите Node.js с https://nodejs.org & pause & exit /b 1)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
if errorlevel 1 (
  call "%~dp0install-deps.bat"
  set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 18 ? 0 : 1)"
  if errorlevel 1 (echo Нужен Node.js версии 18 или новее. Запустите install-deps.bat. & pause & exit /b 1)
)
node -e "try { process.exit(require('./node_modules/ws/package.json').version === require('./package-lock.json').packages['node_modules/ws'].version ? 0 : 1) } catch { process.exit(1) }"
if errorlevel 1 (
  echo Установка зависимостей...
  call npm ci --no-audit --no-fund || (echo Ошибка npm ci & pause & exit /b 1)
)

rem Первый аргумент-число — порт; остальные аргументы передаются серверу
set "PORTARG="
echo(%~1| findstr /r /x "[0-9][0-9]*" >nul && set "PORTARG=--port %~1"
if defined PORTARG (
  node server\index.js --open %PORTARG% %2 %3 %4 %5 %6 %7 %8 %9
) else (
  node server\index.js --open %*
)
pause
exit /b

:help
echo Запуск сервера игры «Наследие Ржавчины и Магии» и открытие браузера.
echo.
echo Использование:
echo   start.bat [порт] [параметры сервера]
echo.
echo   порт            номер порта (по умолчанию 3333, или из config.json / PORT)
echo   -h, --help, /?  показать эту справку
echo.
echo Примеры:
echo   start.bat
echo   start.bat 3100
echo   start.bat 3100 --auto-port
echo   start.bat --data D:\rpg-data
echo.
echo Все параметры сервера:
node server\index.js --help
exit /b 0
