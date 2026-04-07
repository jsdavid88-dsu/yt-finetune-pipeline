@echo off
chcp 65001 >nul
echo === Debug: unsloth_convert_hf_to_gguf.py ===

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%backend\.train-venv\Scripts\python.exe"
set "CONVERTER=C:\Users\%USERNAME%\.unsloth\llama.cpp\unsloth_convert_hf_to_gguf.py"
set "GGUF_DIR=%ROOT%backend\data\c7919b4a891d\adapters\gguf"

echo VENV_PY: %VENV_PY%
echo CONVERTER: %CONVERTER%
echo GGUF_DIR: %GGUF_DIR%
echo.

echo Files in gguf dir:
dir "%GGUF_DIR%" 2>nul
echo.

echo === Running converter directly ===
echo.
"%VENV_PY%" "%CONVERTER%" --outfile test.gguf --outtype bf16 "%GGUF_DIR%"
echo.
echo Exit code: %errorlevel%
echo.
pause
