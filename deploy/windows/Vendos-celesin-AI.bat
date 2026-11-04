@echo off
chcp 65001 >nul
set "KEY=%USERPROFILE%\.ssh\drispro"
set "SSHOPT="
if exist "%KEY%" set "SSHOPT=-i "%KEY%""
echo ==============================================================
echo  DrisPRO - celesi i Anthropic per asistentin dhe leximin e faturave
echo  Ngjiteni celesin kur ta kerkoje (klikimi i djathte ngjit).
echo  Nuk shfaqet ne ekran dhe nuk ruhet ne kete kompjuter.
echo ==============================================================
if not exist "%KEY%" echo Do te kerkohet fjalekalimi i serverit.
echo.
ssh -t %SSHOPT% root@31.97.47.9 "DRISPRO_DB=supabase-db-pehplyy59who1lxdgdxgzxag bash /root/drispro/deploy/coolify/update.sh --ai"
if errorlevel 1 goto fail
echo.
echo U RUAJT. Hapni aplikacionin dhe provoni asistentin me Ctrl+J.
echo.
pause
exit /b 0
:fail
echo.
echo DIQKA DESHTOI. Nisni njehere Perditeso-serverin.bat dhe provoni perseri, ose beni nje screenshot te kesaj dritareje.
pause
exit /b 1
