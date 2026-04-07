@echo off
chcp 65001 >nul
echo === Register LoRA to Ollama ===

set "ROOT=%~dp0"

for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\lora\adapter_config.json" (
        set "LORA_DIR=%%d\adapters\lora"
        for %%n in (%%d) do set "PROJECT=%%~nn"
        goto :found
    )
)
echo ERROR - No LoRA adapter found.
pause
exit /b 1

:found
echo Found LoRA: %LORA_DIR%
echo.

echo Step 1: Checking Modelfile...
echo FROM gemma4:latest> "%LORA_DIR%\Modelfile"
echo ADAPTER %LORA_DIR%>> "%LORA_DIR%\Modelfile"
echo Modelfile contents:
type "%LORA_DIR%\Modelfile"
echo.

echo Step 2: Creating Ollama model...
ollama create storyforge-%PROJECT% -f "%LORA_DIR%\Modelfile"

echo.
echo Result: %errorlevel%
echo.

if errorlevel 1 (
    echo Failed. Showing error details...
    echo.
    echo Trying with --experimental flag...
    ollama create storyforge-%PROJECT% -f "%LORA_DIR%\Modelfile" --experimental
    echo.
    if errorlevel 1 (
        echo Still failed. Ollama version:
        ollama --version
        echo.
        echo Contents of lora dir:
        dir "%LORA_DIR%"
    ) else (
        echo === Success with --experimental! ===
        echo Model: storyforge-%PROJECT%
    )
) else (
    echo === Success! ===
    echo Model: storyforge-%PROJECT%
)

echo.
pause
