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

echo Creating Modelfile...
echo FROM gemma4> "%LORA_DIR%\Modelfile"
echo ADAPTER %LORA_DIR%>> "%LORA_DIR%\Modelfile"

echo Modelfile:
type "%LORA_DIR%\Modelfile"
echo.

echo Registering with Ollama (experimental safetensors)...
ollama create storyforge-%PROJECT% -f "%LORA_DIR%\Modelfile" --experimental -q q4_K_M

if errorlevel 1 (
    echo.
    echo ERROR - Registration failed
) else (
    echo.
    echo === Done! ===
    echo Model: storyforge-%PROJECT%
    echo Test: ollama run storyforge-%PROJECT%
)

echo.
pause
