@echo off
setlocal
cd /d "%~dp0"

echo Clearing the "coming soon" placeholders...
echo.
call node fix-pages.js > fix-pages.log 2>&1
set RESULT=%errorlevel%

type fix-pages.log

echo.
if not "%RESULT%"=="0" (
  echo ============================================================
  echo   Something above did not work. The same text is saved in
  echo   fix-pages.log next to this file - I can read that myself.
  echo ============================================================
) else (
  echo ============================================================
  echo   Done. Reload the hub - Ctrl+F5 - and the two pages should
  echo   open properly instead of showing "next on the list".
  echo ============================================================
)
echo.
pause
