@echo off
chcp 65001 >nul
echo === Batch Collect (100 at a time, auto-retry) ===

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.train-venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    set "VENV_PY=python"
)

"%VENV_PY%" -u "%ROOT%backend\scripts\batch_collect.py" %*

pause
