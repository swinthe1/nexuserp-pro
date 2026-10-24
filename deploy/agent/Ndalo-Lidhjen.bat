@echo off
chcp 65001 >nul
schtasks /end /tn "NexusERP Lidhja" >nul 2>&1
schtasks /delete /tn "NexusERP Lidhja" /f
for /f "tokens=2" %%p in ('wmic process where "commandline like '%%NexusERP-Lidhja.ps1%%' and name='powershell.exe'" get processid ^| findstr /r "[0-9]"') do taskkill /pid %%p /f >nul 2>&1
echo Lidhja u ndal.
pause
