@echo off
chcp 65001 >nul
set "KEY=%USERPROFILE%\.ssh\drispro"
set "SSHOPT="
if exist "%KEY%" set "SSHOPT=-i "%KEY%""
echo ==============================================================
echo  DrisPRO - Cloudflare per adresat nga jashte te serverave lokale
echo  (https://emri.dris-ks.com per cdo server lokal, krijohen vete)
echo.
echo  Ne Cloudflare: My Profile - API Tokens - Create Token - Custom:
echo    Account / Cloudflare Tunnel / Edit
echo    Zone / DNS / Edit  (zona dris-ks.com)
echo  Pastaj ngjiteni celesin kur ta kerkoje (klikimi i djathte ngjit).
echo  Celesi nuk shfaqet ne ekran dhe nuk ruhet ne kete kompjuter.
echo  Account ID dhe Zone ID jane te dris-ks.com - Overview, djathtas.
echo ==============================================================
if not exist "%KEY%" echo Do te kerkohet fjalekalimi i serverit.
echo.
ssh -t %SSHOPT% root@31.97.47.9 "DRISPRO_DB=supabase-db-pehplyy59who1lxdgdxgzxag bash /root/drispro/deploy/coolify/update.sh --cloudflare"
if errorlevel 1 goto fail
echo.
echo U RUAJT. Brenda nje minute DrisPRO krijon adresat per serverat lokale qe e kerkojne.
echo.
pause
exit /b 0
:fail
echo.
echo DIQKA DESHTOI. Nisni njehere Perditeso-serverin.bat dhe provoni perseri, ose beni nje screenshot te kesaj dritareje.
pause
exit /b 1
