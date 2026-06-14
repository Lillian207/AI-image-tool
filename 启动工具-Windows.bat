@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=8788
set URL=http://127.0.0.1:%PORT%/

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，请先安装 Node.js LTS 版本：https://nodejs.org/
  pause
  exit /b 1
)

netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo 工具已经在运行：%URL%
  start "" "%URL%"
  exit /b 0
)

start "" "%URL%"
node server.js
pause
