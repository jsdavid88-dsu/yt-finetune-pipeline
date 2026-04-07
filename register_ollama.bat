@echo off
chcp 65001 >nul
echo === Register LoRA to Ollama ===

set "ROOT=%~dp0"

:: Find the first project with a lora folder
for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\lora\adapter_config.json" (
        set "LORA_DIR=%%d\adapters\lora"
        for %%n in (%%d) do set "PROJECT=%%~nn"
        goto :found
    )
)

echo ERROR - No LoRA adapter found. Train a model first.
pause
exit /b 1

:found
echo Found LoRA: %LORA_DIR%
echo.

echo Method 1: Ollama experimental safetensors import...
ollama create storyforge-%PROJECT% %LORA_DIR% --experimental -q q4_K_M 2>nul
if not errorlevel 1 goto :success

echo Method 1 failed. Trying Method 2...
echo.

echo Creating Modelfile with Ollama model reference...
echo FROM gemma4:latest> "%LORA_DIR%\Modelfile"
echo ADAPTER %LORA_DIR%>> "%LORA_DIR%\Modelfile"

ollama create storyforge-%PROJECT% -f "%LORA_DIR%\Modelfile" 2>nul
if not errorlevel 1 goto :success

echo Method 2 failed. Trying Method 3 (no experimental)...
echo.

ollama create storyforge-%PROJECT% -f "%LORA_DIR%\Modelfile" --experimental 2>nul
if not errorlevel 1 goto :success

echo.
echo All methods failed.
echo Try manually: ollama create storyforge-%PROJECT% %LORA_DIR%
echo.
pause
exit /b 1

:success
echo.
echo === Done! ===
echo Model: storyforge-%PROJECT%
echo.
echo Test it: ollama run storyforge-%PROJECT% "hello"
echo.
pause
