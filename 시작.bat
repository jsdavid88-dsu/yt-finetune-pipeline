@echo off
chcp 65001 >nul
title StoryForge

echo.
echo  === StoryForge v0.3 ===
echo.

set "ROOT=%~dp0"
set "PYTHON="

echo [1/5] Python...
if exist "%ROOT%python-embedded\python.exe" (
    set "PYTHON=%ROOT%python-embedded\python.exe"
    echo   OK - embedded
)
if not defined PYTHON (
    where python >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON=python"
        echo   OK - system
    )
)
if not defined PYTHON (
    echo   ERROR - no python
    pause
    exit /b 1
)

echo [2/5] GPU...
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo   WARN - no GPU
) else (
    echo   OK
)

echo [3/5] Ollama...
where ollama >nul 2>&1
if errorlevel 1 (
    echo   not found, installing...
    if exist "%ROOT%setup\ollama-installer.exe" (
        "%ROOT%setup\ollama-installer.exe" /VERYSILENT /NORESTART
    ) else (
        winget install Ollama.Ollama -s winget
    )
    where ollama >nul 2>&1
    if errorlevel 1 (
        echo   ERROR - install failed
        pause
        exit /b 1
    )
    echo   installed. restart this script.
    pause
    exit /b 0
)
echo   OK

echo [4/5] Ollama server...
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | findstr /I "ollama.exe" >nul 2>&1
if errorlevel 1 (
    start /B "" ollama serve >nul 2>&1
    timeout /t 3 /nobreak >nul
)
ollama list 2>nul | findstr /I "gemma4" >nul 2>&1
if errorlevel 1 (
    echo   pulling gemma4...
    ollama pull gemma4
    if errorlevel 1 (
        echo   ERROR - pull failed
        pause
        exit /b 1
    )
)
echo   OK

echo [5/5] Starting server...
cd /d "%ROOT%backend"
"%PYTHON%" -m pip install -r requirements.txt -q 2>nul
start /B "" "%PYTHON%" main.py
timeout /t 3 /nobreak >nul

echo.
echo  === StoryForge ready ===
echo  http://127.0.0.1:8000
echo.
start http://127.0.0.1:8000
echo Press any key to stop server...
pause >nul
