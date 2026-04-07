@echo off
chcp 65001 >nul
echo === GGUF Conversion ===

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.train-venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
    echo ERROR - .train-venv not found. Run training first.
    pause
    exit /b 1
)

:: Find the first project with a lora folder
for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\lora\adapter_config.json" (
        echo Found LoRA: %%d\adapters\lora
        "%VENV_PY%" "%ROOT%backend\scripts\convert_gguf.py" --lora-dir "%%d\adapters\lora"
        goto :done
    )
)

echo ERROR - No LoRA adapter found. Train a model first.
pause
exit /b 1

:done
echo.
echo Press any key to close...
pause >nul
