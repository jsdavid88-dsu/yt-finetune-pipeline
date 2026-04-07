@echo off
chcp 65001 >nul
echo === Register Model to Ollama ===

set "ROOT=%~dp0"

:: Find merged_16bit folder first, then lora
for /d %%d in ("%ROOT%backend\data\*") do (
    if exist "%%d\adapters\merged_16bit\config.json" (
        set "MODEL_DIR=%%d\adapters\merged_16bit"
        for %%n in (%%d) do set "PROJECT=%%~nn"
        echo Found merged model: %%d\adapters\merged_16bit
        goto :found
    )
)
echo No merged model found.
pause
exit /b 1

:found
echo.
echo Creating Modelfile...
echo FROM %MODEL_DIR%> "%MODEL_DIR%\Modelfile"
echo Modelfile:
type "%MODEL_DIR%\Modelfile"
echo.

echo Registering with Ollama (experimental + q4_K_M quantize)...
echo This may take several minutes...
ollama create storyforge-%PROJECT% -f "%MODEL_DIR%\Modelfile" --experimental -q q4_K_M

if errorlevel 1 (
    echo.
    echo ERROR - Failed. Ollama version:
    ollama --version
) else (
    echo.
    echo === Success! ===
    echo Model: storyforge-%PROJECT%
    echo Test: ollama run storyforge-%PROJECT% "hello"
)

echo.
pause
