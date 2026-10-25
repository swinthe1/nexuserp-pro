@echo off
chcp 65001 >nul
set "KEY=%USERPROFILE%\.ssh\nexuserp"
set "SSHOPT="
if exist "%KEY%" set "SSHOPT=-i "%KEY%""
echo ==============================================================
echo  DrisPRO - perditesimi i serverit (31.97.47.9)
echo  1. dergon drispro-deploy.zip
echo  2. ben ndryshimet ne databaze
echo  3. nis Redeploy ne Coolify (nese eshte rregulluar)
echo ==============================================================
if not exist "%KEY%" echo Do te kerkohet fjalekalimi i serverit dy here. Per ta shmangur, nisni njehere Lidhu-pa-fjalekalim.bat
set "ZIP=%~dp0drispro-deploy.zip"
if not exist "%ZIP%" set "ZIP=%~dp0nexuserp-pro-deploy.zip"
if not exist "%ZIP%" (echo Mungon drispro-deploy.zip ne kete dosje. & goto fail)
echo.
scp %SSHOPT% "%ZIP%" root@31.97.47.9:/root/nexuserp-pro-deploy.zip
if errorlevel 1 goto fail
ssh %SSHOPT% root@31.97.47.9 "cd /root && rm -rf nexuserp-pro && unzip -q nexuserp-pro-deploy.zip && NEXUS_DB=supabase-db-pehplyy59who1lxdgdxgzxag bash nexuserp-pro/deploy/coolify/update.sh"
if errorlevel 1 goto fail
echo.
echo PERFUNDOI. Pas 2-3 minutash hapni aplikacionin dhe shtypni Ctrl+Shift+R.
echo.
pause
exit /b 0
:fail
echo.
echo DIQKA DESHTOI. Bej nje screenshot te kesaj dritareje.
pause
exit /b 1
