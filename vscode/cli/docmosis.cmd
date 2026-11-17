@echo off
rem The docmosis command shipped inside the HMCTS Template Preview extension.
rem Uses the user's Node when it is 24 or newer, otherwise the Node inside VS Code
rem (DOCMOSIS_VSCODE_NODE, set by the extension).
setlocal
set "CLI=%~dp0docmosis-cli.mjs"
set "NODE_USE_ENV_PROXY=1"
set "MAJOR="
if not defined DOCMOSIS_FORCE_VSCODE_NODE (
    for /f %%v in ('node -p "parseInt(process.versions.node)" 2^>nul') do set "MAJOR=%%v"
)
if defined MAJOR if %MAJOR% GEQ 24 (
    node --use-system-ca "%CLI%" %*
    exit /b %ERRORLEVEL%
)
if defined DOCMOSIS_VSCODE_NODE if exist "%DOCMOSIS_VSCODE_NODE%" (
    set "ELECTRON_RUN_AS_NODE=1"
    set "FLAG="
    for /f %%v in ('"%DOCMOSIS_VSCODE_NODE%" -p "process.allowedNodeEnvironmentFlags.has('--use-system-ca') ? '--use-system-ca' : ''" 2^>nul') do set "FLAG=%%v"
    "%DOCMOSIS_VSCODE_NODE%" %FLAG% "%CLI%" %*
    exit /b %ERRORLEVEL%
)
echo docmosis: needs Node 24 or newer on PATH, or a terminal opened in VS Code after the HMCTS Template Preview extension activated 1>&2
exit /b 1
