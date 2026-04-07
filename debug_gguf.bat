@echo off
chcp 65001 >nul
echo === Debug GGUF Conversion ===

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.train-venv\Scripts\python.exe"
set "MERGED_DIR=%ROOT%backend\data"

for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\merged_16bit\config.json" (
        set "MERGED_DIR=%%d\adapters\merged_16bit"
        goto :found
    )
    if exist "%%d\adapters\lora\config.json" (
        set "MERGED_DIR=%%d\adapters\lora"
        goto :found
    )
)
echo ERROR - No model found
pause
exit /b 1

:found
echo Model dir: %MERGED_DIR%
echo.
echo Files:
dir "%MERGED_DIR%\*.safetensors" "%MERGED_DIR%\config.json" 2>nul
echo.
echo === Running convert_hf_to_gguf.py (full error output) ===
echo.
"%VENV_PY%" C:\Users\%USERNAME%\.unsloth\llama.cpp\convert_hf_to_gguf.py --outtype bf16 "%MERGED_DIR%"
echo.
echo Exit code: %errorlevel%
echo.
pause
