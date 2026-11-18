@echo off
chcp 65001 >nul
title AI 打工人 · 接入 DSH
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没有找到 Node.js
  echo   请先安装：https://nodejs.org/  ^(选 LTS 版本，需要 22.15+^)
  echo.
  pause
  exit /b
)

echo.
echo   正在启动：3D 页面 + DSH 实时接入
echo   浏览器会自动打开；没打开就手动访问下面打印的地址
echo.
node app.mjs 8123 8791
pause
