@echo off
REM ============================================================
REM  start_app.bat  --  BetterOSF local dev launcher
REM
REM  - Uses a fixed port (4747) so the URL is always the same.
REM  - Soft-kills anything already on that port.
REM  - Starts `next dev` in a new window.
REM  - Polls until the server responds, then opens the default
REM    browser to http://localhost:4747.
REM ============================================================

setlocal EnableDelayedExpansion
set PORT=4747
set URL=http://localhost:%PORT%

echo.
echo === BetterOSF dev launcher ===
echo Port: %PORT%
echo.

REM ---- 1. Soft-kill anything LISTENING on the port ----
set FOUND_PID=
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    set FOUND_PID=%%a
)
if defined FOUND_PID (
    echo Port %PORT% is occupied by PID !FOUND_PID! -- killing it.
    taskkill /F /PID !FOUND_PID! >nul 2>&1
    REM Give Windows a moment to release the socket
    timeout /t 1 /nobreak >nul
) else (
    echo Port %PORT% is free.
)

REM ---- 2. Check that dependencies are installed ----
if not exist "node_modules" (
    echo node_modules missing -- running npm install first ^(this may take a minute^)...
    call npm install
    if errorlevel 1 (
        echo npm install failed. Aborting.
        exit /b 1
    )
)

REM ---- 3. Start the dev server in a new console window ----
echo Starting Next.js dev server on port %PORT%...
start "BetterOSF dev (port %PORT%)" cmd /k "npx next dev -p %PORT%"

REM ---- 4. Poll until the server responds (up to 60 seconds) ----
echo Waiting for server to respond at %URL% ...
set /a tries=0
:wait
set /a tries+=1
if !tries! GTR 60 (
    echo.
    echo Timed out after 60 seconds. The dev window may still be starting --
    echo open %URL% manually once it shows "Ready".
    exit /b 1
)
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest %URL% -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop; if ($r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if errorlevel 1 goto wait

echo.
echo Server is ready. Opening %URL% in your default browser.
start "" %URL%

endlocal
