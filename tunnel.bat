@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM  Elindítja a helyi szervert, majd egy nyilvános https-alagutat nyit hozzá,
REM  hogy a telefonról bárhonnan elérd — nem csak otthoni Wi-Fin.
REM
REM  FIGYELEM: az így kapott cím nyilvános. Aki ismeri a linket, megnyithatja.
REM  Az app nem tárol rólad semmit a gépen (a helyed a telefonod böngészőjében
REM  marad), de a link megosztásával a gépeden futó szervert teszed elérhetővé.
REM
REM  A cím minden indításkor más. Az alagút csak addig él, amíg ez az ablak nyitva van.

set PORT=8099
if not "%1"=="" set PORT=%1

echo.
echo  [1/2] Helyi szerver indul a %PORT% porton...
start "Konszenzus Idojaras - szerver" /min cmd /c "node serve.mjs %PORT%"

timeout /t 3 /nobreak >nul

echo  [2/2] Nyilvanos alagut nyitasa...
echo.
echo  Az alabbi "Forwarding HTTP traffic from https://..." sorban levo cimet
echo  ird be a telefonod bongeszojebe.
echo.
echo  Leallitas: Ctrl+C, majd zard be a szerver ablakot is.
echo.

ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=20 -R 80:localhost:%PORT% serveo.net

echo.
echo  Az alagut lezarult.
pause
