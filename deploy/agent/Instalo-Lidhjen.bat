@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "%~dp0lidhja.json" (
  echo Nisni fillimisht Nis-Lidhjen.bat qe te krijohet lidhja.json dhe te behet ngarkimi i pare.
  pause
  exit /b 1
)
echo Lidhja do te punoje vete ne sfond, edhe pas rinisjes se serverit.
echo Windows do te kerkoje fjalekalimin e llogarise %USERDOMAIN%\%USERNAME% (ajo qe hap SQL Server).
rem the task of the older name (NexusERP) is replaced by this one
schtasks /end /tn "NexusERP Lidhja" >nul 2>&1
schtasks /delete /tn "NexusERP Lidhja" /f >nul 2>&1
schtasks /create /tn "DrisPRO Lidhja" /tr "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0DrisPRO-Lidhja.ps1\" -Service" /sc minute /mo 5 /ru "%USERDOMAIN%\%USERNAME%" /rp * /rl highest /f
if errorlevel 1 (
  echo INSTALIMI DESHTOI. Bej nje screenshot te kesaj dritareje.
) else (
  schtasks /run /tn "DrisPRO Lidhja" >nul
  echo U INSTALUA. Kontrolloni lidhja.log ne kete dosje pas nje minute.
)
pause
