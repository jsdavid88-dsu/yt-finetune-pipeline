@echo off
chcp 65001 >nul
echo === Merge + Register to Ollama ===

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.train-venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo ERROR - .train-venv not found. Run training first.
    pause
    exit /b 1
)

for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\lora\adapter_config.json" (
        echo Found LoRA: %%d\adapters\lora
        "%VENV_PY%" -u "%ROOT%backend\scripts\merge_and_register.py" --lora-dir "%%d\adapters\lora"
        goto :done
    )
)

echo ERROR - No LoRA adapter found. Train a model first.

:done
echo.
pause
