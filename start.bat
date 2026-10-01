@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Konszenzus Idojaras indul...
node serve.mjs %1
pause
