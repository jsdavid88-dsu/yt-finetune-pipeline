@echo off
chcp 65001 >nul
echo === Register LoRA to Ollama ===

set "ROOT=%~dp0"

:: Find the first project with a lora folder
for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\lora\adapter_config.json" (
        echo Found LoRA: %%d\adapters\lora

        echo Creating Modelfile...
        echo FROM gemma4 > "%%d\adapters\lora\Modelfile"
        echo ADAPTER . >> "%%d\adapters\lora\Modelfile"

        echo Registering with Ollama...
        for %%n in (%%d) do set "PROJECT=%%~nn"
        ollama create storyforge-%PROJECT% -f "%%d\adapters\lora\Modelfile" --experimental -q q4_K_M

        if errorlevel 1 (
            echo ERROR - Registration failed
        ) else (
            echo.
            echo === Done! ===
            echo Model: storyforge-%PROJECT%
            echo Test: ollama run storyforge-%PROJECT%
        )
        goto :done
    )
)

echo ERROR - No LoRA adapter found. Train a model first.

:done
echo.
pause
