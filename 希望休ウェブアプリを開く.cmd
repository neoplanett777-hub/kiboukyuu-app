@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:3210
for %%I in ("%~dp0*.js") do node "%%~fI"
pause
