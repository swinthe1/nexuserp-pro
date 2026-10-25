@echo off
chcp 65001 >nul
schtasks /end /tn "DrisPRO Lidhja" >nul 2>&1
schtasks /delete /tn "DrisPRO Lidhja" /f
schtasks /end /tn "NexusERP Lidhja" >nul 2>&1
schtasks /delete /tn "NexusERP Lidhja" /f >nul 2>&1
for %%n in (DrisPRO-Lidhja.ps1 NexusERP-Lidhja.ps1) do for /f "tokens=2" %%p in ('wmic process where "commandline like '%%%%n%%' and name='powershell.exe'" get processid ^| findstr /r "[0-9]"') do taskkill /pid %%p /f >nul 2>&1
echo Lidhja u ndal.
pause
