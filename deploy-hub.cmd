@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   VOX Hub  -  progress tracker and moving pack
echo ============================================================
echo.

echo [1 of 4] Installing function dependencies...
pushd functions
call npm install
set STEP=%errorlevel%
popd
if not "%STEP%"=="0" goto fail
echo.

echo [2 of 4] Deploying functions and security rules...
echo          (this is the slow one - a few minutes is normal)
echo          (--force clears out the four functions that were wrongly
echo           deployed to us-central1 on 20 Oct - without it they stay
echo           behind and the hourly sync runs twice, in two regions)
call firebase deploy --only functions,firestore:rules --force
if errorlevel 1 goto fail
echo.

echo [3 of 4] Taking the two pages off "coming soon"...
call node fix-pages.js
if errorlevel 1 goto fail
echo.

echo [4 of 4] Publishing the pages to voxlondon.uk...
call git add -A
call git commit -m "Hub: progress tracker and moving pack" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01VSA8Qm1BpnP5jMNeFhhUhX"
call git push
if errorlevel 1 goto fail

echo.
echo ============================================================
echo   Done.
echo.
echo   Give GitHub Pages a minute or two, then open voxlondon.uk,
echo   sign in, and click Progress tracker. It will say it has not
echo   run yet - click "refresh now" and the numbers appear.
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo ============================================================
echo   STOPPED. The step above failed, and nothing after it ran.
echo   Copy what is on screen into the chat and I will fix it.
echo ============================================================
echo.
pause
exit /b 1
