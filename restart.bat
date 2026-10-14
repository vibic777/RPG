@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Nasledie Rzhavchiny i Magii - restart
if /i "%~1"=="-h" goto help
if /i "%~1"=="--help" goto help
if "%~1"=="/?" goto help
where node >nul 2>nul || (echo Node.js не найден. & pause & exit /b 1)
node "%~dp0server\tools\restart.js" %*
if errorlevel 1 (echo Перезапуск отменён. & pause & exit /b 1)
call "%~dp0start.bat" %*
exit /b %errorlevel%
:help
echo Перезапуск сервера с сохранением игроков и открытием браузера.
echo Использование: restart.bat [порт] [параметры сервера]
echo Примеры: restart.bat, restart.bat 3100, restart.bat --data D:\rpg-data
exit /b 0
