@echo off
rem The docmosis command shipped inside the HMCTS Template Preview extension.
rem Uses the user's Node when it is 24 or newer, otherwise the Node inside VS Code.
rem The extension's stub names that Node in DOCMOSIS_VSCODE_NODE, and says in
rem DOCMOSIS_VSCODE_NODE_FLAGS and DOCMOSIS_VSCODE_NODE_PROXY what it supports.
rem No command that runs node sits inside a parenthesised block: cmd expands the error level
rem and the arguments in a block before it runs, and a closing bracket in an argument would end it early.
setlocal
set "CLI=%~dp0docmosis-cli.mjs"
set "NODE_USE_ENV_PROXY=1"
if defined DOCMOSIS_FORCE_VSCODE_NODE goto vscode
node -e "process.exit(parseInt(process.versions.node)>=24?0:1)" >nul 2>nul
if errorlevel 1 goto vscode
node --use-system-ca "%CLI%" %*
exit /b

:vscode
if not defined DOCMOSIS_VSCODE_NODE goto missing
if not exist "%DOCMOSIS_VSCODE_NODE%" goto missing
set "ELECTRON_RUN_AS_NODE=1"
if "%DOCMOSIS_VSCODE_NODE_PROXY%"=="1" goto run
if defined HTTPS_PROXY goto warn
if defined HTTP_PROXY goto warn
goto run

:warn
echo docmosis: the Node in VS Code ignores HTTPS_PROXY and HTTP_PROXY; install Node 24 or newer on PATH to use the proxy 1>&2

:run
"%DOCMOSIS_VSCODE_NODE%" %DOCMOSIS_VSCODE_NODE_FLAGS% "%CLI%" %*
exit /b

:missing
echo docmosis: needs Node 24 or newer on PATH, or a terminal opened in VS Code after the HMCTS Template Preview extension activated 1>&2
exit /b 1
