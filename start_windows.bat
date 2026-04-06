@echo off
chcp 65001 >nul
title StoryForge

echo.
echo  === StoryForge v0.3 ===
echo.

set "ROOT=%~dp0"
set "PYTHON="

echo [1/6] Python...
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
    echo   Python not found. Installing...
    call :install_python
    if not defined PYTHON (
        echo   ERROR - install failed. Get it from https://python.org
        pause
        exit /b 1
    )
)

echo [2/6] GPU...
nvidia-smi >nul 2>&1
if errorlevel 1 (
    echo   WARN - no NVIDIA GPU
) else (
    echo   OK
)

echo [3/6] Ollama...
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
        echo   ERROR - install failed. Visit https://ollama.com
        pause
        exit /b 1
    )
    echo   installed. restart this script.
    pause
    exit /b 0
)
echo   OK

echo [4/6] Ollama server...
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
        echo   ERROR - model download failed
        pause
        exit /b 1
    )
)
echo   OK

echo [5/6] Dependencies...
cd /d "%ROOT%backend"
"%PYTHON%" -m pip install -r requirements.txt -q 2>nul
echo   OK

echo [6/6] Starting server...
echo.
echo  === StoryForge ready ===
echo  http://127.0.0.1:8000
echo  (close this window to stop)
echo.
start http://127.0.0.1:8000
"%PYTHON%" main.py
echo.
echo Server stopped. Press any key to close...
pause >nul
goto :eof


:install_python
echo   Downloading Python 3.12...
powershell -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile '%TEMP%\python-install.exe'"
if not exist "%TEMP%\python-install.exe" goto :eof
echo   Installing...
"%TEMP%\python-install.exe" /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1
del "%TEMP%\python-install.exe" 2>nul
where python >nul 2>&1
if not errorlevel 1 (
    set "PYTHON=python"
    echo   OK - installed
)
goto :eof
