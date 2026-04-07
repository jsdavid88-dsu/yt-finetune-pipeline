@echo off
chcp 65001 >nul
echo === GGUF Conversion (Unsloth) ===

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
        echo.
        echo Cleaning old gguf dir...
        if exist "%%d\adapters\gguf" rmdir /s /q "%%d\adapters\gguf"
        if exist "%%d\adapters\merged_16bit" rmdir /s /q "%%d\adapters\merged_16bit"
        if exist "%%d\adapters\merged_full" rmdir /s /q "%%d\adapters\merged_full"
        echo.
        "%VENV_PY%" -u "%ROOT%backend\scripts\convert_gguf.py" --lora-dir "%%d\adapters\lora"
        goto :done
    )
)

echo ERROR - No LoRA adapter found. Train a model first.

:done
echo.
pause
