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

echo === Method: Ollama ADAPTER import ===
echo.

echo Creating Modelfile...
(
echo FROM gemma4
echo ADAPTER %LORA_DIR%
) > "%LORA_DIR%\Modelfile"

echo --- Modelfile ---
type "%LORA_DIR%\Modelfile"
echo.
echo -----------------
echo.

echo Running: ollama create storyforge-%PROJECT% -f Modelfile
cd /d "%LORA_DIR%"
ollama create storyforge-%PROJECT% -f Modelfile

if errorlevel 1 (
    echo.
    echo === Method 1 failed. Trying with absolute path in FROM ===
    echo.

    (
    echo FROM gemma4:latest
    echo ADAPTER %LORA_DIR%
    ) > "%LORA_DIR%\Modelfile"

    ollama create storyforge-%PROJECT% -f Modelfile

    if errorlevel 1 (
        echo.
        echo === Both methods failed ===
        echo.
        echo Ollama version:
        ollama --version
        echo.
        echo Try updating Ollama: winget upgrade Ollama.Ollama
        echo Or try: ollama create storyforge-%PROJECT% -f "%LORA_DIR%\Modelfile"
    ) else (
        echo.
        echo === Success! ===
        echo Model: storyforge-%PROJECT%
    )
) else (
    echo.
    echo === Success! ===
    echo Model: storyforge-%PROJECT%
)

echo.
pause
