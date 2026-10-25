@echo off
chcp 65001 >nul
set DEST=%~dp0Kopjet
if not exist "%DEST%" mkdir "%DEST%"
echo Po marr kopjet e databazes nga serveri (31.97.47.9) ne %DEST% ...
echo Kur te kerkohet, shkruani fjalekalimin e serverit (nuk duket kur shkruani) dhe shtypni Enter.
echo.
scp "root@31.97.47.9:/root/backups/drispro-*.dump" "%DEST%\"
if errorlevel 1 (
  echo.
  echo MARRJA DESHTOI. Bej nje screenshot te kesaj dritareje.
) else (
  echo.
  echo U MORREN. Kopjet jane te dosja Kopjet. Mbajini edhe ne nje disk tjeter ose ne cloud.
)
echo.
pause
