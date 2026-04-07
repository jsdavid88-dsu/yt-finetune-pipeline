@echo off
chcp 65001 >nul
echo === Update llama.cpp ===

set "LLAMA_DIR=C:\Users\%USERNAME%\.unsloth\llama.cpp"

if not exist "%LLAMA_DIR%" (
    echo ERROR - llama.cpp not found at %LLAMA_DIR%
    echo Run training first to auto-install llama.cpp.
    pause
    exit /b 1
)

echo Updating llama.cpp...
cd /d "%LLAMA_DIR%"
git pull

echo.
echo Building llama.cpp...
cmake -B build
cmake --build build --config Release

echo.
if errorlevel 1 (
    echo ERROR - Build failed. Make sure CMake is installed: winget install Kitware.CMake
) else (
    echo === Done! llama.cpp updated and built ===
)

echo.
pause
