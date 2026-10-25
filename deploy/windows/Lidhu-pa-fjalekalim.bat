@echo off
chcp 65001 >nul
set "KEY=%USERPROFILE%\.ssh\drispro"
if not exist "%KEY%" if exist "%USERPROFILE%\.ssh\nexuserp" (copy /y "%USERPROFILE%\.ssh\nexuserp" "%KEY%" >nul & copy /y "%USERPROFILE%\.ssh\nexuserp.pub" "%KEY%.pub" >nul 2>&1)
echo Kjo behet vetem njehere: krijon nje celes qe Perditeso-serverin.bat te mos kerkoje fjalekalim.
echo.
if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
if not exist "%KEY%" ssh-keygen -t ed25519 -N "" -C "drispro-%USERNAME%" -f "%KEY%"
if errorlevel 1 goto fail
echo.
echo Shkruani fjalekalimin e serverit (nuk duket kur shkruani) dhe shtypni Enter:
type "%KEY%.pub" | ssh root@31.97.47.9 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
if errorlevel 1 goto fail
ssh -i "%KEY%" -o BatchMode=yes root@31.97.47.9 "echo Lidhja pa fjalekalim punon."
if errorlevel 1 goto fail
echo.
pause
exit /b 0
:fail
echo.
echo DESHTOI. Bej nje screenshot te kesaj dritareje.
pause
exit /b 1
