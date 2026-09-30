@echo off
REM ---------------------------------------------------------------------------
REM  Starts the VOX London Hub on this machine. Double-click it.
REM
REM  Why this file exists: the hub is a set of plain files, so something has to
REM  serve them. When nothing is serving them the installed app still opens --
REM  the service worker replays the last copy it saved -- so it looks like it is
REM  working while showing code from days ago. Every change then appears to have
REM  been ignored. Leave this window open while you are using the hub.
REM ---------------------------------------------------------------------------
title VOX London Hub - leave this window open
cd /d "%~dp0"

echo.
echo   VOX London Hub
echo   ==============
echo.
echo   Serving this folder at  http://localhost:8080
echo.
echo   Leave this window open. Close it to stop the hub.
echo.

start "" http://localhost:8080

npx --yes http-server -p 8080 -c-1

echo.
echo   The hub has stopped.
pause
